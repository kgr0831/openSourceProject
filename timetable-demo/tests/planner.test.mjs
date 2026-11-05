import test from 'node:test';
import assert from 'node:assert/strict';
import {courses,defaultRequest,generateCandidates} from '../schedule.mjs';
import {createSemesterEvents,editEvents,conflictPairs,exportCalendar,careerSelection,parseDate,addDays,emptyPlanner,restorePlanner,timeValue} from '../public/planner-core.mjs';
const candidate={sections:[{id:'db-02',courseId:'db',name:'데이터베이스',building:'정보과학관',meetings:[[0,540,630],[2,540,630]]}]};
const start='2026-10-19',end='2026-11-01';
const events=()=>createSemesterEvents(candidate,start,end);
test('학기 범위 안에서 복수 요일 수업을 정확히 반복하고 ID를 구분한다',()=>{
  const result=events();assert.deepEqual(result.map(e=>e.date),['2026-10-19','2026-10-21','2026-10-26','2026-10-28']);assert.equal(new Set(result.map(e=>e.id)).size,4);
  assert.equal(result[0].seriesId,result[2].seriesId);assert.notEqual(result[0].seriesId,result[1].seriesId);
});
test('한 번의 휴강과 날짜 이동은 다음 주와 다른 요일 수업을 보존한다',()=>{
  const original=events(),cancelled=editEvents(original,original[0].id,{}, {action:'cancel'});assert.equal(cancelled[0].status,'cancelled');assert.equal(cancelled[2].status,'active');assert.equal(original[0].status,'active');
  const changed=editEvents(original,original[1].id,{...original[1],date:'2026-10-22',start:600,end:700,kind:'exam',location:'진리관'});
  assert.equal(changed[1].kind,'exam');assert.equal(changed[3].date,'2026-10-28');assert.equal(changed[3].kind,'class');
  assert.deepEqual(editEvents(changed,changed[1].id,{}, {action:'restore'}),original);
});
test('이후 반복 변경은 같은 요일의 시리즈만 바꾸고 학기 밖 이동은 거절한다',()=>{
  const original=events(),patch={...original[0],date:'2026-10-20',start:660,end:750};
  const changed=editEvents(original,original[0].id,patch,{scope:'future',period:{start,end}});
  assert.deepEqual(changed.map(e=>e.date),['2026-10-20','2026-10-21','2026-10-27','2026-10-28']);
  assert.throws(()=>editEvents(original,original[0].id,{...patch,date:'2026-10-30'},{scope:'future',period:{start,end}}),/학기 기간/);
});
test('시험·보강·개인 일정 충돌을 찾고 인접 시간과 휴강은 제외한다',()=>{
  const lesson=events()[0],personal={...lesson,id:'personal',kind:'personal',start:600,end:660};
  assert.deepEqual(conflictPairs([lesson,personal]),[[lesson.id,'personal']]);assert.deepEqual(conflictPairs([lesson,{...personal,start:630}]),[]);assert.deepEqual(conflictPairs([{...lesson,status:'cancelled'},personal]),[]);
  const restored=editEvents([{...personal,status:'cancelled',original:undefined,seriesId:undefined}],'personal',{}, {action:'restore'});assert.equal(restored[0].status,'active');
});
test('ICS는 한국 시간을 UTC로 변환하고 휴강을 제외하며 한글을 안전하게 줄바꿈한다',()=>{
  const input=events();input[1].status='cancelled';input[0].title='가'.repeat(70)+',시험;일정\\메모\n새 줄';
  const output=exportCalendar(input,new Date('2026-10-20T00:00:00Z')),unfolded=output.replace(/\r\n /g,'');
  assert.equal((output.match(/BEGIN:VEVENT/g)||[]).length,3);assert.match(output,/DTSTART:20261019T000000Z/);assert.match(output,/DTEND:20261019T013000Z/);assert.match(unfolded,/\\,시험\\;일정\\\\메모\\n새 줄/);
  assert.ok(output.endsWith('END:VCALENDAR\r\n'));for(const line of output.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
});
test('진로 관심 과목은 실제 카탈로그 ID를 사용하며 이수 과목을 제외한다',async()=>{
  const preferred=careerSelection('vision',1,['ml'],courses);assert.deepEqual(preferred,['ds','math2']);
  const result=await generateCandidates({...structuredClone(defaultRequest),preferredCourseIds:preferred,excludedCourseIds:['ml']});assert.ok(result.candidates.length);assert.ok(result.candidates.every(c=>c.sections.every(s=>s.courseId!=='ml')));
  assert.throws(()=>careerSelection('fake',0,[],courses));
});
test('날짜·기간·시간 검증과 윤년 계산',()=>{
  assert.throws(()=>parseDate('2026-02-30'));assert.equal(addDays('2028-02-28',1),'2028-02-29');assert.throws(()=>createSemesterEvents(candidate,end,start));assert.throws(()=>createSemesterEvents(candidate,start,'2027-12-31'));assert.ok(Number.isNaN(timeValue('09:99')));
});
test('브라우저 기록을 복원하고 잘못된 버전과 중복 일정을 거절한다',()=>{
  const data={...emptyPlanner(),semester:{start,end,candidate},events:events()};assert.deepEqual(restorePlanner(JSON.parse(JSON.stringify(data))),data);
  assert.throws(()=>restorePlanner({...data,version:2}));assert.throws(()=>restorePlanner({...data,events:[data.events[0],data.events[0]]}));assert.throws(()=>restorePlanner({...data,semester:null}));
});
