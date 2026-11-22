import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createTimetableServer} from '../server.mjs';
import * as scheduler from '../schedule.mjs';
const {chromium}=createRequire(new URL('../../lms-parser/package.json',import.meta.url))('playwright');

test('V2 실제 데이터: 설명 유형·전공교양·출처·현재 학기 필수 선택·저장·모바일', {timeout:45000},async t=>{
  const bridge={close(){},status:async()=>({connected:true,busy:false}),async recommend(payload,schema,{mode}){
    if(payload.goal==='실패 확인')throw new Error('검색 실패 테스트');
    return mode==='career-query'?{model:'mock',data:{keywords:['컴퓨터비전','머신러닝','온디바이스AI','과학기술']}}:
      {model:'mock',data:{evaluations:payload.courses.map(c=>({courseId:c.courseId,relevance:'high',reason:'제공된 과목 근거에 따른 테스트 추천'}))}};
  }};
  const server=createTimetableServer({bridge,port:0});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await server.closeServices();await new Promise(r=>server.close(r))});
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/#career`);
  await page.locator('#career-goal').fill('컴퓨터비전');await page.locator('[data-action="career-evaluate"]').click();
  await page.locator('main[data-route="career-list"]').waitFor();
  assert.equal(await page.locator('.career-columns > section').count(),2);
  assert.match(await page.locator('main').innerText(),/2195과목 검색/);
  assert.match(await page.locator('main').innerText(),/과목명 기반/);
  assert.match(await page.locator('main').innerText(),/이전 과목 설명 참고/);
  const details=page.locator('.career-columns details').first();await details.locator('summary').click();
  assert.ok(await details.locator('a[href^="https://"]').count());
  await page.screenshot({path:'/private/tmp/career-v2-desktop.png',fullPage:false});
  await page.locator('main a[href="#courses"]').click();
  const button=page.locator('[data-action="career-required"]').first();await button.waitFor();
  const id=await button.getAttribute('data-id');assert.ok(id.startsWith('ssu-'));await button.click();
  assert.equal(await button.getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>{location.hash='career-list'});await page.locator('main[data-route="career-list"]').waitFor();
  await page.reload();await page.locator('.career-columns').waitFor();assert.match(await page.locator('main').innerText(),/컴퓨터비전/);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'/private/tmp/career-v2-mobile.png',fullPage:false});
  await page.evaluate(()=>{location.hash='career'});await page.locator('#career-goal').fill('실패 확인');
  await page.locator('[data-action="career-evaluate"]').click();await page.getByText('검색 실패 테스트',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  const meta=await (await fetch(`http://127.0.0.1:${server.address().port}/api/meta`)).json();
  assert.ok(meta.courses.some(c=>c.offerings?.length));assert.equal(meta.catalogInfo.careerDataVersion,scheduler.careerDataVersion);
});
