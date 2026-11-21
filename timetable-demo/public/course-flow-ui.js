import {checkSectionCombinations, evaluateCourseTimes} from './course-times.mjs';
import {timeText} from './planner-core.mjs';
import {courseCompatibilityNotice} from './timetable-warning-ui.js';
import {button, dayNames, esc} from './ui.js';

export function courseFilterControls(options, filters, disabled) {
  const group = (label, key, choices) => '<fieldset><legend>'+label+'</legend><div class="course-filter-options">'+
    choices.map(([value, name]) => button(esc(name), 'course-filter', 'course-filter-chip',
      'data-id="'+key+'" data-value="'+esc(value)+'" aria-label="'+esc(label+' '+name)+'" aria-pressed="'+
      filters[key].includes(String(value))+'" '+(disabled ? 'disabled' : ''))).join('')+'</div></fieldset>';
  const {credits, years} = options;
  return '<section class="course-filters" aria-label="과목 필터">'+
    group('이수구분', 'completion', [['required', '필수'], ['elective', '선택']])+
    group('학점', 'credits', credits.map(credit => [credit, credit+'학점']))+
    (years.length ? group('대상 학년', 'years', years.map(year => [year, year === 'all' ? '전체학년' : year+'학년'])) : '')+
    button('필터 초기화', 'reset-course-filters', 'quiet', disabled ? 'disabled' : '')+'</section>';
}

const weekday = day => dayNames[day]+'요일';
function timeIssue(issue) {
  if (issue.kind === 'day') return weekday(issue.day)+'이 등교 요일에서 빠졌어요.';
  const time = timeText(issue.minute), limit = timeText(issue.limit);
  if (issue.kind === 'early') {
    return weekday(issue.day)+' 수업은 '+time+'에 시작해요. 현재 '+limit+'인 시작 가능 시각을 '+time+'까지 앞당겨 주세요.';
  }
  return weekday(issue.day)+' 수업은 '+time+'에 끝나요. 현재 '+limit+'인 종료 가능 시각을 '+time+' 이후로 늦춰 주세요.';
}

function sectionMessages(section) {
  if (section.status === 'matches') return ['요일·시간이 맞아요.'];
  if (section.status === 'excluded') return ['고정·제외 조건에서 선택할 수 없는 분반이에요.'];
  if (section.status === 'missing') return [section.unavailableReason || '강의시간을 확인할 수 없어요.'];
  return section.issues.map(timeIssue);
}

function sectionTimeDetails(section) {
  const name = [section.courseNumber, section.sectionLabel].filter(Boolean).join(' · ') || section.id;
  const meetings = section.meetings.map(([day, start, end], index) =>
    '<li><span>'+weekday(day)+' '+timeText(start)+'~'+timeText(end)+'</span><span>'+
    esc(section.locations?.[index] || '강의실 미등록')+'</span></li>').join('');
  return '<li class="section-time-option"><strong>'+esc(name)+'</strong>'+
    (meetings ? '<ul class="section-meetings">'+meetings+'</ul>' : '')+
    [...new Set(sectionMessages(section))].map(message => '<p>'+esc(message)+'</p>').join('')+'</li>';
}

function courseTimeDetails(group, open) {
  const {course, options, sections, missingTimes} = group;
  const count = sections.length;
  const messages = count ? [] : [...new Set(options.flatMap(sectionMessages))].slice(0, 2);
  if (missingTimes && count) messages.push('시간을 확인할 수 없는 분반도 있어요.');
  return '<details class="course-time-detail" data-course-time="'+esc(course.id)+'" '+(open ? 'open' : '')+'>'+
    '<summary><strong>'+esc(course.name)+'</strong> <span data-matching="'+count+'">'+options.length+
    '개 분반 중 '+count+'개가 현재 요일·시간에 맞아요</span></summary>'+
    '<ul class="section-time-options">'+options.map(sectionTimeDetails).join('')+'</ul></details>'+
    messages.map(message => '<p class="course-time-reason">'+esc(message)+'</p>').join('');
}

export function selectedCourseTimes(check, request, open) {
  if (!check?.result) return '<p class="muted">선택 과목의 분반 시간을 불러오는 중이에요.</p>';
  if (!check.result.selected) return '<p class="muted">선택 과목의 분반 시간을 확인하지 못했어요.</p>';
  if (request.earliestStart >= request.latestEnd) {
    return '<p class="course-time-reason">수업 시작 가능 시각을 종료 가능 시각보다 앞서게 설정해 주세요.</p>';
  }
  const groups = evaluateCourseTimes(check.result.selected, request);
  const combination = groups.every(group => group.sections.length || group.missingTimes)
    ? checkSectionCombinations(groups) : null;
  const notice = courseCompatibilityNotice(combination, []);
  return groups.map(group => '<div class="course-time-row">'+courseTimeDetails(group, open.has(group.course.id))+'</div>').join('')+
    (notice ? '<div class="course-time-combination"><h3>현재 요일·시간의 과목 조합</h3>'+notice+'</div>' : '');
}
