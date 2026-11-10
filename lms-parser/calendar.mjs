import {stableId} from './parse.mjs';

export function calendarEvents(snapshot) {
  const events = new Map();
  for (const course of snapshot.courses) for (const item of course.items) {
    if (item.canvasAssignmentId && course.items.some(other => other.id === `assignment:${course.id}:${item.canvasAssignmentId}`)) continue;
    if (!item.dueAt && !item.startAt && !(item.allDay && item.allDayDate)) continue;
    const start = item.dueAt || item.startAt;
    const id = stableId(snapshot.source, snapshot.accountKey, item.id);
    const event = {id, courseId: course.id, itemId: item.id, title: `${course.name} · ${item.title}`,
      itemKind: item.kind, kind: item.dueAt ? 'deadline' : 'event', startAt: start, endAt: item.dueAt ? null : item.endAt || null,
      allDay: Boolean(item.allDay && !item.dueAt), date: item.allDayDate || null,
      location: item.location || '', sourceUrl: item.sourceUrl || ''};
    events.set(id, event);
  }
  return [...events.values()];
}
