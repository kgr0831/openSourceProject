"""Validated, lossless input for the CP-SAT worker. Weekdays are ISO 1..7."""
from copy import deepcopy
from fractions import Fraction
from math import lcm
import hashlib
import json
import re


def integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{label}: {low}~{high} 범위의 정수가 필요합니다.')
    return value


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError('학점은 정확한 숫자여야 합니다.')
    try:
        if not re.fullmatch(r'\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', str(value)):
            raise ValueError()
        result = Fraction(str(value))
    except (ValueError, ZeroDivisionError):
        raise ValueError('학점 값이 올바르지 않습니다.') from None
    if result < 0 or result > 500 or result.denominator > 1000000:
        raise ValueError('학점 범위 또는 정밀도를 확인해 주세요.')
    return result


def credit_range(value):
    if not isinstance(value, dict) or number(value.get('min')) > number(value.get('max')):
        raise ValueError('학점 최소/최대 범위를 확인해 주세요.')
    return deepcopy(value)


def identifier(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 160:
        raise ValueError('학기와 과목/분반 ID를 확인해 주세요.')
    return value


def id_list(values, known):
    if not isinstance(values, list) or any(not isinstance(x, str) or x not in known for x in values) or len(set(values)) != len(values):
        raise ValueError('알 수 없거나 중복된 과목/분반 ID입니다.')
    return sorted(values)


def normalize(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('catalog'), dict) or not isinstance(payload.get('request'), dict):
        raise ValueError('catalog와 request 객체가 필요합니다.')
    catalog = deepcopy(payload.get('catalog', {}))
    request = deepcopy(payload.get('request', {}))
    identifier(catalog.get('version'))
    term = identifier(request.get('term'))
    if request.get('catalog_version') != catalog['version']:
        raise ValueError('요청의 데이터 버전이 카탈로그와 다릅니다.')
    raw = catalog.get('sections')
    if not isinstance(raw, list) or len(raw) > 500:
        raise ValueError('분반 데이터는 최대 500개까지 지원합니다.')
    raw_ids = [s.get('section_id') for s in raw if isinstance(s, dict) and isinstance(s.get('section_id'), str)]
    if len(raw_ids) != len(set(raw_ids)):
        raise ValueError('중복 분반 ID입니다.')
    sections, diagnostics, seen, course_ids = [], [], set(), set()
    fractions = []
    for index, section in enumerate(raw):
        if isinstance(section, dict) and isinstance(section.get('course_id'), str):
            course_ids.add(section['course_id'])
        try:
            sid, cid = identifier(section.get('section_id')), identifier(section.get('course_id'))
            identifier(section.get('term'))
            if sid in seen:
                raise ValueError('중복 분반 ID입니다.')
            seen.add(sid)
            credits = number(section.get('credits'))
            if credits <= 0:
                raise ValueError('학점이 없는 분반입니다.')
            meetings = section.get('meetings')
            if not isinstance(meetings, list) or not 1 <= len(meetings) <= 30:
                raise ValueError('수업 시간이 미상입니다.')
            for m in meetings:
                integer(m.get('day'), 1, 7, '요일')
                integer(m.get('start'), 0, 1439, '시작')
                integer(m.get('end'), m['start'] + 1, 1440, '종료')
            if any(a['day'] == b['day'] and a['start'] < b['end'] and b['start'] < a['end'] for i, a in enumerate(meetings) for b in meetings[i+1:]):
                raise ValueError('분반 내부의 수업 시간이 겹칩니다.')
            section.setdefault('kind', 'major')
            section.setdefault('group', None)
            section.setdefault('building', '')
            section.setdefault('name', cid)
            if section['kind'] not in ('major', 'general') or not isinstance(section['building'], str) or (section['group'] is not None and not isinstance(section['group'], str)):
                raise ValueError('분반 분류 또는 장소가 올바르지 않습니다.')
            sections.append(section)
            fractions.append(credits)
        except (ValueError, TypeError, AttributeError) as error:
            diagnostics.append(f'분반 데이터 {index + 1} 제외: {error}')
    catalog['sections'] = sorted(sections, key=lambda s: s['section_id'])
    section_ids = {s['section_id'] for s in sections}
    c = request.get('constraints')
    if not isinstance(c, dict):
        raise ValueError('constraints가 필요합니다.')
    allowed_constraints = {'allowed_weekdays', 'credits', 'required_course_ids', 'excluded_course_ids', 'excluded_section_ids', 'locked_section_ids', 'earliest_start', 'latest_end', 'kind_credits', 'attendance_days', 'morning', 'lunch', 'protected_total_credits'}
    if set(c) - allowed_constraints:
        raise ValueError('지원하지 않는 필수 조건이 포함되어 있습니다.')
    for key in ('kind_credits', 'lunch'):
        if key in c and not isinstance(c[key], dict):
            raise ValueError(f'{key}는 객체여야 합니다.')
    for key in ('kind_credits', 'attendance_days', 'morning', 'lunch'):
        if c.get(key) is not None and not isinstance(c[key], dict):
            raise ValueError(f'{key}는 객체여야 합니다.')
    for key in ('ranking', 'selection', 'relaxation_policy', 'baseline', 'legacy_preferences', 'search_options'):
        if key in request and not isinstance(request[key], dict):
            raise ValueError(f'{key}는 객체여야 합니다.')
    days = c.get('allowed_weekdays')
    if not isinstance(days, list) or not days or len(days) != len(set(days)):
        raise ValueError('허용 요일을 선택해 주세요.')
    for day in days:
        integer(day, 1, 7, '요일')
    c['allowed_weekdays'] = sorted(days)
    c['credits'] = credit_range(c.get('credits'))
    if 'protected_total_credits' in c:
        fractions.append(number(c['protected_total_credits']))
    if number(c['credits']['min']) <= 0:
        raise ValueError('최소 학점은 0보다 커야 합니다.')
    for key in ('required_course_ids', 'excluded_course_ids'):
        c[key] = id_list(c.get(key, []), course_ids)
    for key in ('excluded_section_ids', 'locked_section_ids'):
        c[key] = id_list(c.get(key, []), section_ids)
    if set(c['required_course_ids']) & set(c['excluded_course_ids']):
        raise ValueError('필수 과목과 제외 과목이 겹칩니다.')
    if set(c['locked_section_ids']) & set(c['excluded_section_ids']):
        raise ValueError('고정 분반과 제외 분반이 겹칩니다.')
    c.setdefault('earliest_start', 0)
    c.setdefault('latest_end', 1440)
    integer(c['earliest_start'], 0, 1439, '시작 한도')
    integer(c['latest_end'], c['earliest_start'] + 1, 1440, '종료 한도')
    for bound in c.get('kind_credits', {}).values():
        credit_range(bound)
    if set(c.get('kind_credits', {})) - {'major', 'general'}:
        raise ValueError('지원하지 않는 학점 분류입니다.')
    attendance = c.get('attendance_days')
    if attendance is not None:
        if attendance.get('mode') not in ('exact', 'max'):
            raise ValueError('등교일 모드는 exact 또는 max입니다.')
        integer(attendance.get('value'), 0, 7, '등교일')
    morning = c.get('morning')
    if morning is not None:
        if morning.get('unit') not in ('meeting', 'day'):
            raise ValueError('오전 집계 단위는 meeting 또는 day입니다.')
        integer(morning.get('before_minute'), 0, 1440, '오전 경계')
        integer(morning.get('max'), 0, 1000, '오전 상한')
    lunch = c.setdefault('lunch', {'enabled': False})
    if type(lunch.get('enabled')) is not bool:
        raise ValueError('점심 조건을 확인해 주세요.')
    if lunch['enabled']:
        integer(lunch.get('window_start'), 0, 1439, '점심 시작')
        integer(lunch.get('window_end'), lunch['window_start'] + 1, 1440, '점심 종료')
        integer(lunch.get('duration'), 1, lunch['window_end'] - lunch['window_start'], '점심 길이')
        if lunch.get('placement') not in ('within_window', 'between_classes'):
            raise ValueError('점심 위치 모드를 확인해 주세요.')
    ranking = request.setdefault('ranking', {'mode': 'lexicographic', 'profile': 'compact'})
    if ranking.get('mode') != 'lexicographic' or ranking.get('profile') not in ('compact', 'fewer_days', 'balanced', 'personalized'):
        raise ValueError('지원하지 않는 정렬 방식입니다.')
    selection = request.setdefault('selection', {'mode': 'top_k', 'k': 3})
    if selection.get('mode') not in ('top_k', 'by_credit', 'profiles', 'enumerate'):
        raise ValueError('지원하지 않는 선택 방식입니다.')
    selection['k'] = integer(selection.get('k', 3), 1, 2000 if selection['mode'] == 'enumerate' else 36, '후보 수')
    if selection['mode'] == 'by_credit':
        targets = selection.get('credit_targets')
        if not isinstance(targets, list) or not 1 <= len(targets) <= 10 or len(set(map(number, targets))) != len(targets) or any(number(t) <= 0 for t in targets):
            raise ValueError('대표 학점 목록을 확인해 주세요.')
        if 'protected_total_credits' in c and any(number(t) != number(c['protected_total_credits']) for t in targets):
            raise ValueError('보호된 목표 학점을 다른 목표로 바꿀 수 없습니다.')
        fractions.extend(number(x) for x in targets)
    mode = payload.get('mode', 'recommend')
    if mode not in ('recommend', 'relax', 'alternative'):
        raise ValueError('지원하지 않는 실행 모드입니다.')
    policy = request.setdefault('relaxation_policy', {'max_changed': 0, 'rules': {}})
    if policy.setdefault('scope', 'minimum_cost_only') != 'minimum_cost_only':
        raise ValueError('완화 결과는 minimum_cost_only 범위만 지원합니다.')
    integer(policy.get('max_changed', 0), 0, 4, '최대 변경 수')
    if not isinstance(policy.get('rules', {}), dict):
        raise ValueError('완화 정책을 확인해 주세요.')
    levels = {}
    originals = {'credit_range': c['credits'], 'attendance_days': attendance['value'] if attendance else None,
                 'morning_limit': morning['max'] if morning else None, 'lunch_duration': lunch.get('duration') if lunch['enabled'] else None}
    for key, rule in policy.get('rules', {}).items():
        if key not in originals or not isinstance(rule, dict) or type(rule.get('allow')) is not bool:
            raise ValueError('지원하지 않는 완화 항목 또는 허용 값입니다.')
        if not rule['allow']:
            continue
        original = originals[key]
        if original is None:
            raise ValueError('설정되지 않은 조건을 완화할 수 없습니다.')
        integer(rule.get('importance'), 0, 100000, '중요도')
        step = number(rule.get('step'))
        fractions.append(step)
        if step <= 0 or (key != 'credit_range' and step.denominator != 1):
            raise ValueError('완화 단위를 확인해 주세요.')
        values = rule.get('allowed_values')
        if not isinstance(values, list) or len(values) > 30:
            raise ValueError('완화 허용 값을 확인해 주세요.')
        unique = []
        for value in [original, *values]:
            if value in [item['value'] for item in unique]:
                continue
            if key == 'credit_range':
                credit_range(value)
                lower = number(original['min']) - number(value['min'])
                upper = number(value['max']) - number(original['max'])
                if lower < 0 or upper < 0 or (lower / step).denominator != 1 or (upper / step).denominator != 1:
                    raise ValueError('학점 완화는 지정 단위의 범위 확대만 가능합니다.')
                delta = lower + upper
                fractions.extend([number(value['min']), number(value['max'])])
            else:
                integer(value, 1 if key == 'lunch_duration' else 0, 1440 if key == 'lunch_duration' else 1000 if key == 'morning_limit' else 7, key)
                if (key == 'morning_limit' or key == 'attendance_days' and attendance['mode'] == 'max') and value < original:
                    raise ValueError('상한 완화는 증가만 가능합니다.')
                if key == 'lunch_duration' and value > original:
                    raise ValueError('점심 길이 완화는 감소만 가능합니다.')
                delta = abs(value - original)
            units = Fraction(delta) / step
            if units.denominator != 1:
                raise ValueError('허용 값이 지정한 완화 단위와 맞지 않습니다.')
            unique.append({'value': deepcopy(value), 'changed': value != original, 'units': int(units), 'importance': rule['importance']})
        levels[key] = unique
    if mode == 'alternative':
        if levels:
            raise ValueError('대체안과 조건 완화를 합친 복합 모드는 지원하지 않습니다.')
        baseline = request.get('baseline', {})
        baseline['section_ids'] = id_list(baseline.get('section_ids'), section_ids)
        baseline['failed_section_ids'] = id_list(baseline.get('failed_section_ids'), section_ids)
        if not baseline['section_ids'] or not baseline['failed_section_ids']:
            raise ValueError('기존 시간표와 실패 분반을 지정해 주세요.')
        if not set(baseline['failed_section_ids']) <= set(baseline['section_ids']):
            raise ValueError('실패 분반은 기존 시간표에 포함되어야 합니다.')
        if set(baseline['failed_section_ids']) & set(c['locked_section_ids']):
            raise ValueError('실패 분반이 고정 분반입니다. 고정을 자동 해제하지 않습니다.')
        for flag, default in [('allow_course_replacement', False), ('preserve_credit_total', True)]:
            baseline.setdefault(flag, default)
            if type(baseline[flag]) is not bool:
                raise ValueError('대체안 정책을 확인해 주세요.')
        request['baseline'] = baseline
        selected = [s for s in sections if s['section_id'] in baseline['section_ids']]
        meetings = [m for s in selected for m in s['meetings']]
        if len({s['course_id'] for s in selected}) != len(selected) or any(s['term'] != term for s in selected) or any(a['day'] == b['day'] and a['start'] < b['end'] and b['start'] < a['end'] for i, a in enumerate(meetings) for b in meetings[i+1:]):
            raise ValueError('기존 시간표의 학기·과목 중복·시간 충돌을 확인해 주세요.')
    preferences = request.setdefault('legacy_preferences', {})
    preferences['preferred_course_ids'] = id_list(preferences.get('preferred_course_ids', []), course_ids)
    for key in ('late', 'friday', 'compact', 'travel', 'fewDays', 'lunch', 'breaks'):
        if type(preferences.setdefault(key, False)) is not bool:
            raise ValueError('세부 선호를 확인해 주세요.')
    if preferences.get('max_courses_per_day') is not None:
        integer(preferences['max_courses_per_day'], 1, 30, '하루 수업량')
    options = request.setdefault('search_options', {})
    seconds = options.setdefault('time_limit_seconds', 10)
    if type(seconds) not in (int, float) or not 0.001 <= seconds <= 120:
        raise ValueError('실행 시간은 0.001~120초 범위입니다.')
    integer(options.setdefault('workers', 1), 1, 8, '작업 수')
    integer(options.setdefault('seed', 42), 0, 2147483647, 'seed')
    fractions.extend(number(v) for bounds in [c['credits'], *c.get('kind_credits', {}).values()] for v in bounds.values())
    scale = lcm(*(x.denominator for x in fractions)) if fractions else 1
    if scale > 1000000 or sum(number(s['credits']) * scale for s in sections) > 1000000000:
        raise ValueError('학점 정수 배율의 지원 범위를 초과했습니다.')
    digest = hashlib.sha256(json.dumps(catalog, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    return catalog, request, mode, levels, scale, course_ids, diagnostics, digest
