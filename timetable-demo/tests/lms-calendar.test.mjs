import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeLmsCalendar,restoreLmsCalendar,agendaEvents,lmsTimeLabel,occursOnDate} from '../public/lms-calendar.mjs';
import {exportCalendar,conflictPairs,emptyPlanner,restorePlanner} from '../public/planner-core.mjs';

const account='a'.repeat(24),otherAccount='f'.repeat(24);
const deadline={id:'b'.repeat(24),courseId:'10',title:'설계 · 개인 과제',kind:'deadline',itemKind:'assignment',startAt:'2026-11-10T14:59:00Z',endAt:null,allDay:false,sourceUrl:'https://canvas.ssu.ac.kr/courses/10/assignments/20?verifier=synthetic'};
const allDay={id:'c'.repeat(24),courseId:'10',title:'발표 기간',kind:'event',allDay:true,date:'2026-11-11',startAt:'2026-11-10T15:00:00Z',endAt:'2026-11-12T15:00:00Z'};
const overnight={id:'d'.repeat(24),courseId:'10',title:'야간 일정',kind:'event',allDay:false,startAt:'2026-11-10T14:00:00Z',endAt:'2026-11-10T16:00:00Z'};
const result=(overrides={})=>({id:'batch-1',accountKey:account,collectedAt:'2026-11-10T01:00:00Z',courseIds:['10'],courses:[{id:'10',name:'설계'}],events:[deadline,allDay,overnight],warnings:[],...overrides});

test('시간표 없이 한국 시간 마감·여러 날 종일·자정 넘는 일정을 가져온다',()=>{
  const {cache,changes}=mergeLmsCalendar(null,result());
  assert.equal(changes.added,3);assert.equal(cache.events[0].date,'2026-11-10');assert.equal(cache.events[0].start,1439);
  assert.equal(lmsTimeLabel(cache.events[0]),'23:59 마감');assert.equal(cache.events[0].point,true);
  assert.equal(cache.events[1].endDate,'2026-11-13');assert.ok(occursOnDate(cache.events[1],'2026-11-12'));assert.ok(!occursOnDate(cache.events[1],'2026-11-13'));
  const rows=agendaEvents(cache.events,'2026-11-10','2026-11-12');
  assert.equal(rows.length,5);assert.ok(rows.some(e=>e.title==='야간 일정'&&e.date==='2026-11-11'&&e.start===0&&e.end===60));
  assert.deepEqual(conflictPairs(rows),[]); // Deadlines and all-day reminders do not reserve class time.
  assert.doesNotMatch(JSON.stringify(cache),/verifier|synthetic/);
  assert.deepEqual(restorePlanner(emptyPlanner()),emptyPlanner());
});

test('갱신은 중복 없이 같은 일정을 바꾸고 선택하지 않은 과목을 보존한다',()=>{
  let {cache}=mergeLmsCalendar(null,result());
  const repeated=mergeLmsCalendar(cache,result({id:'batch-2'}));
  assert.equal(repeated.cache.events.length,3);assert.deepEqual(repeated.changes,{added:0,updated:0,removed:0,retained:0});
  ({cache}=mergeLmsCalendar(cache,result({id:'course-20',courseIds:['20'],courses:[{id:'20',name:'다른 과목'}],events:[{...deadline,id:'e'.repeat(24),courseId:'20'}]})));
  const updated=mergeLmsCalendar(cache,result({id:'changed',events:[{...deadline,startAt:'2026-11-12T09:00:00Z'}]}));
  assert.deepEqual(updated.changes,{added:0,updated:1,removed:2,retained:0});
  assert.equal(updated.cache.events.length,2);assert.ok(updated.cache.events.some(e=>e.courseId==='20'));
});

test('부분 실패는 누락된 기존 일정을 보존하고 정상 빈 결과만 해당 과목에서 지운다',()=>{
  const {cache}=mergeLmsCalendar(null,result());
  const partial=mergeLmsCalendar(cache,result({id:'partial',events:[],warnings:[{courseId:'10',stage:'learningx',code:'FORBIDDEN'}]}));
  assert.equal(partial.cache.events.length,3);assert.equal(partial.changes.retained,3);
  const complete=mergeLmsCalendar(partial.cache,result({id:'empty',events:[]}));
  assert.equal(complete.cache.events.length,0);assert.equal(complete.changes.removed,3);
});

test('계정별 저장·UID를 분리하고 다른 계정의 캐시나 손상된 일정을 거절한다',()=>{
  const {cache}=mergeLmsCalendar(null,result());
  const other=mergeLmsCalendar(cache,result({accountKey:otherAccount,events:[deadline]})).cache;
  assert.equal(other.events.length,1);assert.notEqual(other.events[0].id,cache.events[0].id);
  assert.throws(()=>restoreLmsCalendar(cache,otherAccount));
  assert.throws(()=>mergeLmsCalendar(cache,result({events:[{...deadline,courseId:'999'}]})));
  assert.throws(()=>mergeLmsCalendar(cache,result({events:[{...deadline,startAt:'2026-11-10T23:59:00'}]})));
  const broken=structuredClone(cache);broken.events[0].start=100;assert.throws(()=>restoreLmsCalendar(broken,account));
  const sanitized=mergeLmsCalendar(null,result({events:[{...deadline,sourceUrl:'javascript:alert(1)'}]})).cache;
  assert.equal(sanitized.events[0].sourceUrl,'');
});

test('통합 ICS는 원래 마감 시각·종일 종료·다음 날 종료와 안정 UID를 유지한다',()=>{
  const {cache}=mergeLmsCalendar(null,result());
  const personal={id:'personal',title:'내 공부',location:'도서관',date:'2026-11-10',start:540,end:600,kind:'personal',status:'active'};
  const ics=exportCalendar([...cache.events,personal],new Date('2026-11-10T01:00:00Z')).replace(/\r\n /g,'');
  assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,4);
  const first=ics.split('BEGIN:VEVENT')[1];assert.match(first,/DTSTART:20261110T145900Z/);assert.doesNotMatch(first,/DTEND/);
  assert.match(ics,/DTSTART;VALUE=DATE:20261111\r\nDTEND;VALUE=DATE:20261113/);
  assert.match(ics,/DTEND:20261110T160000Z/);assert.match(ics,/UID:personal@ssu-timetable.local/);
  assert.doesNotMatch(ics,/verifier/);
});
