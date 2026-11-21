import {checkSectionCombinations, evaluateCourseTimes} from './public/course-times.mjs';

function selectionIds(value = [], label) {
  if (!Array.isArray(value) || value.length > 1000 ||
    value.some(id => typeof id !== 'string' || !id.trim() || id.length > 160) ||
    new Set(value).size !== value.length) {
    throw new Error(label + ' 목록을 확인해 주세요.');
  }
  return new Set(value);
}

export function selectCourseSections(getCourses, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('선택한 과목과 학기·학과를 확인해 주세요.');
  }
  const required = selectionIds(request.requiredCourseIds, '필수 과목');
  const fixed = selectionIds(request.lockedSectionIds, '고정 분반');
  const excluded = selectionIds(request.excludedSectionIds, '제외 분반');
  const scoped = getCourses({term: request.term, department: request.department}, {courseIds: required, sectionIds: fixed});
  const byId = new Map(scoped.map(course => [course.id, course]));
  if ([...required].some(id => !byId.has(id))) throw new Error('이 학기와 학과의 필수 과목을 확인해 주세요.');
  const locked = new Map();
  for (const course of scoped) {
    const sections = course.sections.filter(section => fixed.has(section.id));
    if (sections.length) locked.set(course.id, sections);
  }
  if ([...locked.values()].reduce((count, sections) => count + sections.length, 0) !== fixed.size) {
    throw new Error('이 학기와 학과의 고정 분반을 확인해 주세요.');
  }

  return [...new Set([...required, ...locked.keys()])].map(id => {
    const {name, credits, sections} = byId.get(id), fixedOptions = locked.get(id) ?? [];
    const lockedId = fixedOptions[0]?.id;
    return {course: {id, name, locked: fixedOptions.length > 0}, credits,
      sections: sections.map(({id, sectionLabel, courseNumber, meetings, locations, unavailableReason}) => ({
        id, sectionLabel, courseNumber, meetings, locations, unavailableReason,
        eligible: fixedOptions.length < 2 && (!lockedId || id === lockedId) && !excluded.has(id)
      }))
    };
  });
}

export function checkCourseCompatibility(getCourses, request, options) {
  const selected = selectCourseSections(getCourses, request);
  const result = checkSectionCombinations(evaluateCourseTimes(selected), options);
  return request.includeSections === true ? {...result, selected} : result;
}
