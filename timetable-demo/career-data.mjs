import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseCourseCsv} from './catalog-import.mjs';
import {courses as offerings} from './course-data.mjs';

export function buildCareerCatalog(rows, courses) {
  const seen = new Set();
  return rows.map(row => {
    const key = row['과목키'], name = row['과목명'], department = row['개설학과'];
    const courseNumbers = JSON.parse(row['원본과목번호목록']);
    if (!/^[a-f0-9]{16}$/.test(key) || seen.has(key) || !name || !department ||
        !Array.isArray(courseNumbers) || !courseNumbers.length || courseNumbers.some(n => !/^\d{10}$/.test(n))) {
      throw new Error('진로 과목 데이터의 키·이름·번호를 확인해 주세요.');
    }
    seen.add(key);
    const matches = courses.filter(c => c.name === name && c.sections.some(s =>
      s.offeredBy === department && courseNumbers.includes(s.courseNumber)));
    if (!matches.length) throw new Error(`진로 과목을 실제 강좌와 연결하지 못했습니다: ${name} / ${department}`);
    const kinds = [...new Set(matches.map(c => c.kind))];
    const description = row['교과목설명'] || '';
    const evidenceType = !description ? 'name' : row['확인상태'] === '공식대응표_과거과목참고설명' ? 'reference' : 'description';
    return {id: `career-${key}`, key, name, department, kind: kinds.includes('major') ? 'major' : 'general',
      courseNumbers, description, evidenceType, sourceYear: row['자료학년도'], sourceName: row['출처자료명'],
      sourceUrl: row['출처URL'], reviewNote: row['검토사유']};
  });
}
const text = readFileSync(new URL('./data/course_descriptions.csv', import.meta.url), 'utf8');
export const careerCatalog = buildCareerCatalog(parseCourseCsv(text), offerings);
export const careerDataVersion = 'career-v2-' + createHash('sha256').update(text).digest('hex').slice(0, 12);

const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// Search every group; a missing description never removes a course from the pool.
export function retrieveCareerCourses(catalog, keywords, limit = 80) {
  const terms = [...new Set(keywords.map(normalize).filter(s => s.length >= 2))];
  return catalog.map(course => {
    const title = normalize(course.name), dept = normalize(course.department), body = normalize(course.description);
    let score = 0;
    for (const term of terms) {
      // Name matches are equally weighted whether or not a description exists.
      if (title.includes(term)) score += 12;
      if (dept.includes(term)) score += 2;
      if (body.includes(term)) score += course.evidenceType === 'reference' ? 0.5 : 1;
    }
    return {course, score};
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.course.id.localeCompare(b.course.id))
    .slice(0, limit).map(item => item.course);
}
