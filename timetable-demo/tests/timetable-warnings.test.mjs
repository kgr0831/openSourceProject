import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogVersion, getCourses} from '../catalog.mjs';
import {checkCourseCompatibility} from '../course-compatibility.mjs';
import {createTimetableServer} from '../server.mjs';
import {travelWarnings} from '../public/travel-warnings.mjs';

const scope = {term: '2026-2', department: 'AI소프트웨어학부'};
const catalog = getCourses(scope);
const course = name => catalog.find(entry => entry.name === name);
const special = course('소프트웨어특강2');
const statistics = course('확률및통계');
const onDevice = course('온디바이스AI');
const fixedSoftware = 'ssu-2026-2-2150167102';
const check = (courses, extra = {}) => checkCourseCompatibility(getCourses, {
  ...scope, requiredCourseIds: courses.map(entry => entry.id), ...extra
});

test('2026-2 AI소프트웨어학부의 두 번째 시간 블록 충돌과 대체 가능 분반을 확인한다', () => {
  const conflict = check([special, statistics]);
  assert.equal(conflict.status, 'conflict');
  assert.deepEqual(conflict.courses.map(({name}) => name), ['소프트웨어특강2', '확률및통계']);
  assert.deepEqual(conflict.overlap, {day: 2, start: 630, end: 705});
  assert.equal(conflict.overlapIsExample, false);
  assert.deepEqual(check([special, onDevice]), {status: 'compatible'});
  assert.equal(check([special, onDevice], {lockedSectionIds: [fixedSoftware]}).status, 'conflict');
  assert.equal(check([special], {lockedSectionIds: [fixedSoftware]}).status, 'conflict');
  assert.equal(check([special, onDevice], {excludedSectionIds: ['ssu-2026-2-2150167101']}).status, 'conflict');
  assert.equal(check([onDevice], {excludedSectionIds: onDevice.sections.map(s => s.id)}).status, 'unavailable');
});

function timesCourse(id, ...meetingsLists) {
  return {id, name: id, sections: meetingsLists.map((meetings, i) => ({id: id + i, meetings}))};
}

test('전체 세 과목 조합을 검사하고 끝과 시작이 같은 시간은 허용한다', () => {
  const first = [[0, 600, 660]], second = [[0, 660, 720]];
  const groups = ['A', 'B', 'C'].map(name => timesCourse(name, first, second));
  groups.push(timesCourse('D', [[1, 600, 660]]));
  const lookup = (_, {courseIds}) => groups.filter(entry => courseIds.has(entry.id));
  for (const pair of [['A', 'B'], ['A', 'C'], ['B', 'C']]) {
    assert.equal(checkCourseCompatibility(lookup, {requiredCourseIds: pair}).status, 'compatible');
  }
  const result = checkCourseCompatibility(lookup, {requiredCourseIds: ['A', 'B', 'C', 'D']});
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.courses.map(({id}) => id), ['A', 'B', 'C']);
  assert.equal(result.overlap, undefined);
});

test('미등록 시간이 결과에 필요한지 확인하고 시간 초과를 충돌과 구분한다', () => {
  const first = [[0, 600, 660]], second = [[0, 660, 720]];
  const groups = [timesCourse('A', first), timesCourse('B', first), timesCourse('C', []),
    timesCourse('D', first, []), timesCourse('E', second, [])];
  const lookup = (_, {courseIds}) => groups.filter(entry => courseIds.has(entry.id));
  const run = (requiredCourseIds, options) => checkCourseCompatibility(lookup, {requiredCourseIds}, options);
  assert.equal(run(['A', 'C']).reason, 'missing_times');
  assert.equal(run(['A', 'D']).reason, 'missing_times');
  assert.equal(run(['A', 'E']).status, 'compatible');
  assert.equal(run(['A', 'B', 'C']).status, 'conflict');
  assert.deepEqual(run(['A', 'E'], {timeLimitMs: 0}), {status: 'unknown', reason: 'timeout'});
});

test('호환성 API는 선택 학기의 분반만 조회하고 메타데이터는 간략하게 유지한다', async t => {
  const server = createTimetableServer({port: 0});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await server.closeServices();
    await new Promise(resolve => server.close(resolve));
  });
  const root = 'http://127.0.0.1:' + server.address().port;
  const meta = await fetch(root + '/api/meta?' + new URLSearchParams(scope)).then(r => r.json());
  assert.ok(meta.courses.some(entry => entry.id === special.id));
  assert.ok(meta.courses.every(entry => !Object.hasOwn(entry, 'sections')));

  const scoped = getCourses(scope, {courseIds: new Set([special.id]), sectionIds: new Set([fixedSoftware])});
  assert.deepEqual(new Set(scoped.map(entry => entry.id)), new Set([special.id, onDevice.id]));
  const request = { ...scope, catalogVersion, requiredCourseIds: [special.id, statistics.id],
    credits: {total: {min: 24, max: 24}}, allowedDays: [], lunch: {enabled: true} };
  const post = body => fetch(root + '/api/course-compatibility', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-Timetable-App': '1'}, body: JSON.stringify(body)
  });
  const response = await post(request);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.courses.map(({id}) => id), [special.id, statistics.id]);
  assert.ok(result.courses.every(entry => !Object.hasOwn(entry, 'sections')));
  const compatible = await post({...request, requiredCourseIds: [special.id, onDevice.id]});
  assert.deepEqual(await compatible.json(), {status: 'compatible'});
  assert.equal((await post({...request, term: '2026-1'})).status, 400);
  assert.equal((await post({...request, department: '경영학부'})).status, 400);
  assert.equal((await post({...request, catalogVersion: 'old'})).status, 400);
});

const fromRoom = '문화관 03411(AI SPACE)', toRoom = '정보과학관 21303';
const route = (walkMinutes, from = '문화관', to = '정보과학관') => ({
  from, to, walkMinutes, source: '테스트 측정', measuredOn: '2026-11-18', advisoryMaxGapMinutes: 15
});
const journey = (gap, from = fromRoom, to = toRoom) => [
  {meetings: [[4, 810, 885]], locations: [from]},
  {meetings: [[4, 885 + gap, 960 + gap]], locations: [to]}
];

test('실제 금요일 15분 경로를 경험 기반으로 안내하고 방향과 실측 우선순위를 지킨다', () => {
  const forensics = course('디지털포렌식개론').sections.find(s => s.id === 'ssu-2026-2-2150166901');
  const algorithm = course('알고리즘').sections.find(s => s.id === 'ssu-2026-2-2150163303');
  assert.deepEqual(travelWarnings([algorithm, forensics]), [{
    kind: 'advisory', day: 4, fromEnd: 885, toStart: 900,
    gapMinutes: 15, fromBuilding: '문화관', toBuilding: '정보과학관'
  }]);
  assert.equal(travelWarnings(journey(16)).length, 0);
  assert.equal(travelWarnings(journey(15, toRoom, fromRoom)).length, 0);
  assert.equal(travelWarnings(journey(15), [route(7)]).length, 0);
  assert.equal(travelWarnings(journey(15), [route(14)])[0].spareMinutes, -2);
});

test('이동 29분·30분, 여유 0분·2분·3분 경계와 층 보정을 확인한다', () => {
  const measured = [route(24)];
  const [tight] = travelWarnings(journey(29), measured);
  assert.equal(tight.kind, 'tight');
  assert.equal(tight.estimatedMinutes, 27);
  assert.equal(tight.spareMinutes, 2);
  assert.deepEqual(travelWarnings(journey(30), [route(29)]), []);
  assert.equal(travelWarnings(journey(27), measured)[0].kind, 'tight');
  assert.equal(travelWarnings(journey(26), measured)[0].kind, 'short');
  assert.equal(travelWarnings(journey(27), [route(21)]).length, 0);
  assert.equal(travelWarnings(journey(26), [route(21)])[0].spareMinutes, 2);
  assert.equal(travelWarnings(journey(0), measured)[0].spareMinutes, -27);
});

test('요일별 강의실을 유지하고 온라인·동일 강의실·근거 없는 이동은 제외한다', () => {
  const alternating = {meetings: [[1, 810, 885], [4, 810, 885]], locations: ['다른건물 12345', fromRoom]};
  const after = {meetings: [[1, 900, 975], [4, 900, 975]], locations: [toRoom, toRoom]};
  assert.deepEqual(travelWarnings([after, alternating]).map(w => w.day), [4]);
  assert.deepEqual(travelWarnings(journey(0, '다른건물 12345', toRoom)), []);
  assert.deepEqual(travelWarnings(journey(0), []), []);
  assert.deepEqual(travelWarnings(journey(-1)), []);
  assert.deepEqual(travelWarnings(journey(0, '온라인', toRoom)), []);
  const remote = journey(0);
  remote[0].lectureType = '비대면+녹화';
  assert.deepEqual(travelWarnings(remote), []);
  remote[0].lectureType = '대면+녹화';
  assert.equal(travelWarnings(remote).length, 1);
  remote[0].locations = [];
  remote[0].location = fromRoom;
  assert.deepEqual(travelWarnings(remote), []);
  const inside = [route(4, '문화관', '문화관')];
  assert.deepEqual(travelWarnings(journey(0, fromRoom, '문화관 03411'), inside), []);
  assert.equal(travelWarnings(journey(6, fromRoom, '문화관 03602'), inside)[0].estimatedMinutes, 4);
  assert.deepEqual(travelWarnings(journey(7, fromRoom, '문화관 03602'), inside), []);
  const differentDays = journey(0);
  differentDays[1].meetings[0][0] = 5;
  assert.deepEqual(travelWarnings(differentDays), []);
  const interveningOnline = [...journey(15), {meetings: [[4, 885, 900]], locations: ['온라인']}];
  assert.deepEqual(travelWarnings(interveningOnline), []);
});
