import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCareerCourses,toggleRequiredCourse} from '../public/career-model.mjs';
import {createPlannerStore,storageKey} from '../public/planner.js';
import {defaultRequest,validateRequest,solverInput,generateCandidates,courses} from '../schedule.mjs';
import {evaluateCareer,validateEvaluations} from '../career.mjs';
const raw=()=>structuredClone(defaultRequest);
const bridge={recommend:async(payload,schema,options)=>{
  assert.equal(options.mode,'career');assert.deepEqual(Object.keys(payload).sort(),['courses','department','goal']);
  assert.deepEqual(Object.keys(payload.courses[0]).sort(),['courseId','name']);
  return {model:'test-double',data:{evaluations:payload.courses.map(c=>({courseId:c.courseId,relevance:['ml','writing'].includes(c.courseId)?'high':'uncertain',reason:'과목명 기반 판단'}))}};
}};
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)}};
test('career list uses full catalog and never changes timetable constraints',async()=>{
  const request={...raw(),requiredCourseIds:['db'],excludedCourseIds:['ml'],completedCourseIds:['ml']},before=structuredClone(request);
  const list=await evaluateCareer({goal:'컴퓨터비전',request},bridge);
  assert.deepEqual(request,before);assert.equal('request' in list,false);assert.equal(list.evaluations.length,courses.length);
  const groups=groupCareerCourses(list,courses);
  assert.deepEqual(groups.major.map(c=>c.id),['ml']);assert.deepEqual(groups.general.map(c=>c.id),['writing']);
});
test('career list persists; storage failure preserves previous saved list',async()=>{
  const list=await evaluateCareer({goal:'컴퓨터비전'},bridge),mem=storage(),store=createPlannerStore(mem);
  store.saveCareerList(list);assert.deepEqual(createPlannerStore(mem).data.careerRecommendations,list);
  const failing=createPlannerStore({getItem:()=>JSON.stringify(store.data),setItem:()=>{throw Error('full')}});
  assert.throws(()=>failing.saveCareerList({...list,goal:'웹 개발'}));assert.equal(failing.data.careerRecommendations.goal,'컴퓨터비전');
  assert.throws(()=>store.saveCareerList({...list,evaluations:[list.evaluations[0],list.evaluations[0]]}));
  assert.deepEqual(createPlannerStore(mem).data.careerRecommendations,list);
});
test('legacy completed history does not exclude courses or block semester saving',()=>{
  const mem=storage(),legacy={version:1,semester:null,events:[],experiences:[],courseHistory:[{term:'2025-1',status:'completed',courseIds:['ml']}]};
  mem.setItem(storageKey,JSON.stringify(legacy));const store=createPlannerStore(mem);assert.equal(store.readError,'');
  const valid=validateRequest({...raw(),completedCourseIds:['ml'],requiredCourseIds:['ml']});
  assert.deepEqual(valid.excludedCourseIds,[]);assert.deepEqual(valid.requiredCourseIds,['ml']);assert.equal('completedCourseIds' in valid,false);
  const candidate={sections:[{courseId:'ml',name:'머신러닝',id:'ml-01',meetings:[[0,600,660]],building:'',credits:3}]};
  store.setSemester(candidate,'2025-03-01','2025-06-20');assert.deepEqual(store.data.courseHistory,legacy.courseHistory);
});
test('explicit selection toggles required only and does not give other recommendations priority',()=>{
  const initial={...raw(),excludedCourseIds:['ml']},selected=toggleRequiredCourse(initial,'ml');
  assert.deepEqual(initial.requiredCourseIds,[]);assert.deepEqual(selected.requiredCourseIds,['ml']);assert.deepEqual(selected.excludedCourseIds,[]);
  assert.deepEqual(selected.preferredCourseIds,[]);assert.deepEqual(toggleRequiredCourse(selected,'ml').requiredCourseIds,[]);
  const {input}=solverInput(selected);assert.deepEqual(input.constraints.required_course_ids,['ml']);assert.deepEqual(input.legacy_preferences.preferred_course_ids,[]);
});
test('invalid AI evaluations rejected; no related courses has explicit empty groups',async()=>{
  assert.throws(()=>validateEvaluations({evaluations:[{courseId:'fake',relevance:'high',reason:'x'}]},[{id:'ml'}]));
  assert.throws(()=>validateEvaluations({evaluations:[{courseId:'ml',relevance:'high',reason:'x'},{courseId:'ml',relevance:'high',reason:'x'}]},[{id:'ml'},{id:'db'}]));
  assert.throws(()=>validateEvaluations({evaluations:[]},[{id:'ml'}]));
  assert.throws(()=>validateEvaluations({evaluations:[{courseId:'ml',relevance:'unknown',reason:'x'}]},[{id:'ml'}]));
  const result=await evaluateCareer({goal:'관계없는 진로'},{recommend:async payload=>({data:{evaluations:payload.courses.map(c=>({courseId:c.courseId,relevance:'uncertain',reason:'판단 보류'}))}})});
  assert.deepEqual(groupCareerCourses(result,courses),{major:[],general:[]});
  await assert.rejects(evaluateCareer({goal:'CV'},{recommend:async()=>{throw Error('offline')}}),/offline/);
});
test('actual solver includes explicit selection and respects normal user exclusions',async()=>{
  const request=toggleRequiredCourse({...raw(),excludedCourseIds:['ds'],credits:{total:{min:3,max:3},major:{min:3,max:3},general:{min:0,max:0}}},'ml');
  const result=await generateCandidates(request);assert.ok(result.candidates.length);
  for(const c of result.candidates)assert.deepEqual(c.sections.map(s=>s.courseId),['ml']);
  assert.deepEqual(result.request.preferredCourseIds,[]);
});
