import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createTimetableServer} from '../server.mjs';
import {createSemesterEvents, emptyPlanner, koreanToday} from '../public/planner-core.mjs';
import {storageKey} from '../public/planner.js';

const {chromium} = createRequire(new URL('../../lms-parser/package.json', import.meta.url))('playwright');
const start = '2026-11-09', end = '2026-12-06';
const sections = [
  {id: 'db-01', courseId: 'db', name: '데이터베이스', building: '정보과학관', meetings: [[0, 540, 630], [2, 660, 720]]},
  {id: 'net-01', courseId: 'net', name: '컴퓨터 네트워크', building: '형남공학관', meetings: [[1, 600, 675]]},
  {id: 'ml-01', courseId: 'ml', name: '기계학습', building: '정보과학관', meetings: [[3, 780, 870], [4, 570, 645]]},
  {id: 'math-01', courseId: 'math', name: '이산수학', building: '진리관', meetings: [[0, 840, 915], [3, 600, 660]]}
];
const candidate = {sections, credits: 12};
const classId = 'db-01:2026-11-09:0';

function fixture() {
  return {...emptyPlanner(), semester: {start, end, candidate}, events: createSemesterEvents(candidate, start, end)};
}

async function openCalendar(t, data = fixture(), {lms, ...options} = {}) {
  const server = createTimetableServer({port: 0, bridge: {close() {}}, createLms: async () => ({
    resume() {}, view: lms || (() => ({connection: 'disconnected'})), async close() {}
  })});
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await server.closeServices();
    await new Promise(resolve => server.close(resolve));
  });
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 1440, height: 1050},
    timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce', ...options});
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.text().startsWith('FullCalendar:')) errors.push(message.text());
  });
  t.after(() => assert.deepEqual(errors, []));
  await page.addInitScript(({key, data}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, {key: storageKey, data});
  const base = 'http://127.0.0.1:' + server.address().port;
  await page.goto(base + '/#calendar');
  return {page, base, saved: async () => JSON.parse(await page.evaluate(key => localStorage.getItem(key), storageKey))};
}

test('실제 수업 편집 select에서 대체 시험을 선택하면 원래 수업에 연결된다', {timeout: 20000}, async t => {
  const {page, saved} = await openCalendar(t);
  await page.locator('#semester-calendar').waitFor();
  await page.locator('#calendar-date').fill(start);
  await page.locator('[data-calendar-event="' + classId + '"]').click();
  await page.locator('#event-form [name="kind"]').selectOption('exam');
  await page.locator('[data-action="save-event"]').click();
  await page.locator('#event-dialog').waitFor({state: 'hidden'});
  const state = await saved();
  const exam = state.events.find(event => event.examMode === 'replacement');
  assert.ok(exam, '종류 select를 변경해 저장한 수업은 대체 시험을 생성해야 한다');
  assert.equal(exam.originalEventId, classId);
  const shown = page.locator('[data-calendar-event="' + exam.id + '"]');
  await shown.waitFor();
  assert.match(await shown.innerText(), /대체 시험/);
  assert.equal(await page.locator('[data-calendar-event="' + classId + '"]').count(), 0);
  assert.equal(await page.locator('main').getAttribute('data-route'), 'calendar');
  const classColor = await calendarEvent(page, 'db-01:2026-11-11:1').evaluate(el => getComputedStyle(el).borderInlineStartColor);
  assert.equal(await shown.evaluate(el => getComputedStyle(el).borderInlineStartColor), classColor);
  assert.notEqual(await calendarEvent(page, 'net-01:2026-11-10:0').evaluate(el => getComputedStyle(el).borderInlineStartColor), classColor);
  await screenshot(page, 'calendar-week.png', page.locator('.calendar-surface'));
  await shown.click();
  assert.match(await page.locator('.event-editor-summary').innerText(), /대체 시험.*원래 수업 데이터베이스/);
  await screenshot(page, 'calendar-replacement-exam.png');
});

const calendarEvent = (page, id) => page.locator('[data-calendar-event="' + id + '"]');
const eventField = (page, name) => page.locator('#event-form [name="' + name + '"]');
const action = (page, name) => page.locator('[data-action="' + name + '"]');
const viewMode = (page, mode) => page.locator('[data-action="calendar-mode"][data-value="' + mode + '"]');
const dateInput = page => page.locator('#calendar-date');
const editor = page => page.locator('#event-dialog');
const preview = page => page.locator('#dialog');
const getEvent = (state, id) => state.events.find(event => event.id === id);

async function screenshot(page, name, target = page) {
  const directory = path.resolve(process.env.TIMETABLE_SCREENSHOT_DIR || '.ui-qa');
  await mkdir(directory, {recursive: true});
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.locator('#toast').waitFor({state: 'hidden', timeout: 7000});
  await target.screenshot({path: path.join(directory, name), animations: 'disabled'});
}

async function saveEditor(page) {
  await action(page, 'save-event').click();
  await editor(page).waitFor({state: 'hidden'});
}

test('이름·날짜·시작·종료·장소를 각각 저장하고 한 날짜만 휴강 및 복원한다', {timeout: 25000}, async t => {
  const {page, saved} = await openCalendar(t);
  const id = 'db-01:2026-11-11:1', following = 'db-01:2026-11-18:1';
  await dateInput(page).fill(start);
  const baseline = getEvent(await saved(), following);
  for (const [field, input, expected] of [
    ['title', '데이터베이스 실습', '데이터베이스 실습'], ['date', '2026-11-12', '2026-11-12'],
    ['start', '11:15', 675], ['end', '12:30', 750], ['location', '진리관', '진리관']
  ]) {
    const before = getEvent(await saved(), id);
    await calendarEvent(page, id).click();
    await eventField(page, field).fill(input);
    await saveEditor(page);
    assert.deepEqual(getEvent(await saved(), id), {...before, [field]: expected, exception: true});
  }
  const edited = getEvent(await saved(), id);
  await calendarEvent(page, id).click();
  await action(page, 'cancel-event').click();
  await calendarEvent(page, id).and(page.locator('.calendar-event-cancelled')).waitFor();
  assert.match(await calendarEvent(page, id).innerText(), /휴강/);
  assert.equal(getEvent(await saved(), id).status, 'cancelled');
  assert.deepEqual(getEvent(await saved(), following), baseline);
  await calendarEvent(page, id).click();
  await action(page, 'resume-event').click();
  await editor(page).waitFor({state: 'hidden'});
  assert.deepEqual(getEvent(await saved(), id), edited);
  assert.equal(await dateInput(page).inputValue(), '2026-11-12');
  await page.reload();
  await dateInput(page).fill('2026-11-12');
  assert.match(await calendarEvent(page, id).getAttribute('aria-label'), /데이터베이스 실습.*11:15–12:30.*진리관/);
});

test('월간 필터, 일간 선택, 날짜 이동, 추가와 충돌 확인이 실제 입력에서 작동한다', {timeout: 30000}, async t => {
  const {page, saved} = await openCalendar(t);
  await dateInput(page).fill(start);
  const original = await saved();
  assert.ok((await page.locator('.calendar-surface').boundingBox()).width > 900);
  const friday = page.locator('[data-calendar-lane="2026-11-13"]');
  const slot = page.locator('#semester-calendar [data-time="15:00:00"]').last();
  await slot.scrollIntoViewIfNeeded();
  const [column, row] = await Promise.all([friday.boundingBox(), slot.boundingBox()]);
  await page.mouse.click(column.x + column.width / 2, row.y + row.height / 2);
  assert.equal(await eventField(page, 'date').inputValue(), '2026-11-13');
  assert.equal(await eventField(page, 'start').inputValue(), '15:00');
  await action(page, 'close-event').click();
  await action(page, 'add-event').click();
  assert.equal(await eventField(page, 'start').inputValue(), '15:00');
  await eventField(page, 'title').fill('팀 발표 준비');
  await saveEditor(page);
  const personal = (await saved()).events.find(event => event.title === '팀 발표 준비');
  assert.equal(personal.start, 900);

  await dateInput(page).fill('2026-11-10');
  await action(page, 'add-event').click();
  await eventField(page, 'title').fill('조별 과제 회의');
  await eventField(page, 'start').fill('10:15');
  await eventField(page, 'end').fill('11:00');
  const beforeConflict = await saved();
  await action(page, 'save-event').click();
  assert.match(await preview(page).innerText(), /컴퓨터 네트워크.*10:15–11:00/);
  await preview(page).locator('[data-action="close-dialog"]').click();
  assert.equal(await eventField(page, 'title').inputValue(), '조별 과제 회의');
  assert.equal(await eventField(page, 'start').inputValue(), '10:15');
  assert.deepEqual(await saved(), beforeConflict);
  assert.equal(await page.locator('[data-calendar-event][aria-label*="조별 과제 회의"]').count(), 0);
  await action(page, 'save-event').click();
  await action(page, 'apply-calendar').click();
  await editor(page).waitFor({state: 'hidden'});
  const meeting = (await saved()).events.find(event => event.title === '조별 과제 회의');
  await page.waitForFunction(([a, b]) => {
    const rect = id => document.querySelector('[data-calendar-event="'+id+'"]')?.getBoundingClientRect();
    const existing = rect(a), added = rect(b);
    return existing && added && (existing.right <= added.left + 1 || added.right <= existing.left + 1);
  }, ['net-01:2026-11-10:0', meeting.id]);

  await calendarEvent(page, classId).click();
  await action(page, 'cancel-event').click();
  await editor(page).waitFor({state: 'hidden'});
  await action(page, 'add-event').click();
  await eventField(page, 'kind').selectOption('makeup');
  await eventField(page, 'originalEventId').selectOption(classId);
  await eventField(page, 'title').fill('데이터베이스 보강');
  await saveEditor(page);
  assert.equal((await saved()).events.find(event => event.kind === 'makeup').originalEventId, classId);

  await dateInput(page).fill('2026-11-12');
  await action(page, 'add-event').click();
  await eventField(page, 'kind').selectOption('exam');
  await eventField(page, 'courseId').selectOption('net');
  await eventField(page, 'title').fill('네트워크 별도 시험');
  await saveEditor(page);
  const after = await saved();
  const exam = after.events.find(event => event.kind === 'exam');
  assert.equal(exam.examMode, 'additional');
  assert.equal(exam.courseId, 'net');
  const examColor = await calendarEvent(page, exam.id).evaluate(el => getComputedStyle(el).borderInlineStartColor);

  await viewMode(page, 'month').click();
  assert.equal(await dateInput(page).inputValue(), '2026-11-12');
  await calendarEvent(page, 'net-01:2026-11-10:0').waitFor();
  assert.equal(await calendarEvent(page, exam.id).evaluate(el => getComputedStyle(el).borderInlineStartColor), examColor);
  await page.locator('#show-calendar-classes').uncheck();
  await calendarEvent(page, 'net-01:2026-11-10:0').waitFor({state: 'detached'});
  await calendarEvent(page, classId).waitFor();
  await screenshot(page, 'calendar-month.png', page.locator('.calendar-surface'));
  const cell = page.locator('[data-calendar-day="2026-11-12"]');
  await cell.getByRole('link').click();
  assert.equal(await page.locator('#semester-calendar').getAttribute('data-calendar-view'), 'day');
  assert.equal(await dateInput(page).inputValue(), '2026-11-12');
  await calendarEvent(page, exam.id).waitFor();
  assert.equal(await calendarEvent(page, exam.id).evaluate(el => getComputedStyle(el).borderInlineStartColor), examColor);
  await viewMode(page, 'week').click();
  assert.equal(await dateInput(page).inputValue(), '2026-11-12');
  await page.getByRole('button', {name: '다음', exact: true}).click();
  assert.equal(await dateInput(page).inputValue(), '2026-11-19');
  await page.getByRole('button', {name: '이전', exact: true}).click();
  assert.equal(await dateInput(page).inputValue(), '2026-11-12');
  await action(page, 'calendar-today').click();
  assert.equal(await dateInput(page).inputValue(), koreanToday());
  assert.deepEqual(await saved(), after);
  await page.reload();
  await dateInput(page).fill(start);
  await calendarEvent(page, classId).and(page.locator('.calendar-event-cancelled')).waitFor();
  await calendarEvent(page, personal.id).waitFor();
  assert.equal((await saved()).revision, original.revision + 5);
  assert.deepEqual(await saved(), after);
});

test('모바일에서 v1을 읽고 저장 실패 뒤 초안을 다시 저장해 v2로 전환한다', {timeout: 25000}, async t => {
  const {semester, events} = fixture();
  const v1 = {version: 1, semester, experiences: [{id: 'note', title: '수강 기록', body: '기존 내용', courseNames: ['데이터베이스']}],
    events: events.map(({sectionId, ...event}) => event.id === classId ? {...event, status: 'cancelled'} : event)};
  const {page, saved} = await openCalendar(t, v1, {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  await dateInput(page).fill(start);
  await calendarEvent(page, classId).and(page.locator('.calendar-event-cancelled')).waitFor();
  assert.deepEqual(await saved(), v1);
  const noOverflow = () => page.evaluate(() => {
    const host = document.getElementById('semester-calendar');
    return document.documentElement.scrollWidth <= innerWidth && host.scrollWidth <= host.clientWidth + 1;
  });
  assert.ok(await noOverflow());
  await dateInput(page).blur();
  await screenshot(page, 'calendar-mobile-week.png');
  await calendarEvent(page, classId).tap();
  await action(page, 'resume-event').tap();
  await editor(page).waitFor({state: 'hidden'});
  assert.equal((await saved()).version, 2);
  assert.deepEqual((await saved()).experiences, v1.experiences);
  assert.equal(getEvent(await saved(), classId).status, 'active');

  const before = await saved();
  await page.evaluate(key => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key && window.blockPlannerWrite) throw new DOMException('synthetic quota', 'QuotaExceededError');
      return write.call(this, name, value);
    };
    window.blockPlannerWrite = true;
  }, storageKey);
  await calendarEvent(page, classId).tap();
  await eventField(page, 'location').fill('새 강의동');
  await action(page, 'save-event').tap();
  assert.match(await page.locator('#event-error').innerText(), /저장하지 못/);
  assert.deepEqual(await saved(), before);
  assert.match(await calendarEvent(page, classId).getAttribute('aria-label'), /정보과학관/);
  assert.equal(await eventField(page, 'location').inputValue(), '새 강의동');
  await page.evaluate(() => { window.blockPlannerWrite = false; });
  await saveEditor(page);
  assert.equal(getEvent(await saved(), classId).location, '새 강의동');

  await page.setViewportSize({width: 320, height: 740});
  for (const mode of ['month', 'day', 'week']) {
    await viewMode(page, mode).tap();
    assert.ok(await noOverflow(), mode + ' view should fit 320 px');
  }
  await calendarEvent(page, classId).tap();
  assert.equal(await eventField(page, 'location').inputValue(), '새 강의동');
  await action(page, 'close-event').tap();
  await editor(page).waitFor({state: 'hidden'});
});

test('LA 시간대 Chrome에서 LMS 마감·종일·자정 넘는 일정과 편집 중 갱신을 확인한다', {timeout: 25000}, async t => {
  const accountKey = 'a'.repeat(24), courseId = '10', courses = [{id: courseId, name: '설계', termId: '1', termName: '2026-2'}];
  const deadline = {id: 'b'.repeat(24), courseId, title: 'LMS 과제 제출', kind: 'deadline', itemKind: 'assignment',
    startAt: '2026-11-10T14:59:00Z', endAt: null, allDay: false, sourceUrl: 'https://canvas.ssu.ac.kr/courses/10/assignments/20'};
  const allDay = {id: 'c'.repeat(24), courseId, title: 'LMS 발표 기간', kind: 'event',
    startAt: '2026-11-10T15:00:00Z', endAt: '2026-11-12T15:00:00Z', date: '2026-11-11', allDay: true};
  const overnight = {id: 'd'.repeat(24), courseId, title: 'LMS 야간 세미나', kind: 'event',
    startAt: '2026-11-10T14:30:00Z', endAt: '2026-11-10T16:30:00Z', allDay: false};
  let result = {id: 'first', accountKey, collectedAt: '2026-11-10T01:00:00Z', courseIds: [courseId], courses,
    events: [deadline, allDay, overnight], warnings: []};
  const {page, saved} = await openCalendar(t, fixture(), {
    lms: () => ({connection: 'connected', accountKey, courses, result})
  });
  await page.locator('#lms-result').waitFor();
  const event = raw => calendarEvent(page, 'lms:' + accountKey + ':' + raw.id);
  await dateInput(page).fill('2026-11-10');
  await event(deadline).scrollIntoViewIfNeeded();
  const pointBox = await event(deadline).boundingBox();
  assert.ok(pointBox.height <= 18, '마감 시점은 주간에서 짧은 마커로만 표시한다');
  await event(deadline).click();
  assert.equal(await page.locator('#lms-event-source').getAttribute('href'), deadline.sourceUrl);
  await preview(page).locator('[data-action="close-dialog"]').click();
  await viewMode(page, 'day').click();
  assert.match(await event(deadline).getAttribute('aria-label'), /23:59 마감/);
  assert.match(await event(overnight).getAttribute('aria-label'), /23:30–01:30/);
  assert.equal(await event(allDay).count(), 0);
  await event(deadline).click();
  assert.equal(await page.locator('#lms-event-source').getAttribute('href'), deadline.sourceUrl);
  assert.equal(await editor(page).isVisible(), false);
  await preview(page).locator('[data-action="close-dialog"]').click();
  await dateInput(page).fill('2026-11-11');
  await event(overnight).waitFor();
  assert.match(await event(allDay).getAttribute('aria-label'), /종일/);
  await dateInput(page).fill('2026-11-12');
  await event(allDay).waitFor();
  assert.equal(await event(overnight).count(), 0);
  await dateInput(page).fill('2026-11-13');
  await event(allDay).waitFor({state: 'detached'});

  await dateInput(page).fill(start);
  await calendarEvent(page, classId).click();
  await eventField(page, 'title').fill('편집 중인 이름');
  await eventField(page, 'location').fill('편집 중인 장소');
  result = {...result, id: 'second', events: [{...deadline, title: '갱신된 과제 제출'}, allDay, overnight]};
  await page.waitForFunction(() => document.getElementById('lms-result-detail').textContent.includes('변경 1개'));
  assert.equal(await eventField(page, 'title').inputValue(), '편집 중인 이름');
  assert.equal(await eventField(page, 'location').inputValue(), '편집 중인 장소');
  assert.equal((await saved()).revision, 0);
  await saveEditor(page);
  assert.equal(getEvent(await saved(), classId).title, '편집 중인 이름');
  assert.equal(getEvent(await saved(), classId).location, '편집 중인 장소');
});
