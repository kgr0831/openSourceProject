import {addDays, kindLabels, parseDate, timeText, weekStart} from './planner-core.mjs';
import {lmsKindLabel, lmsTimeLabel} from './lms-calendar.mjs';

export const calendarTimeZone = 'Asia/Seoul';
export const calendarViews = {week: 'timeGridWeek', month: 'dayGridMonth', day: 'listDay'};
const seoulDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: calendarTimeZone, year: 'numeric', month: '2-digit', day: '2-digit'
});
const dayLabel = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'short'
});
const courseHues = [215, 157, 280, 29, 343, 183, 52, 240, 5, 110, 305, 195, 75, 265, 130, 323];

export const koreanDate = date => seoulDate.format(date);
export const calendarDateLabel = date => dayLabel.format(parseDate(date));

export function stepCalendarDate(date, mode, direction) {
  if (mode !== 'month') return addDays(date, direction * (mode === 'week' ? 7 : 1));
  const next = parseDate(date), day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + direction + 1, 0);
  next.setUTCDate(Math.min(day, next.getUTCDate()));
  return next.toISOString().slice(0, 10);
}

export function calendarPeriodLabel(date, mode) {
  if (mode === 'day') return calendarDateLabel(date);
  if (mode === 'month') return date.slice(0, 4) + '년 ' + Number(date.slice(5, 7)) + '월';
  const monday = weekStart(date);
  return calendarDateLabel(monday) + ' – ' + calendarDateLabel(addDays(monday, 6));
}

const courseKey = event => event.courseId && (event.source === 'lms' ? 'lms:' : 'course:') + event.courseId;
const seoulTime = (date, minute) => date + 'T' + timeText(minute) + ':00+09:00';

function courseColors(index) {
  if (index === undefined) return {fill: '#edf0f5', stroke: '#66758d', ink: '#233047'};
  const hue = courseHues[index % courseHues.length] + 1.7 * Math.floor(index / courseHues.length);
  const light = [92, 83, 88][Math.floor(index / courseHues.length) % 3];
  return {fill: 'hsl(' + hue + ' 64% ' + light + '%)',
    stroke: 'hsl(' + hue + ' 64% 38%)', ink: 'hsl(' + hue + ' 48% 21%)'};
}

export function eventKindLabel(event) {
  if (event.status === 'cancelled') return event.kind === 'class' ? '휴강' : kindLabels[event.kind] + ' 취소';
  if (event.source === 'lms') return 'LMS · ' + lmsKindLabel(event);
  if (event.examMode === 'replacement') return '대체 시험';
  if (event.examMode === 'additional') return '별도 시험';
  return kindLabels[event.kind];
}

export function eventTimeLabel(event) {
  return event.source === 'lms' ? lmsTimeLabel(event) : timeText(event.start) + '–' + timeText(event.end);
}

// Preserve historical course order, including hidden events, so filtering and replacing a section
// never change colors already assigned to courses. The first group is reserved for timetable courses.
export function toCalendarEvents(events, {showClasses = true} = {}) {
  const keys = new Set([...events.filter(event => event.source !== 'lms'), ...events.filter(event => event.source === 'lms')]
    .map(courseKey).filter(Boolean));
  const indices = new Map([...keys].map((key, index) => [key, index]));
  return events.filter(event => !event.replacedBy &&
    (showClasses || event.kind !== 'class' || event.status === 'cancelled')).map(event => {
    const lms = event.source === 'lms';
    const start = event.allDay ? event.date : lms ? event.startAt : seoulTime(event.date, event.start);
    const end = event.allDay ? event.endDate : lms ? event.endAt : seoulTime(event.date, event.end);
    const colors = courseColors(indices.get(courseKey(event)));
    return {
      id: event.id, title: event.title, start, ...(end ? {end} : {}), allDay: lms && event.allDay,
      color: colors.fill,
      extendedProps: {date: event.date, kind: event.kind, label: eventKindLabel(event), status: event.status,
        location: event.location, time: eventTimeLabel(event), point: lms && event.point, colors}
    };
  });
}
