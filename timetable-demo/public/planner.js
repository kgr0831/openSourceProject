import {emptyPlanner} from './planner-core.mjs';
import {applyCalendar, loadCalendar, previewCalendar} from './calendar-logic.mjs';

// Keep the key so existing browser records can be migrated on the first successful write.
export const storageKey = 'ssu-timetable-planner-v1';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createPlannerStore(storage) {
  let data = freeze(emptyPlanner()), raw = null, readError = '';
  try {
    raw = storage.getItem(storageKey) ?? null;
    if (raw !== null) data = freeze(loadCalendar(JSON.parse(raw)));
  } catch {
    readError = '저장된 기록을 읽지 못했어요. 기존 데이터는 보존했습니다. 브라우저 저장 설정을 확인해 주세요.';
  }

  function save(next) {
    if (readError) throw new Error(readError);
    if (storage.getItem(storageKey) !== raw) throw new Error('다른 탭에서 저장된 기록이 변경되었어요. 새로고침해 주세요.');
    if (next === data) return data;
    loadCalendar(next);
    const serialized = JSON.stringify(next);
    try {
      storage.setItem(storageKey, serialized);
    } catch {
      throw new Error('브라우저에 저장하지 못했어요. 저장 공간과 브라우저 설정을 확인해 주세요.');
    }
    raw = serialized;
    data = freeze(next);
    return data;
  }

  const preview = (command, options) => previewCalendar(data, command, options);
  const apply = (result, options) => {
    if (readError) throw new Error(readError);
    return save(applyCalendar(data, result, options));
  };
  const run = (command, options) => apply(preview(command, options), options);

  return {
    get data() { return data; },
    get readError() { return readError; },
    preview,
    apply,
    setSemester(candidate, start, end) {
      return run({type: 'initialize', candidate, start, end});
    },
    changeEvent(id, patch, {action, scope, ...options} = {}) {
      return run({type: 'edit', id, patch, ...(action ? {action} : {}), ...(scope ? {scope} : {})}, options);
    },
    addEvent(event, {courseId, originalEventId, examMode, ...options} = {}) {
      return run({type: 'add', event, courseId, originalEventId, examMode}, options);
    },
    addRecord(title, body, candidate) {
      if (!candidate) throw new Error('기록할 시간표를 먼저 선택해 주세요.');
      if (!title.trim() || !body.trim()) throw new Error('제목과 선택한 이유를 입력해 주세요.');
      if (data.experiences.length >= 50) throw new Error('내 기록은 최대 50개까지 저장할 수 있어요.');
      const entry = {id: crypto.randomUUID(), title: title.trim(), body: body.trim(),
        courseNames: candidate.sections.map(section => section.name)};
      save({...data, revision: data.revision + 1, experiences: [...data.experiences, entry]});
    }
  };
}
