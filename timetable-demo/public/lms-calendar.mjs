// Calendar-only data. Authentication and download URLs never enter this store.
const dayMs = 86400000;
const accountPattern = /^[a-f0-9]{24}$/;
const fail = () => { throw new Error('LMS 일정 정보를 읽지 못했어요. 다시 가져와 주세요.'); };
const iso = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const nextDay = (value, n = 1) => new Date(Date.parse(value) + n * dayMs).toISOString().slice(0, 10);
const localParts = value => {
  const local = new Date(Date.parse(value) + 9 * 3600000).toISOString();
  return {date: local.slice(0, 10), minute: Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16))};
};
const time = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
function sourceUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.origin !== 'https://canvas.ssu.ac.kr' || url.username || url.password || !/^\/courses\/\d+(?:\/|$)/.test(url.pathname)) return '';
    return url.origin + url.pathname;
  } catch { return ''; }
}

export function validateLmsEvent(event) {
  if (!event || event.source !== 'lms' || event.kind !== 'lms' || !accountPattern.test(event.accountKey) ||
    typeof event.lmsId !== 'string' || !/^[a-f0-9]{24}$/.test(event.lmsId) || event.id !== `lms:${event.accountKey}:${event.lmsId}` ||
    typeof event.courseId !== 'string' || !/^\d+$/.test(event.courseId) ||
    typeof event.title !== 'string' || !event.title.trim() || event.title.length > 250 ||
    typeof event.location !== 'string' || event.location.length > 100 || !day(event.date) || !day(event.endDate) ||
    !['active'].includes(event.status) || !['deadline', 'event'].includes(event.lmsKind) ||
    typeof event.allDay !== 'boolean' || typeof event.point !== 'boolean' ||
    !Number.isInteger(event.start) || !Number.isInteger(event.end) || event.start < 0 || event.start > 1439 || event.end < 0 || event.end > 1440 ||
    event.endDate < event.date || typeof event.sourceUrl !== 'string' || sourceUrl(event.sourceUrl) !== event.sourceUrl) fail();
  if (event.allDay) {
    if (event.endDate <= event.date || event.start !== 0 || event.end !== 1440 || event.point) fail();
  } else {
    if (!iso(event.startAt) || localParts(event.startAt).date !== event.date || localParts(event.startAt).minute !== event.start) fail();
    if (event.point) {
      if (event.endAt !== null || event.date !== event.endDate || event.start !== event.end) fail();
    } else if (!iso(event.endAt) || Date.parse(event.endAt) <= Date.parse(event.startAt) ||
      localParts(event.endAt).date !== event.endDate || localParts(event.endAt).minute !== event.end) fail();
  }
  return event;
}

function normalize(raw, accountKey) {
  if (!raw || typeof raw.title !== 'string' || !['deadline', 'event'].includes(raw.kind)) fail();
  const allDay = raw.allDay === true;
  let date, endDate, start, end, point = false, startAt = null, endAt = null;
  if (allDay) {
    if (!day(raw.date)) fail();
    date = raw.date;
    const days = iso(raw.endAt) && iso(raw.startAt) ? Math.max(1, Math.ceil((Date.parse(raw.endAt) - Date.parse(raw.startAt)) / dayMs)) : 1;
    endDate = nextDay(date, days); start = 0; end = 1440;
  } else {
    if (!iso(raw.startAt)) fail();
    startAt = new Date(raw.startAt).toISOString();
    ({date, minute: start} = localParts(startAt));
    point = raw.kind === 'deadline' || !iso(raw.endAt) || Date.parse(raw.endAt) <= Date.parse(raw.startAt);
    if (point) { endDate = date; end = start; }
    else { endAt = new Date(raw.endAt).toISOString(); ({date: endDate, minute: end} = localParts(endAt)); }
  }
  return validateLmsEvent({id: `lms:${accountKey}:${raw.id}`, lmsId: raw.id, source: 'lms', accountKey,
    courseId: String(raw.courseId), title: raw.title.trim().slice(0, 250), location: String(raw.location || '').slice(0, 100),
    kind: 'lms', lmsKind: raw.kind, itemKind: ['assignment', 'quiz', 'video'].includes(raw.itemKind) ? raw.itemKind : 'event',
    status: 'active', date, endDate, start, end, startAt, endAt, allDay, point, sourceUrl: sourceUrl(raw.sourceUrl)});
}

export function restoreLmsCalendar(value, accountKey) {
  if (!value || value.version !== 1 || !accountPattern.test(accountKey) || value.accountKey !== accountKey ||
    !Array.isArray(value.events) || value.events.length > 5000 || !Array.isArray(value.courses) || value.courses.length > 500 ||
    !Array.isArray(value.selectedCourseIds) || !iso(value.syncedAt) || typeof value.lastResultId !== 'string') fail();
  const courseIds = new Set();
  for (const course of value.courses) {
    if (!/^\d+$/.test(course.id) || typeof course.name !== 'string' || !course.name || courseIds.has(course.id)) fail();
    courseIds.add(course.id);
  }
  if (value.selectedCourseIds.some(id => !courseIds.has(id))) fail();
  const ids = new Set();
  for (const event of value.events) {
    validateLmsEvent(event);
    if (event.accountKey !== accountKey || !courseIds.has(event.courseId) || ids.has(event.id)) fail();
    ids.add(event.id);
  }
  return value;
}

export function mergeLmsCalendar(previous, result) {
  if (!result || !accountPattern.test(result.accountKey) || !Array.isArray(result.courseIds) || !result.courseIds.length ||
    !Array.isArray(result.courses) || !Array.isArray(result.events) || result.events.length > 5000 ||
    !Array.isArray(result.warnings) || typeof result.id !== 'string' || !iso(result.collectedAt)) fail();
  const selected = new Set(result.courseIds);
  if (selected.size !== result.courseIds.length || result.courses.length !== selected.size ||
    result.courses.some(course => !selected.has(course.id) || !/^\d+$/.test(course.id))) fail();
  const old = previous?.accountKey === result.accountKey ? restoreLmsCalendar(previous, result.accountKey) : null;
  const incoming = result.events.map(event => normalize(event, result.accountKey));
  if (new Set(incoming.map(event => event.id)).size !== incoming.length || incoming.some(event => !selected.has(event.courseId))) fail();
  const incomingIds = new Set(incoming.map(event => event.id));
  // A denied/failed source is not evidence that an old deadline was deleted.
  const incomplete = new Set(result.warnings.flatMap(warning => warning.courseId == null ? [...selected] : [warning.courseId]));
  const changes = {added: 0, updated: 0, removed: 0, retained: 0};
  const events = (old?.events || []).filter(event => {
    if (!selected.has(event.courseId)) return true;
    if (incomingIds.has(event.id)) return false;
    if (incomplete.has(event.courseId)) { changes.retained++; return true; }
    changes.removed++; return false;
  });
  const oldById = new Map((old?.events || []).map(event => [event.id, event]));
  for (const event of incoming) {
    if (!oldById.has(event.id)) changes.added++;
    else if (JSON.stringify(oldById.get(event.id)) !== JSON.stringify(event)) changes.updated++;
    events.push(event);
  }
  const courses = new Map((old?.courses || []).map(course => [course.id, course]));
  for (const course of result.courses) courses.set(course.id, {id: course.id, name: course.name});
  const cache = restoreLmsCalendar({version: 1, accountKey: result.accountKey, courses: [...courses.values()], events,
    selectedCourseIds: [...selected], lastResultId: result.id, syncedAt: result.collectedAt}, result.accountKey);
  return {cache, changes};
}

export function occursOnDate(event, date) {
  if (event.source !== 'lms' || event.point) return event.date === date;
  return date >= event.date && (date < event.endDate || (date === event.endDate && !event.allDay && event.end > 0));
}

export function agendaEvents(events, from, to) {
  const rows = [];
  for (let date = from; date <= to; date = nextDay(date)) for (const event of events) {
    if (!occursOnDate(event, date)) continue;
    rows.push(event.source === 'lms' ? {...event, date, start: event.date === date ? event.start : 0,
      end: event.allDay || event.endDate > date ? 1440 : event.end} : event);
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay || false) - Number(a.allDay || false) || a.start - b.start || a.id.localeCompare(b.id));
}

export function lmsTimeLabel(event) {
  if (event.allDay) return '종일';
  if (event.point) return time(event.start) + (event.lmsKind === 'deadline' ? ' 마감' : '');
  return time(event.start) + '–' + time(event.end);
}

export function lmsKindLabel(event) {
  return ({quiz: '시험·퀴즈', video: '강의 마감', assignment: '과제 마감'})[event.itemKind] || (event.lmsKind === 'deadline' ? 'LMS 마감' : 'LMS 일정');
}
