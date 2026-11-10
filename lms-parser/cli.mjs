import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {HttpClient, CANVAS, PORTAL, COMMONS} from './http.mjs';
import {collectLms} from './collect.mjs';
import {createOutputDirectory, downloadResources} from './download.mjs';
import {writeExport} from './export.mjs';
import {LmsError, publicError} from './errors.mjs';

const help = `숭실대학교 LMS 파서 (Node.js 20.18.1 이상)

  npm start -- probe
  npm start -- collect [옵션]

  --course 123,456       수강 과목 ID 선택 (기본: 활성 수강 목록 전체)
  --term 10              Canvas 학기 ID로 필터
  --download none|files|all  다운로드 범위 (기본: none, all은 영상 포함)
  --out ../lms-output    계정별·실행별 결과를 저장할 상위 폴더
  --max-file-mb 2048     파일 하나의 다운로드 크기 제한
  --browser chrome|msedge|chromium  로그인 브라우저 (기본: chrome)
  --auth browser|token   인증 방식 (기본: browser)
  --allow-host HOST      별도 CDN 호스트 허용 (반복 가능)
  --help                사용법

브라우저 로그인은 실행할 때마다 직접 합니다. 인증 정보를 파일로 저장하지 않습니다.
token 모드는 환경 변수 SSU_LMS_TOKEN을 사용하며 브라우저 대체 수집을 지원하지 않습니다.
`;

export function optionsFrom(argv) {
  let parsed;
  try { parsed = parseArgs({args: argv, allowPositionals: true, options: {
    help: {type: 'boolean'}, course: {type: 'string'}, term: {type: 'string'}, download: {type: 'string', default: 'none'},
    out: {type: 'string', default: fileURLToPath(new URL('../lms-output/', import.meta.url))}, 'max-file-mb': {type: 'string', default: '2048'},
    browser: {type: 'string', default: 'chrome'}, auth: {type: 'string', default: 'browser'}, 'allow-host': {type: 'string', multiple: true, default: []},
  }}); } catch { throw new LmsError('OPTIONS', '실행 옵션이 올바르지 않습니다. --help를 확인하세요.'); }
  const {values, positionals} = parsed;
  if (values.help || !positionals.length) return {help: true};
  if (positionals.length !== 1 || !['probe', 'collect'].includes(positionals[0]) ||
      !['none', 'files', 'all'].includes(values.download) || !['browser', 'token'].includes(values.auth) ||
      !['chrome', 'msedge', 'chromium'].includes(values.browser)) throw new LmsError('OPTIONS', '명령과 옵션을 --help에서 확인하세요.');
  const courseIds = values.course ? [...new Set(values.course.split(',').map(value => value.trim()))] : [];
  if (courseIds.some(id => !/^\d+$/.test(id)) || (values.term && !/^\d+$/.test(values.term))) throw new LmsError('OPTIONS', '과목·학기 ID는 숫자로 입력하세요.');
  const mb = Number(values['max-file-mb']);
  if (!Number.isInteger(mb) || mb < 1 || mb > 20480) throw new LmsError('OPTIONS', '파일 크기 제한은 1~20480 MB입니다.');
  if (values['allow-host'].some(host => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host))) throw new LmsError('OPTIONS', '허용 호스트는 포트·경로 없는 도메인으로 입력하세요.');
  return {command: positionals[0], courseIds, termId: values.term, download: values.download, out: values.out,
    maxBytes: mb * 1024 ** 2, browser: values.browser, auth: values.auth, hosts: values['allow-host'].map(host => host.toLowerCase())};
}

async function probe() {
  // Public, unauthenticated requests only. No response bodies or headers logged.
  for (const [name, url] of [['portal', PORTAL], ['canvas-api', `${CANVAS}/api/v1/courses`], ['commons', COMMONS]]) {
    try {
      const response = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(15000)});
      console.log(`${name}: HTTP ${response.status} (${new URL(url).hostname})`);
      await response.body?.cancel();
    } catch { console.log(`${name}: 연결 실패`); process.exitCode = 1; }
  }
  console.log('수집 어댑터: Canvas REST API → LearningX/Commons → 브라우저 과목·주차 목록');
}

export async function main(argv = process.argv.slice(2)) {
  const options = optionsFrom(argv);
  if (options.help) { console.log(help); return; }
  if (options.command === 'probe') { await probe(); return; }
  let session;
  const close = async () => { await session?.close().catch(() => {}); };
  const interrupt = () => { void close().finally(() => process.exit(130)); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    if (options.auth === 'browser') {
      if (!process.stdin.isTTY) throw new LmsError('LOGIN_INPUT', '로그인은 대화형 터미널에서 실행하세요.');
      const {browserSession} = await import('./browser.mjs');
      session = await browserSession({channel: options.browser});
      await session.login(async () => {
        const reader = createInterface({input: process.stdin, output: process.stdout});
        try { await reader.question('열린 브라우저에서 LMS 통합 로그인 후 강의실을 여세요. 완료하면 Enter: '); }
        finally { reader.close(); }
      });
    } else if (!process.env.SSU_LMS_TOKEN) throw new LmsError('TOKEN_MISSING', 'SSU_LMS_TOKEN 환경 변수가 필요합니다. 기본 브라우저 인증도 사용할 수 있습니다.');
    const client = new HttpClient({hosts: options.hosts, token: options.auth === 'token' ? process.env.SSU_LMS_TOKEN : undefined,
      cookies: session?.cookies, receiveCookies: session?.receiveCookies, refreshAuth: session?.ensureLogin, learningxAuth: session?.learningxAuth});
    const {snapshot, assets} = await collectLms({client, browser: session, courseIds: options.courseIds, termId: options.termId, progress: message => console.log(message)});
    const directory = await createOutputDirectory(path.resolve(options.out), snapshot.accountKey);
    await downloadResources({snapshot, assets, client, directory, mode: options.download, maxBytes: options.maxBytes, progress: message => console.log(message)});
    const counts = await writeExport(snapshot, directory);
    console.log(`저장 완료: ${directory}`);
    console.log(`과목 ${counts.courses} · 일정 ${counts.events} · 다운로드 ${counts.downloaded} · 요약 입력 ${counts.summaryChunks} · 경고 ${counts.warnings}`);
    const streams = snapshot.resources.filter(row => row.status === 'stream_only').length;
    if (streams) console.log(`HLS/DASH 스트림 ${streams}개는 목록에만 저장했습니다.`);
    if (counts.warnings) { console.log('누락·실패 내역: snapshot.json의 warnings를 확인하세요.'); process.exitCode = 2; }
  } finally {
    await close(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { const safe = publicError(error); console.error(`${safe.code}: ${safe.message}`); process.exitCode = 1; });
}
