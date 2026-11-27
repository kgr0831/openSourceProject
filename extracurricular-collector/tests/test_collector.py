import copy
import io
import json
import tempfile
import unittest
import stat
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from ssu_collector.source import parse_list, parse_detail, SourceError, DetailUnavailable, Client, LIST_PATH
from ssu_collector.collector import collect, run, classify
from ssu_collector.storage import atomic_json, collection_lock
from ssu_collector.__main__ import main

TITLE = 'AI <실습> & 진로'
LIST = '''<script>broken 3/3 text</script><table><caption>비교과 프로그램 모집공고 조회 정보</caption>
<tr><th>번호</th><th>년도</th><th>학기</th><th>운영부서</th><th>프로그램명</th><th>신청기간</th><th>교육(활동)기간</th><th>신청상태</th></tr>
<tr><td>999</td><td>2026</td><td>2학기</td><td>학과</td><td><a data-enc-sddpb-seq="abcdef123456">AI &lt;실습&gt; &amp; 진로</a></td>
<td>2026.11.20 ~ 2026.11.30</td><td>2026.12.01 ~ 2026.12.02</td><td>신청중</td></tr></table>
<ul><li>총게시물 <span>1</span></li><li>페이지 <span>1 / 1</span></li></ul>'''
DETAIL = '''<h4>AI &lt;실습&gt; &amp; 진로</h4><table><caption>비교과 프로그램 상세정보 테이블</caption>
<tr><th>프로그램 목표</th><td>AI <b>개발</b>을 배운다.</td></tr>
<tr><th>프로그램 한줄 소개</th><td>진로 탐색<br>워크숍</td></tr>
<tr><th>학생 신청대상 상세정보</th><td><dl><dt>학년:</dt><dd>전체</dd></dl></td></tr>
<tr><th>첨부</th><td><img src="/poster.png"><a href="javascript:alert(1)">bad</a></td></tr></table>'''
STAMP = '2026-11-25T03:00:00+09:00'


class FakeClient:
    def __init__(self, items=None, fail_detail=False):
        self.items = items if items is not None else parse_list(LIST)['items']
        self.fail_detail = fail_detail
        self.calls = []

    def list(self, page):
        return {'page': page, 'pages': 1, 'total': len(self.items), 'items': copy.deepcopy(self.items)}

    def detail(self, item):
        self.calls.append(item['id'])
        if self.fail_detail:
            raise SourceError('temporary failure')
        return parse_detail(DETAIL, TITLE)


class ParserTests(unittest.TestCase):
    def test_public_list_identity_dates_and_entities(self):
        item = parse_list(LIST)['items'][0]
        self.assertEqual(item['id'], 'ssu-path:abcdef123456')
        self.assertNotIn('999', item['id'])
        self.assertEqual(item['title'], TITLE)
        self.assertEqual(item['applicationEndDate'], '2026-11-30')

    def test_fail_closed_on_login_missing_row_or_reordered_headers(self):
        for html in ['<h1>로그인</h1>', LIST.replace('data-enc-sddpb-seq', 'data-other'),
                     LIST.replace('운영부서', '프로그램명', 1), LIST.replace('2026.11.30', '2026.11.99')]:
            with self.assertRaises(SourceError):
                parse_list(html)

    def test_detail_keeps_inline_text_and_does_not_fetch_images(self):
        detail = parse_detail(DETAIL, TITLE)
        self.assertEqual(detail['description'], 'AI 개발을 배운다.\n진로 탐색 워크숍')
        self.assertEqual(detail['targetDetails'], '학년: 전체')
        self.assertEqual(detail['assets'], [{'url': 'https://path.ssu.ac.kr/poster.png', 'label': ''}])
        with self.assertRaises(SourceError):
            parse_detail(DETAIL, '다른 과목')

    def test_legacy_unescaped_title_attribute_and_literal_angle_brackets(self):
        broken = LIST.replace('<a data-enc-sddpb-seq="abcdef123456">AI &lt;실습&gt; &amp; 진로</a>',
            '<a class="nsbjtPgmInfoBtn" title="저명 작가 <작가의 "글쓰기"> 상세정보" data-enc-sddpb-seq="abcdef123456">저명 작가 <작가의 "글쓰기"></a>')
        self.assertEqual(parse_list(broken)['items'][0]['title'], '저명 작가 <작가의 "글쓰기">')
        ascii_title = '실습 <C++>와 <AI>'
        listing = LIST.replace('AI &lt;실습&gt; &amp; 진로', ascii_title).replace('<a data-', '<a class="nsbjtPgmInfoBtn" data-')
        self.assertEqual(parse_list(listing)['items'][0]['title'], ascii_title)
        detail = DETAIL.replace('AI &lt;실습&gt; &amp; 진로', ascii_title)
        self.assertEqual(parse_detail(detail, ascii_title)['title'], ascii_title)

    def test_retry_and_redirect_validation(self):
        class Response(io.BytesIO):
            url = 'https://path.ssu.ac.kr' + LIST_PATH
        response = Response(LIST.encode())
        with patch('ssu_collector.source.urlopen', side_effect=[HTTPError('url', 503, 'busy', {}, None), response]) as request, patch('ssu_collector.source.time.sleep'):
            self.assertEqual(Client().list(1)['total'], 1)
            self.assertEqual(request.call_count, 2)
        response = Response(b'<h1>login</h1>')
        response.url = 'https://path.ssu.ac.kr/comm/login/user/login.do'
        with patch('ssu_collector.source.urlopen', return_value=response), patch('ssu_collector.source.time.sleep'):
            with self.assertRaises(SourceError):
                Client().list(1)

    def test_explicit_source_unavailable_is_not_a_network_or_parser_error(self):
        with self.assertRaises(DetailUnavailable):
            parse_detail('<div><p class="NO_RESULT">조회할 수 없는 프로그램입니다.</p></div>', TITLE)
        with self.assertRaises(SourceError) as error:
            parse_detail('<h1>로그인이 필요합니다.</h1>', TITLE)
        self.assertNotIsInstance(error.exception, DetailUnavailable)


class CollectionTests(unittest.TestCase):
    def test_unavailable_public_details_keep_inventory_and_cached_description(self):
        client = FakeClient()
        client.detail = lambda item: (_ for _ in ()).throw(DetailUnavailable('not public'))
        fresh = collect(client, timestamp=STAMP)
        self.assertEqual(fresh['run']['outcome'], 'success')
        self.assertEqual(fresh['run']['detailUnavailable'], 1)
        self.assertEqual(fresh['run']['detailFailures'], 0)
        self.assertEqual(fresh['programs'][0]['detailState'], 'unavailable')
        good = collect(FakeClient(), timestamp=STAMP)
        cached = collect(client, good, timestamp=STAMP)
        self.assertEqual(cached['programs'][0]['detailState'], 'unavailable_cached')
        self.assertEqual(cached['programs'][0]['detail'], good['programs'][0]['detail'])
    def test_repeat_runs_update_by_source_id_not_title_or_list_ordinal(self):
        client = FakeClient()
        first = collect(client, timestamp=STAMP)
        client.items[0]['listNumber'] = '1000'
        again = collect(client, first, timestamp='2026-11-26T03:00:00+09:00')
        self.assertEqual(again['run']['new'], 0)
        self.assertEqual(again['run']['unchanged'], 1)
        self.assertEqual(again['programs'][0]['firstSeenAt'], STAMP)
        client.items[0]['applicationEndDate'] = '2026-12-01'
        changed = collect(client, again, timestamp='2026-11-27T03:00:00+09:00')
        self.assertEqual(changed['run']['updated'], 1)
        twin = copy.deepcopy(client.items[0]);twin.update(id='ssu-path:other123456', sourceId='other123456')
        client.items.append(twin)
        self.assertEqual(len(collect(client, timestamp=STAMP)['programs']), 2)

    def test_partial_detail_failure_retains_last_good_description(self):
        good = collect(FakeClient(), timestamp=STAMP)
        failed = collect(FakeClient(fail_detail=True), good, timestamp='2026-11-26T03:00:00+09:00')
        self.assertEqual(failed['run']['outcome'], 'partial')
        self.assertEqual(failed['programs'][0]['detailState'], 'stale')
        self.assertEqual(failed['programs'][0]['detail'], good['programs'][0]['detail'])
        self.assertEqual(failed['programs'][0]['lastDetailSuccessAt'], STAMP)

    def test_historical_lists_kept_without_unnecessary_detail_fetches(self):
        client = FakeClient();client.items[0].update(applicationStartDate='2024-12-01', applicationEndDate='2025-01-01', activityEndDate='2025-01-01')
        result = collect(client, timestamp=STAMP)
        self.assertEqual(client.calls, [])
        self.assertEqual(result['programs'][0]['detailState'], 'not_requested_archived')
        self.assertEqual(result['programs'][0]['effectiveStatus'], 'closed')
        self.assertEqual(result['run']['outcome'], 'success')

    def test_full_scan_marks_missing_but_never_deletes(self):
        first = collect(FakeClient(), timestamp=STAMP)
        missing = collect(FakeClient(items=[]), first, timestamp='2026-11-26T03:00:00+09:00')
        self.assertEqual(len(missing['programs']), 1)
        self.assertFalse(missing['programs'][0]['presentInLatestInventory'])
        self.assertEqual(missing['programs'][0]['effectiveStatus'], 'unlisted')
        self.assertEqual(missing['programs'][0]['lastSeenAt'], STAMP)

    def test_sampling_is_explicitly_partial_and_preserves_unseen_records(self):
        first = collect(FakeClient(), timestamp=STAMP)
        client = FakeClient(items=[])
        client.list = lambda page: {'page': page, 'pages': 2, 'total': 20, 'items': []}
        result = collect(client, first, timestamp=STAMP, max_pages=1)
        self.assertEqual(result['run']['outcome'], 'partial')
        self.assertTrue(result['programs'][0]['presentInLatestInventory'])

    def test_pagination_duplicates_or_count_changes_fail_without_overwrite(self):
        client = FakeClient()
        original = client.list
        client.list = lambda page: {**original(page), 'pages': 2, 'total': 2}
        with self.assertRaises(SourceError):
            collect(client, timestamp=STAMP)
        client.list = lambda page: {**original(page), 'total': 99}
        with self.assertRaises(SourceError):
            collect(client, timestamp=STAMP)

    def test_first_page_drift_is_rejected(self):
        client = FakeClient();original = client.list;calls = []
        def listing(page):
            result = original(page);calls.append(page)
            if len(calls) > 1:
                result['items'][0]['title'] = 'changed during scan'
            return result
        client.list = listing
        with self.assertRaises(SourceError):
            collect(client, timestamp=STAMP)

    def test_korean_day_boundary_and_unknown_or_reversed_dates(self):
        item = FakeClient().items[0]
        self.assertEqual(classify(item, '2026-11-30')[0], 'open')
        self.assertEqual(classify(item, '2026-12-01')[0], 'closed')
        item.update(applicationStartDate='2026-12-01', applicationEndDate='2026-11-01')
        self.assertEqual(classify(item, '2026-11-25')[0], 'unknown')
        midnight = collect(FakeClient(), timestamp='2026-11-30T15:01:00+00:00')
        self.assertEqual(midnight['programs'][0]['effectiveStatus'], 'closed')
        item.update(applicationStartDate=None, applicationEndDate=None, sourceStatus='확인 필요')
        self.assertEqual(classify(item, '2026-11-25')[0], 'unknown')

    def test_backup_and_failed_run_preserve_snapshot_and_report_error(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            result = run(FakeClient(), out, timestamp=STAMP)
            before = (out / 'programs.json').read_bytes()
            client = FakeClient();client.list = lambda page: (_ for _ in ()).throw(SourceError('offline'))
            with self.assertRaises(SourceError):
                run(client, out, timestamp=STAMP)
            self.assertEqual((out / 'programs.json').read_bytes(), before)
            self.assertEqual(json.loads((out / 'last-run.json').read_text())['outcome'], 'failed')
            run(FakeClient(), out, timestamp=STAMP)
            self.assertEqual(json.loads((out / 'programs.previous.json').read_text()), result)

    def test_invalid_existing_snapshot_and_concurrent_run_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory);atomic_json(out / 'programs.json', {'schemaVersion': 999})
            before = (out / 'programs.json').read_bytes()
            with self.assertRaises(ValueError):
                run(FakeClient(), out, timestamp=STAMP)
            self.assertEqual((out / 'programs.json').read_bytes(), before)
            with collection_lock(out), self.assertRaises(RuntimeError):
                with collection_lock(out):
                    pass

    def test_cli_exit_codes_distinguish_complete_partial_failure_and_cancel(self):
        for outcome, code in [('success', 0), ('partial', 2)]:
            with patch('ssu_collector.__main__.run', return_value={'run': {'outcome': outcome}}), redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(main(['--output', '/tmp/collector-cli-test']), code)
                self.assertEqual(json.loads(stdout.getvalue())['outcome'], outcome)
        for error, code in [(SourceError('offline'), 1), (KeyboardInterrupt(), 130)]:
            with patch('ssu_collector.__main__.run', side_effect=error), redirect_stderr(io.StringIO()) as stderr:
                self.assertEqual(main([]), code)
                self.assertTrue(json.loads(stderr.getvalue())['event'] in ('failed', 'cancelled'))

    def test_failed_atomic_replace_keeps_previous_snapshot_and_removes_temp_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'programs.json'
            atomic_json(path, {'old': True})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o640)
            with patch('ssu_collector.storage.os.replace', side_effect=OSError('disk failure')):
                with self.assertRaises(OSError):
                    atomic_json(path, {'new': True})
            self.assertEqual(json.loads(path.read_text()), {'old': True})
            self.assertEqual([p.name for p in Path(directory).iterdir()], ['programs.json'])


if __name__ == '__main__':
    unittest.main()
