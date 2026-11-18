import {timeText} from './planner-core.mjs';
import {button, dayNames, esc} from './ui.js';
import {travelWarnings} from './travel-warnings.mjs';

export function courseCompatibilityNotice(result, requiredCourseIds) {
  if (!result || result.status === 'compatible') return '';

  const courses = result.courses ?? [];
  const names = courses.map(course => course.name).join(' · ');
  if (result.status === 'error') return '<p class="muted">분반 시간을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.</p>';
  if (result.status === 'unknown' && result.reason === 'timeout') {
    return '<p class="muted">제한 시간 안에 분반 조합을 확인하지 못했어요.</p>';
  }
  if (result.status === 'unknown') {
    return '<p class="muted">'+esc(names)+'의 일부 분반 시간이 확인되지 않아 함께 들을 수 있는지 아직 판단하기 어려워요.</p>';
  }

  const overlap = result.overlap;
  let reason = '선택한 과목을 모두 들을 수 있는 분반 조합이 없어요.';
  if (result.status === 'unavailable') reason = '현재 고정·제외 조건에서 선택할 수 있는 분반이 없어요.';
  if (overlap) {
    const time = dayNames[overlap.day]+'요일 '+timeText(overlap.start)+'~'+timeText(overlap.end);
    reason = result.overlapIsExample ? '어느 분반을 조합해도 겹쳐요. '+time+'은 겹치는 시간의 한 예예요.' : time+'에 겹쳐요.';
  }

  const controls = courses.filter(course => requiredCourseIds.includes(course.id)).map(course =>
    button(esc(course.name)+' 해제', 'remove-conflicting-course', 'interest-chip', 'data-id="'+esc(course.id)+'"')).join('');
  return '<section class="timetable-warning" aria-label="'+(result.status === 'conflict' ? '수업 시간 충돌' : '분반 조건 확인')+'">'+
    '<p><strong>'+esc(names)+'</strong></p><p>'+esc(reason)+'</p>'+
    (courses.some(course => course.locked) ? '<p>분반을 고정한 과목은 고정을 풀어야 조합에서 빠져요.</p>' : '')+
    (controls ? '<div class="course-chips">'+controls+'</div>' : '')+'</section>';
}

export function candidateTravelNotice(sections) {
  const warnings = travelWarnings(sections);
  if (!warnings.length) return '';
  return '<section class="timetable-warning candidate-travel-warning" aria-label="수업 사이 이동 안내">'+
    '<h3>수업 사이 이동 안내</h3><ul>'+warnings.map(warning => {
      const when = dayNames[warning.day]+'요일 '+timeText(warning.fromEnd)+' → '+timeText(warning.toStart);
      const route = warning.fromBuilding+' → '+warning.toBuilding;
      const message = warning.kind === 'advisory' ? '쉬는 시간 '+warning.gapMinutes+'분이라 이동이 빠듯할 수 있어요.' :
        warning.kind === 'short' ? '이동시간이 약 '+Math.ceil(-warning.spareMinutes)+'분 부족해요.' : '이동이 빠듯해요.';
      return '<li><strong>'+esc(when+' · '+route)+'</strong><p>'+esc(message)+'</p></li>';
    }).join('')+'</ul></section>';
}
