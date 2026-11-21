import {selectCourseSections} from './course-compatibility.mjs';
import {checkSectionCombinations, evaluateCourseTimes} from './public/course-times.mjs';
import {relaxationChoices, relaxationRule} from './public/relaxation-options.mjs';

const limits = {time_limit_seconds: 4, workers: 1, seed: 42};

function courseReason(group) {
  const choices = group.options.filter(section => section.eligible);
  const course = group.course.name;
  if (group.unavailable) return {kind: 'excluded', course};
  if (group.options.every(section => !section.meetings.length)) return {kind: 'missing', course};
  if (group.missingTimes || group.sections.length) return null;

  for (const kind of ['early', 'late', 'day']) {
    const issues = choices.map(section => section.issues.find(issue => issue.kind === kind));
    if (issues.every(Boolean)) return {kind, course, issues};
  }
  return {kind: 'window', course};
}

function attendanceReason(selected, groups, request) {
  const attendance = request.attendanceDays;
  if (attendance?.mode !== 'exact') return null;
  let possibleDays = request.allowedDays.length;
  // With all available credits already spoken for, only required or locked
  // courses can contribute days. Sum a safe upper bound over their sections.
  if (selected.length && selected.reduce((total, course) => total + course.credits, 0) === request.credits.total.max &&
    groups.every(group => group.sections.length && !group.missingTimes)) {
    const daysFromCourses = groups.reduce((count, group) => count + Math.max(...group.sections.map(section =>
      new Set(section.meetings.map(([day]) => day)).size)), 0);
    possibleDays = Math.min(possibleDays, daysFromCourses);
  }
  if (attendance.value > possibleDays) return {kind: 'attendance', actual: possibleDays, expected: attendance.value};
  return null;
}

function confirmedReasons(selected, request) {
  const groups = evaluateCourseTimes(selected, request);
  const reasons = groups.map(courseReason).filter(Boolean);
  const attendance = attendanceReason(selected, groups, request);
  if (attendance) reasons.push(attendance);
  if (groups.length >= 2 && groups.every(group => group.sections.length)) {
    const result = checkSectionCombinations(groups);
    if (result.status === 'conflict') {
      reasons.push({kind: 'overlap', courses: result.courses.map(course => course.name), overlap: result.overlap,
        example: result.overlapIsExample});
    }
  }
  return reasons;
}

// A time boundary is protected by each solve. To preview a direct edit, build
// a separate request with only that boundary changed and verify a candidate.
function timeAttempt(selected, request, field) {
  const starts = field === 'earliestStart', allowedDays = new Set(request.allowedDays);
  let needed = request[field];
  for (const course of selected) {
    const options = course.sections.filter(section => section.eligible && section.meetings.length &&
      section.meetings.every(([day, start, end]) => allowedDays.has(day) &&
        (starts ? end <= request.latestEnd : start >= request.earliestStart)));
    if (!options.length) return null;

    const best = starts
      ? Math.max(...options.map(section => Math.min(...section.meetings.map(([, start]) => start))))
      : Math.min(...options.map(section => Math.max(...section.meetings.map(([, , end]) => end))));
    needed = starts ? Math.min(needed, best) : Math.max(needed, best);
  }
  if (needed === request[field]) return null;

  return {
    mode: 'recommend', request: {...request, [field]: needed},
    change: {condition: starts ? 'earliest_start' : 'latest_end', from: request[field], to: needed}
  };
}

function relaxationAttempt(request) {
  const original = request.relaxationPolicy;
  const policy = Object.keys(original.rules).length ? original : {
    max_changed: 2,
    rules: Object.fromEntries(Object.entries(relaxationChoices(request)).map(([key, item]) => [key, relaxationRule(item)]))
  };
  if (!policy.max_changed || !Object.values(policy.rules).some(rule => rule.allow)) return null;
  return {mode: 'relax', request: {...request, relaxationPolicy: policy}};
}

async function verifiedOptions(selected, request, generateCandidates, signal) {
  const attempts = [
    timeAttempt(selected, request, 'earliestStart'), timeAttempt(selected, request, 'latestEnd'), relaxationAttempt(request)
  ].filter(Boolean);
  const controller = new AbortController();
  const previewSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let results;
  try {
    results = await Promise.all(attempts.map(async ({mode, request, change}) => ({
      change, result: await generateCandidates(request, {
        mode, signal: previewSignal, searchOptions: limits, selection: {mode: 'top_k', k: change ? 1 : 3}
      })
    })));
  } catch (error) {
    controller.abort();
    throw error;
  }

  const options = new Map();
  for (const {change, result} of results) {
    for (const candidate of result.candidates) {
      const changes = change ? [change] : candidate.solverResult.changes;
      if (!changes.length) continue;
      const key = JSON.stringify(changes.map(({condition, to}) => [condition, to]).sort(([left], [right]) => left.localeCompare(right)));
      if (!options.has(key)) {
        options.set(key, {changes, candidate: change ? {...candidate, previewChanges: changes} : candidate});
      }
    }
  }
  return [...options.values()].sort((a, b) => a.changes.length - b.changes.length).slice(0, 3);
}

export async function addEmptyGuidance(result, {mode = 'recommend', getCourses, generateCandidates, signal}) {
  if (mode === 'alternative' || result.total || result.solver?.original_status !== 'INFEASIBLE') return result;

  const selected = selectCourseSections(getCourses, result.request);
  const reasons = confirmedReasons(selected, result.request);
  const options = mode === 'recommend' ? await verifiedOptions(selected, result.request, generateCandidates, signal) : [];
  return {...result, emptyGuidance: {reasons, options}};
}
