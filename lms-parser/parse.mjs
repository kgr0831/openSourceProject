import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {LmsError} from './errors.mjs';

export function stableId(...parts) {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

export function publicUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    const kept = new URLSearchParams();
    for (const key of ['id', 'course_id', 'module_item_id', 'content_id', 'file_id', 'file_srl', 'document_srl', 'media_id']) {
      const val = url.searchParams.get(key);
      if (val && /^[\w-]{1,100}$/.test(val)) kept.set(key, val);
    }
    url.search = kept.toString(); url.hash = '';
    return url.href;
  } catch { return ''; }
}

export function cleanText(value) {
  return String(value ?? '').replace(/https?:\/\/[^\s<>"')]+/g, url => publicUrl(url))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

export function htmlText(html) {
  const $ = load(String(html ?? ''));
  $('script,style,noscript,form,iframe,object').remove();
  $('br').replaceWith('\n');
  $('p,div,li,h1,h2,h3,h4,section,tr,blockquote').each((_, node) => $(node).append('\n'));
  return cleanText($.root().text().replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n'));
}

export function resourceKind(url, mime = '') {
  let pathname = '';
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { return null; }
  if (/\.(m3u8|mpd)$/.test(pathname)) return 'stream';
  if (/\.(vtt|srt)$/.test(pathname) || /vtt|subrip/.test(mime)) return 'caption';
  if (/\.(mp4|webm|m4v|mov|mp3|m4a|wav|ogg)$/.test(pathname) || /^(video|audio)\//.test(mime)) return 'video';
  if (/\.(pdf|pptx?|docx?|xlsx?|hwp|hwpx|txt|md|csv|zip|ipynb)$/.test(pathname) || /\/files\/\d+(\/(download|preview))?$/.test(pathname)) return 'file';
  return null;
}

export function htmlResources(html, base) {
  const $ = load(String(html ?? '')), result = [];
  $('a[href],video[src],audio[src],source[src],track[src],iframe[src]').each((_, el) => {
    const raw = $(el).attr('href') || $(el).attr('src');
    let url; try { url = new URL(raw, base).href; } catch { return; }
    const kind = el.name === 'track' ? 'caption' : resourceKind(url, $(el).attr('type') || '');
    if (kind) result.push({url, kind, name: cleanText($(el).attr('download') || $(el).text()) || new URL(url).pathname.split('/').pop() || '자료'});
  });
  return result;
}

export function isoDate(value) {
  if (!value || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const day = new Date(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// No guess at a local timezone: ambiguous times remain null and are reported.
export function normalizeLearningX(data, courseId, canvas) {
  const modules = Array.isArray(data) ? data : data?.modules;
  if (!Array.isArray(modules)) throw new LmsError('SCHEMA', 'LearningX 주차 목록 형식이 달라졌습니다.');
  const items = [];
  for (const module of modules) {
    const children = module.module_items ?? module.items;
    if (!Array.isArray(children)) throw new LmsError('SCHEMA', 'LearningX 주차 항목 형식이 달라졌습니다.');
    for (const entry of children) {
      const content = entry.content_data || {}, detail = content.item_content_data || {};
      const contentId = detail.content_id;
      const id = String(entry.module_item_id ?? entry.id ?? stableId(String(module.module_id ?? module.id ?? module.title), String(contentId ?? ''), entry.title || ''));
      const type = detail.content_type || content.content_type || entry.content_type || entry.type || '';
      const rawDue = entry.due_at || content.due_at || detail.due_at;
      const availableAt = isoDate(entry.unlock_at || content.unlock_at || content.start_at);
      items.push({
        id: `learningx:${courseId}:${id}`, kind: /everlec|video|movie/i.test(type) ? 'video' : /quiz|exam/i.test(type) ? 'quiz' : 'material',
        title: cleanText(detail.title || entry.title || '학습 자료'),
        module: cleanText(module.title || module.name), text: htmlText(detail.description || ''),
        sourceUrl: publicUrl(entry.html_url, canvas) || (/^\d+$/.test(id) ? `${canvas}/courses/${courseId}/modules/items/${id}` : `${canvas}/courses/${courseId}/modules`),
        contentId: contentId ? String(contentId) : null,
        contentType: cleanText(type),
        viewUrl: publicUrl(detail.view_url),
        filename: cleanText(detail.file_name),
        dueAt: isoDate(rawDue), dateUnparsed: Boolean(rawDue && !isoDate(rawDue)),
        canvasAssignmentId: content.assignment_id ? String(content.assignment_id) : null,
        availableAt,
        locked: Boolean(entry.locked_for_user || content.locked_for_user || detail.locked_for_user || entry.published === false ||
          (availableAt && Date.parse(availableAt) > Date.now())),
        resources: [],
      });
    }
  }
  return items;
}

export function parseCommons(xml, base) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new LmsError('SCHEMA', '외부 엔터티를 포함한 XML은 처리하지 않습니다.');
  const $ = load(xml, {xml: true});
  const result = [], seen = new Set();
  const contentType = $('content_type').first().text().trim().toLowerCase();
  const document = ['sharedocs', 'document', 'pdf', 'file'].includes(contentType);
  // Fields vary between Commons versions; inspect only media/file fields.
  $('content_download_uri,media_uri,video_uri,audio_uri,subtitle_uri,caption_uri,track_uri').each((_, el) => {
    // sharedocs media_uri points to a rendered document directory, not a video.
    // flash_fallback is a legacy streaming route, not a second downloadable file.
    if ($(el).parents('flash_fallback').length || document && el.name !== 'content_download_uri') return;
    let raw = $(el).text().trim();
    // Some deployments double-encode query separators inside CDATA.
    raw = raw.replace(/&amp;/g, '&');
    let url; try { url = new URL(raw, base).href; } catch { return; }
    if (!raw || seen.has(url)) return;
    const kind = /subtitle|caption|track/.test(el.name) ? 'caption' : resourceKind(url) ||
      (el.name === 'content_download_uri' && !/^(video|movie|everlec)/.test(contentType) ? 'file' : 'video');
    seen.add(url);
    result.push({url, kind, name: new URL(url).pathname.split('/').pop() || kind});
  });
  return result;
}

// Commons' generic file viewer embeds a normal GET download URL in a script
// that sets an iframe src. Extract that literal without executing the viewer,
// its view-count POST, or any other JavaScript. Scope it to this content only.
export function parseCommonsDownloadPage(html, base, contentId) {
  const $ = load(html), result = [], seen = new Set(), candidates = [];
  $('a[href],iframe[src]').each((_, el) => candidates.push($(el).attr('href') || $(el).attr('src')));
  $('script').each((_, el) => {
    for (const match of $(el).text().matchAll(/(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1/g)) {
      const raw = match[2].replace(/\\\//g, '/').replace(/\\(?:u0026|x26)/gi, '&');
      if (/index\.php\?/i.test(raw)) candidates.push(raw);
    }
  });
  for (const raw of candidates) {
    let url;
    try { url = new URL(String(raw).replace(/&amp;/g, '&'), base); } catch { continue; }
    if (url.origin !== new URL(base).origin || url.pathname !== '/index.php' ||
      url.searchParams.get('module') !== 'xn_media_content2013' ||
      url.searchParams.get('act') !== 'dispXn_media_content2013DownloadContent' ||
      url.searchParams.get('content_id') !== String(contentId) || seen.has(url.href)) continue;
    seen.add(url.href);
    result.push({url: url.href, kind: 'file', name: '자료'});
  }
  return result;
}

export function parseCourseLinks(html, canvas) {
  const $ = load(html), courses = new Map();
  $('a[href]').each((_, el) => {
    let url; try { url = new URL($(el).attr('href'), canvas); } catch { return; }
    const match = url.pathname.match(/^\/courses\/(\d+)\/?$/);
    if (url.origin !== canvas || !match) return;
    const title = cleanText($(el).attr('title') || $(el).text());
    if (title) courses.set(match[1], {id: match[1], name: title, course_code: ''});
  });
  return [...courses.values()];
}

export function captionText(text) {
  return cleanText(String(text).replace(/^\uFEFF/, '').replace(/^WEBVTT[^\n]*\n/, '')
    .replace(/^(?:NOTE|STYLE|REGION)(?:[^\n]*)\n[\s\S]*?(?:\n\s*\n|$)/gm, '').split(/\r?\n/)
    .filter(line => !/^\s*\d+\s*$/.test(line) && !line.includes('-->') && !/^(NOTE|STYLE|REGION)(\s|$)/.test(line))
    .map(line => htmlText(line)).filter(Boolean).filter((line, index, all) => line !== all[index - 1]).join('\n'));
}

export function parseModuleLinks(html, courseId, canvas) {
  const $ = load(html), items = new Map();
  $('#content a[href],main a[href],.context_module a[href]').each((_, el) => {
    let url; try { url = new URL($(el).attr('href'), canvas); } catch { return; }
    if (url.origin !== canvas || !new RegExp(`^/courses/${courseId}/(pages|assignments|quizzes|files|modules/items|external_tools)/`).test(url.pathname)) return;
    const title = cleanText($(el).text() || $(el).attr('title'));
    if (!title) return;
    const row = $(el).closest('.context_module_item,.ig-row,li');
    const sourceUrl = publicUrl(url.href);
    items.set(sourceUrl, {id: `html:${courseId}:${stableId(sourceUrl)}`, kind: 'material', title,
      sourceUrl, text: htmlText(row.html() || title), dueAt: isoDate(row.find('time[datetime]').first().attr('datetime')),
      dateUnparsed: Boolean(row.find('time[datetime]').first().attr('datetime') && !isoDate(row.find('time[datetime]').first().attr('datetime'))),
      resources: [], locked: row.hasClass('locked')});
  });
  return [...items.values()];
}
