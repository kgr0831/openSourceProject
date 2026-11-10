import {setTimeout as delay} from 'node:timers/promises';
import {LmsError} from './errors.mjs';

export const CANVAS = 'https://canvas.ssu.ac.kr';
export const PORTAL = 'https://lms.ssu.ac.kr';
export const COMMONS = 'https://commons.ssu.ac.kr';
// Exact media hosts published by SSU Commons metadata. Never allow the entire
// CDN domain or attach Canvas/LearningX bearer tokens to these downloads.
export const MEDIA_HOSTS = ['ssuin-object.commonscdn.com', 'ssu-toast.commonscdn.com'];

export class HttpClient {
  constructor({canvas = CANVAS, hosts = [], token, cookies, receiveCookies, refreshAuth, learningxAuth, fetchImpl = fetch,
    sleep = delay, allowHttp = false, timeout = 30000, signal} = {}) {
    this.canvas = new URL(canvas).origin;
    this.hosts = new Set([new URL(canvas).host, 'lms.ssu.ac.kr', 'commons.ssu.ac.kr', ...MEDIA_HOSTS, ...hosts]);
    this.token = token;
    this.cookies = cookies;
    this.receiveCookies = receiveCookies;
    this.refreshAuth = refreshAuth;
    this.learningxAuth = learningxAuth;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.allowHttp = allowHttp;
    this.timeout = timeout;
    this.signal = signal;
  }

  checkedUrl(value, base = this.canvas) {
    let url;
    try { url = new URL(value, base); } catch { throw new LmsError('BAD_URL', '자료 주소가 올바르지 않습니다.'); }
    if ((!this.allowHttp && url.protocol !== 'https:') ||
      !['https:', 'http:'].includes(url.protocol) || url.username || url.password || !this.hosts.has(url.host)) {
      throw new LmsError('HOST_NOT_ALLOWED', '허용 목록 밖의 자료 호스트입니다. 확인 후 --allow-host로 추가하세요.');
    }
    return url;
  }

  async get(value, options = {}) {
    try { return await this.request(value, options); }
    catch (error) {
      this.checkCancelled();
      const url = this.checkedUrl(value);
      if (!this.refreshAuth || !options.api || url.origin !== this.canvas || !url.pathname.startsWith('/api/v1/') ||
        !['AUTH_REQUIRED', 'API_REDIRECT'].includes(error.code)) throw error;
      // A single normal SSO renewal, then retry the same read. Never loop or
      // retry permission failures / LearningX requests under another identity.
      const identity = await this.refreshAuth();
      if (!identity) throw error;
      this.checkCancelled();
      try { return await this.request(value, options); }
      catch (retryError) {
        if (retryError.code !== 'AUTH_REQUIRED' || url.pathname === '/api/v1/users/self') throw retryError;
        // Canvas also returns 401 for a disabled course tab / denied resource.
        // Verify identity through this same HTTP client before interpreting it
        // as a permission error. A genuinely expired login must still stop work.
        const {data: currentUser} = await this.json('/api/v1/users/self');
        if (!/^\d+$/.test(String(currentUser?.id)) || identity.id != null && String(currentUser.id) !== String(identity.id)) throw retryError;
        throw new LmsError('FORBIDDEN', '로그인은 유효하지만 학교에서 이 자료에 대한 접근을 허용하지 않습니다.', retryError.status);
      }
    }
  }

  async request(value, {api = false, timeout = this.timeout} = {}) {
    let url = this.checkedUrl(value);
    this.checkCancelled();
    const signal = this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (api && (url.origin !== this.canvas || !/^\/(api\/v1|learningx\/api\/v1)\//.test(url.pathname))) {
        throw new LmsError('API_REDIRECT', 'API가 로그인 화면 또는 다른 주소로 이동했습니다. 다시 로그인하세요.');
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const headers = {Accept: api ? 'application/json' : '*/*'};
        if (api && url.pathname.startsWith('/api/v1/') && this.token) headers.Authorization = `Bearer ${this.token}`;
        if (api && url.pathname.startsWith('/learningx/') && this.learningxAuth) {
          const token = await this.learningxAuth();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        if (this.cookies) {
          const cookie = await this.cookies(url.href);
          if (cookie) headers.Cookie = cookie;
        }
        let response;
        try { response = await this.fetch(url, {headers, redirect: 'manual', signal}); }
        catch { this.checkCancelled(); throw new LmsError('NETWORK', '연결에 실패했거나 요청 시간이 초과되었습니다.'); }
        try { await this.receiveCookies?.(url.href, response.headers.getSetCookie?.() || []); }
        catch { await response.body?.cancel(); this.checkCancelled(); throw new LmsError('BROWSER_CLOSED', '학교 연결이 끊겼습니다. 다시 연결해 주세요.'); }
        if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
          const retry = response.headers.get('retry-after');
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - Date.now()) / 1000 : 2 ** attempt;
          await response.body?.cancel();
          try { await this.sleep(Math.min(30000, Math.max(250, Number.isFinite(seconds) ? seconds * 1000 : 1000)), undefined, {signal: this.signal}); }
          catch { this.checkCancelled(); throw new LmsError('NETWORK', '다시 연결하지 못했습니다.'); }
          continue;
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) throw new LmsError('REDIRECT', '자료 이동 주소가 없습니다.');
          url = this.checkedUrl(location, url);
          break;
        }
        if (!response.ok) {
          await response.body?.cancel();
          const code = response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'FORBIDDEN' : response.status === 404 ? 'NOT_FOUND' : 'HTTP';
          throw new LmsError(code, `LMS 요청에 실패했습니다 (HTTP ${response.status}).`, response.status);
        }
        return response;
      }
    }
    throw new LmsError('REDIRECT', '자료 이동 횟수를 초과했습니다.');
  }

  async text(value, options = {}) {
    const response = await this.get(value, options);
    try { return {text: await boundedText(response), headers: response.headers}; }
    catch (error) { this.checkCancelled(); throw error; }
  }

  checkCancelled() {
    if (this.signal?.aborted) throw new LmsError('CANCELLED', '사용자가 저장을 중단했습니다.');
  }

  async json(value) {
    const {text, headers} = await this.text(value, {api: true});
    // Canvas prefixes session-authenticated JSON with this anti-XSSI guard.
    const body = text.replace(/^\s*while\s*\(\s*1\s*\)\s*;\s*/, '').replace(/^\s*\)\]\}',?\s*\n/, '');
    if (/^\s*</.test(body)) throw new LmsError('NOT_JSON', 'API 대신 HTML 화면을 받았습니다. 로그인 상태를 확인하세요.');
    try { return {data: JSON.parse(body), headers}; }
    catch { throw new LmsError('NOT_JSON', 'LMS API 응답 형식이 달라졌습니다.'); }
  }

  async list(value) {
    let url = this.checkedUrl(value);
    if (!url.searchParams.has('per_page')) url.searchParams.set('per_page', '100');
    const rows = [], seen = new Set();
    for (let page = 0; page < 200; page++) {
      if (seen.has(url.href)) throw new LmsError('PAGINATION', 'LMS의 다음 페이지 주소가 반복됩니다.');
      seen.add(url.href);
      const {data, headers} = await this.json(url);
      if (!Array.isArray(data)) throw new LmsError('SCHEMA', '목록 API 응답 형식이 달라졌습니다.');
      rows.push(...data);
      const next = nextLink(headers.get('link'));
      if (!next) return rows;
      url = this.checkedUrl(next, url);
    }
    throw new LmsError('PAGINATION', '목록 페이지 제한을 초과했습니다. 과목 범위를 줄여 주세요.');
  }
}

export function nextLink(header = '') {
  for (const match of (header || '').matchAll(/<([^>]+)>\s*;\s*rel\s*=\s*"([^"]+)"/gi)) {
    if (match[2].split(/\s+/).includes('next')) return match[1];
  }
  return null;
}

export async function boundedText(response, limit = 10 * 1024 * 1024) {
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new LmsError('TOO_LARGE', '메타데이터 응답 크기 제한을 초과했습니다.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof LmsError) throw error;
    throw new LmsError('NETWORK', '응답을 끝까지 읽지 못했습니다.');
  }
}
