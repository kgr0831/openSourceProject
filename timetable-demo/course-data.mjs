import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {importCourses} from './catalog-import.mjs';

const source = readFileSync(new URL('./data/courses.json', import.meta.url), 'utf8');
const rows = JSON.parse(source), imported = importCourses(rows);
export const courses = imported.courses;
export const catalogVersion = 'ssu-courses-' + createHash('sha256').update(source).digest('hex').slice(0, 12);
export const catalogInfo = {
  university: '숭실대학교', department: 'AI소프트웨어학부', terms: imported.terms, departments: imported.departments,
  term: imported.terms.at(-1), sourceRowCount: rows.length, courseCount: courses.length,
  sectionCount: rows.length, unavailableSectionCount: imported.issues.length,
  notice: '제공된 2026년 강좌 자료의 시간·학점·강의실을 사용합니다. 수강대상·개설 변경·여석은 학교에서 확인해 주세요.'
};
export const sources = [{title: '제공된 강좌 JSON', path: 'data/courses.json'}, {title: '동일 자료의 CSV', path: 'data/courses.csv'}];

export function getCourses({term = catalogInfo.term, department = catalogInfo.department} = {}) {
  if (!catalogInfo.terms.includes(term) || !catalogInfo.departments.includes(department)) {
    throw new Error('자료에 포함된 학기와 학과를 선택해 주세요.');
  }
  return courses.filter(course => course.term === term).flatMap(course => {
    const sections = course.sections.filter(section => course.kind === 'general' || section.departments.includes(department));
    if (!sections.length) return [];
    return [{...course, sections, classification: [...new Set(sections.map(section => section.classification))].join(' / '), sectionCount: sections.length,
      availableSectionCount: sections.filter(section => !section.unavailableReason).length,
      unavailableReasons: [...new Set(sections.map(section => section.unavailableReason).filter(Boolean))]}];
  });
}
