import {COMMONS} from './http.mjs';
import {LmsError, publicError} from './errors.mjs';
import {cleanText, htmlText, htmlResources, isoDate, normalizeLearningX, parseCommons,
  parseCourseLinks, parseModuleLinks, parseCommonsDownloadPage, publicUrl, resourceKind, stableId} from './parse.mjs';

const numericId = value => /^\d+$/.test(String(value));

export async function loadCourses({client, browser}) {
  let user, rawCourses;
  const warnings = [];
  try { user = (await client.json('/api/v1/users/self')).data; }
  catch (error) { if (!browser || ['CANCELLED', 'AUTH_REQUIRED', 'BROWSER_CLOSED'].includes(error.code)) throw error; user = await browser.identity(); }
  if (!numericId(user?.id)) throw new LmsError('AUTH_REQUIRED', '로그인한 사용자 ID를 확인하지 못했습니다.');
  try { rawCourses = await client.list('/api/v1/courses?enrollment_state=active&include[]=term&include[]=syllabus_body'); }
  catch (error) {
    if (!browser || ['CANCELLED', 'AUTH_REQUIRED', 'BROWSER_CLOSED'].includes(error.code)) throw error;
    warnings.push({courseId: null, stage: 'courses', ...publicError(error)});
    rawCourses = parseCourseLinks(await browser.html('/courses'), client.canvas);
    if (!rawCourses.length) throw new LmsError('NO_COURSES', '과목 목록을 확인하지 못했습니다. 로그인 또는 API 권한을 확인하세요.');
  }
  return {user, rawCourses, warnings};
}

export async function collectLms({client, browser, courseIds = [], termId, includeMaterials = true, progress = () => {}}) {
  const warnings = [], assets = new Map(), resources = [], fileCache = new Map();
  const canvas = client.canvas;
  async function optional(courseId, stage, work) {
    try { return await work(); }
    catch (error) {
      client.checkCancelled?.();
      if (['CANCELLED', 'BROWSER_CLOSED'].includes(error.code)) throw error;
      if (error.code === 'AUTH_REQUIRED' && !stage.startsWith('learningx') && stage !== 'commons') throw error;
      warnings.push({courseId, stage, ...publicError(error)});
      return null;
    }
  }
  const {user, rawCourses, warnings: catalogWarnings} = await loadCourses({client, browser});
  warnings.push(...catalogWarnings);
  if (termId && catalogWarnings.length) throw new LmsError('TERM_UNKNOWN', '브라우저 목록에는 학기 ID가 없습니다. --course로 과목을 지정하세요.');
  for (const id of courseIds) {
    if (!numericId(id) || !rawCourses.some(course => String(course.id) === String(id))) {
      throw new LmsError('COURSE_NOT_FOUND', '선택한 과목이 현재 사용자 수강 목록에 없습니다. 과목 ID를 확인하세요.');
    }
  }
  const selected = rawCourses.filter(course => numericId(course.id) && course.name &&
    (!courseIds.length || courseIds.includes(String(course.id))) && (!termId || String(course.enrollment_term_id ?? course.term?.id) === termId));
  if (!selected.length) throw new LmsError('NO_COURSES', '선택 조건에 맞는 수강 과목이 없습니다.');

  function addResource(course, item, resource) {
    const sourceUrl = publicUrl(resource.url, canvas);
    if (!sourceUrl) return;
    const id = stableId(course.id, sourceUrl);
    let record = resources.find(row => row.id === id);
    if (!record) {
      record = {id, courseId: course.id, itemIds: [], kind: resource.kind || 'file',
        name: cleanText(resource.name || item.title), sourceUrl,
        status: item.locked || resource.locked ? 'locked' : resource.kind === 'stream' ? 'stream_only' : 'available'};
      resources.push(record);
      if (record.status === 'available') assets.set(id, {url: new URL(resource.url, canvas).href});
    }
    if (!record.itemIds.includes(item.id)) record.itemIds.push(item.id);
    if (!item.resources.includes(id)) item.resources.push(id);
  }

  async function canvasFile(course, item, id) {
    if (!numericId(id)) return;
    if (!fileCache.has(String(id))) fileCache.set(String(id), await optional(course.id, 'file', async () => (await client.json(`/api/v1/files/${id}`)).data));
    const file = fileCache.get(String(id));
    if (file?.url) addResource(course, item, {url: file.url, name: file.display_name || file.filename,
      kind: resourceKind(file.url, file['content-type']) || 'file', locked: file.locked_for_user || file.hidden_for_user});
  }

  async function attachments(course, item, html = '', explicit = []) {
    if (!includeMaterials) return;
    for (const link of [...htmlResources(html, canvas), ...explicit.map(file => ({url: file.url, name: file.display_name || file.filename,
      kind: resourceKind(file.url || '', file['content-type']) || 'file', locked: file.locked_for_user || file.hidden_for_user}))]) {
      let url; try { url = new URL(link.url, canvas); } catch { continue; }
      const fileId = url.origin === canvas && url.pathname.match(/\/files\/(\d+)/)?.[1];
      if (fileId) await canvasFile(course, item, fileId);
      else addResource(course, item, link);
    }
  }

  const courses = [];
  for (const raw of selected) {
    client.checkCancelled?.();
    const id = String(raw.id), prefix = `/api/v1/courses/${id}`;
    const course = {id, name: cleanText(raw.name), code: cleanText(raw.course_code),
      term: raw.term ? {id: String(raw.term.id), name: cleanText(raw.term.name)} : null,
      sourceUrl: `${canvas}/courses/${id}`, items: []};
    courses.push(course);
    progress(`과목 ${courses.length}/${selected.length} 수집 중`, {phase: 'collecting', current: courses.length, total: selected.length, name: course.name});
    if (includeMaterials && raw.syllabus_body) {
      const item = {id: `syllabus:${id}`, kind: 'syllabus', title: '강의계획서', text: htmlText(raw.syllabus_body), sourceUrl: `${course.sourceUrl}/assignments/syllabus`, resources: []};
      course.items.push(item); await attachments(course, item, raw.syllabus_body);
    }
    const assignments = await optional(id, 'assignments', () => client.list(`${prefix}/assignments`));
    for (const row of assignments || []) {
      const item = {id: `assignment:${id}:${row.id}`, kind: row.is_quiz_assignment ? 'quiz' : 'assignment',
        title: cleanText(row.name), text: htmlText(row.description), sourceUrl: publicUrl(row.html_url),
        dueAt: isoDate(row.due_at), dateUnparsed: Boolean(row.due_at && !isoDate(row.due_at)), availableAt: isoDate(row.unlock_at), closesAt: isoDate(row.lock_at),
        locked: Boolean(row.locked_for_user), resources: []};
      // Canvas due_at is already resolved for the authenticated student's overrides.
      course.items.push(item); if (!item.locked) await attachments(course, item, row.description);
    }
    const quizzes = await optional(id, 'quizzes', () => client.list(`${prefix}/quizzes`));
    for (const row of quizzes || []) {
      if (row.assignment_id && (assignments || []).some(assignment => String(assignment.id) === String(row.assignment_id))) continue;
      const item = {id: `quiz:${id}:${row.id}`, kind: 'quiz', title: cleanText(row.title), text: htmlText(row.description),
        dueAt: isoDate(row.due_at), dateUnparsed: Boolean(row.due_at && !isoDate(row.due_at)), sourceUrl: publicUrl(row.html_url), locked: Boolean(row.locked_for_user), resources: []};
      course.items.push(item); if (!item.locked) await attachments(course, item, row.description);
    }
    let modules = [];
    if (includeMaterials) {
      const notices = await optional(id, 'announcements', () => client.list(`${prefix}/discussion_topics?only_announcements=true`));
      for (const row of notices || []) {
        const item = {id: `announcement:${id}:${row.id}`, kind: 'announcement', title: cleanText(row.title),
          text: htmlText(row.message), sourceUrl: publicUrl(row.html_url), publishedAt: isoDate(row.posted_at), resources: []};
        course.items.push(item); await attachments(course, item, row.message, row.attachments || []);
      }
      const pages = await optional(id, 'pages', () => client.list(`${prefix}/pages`));
      for (const page of pages || []) {
        if (page.locked_for_user) continue;
        const row = await optional(id, 'page', async () => (await client.json(`${prefix}/pages/${encodeURIComponent(page.url)}`)).data);
        if (!row || row.locked_for_user) continue;
        const item = {id: `page:${id}:${row.page_id}`, kind: 'page', title: cleanText(row.title), text: htmlText(row.body), sourceUrl: publicUrl(row.html_url), resources: []};
        course.items.push(item); await attachments(course, item, row.body);
      }
      modules = await optional(id, 'modules', () => client.list(`${prefix}/modules`));
      for (const module of modules || []) {
        if (module.state === 'locked') continue;
        const entries = await optional(id, 'module-items', () => client.list(`${prefix}/modules/${module.id}/items`));
        for (const row of entries || []) {
          const item = {id: `module:${id}:${row.id}`, kind: 'module', title: cleanText(row.title), module: cleanText(module.name),
            sourceUrl: publicUrl(row.html_url), text: '', resources: [], locked: Boolean(row.locked_for_user)};
          course.items.push(item);
          if (item.locked) continue;
          if (row.type === 'File') await canvasFile(course, item, row.content_id);
          if (row.type === 'ExternalUrl' && resourceKind(row.external_url || '')) addResource(course, item, {url: row.external_url, name: row.title, kind: resourceKind(row.external_url)});
        }
      }
      const files = await optional(id, 'files', () => client.list(`${prefix}/files`));
      for (const row of files || []) {
        fileCache.set(String(row.id), row);
        const item = {id: `file:${id}:${row.id}`, kind: 'file', title: cleanText(row.display_name || row.filename), text: '',
          sourceUrl: `${course.sourceUrl}/files/${row.id}`, resources: [], locked: Boolean(row.locked_for_user || row.hidden_for_user)};
        course.items.push(item); await canvasFile(course, item, row.id);
      }
    }
    const learningx = await optional(id, 'learningx', async () => normalizeLearningX((await client.json(`/learningx/api/v1/courses/${id}/modules?include_detail=true`)).data, id, canvas));
    for (const item of learningx || []) {
      course.items.push(item);
      if (!includeMaterials || !item.contentId || item.locked) continue;
      const found = await optional(id, 'commons', async () => {
        if (item.contentType === 'file' && item.viewUrl && new URL(item.viewUrl).origin === COMMONS) {
          const {text} = await client.text(item.viewUrl);
          const links = parseCommonsDownloadPage(text, COMMONS, item.contentId);
          if (!links.length) throw new LmsError('NO_MEDIA', 'Commons 파일 다운로드 링크를 찾지 못했습니다.');
          return links;
        }
        const {text} = await client.text(`${COMMONS}/viewer/ssplayer/uniplayer_support/content.php?content_id=${encodeURIComponent(item.contentId)}`);
        const links = parseCommons(text, COMMONS);
        if (!links.length) throw new LmsError('NO_MEDIA', 'Commons에서 직접 다운로드 주소를 찾지 못했습니다.');
        return links;
      });
      for (const resource of found || []) {
        const extension = new URL(resource.url).pathname.match(/\.[a-z0-9]{1,8}$/i)?.[0] || '';
        const videoName = item.title.toLowerCase().endsWith(extension.toLowerCase()) ? item.title : item.title + extension;
        addResource(course, item, {...resource,
          name: resource.kind === 'file' ? item.filename || resource.name : resource.kind === 'video' ? videoName : resource.name});
      }
    }
    if (includeMaterials && (!modules || !learningx) && browser) {
      const fallback = await optional(id, 'html-fallback', async () => parseModuleLinks(await browser.html(`/courses/${id}/modules`), id, canvas));
      for (const item of fallback || []) {
        if (course.items.some(row => row.sourceUrl === item.sourceUrl)) continue;
        course.items.push(item);
        const fileId = new URL(item.sourceUrl).pathname.match(/\/files\/(\d+)/)?.[1];
        if (fileId && !item.locked) await canvasFile(course, item, fileId);
      }
    }
    if (includeMaterials && (!modules || !learningx) && !browser) warnings.push({courseId: id, stage: 'html-fallback', code: 'BROWSER_REQUIRED', message: '이 과목의 보완 수집에는 브라우저 인증으로 다시 실행해야 합니다.', status: null});
    const events = await optional(id, 'calendar', () => client.list(`/api/v1/calendar_events?context_codes[]=course_${id}&type=event&all_events=true`));
    for (const row of events || []) {
      if (row.workflow_state === 'deleted') continue;
      course.items.push({id: `calendar:${id}:${row.id}`, kind: 'event', title: cleanText(row.title), text: htmlText(row.description),
        sourceUrl: publicUrl(row.html_url), startAt: isoDate(row.start_at), endAt: isoDate(row.end_at),
        allDay: Boolean(row.all_day), allDayDate: row.all_day_date || null, location: cleanText(row.location_name), resources: []});
    }
    for (const item of course.items) {
      if (item.dateUnparsed) warnings.push({courseId: id, itemId: item.id, stage: 'date', code: 'AMBIGUOUS_DATE', message: '시간대가 없거나 해석할 수 없는 마감 날짜를 캘린더에서 제외했습니다.', status: null});
    }
  }
  const snapshot = {version: 1, collectedAt: new Date().toISOString(), platform: 'Canvas + LearningX',
    source: canvas, accountKey: stableId(canvas, String(user.id)), courses, resources, warnings};
  return {snapshot, assets};
}
