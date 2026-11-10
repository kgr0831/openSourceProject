import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {LmsApp} from '../app-service.mjs';
import {createLocalServer} from '../server.mjs';
import {HttpClient} from '../http.mjs';
import {fixtureFetch} from './fixtures.mjs';
import {request} from 'node:http';

async function setup(t, overrides = {}) {
  const outputBase = await mkdtemp(path.join(os.tmpdir(), 'lms-moa-app-'));
  const fixture = fixtureFetch();
  let authenticated = false, closed = 0;
  const session = {openLogin: async () => {}, checkLogin: async () => authenticated ? {id: 99} : null,
    completeLogin: async () => { authenticated = true; }, focusLogin: async () => {}, close: async () => { closed++; }};
  const app = new LmsApp({createSession: async () => session,
    createClient: (_, signal) => new HttpClient({fetchImpl: fixture.fetch, signal}), outputBase, loginInterval: 5, ...overrides});
  t.after(async () => { await app.close(); await rm(outputBase, {recursive: true, force: true}); });
  return {app, fixture, session, outputBase, closed: () => closed};
}

async function until(condition) {
  for (let n = 0; n < 100; n++) { if (condition()) return; await delay(10); }
  assert.fail('Expected state transition did not finish');
}

async function connect(app) { app.connect(); await until(() => app.state.connection === 'waiting'); await app.confirmLogin(); await app.loginTask; }

test('화면에서 로그인하고 과목 선택 후 결과를 저장한다; 로그인만으로 자료를 다운로드하지 않는다', async t => {
  const {app, fixture} = await setup(t);
  await connect(app);
  assert.equal(app.state.connection, 'connected'); assert.equal(app.state.courses.length, 1);
  assert.ok(fixture.requested.every(row => ['/api/v1/users/self', '/api/v1/courses'].includes(row.path)));
  assert.throws(() => app.start({courseIds: []}), {code: 'SELECTION'});
  assert.throws(() => app.start({courseIds: ['999']}), {code: 'SELECTION'});
  app.start({courseIds: ['10'], mode: 'files'}); await app.jobTask;
  assert.equal(app.state.job.phase, 'complete'); assert.equal(app.state.result.counts.downloaded, 2);
  assert.ok(app.state.result.issues.length > 0);
  assert.doesNotMatch(JSON.stringify(app.view()), /fixture|signature|verifier|not-exported/);
  assert.ok((await readFile(path.join(app.resultDirectory, 'calendar.ics'), 'utf8')).includes('BEGIN:VCALENDAR'));
});

test('진행 중 중복 시작과 계정 변경을 막고 실제 요청 취소를 전달한다', async t => {
  let gotSignal = false;
  const {app} = await setup(t, {collect: ({client}) => new Promise((resolve, reject) => {
    client.signal.addEventListener('abort', () => { gotSignal = true; reject(Object.assign(new Error(), {code: 'CANCELLED'})); }, {once: true});
  })});
  await connect(app); app.start({courseIds: ['10'], mode: 'all'});
  assert.throws(() => app.start({courseIds: ['10']}), {code: 'BUSY'});
  await assert.rejects(app.disconnect(), {code: 'BUSY'});
  app.cancel(); await app.jobTask;
  assert.equal(gotSignal, true); assert.equal(app.state.job.phase, 'cancelled');
  assert.equal(app.state.result, null); assert.equal(app.state.connection, 'connected');
});

test('다운로드 중 중단하면 취소된 결과를 저장하고 성공으로 표시하지 않는다', async t => {
  const {app} = await setup(t, {download: ({client}) => new Promise((resolve, reject) => {
    client.signal.addEventListener('abort', () => reject(Object.assign(new Error(), {code: 'CANCELLED'})), {once: true});
  })});
  await connect(app); app.start({courseIds: ['10'], mode: 'all'});
  await until(() => app.state.job.phase === 'downloading'); app.cancel(); await app.jobTask;
  assert.equal(app.state.job.phase, 'cancelled'); assert.equal(app.state.result.cancelled, true);
  const result = JSON.parse(await readFile(path.join(app.resultDirectory, 'snapshot.json'), 'utf8'));
  assert.equal(result.cancelled, true); assert.equal(result.counts.downloaded, 0);
});

test('로그인 창 생성 중 취소해도 나중에 연결 상태가 되살아나지 않는다', async t => {
  let resolveSession, closed = 0;
  const {app} = await setup(t, {createSession: () => new Promise(resolve => { resolveSession = resolve; })});
  app.connect(); await until(() => Boolean(resolveSession)); await app.disconnect();
  resolveSession({close: async () => { closed++; }}); await app.loginTask;
  assert.equal(app.state.connection, 'disconnected'); assert.equal(closed, 1);
});

test('로그인 창이 닫히면 반복 저장 대신 재연결 안내를 표시한다', async t => {
  const {app, session} = await setup(t); await connect(app);
  session.checkLogin = async () => { throw Object.assign(new Error(), {code: 'BROWSER_CLOSED'}); };
  app.start({courseIds: ['10'], mode: 'files'}); await app.jobTask;
  assert.equal(app.state.job.phase, 'error'); assert.equal(app.state.job.reconnect, true);
  assert.match(app.state.notice, /다시 연결/);
});

test('저장된 로그인은 학교 창 없이 자동 연결되고 앱 종료로 지워지지 않는다', async t => {
  let background = 0, cleared = 0;
  const {app, session} = await setup(t, {sessionStore: {clear: async () => { cleared++; }}});
  session.restore = async () => true;
  session.openLogin = async () => assert.fail('자동 복원은 학교 창을 열지 않는다');
  session.useInBackground = async () => { background++; };
  session.remembered = true;
  app.resume(); await app.loginTask;
  assert.equal(app.state.connection, 'connected'); assert.equal(app.state.remembered, true);
  assert.equal(background, 1);
  await app.close(); assert.equal(cleared, 0);
});

test('자동 복원 중 만료되면 재로그인을 안내하고 명시적 로그아웃만 저장된 세션을 지운다', async t => {
  let opened = 0; const events = [];
  const {app, session} = await setup(t, {sessionStore: {clear: async () => events.push('clear')}});
  session.restore = async () => false; session.hadSavedLogin = true;
  session.openLogin = async () => { opened++; };
  session.close = async () => events.push('close');
  app.resume(); await app.loginTask;
  assert.equal(opened, 0); assert.equal(app.state.connection, 'disconnected');
  assert.match(app.state.notice, /만료/); assert.equal(app.state.remembered, true);
  await connect(app); assert.equal(opened, 1);
  await app.disconnect({forget: true});
  assert.deepEqual(events, ['close', 'close', 'clear']);
  assert.equal(app.state.remembered, false); assert.deepEqual(app.state.courses, []);
});

test('백그라운드 전환 도중 연결 취소해도 과목·연결이 되살아나지 않는다', async t => {
  let finishHandoff;
  const {app, session} = await setup(t);
  session.useInBackground = () => new Promise(resolve => { finishHandoff = resolve; });
  app.connect(); await until(() => app.state.connection === 'waiting'); await app.confirmLogin();
  await until(() => Boolean(finishHandoff)); await app.disconnect();
  finishHandoff(); await app.loginTask;
  assert.equal(app.state.connection, 'disconnected'); assert.deepEqual(app.state.courses, []);
});

test('암호화 보관 실패를 로그인 성공으로 숨기지 않고 안내한다', async t => {
  const {app, session} = await setup(t);
  session.storageWarning = true; session.remembered = false;
  await connect(app);
  assert.equal(app.state.connection, 'connected'); assert.equal(app.state.remembered, false);
  assert.match(app.state.notice, /보관하지 못했/);
});

test('로컬 서버는 외부 Origin·잘못된 Host·임의 파일 요청을 거절한다', async t => {
  const {app} = await setup(t); const opened = [];
  const instance = createLocalServer({app, openDirectory: async directory => opened.push(directory)});
  const url = await instance.listen(0); t.after(() => instance.close());
  const post = (route, body, headers = {}) => fetch(url + route, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Lms-App': '1', ...headers}, body: JSON.stringify(body)});
  assert.equal((await post('/api/connect', {}, {Origin: 'https://other.invalid'})).status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const req = request(url + '/api/state', {headers: {Host: 'other.invalid'}}, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal((await fetch(url + '/api/files/calendar.ics')).status, 400);
  assert.equal((await post('/api/open-folder', {result: true, path: 'C:/unrelated'})).status, 400);
  assert.equal(opened.length, 0);
  assert.equal((await fetch(url + '/')).status, 200);
  assert.equal((await post('/api/connect', {})).status, 200);
  await until(() => app.state.connection === 'waiting');
  assert.equal((await post('/api/confirm-login', {})).status, 200); await app.loginTask;
  assert.equal((await post('/api/collect', {courseIds: ['10'], mode: 'none'})).status, 200); await app.jobTask;
  assert.equal((await fetch(url + '/api/files/calendar.ics')).status, 200);
  assert.equal((await fetch(url + '/api/files/snapshot.json')).status, 400);
  assert.equal((await post('/api/open-folder', {result: true, path: 'C:/unrelated'})).status, 200);
  assert.deepEqual(opened, [app.resultDirectory]);
});
