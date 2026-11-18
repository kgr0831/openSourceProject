import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseMeetings,parseCourseCsv,compareCourseSources} from '../catalog-import.mjs';
import {courses,catalogInfo,catalogVersion,getCourses} from '../catalog.mjs';
import {defaultRequest,solverInput,validateRequest,generateCandidates,createScheduler} from '../schedule.mjs';
import {createSemesterEvents,exportCalendar} from '../public/planner-core.mjs';
import {createTimetableServer} from '../server.mjs';

const json=readFileSync(new URL('../data/courses.json',import.meta.url));
const csv=readFileSync(new URL('../data/courses.csv',import.meta.url));
const rows=JSON.parse(json),sections=courses.flatMap(course=>course.sections);
const exact=n=>({min:n,max:n});
function onlyCourse(course,section){
  const department=course.kind==='major'?section.departments[0]:catalogInfo.department;
  return {...structuredClone(defaultRequest),term:course.term,department,
    allowedDays:[0,1,2,3,4,5,6],earliestStart:0,latestEnd:1440,
    requiredCourseIds:[course.id],lockedSectionIds:section?.meetings.length?[section.id]:[],
    excludedCourseIds:getCourses({term:course.term,department}).filter(c=>c.id!==course.id).map(c=>c.id),
    credits:{total:exact(course.credits),major:exact(course.kind==='major'?course.credits:0),general:exact(course.kind==='general'?course.credits:0)}};
}

test('제공된 JSON·CSV 4,722행을 변경 없이 가져오고 학기·학점·원문을 보존한다',()=>{
  assert.equal(createHash('sha256').update(json).digest('hex'),'051d7805a6a518d8c70af9765430edf5083ab804293c05678d453a5517ce0ec1');
  assert.equal(createHash('sha256').update(csv).digest('hex'),'e212e7d3a75627dc4fe7332c93617101e7ef59a9fe81ccd9f64bb7f578cb11a0');
  compareCourseSources(rows,parseCourseCsv(csv.toString('utf8')));
  assert.equal(rows.length,4722);assert.equal(sections.length,4722);
  assert.equal(new Set(sections.map(s=>s.id)).size,4722);
  assert.equal(new Set(courses.map(c=>c.id)).size,courses.length);
  assert.equal(sections.filter(s=>s.term==='2026-1').length,2462);
  assert.equal(sections.filter(s=>s.term==='2026-2').length,2260);
  const source=new Map(rows.map(row=>[`${row['학년도']}-${row['학기'][0]}-${row['과목번호']}`,row]));
  for(const course of courses)for(const section of course.sections){
    const row=source.get(section.id.slice(4));
    assert.ok(row);assert.equal(course.name,row['과목명']);
    assert.equal(course.credits,Number(row['시간/학점(설계)'].split('/')[1].split('(')[0]));
    assert.equal(section.rawSchedule,row['강의시간(강의실)'].trim());
    assert.equal(section.target,row['수강대상'].trim());
    assert.equal(section.classification,row['이수구분(주전공)']);
    assert.equal(course.term,section.term);assert.ok(!section.id.includes(':'));
  }
  assert.equal(sections.filter(s=>s.unavailableReason).length,108);
  assert.ok(sections.filter(s=>s.unavailableReason).every(s=>!s.rawSchedule&&!s.meetings.length));
});

test('공동강의의 동일 시간, 요일별 강의실, 중첩 괄호와 토요일을 해석한다',()=>{
  const parsed=parseMeetings('수 금 15:00-16:15 (정보과학관 21305 (이철희실습실)-권재환) 토 09:00-09:50 (베어드홀 01101-3(융합실습실)-이재구) 수 15:00-16:15 (정보과학관 21305 (이철희실습실)-김교수)');
  assert.equal(parsed.issue,null);
  assert.deepEqual(parsed.meetings,[[2,900,975],[4,900,975],[5,540,590]]);
  assert.deepEqual(parsed.locations,['정보과학관 21305 (이철희실습실)','정보과학관 21305 (이철희실습실)','베어드홀 01101-3(융합실습실)']);
  assert.deepEqual(parsed.instructors,['권재환','이재구','김교수']);
  assert.equal(parseMeetings('월 10:00-11:00 (진리관 101-가) 월 10:30-11:30 (진리관 102-나)').meetings.length,0);
  for(const raw of ['', '비대면', '월 10:75-12:00 (미정)', '월 23:00-25:00 (미정)'])assert.ok(parseMeetings(raw).issue);
});

test('59개 학과와 두 학기를 각각 선택하며 교양·조회경로를 보존한다',()=>{
  assert.equal(catalogInfo.departments.length,59);
  assert.deepEqual(catalogInfo.terms,['2026-1','2026-2']);
  let largest=0;
  for(const term of catalogInfo.terms)for(const department of catalogInfo.departments){
    const scoped=getCourses({term,department});
    largest=Math.max(largest,scoped.reduce((n,c)=>n+c.sections.length,0));
    for(const c of scoped){
      assert.equal(c.term,term);
      assert.ok(c.sections.every(s=>s.term===term&&(c.kind==='general'||s.departments.includes(department))));
      assert.equal(c.classification,[...new Set(c.sections.map(s=>s.classification))].join(' / '));
    }
    assert.deepEqual(scoped.filter(c=>c.kind==='general').map(c=>c.id),courses.filter(c=>c.term===term&&c.kind==='general').map(c=>c.id));
  }
  assert.equal(largest,947);
  assert.throws(()=>getCourses({term:'2025-1'}));assert.throws(()=>getCourses({department:'없는 학과'}));
  const otherTerm=courses.find(c=>c.term!==defaultRequest.term);
  assert.throws(()=>validateRequest({...defaultRequest,requiredCourseIds:[otherTerm.id]}));
  const foreign=courses.find(c=>c.term===defaultRequest.term&&c.kind==='major'&&!c.departments.includes(defaultRequest.department));
  assert.throws(()=>validateRequest({...defaultRequest,requiredCourseIds:[foreign.id]}));
  assert.throws(()=>validateRequest({...defaultRequest,catalogVersion:'ssu-fictional-v1'}));
  const {catalog}=solverInput(defaultRequest);
  assert.ok(catalog.sections.every(s=>s.term===defaultRequest.term));
});

test('실제 분반의 요일별 장소가 저장 일정과 ICS에도 유지된다',()=>{
  const course=getCourses().find(c=>c.sections.some(s=>new Set(s.locations).size>1));
  const section=course.sections.find(s=>new Set(s.locations).size>1);
  const candidate={sections:[{...section,courseId:course.id,name:course.name}]};
  const events=createSemesterEvents(candidate,'2026-09-07','2026-09-13');
  assert.equal(events.length,section.meetings.length);
  for(const event of events){
    const day=(new Date(event.date+'T00:00:00Z').getUTCDay()+6)%7;
    const index=section.meetings.findIndex(([d,start,end])=>d===day&&start===event.start&&end===event.end);
    assert.equal(event.location,section.locations[index]);
  }
  for(const location of new Set(section.locations))assert.ok(exportCalendar(events).includes('LOCATION:'+location));
});

test('실제 OR-Tools가 양 학기, 토요일, 0.5학점 분반을 그대로 추천한다',{timeout:30000},async()=>{
  const targets=catalogInfo.terms.map(term=>courses.find(c=>c.term===term&&c.kind==='major'&&c.sections.some(s=>s.meetings.length)));
  targets.push(courses.find(c=>c.sections.some(s=>s.meetings.some(m=>m[0]===5))));
  targets.push(courses.find(c=>c.credits===0.5&&c.sections.some(s=>s.meetings.length)));
  for(const course of targets){
    const section=course.sections.find(s=>s.meetings.some(m=>m[0]===5))||course.sections.find(s=>s.meetings.length);
    const result=await generateCandidates(onlyCourse(course,section));
    assert.equal(result.total,1);
    const candidate=result.candidates[0];assert.equal(candidate.credits,course.credits);
    assert.equal(candidate.sections[0].id,section.id);assert.deepEqual(candidate.sections[0].locations,section.locations);
    assert.deepEqual(candidate.sections[0].meetings,section.meetings);assert.equal(candidate.sections[0].term,course.term);
    assert.deepEqual(candidate.metrics.dayList,[...new Set(section.meetings.map(m=>m[0]))].sort());
  }
  const missing=courses.find(c=>c.sections.every(s=>!s.meetings.length));
  const result=await generateCandidates(onlyCourse(missing,missing.sections[0]));
  assert.equal(result.total,0);assert.equal(result.solver.original_status,'INFEASIBLE');
});

test('건물 이동·연강 점수는 선택한 이전 수업과 요일별 강의실만 계산한다',async()=>{
  const scheduler=createScheduler({courses:[
    {id:'a',name:'A',credits:3,kind:'major',sections:[{id:'a1',building:'A',locations:['A 1','C 2','D 3'],meetings:[[0,540,600],[0,720,780],[6,540,600]]}]},
    {id:'b',name:'B',credits:3,kind:'major',sections:[{id:'b1',building:'B',locations:['B 1'],meetings:[[0,600,660]]}]},
    {id:'unused',name:'Unused',credits:3,kind:'major',sections:[{id:'u1',building:'X',locations:['X 1'],meetings:[[0,660,690]]}]}
  ]});
  const request={...structuredClone(scheduler.defaultRequest),requiredCourseIds:['a','b'],allowedDays:[0,6],
    credits:{total:exact(6),major:exact(6),general:exact(0)},maxCoursesPerDay:null,
    preferences:Object.fromEntries(Object.keys(defaultRequest.preferences).map(key=>[key,['travel','breaks'].includes(key)]))};
  const result=await scheduler.generateCandidates(request);
  assert.equal(result.total,1);const candidate=result.candidates[0];
  assert.equal(candidate.metrics.buildingChanges,2);assert.equal(candidate.metrics.backToBackClasses,1);
  assert.equal(candidate.cost,17);assert.equal(candidate.solverResult.metrics.legacy_cost_units,340);
});

test('시간표 API는 선택 학기·학과로 제한하고 V2 진로 검색은 전체 과목을 사용한다',{timeout:15000},async t=>{
  let sent;
  const bridge={close(){},async recommend(payload,schema,{mode}){if(mode==='career-query')return {model:'test',data:{keywords:['회계','재무']}};sent=payload;return {model:'test',data:{evaluations:payload.courses.map(c=>({courseId:c.courseId,relevance:'uncertain',reason:'진로와 연관성을 확인하지 못함'}))}}}};
  const server=createTimetableServer({port:0,bridge});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await server.closeServices();await new Promise(resolve=>server.close(resolve))});
  const url='http://127.0.0.1:'+server.address().port;
  const scope={term:'2026-1',department:'경영학부'};
  const meta=await fetch(url+'/api/meta?'+new URLSearchParams(scope)).then(r=>r.json());
  assert.equal(meta.catalogInfo.selectedSectionCount,947);assert.equal(meta.defaultRequest.term,scope.term);
  assert.equal(meta.courses.length,getCourses(scope).length);
  assert.equal((await fetch(url+'/api/meta?term=2025-1')).status,400);
  const post=(path,body)=>fetch(url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Timetable-App':'1'},body:JSON.stringify(body)});
  const result=await post('career',{goal:'회계사',...scope}).then(r=>r.json());
  assert.deepEqual(Object.keys(sent).sort(),['courses','department','goal']);
  assert.equal(result.source,'course-evidence-ai');assert.equal(result.searchedCourseCount,2195);
  assert.ok(sent.courses.length>0&&sent.courses.length<=80);
  assert.ok(sent.courses.every(c=>c.courseId.startsWith('career-')));
  assert.ok(sent.courses.some(c=>typeof c.description==='string'&&c.description.length>0));
  assert.equal(result.term,scope.term);assert.equal(result.department,scope.department);assert.equal(result.catalogVersion,catalogVersion);
  const request={...meta.defaultRequest,excludedCourseIds:meta.courses.map(c=>c.id),note:'가'.repeat(400)};
  assert.ok(Buffer.byteLength(JSON.stringify(request))>8192);
  const response=await post('candidates',request);assert.equal(response.status,200);
  assert.equal((await response.json()).solver.original_status,'INFEASIBLE');
});
