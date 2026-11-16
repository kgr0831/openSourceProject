import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createTimetableServer} from '../server.mjs';
import {createPlannerStore, storageKey} from '../public/planner.js';

const {chromium} = createRequire(new URL('../../lms-parser/package.json', import.meta.url))('playwright');

test('진로 추천 저장·필수 선택·재검색 실패와 기존 캘린더 편집이 함께 동작한다', {timeout: 30000}, async t => {
  const memory = new Map();
  const fixture = createPlannerStore({getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value)});
  fixture.setSemester({sections: [{id: 'ml-01', courseId: 'ml', name: '머신러닝', credits: 3,
    building: '정보과학관', meetings: [[0, 600, 660]]}]}, '2026-11-09', '2026-12-06');
  const original = structuredClone(fixture.data), errors = [];
  const bridge = {close() {}, recommend: async payload => {
    if (payload.goal === '실패 확인') throw new Error('진로 검색 실패 테스트');
    return {model: 'test-double', data: {evaluations: payload.courses.map(course => ({
      courseId: course.courseId, relevance: ['ml', 'writing'].includes(course.courseId) ? 'high' : 'uncertain',
      reason: '과목명 기반 테스트 추천'
    }))}};
  }};
  const server = createTimetableServer({port: 0, bridge, createLms: async () => ({
    resume() {}, view: () => ({connection: 'disconnected'}), async close() {}
  })});
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(async () => {await server.closeServices(); await new Promise(resolve => server.close(resolve));});
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 1440, height: 1050}, reducedMotion: 'reduce'});
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({key, data}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, {key: storageKey, data: original});
  const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  const navigate = async route => {
    await page.evaluate(route => {location.hash = route;}, route);
    await page.locator('main[data-route="' + route + '"]').waitFor();
  };
  await page.goto('http://127.0.0.1:' + server.address().port + '/#start');
  await page.locator('.welcome-action a[href="#career"]').click();
  await page.locator('#career-goal').fill('컴퓨터비전');
  await page.locator('[data-action="career-evaluate"]').click();
  await page.locator('main[data-route="career-list"]').waitFor();
  assert.equal(await page.locator('.page-name').innerText(), '진로 추천 과목');
  assert.equal(await page.locator('.career-columns > section').count(), 2);
  const recommendation = (await saved()).careerRecommendations;
  assert.equal(recommendation.goal, '컴퓨터비전');
  assert.deepEqual((await saved()).events, original.events);
  assert.deepEqual((await saved()).history, original.history);

  await page.locator('main a[href="#courses"]').click();
  const required = page.locator('[data-action="career-required"][data-id="ml"]');
  assert.equal(await required.getAttribute('aria-pressed'), 'false');
  await required.click();
  const ordinary = page.locator('[data-action="course"][data-id="ml"]');
  assert.equal(await ordinary.getAttribute('aria-pressed'), 'true');
  await ordinary.click();
  assert.equal(await required.getAttribute('aria-pressed'), 'false');
  await page.locator('details').filter({has: page.locator('[data-exclude="ml"]')}).locator('summary').click();
  await page.locator('[data-exclude="ml"]').check();
  await required.click();
  assert.equal(await page.locator('[data-exclude="ml"]').isChecked(), false);
  assert.equal(await ordinary.getAttribute('aria-pressed'), 'true');

  await navigate('calendar');
  await page.locator('#calendar-date').fill('2026-11-09');
  const eventId = original.events[0].id;
  await page.locator('[data-calendar-event="' + eventId + '"]').click();
  await page.locator('#event-form [name="location"]').fill('진리관');
  await page.locator('[data-action="save-event"]').click();
  await page.locator('#event-dialog').waitFor({state: 'hidden'});
  assert.equal((await saved()).events.find(event => event.id === eventId).location, '진리관');
  assert.deepEqual((await saved()).careerRecommendations, recommendation);
  await page.reload();
  await navigate('career-list');
  assert.match(await page.locator('main .heading p').innerText(), /컴퓨터비전/);
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await navigate('career');
  await page.locator('#career-goal').fill('실패 확인');
  await page.locator('[data-action="career-evaluate"]').click();
  await page.locator('#toast.error').filter({hasText: '진로 검색 실패 테스트'}).waitFor();
  assert.deepEqual((await saved()).careerRecommendations, recommendation);
  await navigate('calendar');
  await page.locator('[data-action="calendar-mode"][data-value="month"]').click();
  await page.locator('#semester-calendar[data-calendar-view="month"]').waitFor();
  assert.deepEqual(errors, []);
});
