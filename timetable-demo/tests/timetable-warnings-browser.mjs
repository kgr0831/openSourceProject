import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createTimetableServer} from '../server.mjs';
import {getCourses} from '../catalog.mjs';
import {storageKey} from '../public/planner.js';

const {chromium} = createRequire(new URL('../../lms-parser/package.json', import.meta.url))('playwright');
const scope = {term: '2026-2', department: 'AI소프트웨어학부'};
const catalog = getCourses(scope);
const courseId = name => catalog.find(course => course.name === name).id;
const special = '소프트웨어특강2', statistics = '확률및통계', onDevice = '온디바이스AI';
const forensics = '디지털포렌식개론', algorithm = '알고리즘';
const fridaySections = ['ssu-2026-2-2150166901', 'ssu-2026-2-2150163303'];

async function openTestPage(t, mobile) {
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
  const page = await browser.newPage({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 1000},
    isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce'});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
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
