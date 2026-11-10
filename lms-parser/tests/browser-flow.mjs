import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {LmsApp} from '../app-service.mjs';
import {createLocalServer} from '../server.mjs';
import {HttpClient} from '../http.mjs';
import {fixtureFetch} from './fixtures.mjs';
import {collectLms} from '../collect.mjs';

const screenshotDirectory = fileURLToPath(new URL('../.ui-qa/', import.meta.url));
test('실제 브라우저에서 연결→검색·선택→저장→결과·파일 받기와 좁은 화면을 확인한다', async t => {
  const outputBase = await mkdtemp(path.join(os.tmpdir(), 'lms-moa-browser-'));
  const fixture = fixtureFetch(); let authenticated = false, background = false, cleared = false, releaseCollection;
  const collectionGate = new Promise(resolve => { releaseCollection = resolve; });
  const catalog = [{id: 10, name: '오픈소스기초설계', course_code: 'OPEN SOURCE DESIGN', term: {id: 3, name: '2026학년도 2학기'}},
    {id: 20, name: '자료구조', course_code: 'DATA STRUCTURES', term: {id: 3, name: '2026학년도 2학기'}},
    {id: 30, name: '컴퓨터네트워크', course_code: 'COMPUTER NETWORKS', term: {id: 2, name: '2026학년도 1학기'}}];
  const fetchImpl = (url, options) => new URL(url).pathname === '/api/v1/courses' ? Promise.resolve(Response.json(catalog)) : fixture.fetch(url, options);
  const session = {openLogin: async () => {}, checkLogin: async () => authenticated ? {id: 99} : null,
    completeLogin: async () => { authenticated = true; }, focusLogin: async () => {}, close: async () => {},
    useInBackground: async () => { background = true; }, remembered: true};
  const app = new LmsApp({createSession: async () => session, createClient: (_, signal) => new HttpClient({fetchImpl, signal}),
    sessionStore: {clear: async () => { cleared = true; }}, collect: async options => { await collectionGate; return collectLms(options); },
    outputBase, loginInterval: 50, demo: true});
  const opened = [], instance = createLocalServer({app, openDirectory: async dir => opened.push(dir)});
  const url = await instance.listen(0);
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  t.after(async () => { releaseCollection(); await browser.close(); await instance.close(); await rm(outputBase, {recursive: true, force: true}); });
  await mkdir(screenshotDirectory, {recursive: true});
  let page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text()); });
  await page.goto(url); await page.locator('#connect-button').waitFor();
  await page.screenshot({path: path.join(screenshotDirectory, '01-connect.png'), fullPage: true});
  await page.click('#connect-button'); await page.locator('#confirm-login:enabled').waitFor();
  // Automatic detection: the user completes school login in the separate window.
  authenticated = true;
  await page.locator('#selection-panel:not([hidden])').waitFor();
  assert.equal(background, true); assert.match(await page.locator('#courses-description').innerText(), /로그인 유지 중/);
  assert.equal(await page.locator('.course-row').count(), 3);
  assert.equal(await page.locator('#start-button').isDisabled(), true);
  await page.selectOption('#term-filter', '3'); assert.equal(await page.locator('.course-row').count(), 2);
  await page.fill('#course-search', '오픈소스'); assert.equal(await page.locator('.course-row').count(), 1);
  await page.check('#select-all'); assert.equal(await page.locator('#selected-count').innerText(), '1개 선택');
  await page.fill('#course-search', ''); await page.selectOption('#term-filter', '');
  await page.screenshot({path: path.join(screenshotDirectory, '02-courses.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path: path.join(screenshotDirectory, '03-mobile.png'), fullPage: true});
  await page.setViewportSize({width: 1440, height: 1000});
  await page.click('#start-button'); await page.locator('#progress-panel:not([hidden])').waitFor();
  assert.match(await page.locator('#progress-panel').innerText(), /창을 닫아도 저장은 계속/);
  await page.screenshot({path: path.join(screenshotDirectory, '05-background.png'), fullPage: true});
  // Close the entire UI during collection; the server owns the job, not the tab.
  await page.close(); releaseCollection(); await app.jobTask;
  assert.equal(app.state.job.phase, 'complete');
  page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.locator('#result-panel:not([hidden])').waitFor();
  assert.equal(await page.locator('#result-courses').innerText(), '1');
  assert.equal(await page.locator('#result-files').innerText(), '2');
  await page.locator('#result-issues').evaluate(node => { node.open = true; });
  await page.screenshot({path: path.join(screenshotDirectory, '04-result.png'), fullPage: true});
  await page.click('#open-result'); await page.waitForTimeout(150); assert.equal(opened.length, 1);
  const download = page.waitForEvent('download'); await page.click('a[href="/api/files/calendar.ics"]');
  assert.equal((await download).suggestedFilename(), '숭실대 LMS 일정.ics');
  const summaryDownload = page.waitForEvent('download'); await page.click('#summary-download');
  const summary = await summaryDownload;
  assert.equal(summary.suggestedFilename(), 'AI 요약용 원문.txt');
  const chunks = []; for await (const chunk of await summary.createReadStream()) chunks.push(chunk);
  assert.match(Buffer.concat(chunks).toString('utf8'), /설계는 문제 정의부터 시작합니다/);
  // Verify the copy action without reading or changing the user's OS clipboard.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => { window.copiedPromptForTest = value; }}, configurable: true}));
  await page.click('#copy-prompt');
  await page.waitForFunction(() => Boolean(window.copiedPromptForTest));
  assert.match(await page.evaluate(() => window.copiedPromptForTest), /첨부한 요약용 원문 자료/);
  await page.click('#collect-again'); await page.locator('#selection-panel:not([hidden])').waitFor();
  assert.equal(await page.locator('#selected-count').innerText(), '1개 선택');
  await page.getByRole('button', {name: '이용 안내', exact: true}).first().click();
  assert.equal(await page.locator('#help-dialog').evaluate(node => node.open), true);
  await page.click('#help-done');
  await page.click('#disconnect-button'); await page.locator('#connect-idle:not([hidden])').waitFor();
  assert.equal(cleared, true); assert.equal(app.state.remembered, false);
  assert.deepEqual(errors, []);
});
