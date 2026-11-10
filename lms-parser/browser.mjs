import {chromium} from 'playwright';
import {load} from 'cheerio';
import {CANVAS, PORTAL} from './http.mjs';
import {responseCookies} from './session-cookies.mjs';
import {LmsError} from './errors.mjs';

const closedError = () => new LmsError('BROWSER_CLOSED', '학교 연결이 끊겼습니다. 다시 연결해 주세요.');
const authError = () => new LmsError('AUTH_REQUIRED', '학교 로그인이 만료되었습니다. 다시 연결해 주세요.');

export async function browserSession({channel = 'chrome', store, canvas = CANVAS, portal = PORTAL,
  launch = options => chromium.launch(options)} = {}) {
  let browser, context, page, hidden = false, closed = false, authenticated = false;
  let accountId;
  let remembered = false, storageWarning = false, hadSavedLogin = false, saveTimer, saving, closing;

  async function start(headless, storageState) {
    let nextBrowser;
    for (const candidate of channel === 'auto' ? ['chrome', 'msedge'] : [channel]) {
      try { nextBrowser = await launch({channel: candidate === 'chromium' ? undefined : candidate, headless}); break; }
      catch { /* Use a fresh app-only context, never the user's browser profile. */ }
    }
    if (!nextBrowser) throw new LmsError('BROWSER', 'Chrome 또는 Microsoft Edge를 설치한 뒤 다시 연결해 주세요.');
    try {
      if (closed) throw closedError();
      const nextContext = await nextBrowser.newContext({acceptDownloads: false, locale: 'ko-KR', storageState});
      const nextPage = await nextContext.newPage();
      if (closed) throw closedError();
      const previous = browser;
      browser = nextBrowser; context = nextContext; page = nextPage; hidden = headless;
      await previous?.close().catch(() => {});
    } catch (error) { await nextBrowser.close().catch(() => {}); throw error; }
  }

  function requireContext() {
    if (closed || !browser?.isConnected()) throw closedError();
    return context;
  }

  function acceptIdentity(identity) {
    authenticated = false;
    if (!identity) return null;
    if (accountId && accountId !== String(identity.id)) throw authError();
    accountId = String(identity.id); authenticated = true;
    return identity;
  }

  async function apiIdentity() {
    const ctx = requireContext(); let response;
    try {
      response = await ctx.request.get(`${canvas}/api/v1/users/self`, {maxRedirects: 0, timeout: 15000});
      if (response.status() === 403) return 'restricted';
      if (response.status() === 401 || response.status() === 419 || response.status() >= 300 && response.status() < 400) return null;
      if (!response.ok()) throw new LmsError('NETWORK', '학교 연결을 확인하지 못했습니다.');
      const body = (await response.text()).replace(/^\s*while\s*\(\s*1\s*\)\s*;\s*/, '');
      if (/^\s*</.test(body)) return null;
      let data;
      try { data = JSON.parse(body); } catch { return 'restricted'; }
      return /^\d+$/.test(String(data.id)) ? {id: data.id} : null;
    } catch (error) {
      if (error instanceof LmsError) throw error;
      throw new LmsError('NETWORK', '학교 연결을 확인하지 못했습니다.');
    } finally { await response?.dispose().catch(() => {}); }
  }

  async function pageIdentity() {
    for (const tab of requireContext().pages()) {
      if (!tab.url().startsWith(canvas + '/')) continue;
      const id = await tab.evaluate(() => window.ENV?.current_user_id).catch(() => null);
      if (/^\d+$/.test(String(id))) { page = tab; return {id}; }
    }
    return null;
  }

  async function navigateIdentity() {
    if (!page || page.isClosed()) page = await requireContext().newPage();
    try {
      // A normal SSO redirect may renew an expired Canvas cookie silently.
      // Login POSTs are allowed; no passwords are collected or players opened.
      await page.goto(`${canvas}/courses`, {waitUntil: 'domcontentloaded', timeout: 30000});
      await page.waitForFunction(() => /^\d+$/.test(String(window.ENV?.current_user_id)), undefined, {timeout: 10000});
      return await pageIdentity();
    } catch {
      if (!browser?.isConnected() || closed) throw closedError();
      return null;
    }
  }

  const session = {
    get remembered() { return remembered; },
    get storageWarning() { return storageWarning; },
    get hadSavedLogin() { return hadSavedLogin; },
    async restore() {
      if (!store) return false;
      let state;
      try { state = await store.load(); }
      catch { storageWarning = true; hadSavedLogin = true; return false; }
      if (!state) return false;
      hadSavedLogin = true;
      await start(true, state);
      if (!await session.ensureLogin()) return false;
      return true;
    },
    async openLogin() {
      let state;
      if (browser?.isConnected()) state = await context.storageState({indexedDB: true});
      await start(false, state);
      try { await page.goto(portal, {waitUntil: 'domcontentloaded'}); }
      catch { throw new LmsError('NETWORK', '학교 로그인 창을 열지 못했습니다. 인터넷 연결을 확인해 주세요.'); }
    },
    async focusLogin() {
      const live = requireContext().pages().filter(tab => !tab.isClosed());
      if (hidden || !live.length) throw closedError();
      await live.at(-1).bringToFront();
    },
    async checkLogin() {
      requireContext();
      if (hidden) return session.ensureLogin();
      if (!context.pages().length) throw closedError();
      const identity = await pageIdentity();
      if (!identity) return null;
      const verified = await apiIdentity();
      const result = verified === 'restricted' ? identity : verified;
      return acceptIdentity(result);
    },
    async completeLogin() {
      if (await session.checkLogin()) return;
      if (!await navigateIdentity() || !await session.checkLogin()) throw authError();
    },
    async ensureLogin() {
      const current = await apiIdentity();
      if (current && current !== 'restricted') return acceptIdentity(current);
      const identity = await navigateIdentity();
      if (!identity) { authenticated = false; return null; }
      const renewed = await apiIdentity();
      const result = renewed === 'restricted' ? identity : renewed;
      return acceptIdentity(result);
    },
    async useInBackground() {
      if (!hidden) {
        const state = await requireContext().storageState({indexedDB: true});
        await start(true, state);
      }
      if (!await session.ensureLogin()) throw authError();
      await session.save();
    },
    async login(waitForUser) {
      await session.openLogin(); await waitForUser(); await session.completeLogin();
      await session.useInBackground();
    },
    async identity() {
      const id = await pageIdentity() || await session.ensureLogin();
      if (!id) throw authError();
      return acceptIdentity(id);
    },
    async html(value) {
      const url = new URL(value, canvas);
      if (url.origin !== canvas || !/^\/courses(?:\/\d+\/modules)?$/.test(url.pathname) || url.search) {
        throw new LmsError('FALLBACK_PATH', '브라우저 대체 수집은 과목·주차 목록만 지원합니다.');
      }
      const ctx = requireContext();
      if (page.isClosed()) page = await ctx.newPage();
      const readOnly = route => ['GET', 'HEAD'].includes(route.request().method()) && route.request().resourceType() !== 'media'
        ? route.continue() : route.abort();
      // Scope this guard to list collection. A permanent POST block used to
      // interfere with SSO while the user was still completing their login.
      await ctx.route('**/*', readOnly);
      try {
        const response = await page.goto(url.href, {waitUntil: 'domcontentloaded'});
        if (!response?.ok() || new URL(page.url()).origin !== canvas) throw new Error();
        await page.locator('#content,main').first().waitFor({timeout: 10000});
        const $ = load(await page.locator('body').innerHTML());
        $('script,style,form,input,meta').remove();
        return $.html();
      } catch { throw new LmsError('FALLBACK_FAILED', '과목 목록을 읽지 못했습니다. 다시 연결해 주세요.'); }
      finally {
        // Stop list-page timers before allowing a later SSO renewal.
        await page.goto('about:blank').catch(() => {});
        await ctx.unroute('**/*', readOnly).catch(() => {});
      }
    },
    async cookies(url) {
      return (await requireContext().cookies(url)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    },
    async receiveCookies(url, headers) {
      const updates = responseCookies(url, headers);
      if (!updates.length) return;
      await requireContext().addCookies(updates);
      if (store && authenticated && !saveTimer) {
        saveTimer = setTimeout(() => { saveTimer = null; void session.save(); }, 1000);
        saveTimer.unref();
      }
    },
    async learningxAuth() {
      return (await requireContext().cookies(`${canvas}/learningx/`)).find(cookie => cookie.name === 'xn_api_token')?.value;
    },
    async save() {
      if (!store || !authenticated || !browser?.isConnected()) return remembered;
      if (saving) { await saving; return session.save(); }
      saving = (async () => {
        try { await store.save(await context.storageState({indexedDB: true})); remembered = true; storageWarning = false; }
        catch { storageWarning = true; remembered = false; }
      })();
      await saving; saving = null;
      return remembered;
    },
    close() {
      if (closing) return closing;
      closed = true; clearTimeout(saveTimer);
      closing = (async () => {
        await session.save();
        await browser?.close().catch(() => {});
      })();
      return closing;
    },
  };
  return session;
}
