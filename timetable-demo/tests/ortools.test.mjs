import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {OrToolsCandidateProvider,ortoolsProvider,solverPython} from '../ortools-provider.mjs';
import {verifySolverResult,scaled} from '../ortools-contract.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const catalog={version:'integration-v1',sections:[
  {section_id:'가-01',course_id:'자료구조',name:'자료구조 실습',term:'2026-2',credits:1.5,meetings:[{day:1,start:600,end:660},{day:3,start:600,end:660}]},
  {section_id:'가-02',course_id:'자료구조',name:'자료구조 실습',term:'2026-2',credits:1.5,meetings:[{day:1,start:660,end:720},{day:3,start:660,end:720}]},
  {section_id:'나-01',course_id:'글쓰기',name:'글쓰기와 소통',term:'2026-2',credits:0.3,meetings:[{day:1,start:780,end:840}]}
]};
const request=()=>({term:'2026-2',catalog_version:catalog.version,constraints:{allowed_weekdays:[3,1],credits:{min:1.8,max:1.8},required_course_ids:['자료구조','글쓰기'],morning:{before_minute:720,unit:'meeting',max:2}},ranking:{mode:'lexicographic',profile:'compact'},selection:{mode:'top_k',k:3},search_options:{time_limit_seconds:5,workers:1,seed:42}});
function command(args,input){return new Promise((resolve,reject)=>{const child=spawn(args[0],args.slice(1),{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));child.stdin.end(input||'')})}

test('ORT001 actual version, missing Python and missing library fail explicitly',async()=>{
  const result=await ortoolsProvider.solve(catalog,request());
  assert.equal(result.engine_version,'9.15.6755');assert.ok(result.phase_results.length>1);
  const missing=new OrToolsCandidateProvider({python:fileURLToPath(new URL('../missing-python',import.meta.url))});
  await assert.rejects(missing.solve(catalog,request()),{code:'ENGINE_UNAVAILABLE'});assert.equal(missing.children.size,0);
  const unavailable=await command([solverPython(),'-S','solver/worker.py'],JSON.stringify({catalog,request:request()}));
  assert.equal(unavailable.code,1);assert.equal(JSON.parse(unavailable.out).error.code,'ENGINE_UNAVAILABLE');
});

test('ORT002/012 real Node worker paths preserve Korean, multiblocks, policies and proofs',async()=>{
  const input=request(),before=structuredClone(input);
  const normal=await ortoolsProvider.solve(catalog,input);
  assert.deepEqual(input,before);assert.equal(normal.credit_scale,10);
  assert.equal(normal.returned_unique_count,2);assert.equal(normal.coverage,'exhaustive');
  assert.ok(normal.recommendations.every(c=>c.validation.original_valid&&c.metrics.morning_meeting_count===2));
  const alternativeRequest={...request(),baseline:{section_ids:['나-01','가-01'],failed_section_ids:['가-01']}};
  alternativeRequest.constraints.locked_section_ids=['나-01'];
  const alternative=await ortoolsProvider.solve(catalog,alternativeRequest,{mode:'alternative'});
  assert.deepEqual(alternative.recommendations[0].section_ids,['가-02','나-01']);
  assert.equal(alternative.recommendations[0].model_metrics.section_changes,2);
  const relaxedRequest=request();relaxedRequest.constraints.morning.max=1;
  relaxedRequest.relaxation_policy={max_changed:1,rules:{morning_limit:{allow:true,step:1,importance:3,allowed_values:[2,3]}}};
  const relaxed=await ortoolsProvider.solve(catalog,relaxedRequest,{mode:'relax'});
  assert.equal(relaxed.original_status,'INFEASIBLE');assert.deepEqual(relaxed.minimum_relaxation_cost,[1,3,1]);
  assert.ok(relaxed.minimality_proven);assert.equal(relaxed.normalized_request.constraints.morning.max,1);
  assert.ok(relaxed.recommendations.every(c=>c.validation.effective_valid&&!c.validation.original_valid&&c.validation.original_violations.includes('H009')));
  for(const result of [normal,alternative,relaxed])assert.ok(result.phase_results.some(p=>p.raw_status==='OPTIMAL'&&p.model_build_id));
});

test('independent Node validation rejects altered metrics, protected conditions and forged sections',async()=>{
  const input=request(),result=await ortoolsProvider.solve(catalog,input);
  for(const mutate of [r=>r.recommendations[0].metrics.total_gap_minutes++,r=>r.recommendations[0].effective_constraints.allowed_weekdays=[1],r=>r.recommendations[0].section_ids=['fake'],r=>{r.phase_results.find(p=>p.objective_value!==null).best_bound+=1}]){
    const tampered=structuredClone(result);mutate(tampered);assert.throws(()=>verifySolverResult(catalog,input,tampered),{code:'ENGINE_VALIDATION_FAILED'});
  }
  assert.equal(scaled(1.8,10),18n);assert.throws(()=>scaled(1.5,1));
});

test('CLI accepts UTF-8 stdin and returns one JSON document without log contamination',async()=>{
  const result=await command([process.execPath,'scripts/solve.mjs'],JSON.stringify({catalog,request:request()}));
  assert.equal(result.code,0,result.err);const body=JSON.parse(result.out);
  assert.equal(body.engine,'ortools-cp-sat');assert.deepEqual(body.recommendations[0].section_ids,['가-02','나-01']);
});

test('worker cancellation closes the process and returns no fallback candidates',async()=>{
  const controller=new AbortController();const provider=new OrToolsCandidateProvider();
  const pending=provider.solve(catalog,request(),{signal:controller.signal});controller.abort();
  await assert.rejects(pending,{code:'ENGINE_CANCELLED'});assert.equal(provider.children.size,0);
});

test('by-credit validation protects each target and separates relaxation proofs',async()=>{
  const c={version:'credits-v1',sections:[{section_id:'A',course_id:'A',term:'2026-2',credits:1.5,meetings:[{day:1,start:600,end:660}]},{section_id:'B',course_id:'B',term:'2026-2',credits:2,meetings:[{day:1,start:720,end:780}]}]};
  const input={term:'2026-2',catalog_version:c.version,constraints:{allowed_weekdays:[1],credits:{min:1.5,max:1.5}},selection:{mode:'by_credit',credit_targets:[1.5,2]},relaxation_policy:{max_changed:1,rules:{credit_range:{allow:true,importance:1,step:0.5,allowed_values:[{min:1.5,max:2}]}}}};
  const result=await ortoolsProvider.solve(c,input,{mode:'relax'});
  assert.deepEqual(result.recommendations.map(c=>c.metrics.credits),[1.5,2]);assert.equal(result.target_results.length,2);
  assert.equal(result.recommendations[1].validation.original_valid,false);
});
