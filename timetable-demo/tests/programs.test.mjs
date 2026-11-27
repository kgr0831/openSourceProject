import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {programSnapshot,programBridge,programNow} from './fixtures/programs.mjs';
import {createProgramSource,prepareProgramData} from '../program-data.mjs';
import {evaluatePrograms} from '../programs.mjs';
import {createProgramStore,programStorageKey,visibleProgramRecommendations,koreanProgramDate,validateProgramList} from '../public/program-model.mjs';
import {createTimetableServer} from '../server.mjs';
import {scheduler} from './fixtures/schedule.mjs';
const clock={now:()=>programNow};
const source=()=>({load:async()=>programSnapshot()});
const memory=()=>{const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};

test('current KST dates override saved open state; upcoming/unlisted/unknown stay separate',()=>{
  const data=prepareProgramData(programSnapshot(),programNow);
  assert.equal(data.meta.openCount,2);assert.equal(data.meta.upcomingCount,1);
  assert.deepEqual(data.programs.map(p=>p.id),['ssu-path:program001','ssu-path:program002','ssu-path:program003']);
  assert.equal(data.programs[1].evidenceType,'name');assert.equal(data.programs[1].description,'');
  assert.equal(koreanProgramDate(new Date('2026-11-25T15:01:00Z')),'2026-11-26');
  const staleBody=programSnapshot();staleBody.programs[0].detail.title='다른 프로그램';
  assert.equal(prepareProgramData(staleBody,programNow).programs[0].evidenceType,'name');
  const unknown=programSnapshot();unknown.programs[2].sourceStatus='신청보류';assert.equal(prepareProgramData(unknown,programNow).meta.upcomingCount,0);
  const oldRow=programSnapshot();oldRow.programs[0].lastSeenAt='2026-11-01T00:00:00Z';assert.throws(()=>prepareProgramData(oldRow,programNow),/갱신/);
});
test('missing, stale, future, partial, malformed and duplicate data cannot masquerade as fresh',()=>{
  assert.equal(prepareProgramData(null,programNow).meta.reason,'missing');
  for(const date of ['2026-11-01T00:00:00Z','2027-01-01T00:00:00Z']){
    const s=programSnapshot();s.collectedAt=date;assert.equal(prepareProgramData(s,programNow).meta.reason,'stale');
  }
  const s=programSnapshot();s.run.outcome='partial';assert.equal(prepareProgramData(s,programNow).meta.reason,'partial');
  s.run.outcome='success';s.programs.push(s.programs[0]);assert.throws(()=>prepareProgramData(s,programNow),/식별/);
  const bad=programSnapshot();bad.programs[0].sourceUrl='javascript:alert(1)';assert.throws(()=>prepareProgramData(bad,programNow),/주소/);
});
test('recommendations use only eligible public evidence; history and private fields never leave client request',async()=>{
  const bridge=programBridge(),list=await evaluatePrograms({goal:'컴퓨터비전',completed:['secret'],note:'private'},bridge,source(),clock);
  assert.equal(list.programs.length,2);assert.equal(list.source,'program-evidence-ai');
  assert.deepEqual(bridge.calls.map(c=>c.mode),['program-query','program']);
  assert.equal(JSON.stringify(bridge.calls).includes('secret'),false);assert.equal(JSON.stringify(bridge.calls).includes('private'),false);
  assert.equal(bridge.calls[1].payload.programs[1].description,'');
  assert.equal(visibleProgramRecommendations(list,prepareProgramData(programSnapshot(),programNow).meta,'2026-11-26').length,2);
  const upcoming=await evaluatePrograms({goal:'AI',includeUpcoming:true},programBridge(),source(),clock);
  assert.equal(upcoming.programs.length,3);
});
test('model fake IDs/duplicate IDs/missing evaluations and invalid keywords are rejected',async()=>{
  for(const evaluations of [[],[{programId:'fake',relevance:'high',reason:'x'},{programId:'fake',relevance:'high',reason:'x'}]]){
    const bridge=programBridge(),original=bridge.recommend;
    bridge.recommend=async(p,s,o)=>o.mode==='program-query'?original.call(bridge,p,s,o):{data:{evaluations}};
    await assert.rejects(evaluatePrograms({goal:'AI'},bridge,source(),clock),/추천/);
  }
  await assert.rejects(evaluatePrograms({goal:'AI'},{recommend:async()=>({data:{keywords:['x']}})},source(),clock),/검색어/);
});
test('data changes during inference, stale data and cancellation do not produce saved recommendations',async()=>{
  let calls=0;const changed={load:async()=>{const s=programSnapshot();if(calls++)s.programs[0].applicationEndDate='2026-12-02';return s}};
  await assert.rejects(evaluatePrograms({goal:'AI'},programBridge(),changed,clock),/변경/);
  const bridge=programBridge();await assert.rejects(evaluatePrograms({goal:'AI'},bridge,{load:async()=>null},clock),/준비/);assert.equal(bridge.calls.length,0);
  const controller=new AbortController();controller.abort();await assert.rejects(evaluatePrograms({goal:'AI'},bridge,source(),{...clock,signal:controller.signal}));assert.equal(bridge.calls.length,0);
});
test('empty eligible inventory skips model; stale stored results are not displayed',async()=>{
  const snapshot=programSnapshot();for(const p of snapshot.programs)p.sourceStatus='신청마감';
  const bridge=programBridge(),list=await evaluatePrograms({goal:'AI'},bridge,{load:async()=>snapshot},clock);
  assert.equal(list.evaluations.length,0);assert.equal(bridge.calls.length,0);
  const saved=await evaluatePrograms({goal:'AI'},programBridge(),source(),clock),meta=prepareProgramData(programSnapshot(),programNow).meta;
  assert.deepEqual(visibleProgramRecommendations(saved,{...meta,dataVersion:'changed'},'2026-11-26'),[]);
  assert.deepEqual(visibleProgramRecommendations(saved,meta,'2026-11-27'),[]);
});
test('program storage persists independently and preserves old list on write failure or another-tab changes',async()=>{
  const mem=memory();mem.setItem('ssu-timetable-planner-v1','private calendar');const store=createProgramStore(mem);
  const list=await evaluatePrograms({goal:'AI'},programBridge(),source(),clock);store.save(list);
  assert.deepEqual(createProgramStore(mem).list,list);assert.equal(mem.getItem('ssu-timetable-planner-v1'),'private calendar');
  const broken=createProgramStore({...mem,setItem(){throw Error('full')}});assert.throws(()=>broken.save({...list,goal:'changed'}));assert.equal(broken.list.goal,'AI');
  mem.setItem(programStorageKey,JSON.stringify({...list,goal:'other tab'}));assert.throws(()=>store.save(list),/다른 탭/);
  const invalid=structuredClone(list);invalid.programs[0].applicationUrl='https://evil.example';assert.throws(()=>validateProgramList(invalid),/프로그램/);
});
test('file source sees atomic updates; missing file is unavailable and malformed JSON is explicit error',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ssu-programs-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'programs.json'),reader=createProgramSource({file});assert.equal(await reader.load(),null);
  await writeFile(file,JSON.stringify(programSnapshot()));assert.equal((await reader.load()).schemaVersion,1);
  await writeFile(file,'broken');await assert.rejects(reader.load(),/읽지/);
});
test('HTTP endpoints preserve local origin protection and expose current data counts without mutating timetables',async t=>{
  const bridge=programBridge(),server=createTimetableServer({scheduler,bridge,port:0,programSource:source(),programNow:()=>programNow});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await server.closeServices();await new Promise(r=>server.close(r))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const meta=await fetch(base+'/api/programs/meta').then(r=>r.json());assert.equal(meta.openCount,2);
  const post=(body,extra={})=>fetch(base+'/api/programs/recommend',{method:'POST',headers:{'Content-Type':'application/json','X-Timetable-App':'1',...extra},body:JSON.stringify(body)});
  assert.equal((await post({goal:'AI'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await post({goal:''})).status,400);
  const response=await post({goal:'AI'});assert.equal(response.status,200);assert.equal((await response.json()).programs.length,2);
  assert.equal((await fetch(base+'/program-model.mjs')).status,200);assert.equal((await fetch(base+'/program-ui.js')).status,200);
});
