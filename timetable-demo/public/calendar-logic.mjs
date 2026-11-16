import {
  conflictPairs, createSemesterEvents, editEvents, parseDate, restorePlanner, validateEvent, validatePeriod
} from './planner-core.mjs';
import {agendaEvents} from './lms-calendar.mjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const editableFields = ['title', 'date', 'start', 'end', 'location', 'kind'];
const eventIndex = events => new Map(events.map(event => [event.id, event]));
const lesson = event => Boolean(event?.seriesId && event.original?.kind === 'class');
const inTerm = (date, semester) => date >= semester.start && date <= semester.end;

function fail(message, code = 'INVALID_INPUT') {
  throw Object.assign(new Error(message), {code});
}

export function loadCalendar(value) {
  if (value?.version === 2) {
    validateCalendar(value);
    let previousRevision = 0;
    for (const operation of value.history) {
      if (!operation || !Number.isSafeInteger(operation.revision) || operation.revision <= previousRevision ||
        operation.revision > value.revision || operation.id !== 'calendar-operation-' + operation.revision ||
        !Number.isFinite(Date.parse(operation.at)) || !Array.isArray(operation.changes) ||
        !operation.changes.every(change => change && typeof change.id === 'string' &&
          (change.before || change.after) && [change.before, change.after].every(event => event === null || event?.id === change.id))) {
        fail('저장된 변경 기록을 읽지 못했어요.');
      }
      previousRevision = operation.revision;
    }
    return value;
  }
  restorePlanner(value);
  const ids = new Set(value.events.map(event => event.id));
  const events = value.events.flatMap(event => {
    if (!event.seriesId) return [event];
    const sectionId = event.seriesId.slice(0, event.seriesId.lastIndexOf(':'));
    if (event.kind !== 'exam') {
      const exception = event.status === 'cancelled' || editableFields.some(field => event[field] !== event.original[field]);
      return [{...event, sectionId, ...(exception ? {exception: true} : {})}];
    }
    let originalEventId = event.id + ':class';
    while (ids.has(originalEventId)) originalEventId += ':class';
    ids.add(originalEventId);
    const original = {...event.original, id: originalEventId, sectionId, seriesId: event.seriesId,
      courseId: event.courseId, original: event.original, status: event.status,
      ...(event.status === 'cancelled' ? {exception: true} : {})};
    const {seriesId, ...exam} = event;
    return [original, {...exam, sectionId, examMode: 'replacement', originalEventId}];
  });
  return validateCalendar({...value, version: 2, revision: 0, history: [], events});
}

function validateCalendar(data) {
  restorePlanner(data);
  const byId = eventIndex(data.events);
  const replacements = new Set();
  if (data.semester?.effectiveDate) {
    parseDate(data.semester.effectiveDate);
    if (!inTerm(data.semester.effectiveDate, data.semester)) fail('시간표 적용일을 확인해 주세요.');
  }
  for (const event of data.events) {
    if (!inTerm(event.date, data.semester)) fail('학기 기간 안의 날짜를 선택해 주세요.');
    if (event.seriesId && (!lesson(event) || !event.sectionId || !event.courseId ||
      !inTerm(event.original.date, data.semester))) fail('반복 수업 정보를 확인해 주세요.');
    if (event.examMode && (event.kind !== 'exam' || !['replacement', 'additional'].includes(event.examMode))) {
      fail('시험 적용 방식을 확인해 주세요.');
    }
    if (event.originalEventId || event.examMode === 'replacement') {
      const original = byId.get(event.originalEventId);
      if (!lesson(original) || original.id === event.id || original.courseId !== event.courseId ||
        original.sectionId !== event.sectionId || !['exam', 'makeup'].includes(event.kind)) {
        fail('시험이나 보강에 연결할 원래 수업을 확인해 주세요.');
      }
    }
    if (event.examMode === 'replacement' && event.status === 'active') {
      if (replacements.has(event.originalEventId)) fail('같은 수업에 진행 중인 대체 시험이 이미 있어요.');
      replacements.add(event.originalEventId);
    }
  }
  return data;
}

// Status in storage records the user's cancellation. A replacement only affects the displayed status.
export function calendarEvents(events) {
  const replacements = new Map(events.filter(event => event.examMode === 'replacement' && event.status === 'active')
    .map(event => [event.originalEventId, event.id]));
  return events.map(event => replacements.has(event.id)
    ? {...event, status: 'cancelled', replacedBy: replacements.get(event.id)} : event);
}

function changeSet(before, after) {
  const old = eventIndex(before), next = eventIndex(after);
  return [...new Set([...old.keys(), ...next.keys()])].flatMap(id => {
    const a = old.get(id) || null, b = next.get(id) || null;
    if (equal(a, b)) return [];
    const type = !a ? 'add' : !b ? 'remove' : a.status !== 'cancelled' && b.status === 'cancelled' ? 'cancel' : 'update';
    return [{id, type, before: a, after: b}];
  });
}

function conflictsFor(events, changedIds, externalEvents) {
  const dates = [...new Set(events.filter(event => changedIds.has(event.id)).map(event => event.date))].sort();
  return dates.flatMap(date => {
    const rows = [...events.filter(event => event.date === date), ...agendaEvents(externalEvents, date, date)];
    const byId = eventIndex(rows);
    return conflictPairs(rows).filter(ids => ids.some(id => changedIds.has(id))).map(ids => {
      const [a, b] = ids.map(id => byId.get(id));
      return {date, start: Math.max(a.start, b.start), end: Math.min(a.end, b.end),
        events: [a, b].map(({id, title}) => ({id, title}))};
    });
  });
}

function requireSemester(data) {
  if (!data.semester) fail('먼저 시간표를 저장해 주세요.');
  return data.semester;
}

function addEvent(data, command) {
  const semester = requireSemester(data);
  const {event, courseId, originalEventId, examMode} = command;
  if (!event || !['exam', 'makeup', 'personal'].includes(event.kind)) fail('추가할 일정 종류를 확인해 주세요.');
  const original = data.events.find(entry => entry.id === originalEventId);
  if (originalEventId !== undefined && (!lesson(original) || original.courseId !== (courseId ?? original.courseId))) {
    fail('시험이나 보강에 연결할 원래 수업을 확인해 주세요.');
  }
  if (event.kind === 'exam' && (!['replacement', 'additional'].includes(examMode) ||
    (examMode === 'replacement' && (!original || original.retired)))) fail('시험 적용 방식과 원래 수업을 확인해 주세요.');
  if (event.kind === 'makeup' && original?.status === 'active') fail('보강에 연결할 휴강 수업을 선택해 주세요.');
  if (event.kind === 'personal' && (courseId !== undefined || originalEventId !== undefined)) fail('개인 일정에는 과목을 연결할 수 없어요.');
  const section = semester.candidate.sections.find(entry => entry.courseId === courseId);
  if (event.kind !== 'personal' && !original && !section) fail('시험이나 보강에 연결할 과목을 선택해 주세요.');
  const fields = Object.fromEntries(editableFields.map(field => [field, event[field]]));
  const next = {...fields, id: 'calendar-event-' + (data.revision + 1), status: 'active'};
  if (event.kind !== 'personal') {
    next.courseId = original?.courseId ?? section.courseId;
    next.sectionId = original?.sectionId ?? section.id;
  }
  if (event.kind === 'exam') next.examMode = examMode;
  if (original) next.originalEventId = original.id;
  return [...data.events, validateEvent(next)];
}

function editCalendarEvents(data, {id, patch = {}, scope = 'one', action = 'edit'}) {
  const semester = requireSemester(data);
  const target = data.events.find(event => event.id === id);
  if (!target) fail('수정할 일정을 찾지 못했어요.');
  if (scope === 'future' && (!lesson(target) || target.retired)) fail('시간표에서 종료되지 않은 반복 수업만 이후 일정에 적용할 수 있어요.');
  if (action === 'edit' && (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
    Object.keys(patch).some(field => !editableFields.includes(field)))) fail('변경할 필드를 확인해 주세요.');
  if (action === 'edit' && Object.hasOwn(patch, 'kind') && patch.kind !== target.kind) {
    fail('일정 종류는 추가할 때 선택해 주세요. 대체 시험은 원래 수업과 연결해서 추가할 수 있어요.');
  }
  if (action === 'edit') {
    if (Object.hasOwn(patch, 'date')) {
      parseDate(patch.date);
      if (!inTerm(patch.date, semester)) fail('학기 기간 안의 날짜를 선택해 주세요.');
    }
    for (const field of ['start', 'end']) {
      if (Object.hasOwn(patch, field) && (!Number.isInteger(patch[field]) || patch[field] < 0 || patch[field] > 1439)) {
        fail('일정의 시작과 종료 시간을 확인해 주세요.');
      }
    }
    if (Object.hasOwn(patch, 'start') && Object.hasOwn(patch, 'end') && patch.start >= patch.end) {
      fail('일정의 종료 시간은 시작 시간보다 늦어야 해요.');
    }
    if (Object.hasOwn(patch, 'title') && (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.trim().length > 100)) {
      fail('일정 이름을 100자 이내로 입력해 주세요.');
    }
    if (Object.hasOwn(patch, 'location') && (typeof patch.location !== 'string' || patch.location.trim().length > 100)) {
      fail('장소는 100자 이내로 입력해 주세요.');
    }
  }
  if (action === 'resume' && target.retired) fail('시간표에서 제외된 정규 수업이에요.');
  if (action === 'restore' && !lesson(target)) fail('기본 수업 정보가 있는 일정만 복원할 수 있어요.');

  const replacements = new Map();
  for (const event of data.events) {
    if (event.examMode !== 'replacement') continue;
    const exams = replacements.get(event.originalEventId) || [];
    exams.push(event);
    replacements.set(event.originalEventId, exams);
  }
  const targets = scope === 'one' ? [target] : data.events.filter(event =>
    event.seriesId === target.seriesId && !event.retired && event.original.date >= target.original.date);
  const preserved = [], selected = new Set();
  for (const event of targets) {
    const exams = replacements.get(event.id);
    if (scope === 'future' && (event.exception || exams)) {
      preserved.push({reason: 'individual-exception', event});
      for (const exam of exams || []) preserved.push({reason: 'replacement-exam', event: exam});
    } else selected.add(event.id);
  }
  const skipIds = new Set(targets.filter(event => !selected.has(event.id)).map(event => event.id));
  const updated = editEvents(targets, id, patch, {scope, action, period: semester, skipIds, useOriginalDates: scope === 'future'});
  const byId = eventIndex(updated);
  const events = data.events.map(event => {
    if (!selected.has(event.id)) return event;
    let next = byId.get(event.id);
    if (action === 'restore') {
      const {exception, ...base} = next;
      next = event.retired ? {...base, status: 'cancelled'} : base;
    } else if (scope === 'one' && lesson(event) && !equal(event, next)) {
      next = {...next, exception: true};
    }
    return next;
  });
  return {events, preserved};
}

const slotKey = ({courseId, sectionId, original}) => JSON.stringify([
  courseId, sectionId, parseDate(original.date).getUTCDay(), original.start, original.end, original.title, original.location
]);
const occurrenceKey = event => slotKey(event) + event.original.date;
const sectionKey = ({courseId, sectionId}) => JSON.stringify([courseId, sectionId]);

function replaceTimetable(data, {candidate, effectiveDate, decisions = {}}) {
  const semester = requireSemester(data);
  parseDate(effectiveDate);
  if (!inTerm(effectiveDate, semester) || effectiveDate < (semester.effectiveDate || semester.start)) {
    fail('학기 기간과 마지막 시간표 적용일을 확인해 주세요.');
  }
  const generated = createSemesterEvents(candidate, semester.start, semester.end);
  if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) fail('검토 항목의 선택을 확인해 주세요.');
  const nextSlots = new Set(generated.map(slotKey));
  const previous = createSemesterEvents(semester.candidate, semester.start, semester.end);
  const previousSlots = new Set(previous.map(slotKey));
  const previousSections = new Set(semester.candidate.sections.map(({courseId, id}) => sectionKey({courseId, sectionId: id})));
  const removed = new Set([...previousSlots].filter(key => !nextSlots.has(key)));
  const nextSections = new Set(candidate.sections.map(({courseId, id}) => sectionKey({courseId, sectionId: id})));
  const changedSections = new Set(data.events.filter(event => lesson(event) && removed.has(slotKey(event))).map(sectionKey));
  const originals = eventIndex(data.events);
  const review = [], preserved = [];
  const events = data.events.map(event => {
    if (event.date < effectiveDate) {
      if (event.exception || !lesson(event)) preserved.push({reason: 'past', event});
      return event;
    }
    const currentLesson = lesson(event) && !event.retired;
    const removedLesson = currentLesson && removed.has(slotKey(event));
    const linked = ['exam', 'makeup'].includes(event.kind) && event.courseId && !currentLesson;
    const original = originals.get(event.originalEventId);
    const affectedLink = linked && (original ? removed.has(slotKey(original)) && !original.retired :
      previousSections.has(sectionKey(event)) && (!nextSections.has(sectionKey(event)) || changedSections.has(sectionKey(event))));
    if ((removedLesson && (event.exception || event.kind !== 'class')) || affectedLink) {
      const decision = Object.hasOwn(decisions, event.id) ? decisions[event.id] : null;
      const protectsPastClass = event.examMode === 'replacement' && event.status === 'active' &&
        original.date < effectiveDate && original.status === 'active';
      review.push({id: event.id, event, reason: removedLesson ? 'withdrawn-exception' : 'affected-link',
        options: protectsPastClass ? ['keep'] : ['keep', 'cancel'], decision});
      if (decision !== 'cancel') preserved.push({reason: 'review-retained', event});
      return {...event, ...(removedLesson ? {retired: true} : {}), ...(decision === 'cancel' ? {status: 'cancelled'} : {})};
    }
    if (removedLesson && event.original.date >= effectiveDate) return {...event, retired: true, status: 'cancelled'};
    if (event.exception || !lesson(event)) preserved.push({reason: 'retained', event});
    return event;
  });
  const reviewOptions = new Map(review.map(item => [item.id, item.options]));
  if (Object.entries(decisions).some(([id, value]) => !reviewOptions.get(id)?.includes(value))) {
    fail('검토 항목의 선택을 확인해 주세요.');
  }

  const currentLessons = data.events.filter(event => lesson(event) && !event.retired && previousSlots.has(slotKey(event)));
  const existing = new Set(currentLessons.map(occurrenceKey));
  const seriesBySlot = new Map(currentLessons.map(event => [slotKey(event), event.seriesId]));
  const seriesInUse = new Set(data.events.map(event => event.seriesId));
  const idsInUse = new Set(data.events.map(event => event.id));
  for (const event of generated) {
    if (event.date < effectiveDate || existing.has(occurrenceKey(event))) continue;
    const slot = slotKey(event);
    let seriesId = seriesBySlot.get(slot);
    if (!seriesId) {
      seriesId = seriesInUse.has(event.seriesId) ? event.seriesId + ':r' + (data.revision + 1) : event.seriesId;
      seriesBySlot.set(slot, seriesId);
      seriesInUse.add(seriesId);
    }
    const id = idsInUse.has(event.id) ? event.id + ':r' + (data.revision + 1) : event.id;
    events.push({...event, id, seriesId});
  }
  const nextSemester = equal(semester.candidate, candidate) ? semester : {...semester, candidate, effectiveDate};
  return {events, semester: nextSemester, review, preserved};
}

function undo(data, operationId) {
  const last = data.history.at(-1);
  if (!last || last.id !== operationId) fail('직전 변경만 되돌릴 수 있어요.', 'STALE_OPERATION');
  const byId = eventIndex(data.events);
  if (last.semester && !equal(last.semester.after, data.semester)) fail('학기 정보가 이미 변경되었어요.', 'STALE_OPERATION');
  for (const {id, before, after} of last.changes) {
    if (!equal(byId.get(id) || null, after)) fail('일정이 이미 변경되었어요.', 'STALE_OPERATION');
    if (before) byId.set(id, before);
    else byId.delete(id);
  }
  return {events: [...byId.values()], semester: last.semester ? last.semester.before : data.semester};
}

function plan(data, command) {
  const base = {events: data.events, semester: data.semester, preserved: [], review: []};
  switch (command?.type) {
    case 'initialize': {
      const {candidate, start, end} = command;
      if (data.semester) {
        if (data.semester.start === start && data.semester.end === end && equal(data.semester.candidate, candidate)) return base;
        fail('기존 학기는 새 시간표와 적용일을 선택해 변경해 주세요.');
      }
      return {...base, semester: {...validatePeriod(start, end), candidate}, events: createSemesterEvents(candidate, start, end)};
    }
    case 'edit': return {...base, ...editCalendarEvents(data, command)};
    case 'add': return {...base, events: addEvent(data, command)};
    case 'replace': return {...base, ...replaceTimetable(data, command)};
    case 'undo': return {...base, ...undo(data, command.operationId)};
    default: fail('일정 변경 요청을 확인해 주세요.');
  }
}

function buildPreview(data, command, externalEvents) {
  const next = plan(data, command);
  validateCalendar({...data, events: next.events, semester: next.semester});
  const rawChanges = changeSet(data.events, next.events);
  const effective = calendarEvents(next.events);
  const changes = changeSet(calendarEvents(data.events), effective);
  const semester = equal(data.semester, next.semester) ? null : {before: data.semester, after: next.semester};
  const preview = {ok: true, errors: [], revision: data.revision, command, changes, semester,
    preserved: next.preserved, review: next.review, requiresReview: next.review.some(item => !item.decision),
    conflicts: conflictsFor(effective, new Set(changes.map(change => change.id)), externalEvents)};
  return {preview, rawChanges, next};
}

export function previewCalendar(data, command, {externalEvents = []} = {}) {
  try {
    return structuredClone(buildPreview(data, command, externalEvents).preview);
  } catch (error) {
    return {ok: false, revision: data.revision, errors: [{code: error.code || 'INVALID_INPUT', message: error.message}],
      changes: [], semester: null, preserved: [], review: [], requiresReview: false, conflicts: []};
  }
}

export function applyCalendar(data, preview, {acceptConflicts = false, externalEvents = [], now = new Date()} = {}) {
  if (!preview?.ok) fail(preview?.errors?.[0]?.message || '변경을 먼저 확인해 주세요.', preview?.errors?.[0]?.code);
  if (preview.revision !== data.revision) fail('다른 변경이 저장되었어요. 미리보기를 다시 확인해 주세요.', 'STALE_PREVIEW');
  const {preview: current, rawChanges, next} = buildPreview(data, preview.command, externalEvents);
  if (!equal(current, preview)) fail('변경 미리보기 결과가 달라졌어요. 다시 확인해 주세요.', 'STALE_PREVIEW');
  if (current.requiresReview) fail('검토 항목마다 처리 방법을 선택해 주세요.', 'REVIEW_REQUIRED');
  if (current.conflicts.length && acceptConflicts !== true) fail('겹치는 일정을 확인해 주세요.', 'CONFLICT_CONFIRMATION_REQUIRED');
  if (!rawChanges.length && !current.semester) return data;
  const revision = data.revision + 1;
  if (!Number.isSafeInteger(revision)) fail('변경 기록 번호를 할당할 수 없어요.');
  const rawById = new Map(rawChanges.map(change => [change.id, change]));
  const entry = {id: 'calendar-operation-' + revision, revision, at: now.toISOString(), type: current.command.type,
    scope: current.command.scope ?? (current.command.type === 'edit' ? 'one' : current.command.type === 'add' ? 'one' : 'semester'),
    ...(current.command.action ? {action: current.command.action} : {}),
    ...(current.command.operationId ? {undoes: current.command.operationId} : {}),
    ...(current.command.effectiveDate ? {effectiveDate: current.command.effectiveDate} : {}),
    ...(current.review.length ? {decisions: current.command.decisions} : {}),
    affectedIds: [...new Set([...rawById.keys(), ...current.changes.map(change => change.id)])], changes: rawChanges,
    displayedChanges: current.changes.filter(change => !equal(rawById.get(change.id), change)),
    semester: current.semester};
  return structuredClone({...data, events: next.events, semester: next.semester, revision, history: [...data.history, entry]});
}
