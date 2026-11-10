import {mkdir, open, link, rm, mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {LmsError, publicError} from './errors.mjs';

export function safeFilename(value) {
  let name = String(value || '자료').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  const extension = path.extname(name).slice(0, 12);
  name = [...name.slice(0, name.length - extension.length)].slice(0, 60).join('') + extension;
  return name || '자료';
}

export async function createOutputDirectory(base, accountKey) {
  if (!/^[a-f0-9]{24}$/.test(accountKey)) throw new LmsError('OUTPUT', '계정별 출력 경로가 올바르지 않습니다.');
  const directory = path.resolve(base, accountKey);
  await mkdir(directory, {recursive: true, mode: 0o700});
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return mkdtemp(path.join(directory, timestamp + '-'));
}

export async function downloadOne({client, url, destination, maxBytes = 2 * 1024 ** 3, onProgress = () => {}}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new LmsError('LIMIT', '다운로드 크기 제한이 올바르지 않습니다.');
  const response = await client.get(url, {timeout: 15 * 60 * 1000});
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) { await response.body?.cancel(); throw new LmsError('TOO_LARGE', '파일 크기가 다운로드 제한보다 큽니다.'); }
  if (/text\/html|application\/xhtml/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel(); throw new LmsError('NOT_FILE', '파일 대신 HTML 화면을 받았습니다. 로그인 상태를 확인하세요.');
  }
  if (/mpegurl|dash\+xml/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel(); throw new LmsError('STREAM_ONLY', 'HLS/DASH 스트림은 목록만 수집하며 이 파서에서 합치지 않습니다.');
  }
  const temporary = destination + '.part';
  let file, bytes = 0, head = Buffer.alloc(0), lastUpdate = 0;
  const hash = createHash('sha256');
  const meter = new Transform({transform(chunk, _, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes) return callback(new LmsError('TOO_LARGE', '파일 크기가 다운로드 제한보다 큽니다.'));
    if (head.length < 512) head = Buffer.concat([head, chunk.subarray(0, 512 - head.length)]);
    if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(head.toString('utf8'))) return callback(new LmsError('NOT_FILE', '파일 대신 로그인 또는 오류 화면을 받았습니다.'));
    if (/^\s*#EXTM3U|<MPD\b/i.test(head.toString('utf8'))) return callback(new LmsError('STREAM_ONLY', '스트림 목록을 영상 파일로 저장하지 않습니다.'));
    if (Date.now() - lastUpdate > 150) { lastUpdate = Date.now(); onProgress({bytes, totalBytes: declared || null}); }
    hash.update(chunk); callback(null, chunk);
  }});
  try {
    file = await open(temporary, 'wx', 0o600);
    await pipeline(Readable.fromWeb(response.body), meter, file.createWriteStream());
    if (!bytes) throw new LmsError('EMPTY_FILE', '빈 파일을 받았습니다.');
    if (declared && !response.headers.get('content-encoding') && bytes !== declared) throw new LmsError('INCOMPLETE', '파일 전송이 끝나지 않았습니다.');
    // A hard link atomically publishes the completed file without replacing an
    // existing file. Temporary and destination paths are on the same volume.
    await link(temporary, destination);
    return {bytes, sha256: hash.digest('hex')};
  } catch (error) {
    await response.body?.cancel().catch(() => {});
    client.checkCancelled?.();
    if (error instanceof LmsError) throw error;
    throw new LmsError('DOWNLOAD', '다운로드를 완료하지 못했습니다. 저장 공간과 연결을 확인하세요.');
  } finally {
    if (file) { await file.close().catch(() => {}); await rm(temporary, {force: true}); }
  }
}

export async function downloadResources({snapshot, assets, client, directory, mode = 'none', maxBytes, progress = () => {}}) {
  if (!['none', 'files', 'all'].includes(mode)) throw new LmsError('OPTIONS', '--download는 none, files, all 중 하나입니다.');
  if (mode === 'none') return;
  await mkdir(path.join(directory, 'downloads'), {mode: 0o700});
  const selected = snapshot.resources.filter(resource => resource.status === 'available' && (mode !== 'files' || resource.kind !== 'video'));
  for (const [index, resource] of selected.entries()) {
    client.checkCancelled?.();
    const asset = assets.get(resource.id);
    if (!asset) continue;
    const name = `${resource.id}-${safeFilename(resource.name)}`;
    const relative = `downloads/${name}`;
    const detail = {phase: 'downloading', current: index + 1, total: selected.length, name: resource.name};
    progress(`자료 다운로드 ${index + 1}/${selected.length}`, detail);
    try {
      const info = await downloadOne({client, url: asset.url, destination: path.join(directory, relative), maxBytes,
        onProgress: bytes => progress(`자료 다운로드 ${index + 1}/${selected.length}`, {...detail, ...bytes})});
      Object.assign(resource, {status: 'downloaded', localPath: relative, ...info});
    } catch (error) {
      if (error.code === 'CANCELLED') throw error;
      resource.status = error.code === 'STREAM_ONLY' ? 'stream_only' : 'failed'; resource.error = publicError(error);
      snapshot.warnings.push({courseId: resource.courseId, stage: 'download', resourceId: resource.id, ...publicError(error)});
    }
  }
}
