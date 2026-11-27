import test from 'node:test';
import assert from 'node:assert/strict';
import {timetable} from '../public/ui.js';

const lanes = html => [...html.matchAll(/data-lane="(\d)" data-lanes="(\d)"/g)].map(m => m[1] + '/' + m[2]);

test('겹치는 수업은 같은 칸에서 나란히 놓고, 겹치지 않는 수업은 칸 전체를 쓴다', () => {
  const html = timetable({sections: [
    {courseId: 'a', name: 'A', meetings: [[2, 630, 705]]},
    {courseId: 'b', name: 'B', meetings: [[2, 630, 705], [4, 900, 975]]},
    {courseId: 'c', name: 'C', meetings: [[2, 720, 780]]}
  ]}, 'none');
  assert.deepEqual(lanes(html), ['0/2', '1/2']);
});

test('생활 패턴 범위 밖 요일과 시간을 주간표에 표시한다', () => {
  const html = timetable({sections: []}, 'none', {empty: true, window: {allowedDays: [0, 1, 2, 3], earliestStart: 600, latestEnd: 1020}});
  assert.equal((html.match(/day-column off/g) || []).length, 1);
  assert.equal((html.match(/class="off-hours"/g) || []).length, 2);
});
