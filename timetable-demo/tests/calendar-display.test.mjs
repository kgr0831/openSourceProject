import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarPeriodLabel, calendarWeekBounds, eventTimeLabel, stepCalendarDate, toCalendarEvents} from '../public/calendar-display.mjs';
import {calendarEvents} from '../public/calendar-logic.mjs';
import {mergeLmsCalendar} from '../public/lms-calendar.mjs';

const lesson = Object.freeze({id: 'db:1', date: '2026-11-09', start: 540, end: 630,
  title: '자료구조', location: '정보관', courseId: 'db', kind: 'class', status: 'active'});

test('주간 시간축은 빈 시간을 줄이되 이른 수업과 자정을 넘는 LMS 일정을 포함한다', () => {
  assert.deepEqual(calendarWeekBounds([], lesson.date), {slotMinTime: '08:00:00', slotMaxTime: '19:00:00'});
  const early = {...lesson, start: 405, end: 450};
  const overnight = {id: 'lms:night', date: '2026-11-10', endDate: '2026-11-11', start: 1410, end: 65, source: 'lms'};
  const point = {id: 'lms:deadline', date: lesson.date, start: 1439, end: 1439, point: true, source: 'lms'};
  assert.deepEqual(calendarWeekBounds([early, point], lesson.date), {slotMinTime: '06:00:00', slotMaxTime: '24:00:00'});
  assert.deepEqual(calendarWeekBounds([overnight], lesson.date), {slotMinTime: '00:00:00', slotMaxTime: '24:00:00'});
  assert.deepEqual(calendarWeekBounds([overnight], '2026-11-16'), {slotMinTime: '08:00:00', slotMaxTime: '19:00:00'});
});

test('주간·일간·월간 날짜 이동은 월말과 연도를 한국 달력 날짜로 계산한다', () => {
  assert.equal(stepCalendarDate('2026-01-31', 'month', 1), '2026-02-28');
  assert.equal(stepCalendarDate('2028-03-31', 'month', -1), '2028-02-29');
  assert.equal(stepCalendarDate('2026-12-28', 'week', 1), '2027-01-04');
  assert.equal(stepCalendarDate('2026-12-31', 'day', 1), '2027-01-01');
  assert.match(calendarPeriodLabel('2026-11-11', 'week'), /11월 9일.*11월 15일/);
});

test('대체 수업은 숨기고 휴강과 시험의 ID·과목 색을 유지하며 원본을 보존한다', () => {
  const another = {...lesson, id: 'net:1', courseId: 'net'};
  const cancelled = {...lesson, id: 'db:2', status: 'cancelled'};
  const exam = {...lesson, id: 'exam:1', kind: 'exam', examMode: 'replacement', originalEventId: lesson.id};
  const data = [lesson, another, cancelled, exam];
  const before = structuredClone(data);
  const normal = toCalendarEvents(calendarEvents(data));
  const filtered = toCalendarEvents(calendarEvents(data), {showClasses: false});
  assert.deepEqual(normal.map(event => event.id), ['net:1', 'db:2', 'exam:1']);
  assert.deepEqual(filtered, normal.slice(1));
  assert.notEqual(normal[0].color, normal[2].color);
  assert.equal(normal[1].color, normal[2].color);
  assert.equal(normal[1].extendedProps.label, '휴강');
  assert.equal(normal[2].extendedProps.label, '대체 시험');
  assert.equal(normal[2].start, '2026-11-09T09:00:00+09:00');
  assert.equal(normal[2].end, '2026-11-09T10:30:00+09:00');
  assert.deepEqual(data, before);
});

test('LMS 날짜 경계, 시점과 실제 시각 구간을 FullCalendar 입력에 그대로 전달한다', () => {
  const accountKey = 'a'.repeat(24), courseId = '10';
  const {cache} = mergeLmsCalendar(null, {id: 'batch', accountKey, collectedAt: '2026-11-10T00:00:00Z',
    courseIds: [courseId], courses: [{id: courseId, name: '설계'}], warnings: [], events: [
      {id: '1'.repeat(24), courseId, title: '마감', kind: 'deadline', startAt: '2026-11-10T14:59:00Z', allDay: false},
      {id: '2'.repeat(24), courseId, title: '기간', kind: 'event', date: '2026-11-11', startAt: '2026-11-10T15:00:00Z',
        endAt: '2026-11-12T15:00:00Z', allDay: true},
      {id: '3'.repeat(24), courseId, title: '야간', kind: 'event', startAt: '2026-11-10T14:30:00Z',
        endAt: '2026-11-10T16:30:00Z', allDay: false}
    ]});
  const [deadline, allDay, overnight] = toCalendarEvents(cache.events);
  assert.equal(deadline.start, '2026-11-10T14:59:00.000Z');
  assert.equal(Object.hasOwn(deadline, 'end'), false);
  assert.equal(deadline.extendedProps.point, true);
  assert.equal(eventTimeLabel(cache.events[0]), '23:59 마감');
  assert.deepEqual([allDay.start, allDay.end, allDay.allDay], ['2026-11-11', '2026-11-13', true]);
  assert.deepEqual([overnight.start, overnight.end], ['2026-11-10T14:30:00.000Z', '2026-11-10T16:30:00.000Z']);
});
