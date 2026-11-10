import http from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {LmsApp, friendlyError} from './app-service.mjs';
import {LmsError} from './errors.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const staticFiles = {'/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml']};
const resultFiles = new Map([['calendar.ics', 'text/calendar'], ['summary-input.jsonl', 'application/x-ndjson'], ['summary.txt', 'text/plain'], ['summary-prompt.txt', 'text/plain'], ['study.md', 'text/markdown']]);
const friendlyFilenames = {'calendar.ics': '숭실대 LMS 일정.ics', 'summary.txt': 'AI 요약용 원문.txt', 'summary-prompt.txt': '요약 요청 문구.txt'};

export async function openFolder(directory) {
  await mkdir(directory, {recursive: true});
  const [command, args] = process.platform === 'win32' ? ['explorer.exe', [directory]] : process.platform === 'darwin' ? ['open', [directory]] : ['xdg-open', [directory]];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: 'ignore', windowsHide: false});
    child.once('spawn', resolve); child.once('error', () => reject(new LmsError('FOLDER', 'open')));
    child.unref();
  });
}

function reply(res, status, value, type = 'application/json') {
  res.writeHead(status, {'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
  res.end(type === 'application/json' ? JSON.stringify(value) : value);
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new LmsError('OPTIONS', 'content-type');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 32768) throw new LmsError('OPTIONS', 'size'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new LmsError('OPTIONS', 'json'); }
}

export function createLocalServer({app = new LmsApp(), openDirectory = openFolder} = {}) {
  let localUrl, closing;
  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return reply(res, 403, {error: '이 PC의 앱 화면에서 다시 시도해 주세요.'});
    if ((req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') return reply(res, 403, {error: '앱 화면에서 다시 시도해 주세요.'});
    try {
      const url = new URL(req.url, localUrl);
      if (req.method === 'GET' && staticFiles[url.pathname]) {
        const [filename, type] = staticFiles[url.pathname];
        return reply(res, 200, await readFile(path.join(root, 'public', filename)), type);
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return reply(res, 200, {app: 'ssu-lms-moa', pid: process.pid});
      if (req.method === 'GET' && url.pathname === '/api/state') return reply(res, 200, app.view());
      if (req.method === 'GET' && url.pathname.startsWith('/api/files/')) {
        const filename = url.pathname.slice('/api/files/'.length), type = resultFiles.get(filename);
        if (!type || !app.resultDirectory || app.running) throw new LmsError('NO_RESULT', 'file');
        const data = await readFile(path.join(app.resultDirectory, filename));
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(friendlyFilenames[filename] || filename)}`);
        return reply(res, 200, data, type);
      }
      if (req.method !== 'POST') return reply(res, 404, {error: '화면을 찾을 수 없어요.'});
      if (req.headers['x-lms-app'] !== '1') return reply(res, 403, {error: '앱 화면에서 다시 시도해 주세요.'});
      const body = await readJson(req);
      switch (url.pathname) {
        case '/api/connect': app.connect(); break;
        case '/api/confirm-login': await app.confirmLogin(); break;
        case '/api/focus-login': await app.focusLogin(); break;
        case '/api/disconnect': await app.disconnect(); break;
        case '/api/forget-login': await app.disconnect({forget: true}); break;
        case '/api/collect': app.start(body); break;
        case '/api/cancel': app.cancel(); break;
        case '/api/open-folder':
          if (body.result && !app.resultDirectory) throw new LmsError('NO_RESULT', 'folder');
          await openDirectory(body.result ? app.resultDirectory : app.outputBase); break;
        case '/api/shutdown':
          reply(res, 200, {closed: true}); void close(); return;
        default: return reply(res, 404, {error: '요청을 찾을 수 없어요.'});
      }
      reply(res, 200, app.view());
    } catch (error) {
      if (!res.headersSent) reply(res, error.code === 'BUSY' ? 409 : 400, {error: friendlyError(error)});
    }
  });
  server.requestTimeout = 60000;
  async function close() {
    if (closing) return closing;
    closing = (async () => { await app.close(); await new Promise(resolve => server.close(resolve)); })();
    return closing;
  }
  return {app, server, close, async listen(port = 4318) {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    localUrl = `http://127.0.0.1:${server.address().port}`;
    return localUrl;
  }};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.SSU_LMS_PORT || 4318);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('앱 주소 설정을 확인해 주세요.'); process.exitCode = 1; }
  else {
    const instance = createLocalServer();
    instance.listen(port).then(url => {
      console.log(`LMS 모아: ${url}`);
      if (process.env.SSU_LMS_VERIFY_START !== '1') instance.app.resume();
    }).catch(() => { console.error('앱을 시작하지 못했습니다. 이미 열린 LMS 모아 창을 확인해 주세요.'); process.exitCode = 1; });
    process.once('SIGINT', () => void instance.close()); process.once('SIGTERM', () => void instance.close());
  }
}
