const gradeTokens = /전체\s*학년|(?<!\d)(?:[1-9](?:\s*학년)?\s*(?:[·ㆍ,/~–-]|및|또는)\s*|[1-9]\s*학년\s+)*[1-9]\s*학년/g;

export function sectionTargetYears(target) {
  // A bare "(수강불가)" qualifies the preceding label. Broader notes
  // in parentheses may contain other grades outside the stated target.
  const main = (target ?? '').replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, note => {
    const text = note.slice(1, -1).trim();
    return /^(?:수강\s*)?(?:불가|불허|금지|제외|제한)$/.test(text) ? ' '+text+' ' : ' ';
  }).replace(/대상\s*외\s*수강\s*제한/g, ' ');
  const labels = [...main.matchAll(gradeTokens)];
  const years = new Set();
  for (const [index, match] of labels.entries()) {
    const label = match[0];
    const before = main.slice(0, match.index);
    const after = main.slice(match.index + label.length, labels[index + 1]?.index).split(/[;\n]/, 1)[0];
    const beforeInClause = before.split(/[;\n]/).at(-1);
    const restricted = /(?:불가|불허|금지|제외|제한)/;
    if (restricted.test(after) || /(?:불가|불허|금지|제외|제한)\s*[:：]\s*$/.test(beforeInClause) ||
      /^\s*(?:수강\s*)?(?:불가|불허|금지|제외|제한)\s*$/.test(beforeInClause)) continue;
    if (label.startsWith('전체')) {
      years.add('all');
      continue;
    }
    for (const digit of label.match(/[1-9]/g)) years.add(digit);
    for (const [, from, to] of label.matchAll(/([1-9])(?:\s*학년)?\s*[-~–]\s*([1-9])/g)) {
      for (let grade = Number(from) + 1; grade < Number(to); grade++) years.add(String(grade));
    }
  }
  return [...years].sort();
}

export function courseFacets(sections) {
  const facets = new Map();
  for (const {classification = '', target} of sections) {
    const base = classification.split(/[-–]/, 1)[0].trim();
    const completion = ['전필', '교필', '전공필수', '교양필수'].includes(base) ? 'required' :
      ['전선', '교선', '전공선택', '교양선택'].includes(base) ? 'elective' : null;
    const facet = {completion, years: sectionTargetYears(target)};
    facets.set(JSON.stringify(facet), facet);
  }
  return [...facets.values()];
}

export function courseFilterOptions(courses) {
  const credits = [...new Set(courses.map(course => course.credits))].sort((a, b) => a - b);
  const years = [...new Set(courses.flatMap(course => course.facets?.flatMap(facet => facet.years) ?? []))].sort();
  return {credits, years};
}

export function matchesCourseFilters(course, filters) {
  if (filters.credits.length && !filters.credits.includes(String(course.credits))) return false;
  if (!filters.completion.length && !filters.years.length) return true;
  return (course.facets ?? []).some(facet =>
    (!filters.completion.length || filters.completion.includes(facet.completion)) &&
    (!filters.years.length || facet.years.some(year => filters.years.includes(year))));
}
