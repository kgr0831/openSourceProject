const searchLimitMs = 75;

function selectionIds(value = [], label) {
  if (!Array.isArray(value) || value.length > 1000 ||
    value.some(id => typeof id !== 'string' || !id.trim() || id.length > 160) ||
    new Set(value).size !== value.length) {
    throw new Error(label + ' 목록을 확인해 주세요.');
  }
  return new Set(value);
}

function firstOverlap(left, right) {
  for (const [day, leftStart, leftEnd] of left.meetings) {
    for (const [otherDay, rightStart, rightEnd] of right.meetings) {
      const start = Math.max(leftStart, rightStart), end = Math.min(leftEnd, rightEnd);
      if (day === otherDay && start < end) return {day, start, end};
    }
  }
  return null;
}

// Choose the course with the fewest remaining sections, then discard incompatible
// sections from the other courses before descending. null means the search expired.
function hasCombination(groups, deadline) {
  if (performance.now() >= deadline) return null;
  if (groups.length === 0) return true;
  const next = groups.reduce((fewest, group) => group.sections.length < fewest.sections.length ? group : fewest);
  const others = groups.filter(group => group !== next);
  for (const section of next.sections) {
    const remaining = [];
    for (const group of others) {
      if (performance.now() >= deadline) return null;
      const sections = group.sections.filter(other => !firstOverlap(section, other));
      if (!sections.length) break;
      remaining.push({...group, sections});
    }
    if (remaining.length !== others.length) continue;
    const result = hasCombination(remaining, deadline);
    if (result !== false) return result;
  }
  return false;
}

function describeConflict(groups, deadline) {
  let involved = groups;
  for (const group of groups) {
    if (involved.length <= 2) break;
    const subset = involved.filter(other => other !== group);
    const possible = hasCombination(subset, deadline);
    if (possible === null) break;
    if (!possible) involved = subset;
  }
  const courses = involved.map(group => group.course);
  if (involved.length !== 2) return {status: 'conflict', courses};

  const [left, right] = involved;
  const overlap = firstOverlap(left.sections[0], right.sections[0]);
  return {status: 'conflict', courses, overlap,
    overlapIsExample: left.sections.length > 1 || right.sections.length > 1};
}

export function checkCourseCompatibility(getCourses, request, {timeLimitMs = searchLimitMs} = {}) {
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

  const groups = [...new Set([...required, ...locked.keys()])].map(id => {
    const {name, sections} = byId.get(id), fixedOptions = locked.get(id);
    const allowed = fixedOptions?.length > 1 ? [] : (fixedOptions ?? sections).filter(section => !excluded.has(section.id));
    const scheduled = allowed.filter(section => section.meetings.length);
    return {course: {id, name, locked: Boolean(fixedOptions)}, sections: scheduled,
      unavailable: allowed.length === 0, missingTimes: scheduled.length < allowed.length};
  });

  const unavailable = groups.filter(group => group.unavailable);
  if (unavailable.length) return {status: 'unavailable', courses: unavailable.map(group => group.course)};
  if (!groups.length) return {status: 'compatible'};

  const deadline = performance.now() + timeLimitMs;
  const possible = hasCombination(groups, deadline);
  if (possible === true) return {status: 'compatible'};
  if (possible === null) return {status: 'unknown', reason: 'timeout'};

  const missing = groups.filter(group => group.missingTimes);
  if (!missing.length) return describeConflict(groups, deadline);

  // Unscheduled sections could be placed anywhere. Prove a conflict only if the
  // courses with fully known choices are already impossible on their own.
  const complete = groups.filter(group => !group.missingTimes);
  const completePossible = hasCombination(complete, deadline);
  if (completePossible === false) return describeConflict(complete, deadline);
  if (completePossible === null) return {status: 'unknown', reason: 'timeout'};
  return {status: 'unknown', reason: 'missing_times', courses: missing.map(group => group.course)};
}
