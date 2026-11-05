"""Actual CP-SAT tests; controlled status doubles are explicitly named below."""
import unittest
from copy import deepcopy
from itertools import combinations
from ortools.sat.python import cp_model
from engine import run, Model, Budget, RELAX, overlaps
from schema import normalize


def section(sid, cid=None, credits=1, blocks=None, **extra):
    return {'section_id': sid, 'course_id': cid or sid, 'term': '2026-2', 'credits': credits,
            'name': '한글 과목 ' + sid, 'meetings': blocks or [{'day': 1, 'start': 600, 'end': 660}], **extra}


def block(start, end, day=1):
    return {'day': day, 'start': start, 'end': end}


def payload(sections, minimum=1, maximum=1, **constraints):
    return {'catalog': {'version': 'synthetic-v1', 'sections': sections}, 'request': {
        'term': '2026-2', 'catalog_version': 'synthetic-v1',
        'constraints': {'allowed_weekdays': [1, 2, 3, 4, 5], 'credits': {'min': minimum, 'max': maximum}, **constraints},
        'ranking': {'mode': 'lexicographic', 'profile': 'compact'}, 'selection': {'mode': 'top_k', 'k': 3},
        'search_options': {'time_limit_seconds': 5, 'workers': 1, 'seed': 42}}}


def relax(p, key, values, step=1, importance=1, max_changed=1):
    p['mode'] = 'relax'
    p['request']['relaxation_policy'] = {'max_changed': max_changed, 'rules': {
        key: {'allow': True, 'importance': importance, 'step': step, 'allowed_values': values}}}
    return p


class ActualEngineTests(unittest.TestCase):
    def assert_actual(self, result):
        self.assertEqual(result['engine'], 'ortools-cp-sat')
        self.assertRegex(result['engine_version'], r'^9\.15\.6755$')
        self.assertTrue(result['phase_results'])
        self.assertTrue(all(p['relative_gap_limit'] == p['absolute_gap_limit'] == 0 for p in result['phase_results']))

    def test_ORT001_002_003_actual_protected_conflict_and_valid_model(self):
        p = payload([section('A'), section('B')], 2, 2, required_course_ids=['A', 'B'])
        result = run(relax(p, 'credit_range', [{'min': 1, 'max': 3}]))
        self.assert_actual(result)
        self.assertEqual(result['original_status'], 'INFEASIBLE')
        self.assertEqual(result['recommendations'], [])
        p['catalog']['sections'][1]['meetings'] = [block(660, 720)]
        result = run(p)
        self.assertEqual(result['recommendations'][0]['section_ids'], ['A', 'B'])
        self.assertEqual(result['recommendations'][0]['changes'], [])

    def test_ORT004_013_minimum_relaxation_scope_and_reoptimized_next_rank(self):
        p = payload([section('A', blocks=[block(540, 600)]), section('B', blocks=[block(600, 660)]),
                     section('C1', 'C', blocks=[block(660, 720)]), section('C2', 'C', blocks=[block(670, 730)]),
                     section('D', blocks=[block(480, 540)])], 3, 4,
                    required_course_ids=['A', 'B', 'C'], morning={'before_minute': 720, 'unit': 'meeting', 'max': 2})
        p['request']['selection']['k'] = 4
        result = run(relax(p, 'morning_limit', [3, 4], importance=5))
        self.assert_actual(result)
        self.assertEqual(result['original_status'], 'INFEASIBLE')
        self.assertEqual(result['original_constraints']['morning']['max'], 2)
        self.assertEqual(result['minimum_relaxation_cost'], [1, 5, 1])
        self.assertTrue(result['minimality_proven'])
        self.assertEqual([c['metrics']['total_gap_minutes'] for c in result['recommendations']], [0, 10])
        self.assertEqual(result['total_unique_count_or_null'], 2)
        self.assertEqual(result['coverage_scope']['mode'], 'minimum_cost_only')
        self.assertTrue(all(c['effective_constraints']['morning']['max'] == 3 and 'D' not in c['section_ids'] for c in result['recommendations']))
        self.assertTrue(all(name in result['proven_objective_prefix'] for name in RELAX))

    def test_ORT007_exact_exclusion_keeps_superset(self):
        p = payload([section('A'), section('B', blocks=[block(660, 720)])], 1, 2, required_course_ids=['A'])
        p['request']['selection'] = {'mode': 'enumerate', 'k': 10}
        result = run(p)
        self.assertEqual({tuple(c['section_ids']) for c in result['recommendations']}, {('A',), ('A', 'B')})
        self.assertEqual(result['coverage'], 'exhaustive')
        self.assertEqual(result['total_unique_count_or_null'], 2)

    def test_ORT008_lunch_witnesses_do_not_inflate_unique_count(self):
        p = payload([section('A')], lunch={'enabled': True, 'window_start': 720, 'window_end': 840, 'duration': 60, 'placement': 'within_window'})
        result = run(p)
        self.assertEqual(result['returned_unique_count'], 1)
        self.assertEqual(result['total_unique_count_or_null'], 1)
        self.assertEqual(result['recommendations'][0]['lunch_intervals'], [{'day': 1, 'start': 720, 'end': 780, 'placement': 'within_window'}])

    def test_ORT009_top_two_restore_numeric_objectives(self):
        p = payload([section('A', blocks=[block(540, 600)]), section('B1', 'B'), section('B2', 'B', blocks=[block(660, 720)])], 2, 2, required_course_ids=['A', 'B'])
        p['request']['selection']['k'] = 2
        result = run(p)
        self.assertEqual([c['metrics']['total_gap_minutes'] for c in result['recommendations']], [0, 60])
        self.assertTrue(result['ranking_proven'])
        self.assertIsNone(result['total_unique_count_or_null'])

    def test_ORT010_fractional_credits_are_exact(self):
        p = payload([section('A', credits=1.5), section('B', credits=0.3, blocks=[block(660, 720)])], 1.8, 1.8)
        result = run(p)
        self.assertEqual(result['credit_scale'], 10)
        self.assertEqual(result['recommendations'][0]['metrics']['credits'], 1.8)
        self.assertEqual(result['recommendations'][0]['section_ids'], ['A', 'B'])

    def test_ORT011_lunch_relaxation_keeps_original_catalog(self):
        p = payload([section('A', blocks=[block(660, 755)]), section('B', blocks=[block(800, 860)])], 2, 2,
                    required_course_ids=['A', 'B'], lunch={'enabled': True, 'window_start': 720, 'window_end': 840, 'duration': 60, 'placement': 'between_classes'})
        result = run(relax(p, 'lunch_duration', [45, 30], step=15))
        self.assertEqual(result['original_status'], 'INFEASIBLE')
        self.assertEqual(result['minimum_relaxation_cost'], [1, 1, 1])
        c = result['recommendations'][0]
        self.assertEqual(c['section_ids'], ['A', 'B'])
        self.assertEqual(c['lunch_intervals'][0]['start'], 755)
        self.assertEqual(c['lunch_intervals'][0]['end'], 800)

    def test_ORT014_exact_id_list_prefix_tiebreak_and_bounds(self):
        p = payload([section('B', blocks=[block(540, 570, 2)]), section('A')], 1, 2, required_course_ids=['A'])
        p['request']['ranking']['profile'] = 'balanced'
        result = run(p)
        self.assertEqual([c['section_ids'] for c in result['recommendations']], [['A'], ['A', 'B']])
        for phase in result['phase_results']:
            if phase['raw_status'] == 'OPTIMAL' and phase['objective_value'] is not None:
                self.assertEqual(phase['objective_value'], phase['best_bound'])
        p['request']['search_options']['seed'] = 987
        self.assertEqual([c['section_ids'] for c in run(p)['recommendations']], [['A'], ['A', 'B']])

    def test_actual_alternative_same_courses_and_locked_sections(self):
        p = payload([section('A1', 'A'), section('A2', 'A', blocks=[block(660, 720)]), section('B', blocks=[block(720, 780)])], 2, 2, locked_section_ids=['B'])
        p['mode'] = 'alternative'
        p['request']['baseline'] = {'section_ids': ['A1', 'B'], 'failed_section_ids': ['A1']}
        result = run(p)
        self.assert_actual(result)
        c = result['recommendations'][0]
        self.assertEqual(c['section_ids'], ['A2', 'B'])
        self.assertEqual(c['model_metrics']['course_changes'], 0)
        self.assertEqual(c['model_metrics']['section_changes'], 2)
        self.assertEqual(c['alternative_changes']['section_replacements'], [{'course_id': 'A', 'from': 'A1', 'to': 'A2'}])
        p['request']['baseline']['failed_section_ids'] = ['B']
        with self.assertRaises(ValueError):
            run(p)

    def test_multiblock_morning_meeting_vs_day_and_strict_cutoff(self):
        p = payload([section('A', blocks=[block(600, 630), block(660, 690), block(720, 750)])],
                    morning={'before_minute': 720, 'unit': 'meeting', 'max': 1})
        self.assertEqual(run(p)['original_status'], 'INFEASIBLE')
        p['request']['constraints']['morning']['unit'] = 'day'
        c = run(p)['recommendations'][0]
        self.assertEqual(c['metrics']['morning_meeting_count'], 2)
        self.assertEqual(c['metrics']['morning_day_count'], 1)

    def test_lunch_integer_minute_1207_and_between_classes_requirement(self):
        p = payload([section('A', blocks=[block(600, 727), block(787, 900)])],
                    lunch={'enabled': True, 'window_start': 720, 'window_end': 840, 'duration': 60, 'placement': 'between_classes'})
        self.assertEqual(run(p)['recommendations'][0]['lunch_intervals'][0]['start'], 727)
        p['catalog']['sections'][0]['meetings'].pop()
        self.assertEqual(run(p)['original_status'], 'INFEASIBLE')
        p['request']['constraints']['lunch']['placement'] = 'within_window'
        self.assertEqual(run(p)['returned_unique_count'], 1)

    def test_policy_allow_false_zero_importance_and_invalid_steps(self):
        p = payload([section('A')], morning={'before_minute': 720, 'unit': 'meeting', 'max': 0})
        relax(p, 'morning_limit', [1], importance=0)
        p['request']['relaxation_policy']['rules']['morning_limit']['allow'] = False
        self.assertEqual(run(p)['recommendations'], [])
        p['request']['relaxation_policy']['rules']['morning_limit']['allow'] = True
        self.assertEqual(run(p)['minimum_relaxation_cost'], [1, 0, 1])
        p['request']['relaxation_policy']['rules']['morning_limit']['step'] = 2
        with self.assertRaises(ValueError):
            run(p)

    def test_credit_lower_and_upper_are_one_group_and_exact_step(self):
        p = payload([section('A', credits=4)], 3, 3)
        result = run(relax(p, 'credit_range', [{'min': 2, 'max': 4}], importance=2))
        self.assertEqual(result['minimum_relaxation_cost'], [1, 2, 2])
        self.assertEqual(len(result['changes']), 1)

    def test_by_credit_has_independent_protected_targets_and_relax_costs(self):
        p = payload([section('A', credits=1.5), section('B', credits=2, blocks=[block(720, 780)])], 1.5, 1.5)
        p['request']['selection'] = {'mode': 'by_credit', 'credit_targets': [1.5, 2]}
        result = run(relax(p, 'credit_range', [{'min': 1.5, 'max': 2}], step=0.5))
        self.assertEqual([c['credit_target'] for c in result['recommendations']], [1.5, 2])
        self.assertEqual([c['metrics']['credits'] for c in result['recommendations']], [1.5, 2])
        self.assertEqual([c['minimum_relaxation_cost'] for c in result['target_results']], [None, [1, 1, 1]])

    def test_exhaustive_matches_independent_small_set_enumerator(self):
        sections = [section('A', blocks=[block(540, 600)]), section('B1', 'B'), section('B2', 'B', blocks=[block(590, 620)]), section('C', blocks=[block(660, 720, 2)])]
        p = payload(sections, 1, 3)
        p['request']['selection'] = {'mode': 'enumerate', 'k': 100}
        expected = set()
        for size in range(1, 4):
            for chosen in combinations(sections, size):
                events = [e for s in chosen for e in s['meetings']]
                if len({s['course_id'] for s in chosen}) == size and not any(overlaps(a, b) for i, a in enumerate(events) for b in events[i+1:]):
                    expected.add(tuple(sorted(s['section_id'] for s in chosen)))
        result = run(p)
        self.assertEqual({tuple(c['section_ids']) for c in result['recommendations']}, expected)
        self.assertEqual(result['total_unique_count_or_null'], len(expected))

    def test_term_allowed_days_and_invalid_section_diagnostics(self):
        p = payload([section('A'), section('B', term='2026-1'), section('C', blocks=[block(600, 660, 2)])], attendance_days={'mode': 'exact', 'value': 1})
        p['request']['constraints']['allowed_weekdays'] = [1]
        p['catalog']['sections'].append(section('unknown', blocks=[{'day': 1, 'start': 600}]))
        result = run(p)
        self.assertEqual(result['recommendations'][0]['section_ids'], ['A'])
        self.assertTrue(result['diagnostics'])

    def test_ORT006_actual_tight_budget_records_observed_status(self):
        p = payload([section(str(i), blocks=[block(540 + i * 10, 550 + i * 10)]) for i in range(20)], 1, 5)
        p['request']['search_options']['time_limit_seconds'] = 0.001
        result = run(p)
        self.assertIn(result['original_status'], ['OPTIMAL', 'FEASIBLE', 'UNKNOWN', 'BUDGET_EXHAUSTED'])
        self.assertEqual(result['coverage'], 'partial')
        if not result['recommendations']:
            self.assertFalse(result['ranking_proven'])


class ControlledStatusBoundaryTests(unittest.TestCase):
    """Only these tests override reported status; ordinary integration uses real status."""
    def factory(self, at, status):
        calls = []
        class Controlled:
            def __init__(self):
                self.solver = cp_model.CpSolver()
                self.parameters = self.solver.parameters
            def solve(self, model):
                calls.append(1)
                actual = self.solver.solve(model)
                return status if len(calls) == at else actual
            def __getattr__(self, name):
                return getattr(self.solver, name)
        return Controlled

    def test_ORT005_feasible_frontier_is_not_fixed_or_proven(self):
        result = run(payload([section('A'), section('B')]), self.factory(2, cp_model.FEASIBLE))
        self.assertEqual(len(result['phase_results']), 2)
        self.assertEqual(result['proven_objective_prefix'], [])
        self.assertFalse(result['ranking_proven'])
        self.assertEqual(result['termination_reason'], 'FEASIBLE')
        self.assertEqual(result['returned_unique_count'], 1)

    def test_ORT006_unknown_and_model_invalid_preserve_prior_incumbent(self):
        for status, label in [(cp_model.UNKNOWN, 'UNKNOWN'), (cp_model.MODEL_INVALID, 'MODEL_INVALID')]:
            result = run(payload([section('A')]), self.factory(3, status))
            self.assertEqual(result['termination_reason'], label)
            self.assertEqual(result['returned_unique_count'], 1)
            self.assertEqual(result['proven_objective_prefix'], ['total_gap_minutes'])
            self.assertFalse(result['ranking_proven'])
            self.assertEqual(result['coverage'], 'partial')

    def test_initial_model_invalid_is_explicit_error(self):
        result = run(payload([section('A')]), self.factory(1, cp_model.MODEL_INVALID))
        self.assertEqual(result['error']['code'], 'MODEL_INVALID')


if __name__ == '__main__':
    unittest.main()
