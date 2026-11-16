import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultRequest,generateCandidates,measure,validateRequest} from '../schedule.mjs';
import {compareOptions} from '../public/ui.js';
import {createPlannerStore,storageKey} from '../public/planner.js';
import {emptyPlanner} from '../public/planner-core.mjs';
const sections=meetings=>meetings.map((m,i)=>({id:String(i),building:'정보관',meetings:[m]}));
const plan={sections:[{id:'db-1',courseId:'db',name:'데이터베이스',building:'정보관',meetings:[[0,600,690]]}]};

test('점심은 12–14시 사이 연속 60분, 연강은 수업 사이 30분 미만으로 판정',()=>{
  const metrics=measure(sections([[0,660,750],[0,810,900],[1,540,600],[1,600,660],[1,690,720],[2,720,780]]));
  assert.equal(metrics.lunchMissedDays,0);
  assert.equal(metrics.backToBackClasses,1);
  assert.equal(metrics.maxDailyCourses,3);
  assert.equal(metrics.longestDayMinutes,180);
  const fragmented=measure(sections([[0,765,795],[1,700,810],[2,600,700]]));
  assert.equal(fragmented.lunchMissedDays,2);
});

test('새 선호를 생략한 기존 요청을 허용하고 하루 수업량 범위를 검증',()=>{
  const request=structuredClone(defaultRequest);delete request.maxCoursesPerDay;delete request.preferences.lunch;delete request.preferences.breaks;
  const result=validateRequest(request);assert.equal(result.maxCoursesPerDay,null);assert.equal(result.preferences.lunch,false);assert.equal(result.preferences.breaks,false);
  for(const value of [0,9,2.5,'3'])assert.throws(()=>validateRequest({...request,maxCoursesPerDay:value}),/하루 수업량/);
});

test('점심·연강·하루 수업량은 필수 과목을 제거하지 않는 선호 점수',async()=>{
  const request={...structuredClone(defaultRequest),requiredCourseIds:['ds','algo','db'],allowedDays:[0,1,2,3],earliestStart:600,credits:{total:{min:13,max:13},major:{min:9,max:9},general:{min:4,max:4}},maxCoursesPerDay:1,preferences:Object.fromEntries(Object.keys(defaultRequest.preferences).map(k=>[k,['lunch','breaks'].includes(k)]))};
  const result=await generateCandidates(request);assert.ok(result.total>0);
  for(const c of result.candidates){assert.ok(request.requiredCourseIds.every(id=>c.sections.some(s=>s.courseId===id)));assert.ok(c.metrics.maxDailyCourses>1);assert.equal(c.cost,c.metrics.lunchMissedDays*25+c.metrics.backToBackClasses*9+(c.metrics.maxDailyCourses-1)*18)}
});

test('비교안은 실제 후보 중 등교일·하루 수업량·공강 기준으로 중복 없이 선택',()=>{
  const candidate=(id,days,longestDayMinutes,gapMinutes,cost=0)=>({id,cost,metrics:{days,longestDayMinutes,gapMinutes}});
  const input=[candidate('few',2,300,150),candidate('balanced',3,150,100),candidate('compact',4,240,0),candidate('extra',4,300,100)];
  const before=structuredClone(input);assert.deepEqual(compareOptions(input).map(c=>c.id),['few','balanced','compact']);assert.deepEqual(input,before);
  assert.equal(compareOptions(input.slice(0,1)).length,1);assert.deepEqual(compareOptions([]),[]);
});

test('수강 기록을 유지하고 저장 실패 시 메모리도 보존',()=>{
  const original={...emptyPlanner(),experiences:[{id:'note',title:'기존 기록',body:'보존할 이유',courseNames:['자료구조']}]};
  let raw=JSON.stringify(original),fail=false;
  const store=createPlannerStore({getItem:key=>{assert.equal(key,storageKey);return raw},setItem:(key,value)=>{assert.equal(key,storageKey);if(fail)throw Error('QuotaExceededError');raw=value}});
  store.setSemester(plan,'2026-10-19','2026-11-01');assert.deepEqual(store.data.experiences,original.experiences);const saved=structuredClone(store.data);fail=true;
  assert.throws(()=>store.changeEvent(saved.events[0].id,{}, {action:'cancel'}),/저장하지 못/);assert.deepEqual(store.data,saved);assert.deepEqual(JSON.parse(raw),saved);
});

test('손상된 저장소를 덮어쓰지 않고 학기 밖 개인 일정은 거절',()=>{
  let writes=0;const broken=createPlannerStore({getItem:()=>'{broken',setItem:()=>writes++});assert.ok(broken.readError);assert.throws(()=>broken.setSemester(plan,'2026-10-19','2026-11-01'));assert.equal(writes,0);
  const store=createPlannerStore({getItem:()=>null,setItem:()=>{}});store.setSemester(plan,'2026-10-19','2026-11-01');const before=structuredClone(store.data);
  assert.throws(()=>store.addEvent({title:'범위 밖',date:'2026-11-02',start:600,end:660,location:'',kind:'personal'}),/학기 기간/);assert.deepEqual(store.data,before);
});
