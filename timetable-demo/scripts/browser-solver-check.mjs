// Optional browser QA. Set PLAYWRIGHT_MODULE to an installed Playwright module.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],checks=[];
const out=process.env.TIMETABLE_QA_OUTPUT||path.join(os.tmpdir(),'timetable-ortools-qa');
await mkdir(out,{recursive:true});
page.on('pageerror',error=>errors.push(error.message));
let aiCalls=0;page.on('request',r=>{if(r.url().endsWith('/api/status'))aiCalls++});
const check=name=>{checks.push(name);console.log('PASS '+name)};
const route=async name=>{await page.evaluate(name=>location.hash=name,name);await page.locator('main[data-route="'+name+'"]').waitFor()};
const click=async action=>page.locator('[data-action="'+action+'"]:visible').first().click();
const response=route=>page.waitForResponse(r=>r.url().endsWith('/api/'+route)&&r.request().method()==='POST').then(r=>r.json());
const saved=()=>page.evaluate(()=>localStorage.getItem('ssu-timetable-planner-v1'));
try{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(process.env.TIMETABLE_URL||'http://127.0.0.1:4317');await page.locator('main[data-route=start]').waitFor();
  await route('advanced');await page.locator('#ranking-profile').selectOption('compact');
  await page.locator('.disclosure').first().locator('summary').click();
  await page.locator('#attendance-mode').selectOption('exact');await page.locator('#attendance-value').selectOption('3');
  await page.screenshot({path:path.join(out,'mobile-hard-conditions.png'),fullPage:true});
  await route('preferences');const normal=response('candidates');await click('recommend');const strict=await normal;
  await page.locator('main[data-route=empty]').waitFor();assert.equal(strict.solver.original_status,'INFEASIBLE');assert.equal(strict.solver.engine,'ortools-cp-sat');
  check('hard attendance constraint reaches the real solver');
  await click('relax-options');assert.equal(await page.locator('#relax-form input:checked').count(),0);
  await page.locator('#relax-form button[type=submit]').click();assert.ok(await page.locator('#relax-error').textContent());
  await page.locator('#relax-form [name=attendance_days]').check();const relaxedResponse=response('relax');await page.locator('#relax-form button[type=submit]').click();const relaxed=await relaxedResponse;
  assert.equal(relaxed.solver.original_status,'INFEASIBLE');assert.deepEqual(relaxed.solver.minimum_relaxation_cost,[1,1,1]);
  await page.locator('main[data-route=results]').waitFor();assert.match(await page.locator('.condition-changes').textContent(),/3 → 4/);
  assert.equal(await saved(),null);check('explicit relaxation scope, minimal change and unchanged saved state');
  await route('advanced');await page.locator('.disclosure').first().locator('summary').click();assert.equal(await page.locator('#attendance-value').inputValue(),'3');
  await route('results');await page.screenshot({path:path.join(out,'mobile-relaxed-result.png'),fullPage:true});
  await click('confirm');assert.match(await page.locator('dialog .condition-changes').textContent(),/3 → 4/);
  await page.locator('#semester-form [name=start]').fill('2026-09-01');await page.locator('#semester-form [name=end]').fill('2026-12-20');
  await page.locator('#semester-form button[type=submit]').click();await page.locator('main[data-route=saved]').waitFor();const before=await saved();
  check('original form remains unchanged; changed constraints are visible before save');
  await page.locator('.class-block').last().click();const alternativeResponse=response('alternatives');await click('alternative');const alternative=await alternativeResponse;
  await page.locator('main[data-route=results],main[data-route=empty]').waitFor();assert.equal(alternative.solver.mode,'alternative');assert.equal(alternative.request.attendanceDays.value,4);assert.equal(await saved(),before);
  const failed=alternative.solver.normalized_request.baseline.failed_section_ids;
  assert.ok(alternative.candidates.every(c=>c.sections.every(s=>!failed.includes(s.id))));
  check('alternative uses accepted constraints, excludes failed section and preserves calendar');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});await route('advanced');await page.locator('.disclosure').first().evaluate(el=>{el.open=true});
    const dimensions=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.querySelector('.screen-body').clientWidth,scroll:document.querySelector('.screen-body').scrollWidth}));
    assert.ok(dimensions.document<=dimensions.width&&dimensions.scroll<=dimensions.body,JSON.stringify(dimensions));
  }
  await page.screenshot({path:path.join(out,'desktop-hard-conditions.png'),fullPage:true});
  assert.equal(aiCalls,0);assert.deepEqual(errors,[]);check('four widths, no JavaScript errors or AI login calls');
  await writeFile(path.join(out,'report.json'),JSON.stringify({checks,errors,normal:{engine:strict.solver.engine,original_status:strict.solver.original_status},relaxation:{cost:relaxed.solver.minimum_relaxation_cost,count:relaxed.total},alternative:{count:alternative.total,status:alternative.solver.original_status}},null,2));
  console.log(JSON.stringify({passed:checks.length,out}));
}finally{await browser.close()}
