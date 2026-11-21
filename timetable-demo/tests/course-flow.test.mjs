import test from 'node:test';
import assert from 'node:assert/strict';
import {getCourses, catalogVersion} from '../catalog.mjs';
import {checkCourseCompatibility} from '../course-compatibility.mjs';
import {courseCreditPlan, defaultCreditRanges, selectedCredits} from '../public/course-credits.mjs';
import {courseFacets, courseFilterOptions, matchesCourseFilters, sectionTargetYears} from '../public/course-filters.mjs';
import {checkSectionCombinations, evaluateCourseTimes} from '../public/course-times.mjs';

const scope = {term: '2026-2', department: 'AI소프트웨어학부'};
const catalog = getCourses(scope);
const course = name => catalog.find(course => course.name === name);
const special = course('소프트웨어특강2'), algorithm = course('알고리즘'), statistics = course('확률및통계');
const choices = names => checkCourseCompatibility(getCourses, {
  ...scope, catalogVersion, requiredCourseIds: names.map(entry => entry.id), includeSections: true
}).selected;
const filters = (completion, credits, years) => ({completion, credits, years});

test('실제 이수구분만 분류하며 분반과 학년 조건을 같은 분반에서 적용한다', () => {
  const mixed = {credits: 2, facets: courseFacets([
    {classification: '전필-소프트', target: '4학년 AI소프트웨어학부'},
    {classification: '전선-소프트', target: '2학년 AI소프트웨어학부'},
    {classification: '전기-소프트', target: '4학년'},
    {classification: '채플', target: '1학년'},
    {classification: '교직전공-화공', target: '전체학년'}
  ])};
  assert.deepEqual(mixed.facets.map(facet => facet.completion), ['required', 'elective', null, null, null]);
  assert.equal(matchesCourseFilters(mixed, filters(['elective'], ['2'], ['4'])), false);
  assert.equal(matchesCourseFilters(mixed, filters(['elective'], ['2', '3'], ['1', '2'])), true);
  assert.equal(matchesCourseFilters(mixed, filters(['required', 'elective'], ['2'], ['4'])), true);
  assert.equal(matchesCourseFilters(mixed, filters([], [], ['all'])), true);
});

test('대상 학년과 수강 제한 문구를 구분하고 자료에 있는 학점 선택지를 사용한다', () => {
  assert.deepEqual(sectionTargetYears('1·2학년 수강불가'), []);
  assert.deepEqual(sectionTargetYears('수강불가 1·2학년'), []);
  assert.deepEqual(sectionTargetYears('1학년(수강 불가)'), []);
  assert.deepEqual(sectionTargetYears('수강 제한: 1학년 및 2학년'), []);
  assert.deepEqual(sectionTargetYears('전체학년 컴퓨터(1,2학년 수강 불가)'), ['all']);
  assert.deepEqual(sectionTargetYears('3학년 전체, 1·2학년 수강불가'), ['3']);
  assert.deepEqual(sectionTargetYears('2학년 전체 3학년 전체 4학년 전체 5학년 전체'), ['2', '3', '4', '5']);
  assert.deepEqual(sectionTargetYears('1~3학년 수강대상'), ['1', '2', '3']);
  const scoped = catalog.map(course => ({...course, facets: courseFacets(course.sections)}));
  assert.deepEqual(courseFilterOptions(scoped).credits, [0.5, 1, 2, 3, 6]);
  const filtered = scoped.filter(entry => entry.kind === 'major' &&
    matchesCourseFilters(entry, filters(['elective'], ['3'], ['4'])));
  assert.ok(filtered.some(entry => entry.id === special.id));
});

test('과목별 학점은 한 번만 합산하고 수동 목표의 나머지 학점은 전공·교양에 열어 둔다', () => {
  const marked = [special, algorithm, course('온디바이스AI'), course('자료구조')];
  const ids = marked.map(entry => entry.id);
  const selected = selectedCredits(catalog, [...ids, algorithm.id]);
  assert.deepEqual(selected, {count: 4, total: 12, major: 12, general: 0});
  const exact = courseCreditPlan(selected, {mode: 'auto'}, defaultCreditRanges).ranges;
  assert.deepEqual(exact, {total: {min: 12, max: 12}, major: {min: 12, max: 12}, general: {min: 0, max: 0}});
  const manual = courseCreditPlan(selected, {mode: 'goal', value: 18}, exact);
  assert.deepEqual(manual.ranges, {total: {min: 18, max: 18}, major: {min: 12, max: 18}, general: {min: 0, max: 6}});
  const none = selectedCredits(catalog, []);
  assert.deepEqual(courseCreditPlan(none, {mode: 'auto'}, exact).ranges, defaultCreditRanges);
  const mixed = courseCreditPlan({count: 3, total: 8, major: 6, general: 2}, {mode: 'goal', value: 12}, exact);
  assert.deepEqual(mixed.ranges, {total: {min: 12, max: 12}, major: {min: 6, max: 10}, general: {min: 2, max: 6}});
});

test('수동 목표를 넘어선 합계는 이유를 표시하고 상한 및 수동 세부 범위를 보존한다', () => {
  const selected = {count: 7, total: 21, major: 18, general: 3};
  const raised = courseCreditPlan(selected, {mode: 'goal', value: 18}, defaultCreditRanges);
  assert.equal(raised.raisedTo, 21);
  assert.match(raised.message, /18학점.*21학점/);
  assert.equal(courseCreditPlan(selected, {mode: 'goal', value: 21}, defaultCreditRanges).raisedTo, undefined);
  const conflict = courseCreditPlan(selected, {mode: 'ranges'}, raised.ranges);
  assert.equal(conflict.blocked, false);
  const lowerMajor = structuredClone(raised.ranges);
  lowerMajor.major = {min: 15, max: 17};
  const invalid = courseCreditPlan(selected, {mode: 'ranges'}, lowerMajor);
  assert.equal(invalid.blocked, true);
  assert.match(invalid.message, /전공.*18학점.*최대 학점/);
  assert.equal(invalid.ranges, undefined);
  const tooMany = courseCreditPlan({...selected, total: 27, major: 24}, {mode: 'auto'}, defaultCreditRanges);
  assert.equal(tooMany.blocked, true);
  assert.equal(tooMany.ranges, undefined);
  assert.match(tooMany.message, /27학점.*24학점/);
});

test('실제 분반의 모든 블록이 요일·시간에 들어와야 일치한다', () => {
  const selected = choices([special, algorithm]);
  assert.deepEqual(selected.map(group => group.course.id), [special.id, algorithm.id]);
  const window = {allowedDays: [1, 2, 3], earliestStart: 600, latestEnd: 1080};
  const [mismatch, fits] = evaluateCourseTimes(selected, window);
  assert.equal(mismatch.sections.length, 0);
  assert.equal(mismatch.options[0].meetings.length, 2);
  assert.deepEqual(mismatch.options[0].issues, [{kind: 'early', day: 2, minute: 540, limit: 600}]);
  assert.equal(fits.sections.length, 2);
  assert.equal(fits.options.length, 4);
  assert.equal(fits.options[2].issues[0].day, 4);
  assert.deepEqual(fits.sections[0].locations, ['정보과학관 21303', '정보과학관 21303']);
  const [fixed] = evaluateCourseTimes(selected, {...window, earliestStart: 540});
  assert.equal(fixed.sections.length, 1);
  const [late] = evaluateCourseTimes(selected, {...window, earliestStart: 540, latestEnd: 700});
  assert.deepEqual(late.options[0].issues, [{kind: 'late', day: 2, minute: 705, limit: 700}]);
});

test('요일·시간이 맞는 분반과 실제 조합 충돌·미등록·시간 초과를 구분한다', () => {
  const window = {allowedDays: [2, 4], earliestStart: 540, latestEnd: 1080};
  const groups = evaluateCourseTimes(choices([special, statistics]), window);
  assert.deepEqual(groups.map(g => g.sections.length), [1, 1]);
  assert.deepEqual(checkSectionCombinations(groups).overlap, {day: 2, start: 630, end: 705});
  assert.deepEqual(checkSectionCombinations(groups, {timeLimitMs: 0}), {status: 'unknown', reason: 'timeout'});
  const unknown = evaluateCourseTimes([{course: {id: 'untimed', name: '미등록'},
    sections: [{id: 'missing', eligible: true, meetings: []}]}], window);
  assert.equal(checkSectionCombinations([groups[0], unknown[0]]).reason, 'missing_times');
});
