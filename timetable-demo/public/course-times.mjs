const searchLimitMs = 75;

function meetingIssues(meetings, allowedDays, earliestStart, latestEnd) {
  const issues = [];
  for (const [day, start, end] of meetings) {
    if (!allowedDays.has(day)) {
      issues.push({kind: 'day', day});
      continue;
    }
    if (start < earliestStart) issues.push({kind: 'early', day, minute: start, limit: earliestStart});
    if (end > latestEnd) issues.push({kind: 'late', day, minute: end, limit: latestEnd});
  }
  return issues;
}

export function evaluateCourseTimes(selected, window) {
  const allowedDays = new Set(window?.allowedDays);
  return selected.map(({course, sections}) => {
    const options = sections.map(section => {
      if (!section.eligible) return {...section, status: 'excluded'};
      if (!section.meetings.length) return {...section, status: 'missing'};
      const issues = window ? meetingIssues(section.meetings, allowedDays, window.earliestStart, window.latestEnd) : [];
      return {...section, issues, status: issues.length ? 'outside' : 'matches'};
    });
    return {
      course, options, sections: options.filter(section => section.status === 'matches'),
      unavailable: options.every(section => section.status === 'excluded'),
      missingTimes: options.some(section => section.status === 'missing')
    };
  });
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

export function checkSectionCombinations(groups, {timeLimitMs = searchLimitMs} = {}) {
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
