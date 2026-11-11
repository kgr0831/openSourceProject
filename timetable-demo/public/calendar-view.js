import {calendarTimeZone, calendarViews, koreanDate} from './calendar-display.mjs';
import {timeValue} from './planner-core.mjs';

export const calendarHeight = mode => mode === 'week' ? 650 : 'auto';

export function highlightCalendarDate(element, date) {
  for (const cell of element.querySelectorAll('[data-calendar-day], [data-calendar-header]')) {
    cell.toggleAttribute('data-calendar-selected', (cell.dataset.calendarDay || cell.dataset.calendarHeader) === date);
  }
}

function eventContent({event, timeText, view}) {
  const {label, location, point, time} = event.extendedProps;
  const element = document.createElement('span');
  element.className = 'calendar-event-content';
  function add(tag, className, text) {
    if (!text) return;
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    element.append(node);
  }
  add('span', 'calendar-event-kind', label);
  add('strong', 'calendar-event-title', event.title);
  if (view.type !== calendarViews.day) {
    add('span', 'calendar-event-time', event.allDay || point ? time : timeText || time);
  }
  add('span', 'calendar-event-location', location);
  return {domNodes: [element]};
}

export function mountCalendar(element, {mode, date, selectedDate, events, onOpen, onDay, onTime}) {
  if (!globalThis.FullCalendar?.Calendar) {
    element.textContent = '캘린더 구성 요소를 읽지 못했어요. 시간표 데모 시작 파일을 다시 실행해 주세요.';
    return null;
  }
  const calendar = new globalThis.FullCalendar.Calendar(element, {
    initialView: calendarViews[mode], initialDate: date, timeZone: calendarTimeZone, locale: 'ko',
    firstDay: 1, headerToolbar: false, height: calendarHeight(mode), scrollTime: '07:45:00', scrollTimeReset: false,
    slotDuration: '00:30:00', slotMinHeight: 16, slotHeaderFormat: {hour: '2-digit', minute: '2-digit', hour12: false},
    dayHeaderFormat: {weekday: 'short', day: 'numeric'},
    eventTimeFormat: {hour: '2-digit', minute: '2-digit', hour12: false},
    displayEventEnd: true, slotEventOverlap: false, eventMinHeight: 16,
    defaultTimedEventDuration: {milliseconds: 1}, forceEventDuration: false,
    aspectRatio: 1.75, fixedWeekCount: false, dayMaxEvents: 3, editable: false, eventInteractive: true, navLinks: true,
    views: {dayGridMonth: {eventDisplay: 'block'}},
    events(_range, success) { success(events()); },
    datesSet() { highlightCalendarDate(element, selectedDate()); },
    navLinkDayClick(day) { onDay(koreanDate(day)); },
    dateClick(info) {
      if (info.allDay) onDay(info.dateStr.slice(0, 10));
      else onTime(info.dateStr.slice(0, 10), timeValue(info.dateStr.slice(11, 16)));
    },
    eventClick(info) { onOpen(info.event.id); },
    eventClass({event}) {
      const {kind, status, point} = event.extendedProps;
      return ['calendar-event', 'calendar-event-' + kind,
        ...(status === 'cancelled' ? ['calendar-event-cancelled'] : []),
        ...(point ? ['calendar-event-point'] : [])].join(' ');
    },
    eventContent,
    eventDidMount({event, el}) {
      const {label, location, time, date, colors, point} = event.extendedProps;
      el.dataset.calendarEvent = event.id;
      el.dataset.eventDate = date;
      el.style.setProperty('--calendar-event-fill', colors.fill);
      el.style.setProperty('--calendar-event-stroke', colors.stroke);
      el.style.setProperty('--calendar-event-ink', colors.ink);
      const summary = [label, event.title, time, location].filter(Boolean).join(' · ');
      el.setAttribute('aria-label', summary);
      el.title = summary;
      if (point) el.dataset.calendarPoint = 'true';
    },
    dayCellDidMount({el, date}) {
      el.dataset.calendarDay = koreanDate(date);
      el.toggleAttribute('data-calendar-selected', el.dataset.calendarDay === selectedDate());
    },
    dayHeaderDidMount({el, date, view}) {
      if (view.type !== calendarViews.week) return;
      el.dataset.calendarHeader = koreanDate(date);
      el.toggleAttribute('data-calendar-selected', el.dataset.calendarHeader === selectedDate());
    },
    dayLaneDidMount({el, date}) { el.dataset.calendarLane = koreanDate(date); }
  });
  calendar.render();
  return calendar;
}
