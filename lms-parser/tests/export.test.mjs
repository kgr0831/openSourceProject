import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {HttpClient} from '../http.mjs';
import {collectLms} from '../collect.mjs';
import {createOutputDirectory, downloadResources, downloadOne, safeFilename} from '../download.mjs';
import {calendarEvents, exportIcs, writeExport} from '../export.mjs';
import {optionsFrom} from '../cli.mjs';
import {fixtureFetch} from './fixtures.mjs';

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ssu-lms-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

test('수집→영상·자막 다운로드→ICS·요약 입력의 전체 흐름', async t => {
  const base = await temporary(t), fixture = fixtureFetch();
  const client = new HttpClient({fetchImpl: fixture.fetch});
  const {snapshot, assets} = await collectLms({client});
  const directory = await createOutputDirectory(base, snapshot.accountKey);
  await downloadResources({snapshot, assets, client, directory, mode: 'all', maxBytes: 100000});
  const counts = await writeExport(snapshot, directory);
  assert.equal(counts.downloaded, 3); assert.equal(counts.events, 3);
  const docs = (await readFile(path.join(directory, 'summary-input.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(docs.some(row => row.text === '설계는 문제 정의부터 시작합니다.'));
  assert.ok(docs.some(row => row.text === '기초 설계의 핵심 내용'));
  assert.doesNotMatch(await readFile(path.join(directory, 'snapshot.json'), 'utf8'), /signature|verifier|not-exported/);
  for (const resource of snapshot.resources) {
    assert.match(resource.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await readFile(path.join(directory, resource.localPath))).length, resource.bytes);
  }
  const otherRun = await createOutputDirectory(base, snapshot.accountKey);
  assert.notEqual(otherRun, directory);
});

test('ICS는 개인별 안정 UID, UTC 마감, 종일 일정과 UTF-8 75바이트 접기를 지원한다', async () => {
  const fixture = fixtureFetch(); const {snapshot} = await collectLms({client: new HttpClient({fetchImpl: fixture.fetch})});
  snapshot.courses[0].name = '한글 긴 과목 이름 '.repeat(20);
  const ics = exportIcs(snapshot);
  assert.match(ics, /DTSTART:20261110T145900Z/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121/);
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  const ids = calendarEvents(snapshot).map(row => row.id);
  assert.deepEqual(calendarEvents({...snapshot, collectedAt: '2026-12-01T00:00:00Z'}).map(row => row.id), ids);
  assert.notDeepEqual(calendarEvents({...snapshot, accountKey: 'another-user'}).map(row => row.id), ids);
});

test('중단·크기 초과·HTML 응답은 완성 파일로 남지 않는다', async t => {
  const directory = await temporary(t);
  const tooLarge = new HttpClient({fetchImpl: async () => new Response('0123456789')});
  await assert.rejects(downloadOne({client: tooLarge, url: '/data.txt', destination: path.join(directory, 'large'), maxBytes: 4}), {code: 'TOO_LARGE'});
  const html = new HttpClient({fetchImpl: async () => new Response('<html>로그인</html>', {headers: {'content-type': 'application/octet-stream'}})});
  await assert.rejects(downloadOne({client: html, url: '/data.txt', destination: path.join(directory, 'html')}), {code: 'NOT_FILE'});
  const broken = new HttpClient({fetchImpl: async () => new Response(new ReadableStream({start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.error(new Error('connection lost')); }}))});
  await assert.rejects(downloadOne({client: broken, url: '/data.txt', destination: path.join(directory, 'broken')}), {code: 'DOWNLOAD'});
  assert.deepEqual(await readdir(directory), []);
});

test('기존 파일과 기존 part 파일은 덮어쓰거나 삭제하지 않는다', async t => {
  const directory = await temporary(t), destination = path.join(directory, 'file.txt');
  const client = new HttpClient({fetchImpl: async () => new Response('new')});
  await writeFile(destination, 'existing');
  await assert.rejects(downloadOne({client, url: '/data.txt', destination}), {code: 'DOWNLOAD'});
  assert.equal(await readFile(destination, 'utf8'), 'existing');
  await writeFile(destination + '.part', 'other partial');
  await assert.rejects(downloadOne({client, url: '/data.txt', destination}), {code: 'DOWNLOAD'});
  assert.equal(await readFile(destination + '.part', 'utf8'), 'other partial');
});

test('파일명과 CLI 옵션으로 경로 이동·잘못된 수집 범위를 허용하지 않는다', () => {
  assert.doesNotMatch(safeFilename('../../evil\\path:?.pdf'), /[\\/:?]/);
  assert.equal(optionsFrom(['collect', '--course', '10,20', '--download', 'all']).download, 'all');
  assert.throws(() => optionsFrom(['collect', '--course', '../10']), {code: 'OPTIONS'});
  assert.throws(() => optionsFrom(['collect', '--max-file-mb', 'NaN']), {code: 'OPTIONS'});
  assert.throws(() => optionsFrom(['collect', '--allow-host', 'https://host.invalid/path']), {code: 'OPTIONS'});
});

test('영상 주소로 응답한 HLS 목록을 MP4로 저장하지 않는다', async t => {
  const directory = await temporary(t);
  const client = new HttpClient({fetchImpl: async () => new Response('#EXTM3U\n#EXTINF:10,\npart.ts')});
  await assert.rejects(downloadOne({client, url: '/video.mp4', destination: path.join(directory, 'video.mp4')}), {code: 'STREAM_ONLY'});
  assert.deepEqual(await readdir(directory), []);
});

test('여러 날 종일 일정과 Canvas/LearningX에서 겹치는 과제 마감을 보존·중복 제거한다', () => {
  const snapshot = {source: 'https://canvas.ssu.ac.kr', accountKey: 'account', collectedAt: '2026-11-09T00:00:00Z', courses: [{id: '10', name: '설계', items: [
    {id: 'assignment:10:20', title: '과제', dueAt: '2026-11-10T14:59:00Z'},
    {id: 'learningx:10:70', title: '같은 과제', dueAt: '2026-11-10T14:59:00Z', canvasAssignmentId: '20'},
    {id: 'calendar:10:80', title: '행사', allDay: true, allDayDate: '2026-11-20', startAt: '2026-11-19T15:00:00Z', endAt: '2026-11-22T15:00:00Z'},
  ]}]};
  assert.equal(calendarEvents(snapshot).length, 2);
  assert.match(exportIcs(snapshot), /DTEND;VALUE=DATE:20261123/);
});
