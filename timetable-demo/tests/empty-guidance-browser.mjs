import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {createTimetableServer} from '../server.mjs';
import {ortoolsProvider} from '../ortools-provider.mjs';
import {storageKey} from '../public/planner.js';

const {chromium} = createRequire(new URL('../../lms-parser/package.json', import.meta.url))('playwright');
const oldLast = '현재 필수 조건을 모두 만족하는 시간표가 없습니다. 조건을 직접 조정하거나 허용할 완화 범위를 선택해 주세요.';

async function openPage(t, mobile = false) {
  const server = createTimetableServer({port: 0, createLms: async () => ({
    resume() {}, view: () => ({connection: 'disconnected'}), async close() {}
  })});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await server.closeServices();
    await new Promise(resolve => server.close(resolve));
  });
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: mobile ? {width: 320, height: 568} : {width: 1440, height: 1000},
    isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce'
  });
  const url = 'http://127.0.0.1:' + server.address().port;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(12000);
  const press = locator => mobile ? locator.tap() : locator.click();
  const button = name => page.getByRole('button', {name, exact: true});
  const pick = async name => {
    await page.locator('#course-search').fill(name);
    await press(page.locator('#course-list [data-action="course"]').filter({hasText: name}));
  };
  const next = () => press(page.getByRole('link', {name: '생활 패턴 정하기'}));
  const recommend = async () => {
    const response = page.waitForResponse(r => r.url().endsWith('/api/candidates'), {timeout: 30000});
    await press(button('추천 시간표 보기'));
    return response;
  };
  await page.goto(url + '/#courses');
  await page.locator('#catalog-term').waitFor();
  assert.equal(await page.locator('#catalog-term').inputValue(), '2026-2');
  assert.equal(await page.locator('#catalog-department').inputValue(), 'AI소프트웨어학부');
  return {page, press, button, pick, next, recommend, errors};
}

for (const mobile of [false, true]) {
  test('진단 33줄 뒤에 이유와 검증한 후보를 열 수 있다 ('+(mobile ? '모바일 320px 터치' : 'PC 1440px')+')',
    {timeout: 65000}, async t => {
      const {page, press, button, pick, next, recommend, errors} = await openPage(t, mobile);
      const requestRoutes = [];
      page.on('request', request => {
        if (/\/api\/(?:candidates|relax)$/.test(request.url())) requestRoutes.push(request.url());
      });
      await pick('소프트웨어특강2');
      await next();
      assert.equal(await page.locator('#target-credits').inputValue(), '3');
      assert.equal(await page.locator('#earliestStart').inputValue(), '600');
      const response = await recommend();
      assert.equal(response.status(), 200);
      const result = await response.json();
      assert.equal(result.total, 0);
      assert.equal(result.solver.original_status, 'INFEASIBLE');
      assert.equal(result.solver.diagnostics.length, 33);

      const empty = page.locator('main[data-route="empty"]');
      const diagnostics = empty.locator('.screen-body > .card');
      assert.deepEqual(await diagnostics.locator('> p').allTextContents(), [...result.solver.diagnostics, oldLast]);
      const reasons = empty.getByRole('region', {name: '내 시간표가 나오지 않은 이유'});
      const changes = empty.getByRole('region', {name: '가능한 변경안'});
      assert.ok(await diagnostics.evaluate(el => el.nextElementSibling.matches('.empty-guidance')));
      assert.ok(await reasons.evaluate(el => el.nextElementSibling.getAttribute('aria-labelledby') === 'empty-options-heading'));
      assert.match(await reasons.innerText(), /소프트웨어특강2.*수요일 09:00.*설정한 시작 가능 시각은 10:00/);
      assert.match(await changes.innerText(), /시작 가능 시각 10:00 → 09:00/);
      const [option] = result.emptyGuidance.options;
      assert.equal(option.candidate.requestSnapshot.earliestStart, 540);
      assert.deepEqual(option.candidate.requestSnapshot.requiredCourseIds, result.request.requiredCourseIds);
      assert.deepEqual(option.candidate.requestSnapshot.allowedDays, result.request.allowedDays);
      assert.deepEqual(option.candidate.requestSnapshot.credits, result.request.credits);

      const direct = button('이 조건으로 후보 보기');
      const footer = empty.locator('.action-footer');
      await direct.scrollIntoViewIfNeeded();
      const choiceBox = await direct.boundingBox(), footerBox = await footer.boundingBox();
      assert.ok(choiceBox.y + choiceBox.height <= footerBox.y, '변경안 버튼이 하단 버튼 위에 보여요');
      assert.equal(await page.getByRole('link', {name: '조건 조정하기', exact: true}).isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await press(direct);
      await page.locator('main[data-route="results"] .class-block').first().waitFor();
      assert.match(await page.locator('.timetable-surface').innerText(), /소프트웨어특강2/);
      assert.match(await page.locator('.condition-changes').innerText(), /10:00 → 09:00/);
      assert.equal(requestRoutes.length, 1);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null);

      await page.goBack();
      await empty.waitFor();
      await press(page.getByRole('link', {name: '조건 조정하기', exact: true}));
      assert.equal(await page.locator('#earliestStart').inputValue(), '600');
      assert.equal(await page.locator('#target-credits').inputValue(), '3');
      assert.deepEqual(errors, []);
    });
}

test('등교일 변경안은 기존 완화 결과에서 오며 확인된 후보가 없으면 한 줄을 표시한다',
  {timeout: 65000}, async t => {
    const {page, pick, next, recommend, button, errors} = await openPage(t);
    await pick('알고리즘');
    await next();
    await page.getByRole('link', {name: '더 세밀하게 설정하기'}).click();
    await page.getByText('반드시 지킬 생활 조건', {exact: true}).click();
    await page.locator('#attendance-mode').selectOption('exact');
    await page.locator('#attendance-value').selectOption('3');
    await page.getByRole('link', {name: '선호 저장하기'}).click();
    const response = await recommend();
    const result = await response.json();
    const [option] = result.emptyGuidance.options;
    assert.equal(option.changes[0].condition, 'attendance_days');
    assert.equal(option.changes[0].to, 2);
    assert.equal(option.candidate.solverResult.validation.original_valid, false);
    assert.match(await page.locator('.empty-guidance').innerText(), /등교일을 정확히 3일로 설정.*등교일 3 → 2/s);
    await button('이 조건으로 후보 보기').click();
    await page.locator('main[data-route="results"] .class-block').first().waitFor();
    await page.getByRole('link', {name: '조건 다시 조정하기', exact: true}).click();
    await page.getByRole('link', {name: '더 세밀하게 설정하기'}).click();
    await page.getByText('반드시 지킬 생활 조건', {exact: true}).click();
    assert.equal(await page.locator('#attendance-value').inputValue(), '3');
    await page.locator('#attendance-mode').selectOption('');
    await page.getByRole('link', {name: '선호 저장하기'}).click();

    await button('이전 화면').click();
    await pick('알고리즘');
    await pick('소프트웨어특강2');
    await pick('확률및통계');
    await next();
    await page.locator('label:has(input[data-day="4"])').click();
    await page.locator('#earliestStart').selectOption('540');
    await recommend();
    const reasons = await page.getByRole('region', {name: '내 시간표가 나오지 않은 이유'}).innerText();
    assert.match(reasons, /소프트웨어특강2/);
    assert.match(reasons, /확률및통계/);
    assert.match(reasons, /수요일 10:30~11:45/);
    const changes = page.getByRole('region', {name: '가능한 변경안'});
    assert.equal(await changes.locator('p').innerText(), '검증된 변경안이 없어요.');
    assert.equal(await changes.getByRole('button').count(), 0);
    assert.deepEqual(errors, []);
  });

test('서버 연결 실패와 OR-Tools 오류는 기존 오류 화면으로 가고 UNKNOWN에 원인을 단정하지 않는다',
  {timeout: 45000}, async t => {
    const {page, next, recommend, button, errors} = await openPage(t);
    const url = '**/api/candidates';
    await next();
    await page.route(url, route => route.abort('connectionfailed'));
    await button('추천 시간표 보기').click();
    await page.locator('main[data-route="error"]').waitFor();
    assert.equal(await page.locator('.empty-guidance').count(), 0);
    await page.unroute(url);

    await page.getByRole('link', {name: '조건 확인하기'}).click();
    await page.route(url, route => route.fulfill({json: {request: route.request().postDataJSON(),
      total: 0, candidates: [], diagnostics: ['시간 안에 후보를 찾지 못했어요.'], solver: {original_status: 'UNKNOWN'}}}));
    await recommend();
    await page.locator('main[data-route="empty"]').waitFor();
    assert.equal(await page.locator('.empty-guidance').count(), 0);
    await page.unroute(url);

    await page.getByRole('link', {name: '조건 조정하기'}).click();
    const python = ortoolsProvider.python;
    ortoolsProvider.python = 'missing-ortools-python-for-browser-test';
    try {
      const response = await recommend();
      assert.equal(response.status(), 503);
      assert.equal((await response.json()).code, 'ENGINE_UNAVAILABLE');
      await page.locator('main[data-route="error"]').waitFor();
      assert.match(await page.locator('main .heading').innerText(), /Python 추천 엔진을 시작하지 못했습니다/);
      assert.equal(await page.locator('.empty-guidance').count(), 0);
    } finally {
      ortoolsProvider.python = python;
    }
    assert.deepEqual(errors, []);
  });
