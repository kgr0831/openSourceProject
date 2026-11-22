const limit = 24;
const kinds = {major: '전공', general: '교양'};
export const defaultCreditRanges = {total: {min: 13, max: 13}, major: {min: 9, max: 9}, general: {min: 4, max: 4}};

export function selectedCredits(courses, ids) {
  const required = new Set(ids);
  const selection = {count: 0, total: 0, major: 0, general: 0};
  for (const course of courses) {
    if (!required.has(course.id)) continue;
    selection.count++;
    selection.total += course.credits;
    selection[course.kind] += course.credits;
  }
  return selection;
}

function validCredit(value, minimum) {
  return Number.isFinite(value) && Number.isInteger(value * 2) && value >= minimum && value <= limit;
}

function rangeIssue(ranges, selected) {
  const {total, major, general} = ranges;
  for (const [key, range] of Object.entries(ranges)) {
    const label = kinds[key] ?? '총';
    const minimum = key === 'total' ? 0.5 : 0;
    if (!validCredit(range.min, minimum) || !validCredit(range.max, minimum)) {
      return '세부 선호에서 '+label+' 학점을 '+minimum+'~24 사이의 0.5학점 단위로 입력해 주세요.';
    }
    if (range.min > range.max) return '세부 선호에서 '+label+' 최대 학점을 최소 학점 이상으로 맞춰 주세요.';
    if (selected[key] > range.max) {
      const subject = key === 'total' ? '선택한 과목 합계가 ' : '선택한 '+label+' 과목이 ';
      return subject+selected[key]+'학점이에요. 과목을 해제하거나 세부 선호에서 '+label+' 최대 학점을 높여 주세요.';
    }
  }
  if (Math.max(major.min, selected.major) + Math.max(general.min, selected.general) > total.max) {
    return '선택 과목과 전공·교양 최소 학점을 더하면 총 최대 학점을 넘어요. 세부 선호에서 학점 범위를 조정해 주세요.';
  }
  if (major.max + general.max < total.min) {
    return '전공·교양 최대 학점을 더해도 총 최소 학점에 못 미쳐요. 세부 선호에서 학점 범위를 조정해 주세요.';
  }
  return '';
}

export function courseCreditPlan(selected, choice, currentRanges) {
  if (selected.total > limit) {
    return {blocked: true, message: '선택한 과목이 '+selected.total+'학점이에요. 필수 과목을 해제해 '+limit+'학점 이하로 줄여 주세요.'};
  }
  if (choice.mode === 'ranges') {
    const message = rangeIssue(currentRanges, selected);
    return {blocked: Boolean(message), message};
  }
  if (choice.mode === 'goal' && !validCredit(choice.value, 0.5)) {
    return {blocked: true, message: '목표 학점을 0.5~24 사이의 0.5학점 단위로 입력해 주세요.'};
  }
  if (choice.mode === 'auto' && !selected.count) return {ranges: structuredClone(defaultCreditRanges)};

  const target = Math.max(choice.value ?? 0, selected.total);
  const raised = choice.mode === 'goal' && target > choice.value;
  const raisedFrom = choice.raisedFrom ?? (raised ? choice.value : undefined);
  const message = raisedFrom != null && selected.total === target
    ? '선택한 과목 합계가 '+raisedFrom+'학점을 넘어 목표를 '+target+'학점으로 올렸어요.' : '';
  return {ranges: {
    total: {min: target, max: target},
    major: {min: selected.major, max: target - selected.general},
    general: {min: selected.general, max: target - selected.major}
  }, raisedTo: raised ? target : undefined, message};
}
