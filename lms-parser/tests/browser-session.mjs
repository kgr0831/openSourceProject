import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {browserSession} from '../browser.mjs';
import {SessionStore} from '../session-store.mjs';

test('실제 Chrome에서 로그인→숨김 전환→암호화 재시작 복원→SSO 갱신을 확인한다', {skip: process.platform !== 'win32'}, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lms-browser-session-test-'));
  const store = new SessionStore({directory});
  let currentCookie = '', sequence = 0, loginPosts = 0, attendanceWrites = 0, userId = 99;
  const loginForm = '<form method="POST" action="/sso"><button id="fixture-login">테스트 로그인</button></form>';
  const server = http.createServer((req, res) => {
    const cookie = req.headers.cookie || '';
    const valid = Boolean(currentCookie && cookie.includes(`fixture_session=${currentCookie}`));
    const renew = () => {
      currentCookie = `synthetic-${++sequence}`;
      res.setHeader('Set-Cookie', [`fixture_session=${currentCookie}; Path=/; HttpOnly; SameSite=Lax`, 'fixture_sso=valid; Path=/; HttpOnly']);
    };
    if (req.url === '/api/v1/users/self') {
      if (!valid) { res.writeHead(401); res.end('{}'); return; }
      renew(); res.setHeader('Content-Type', 'application/json'); res.end('while(1);' + JSON.stringify({id: userId})); return;
    }
    if (req.url === '/sso' && req.method === 'POST') {
      loginPosts++; renew(); res.writeHead(302, {Location: '/courses'}); res.end(); return;
    }
    if (req.url === '/attendance' && req.method === 'POST') { attendanceWrites++; res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/courses' && valid) { res.end('<main>내 과목</main><script>window.ENV={current_user_id:99}</script>'); return; }
    if (req.url === '/courses' && cookie.includes('fixture_sso=valid')) { res.end(loginForm + '<script>document.forms[0].submit()</script>'); return; }
    if (req.url === '/courses/10/modules' && valid) {
      res.end('<main>테스트 주차 목록</main><script>fetch("/attendance",{method:"POST"}).catch(()=>{})</script>'); return;
    }
    res.end(loginForm);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const launches = [], sessions = [];
  const create = async () => {
    const session = await browserSession({channel: 'chrome', canvas: origin, portal: origin, store,
      launch: async options => {
        // Exercise the real contexts without showing test windows on the desktop.
        const browser = await chromium.launch({...options, headless: true});
        launches.push({browser, requestedHeadless: options.headless}); return browser;
      }});
    sessions.push(session); return session;
  };
  t.after(async () => {
    for (const session of sessions) await session.close();
    for (const item of launches) await item.browser.close();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  });

  const session = await create();
  assert.equal(await session.restore(), false); assert.equal(launches.length, 0);
  await session.openLogin();
  const loginPage = launches[0].browser.contexts()[0].pages()[0];
  await loginPage.click('#fixture-login');
  await loginPage.waitForFunction(() => window.ENV?.current_user_id === 99);
  assert.equal((await session.checkLogin()).id, 99);
  await session.useInBackground();
  assert.deepEqual(launches.map(item => item.requestedHeadless), [false, true]);
  assert.equal(launches[0].browser.isConnected(), false);
  assert.equal(session.remembered, true);
  await session.close();

  const restored = await create();
  assert.equal(await restored.restore(), true);
  assert.deepEqual(launches.map(item => item.requestedHeadless), [false, true, true]);
  assert.equal((await restored.ensureLogin()).id, 99);
  assert.equal(loginPosts, 1);
  assert.match(await restored.html('/courses/10/modules'), /테스트 주차 목록/);
  assert.equal(attendanceWrites, 0);
  // Force only Canvas's cookie to expire. The normal SSO POST must work after
  // a read-only HTML fallback, without opening another interactive window.
  currentCookie = 'expired-synthetic';
  assert.equal((await restored.ensureLogin())?.id, 99);
  assert.equal(loginPosts, 2); assert.equal(launches.length, 3);
  await restored.save(); assert.equal(restored.remembered, true);
  userId = 100;
  await assert.rejects(restored.ensureLogin(), {code: 'AUTH_REQUIRED'});
});

// A stand-in for the school's sign-in pages with the same shape: a portal link to the SSO form, the form posting
// into a hidden frame, an alert on refusal, and a redirect back through the portal on success.
function schoolFixture() {
  const sessions = new Set(); let sequence = 0, posts = [];
  const page = body => `<!doctype html><meta charset="utf-8">${body}`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'), cookie = (req.headers.cookie || '').match(/fixture_session=([\w-]+)/)?.[1];
    const valid = sessions.has(cookie);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/api/v1/users/self') {
      if (!valid) { res.writeHead(401); res.end('{}'); return; }
      res.setHeader('Content-Type', 'application/json'); res.end('while(1);' + JSON.stringify({id: Number(cookie.split('-')[1])})); return;
    }
    if (url.pathname === '/login') { res.end(page('<div class="login_btn"><a href="/Symtra_sso/smln.asp?apiReturnUrl=%2Fxn-sso%2Fgw-cb.php"><span>통합 로그인</span></a></div>')); return; }
    if (url.pathname === '/Symtra_sso/smln.asp') {
      res.end(page(`<FORM METHOD=POST ACTION="smln_pcs.asp" name="LoginInfo" target="pFrame"><input type="hidden" name="in_tp_bit" value="0" />
        <input type="text" name="userid" id="userid" maxlength="20"/><input type="password" name="pwd" id="pwd" maxlength="20"/>
        <a href="JavaScript:LoginInfoSend('LoginInfo');" class="btn_login">로그인</a></FORM>
        <IFRAME id="pFrame" style="DISPLAY:none;" name="pFrame"></IFRAME>
        <script>function LoginInfoSend(x){var f=document[x];if(f.userid.value==""||f.pwd.value=="")return;f.submit();}</script>`)); return;
    }
    if (url.pathname === '/Symtra_sso/smln_pcs.asp' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body); posts.push(form.get('userid'));
      if (form.get('pwd') !== 'right-' + form.get('userid')) { res.end(page('<script>alert("아이디와 비밀번호가 일치하지 않거나 잘못되었습니다.");parent.document.LoginInfo.userid.focus();</script>')); return; }
      res.end(page(`<script>parent.location.href="/xn-sso/gw-cb.php?sToken=${form.get('userid')}";</script>`)); return;
    }
    if (url.pathname === '/xn-sso/gw-cb.php') {
      const id = `u-${url.searchParams.get('sToken')}-${++sequence}`; sessions.add(id);
      res.writeHead(302, {'Set-Cookie': `fixture_session=${id}; Path=/; HttpOnly; SameSite=Lax`, Location: '/'}); res.end(); return;
    }
    if (url.pathname === '/courses' && valid) { res.end(page(`<main>내 과목</main><script>window.ENV={current_user_id:${Number(cookie.split('-')[1])}}</script>`)); return; }
    res.end(page('<main>포털</main>'));
  });
  return {server, posts: () => posts};
}

test('실제 Chrome에서 학교 폼에 아이디·비밀번호를 넣어 로그인하고, 거절과 여러 학생의 분리를 확인한다', {skip: process.platform !== 'win32'}, async t => {
  const {sharedBrowser} = await import('../browser.mjs');
  const {server, posts} = schoolFixture();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let opened = null;
  const launch = sharedBrowser(async () => (opened = await chromium.launch({channel: 'chrome', headless: true})));
  const create = () => browserSession({channel: 'chromium', canvas: origin, portal: origin, launch});
  const first = await create(), second = await create();
  t.after(async () => { await first.close(); await second.close(); await opened?.close(); await new Promise(resolve => server.close(resolve)); });

  await assert.rejects(first.passwordLogin({userId: '20201234', password: 'wrong'}), {code: 'CREDENTIALS'});
  await first.passwordLogin({userId: '20201234', password: 'right-20201234'});
  assert.equal((await first.ensureLogin()).id, 20201234);
  // The second student shares the browser process but not the first student's school session.
  assert.equal(opened.contexts().length >= 1, true);
  await second.passwordLogin({userId: '20205678', password: 'right-20205678'});
  assert.equal((await second.ensureLogin()).id, 20205678);
  assert.equal((await first.ensureLogin()).id, 20201234);
  assert.deepEqual(posts(), ['20201234', '20201234', '20205678']);
  await first.close(); assert.equal(opened.isConnected(), true);
  await second.close(); assert.equal(opened.isConnected(), false);
});
