import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createTimetableServer} from '../server.mjs';
import {LmsCalendarService} from '../lms-service.mjs';
import {HttpClient,collectLms} from '../../lms-parser/index.mjs';
import {fixtureFetch} from '../../lms-parser/tests/fixtures.mjs';
const {chromium}=createRequire(new URL('../../lms-parser/package.json',import.meta.url))('playwright');

test('학교 연결 → 선택 과목 → 캘린더 갱신·재실행·ICS·로그아웃을 실제 브라우저에서 확인한다',{timeout:90000},async t=>{
  const fixture=fixtureFetch(),failures=[];
  let currentUser=99,loggedIn=false,dueAt='2026-11-10T14:59:00Z',gated=false,release=null;
  const app=new LmsCalendarService({loginInterval:10,createSession:async()=>({
    restore:async()=>null,openLogin:async()=>{},checkLogin:async()=>loggedIn?{id:currentUser}:null,
    completeLogin:async()=>{loggedIn=true},useInBackground:async()=>{},save:async()=>{},close:async()=>{},remembered:true,
  }),createClient:(_,signal)=>new HttpClient({signal,fetchImpl:async(url,options)=>{
    const parsed=new URL(url);
    if(parsed.pathname==='/api/v1/users/self')return Response.json({id:currentUser});
    if(parsed.pathname==='/api/v1/courses')return Response.json([
      {id:10,name:'기초설계',course_code:'DESIGN',term:{id:3,name:'2026-2'}},
      {id:20,name:'자료구조',course_code:'DATA',term:{id:3,name:'2026-2'}},
    ]);
    if(parsed.pathname==='/api/v1/courses/10/assignments')return Response.json([{id:20,name:'개인 마감',due_at:dueAt,html_url:'https://canvas.ssu.ac.kr/courses/10/assignments/20'}]);
    return fixture.fetch(url,options);
  }}),collect:async options=>{
    if(gated)await new Promise((resolve,reject)=>{release=resolve;options.client.signal.addEventListener('abort',()=>reject({code:'CANCELLED'}),{once:true})});
    return collectLms(options);
  }});
  const server=createTimetableServer({port:0,bridge:{status:async()=>({connected:false,loginState:'idle'}),close(){}},createLms:async()=>app});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1360,height:1050},acceptDownloads:true});
  t.after(async()=>{await browser.close();await server.closeServices();await new Promise(resolve=>server.close(resolve))});
  let page=await context.newPage();page.on('pageerror',error=>failures.push(error.message));
  await page.emulateMedia({reducedMotion:'reduce'});
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base+'/#calendar');
  await page.locator('#lms-connect:not([disabled])').waitFor();await page.locator('#lms-connect').click();
  await page.locator('#lms-confirm').click();
  await page.locator('#lms-course-picker').waitFor({state:'visible'});
  assert.equal(await page.locator('#lms-courses input:checked').count(),0);
  assert.equal(await page.locator('#lms-sync').isDisabled(),true);
  await page.locator('#lms-search').fill('기초');assert.equal(await page.locator('#lms-courses label').count(),1);
  await page.locator('#lms-courses input[value="10"]').check();await page.locator('#lms-sync').click();
  await page.waitForFunction(()=>document.querySelector('#lms-result-title').textContent.includes('3개'));
  assert.deepEqual(app.state.job.courseIds,['10']);assert.equal(await page.locator('#calendar-date').isVisible(),true);
  await page.locator('#calendar-date').fill('2026-11-10');
  await page.locator('[data-action="calendar-mode"][data-value="day"]').click();
  const deadline=page.locator('[data-calendar-event][aria-label*="개인 마감"]');
  assert.match(await deadline.getAttribute('aria-label'),/23:59 마감/);
  await deadline.click();
  assert.equal(await page.locator('#lms-event-source').getAttribute('href'),'https://canvas.ssu.ac.kr/courses/10/assignments/20');
  await page.locator('#dialog [data-action="close-dialog"]').click();
  await page.locator('#content a[href="#export"]').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-action="download"]').click();
  const download=await downloadPromise,ics=await readFile(await download.path(),'utf8');
  assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,3);assert.match(ics,/DTSTART:20261110T145900Z/);
  await page.evaluate(()=>location.hash='calendar');await page.locator('#lms-sync').waitFor({state:'visible'});
  dueAt='2026-11-12T12:00:00Z';await page.locator('#lms-sync').click();
  await page.waitForFunction(()=>document.querySelector('#lms-result-detail').textContent.includes('변경 1개'));
  assert.equal(await page.locator('#lms-result-title').innerText(),'LMS 일정 3개가 캘린더에 있어요.');
  await page.reload();await page.locator('#lms-result').waitFor({state:'visible'});
  assert.equal(await page.locator('#lms-courses input:checked').count(),1);
  // Existing timetable recommendation remains usable and LMS records survive a semester save.
  await page.evaluate(()=>location.hash='preferences');await page.locator('[data-action="recommend"]').click();
  await page.locator('main[data-route="results"]').waitFor();await page.locator('[data-action="confirm"]:visible').first().click();
  await page.locator('#semester-form [name="start"]').fill('2026-09-01');await page.locator('#semester-form [name="end"]').fill('2026-12-20');
  await page.locator('#semester-form button[type="submit"]').click();await page.locator('main[data-route="saved"]').waitFor();
  await page.evaluate(()=>location.hash='calendar');await page.locator('#calendar-date').waitFor();
  assert.match(await page.locator('#content .heading p').first().innerText(),/LMS 3개/);
  const manualCount=await page.evaluate(()=>JSON.parse(localStorage.getItem('ssu-timetable-planner-v1')).events.length);assert.ok(manualCount>0);
  // Closing the page does not stop the server's collection; reopening imports its result once.
  gated=true;await page.locator('#lms-sync').click();
  await page.waitForFunction(()=>!document.querySelector('#lms-progress').hidden);await page.close();
  assert.ok(release);release();await app.jobTask;gated=false;
  page=await context.newPage();page.on('pageerror',error=>failures.push(error.message));await page.goto(base+'/#calendar');
  await page.locator('#lms-result').waitFor({state:'visible'});
  assert.match(await page.locator('#lms-result-title').innerText(),/3개/);
  const screenshotRoot=fileURLToPath(new URL('../.ui-qa/',import.meta.url));await mkdir(screenshotRoot,{recursive:true});
  await page.screenshot({path:screenshotRoot+'lms-calendar-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:screenshotRoot+'lms-calendar-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#lms-disconnect').click();await page.locator('#lms-result').waitFor({state:'hidden'});
  assert.doesNotMatch(await page.locator('#content .heading p').first().innerText(),/LMS 3개/);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ssu-timetable-planner-v1')).events.length),manualCount);
  currentUser=100;loggedIn=false;await page.locator('#lms-connect').click();await page.locator('#lms-confirm').click();
  await page.locator('#lms-course-picker').waitFor({state:'visible'});
  assert.equal(await page.locator('#lms-result').isVisible(),false);assert.equal(await page.locator('#lms-courses input:checked').count(),0);
  assert.deepEqual(failures,[]);
});

test('브라우저에서 휴강, 충돌 확인, 보강 연결, 분반 변경 미리보기와 개인 일정 보존을 확인한다',{timeout:45000},async t=>{
  const server=createTimetableServer({port:0,bridge:{close(){}},createLms:async()=>({
    resume(){},view:()=>({connection:'disconnected'}),async close(){}
  })});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await server.closeServices();await new Promise(resolve=>server.close(resolve))});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1360,height:1050},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const base='http://127.0.0.1:'+server.address().port;
  const module=await page.request.get(base+'/calendar-logic.mjs');
  assert.equal(module.status(),200);
  assert.match(module.headers()['content-type'],/text\/javascript/);
  const original={id:'db-01',courseId:'db',name:'데이터베이스',building:'정보관',credits:3,meetings:[[0,540,630]]};
  const replacement={...original,id:'db-02',meetings:[[1,540,630]]};
  const candidates=[original,replacement].map((section,i)=>({id:section.id,sections:[section],credits:3,
    strategy:'추천 '+(i+1),metrics:{days:1,dayList:[i],gapMinutes:0}}));
  await page.route('**/api/candidates',route=>route.fulfill({json:{request:route.request().postDataJSON(),candidates}}));
  const saved=()=>page.evaluate(()=>localStorage.getItem('ssu-timetable-planner-v1'));
  const route=async id=>{
    await page.evaluate(id=>location.hash=id,id);
    await page.locator('main[data-route="'+id+'"]').waitFor();
  };
  const action=name=>page.locator('[data-action="'+name+'"]:visible').first();
  const input=name=>page.locator('#event-form [name="'+name+'"]');
  await page.goto(base+'/#preferences');
  await action('recommend').click();
  await page.locator('main[data-route="results"]').waitFor();
  assert.equal(await saved(),null);
  await action('confirm').click();
  await page.locator('#semester-form [name="start"]').fill('2026-10-19');
  await page.locator('#semester-form [name="end"]').fill('2026-11-08');
  await page.locator('#semester-form button[type="submit"]').click();
  await page.locator('main[data-route="saved"]').waitFor();
  const originalId=JSON.parse(await saved()).events[0].id;
  await route('calendar');
  await page.locator('#calendar-date').fill('2026-10-19');
  await page.locator('[data-calendar-event="'+originalId+'"]').click();
  await action('cancel-event').click();
  await page.locator('.calendar-event-cancelled[data-calendar-event="'+originalId+'"]').waitFor();

  await action('add-event').click();
  await input('title').fill('개인 약속');
  await action('save-event').click();
  await page.locator('[data-calendar-event][aria-label*="개인 약속"]').waitFor();
  await action('add-event').click();
  await input('kind').selectOption('makeup');
  await input('originalEventId').selectOption(originalId);
  await input('title').fill('수업 보강');
  await action('save-event').click();
  await page.locator('#dialog').getByText(/개인 약속 \/ 수업 보강|수업 보강 \/ 개인 약속/).waitFor();
  await action('apply-calendar').click();
  await page.locator('[data-calendar-event][aria-label*="수업 보강"]').waitFor();

  const before=await saved();
  await route('results');
  await page.locator('.comparison-card[data-value="1"]').click();
  assert.equal(await saved(),before);
  await action('confirm').click();
  await page.locator('#semester-form [name="effectiveDate"]').fill('2026-10-19');
  await page.locator('#semester-form button[type="submit"]').click();
  const reviews=page.locator('#calendar-review select');
  await reviews.first().waitFor();
  assert.equal(await reviews.count(),2);
  assert.equal(await saved(),before);
  for(const select of await reviews.all())await select.selectOption('keep');
  await page.locator('button[form="calendar-review"]').click();
  assert.equal(await saved(),before);
  await action('apply-calendar').click();
  await page.locator('main[data-route="saved"]').waitFor();
  const result=JSON.parse(await saved());
  assert.equal(result.semester.candidate.sections[0].id,'db-02');
  assert.equal(result.events.find(event=>event.id===originalId).status,'cancelled');
  assert.equal(result.events.find(event=>event.kind==='makeup').originalEventId,originalId);
  assert.equal(result.events.find(event=>event.kind==='personal').title,'개인 약속');
  assert.deepEqual(errors,[]);
});
