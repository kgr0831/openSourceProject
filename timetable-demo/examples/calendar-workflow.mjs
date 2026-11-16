import assert from 'node:assert/strict';
import {createPlannerStore} from '../public/planner.js';

const browserStorage = new Map();
const store = createPlannerStore({
  getItem: key => browserStorage.get(key) ?? null,
  setItem: (key, value) => browserStorage.set(key, value)
});
const start = '2026-10-19', end = '2026-11-08';
const section = {id: 'db-01', courseId: 'db', name: '데이터베이스', building: '정보관',
  meetings: [[0, 540, 630], [2, 540, 630]]};

function apply(command) {
  const preview = store.preview(command);
  assert.ok(preview.ok, preview.errors[0]?.message);
  store.apply(preview);
  return preview;
}

apply({type: 'initialize', candidate: {sections: [section]}, start, end});
const first = store.data.events.find(event => event.date === start);
console.log('시간표 확정 및 학기 일정 생성', store.data.events.length);

apply({type: 'edit', id: first.id, action: 'cancel'});
const personal = {kind: 'personal', title: '개인 약속', date: '2026-10-20', start: 600, end: 660, location: ''};
apply({type: 'add', event: personal});
const personalId = store.data.events.at(-1).id;

const makeup = {kind: 'makeup', title: '데이터베이스 보강', date: personal.date, start: 630, end: 690, location: '정보관'};
const preview = store.preview({type: 'add', event: makeup, originalEventId: first.id});
assert.ok(preview.ok, preview.errors[0]?.message);
assert.deepEqual(preview.conflicts.map(({start, end}) => [start, end]), [[630, 660]]);
assert.throws(() => store.apply(preview), {code: 'CONFLICT_CONFIRMATION_REQUIRED'});
console.log('휴강 수업 보강 미리보기', preview.conflicts);
store.apply(preview, {acceptConflicts: true});
const makeupId = store.data.events.at(-1).id;
assert.equal(store.data.events.at(-1).originalEventId, first.id);

apply({type: 'undo', operationId: store.data.history.at(-1).id});
assert.ok(!store.data.events.some(event => event.id === makeupId));
assert.equal(store.data.events.find(event => event.id === first.id).status, 'cancelled');
console.log('보강 등록 되돌리기 완료');

const futureLesson = store.data.events.find(event => event.date === '2026-10-26');
apply({type: 'edit', id: futureLesson.id, action: 'cancel'});
apply({type: 'add', event: {kind: 'exam', title: '별도 시험', date: '2026-10-29',
  start: 720, end: 780, location: ''}, courseId: 'db', examMode: 'additional'});
const examId = store.data.events.at(-1).id;
const replace = {type: 'replace', effectiveDate: '2026-10-26',
  candidate: {sections: [{...section, id: 'db-02', meetings: [[1, 540, 630]]}]}};
const review = store.preview(replace);
assert.equal(review.requiresReview, true);
assert.deepEqual(new Set(review.review.map(item => item.id)), new Set([futureLesson.id, examId]));
assert.throws(() => store.apply(review), {code: 'REVIEW_REQUIRED'});
apply({...replace, decisions: Object.fromEntries(review.review.map(item => [item.id, 'keep']))});

const event = id => store.data.events.find(entry => entry.id === id);
assert.equal(event(personalId).title, personal.title);
assert.equal(event(first.id).status, 'cancelled');
assert.equal(event(futureLesson.id).status, 'cancelled');
assert.equal(event(examId).sectionId, 'db-01');
assert.ok(store.data.events.some(entry => entry.sectionId === 'db-02' && entry.date >= replace.effectiveDate));
console.log('분반 변경 완료. 개인 일정, 과거·이후 휴강, 기존 분반의 별도 시험을 확인했습니다.');
