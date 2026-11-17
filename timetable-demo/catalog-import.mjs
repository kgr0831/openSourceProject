import {createHash} from 'node:crypto';

const weekdays = '월화수목금토일';
const normalize = value => String(value ?? '').trim();
const minutes = (hour, minute) => Number(hour) * 60 + Number(minute);

export function parseMeetings(value) {
  const raw = normalize(value), meetings = [], locations = [], instructors = [];
  if (!raw) return {meetings, locations, instructors, issue: '강의시간 미등록'};
  const start = /([월화수목금토일](?:\s+[월화수목금토일])*)\s+(\d{1,2}):(\d{2})\s*[-~–]\s*(\d{1,2}):(\d{2})\s*\(/gy;
  let offset = 0;
  while (offset < raw.length) {
    while (/\s/.test(raw[offset] || '') && offset < raw.length) offset++;
    if (offset === raw.length) break;
    start.lastIndex = offset;
    const match = start.exec(raw);
    if (!match) return {meetings: [], locations: [], instructors: [], issue: '강의시간 형식 확인 필요'};
    let depth = 1, end = start.lastIndex;
    for (; end < raw.length && depth; end++) {
      if (raw[end] === '(') depth++;
      if (raw[end] === ')') depth--;
    }
    const from = minutes(match[2], match[3]), to = minutes(match[4], match[5]);
    if (depth || Number(match[3]) > 59 || Number(match[5]) > 59 || from < 0 || to > 1440 || from >= to) {
      return {meetings: [], locations: [], instructors: [], issue: '강의시간 범위 확인 필요'};
    }
    const detail = raw.slice(start.lastIndex, end - 1).trim(), separator = detail.lastIndexOf('-');
    const location = separator < 0 ? detail : detail.slice(0, separator).trim();
    const instructor = separator < 0 ? '' : detail.slice(separator + 1).trim();
    for (const day of match[1].replace(/\s/g, '')) {
      const weekday = weekdays.indexOf(day);
      const duplicate = meetings.findIndex(meeting => meeting[0] === weekday && meeting[1] === from && meeting[2] === to);
      if (duplicate < 0) {meetings.push([weekday, from, to]); locations.push(location);}
      else if (location && !locations[duplicate].split(' / ').includes(location)) locations[duplicate] += ' / ' + location;
      if (instructor && !instructors.includes(instructor)) instructors.push(instructor);
    }
    offset = end;
  }
  if (!meetings.length || meetings.some((a, index) => meetings.slice(index + 1).some(b => a[0] === b[0] && a[1] < b[2] && b[1] < a[2]))) {
    return {meetings: [], locations: [], instructors: [], issue: '분반 내부 시간 중복 확인 필요'};
  }
  return {meetings, locations, instructors, issue: null};
}

export function parseCourseCsv(text) {
  const rows = [], row = [];
  let field = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {field += '"'; index++;}
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (char === '\n') {rows.push(row.splice(0));}
    } else field += char;
  }
  if (quoted) throw new Error('CSV의 따옴표가 닫히지 않았습니다.');
  if (field || row.length) {row.push(field.replace(/\r$/, '')); rows.push(row);}
  const headers = rows.shift();
  return rows.filter(row => row.some(Boolean)).map((cells, index) => {
    if (cells.length !== headers.length) throw new Error('CSV 열 수 불일치: ' + (index + 2));
    const item = Object.fromEntries(headers.map((key, index) => [key, cells[index]]));
    if (item['조회경로']) item['조회경로'] = JSON.parse(item['조회경로']);
    return item;
  });
}

export function compareCourseSources(json, csv) {
  if (!Array.isArray(json) || json.length !== csv.length) throw new Error('JSON과 CSV의 강좌 수가 다릅니다.');
  for (let index = 0; index < json.length; index++) {
    for (const key of new Set([...Object.keys(json[index]), ...Object.keys(csv[index])])) {
      const value = row => Array.isArray(row[key]) ? JSON.stringify(row[key]) : normalize(row[key]);
      if (value(json[index]) !== value(csv[index])) throw new Error(`JSON/CSV 내용 불일치: ${index + 1}행 ${key}`);
    }
  }
}

export function importCourses(rows) {
  const groups = new Map(), seen = new Set(), terms = new Set(), departments = new Set(), issues = [];
  for (const row of rows) {
    const year = normalize(row['학년도']), semester = normalize(row['학기']).match(/^([12])학기$/)?.[1];
    const number = normalize(row['과목번호']), name = normalize(row['과목명']);
    const credit = normalize(row['시간/학점(설계)']).match(/^\d+(?:\.\d+)?\s*\/\s*(\d+(?:\.\d+)?)(?:\s*\([^)]*\))?$/);
    if (!/^\d{4}$/.test(year) || !semester || !/^\d{10}$/.test(number) || !name || !credit) {
      throw new Error('과목의 학기·번호·이름·학점 형식을 확인해 주세요: ' + number);
    }
    const term = year + '-' + semester, id = 'ssu-' + term + '-' + number, credits = Number(credit[1]);
    if (seen.has(id)) throw new Error('학기 내 중복 과목번호: ' + id);
    seen.add(id); terms.add(term);
    const classification = normalize(row['이수구분(주전공)']);
    const kind = classification.startsWith('전') ? 'major' : 'general';
    const offeredBy = normalize(row['개설학과']);
    const paths = Array.isArray(row['조회경로']) ? row['조회경로'] : [];
    const offeredTo = [...new Set(paths.filter(path => path[0] === '학부전공별').map(path => path.at(-1)).filter(Boolean))];
    if (kind === 'major' && !offeredTo.length && offeredBy) offeredTo.push(offeredBy);
    if (kind === 'major') for (const department of offeredTo) departments.add(department);
    const parsed = parseMeetings(row['강의시간(강의실)']);
    const issue = credits <= 0 ? '학점 확인 필요' : parsed.issue;
    if (issue) issues.push({id, term, name, reason: issue});
    const section = {id, term, classification, courseNumber: number, sectionLabel: normalize(row['분반']),
      meetings: issue ? [] : parsed.meetings, locations: issue ? [] : parsed.locations,
      building: [...new Set(parsed.locations.map(location => location.split(/\s/)[0]))].join(' / '),
      location: [...new Set(parsed.locations)].join(' / '),
      instructor: normalize(row['교수명']) || parsed.instructors.join(', '),
      offeredBy, departments: offeredTo, target: normalize(row['수강대상']),
      notes: normalize(row['수강유의사항']), lectureType: normalize(row['강좌유형정보']),
      rawSchedule: normalize(row['강의시간(강의실)']), unavailableReason: issue};
    const base = number.slice(0, -2), signature = [term, base, name, credits, kind].join('|');
    let course = groups.get(signature);
    if (!course) {
      course = {id: 'ssu-' + term + '-' + base, name, shortName: name, kind, credits, year: null, term,
        classification, group: null, topic: normalize(row['교과영역']) || offeredBy,
        area: normalize(row['교과영역']), departments: [], sections: []};
      groups.set(signature, course);
    }
    course.departments = [...new Set([...course.departments, ...offeredTo])];
    course.sections.push(section);
  }
  const courses = [...groups.values()], duplicates = new Map();
  for (const course of courses) duplicates.set(course.id, (duplicates.get(course.id) || 0) + 1);
  for (const [signature, course] of groups) {
    if (duplicates.get(course.id) > 1) course.id += '-' + createHash('sha256').update(signature).digest('hex').slice(0, 8);
    course.sections.sort((a, b) => a.id.localeCompare(b.id));
    course.classification = [...new Set(course.sections.map(section => section.classification))].join(' / ');
  }
  courses.sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id));
  return {courses, terms: [...terms].sort(), departments: [...departments].sort((a, b) => a.localeCompare(b, 'ko')), issues};
}
