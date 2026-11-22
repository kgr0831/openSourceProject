import assert from 'node:assert/strict';
import test from 'node:test';
import {addEmptyGuidance} from '../empty-guidance.mjs';
import {relaxationChoices} from '../public/relaxation-options.mjs';

const course = (name, ...meetings) => ({id: name, name, credits: 3,
  sections: meetings.map((slots, i) => ({id: name + '-' + i, meetings: slots}))});
const missing = course('시간미상', [], []);
const early = course('이른수업', [[2, 540, 615], [2, 630, 705]]);
const partlyUnknown = course('일부미상', [], [[2, 540, 615]]);
const valid = course('수요일수업', [[2, 630, 705]]);
const catalog = [missing, early, partlyUnknown, valid];
const base = {
  term: '2026-2', department: '학과', allowedDays: [2], earliestStart: 600, latestEnd: 1080, attendanceDays: null,
  credits: {total: {min: 3, max: 3}, major: {min: 3, max: 3}, general: {min: 0, max: 0}},
  requiredCourseIds: [], excludedCourseIds: [], lockedSectionIds: [], excludedSectionIds: [],
  relaxationPolicy: {max_changed: 0, rules: {}}, lunch: {enabled: false}, morning: null
};
const check = (request, status = 'INFEASIBLE') => ({
  request: {...base, ...request}, total: 0, candidates: [], diagnostics: ['분반 제외 진단', '기존 마지막 문장'],
  solver: {original_status: status}
});
const lookup = (_, {courseIds, sectionIds}) => catalog.filter(c => courseIds.has(c.id) || c.sections.some(s => sectionIds.has(s.id)));
const guide = (result, generateCandidates = async () => ({candidates: []}), mode = 'recommend') =>
  addEmptyGuidance(result, {getCourses: lookup, generateCandidates, mode});

test('선택한 과목 전체의 시간이 미상일 때만 그 과목을 사유에 넣는다', async () => {
  const result = check({requiredCourseIds: [missing.id]});
  const explained = await guide(result);
  assert.strictEqual(explained.diagnostics, result.diagnostics);
  assert.deepEqual(explained.emptyGuidance, {reasons: [{kind: 'missing', course: missing.name}], options: []});
  const partial = await guide(check({requiredCourseIds: [partlyUnknown.id]}));
  assert.deepEqual(partial.emptyGuidance.reasons, []);
  const unrelated = await guide(check({requiredCourseIds: [valid.id]}));
  assert.deepEqual(unrelated.emptyGuidance.reasons, []);
});

test('실제 시간 근거로 시각 변경을 별도 요청하고 원래 과목과 조건을 보존한다', async () => {
  const original = check({requiredCourseIds: [early.id], excludedCourseIds: [valid.id], lockedSectionIds: [early.sections[0].id],
    excludedSectionIds: [partlyUnknown.sections[1].id]});
  const snapshot = structuredClone(original);
  const candidate = {id: 'time-option', sections: [{courseId: early.id}], solverResult: {changes: []}};
  const solved = await guide(original, async (request, options) => {
    if (options.mode === 'relax') {
      assert.deepEqual(request, {...original.request, relaxationPolicy: request.relaxationPolicy});
      return {candidates: []};
    }
    assert.deepEqual(request, {...original.request, earliestStart: 540});
    return {candidates: [{...candidate, requestSnapshot: request}]};
  });
  assert.deepEqual(original, snapshot);
  assert.deepEqual(solved.emptyGuidance.reasons, [{kind: 'early', course: early.name,
    issues: [{kind: 'early', day: 2, minute: 540, limit: 600}]}]);
  const [option] = solved.emptyGuidance.options;
  assert.deepEqual(option.changes, [{condition: 'earliest_start', from: 600, to: 540}]);
  assert.deepEqual(option.candidate.previewChanges, option.changes);
  assert.deepEqual(option.candidate.solverResult.changes, []);
});

test('이미 지정한 허용 범위를 사용하고 변경안은 조건 수로 정렬·중복 제거한다', async () => {
  const policy = {max_changed: 2, rules: {
    attendance_days: {allow: true, importance: 1, step: 1, allowed_values: [1]},
    lunch_duration: {allow: true, importance: 1, step: 15, allowed_values: [45]},
    morning_limit: {allow: false}
  }};
  const original = check({requiredCourseIds: [valid.id], attendanceDays: {mode: 'exact', value: 2},
    lunch: {enabled: true, duration: 60, window_start: 720, window_end: 840, placement: 'within_window'}, relaxationPolicy: policy});
  const one = {condition: 'attendance_days', from: 2, to: 1};
  // The result mapping also accepts mixed change counts, for example if
  // candidate search is extended to return something beyond minimum cost.
  const two = [one, {condition: 'lunch_duration', from: 60, to: 45}];
  const response = await guide(original, async (request, options) => {
    assert.equal(options.mode, 'relax');
    assert.deepEqual(request.relaxationPolicy, policy);
    assert.deepEqual(request.requiredCourseIds, original.request.requiredCourseIds);
    return {candidates: [
      {id: 'two', solverResult: {changes: two}},
      {id: 'one', solverResult: {changes: [one]}},
      {id: 'same-policy', solverResult: {changes: [one]}}
    ]};
  });
  assert.deepEqual(response.emptyGuidance.reasons, [{kind: 'attendance', actual: 1, expected: 2}]);
  assert.deepEqual(response.emptyGuidance.options.map(option => option.candidate.id), ['one', 'two']);
});

test('시간 초과와 분반 대체 요청은 원인 안내에서 제외하고 엔진 오류는 전달한다', async () => {
  const notProven = check({requiredCourseIds: [valid.id]}, 'UNKNOWN');
  const failIfCalled = () => { throw new Error('변경안을 탐색하면 안 돼요.'); };
  assert.strictEqual(await guide(notProven, failIfCalled), notProven);
  const alternative = check({requiredCourseIds: [valid.id]});
  assert.strictEqual(await guide(alternative, failIfCalled, 'alternative'), alternative);
  await assert.rejects(guide(alternative, () => { throw new Error('엔진 연결 실패'); }), /엔진 연결 실패/);
});

test('총 학점 제안은 0.5학점과 24학점 경계에서도 기존 완화 단위를 지킨다', () => {
  const request = {...base, credits: {...base.credits, total: {min: 1, max: 23.5}}};
  assert.deepEqual(relaxationChoices(request).credit_range, undefined);
  const boundary = {...base, credits: {...base.credits, total: {min: 1.5, max: 23}}};
  assert.deepEqual(relaxationChoices(boundary).credit_range.values, [{min: 0.5, max: 24}, {min: 0.5, max: 24}]);
});
