import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpClient} from '../http.mjs';
import {responseCookies} from '../session-cookies.mjs';

test('Canvas XSSI JSON과 Link 페이지를 끝까지 읽는다', async () => {
  const requests = [];
  const client = new HttpClient({fetchImpl: async url => {
    requests.push(url.href);
    return requests.length === 1
      ? new Response('while(1);[{"id":1}]', {headers: {Link: '<https://canvas.ssu.ac.kr/api/v1/courses?page=2&per_page=1>; rel="next"'}})
      : Response.json([{id: 2}]);
  }});
  assert.deepEqual(await client.list('/api/v1/courses'), [{id: 1}, {id: 2}]);
  assert.equal(requests.length, 2);
  assert.match(requests[0], /per_page=100/);
});

test('다른 호스트의 Link에 인증 정보를 전송하지 않는다', async () => {
  let requests = 0;
  const client = new HttpClient({token: 'fixture-value', fetchImpl: async () => {
    requests++; return Response.json([], {headers: {link: '<https://other.invalid/api/v1/courses>; rel="next"'}});
  }});
  await assert.rejects(client.list('/api/v1/courses'), {code: 'HOST_NOT_ALLOWED'});
  assert.equal(requests, 1);
});

test('같은 페이지 반복 및 API의 로그인 리디렉션을 오류로 표시한다', async () => {
  const client = new HttpClient({fetchImpl: async () => Response.json([], {headers: {link: '<https://canvas.ssu.ac.kr/api/v1/courses?per_page=100>; rel="next"'}})});
  await assert.rejects(client.list('/api/v1/courses'), {code: 'PAGINATION'});
  const login = new HttpClient({fetchImpl: async () => new Response(null, {status: 302, headers: {location: 'https://lms.ssu.ac.kr/login'}})});
  await assert.rejects(login.json('/api/v1/courses'), {code: 'API_REDIRECT'});
});

test('HTTP 429를 제한된 횟수로 재시도하고 HTML 로그인 응답을 구분한다', async () => {
  let attempts = 0; const waits = [];
  const client = new HttpClient({sleep: async ms => waits.push(ms), fetchImpl: async () => ++attempts < 3
    ? new Response(null, {status: 429, headers: {'retry-after': '1'}}) : Response.json([])});
  assert.deepEqual(await client.list('/api/v1/courses'), []);
  assert.deepEqual(waits, [1000, 1000]);
  const html = new HttpClient({fetchImpl: async () => new Response('<html>로그인</html>')});
  await assert.rejects(html.list('/api/v1/courses'), {code: 'NOT_JSON'});
});

test('Canvas와 LearningX 인증을 분리하고 다운로드에 Bearer를 붙이지 않는다', async () => {
  const seen = [];
  const client = new HttpClient({token: 'canvas-fixture', learningxAuth: async () => 'lx-fixture', cookies: async url => new URL(url).hostname === 'canvas.ssu.ac.kr' ? 'session=fixture' : '',
    fetchImpl: async (url, options) => {
      seen.push({url: url.href, headers: options.headers});
      if (url.pathname === '/files/1/download') return new Response(null, {status: 302, headers: {location: 'https://commons.ssu.ac.kr/lecture.mp4'}});
      return Response.json([]);
    }});
  await client.json('/api/v1/courses');
  await client.json('/learningx/api/v1/courses/1/modules');
  await client.get('/files/1/download');
  assert.equal(seen[0].headers.Authorization, 'Bearer canvas-fixture');
  assert.equal(seen[1].headers.Authorization, 'Bearer lx-fixture');
  assert.equal(seen[2].headers.Authorization, undefined);
  assert.equal(seen[3].headers.Authorization, undefined);
  assert.equal(seen[3].headers.Cookie, undefined);
});

test('네트워크 예외 메시지에 담긴 URL을 외부 오류에 포함하지 않는다', async () => {
  const client = new HttpClient({fetchImpl: async () => { throw new Error('https://host.invalid/?signed=fixture'); }});
  await assert.rejects(client.json('/api/v1/courses'), error => error.code === 'NETWORK' && !error.message.includes('signed'));
});

test('페이지·리디렉션·재시도 응답의 갱신 쿠키를 다음 요청 전에 반영한다', async () => {
  let value = 'old-fixture', requests = 0;
  const client = new HttpClient({cookies: async () => `session=${value}`, sleep: async () => {},
    receiveCookies: async (url, headers) => { for (const cookie of responseCookies(url, headers)) if (cookie.name === 'session') value = cookie.value; },
    fetchImpl: async (url, options) => {
      requests++;
      assert.equal(options.headers.Cookie, `session=${['old-fixture', 'redirect-fixture', 'retry-fixture'][requests - 1]}`);
      if (requests === 1) return new Response(null, {status: 302, headers: {location: '/files/final', 'set-cookie': 'session=redirect-fixture; Path=/; Secure; HttpOnly'}});
      if (requests === 2) return new Response(null, {status: 503, headers: {'set-cookie': 'session=retry-fixture; Path=/; Secure'}});
      return new Response('done', {headers: {'set-cookie': 'session=final-fixture; Path=/; Secure'}});
    }});
  assert.equal((await client.text('/files/start')).text, 'done');
  assert.equal(value, 'final-fixture');
});

test('응답 쿠키는 학교 범위·만료·기본 경로와 보안 접두사를 지킨다', () => {
  const result = responseCookies('https://canvas.ssu.ac.kr/api/v1/users/self', [
    'session=fixture; Domain=.ssu.ac.kr; Path=/; Max-Age=0; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Secure; HttpOnly; SameSite=None',
    'scoped=fixture; Max-Age=60', 'bad=fixture; Domain=other.invalid', 'bad=fixture; Domain=ac.kr',
    '__Host-invalid=fixture; Domain=.ssu.ac.kr; Secure; Path=/', '__Secure-invalid=fixture',
  ], 1700000000000);
  assert.equal(result.length, 2);
  assert.equal(result[0].domain, '.ssu.ac.kr'); assert.equal(result[0].expires, 1);
  assert.equal(result[0].httpOnly, true); assert.equal(result[0].sameSite, 'None');
  assert.equal(result[1].path, '/api/v1/users'); assert.equal(result[1].expires, 1700000060);
  assert.deepEqual(responseCookies('https://cdn.invalid/file', ['session=fixture; Domain=ssu.ac.kr']), []);
});

test('수집 중 만료된 Canvas 인증만 한 번 갱신하고 같은 읽기 요청을 재시도한다', async () => {
  let refreshes = 0, requests = 0;
  const client = new HttpClient({refreshAuth: async () => { refreshes++; return {id: 99}; },
    fetchImpl: async () => ++requests === 1 ? new Response(null, {status: 401}) : Response.json({id: 1})});
  assert.equal((await client.json('/api/v1/courses/1')).data.id, 1);
  assert.equal(refreshes, 1); assert.equal(requests, 2);
  client.fetch = async url => new URL(url).pathname === '/api/v1/users/self' ? Response.json({id: 99}) : new Response(null, {status: 401});
  await assert.rejects(client.json('/api/v1/courses/1'), {code: 'FORBIDDEN', status: 401});
  assert.equal(refreshes, 2);
  await assert.rejects(client.json('/learningx/api/v1/courses/1/modules'), {code: 'AUTH_REQUIRED'});
  assert.equal(refreshes, 2);
  client.fetch = async () => new Response(null, {status: 403});
  await assert.rejects(client.json('/api/v1/courses/1'), {code: 'FORBIDDEN'});
  assert.equal(refreshes, 2);
});

test('401 권한 판정에서도 만료된 로그인·다른 계정·HTML 응답은 계속 실패한다', async () => {
  for (const userResponse of [() => new Response(null, {status: 401}), () => Response.json({id: 100}), () => new Response('<html>login</html>')]) {
    let requests = 0;
    const client = new HttpClient({refreshAuth: async () => ({id: 99}), fetchImpl: async url => {
      requests++;
      return new URL(url).pathname === '/api/v1/users/self' ? userResponse() : new Response(null, {status: 401});
    }});
    await assert.rejects(client.json('/api/v1/courses/1/files'), error => ['AUTH_REQUIRED', 'NOT_JSON'].includes(error.code));
    assert.ok(requests <= 4, '사용자 확인 API가 다시 401이어도 무한 재시도하지 않는다');
  }
});

test('숭실대 영상 CDN만 허용하고 API 토큰을 미디어 서버로 보내지 않는다', async () => {
  const seen = [];
  const client = new HttpClient({token: 'canvas-fixture', learningxAuth: async () => 'lx-fixture',
    cookies: async url => new URL(url).host === 'canvas.ssu.ac.kr' ? 'session=fixture' : '',
    fetchImpl: async (url, options) => { seen.push(options.headers); return new Response('media'); }});
  for (const host of ['ssuin-object.commonscdn.com', 'ssu-toast.commonscdn.com']) {
    const response = await client.get(`https://${host}/media/lecture.mp4`); await response.body.cancel();
  }
  assert.ok(seen.every(headers => !headers.Authorization && !headers.Cookie));
  await assert.rejects(client.get('https://another.commonscdn.com/file.mp4'), {code: 'HOST_NOT_ALLOWED'});
  await assert.rejects(client.get('https://ssuin-object.commonscdn.com.evil.invalid/file.mp4'), {code: 'HOST_NOT_ALLOWED'});
});
