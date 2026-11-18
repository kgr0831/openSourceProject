import test from 'node:test';
import assert from 'node:assert/strict';
import {careerCatalog,careerDataVersion,buildCareerCatalog,retrieveCareerCourses} from '../career-data.mjs';
import {evaluateCareer} from '../career.mjs';
import {groupCareerCourses,matchCareerOfferings,validateCareerList,toggleRequiredCourse} from '../public/career-model.mjs';
import * as live from '../schedule.mjs';

test('all 2195 groups map to real offerings; missing and reference descriptions stay distinct',()=>{
  assert.equal(careerCatalog.length,2195);
  assert.equal(new Set(careerCatalog.map(c=>c.id)).size,2195);
  assert.equal(careerCatalog.filter(c=>c.evidenceType==='name').length,438);
  assert.equal(careerCatalog.filter(c=>c.evidenceType==='description').length,1719);
  assert.equal(careerCatalog.filter(c=>c.evidenceType==='reference').length,38);
  assert.match(careerDataVersion,/^career-v2-/);
  assert.throws(()=>buildCareerCatalog([{'과목키':'a'.repeat(16),'과목명':'없는 과목','개설학과':'학과','원본과목번호목록':'["2150000101"]'}],[]),/연결/);
});

test('retrieval includes description-less titles and description-only matches without mixing departments',()=>{
  const catalog=[{id:'missing',name:'컴퓨터비전',department:'AI',description:'',evidenceType:'name'},
    {id:'described',name:'컴퓨터비전',department:'AI',description:'',evidenceType:'description'},
    {id:'body',name:'특강',department:'학과',description:'컴퓨터비전을 학습한다.',evidenceType:'description'}];
  assert.deepEqual(retrieveCareerCourses(catalog,['컴퓨터비전']).map(c=>c.id),['described','missing','body']);
  const record={name:'자료구조',department:'학과 A',courseNumbers:['2150000101']};
  const offerings=[{id:'wrong-dept',name:'자료구조',offerings:[{courseNumber:'2150000101',offeredBy:'학과 B',available:true}]},
    {id:'wrong-number',name:'자료구조',offerings:[{courseNumber:'2150000201',offeredBy:'학과 A',available:true}]},
    {id:'unavailable',name:'자료구조',offerings:[{courseNumber:'2150000101',offeredBy:'학과 A',available:false}]},
    {id:'right',name:'자료구조',offerings:[{courseNumber:'2150000101',offeredBy:'학과 A',available:true}]}];
  assert.deepEqual(matchCareerOfferings(record,offerings).map(c=>c.id),['right']);
});

function bridgeFor(keywords=['컴퓨터비전','선형대수','머신러닝']){
  const calls=[];
  return {calls,async recommend(payload,schema,options){
    calls.push({payload,options});
    return options.mode==='career-query'?{model:'mock',data:{keywords}}:{model:'mock',data:{evaluations:payload.courses.map(c=>({courseId:c.courseId,relevance:'high',reason:c.evidenceType==='name'?'과목명에서 진로 연관성을 판단했습니다.':'제공된 과목 정보와 진로가 관련됩니다.'}))}};
  }};
}
test('V2 searches all groups, sends only public evidence, persists and maps explicit choices to actual solver IDs',async()=>{
  const bridge=bridgeFor(),body={goal:'컴퓨터비전',term:'2026-1',department:'AI소프트웨어학부',request:{completedCourseIds:['private']},privateNotes:'secret'};
  const list=await evaluateCareer(body,bridge);
  assert.equal(list.source,'course-evidence-ai');assert.equal(list.searchedCourseCount,2195);
  assert.ok(list.evaluatedCourseCount>0&&list.evaluatedCourseCount<=80);
  assert.equal(bridge.calls.length,2);
  assert.ok(bridge.calls[1].payload.courses.some(c=>c.evidenceType==='reference'));
  assert.equal(JSON.stringify(bridge.calls).includes('secret'),false);
  assert.equal(JSON.stringify(bridge.calls).includes('completedCourseIds'),false);
  assert.doesNotThrow(()=>validateCareerList(JSON.parse(JSON.stringify(list))));
  const current=live.getCourses(body),display=groupCareerCourses(list,current),selectable=groupCareerCourses(list,current,{selectable:true});
  assert.ok([...display.major,...display.general].some(c=>!c.availableNow));
  const choice=[...selectable.major,...selectable.general][0];assert.ok(choice);
  const initial={...structuredClone(live.defaultRequest),term:body.term,department:body.department};
  const request=toggleRequiredCourse(initial,choice.id);
  assert.ok(!choice.id.startsWith('career-'));
  assert.deepEqual(live.solverInput(request).input.constraints.required_course_ids,[choice.id]);
  assert.deepEqual(request.preferredCourseIds,[]);
  assert.deepEqual(initial.requiredCourseIds,[]);
  const credits=choice.credits;
  const solved=await live.generateCandidates({...request,allowedDays:[0,1,2,3,4,5,6],earliestStart:0,latestEnd:1440,
    credits:{total:{min:credits,max:credits},major:{min:choice.kind==='major'?credits:0,max:choice.kind==='major'?credits:0},general:{min:choice.kind==='general'?credits:0,max:choice.kind==='general'?credits:0}}});
  assert.ok(solved.candidates.length);
  for(const candidate of solved.candidates)assert.deepEqual(candidate.sections.map(s=>s.courseId),[choice.id]);
});
test('V2 validates model keywords and IDs; never returns a partially saved or invented recommendation',async()=>{
  await assert.rejects(evaluateCareer({goal:'CV'},{recommend:async()=>({data:{keywords:['x']}})}),/검색어/);
  const bridge=bridgeFor();const original=bridge.recommend.bind(bridge);
  bridge.recommend=async(p,s,o)=>o.mode==='career-query'?original(p,s,o):{data:{evaluations:[{courseId:'invented',relevance:'high',reason:'x'}]}};
  await assert.rejects(evaluateCareer({goal:'CV'},bridge),/과목 수|중복/);
  const list=await evaluateCareer({goal:'CV'},bridgeFor());list.courses[0].courseNumbers=['bad'];
  assert.throws(()=>validateCareerList(list),/근거 과목/);
});
test('empty retrieval is an honest empty result; aborted requests do not invoke the model',async()=>{
  const bridge=bridgeFor(['없는진로검색어검증']);const list=await evaluateCareer({goal:'없는진로검색어검증'},bridge);
  assert.deepEqual(list.courses,[]);assert.deepEqual(list.evaluations,[]);assert.equal(bridge.calls.length,1);
  const controller=new AbortController();controller.abort();
  const aborted=bridgeFor();await assert.rejects(evaluateCareer({goal:'CV'},aborted,live,{signal:controller.signal}));assert.equal(aborted.calls.length,0);
});
