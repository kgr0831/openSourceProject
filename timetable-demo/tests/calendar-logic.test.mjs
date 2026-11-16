import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPlanner, exportCalendar} from '../public/planner-core.mjs';
import {applyCalendar, calendarEvents, loadCalendar, previewCalendar} from '../public/calendar-logic.mjs';
import {createPlannerStore, storageKey} from '../public/planner.js';

const start = '2026-10-19', end = '2026-11-08';
const database = {id: 'db-01', courseId: 'db', name: '데이터베이스', building: '정보관', room: '202',
  meetings: [[0, 540, 630], [0, 660, 720], [2, 540, 630]]};
const networks = {id: 'net-01', courseId: 'net', name: '네트워크', meetings: [[1, 540, 630]]};
const candidate = {sections: [database, networks]};
const initialize = {type: 'initialize', candidate, start, end};
const find = (state, date, time = 540) => state.events.find(e => e.courseId === 'db' && e.date === date && e.start === time);
const now = new Date('2026-10-19T00:00:00Z');

function commit(state, command, acceptConflicts = false) {
  const preview = previewCalendar(state, command);
  assert.equal(preview.ok, true, preview.errors[0]?.message);
  return applyCalendar(state, preview, {acceptConflicts, now});
}
function edit(id, options = {}) { return {type: 'edit', id, ...options}; }
function add(kind, options = {}, fields = {}) {
  return {type: 'add', event: {kind, title: kind, date: start, start: 570, end: 600, location: '', ...fields}, ...options};
}
function get(state, id) { return state.events.find(event => event.id === id); }
const initialized = () => commit(emptyPlanner(), initialize);

test('모든 요일과 같은 날의 여러 시간 블록을 생성하고 중복 요청을 처리한다', () => {
  const state = initialized();
  const db = state.events.filter(e => e.courseId === 'db');
  assert.equal(db.length, 9);
  assert.equal(new Set(db.map(e => e.seriesId)).size, 3);
  assert.equal(new Set(db.map(e => e.id)).size, db.length);
  assert.equal(db[0].original.building, '정보관');
  assert.equal(db[0].original.room, '202');
  assert.equal(db[0].location, '정보관 202');
  const net = state.events.find(e => e.courseId === 'net');
  assert.equal(net.location, '');
  assert.equal(Object.hasOwn(net.original, 'room'), false);
  assert.equal(commit(state, initialize), state);
  const invalid = {sections: [{...database, meetings: [...database.meetings, [9, 500, 600]]}]};
  assert.equal(previewCalendar(emptyPlanner(), {...initialize, candidate: invalid}).ok, false);
  assert.equal(previewCalendar(emptyPlanner(), {...initialize, end: '2026-02-30'}).ok, false);
});

test('한 번의 휴강과 요청 필드만 변경하며 이후 반복 적용은 다른 요일과 예외를 보존한다', () => {
  let state = initialized();
  const [first, second, third] = [start, '2026-10-26', '2026-11-02'].map(date => find(state, date));
  state = commit(state, edit(second.id, {action: 'cancel'}));
  assert.equal(get(state, first.id).status, 'active');
  assert.equal(get(state, third.id).status, 'active');
  assert.equal(find(state, '2026-10-28').status, 'active');
  state = commit(state, edit(second.id, {patch: {location: '휴강 장소 메모'}}));
  assert.equal(get(state, second.id).status, 'cancelled');
  assert.equal(get(state, second.id).start, second.start);
  state = commit(state, edit(second.id, {action: 'resume'}));
  assert.equal(get(state, second.id).location, '휴강 장소 메모');
  const preview = previewCalendar(state, edit(second.id, {scope: 'future', patch: {location: '새 강의실'}}));
  assert.deepEqual(preview.preserved.map(item => item.event.id), [second.id]);
  assert.deepEqual(preview.changes.map(change => change.id), [third.id]);
  state = applyCalendar(state, preview);
  assert.equal(get(state, first.id).location, first.location);
  assert.equal(get(state, second.id).location, '휴강 장소 메모');
  assert.equal(get(state, third.id).location, '새 강의실');
  assert.equal(find(state, '2026-11-02', 660).location, first.location);
  assert.equal(find(state, '2026-11-04').location, first.location);
  state = commit(state, edit(second.id, {action: 'restore'}));
  assert.deepEqual(get(state, second.id), second);
});

test('반복 날짜 변경은 최초 발생일에 상대적이며 하나라도 범위를 벗어나면 전체가 실패한다', () => {
  const state = initialized(), first = find(state, start);
  const before = structuredClone(state);
  const command = edit(first.id, {scope: 'future', patch: {date: '2026-10-26'}});
  const failed = previewCalendar(state, command);
  assert.equal(failed.ok, false);
  assert.match(failed.errors[0].message, /학기 기간/);
  assert.deepEqual(failed.changes, []);
  assert.deepEqual(state, before);

  const moved = commit(state, edit(first.id, {patch: {date: '2026-10-20'}}), true);
  const preview = previewCalendar(moved, edit(first.id, {scope: 'future', patch: {date: '2026-10-21'}}));
  assert.ok(preview.ok);
  assert.deepEqual(preview.changes.map(change => change.after.date), ['2026-10-28', '2026-11-04']);
  assert.equal(preview.preserved[0].event.date, '2026-10-20');
  assert.equal(get(moved, first.id).original.date, start);
});

test('대체 시험의 표시 상태와 별도 시험을 구분하고 원래 수업의 독립적인 변경을 보존한다', () => {
  let state = initialized();
  const original = find(state, start);
  state = commit(state, add('exam', {examMode: 'replacement', originalEventId: original.id}));
  const exam = state.events.at(-1);
  const projected = () => calendarEvents(state.events).find(e => e.id === original.id);
  assert.equal(exam.courseId, original.courseId);
  assert.equal(exam.sectionId, original.sectionId);
  assert.equal(projected().status, 'cancelled');
  assert.equal(projected().replacedBy, exam.id);
  assert.doesNotMatch(exportCalendar(calendarEvents(state.events)), /DTSTART:20261019T000000Z/);
  const repeat = previewCalendar(state, edit(original.id, {scope: 'future', patch: {location: '새 장소'}}));
  assert.deepEqual(repeat.preserved.map(item => item.event.id), [original.id, exam.id]);
  const duplicate = previewCalendar(state, add('exam', {examMode: 'replacement', originalEventId: original.id}));
  assert.equal(duplicate.ok, false);

  state = commit(state, edit(exam.id, {action: 'cancel'}));
  assert.equal(projected().status, 'active');
  state = commit(state, edit(original.id, {patch: {location: '장소 변경'}}));
  state = commit(state, edit(original.id, {action: 'cancel'}));
  state = commit(state, edit(exam.id, {action: 'resume'}));
  state = commit(state, edit(exam.id, {action: 'cancel'}));
  assert.equal(projected().status, 'cancelled');
  assert.equal(projected().location, '장소 변경');
  state = commit(state, add('exam', {examMode: 'additional', courseId: 'db'}));
  assert.equal(state.events.at(-1).examMode, 'additional');
  assert.equal(state.events.at(-1).originalEventId, undefined);
  assert.equal(projected().replacedBy, undefined);
});

test('보강은 휴강 수업과 연결되며 취소와 복원은 원래 휴강에 영향을 주지 않는다', () => {
  let state = initialized();
  const original = find(state, start);
  const command = add('makeup', {originalEventId: original.id});
  assert.equal(previewCalendar(state, command).ok, false);
  state = commit(state, edit(original.id, {action: 'cancel'}));
  state = commit(state, command);
  const makeup = state.events.at(-1);
  assert.equal(makeup.originalEventId, original.id);
  assert.equal(makeup.courseId, 'db');
  state = commit(state, edit(makeup.id, {action: 'cancel'}));
  state = commit(state, edit(makeup.id, {action: 'resume'}));
  assert.equal(get(state, makeup.id).status, 'active');
  assert.equal(get(state, original.id).status, 'cancelled');
  assert.equal(previewCalendar(state, edit(makeup.id, {action: 'restore'})).ok, false);
});

test('겹침의 ID, 이름, 실제 분 범위를 반환하고 명시적으로 확인해야 저장한다', () => {
  let state = initialized();
  const lesson = find(state, start), before = structuredClone(state);
  const preview = previewCalendar(state, add('personal', {}, {start: 600, end: 660, title: '개인 약속'}));
  assert.deepEqual(state, before);
  assert.deepEqual(preview.conflicts, [{date: start, start: 600, end: 630,
    events: [{id: lesson.id, title: lesson.title}, {id: preview.changes[0].id, title: '개인 약속'}]}]);
  assert.throws(() => applyCalendar(state, preview), {code: 'CONFLICT_CONFIRMATION_REQUIRED'});
  state = applyCalendar(state, preview, {acceptConflicts: true});
  assert.equal(previewCalendar(state, add('personal', {}, {start: 510, end: 540})).conflicts.length, 0);
  state = commit(state, edit(lesson.id, {action: 'cancel'}));
  assert.equal(previewCalendar(state, add('personal', {}, {start: 570, end: 600})).conflicts.length, 0);
  const resume = previewCalendar(state, edit(lesson.id, {action: 'resume'}));
  assert.equal(resume.conflicts.length, 1);
  const bad = previewCalendar(state, add('personal', {}, {start: 600, end: 600}));
  assert.equal(bad.errors[0].code, 'INVALID_INPUT');
  assert.equal(bad.conflicts.length, 0);
});

test('반복 변경은 한 작업이며 오래된 미리보기와 작업을 거절하고 복원 충돌을 검사한다', () => {
  let state = initialized();
  const first = find(state, start), snapshot = state.events;
  state = commit(state, edit(first.id, {scope: 'future', patch: {location: '이동'}}));
  const operation = state.history.at(-1);
  assert.equal(operation.at, now.toISOString());
  assert.equal(operation.scope, 'future');
  assert.equal(operation.affectedIds.length, 3);
  assert.equal(operation.changes[0].before.location, first.location);
  const undo = {type: 'undo', operationId: operation.id};
  state = commit(state, undo);
  assert.deepEqual(state.events, snapshot);
  assert.equal(state.history.at(-1).undoes, operation.id);
  assert.equal(previewCalendar(state, undo).errors[0].code, 'STALE_OPERATION');
  const stale = previewCalendar(state, edit(first.id, {action: 'cancel'}));
  state = commit(state, edit(first.id, {patch: {start: 750, end: 810}}));
  assert.throws(() => applyCalendar(state, stale), {code: 'STALE_PREVIEW'});
  state = commit(state, add('personal'));
  assert.equal(previewCalendar(state, edit(first.id, {action: 'restore'})).conflicts.length, 1);

  state = commit(state, edit(first.id, {action: 'restore'}), true);
  state = commit(state, edit(first.id, {action: 'cancel'}));
  const cancelled = state.history.at(-1);
  assert.equal(previewCalendar(state, {type: 'undo', operationId: cancelled.id}).conflicts.length, 1);
});

test('시간표 교체는 검토 선택 전 저장을 막고 과거·개인·휴강·시험·보강과 동일 분반을 보존한다', () => {
  let state = initialized();
  const past = find(state, start), future = find(state, '2026-10-26');
  const unchanged = state.events.find(e => e.courseId === 'net' && e.date > '2026-10-26');
  state = commit(state, edit(future.id, {action: 'cancel'}));
  state = commit(state, add('makeup', {originalEventId: future.id}, {date: '2026-10-27', start: 780, end: 840}));
  const makeup = state.events.at(-1);
  state = commit(state, add('exam', {courseId: 'db', examMode: 'additional'}, {date: '2026-10-29'}));
  const exam = state.events.at(-1);
  state = commit(state, add('personal', {}, {date: '2026-10-30'}));
  const personal = state.events.at(-1);
  const newSection = {...database, id: 'db-02', meetings: [[1, 660, 720]]};
  const newCourse = {id: 'web-01', courseId: 'web', name: '웹', meetings: [[4, 630, 690]]};
  const command = {type: 'replace', candidate: {sections: [networks, newSection, newCourse]}, effectiveDate: '2026-10-26'};
  const snapshot = structuredClone(state);
  const preview = previewCalendar(state, command);
  assert.equal(preview.requiresReview, true);
  assert.deepEqual(new Set(preview.review.map(item => item.id)), new Set([future.id, makeup.id, exam.id]));
  assert.throws(() => applyCalendar(state, preview, {acceptConflicts: true}), {code: 'REVIEW_REQUIRED'});
  assert.deepEqual(state, snapshot);
  const decisions = Object.fromEntries(preview.review.map(item => [item.id, 'keep']));
  state = commit(state, {...command, decisions});
  assert.deepEqual(get(state, personal.id), personal);
  assert.deepEqual(get(state, unchanged.id), unchanged);
  assert.deepEqual(get(state, past.id), past);
  assert.deepEqual(get(state, exam.id), exam);
  assert.deepEqual(get(state, makeup.id), makeup);
  assert.equal(get(state, future.id).status, 'cancelled');
  assert.equal(get(state, future.id).retired, true);
  assert.ok(state.events.filter(e => e.sectionId === 'db-02').every(e => e.date >= command.effectiveDate));
  assert.ok(state.events.some(e => e.sectionId === 'web-01'));
  assert.ok(state.events.some(e => e.sectionId === 'db-01' && e.original?.date > command.effectiveDate && e.retired));
  assert.equal(commit(state, command), state);
  state = commit(state, {type: 'undo', operationId: state.history.at(-1).id});
  assert.deepEqual(state.events, snapshot.events);
});

test('같은 분반의 시간 블록 순서를 바꿔도 일정·예외 ID를 유지한다', () => {
  let state = initialized();
  const first = find(state, start);
  state = commit(state, edit(first.id, {patch: {location: '임시 장소'}}));
  const reordered = {sections: [networks, {...database, meetings: database.meetings.toReversed()}]};
  const preview = previewCalendar(state, {type: 'replace', candidate: reordered, effectiveDate: start});
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.changes, []);
  assert.deepEqual(preview.review, []);
  assert.deepEqual(applyCalendar(state, preview).events, state.events);
});

test('v1 일정·휴강·개인 일정·수강 기록을 불러오고 첫 성공 저장에서만 v2로 전환한다', () => {
  const state = initialized();
  const [lesson, second, ...rest] = state.events.map(({sectionId, ...event}) => event);
  const cancelled = {...lesson, status: 'cancelled'};
  const legacyExam = {...second, kind: 'exam', title: '기존 대체 시험'};
  const personal = {id: 'old-personal', kind: 'personal', title: '기존 약속', date: start, start: 780, end: 840, location: '', status: 'active'};
  const experiences = [{id: 'old', title: '기존 기록', body: '이유', courseNames: ['데이터베이스']}];
  let raw = JSON.stringify({version: 1, semester: state.semester, events: [cancelled, legacyExam, ...rest, personal], experiences});
  const originalRaw = raw;
  let fail = true;
  const adapter = {getItem: key => {assert.equal(key, storageKey); return raw;}, setItem: (_, value) => {
    if (fail) throw new Error('QuotaExceededError');
    raw = value;
  }};
  const store = createPlannerStore(adapter);
  const loaded = store.data;
  assert.equal(loaded.version, 2);
  assert.equal(get(loaded, cancelled.id).exception, true);
  assert.equal(get(loaded, cancelled.id).status, 'cancelled');
  assert.deepEqual(get(loaded, personal.id), personal);
  assert.deepEqual(loaded.experiences, experiences);
  assert.equal(get(loaded, legacyExam.id).examMode, 'replacement');
  assert.equal(get(loaded, legacyExam.id).seriesId, undefined);
  assert.equal(raw, originalRaw);
  const preview = store.preview(edit(personal.id, {patch: {title: '변경 약속'}}));
  assert.throws(() => store.apply(preview), /저장하지 못/);
  assert.equal(store.data, loaded);
  assert.equal(raw, originalRaw);
  const otherTab = createPlannerStore(adapter);
  fail = false;
  store.apply(preview);
  assert.equal(JSON.parse(raw).version, 2);
  assert.deepEqual(loadCalendar(JSON.parse(raw)), store.data);
  const otherPreview = otherTab.preview(edit(personal.id, {action: 'cancel'}));
  assert.throws(() => otherTab.apply(otherPreview), /다른 탭/);
  assert.equal(otherTab.data.revision, 0);
});

test('같은 분반의 일부 블록 변경과 재등록은 기존 ID와 새 반복 수업을 구분한다', () => {
  let state = initialized();
  const kept = find(state, '2026-10-28'), withdrawn = find(state, '2026-10-26');
  state = commit(state, edit(kept.id, {patch: {location: '변경한 장소'}}));
  const movedBlock = {...database, meetings: [[1, 810, 870], ...database.meetings.slice(1)]};
  state = commit(state, {type: 'replace', effectiveDate: '2026-10-26', candidate: {sections: [movedBlock, networks]}});
  assert.equal(get(state, kept.id).location, '변경한 장소');
  assert.equal(get(state, withdrawn.id).retired, true);
  const newBlock = find(state, '2026-10-27', 810);
  assert.notEqual(newBlock.seriesId, withdrawn.seriesId);
  state = commit(state, {type: 'replace', effectiveDate: '2026-10-26', candidate});
  const reinstated = state.events.filter(event => event.courseId === 'db' && event.date === '2026-10-26' && event.start === 540);
  assert.equal(reinstated.length, 2);
  assert.equal(reinstated.filter(event => event.status === 'active').length, 1);
  assert.equal(get(state, withdrawn.id).status, 'cancelled');
  assert.equal(new Set(state.events.map(event => event.id)).size, state.events.length);
});

test('교체 검토에서 이전 날짜의 표시 상태를 바꾸는 시험 취소를 막는다', () => {
  let state = initialized();
  const original = find(state, start);
  state = commit(state, add('exam', {originalEventId: original.id, examMode: 'replacement'}, {date: '2026-10-29'}));
  const exam = state.events.at(-1);
  const command = {type: 'replace', candidate: {sections: [networks]}, effectiveDate: '2026-10-26'};
  const preview = previewCalendar(state, command);
  assert.deepEqual(preview.review.map(item => [item.id, item.options]), [[exam.id, ['keep']]]);
  assert.equal(previewCalendar(state, {...command, decisions: {[exam.id]: 'cancel'}}).ok, false);
  state = commit(state, {...command, decisions: {[exam.id]: 'keep'}});
  assert.equal(calendarEvents(state.events).find(event => event.id === original.id).replacedBy, exam.id);
});

test('자정을 넘는 LMS 일정의 교집합을 계산하고 확인 도중 바뀐 외부 일정은 다시 확인한다', () => {
  const state = initialized();
  const command = add('personal', {}, {start: 30, end: 90});
  const external = {source: 'lms', id: 'lms-event', title: 'LMS 일정', status: 'active',
    date: '2026-10-18', endDate: start, start: 1380, end: 60};
  const preview = previewCalendar(state, command, {externalEvents: [external]});
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.conflicts.map(({date, start, end}) => [date, start, end]), [['2026-10-19', 30, 60]]);
  assert.throws(() => applyCalendar(state, preview, {acceptConflicts: true}), {code: 'STALE_PREVIEW'});
  assert.ok(applyCalendar(state, preview, {acceptConflicts: true, externalEvents: [external]}));
});
