import test from 'node:test';
import assert from 'node:assert/strict';
import {LmsConnection} from '../connection.mjs';
import {HttpClient} from '../http.mjs';
import {LmsError} from '../errors.mjs';

const password = 'p@ss-for-test';
function connection({passwordLogin = async () => {}, ...options} = {}) {
  const calls = [], closed = [];
  const app = new LmsConnection({...options, createSession: async () => ({
    restore: async () => null, passwordLogin: async credentials => { calls.push(credentials); await passwordLogin(credentials); },
    useInBackground: async () => {}, save: async () => {}, close: async () => { closed.push(true); }, remembered: false,
  }), createClient: (_, signal) => new HttpClient({signal, fetchImpl: async url => {
    const {pathname} = new URL(url);
    if (pathname === '/api/v1/users/self') return Response.json({id: 7, name: '김숭실'});
    if (pathname === '/api/v1/courses') return Response.json([{id: 10, name: '기초설계', course_code: 'DESIGN', term: {id: 3, name: '2026-2'}}]);
    return Response.json([]);
  }})});
  return {app, calls, closed};
}

test('학교 아이디와 비밀번호로 로그인하면 연결되고, 비밀번호는 상태에 남지 않는다', async () => {
  const {app, calls} = connection();
  app.signIn({userId: ' 20201234 ', password});
  assert.equal(app.state.connection, 'signing');
  assert.throws(() => app.signIn({userId: '20201234', password}), {code: 'BUSY'});
  await app.loginTask;
  assert.equal(app.state.connection, 'connected');
  assert.equal(app.state.accountName, '김숭실');
  assert.deepEqual(app.state.courses.map(course => course.name), ['기초설계']);
  assert.deepEqual(calls, [{userId: '20201234', password}]);
  assert.equal(JSON.stringify(app.view()).includes(password), false);
  assert.equal(JSON.stringify(Object.entries(app).filter(([key]) => key !== 'session')).includes(password), false);
  await app.close();
});

test('학교가 거절하면 이유를 알리고 세션을 닫는다', async () => {
  const {app, closed} = connection({passwordLogin: async () => { throw new LmsError('CREDENTIALS', 'refused'); }});
  app.signIn({userId: '20201234', password});
  await app.loginTask;
  assert.equal(app.state.connection, 'error');
  assert.match(app.state.notice, /^학번 또는 비밀번호가 맞지 않아요/);
  assert.equal(app.session, null); assert.equal(closed.length, 1);
  assert.equal(JSON.stringify(app.view()).includes(password), false);
});

test('빈 값과 학교 폼보다 긴 값은 학교로 보내지 않는다', () => {
  const {app, calls} = connection();
  for (const input of [undefined, {}, {userId: '', password}, {userId: '20201234', password: ''}, {userId: 20201234, password},
    {userId: 'x'.repeat(21), password}, {userId: '20201234', password: 'x'.repeat(21)}]) {
    assert.throws(() => app.signIn(input), {code: 'CREDENTIALS_INPUT'});
  }
  assert.equal(app.state.connection, 'disconnected'); assert.equal(calls.length, 0);
});

test('창을 띄울 수 없는 서버에서는 학교 창 로그인을 받지 않는다', async () => {
  const {app} = connection({windowLogin: false});
  assert.equal(app.view().windowLogin, false);
  assert.throws(() => app.connect(), {code: 'WINDOW_LOGIN'});
  app.resume(); await app.loginTask;
  assert.equal(app.state.connection, 'disconnected');
});
