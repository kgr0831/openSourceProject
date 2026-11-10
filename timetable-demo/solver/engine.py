"""CP-SAT owns section selection, lexicographic ranking and policy relaxation."""
from copy import deepcopy
from fractions import Fraction
from time import perf_counter
from uuid import uuid4
import ortools
from ortools.sat.python import cp_model
from schema import normalize, number

PROFILES = {
    'compact': ['total_gap_minutes', 'latest_end', 'max_daily_teaching_minutes', 'morning_meeting_count'],
    'fewer_days': ['attendance_days', 'total_gap_minutes', 'latest_end'],
    'balanced': ['max_daily_teaching_minutes', 'total_gap_minutes', 'latest_end'],
}
RELAX = ['changed_condition_count', 'sum_changed_importance', 'sum_normalized_change_units']


def overlaps(a, b):
    return a['day'] == b['day'] and a['start'] < b['end'] and b['start'] < a['end']


def numeric(value):
    return int(value) if value.denominator == 1 else float(value)


def lunch_interval(events, lunch):
    if not lunch.get('enabled') or not events:
        return None
    for start in range(lunch['window_start'], lunch['window_end'] - lunch['duration'] + 1):
        end = start + lunch['duration']
        if any(e['start'] < end and start < e['end'] for e in events):
            continue
        if lunch['placement'] == 'between_classes' and not (any(e['end'] <= start for e in events) and any(e['start'] >= end for e in events)):
            continue
        return {'start': start, 'end': end}
    return None


def measured(sections, constraints, preferences):
    by_day = {day: sorted([{**m, 'building': s['building']} for s in sections for m in s['meetings'] if m['day'] == day], key=lambda m: m['start']) for day in range(1, 8)}
    days = [d for d, events in by_day.items() if events]
    cutoff = constraints.get('morning', {}).get('before_minute', 720) if constraints.get('morning') else 720
    result = {'attendance_days': len(days), 'day_list': days,
              'total_gap_minutes': 0, 'latest_end': 0, 'max_daily_teaching_minutes': 0,
              'morning_meeting_count': 0, 'morning_day_count': 0, 'friday_classes': 0,
              'building_changes': 0, 'max_daily_courses': 0, 'lunch_missed_days': 0, 'back_to_back_classes': 0,
              'legacy_morning_count': 0}
    lunch = []
    for day, events in by_day.items():
        if not events:
            continue
        teaching = sum(e['end'] - e['start'] for e in events)
        result['total_gap_minutes'] += events[-1]['end'] - events[0]['start'] - teaching
        result['latest_end'] = max(result['latest_end'], events[-1]['end'])
        result['max_daily_teaching_minutes'] = max(result['max_daily_teaching_minutes'], teaching)
        result['max_daily_courses'] = max(result['max_daily_courses'], len(events))
        result['morning_meeting_count'] += sum(e['start'] < cutoff for e in events)
        result['morning_day_count'] += any(e['start'] < cutoff for e in events)
        result['legacy_morning_count'] += sum(e['start'] < 720 for e in events)
        result['friday_classes'] += len(events) if day == 5 else 0
        result['lunch_missed_days'] += lunch_interval(events, {'enabled': True, 'window_start': 720, 'window_end': 840, 'duration': 60, 'placement': 'within_window'}) is None
        for a, b in zip(events, events[1:]):
            result['building_changes'] += a['building'] != b['building']
            result['back_to_back_classes'] += b['start'] - a['end'] < 30
        interval = lunch_interval(events, constraints['lunch'])
        if interval:
            lunch.append({'day': day, **interval, 'placement': constraints['lunch']['placement']})
    p = preferences
    matched = len({s['course_id'] for s in sections} & set(p.get('preferred_course_ids', [])))
    result['legacy_cost_units'] = (
        result['legacy_morning_count'] * 200 * p['late'] + result['friday_classes'] * 320 * p['friday']
        + result['total_gap_minutes'] * p['compact'] + result['building_changes'] * 80 * p['travel']
        + result['attendance_days'] * 240 * p['fewDays'] + result['lunch_missed_days'] * 500 * p['lunch']
        + result['back_to_back_classes'] * 180 * p['breaks'] - matched * 400)
    if p.get('max_courses_per_day'):
        result['legacy_cost_units'] += max(0, result['max_daily_courses'] - p['max_courses_per_day']) * 360
    result['credits'] = numeric(sum((number(s['credits']) for s in sections), Fraction(0)))
    return result, lunch


class Model:
    def __init__(self, context, *, relaxed=False, excluded=(), fixed_relax=None, target=None, personalized=False):
        self.context = context
        catalog, request, mode, levels, scale, course_ids, _, _ = context
        self.request, self.sections, self.scale = request, catalog['sections'], scale
        self.model, self.build_id = cp_model.CpModel(), str(uuid4())
        m, c = self.model, request['constraints']
        self.x = {s['section_id']: m.new_bool_var('section:' + s['section_id']) for s in self.sections}
        self.q = {cid: m.new_bool_var('course:' + cid) for cid in sorted(course_ids)}
        for cid, q in self.q.items():
            m.add(sum(self.x[s['section_id']] for s in self.sections if s['course_id'] == cid) == q)
        for cid in c['required_course_ids']:
            m.add(self.q[cid] == 1)
        for cid in c['excluded_course_ids']:
            m.add(self.q[cid] == 0)
        for sid in c['locked_section_ids']:
            m.add(self.x[sid] == 1)
        for s in self.sections:
            if (s['section_id'] in c['excluded_section_ids'] or s['term'] != request['term'] or
                any(e['day'] not in c['allowed_weekdays'] or e['start'] < c['earliest_start'] or e['end'] > c['latest_end'] for e in s['meetings'])):
                m.add(self.x[s['section_id']] == 0)
        for i, a in enumerate(self.sections):
            for b in self.sections[i+1:]:
                if a['course_id'] == b['course_id'] or any(overlaps(x, y) for x in a['meetings'] for y in b['meetings']):
                    m.add(self.x[a['section_id']] + self.x[b['section_id']] <= 1)
        for group in {s['group'] for s in self.sections if s['group']}:
            m.add(sum(self.x[s['section_id']] for s in self.sections if s['group'] == group) <= 1)
        self.credit = sum(int(number(s['credits']) * scale) * self.x[s['section_id']] for s in self.sections)
        for kind, bounds in c.get('kind_credits', {}).items():
            total = sum(int(number(s['credits']) * scale) * self.x[s['section_id']] for s in self.sections if s['kind'] == kind)
            m.add(total >= int(number(bounds['min']) * scale))
            m.add(total <= int(number(bounds['max']) * scale))
        if target is not None:
            m.add(self.credit == int(number(target) * scale))
        if 'protected_total_credits' in c:
            m.add(self.credit == int(number(c['protected_total_credits']) * scale))
        self.by_day = {day: sorted([{**e, 'sid': s['section_id'], 'building': s['building']} for s in self.sections for e in s['meetings'] if e['day'] == day], key=lambda e: (e['start'], e['end'], e['sid'])) for day in range(1, 8)}
        self.y, teachings, gaps, last_ends, counts, mornings = {}, [], [], [], [], []
        cutoff = c['morning']['before_minute'] if c.get('morning') else 720
        morning_count = 0
        for day, blocks in self.by_day.items():
            y = self.any_selected({e['sid'] for e in blocks}, f'day:{day}')
            self.y[day] = y
            teachings.append(sum((e['end'] - e['start']) * self.x[e['sid']] for e in blocks))
            counts.append(sum(self.x[e['sid']] for e in blocks))
            mornings.append(self.any_selected({e['sid'] for e in blocks if e['start'] < cutoff}, f'morning:{day}'))
            morning_count += sum(self.x[e['sid']] for e in blocks if e['start'] < cutoff)
            first = m.new_int_var(0, 1440, f'first:{day}')
            last = m.new_int_var(0, 1440, f'last:{day}')
            if blocks:
                raw = m.new_int_var(0, 1440, f'first_raw:{day}')
                m.add_min_equality(raw, [1440 + (e['start'] - 1440) * self.x[e['sid']] for e in blocks])
                m.add(first == raw).only_enforce_if(y)
                m.add(first == 0).only_enforce_if(y.Not())
                m.add_max_equality(last, [e['end'] * self.x[e['sid']] for e in blocks])
            else:
                m.add(first == 0)
                m.add(last == 0)
            gaps.append(last - first - teachings[-1])
            last_ends.append(last)
        max_teaching = m.new_int_var(0, 1440, 'max_daily_teaching')
        m.add_max_equality(max_teaching, teachings)
        max_count = m.new_int_var(0, 15000, 'max_daily_courses')
        m.add_max_equality(max_count, counts)
        latest = m.new_int_var(0, 1440, 'latest_end')
        m.add_max_equality(latest, last_ends)
        self.metrics = {'attendance_days': sum(self.y.values()), 'total_gap_minutes': sum(gaps), 'latest_end': latest,
            'max_daily_teaching_minutes': max_teaching, 'morning_meeting_count': morning_count,
            'morning_day_count': sum(mornings), 'max_daily_courses': max_count}
        self.level_vars = {}
        for key, values in levels.items() if relaxed else []:
            z = [(m.new_bool_var(f'{key}:{i}'), value) for i, value in enumerate(values)]
            m.add(sum(v for v, _ in z) == 1)
            self.level_vars[key] = z
        self.metrics.update({name: sum((int(value['changed']) if i == 0 else int(value['changed']) * value['importance'] if i == 1 else value['units']) * z for choices in self.level_vars.values() for z, value in choices) for i, name in enumerate(RELAX)})
        m.add(self.metrics[RELAX[0]] <= request['relaxation_policy'].get('max_changed', 0))
        if fixed_relax is not None:
            for key, value in zip(RELAX, fixed_relax):
                m.add(self.metrics[key] == value)
        def bounds(value, z=None):
            for constraint in (m.add(self.credit >= int(number(value['min']) * scale)), m.add(self.credit <= int(number(value['max']) * scale))):
                if z is not None:
                    constraint.only_enforce_if(z)
        if 'credit_range' in self.level_vars:
            for z, level in self.level_vars['credit_range']:
                bounds(level['value'], z)
        else:
            bounds(c['credits'])
        if c.get('attendance_days'):
            choices = self.level_vars.get('attendance_days', [(None, {'value': c['attendance_days']['value']})])
            for z, level in choices:
                expression = self.metrics['attendance_days']
                constraint = m.add(expression == level['value']) if c['attendance_days']['mode'] == 'exact' else m.add(expression <= level['value'])
                if z is not None:
                    constraint.only_enforce_if(z)
        if c.get('morning'):
            choices = self.level_vars.get('morning_limit', [(None, {'value': c['morning']['max']})])
            expression = self.metrics['morning_meeting_count' if c['morning']['unit'] == 'meeting' else 'morning_day_count']
            for z, level in choices:
                constraint = m.add(expression <= level['value'])
                if z is not None:
                    constraint.only_enforce_if(z)
        if c['lunch']['enabled']:
            choices = self.level_vars.get('lunch_duration', [(None, {'value': c['lunch']['duration']})])
            for day, blocks in self.by_day.items():
                witnesses = []
                for z, level in choices:
                    for blocked, before, after in self.lunch_patterns(blocks, {**c['lunch'], 'duration': level['value']}):
                        w = m.new_bool_var('lunch_witness')
                        witnesses.append(w)
                        if z is not None:
                            m.add(w <= z)
                        for sid in blocked:
                            m.add(w + self.x[sid] <= 1)
                        if c['lunch']['placement'] == 'between_classes':
                            m.add(sum(self.x[sid] for sid in before) >= w)
                            m.add(sum(self.x[sid] for sid in after) >= w)
                m.add(sum(witnesses) == self.y[day])
        if mode == 'alternative':
            baseline = request['baseline']
            chosen = [s for s in self.sections if s['section_id'] in baseline['section_ids']]
            bc, bs = {s['course_id'] for s in chosen}, set(baseline['section_ids'])
            for sid in baseline['failed_section_ids']:
                m.add(self.x[sid] == 0)
            if not baseline['allow_course_replacement']:
                for cid, q in self.q.items():
                    m.add(q == int(cid in bc))
            if baseline['preserve_credit_total']:
                m.add(self.credit == sum(int(number(s['credits']) * scale) for s in chosen))
            self.metrics['course_changes'] = sum(1 - q if cid in bc else q for cid, q in self.q.items())
            self.metrics['section_changes'] = sum(1 - x if sid in bs else x for sid, x in self.x.items())
        for prior in excluded:
            self.exclude(prior)
        if personalized:
            self.build_legacy_cost()

    def any_selected(self, ids, name):
        b = self.model.new_bool_var(name)
        self.model.add_max_equality(b, [self.x[sid] for sid in sorted(ids)] or [0])
        return b

    @staticmethod
    def lunch_patterns(blocks, lunch):
        # Enumerate every integer minute, then merge only logically identical choices.
        # This preserves witnesses such as 12:07 that a 15-minute grid would miss.
        patterns = set()
        for start in range(lunch['window_start'], lunch['window_end'] - lunch['duration'] + 1):
            end = start + lunch['duration']
            blocked = frozenset(e['sid'] for e in blocks if e['start'] < end and start < e['end'])
            before = frozenset(e['sid'] for e in blocks if e['end'] <= start) if lunch['placement'] == 'between_classes' else frozenset()
            after = frozenset(e['sid'] for e in blocks if e['start'] >= end) if lunch['placement'] == 'between_classes' else frozenset()
            patterns.add((blocked, before, after))
        return sorted(patterns, key=lambda p: tuple(tuple(sorted(x)) for x in p))

    def build_legacy_cost(self):
        m, p = self.model, self.request['legacy_preferences']
        cost = sum(self.x[s['section_id']] * (200 * sum(e['start'] < 720 for e in s['meetings']) * p['late'] + 320 * sum(e['day'] == 5 for e in s['meetings']) * p['friday']) for s in self.sections)
        cost += self.metrics['total_gap_minutes'] * p['compact'] + self.metrics['attendance_days'] * 240 * p['fewDays']
        cost -= 400 * sum(self.q[cid] for cid in p['preferred_course_ids'])
        if p.get('max_courses_per_day'):
            excess = m.new_int_var(0, 15000, 'daily_excess')
            m.add_max_equality(excess, [0, self.metrics['max_daily_courses'] - p['max_courses_per_day']])
            cost += 360 * excess
        for day, blocks in self.by_day.items():
            if p['lunch']:
                free = []
                for blocked, _, _ in self.lunch_patterns(blocks, {'window_start': 720, 'window_end': 840, 'duration': 60, 'placement': 'within_window'}):
                    w = m.new_bool_var('soft_lunch')
                    m.add_bool_and([self.x[sid].Not() for sid in blocked]).only_enforce_if(w)
                    m.add_bool_or([self.x[sid] for sid in blocked]).only_enforce_if(w.Not())
                    free.append(w)
                exists = m.new_bool_var('soft_lunch_exists')
                m.add_max_equality(exists, free)
                missed = m.new_bool_var('soft_lunch_missed')
                m.add(missed == 1 - exists).only_enforce_if(self.y[day])
                m.add(missed == 0).only_enforce_if(self.y[day].Not())
                cost += 500 * missed
            if p['travel'] or p['breaks']:
                for i, a in enumerate(blocks):
                    for j in range(i + 1, len(blocks)):
                        b = blocks[j]
                        penalty = 80 * p['travel'] * (a['building'] != b['building']) + 180 * p['breaks'] * (b['start'] - a['end'] < 30)
                        if a['end'] > b['start'] or not penalty:
                            continue
                        adjacent = m.new_bool_var('adjacent')
                        terms = [self.x[a['sid']], self.x[b['sid']], *[self.x[e['sid']].Not() for e in blocks[i+1:j]]]
                        m.add_bool_and(terms).only_enforce_if(adjacent)
                        m.add_bool_or([term.Not() for term in terms]).only_enforce_if(adjacent.Not())
                        cost += penalty * adjacent
        self.metrics['legacy_cost_units'] = cost

    def exclude(self, selected):
        selected = set(selected)
        self.model.add(sum(1 - x if sid in selected else x for sid, x in self.x.items()) >= 1)

    def snapshot(self, solver):
        selected = [s for s in self.sections if solver.value(self.x[s['section_id']])]
        effective = deepcopy(self.request['constraints'])
        changes = []
        for key, choices in self.level_vars.items():
            level = next(level for z, level in choices if solver.value(z))
            value = level['value']
            if key == 'credit_range':
                before = effective['credits']; effective['credits'] = deepcopy(value)
            elif key == 'attendance_days':
                before = effective['attendance_days']['value']; effective['attendance_days']['value'] = value
            elif key == 'morning_limit':
                before = effective['morning']['max']; effective['morning']['max'] = value
            else:
                before = effective['lunch']['duration']; effective['lunch']['duration'] = value
            if level['changed']:
                changes.append({'condition': key, 'from': before, 'to': deepcopy(value), 'units': level['units'], 'importance': level['importance']})
        metrics, lunches = measured(selected, effective, self.request['legacy_preferences'])
        model_metrics = {key: solver.value(value) for key, value in self.metrics.items()}
        for key in set(model_metrics) & set(metrics):
            if model_metrics[key] != metrics[key]:
                raise RuntimeError('model metric mismatch: ' + key)
        result = {'section_ids': [s['section_id'] for s in selected], 'metrics': metrics, 'model_metrics': model_metrics,
            'effective_constraints': effective, 'changes': changes, 'lunch_intervals': lunches, 'model_build_id': self.build_id}
        if self.context[2] == 'alternative':
            baseline = self.request['baseline']; prior = [s for s in self.sections if s['section_id'] in baseline['section_ids']]
            old, new = {s['course_id'] for s in prior}, {s['course_id'] for s in selected}
            result['alternative_changes'] = {'removed_course_ids': sorted(old - new), 'added_course_ids': sorted(new - old),
                'removed_section_ids': sorted(set(baseline['section_ids']) - set(result['section_ids'])),
                'added_section_ids': sorted(set(result['section_ids']) - set(baseline['section_ids'])),
                'section_replacements': [{'course_id': cid, 'from': next(s['section_id'] for s in prior if s['course_id'] == cid), 'to': next(s['section_id'] for s in selected if s['course_id'] == cid)} for cid in sorted(old & new) if next(s['section_id'] for s in prior if s['course_id'] == cid) != next(s['section_id'] for s in selected if s['course_id'] == cid)]}
        return result


class Budget:
    def __init__(self, options, solver_factory=cp_model.CpSolver):
        self.options, self.factory, self.started = options, solver_factory, perf_counter()
        self.deadline = self.started + options['time_limit_seconds']
        self.phases = []

    def solve(self, bundle, stage, expression=None):
        remaining = self.deadline - perf_counter()
        if remaining <= 0:
            return 'BUDGET_EXHAUSTED', None, None
        m = bundle.model
        m.clear_objective()
        if expression is not None:
            m.minimize(expression)
        solver = self.factory()
        solver.parameters.max_time_in_seconds = remaining
        solver.parameters.num_search_workers = self.options['workers']
        solver.parameters.random_seed = self.options['seed']
        solver.parameters.relative_gap_limit = 0
        solver.parameters.absolute_gap_limit = 0
        solver.parameters.log_search_progress = False
        begin = perf_counter()
        raw = solver.solve(m)
        status = solver.status_name(raw)
        valid = raw in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        value = solver.value(expression) if valid and expression is not None else None
        self.phases.append({'stage': stage, 'model_build_id': bundle.build_id, 'raw_status': status,
            'objective_value': value, 'best_bound': solver.best_objective_bound if expression is not None else None,
            'elapsed_seconds': perf_counter() - begin, 'remaining_seconds_before': remaining,
            'relative_gap_limit': 0, 'absolute_gap_limit': 0, 'proven': status == 'OPTIMAL'})
        return status, bundle.snapshot(solver) if valid else None, value


def ranked(bundle, budget, profile, prefix, personalized, label, incumbent=None):
    names = prefix + (['legacy_cost_units'] if personalized else []) + PROFILES[profile]
    proven, snapshot, status = [], incumbent, 'UNKNOWN'
    for name in names:
        status, found, value = budget.solve(bundle, f'{label}/{name}', bundle.metrics[name])
        if found is not None:
            snapshot = found
        if status != 'OPTIMAL':
            break
        proven.append(name)
        bundle.model.add(bundle.metrics[name] == value)
    else:
        # Exact sorted-list lexicographic tie-break. End-of-list (0) precedes
        # any next ID; minimizing a sum of ID indexes would be incorrect.
        ids = sorted(bundle.x)
        offset, index = 0, 0
        while offset < len(ids):
            tail = ids[offset:]
            raw = bundle.model.new_int_var(1, len(ids) + 1, 'next_id_raw')
            bundle.model.add_min_equality(raw, [len(ids) + 1 + (i + 1 - len(ids) - 1) * bundle.x[ids[i]] for i in range(offset, len(ids))])
            any_tail = bundle.any_selected(set(tail), 'any_tail')
            next_id = bundle.model.new_int_var(0, len(ids), 'next_id')
            bundle.model.add(next_id == raw).only_enforce_if(any_tail)
            bundle.model.add(next_id == 0).only_enforce_if(any_tail.Not())
            status, found, value = budget.solve(bundle, f'{label}/canonical_section_id_list/{index}', next_id)
            if found is not None:
                snapshot = found
            if status != 'OPTIMAL':
                break
            if value == 0:
                proven.append('canonical_section_id_list')
                break
            for i in range(offset, value - 1):
                bundle.model.add(bundle.x[ids[i]] == 0)
            bundle.model.add(bundle.x[ids[value - 1]] == 1)
            offset, index = value, index + 1
        else:
            proven.append('canonical_section_id_list')
    if snapshot is not None:
        if status == 'INFEASIBLE':
            # A proven optimum or a valid incumbent cannot become infeasible
            # under its own equalities. Do not mislabel a model error as exhaustion.
            status = 'MODEL_INVALID'
        snapshot = deepcopy(snapshot)
        snapshot.update({'profile': profile, 'personalized': personalized, 'proven_objective_prefix': proven,
                         'ranking_proven': 'canonical_section_id_list' in proven, 'rank_termination': status})
    return status, snapshot


def run(payload, solver_factory=cp_model.CpSolver):
    context = normalize(payload)
    catalog, request, mode, levels, scale, _, diagnostics, digest = context
    budget = Budget(request['search_options'], solver_factory)
    personalized = request['ranking']['profile'] == 'personalized'
    selection = request['selection']
    if selection['mode'] == 'by_credit':
        return by_credit(payload, context, budget, solver_factory)
    first = Model(context, personalized=personalized)
    original_status, original, _ = budget.solve(first, 'original/feasibility')
    relaxed = original_status == 'INFEASIBLE' and mode == 'relax' and bool(levels)
    results, prefix, fixed_relax = [], [], None
    termination, exhausted = original_status, original_status == 'INFEASIBLE' and not relaxed
    if relaxed:
        prefix = RELAX[:]
    if mode == 'alternative':
        prefix = ['course_changes', 'section_changes']
    if original is not None or relaxed:
        plans = [(request['ranking']['profile'] if not personalized else 'fewer_days', None)] * selection['k']
        if selection['mode'] == 'profiles':
            plans = [(p, None) for p in ('fewer_days', 'balanced', 'compact')]
        elif selection['mode'] == 'by_credit':
            plans = [(request['ranking']['profile'] if not personalized else 'compact', t) for t in selection['credit_targets']]
        for rank, (profile, target) in enumerate(plans):
            bundle = Model(context, relaxed=relaxed, excluded=[r['section_ids'] for r in results], fixed_relax=fixed_relax, target=target, personalized=personalized)
            label = f'{mode}/rank:{rank + 1}' + (f'/credit:{target}' if target is not None else '')
            if selection['mode'] == 'enumerate':
                if relaxed:
                    raise ValueError('완화 전수 열거는 지원하지 않습니다. top_k를 사용해 주세요.')
                termination, result, _ = budget.solve(bundle, label + '/enumeration')
                if result is not None:
                    result.update({'profile': profile, 'personalized': personalized, 'ranking_proven': False, 'proven_objective_prefix': [], 'rank_termination': termination})
            else:
                # Only an incumbent from the same model scope can be retained.
                incumbent = original if rank == 0 and target is None and not relaxed else None
                termination, result = ranked(bundle, budget, profile, prefix, personalized, label, incumbent)
            if termination == 'INFEASIBLE':
                if selection['mode'] in ('top_k', 'enumerate'):
                    exhausted = True
                    termination = 'EXHAUSTED'
                    break
                continue
            if result is not None:
                if target is not None:
                    result['credit_target'] = target
                results.append(result)
                if relaxed and all(name in result['proven_objective_prefix'] for name in RELAX):
                    fixed_relax = [result['model_metrics'][name] for name in RELAX]
                if relaxed and fixed_relax is None:
                    break
            if termination != 'OPTIMAL':
                break
        else:
            termination = 'REQUESTED_LIMIT'
    if original_status in ('UNKNOWN', 'BUDGET_EXHAUSTED') and original is None:
        termination = original_status
    if original_status == 'MODEL_INVALID':
        return {'error': {'code': 'MODEL_INVALID', 'message': 'CP-SAT 모델 검증에 실패했습니다.'}, 'phase_results': budget.phases}
    total = len(results) if exhausted else None
    return {'engine': 'ortools-cp-sat', 'engine_version': ortools.__version__, 'model_build_id': first.build_id,
        'catalog_version_or_hash': digest, 'catalog_version': catalog['version'], 'credit_scale': scale,
        'normalized_request': request, 'mode': mode, 'original_status': original_status,
        'original_constraints': deepcopy(request['constraints']),
        'effective_constraints': results[0]['effective_constraints'] if results else deepcopy(request['constraints']),
        'changes': results[0]['changes'] if results else [], 'phase_results': budget.phases,
        'proven_objective_prefix': results[0]['proven_objective_prefix'] if results else [],
        'minimality_proven': (original is not None) or (relaxed and fixed_relax is not None),
        'minimum_relaxation_cost': fixed_relax, 'ranking_proven': selection['mode'] == 'top_k' and bool(results) and all(r['ranking_proven'] for r in results),
        'coverage': 'exhaustive' if exhausted else 'partial', 'termination_reason': termination,
        'coverage_scope': {'mode': 'minimum_cost_only' if relaxed else 'original', 'relaxation_cost': fixed_relax},
        'returned_unique_count': len(results), 'total_unique_count_or_null': total, 'recommendations': results,
        'diagnostics': diagnostics, 'warnings': ['시간·분반·강의실의 실제 개설 여부와 수강 자격은 별도 확인이 필요합니다.'],
        'elapsed_seconds': perf_counter() - budget.started}


def by_credit(payload, context, budget, solver_factory):
    """Each target has its own protected credit equality and minimum relaxation."""
    catalog, request, mode, _, scale, _, diagnostics, digest = context
    children, recommendations = [], []
    for target in request['selection']['credit_targets']:
        remaining = budget.deadline - perf_counter()
        if remaining < 0.001:
            break
        child = deepcopy(payload)
        child['request'] = deepcopy(request)
        child['request']['selection'] = {'mode': 'top_k', 'k': 1}
        child['request']['constraints']['protected_total_credits'] = target
        child['request']['search_options']['time_limit_seconds'] = remaining
        result = run(child, solver_factory)
        if 'error' in result:
            return result
        for item in result['recommendations']:
            item['credit_target'] = target
            item['target_original_status'] = result['original_status']
            item['minimality_proven'] = result['minimality_proven']
            recommendations.append(item)
        children.append({'credit_target': target, **{k: result[k] for k in ('original_status', 'minimum_relaxation_cost', 'minimality_proven', 'ranking_proven', 'termination_reason')}})
        budget.phases.extend({**p, 'credit_target': target} for p in result['phase_results'])
    return {'engine': 'ortools-cp-sat', 'engine_version': ortools.__version__, 'model_build_id': str(uuid4()),
        'catalog_version_or_hash': digest, 'catalog_version': catalog['version'], 'credit_scale': scale,
        'normalized_request': request, 'mode': mode, 'original_status': 'PER_TARGET',
        'original_constraints': deepcopy(request['constraints']), 'effective_constraints': None, 'changes': [],
        'phase_results': budget.phases, 'target_results': children, 'proven_objective_prefix': [],
        'minimality_proven': len(children) == len(request['selection']['credit_targets']) and all(c['minimality_proven'] for c in children),
        'minimum_relaxation_cost': None, 'ranking_proven': False, 'coverage': 'partial',
        'termination_reason': 'REQUESTED_TARGETS' if len(children) == len(request['selection']['credit_targets']) else 'BUDGET_EXHAUSTED',
        'returned_unique_count': len(recommendations), 'total_unique_count_or_null': None,
        'recommendations': recommendations, 'diagnostics': diagnostics, 'warnings': [],
        'elapsed_seconds': perf_counter() - budget.started}
