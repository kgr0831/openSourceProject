import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createTimetableServer} from '../server.mjs';
import {getCourses} from '../catalog.mjs';
import {storageKey} from '../public/planner.js';
import {walkingRouteTimes} from '../public/walking-route-times.mjs';

const {chromium} = createRequire(new URL('../../lms-parser/package.json', import.meta.url))('playwright');
const scope = {term: '2026-2', department: 'AI소프트웨어학부'};
const catalog = getCourses(scope);
const courseId = name => catalog.find(course => course.name === name).id;
const special = '소프트웨어특강2', statistics = '확률및통계', onDevice = '온디바이스AI';
const forensics = '디지털포렌식개론', algorithm = '알고리즘';
const fridaySections = ['ssu-2026-2-2150166901', 'ssu-2026-2-2150163303'];

async function openTestPage(t, mobile, prepareWalkingModule) {
  const server = createTimetableServer({port: 0,
    createLms: async () => ({resume() {}, view: () => ({connection: 'disconnected'}), async close() {}})});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    await server.closeServices();
    await new Promise(resolve => server.close(resolve));
  });
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 1000},
    isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  // Keep the original advisory regression repeatable after local data updates.
  const module = prepareWalkingModule ? await prepareWalkingModule(context)
    : walkingRouteTimes.length ? 'export const walkingRouteTimes = [];' : null;
  if (module) await page.route('**/walking-route-times.mjs', route => route.fulfill({
    contentType: 'text/javascript', body: module
  }));
  await page.goto(url + '/#courses');
  await page.locator('#catalog-term').waitFor();
  assert.equal(await page.locator('#catalog-term').inputValue(), scope.term);
  assert.equal(await page.locator('#catalog-department').inputValue(), scope.department);
  return {page, errors};
}

function actions(page, mobile) {
  const press = locator => mobile ? locator.tap() : locator.click();
  const pick = async name => {
    await page.locator('#course-search').fill(name);
    await press(page.locator('#course-list [data-action="course"][data-id="' + courseId(name) + '"]'));
  };
  const checked = status => page.locator('#course-time-check[data-status="' + status + '"]').waitFor({state: 'attached'});
  return {press, pick, checked};
}

for (const mobile of [false, true]) {
  test('실제 분반의 시간 충돌과 후보별 이동 안내를 조작한다 (' + (mobile ? '모바일 390px 터치' : 'PC 1440px') + ')',
    {timeout: 75000}, async t => {
      const {page, errors} = await openTestPage(t, mobile);
      const {press, pick, checked} = actions(page, mobile);
      const conflict = page.getByRole('region', {name: '수업 시간 충돌'});
      await pick(special);
      await checked('compatible');
      await pick(statistics);
      await checked('conflict');
      await press(page.getByRole('button', {name: '시간 충돌 확인'}));
      assert.equal(await page.locator('#course-time-check').evaluate(el => el === document.activeElement), true);
      assert.match(await conflict.innerText(), /소프트웨어특강2.*확률및통계/s);
      assert.match(await conflict.innerText(), /수요일 10:30~11:45에 겹쳐요/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

      const remove = conflict.getByRole('button', {name: statistics + ' 해제'});
      assert.ok((await remove.boundingBox()).height >= 44);
      await press(remove);
      await conflict.waitFor({state: 'hidden', timeout: 1000});
      await checked('compatible');
      assert.equal(await page.locator('#course-list [data-id="' + courseId(statistics) + '"]').getAttribute('aria-pressed'), 'false');
      await pick(onDevice);
      await checked('compatible');
      assert.equal(await conflict.count(), 0);
      await pick(onDevice);
      await pick(special);

      await pick(forensics);
      await pick(algorithm);
      await checked('compatible');
      await press(page.getByRole('link', {name: '생활 패턴 정하기'}));
      for (const day of [0, 2, 4]) await press(page.locator('label:has(input[data-day="' + day + '"])'));
      await page.locator('#earliestStart').selectOption('600');
      await press(page.getByRole('link', {name: '더 세밀하게 설정하기'}));
      await page.locator('#ranking-profile').selectOption('fewer_days');
      await press(page.getByText('학점 범위 직접 설정', {exact: true}));
      for (const [field, value] of [['total', '6'], ['major', '6'], ['general', '0']]) {
        for (const bound of ['min', 'max']) {
          await page.locator('[data-credit="' + field + '"][data-bound="' + bound + '"]').fill(value);
        }
      }
      await press(page.getByRole('link', {name: '선호 저장하기'}));
      const result = page.waitForResponse(r => r.url().endsWith('/api/candidates'));
      await press(page.getByRole('button', {name: '추천 시간표 보기'}));
      const response = await result;
      assert.equal(response.status(), 200);
      const {candidates} = await response.json();
      const expected = candidates.findIndex(candidate => fridaySections.every(id => candidate.sections.some(section => section.id === id)));
      const alternate = candidates.findIndex(candidate => candidate.sections.some(section =>
        section.courseId === courseId(algorithm) && section.meetings.every(([day]) => day !== 4)));
      assert.ok(expected >= 0, '금요일 두 분반이 포함된 후보');
      assert.ok(alternate >= 0, '다른 요일 분반을 이용하는 후보');
      await page.locator('main[data-route="results"]').waitFor();
      const tab = index => page.locator('[data-action="candidate"][data-value="' + index + '"]:visible');
      const travel = page.getByRole('region', {name: '수업 사이 이동 안내'});
      await press(tab(expected));
      assert.match(await travel.innerText(), /금요일 14:45 → 15:00 · 문화관 → 정보과학관/);
      assert.match(await travel.innerText(), /쉬는 시간 15분이라 이동이 빠듯할 수 있어요/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

      await press(tab(alternate));
      assert.equal(await travel.count(), 0);
      await press(tab(expected));
      await travel.waitFor();
      await press(page.locator('[data-action="confirm"]:visible'));
      await press(page.locator('#semester-form button[type="submit"]'));
      await page.locator('main[data-route="saved"]').waitFor();
      await page.reload();
      await page.locator('main[data-route="saved"]').waitFor();
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
      assert.ok(fridaySections.every(id => saved.semester.candidate.sections.some(section => section.id === id)));
      assert.equal(await travel.count(), 0);
      assert.deepEqual(errors, []);
    });
}

test('빠른 선택 변경과 학기·학과 전환이 이전 시간 확인 응답을 취소한다', {timeout: 40000}, async t => {
  const {page, errors} = await openTestPage(t, false);
  const {pick, checked} = actions(page, false);
  const conflict = page.getByRole('region', {name: '수업 시간 충돌'});
  await pick(special);
  await checked('compatible');

  let routeStarted, release;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { routeStarted = resolve; });
  const pattern = '**/api/course-compatibility';
  const delay = async route => {
    if (route.request().postDataJSON().requiredCourseIds.length !== 2) return route.continue();
    routeStarted();
    await gate;
    await route.continue().catch(() => {});
  };
  await page.route(pattern, delay);
  const aborted = page.waitForEvent('requestfailed', request =>
    request.url().endsWith('/api/course-compatibility') && request.postDataJSON().requiredCourseIds.length === 2);
  try {
    await pick(statistics);
    await waiting;
    await checked('pending');
    await pick(statistics);
    await checked('compatible');
    release();
    await aborted;
    assert.equal(await conflict.count(), 0);
  } finally {
    release();
    await page.unroute(pattern, delay);
  }

  await pick(statistics);
  await checked('conflict');
  for (const [element, value] of [['catalog-term', '2026-1'], ['catalog-department', '경영학부']]) {
    const meta = page.waitForResponse(r => r.url().includes('/api/meta?'));
    await page.locator('#' + element).selectOption(value);
    assert.equal((await meta).status(), 200);
    await page.waitForFunction(id => !document.getElementById(id).disabled, element);
    assert.equal(await conflict.count(), 0);
    await checked('idle');
  }
  assert.deepEqual(errors, []);
});

for (const mobile of [false, true]) {
  test('과목 필터, 목표 학점과 수업시간을 확인한다 (' + (mobile ? '모바일 390px 터치' : 'PC 1440px') + ')',
    {timeout: 85000}, async t => {
      const {page, errors} = await openTestPage(t, mobile);
      const {press, pick, checked} = actions(page, mobile);
      const button = name => page.getByRole('button', {name, exact: true});
      const next = () => press(page.getByRole('link', {name: '생활 패턴 정하기'}));
      const back = () => press(button('이전 화면'));
      const filter = name => press(button(name));
      const goal = page.locator('#target-credits');
      const courseButton = name => page.locator('#course-list [data-id="' + courseId(name) + '"]');
      const timeDetails = name => page.locator('[data-course-time="' + courseId(name) + '"]');
      const meetingCount = (name, count) => timeDetails(name).locator('[data-matching="' + count + '"]').waitFor();
      const checkRequests = [], recommendRequests = [];
      page.on('request', request => {
        if (request.url().endsWith('/api/course-compatibility')) checkRequests.push(request.postDataJSON());
        if (request.url().endsWith('/api/candidates')) recommendRequests.push(request.postDataJSON());
      });
      assert.equal(await button('학점 0.5학점').isVisible(), true);
      assert.equal(await button('학점 6학점').isVisible(), true);
      for (const name of ['전공', '이수구분 선택', '학점 3학점', '대상 학년 4학년']) await filter(name);
      await courseButton(special).waitFor();
      await pick(special);
      await checked('compatible');
      assert.match(await page.locator('#selection-summary').innerText(), /1과목 · 3학점/);
      await page.locator('#course-search').fill('검색결과없음');
      assert.equal(await courseButton(special).count(), 0);
      await filter('필터 초기화');
      assert.equal(await button('전체').getAttribute('aria-pressed'), 'true');
      assert.equal(await courseButton(special).getAttribute('aria-pressed'), 'true');

      for (const name of ['교양', '이수구분 선택', '학점 2학점', '대상 학년 1학년', '대상 학년 2학년']) await filter(name);
      await courseButton('대학생활과진로탐색').waitFor();
      assert.equal(await courseButton(special).count(), 0);
      assert.match(await page.locator('#selection-summary').innerText(), /1과목 · 3학점/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

      const checksBeforePreferences = checkRequests.length;
      const specialRow = timeDetails(special).locator('..');
      await next();
      assert.equal(await goal.inputValue(), '3');
      await meetingCount(special, 0);
      assert.match(await specialRow.locator('.course-time-reason').innerText(), /수요일 수업은 09:00에 시작.*10:00.*09:00까지 앞당겨/);
      await press(timeDetails(special).locator('summary'));
      assert.equal(await timeDetails(special).locator('.section-meetings li').count(), 2);
      await page.locator('#earliestStart').selectOption('540');
      await meetingCount(special, 1);
      assert.equal(await timeDetails(special).getAttribute('open'), '');
      assert.match(await timeDetails(special).locator('.section-meetings').innerText(), /수요일 09:00~10:15.*정보과학관 21303/s);
      await page.locator('#latestEnd').selectOption('690');
      await meetingCount(special, 0);
      assert.match(await specialRow.locator('.course-time-reason').innerText(), /11:45에 끝나요/);
      await page.locator('#latestEnd').selectOption('1080');
      await meetingCount(special, 1);
      assert.equal(checkRequests.length, checksBeforePreferences);
      assert.deepEqual(recommendRequests, []);

      await back();
      await filter('필터 초기화');
      await pick(statistics);
      await checked('conflict');
      await next();
      await meetingCount(statistics, 0);
      assert.match(await timeDetails(statistics).locator('..').locator('.course-time-reason').innerText(), /금요일이 등교 요일에서 빠졌어요/);
      await press(page.locator('label:has(input[data-day="4"])'));
      await meetingCount(statistics, 1);
      await meetingCount(special, 1);
      const joint = page.locator('.course-time-combination');
      assert.match(await joint.innerText(), /수요일 10:30~11:45에 겹쳐요/);
      await press(page.locator('label:has(input[data-day="4"])'));

      await back();
      await pick(statistics);
      await pick(algorithm);
      await pick(onDevice);
      await pick('자료구조');
      await checked('compatible');
      await next();
      assert.equal(await goal.inputValue(), '12');
      assert.equal(await page.locator('#credit-ranges-summary').innerText(), '전공 12 · 교양 0');
      await meetingCount(algorithm, 2);
      const algorithmDetails = timeDetails(algorithm);
      assert.equal(await algorithmDetails.locator('..').locator('.course-time-reason').count(), 0);
      await press(algorithmDetails.locator('summary'));
      assert.equal(await algorithmDetails.locator('.section-time-option').count(), 4);
      assert.equal(await algorithmDetails.locator('.section-meetings li').count(), 8);
      assert.match(await algorithmDetails.innerText(), /2150163304.*금요일 10:30~11:45.*금요일 12:00~13:15/s);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

      await goal.fill('18');
      await back();
      await next();
      assert.equal(await goal.inputValue(), '18');
      const response = page.waitForResponse(r => r.url().endsWith('/api/candidates'));
      await press(button('추천 시간표 보기'));
      const solved = await response;
      assert.equal(solved.status(), 200);
      const required = [special, algorithm, onDevice, '자료구조'].map(courseId).sort();
      assert.deepEqual([...recommendRequests[0].requiredCourseIds].sort(), required);
      assert.deepEqual(recommendRequests[0].credits, {
        total: {min: 18, max: 18}, major: {min: 12, max: 18}, general: {min: 0, max: 6}
      });
      const {candidates} = await solved.json();
      assert.ok(candidates.some(candidate => candidate.credits === 18 &&
        required.every(id => candidate.sections.some(section => section.courseId === id))));
      await page.locator('main[data-route="results"]').waitFor();
      assert.deepEqual(errors, []);
    });
}

test('선택 과목이 수동 목표를 넘을 때 알리고 직접 정한 세부 범위는 보존한다', {timeout: 35000}, async t => {
  const {page, errors} = await openTestPage(t, false);
  const {pick} = actions(page, false);
  const next = () => page.getByRole('link', {name: '생활 패턴 정하기'}).click();
  const goal = page.locator('#target-credits'), message = page.locator('#credit-check');
  await pick(special);
  await next();
  await goal.fill('4');
  await page.getByRole('button', {name: '이전 화면'}).click();
  await pick(algorithm);
  await next();
  assert.equal(await goal.inputValue(), '6');
  assert.match(await message.innerText(), /4학점을 넘어 목표를 6학점으로 올렸어요/);
  await page.getByRole('link', {name: '더 세밀하게 설정하기'}).click();
  await page.getByText('학점 범위 직접 설정', {exact: true}).click();
  await page.getByLabel('전공 최소').fill('0');
  await page.getByLabel('전공 최대').fill('3');
  assert.match(await message.innerText(), /선택한 전공 과목이 6학점.*최대 학점/);
  await page.getByRole('link', {name: '선호 저장하기'}).click();
  assert.equal(await goal.inputValue(), '6');
  assert.match(await page.locator('#credit-ranges-summary').innerText(), /전공 0~3/);
  assert.equal(await page.locator('#recommend-timetable').isDisabled(), true);
  assert.deepEqual(errors, []);
});

test('도보 기록 도구의 기본·추정 내보내기와 실제 후보별 경고·저장을 확인한다', {timeout: 75000}, async t => {
  const reference = JSON.parse(await readFile(new URL('../tools/campus-walk/data/campus-walk.json', import.meta.url), 'utf8'));
  const {page, errors} = await openTestPage(t, false, async context => {
    const recorder = await context.newPage();
    try {
      await recorder.goto(new URL('../tools/campus-walk/walk.html', import.meta.url).href);
      const exportModule = async () => {
        const download = recorder.waitForEvent('download');
        await recorder.getByRole('button', {name: '프로젝트용 파일 받기'}).click();
        const file = await download;
        assert.equal(file.suggestedFilename(), 'walking-route-times.mjs');
        const source = await readFile(await file.path(), 'utf8');
        const rows = JSON.parse(source.split('export const walkingRouteTimes = ')[1].trim().slice(0, -1));
        return {source, rows};
      };
      assert.equal(await recorder.locator('#include-osm').isChecked(), false);
      assert.deepEqual((await exportModule()).rows, []);
      await recorder.locator('#include-osm').check();
      const optional = await exportModule();
      const blocked = new Set(reference.routes.filter(r => r.quality !== 'modeled').map(r => r.from + '|' + r.to));
      assert.equal(blocked.size, 106);
      assert.equal(optional.rows.length, 445);
      assert.ok(optional.rows.every(r => r.sourceKind === 'osm_walk' && r.quality === 'modeled' &&
        !blocked.has(r.from + '|' + r.to) && !(r.from === '문화관' && r.to === '정보과학관')));

      await recorder.locator('#include-osm').uncheck();
      await recorder.locator('#minutes').fill('12');
      await recorder.locator('#evidence').fill('테스트에서만 사용한 가상 확인값');
      await recorder.locator('#save').click();
      const confirmed = (await exportModule()).rows;
      assert.equal(confirmed.length, 1);
      assert.deepEqual([confirmed[0].from, confirmed[0].to, confirmed[0].walkMinutes, confirmed[0].sourceKind],
        ['문화관', '정보과학관', 12, 'naver_walk']);
      await recorder.locator('#switch').click();
      assert.equal(await recorder.locator('#minutes').inputValue(), '');
      return optional.source;
    } finally {
      await recorder.close();
    }
  });
  const {pick, checked} = actions(page, false);
  const warning = page.getByRole('region', {name: '수업 사이 이동 안내'});
  const tab = index => page.locator('[data-action="candidate"][data-value="' + index + '"]:visible');
  await pick('데이터베이스응용');
  await pick('운영체제');
  await checked('compatible');
  assert.equal(await warning.count(), 0);
  await page.getByRole('link', {name: '생활 패턴 정하기'}).click();
  assert.equal(await page.locator('#target-credits').inputValue(), '6');
  assert.equal(await page.locator('#earliestStart').inputValue(), '600');
  assert.equal(await page.locator('#latestEnd').inputValue(), '1080');
  assert.deepEqual(await page.locator('[data-day]:checked').evaluateAll(items => items.map(item => Number(item.dataset.day))), [0, 1, 2, 3]);

  const result = page.waitForResponse(r => r.url().endsWith('/api/candidates'), {timeout: 30000});
  await page.getByRole('button', {name: '추천 시간표 보기'}).click();
  const {candidates} = await (await result).json();
  assert.equal(candidates.length, 3);
  await page.locator('main[data-route="results"]').waitFor();
  const attribution = warning.getByRole('link', {name: /OpenStreetMap contributors/});
  assert.match(await warning.innerText(), /화요일 14:45 → 15:00 · 정보과학관 → 벤처중소기업센터/);
  assert.match(await warning.innerText(), /이동이 빠듯해요/);
  assert.match(await warning.innerText(), /쉬는 시간 15분 · 층 이동 포함 약 14분 · 여유 1분 · 공개 보행로 추정/);
  assert.equal(await attribution.getAttribute('href'), 'https://www.openstreetmap.org/copyright');

  await tab(1).click();
  assert.match(await warning.innerText(), /목요일 14:45 → 15:00/);
  await tab(2).click();
  assert.equal(await warning.count(), 0);
  await tab(0).click();
  await warning.waitFor();
  await page.locator('[data-action="confirm"]:visible').click();
  await page.locator('#semester-form button[type="submit"]').click();
  await page.locator('main[data-route="saved"]').waitFor();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  assert.deepEqual(saved.semester.candidate.sections.map(s => s.id).sort(), candidates[0].sections.map(s => s.id).sort());
  assert.equal(await warning.count(), 0);
  await page.locator('nav a[href="#calendar"]:visible').first().click();
  await page.locator('main[data-route="calendar"]').waitFor();
  assert.equal(await warning.count(), 0);
  assert.deepEqual(errors, []);
});
