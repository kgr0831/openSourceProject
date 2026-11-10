// Node's streaming downloads use the browser's cookie jar. Apply Set-Cookie
// responses too, so rotating Canvas/SSO sessions do not keep sending old cookies.
export function responseCookies(value, headers, now = Date.now()) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['canvas.ssu.ac.kr', 'lms.ssu.ac.kr', 'commons.ssu.ac.kr'].includes(url.hostname)) return [];
  const cookies = [];
  for (const header of headers) {
    const [pair, ...attributes] = header.split(';'), split = pair.indexOf('=');
    if (split <= 0) continue;
    const name = pair.slice(0, split).trim(), value = pair.slice(split + 1).trim();
    if (!/^[!#$%&'*+\-.^_`|~\da-z]+$/i.test(name) || /[\r\n\0]/.test(value)) continue;
    const attrs = new Map(attributes.map(part => {
      const index = part.indexOf('=');
      return index < 0 ? [part.trim().toLowerCase(), ''] : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
    }));
    const domain = attrs.get('domain')?.replace(/^\./, '').toLowerCase();
    if (domain && (domain !== url.hostname && domain !== 'ssu.ac.kr')) continue;
    const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/';
    const cookie = {name, value, domain: domain ? '.' + domain : url.hostname,
      path: attrs.get('path')?.startsWith('/') ? attrs.get('path') : defaultPath,
      httpOnly: attrs.has('httponly'), secure: attrs.has('secure')};
    const sameSite = {strict: 'Strict', lax: 'Lax', none: 'None'}[attrs.get('samesite')?.toLowerCase()];
    if (sameSite) cookie.sameSite = sameSite;
    const expires = Date.parse(attrs.get('expires'));
    if (Number.isFinite(expires)) cookie.expires = Math.max(1, expires / 1000);
    if (/^-?\d+$/.test(attrs.get('max-age'))) {
      const age = Number(attrs.get('max-age'));
      cookie.expires = age <= 0 ? 1 : Math.min(Math.floor(now / 1000) + age, 253402300799);
    }
    if (name.startsWith('__Secure-') && !cookie.secure) continue;
    if (name.startsWith('__Host-') && (!cookie.secure || domain || cookie.path !== '/')) continue;
    cookies.push(cookie);
  }
  return cookies;
}
