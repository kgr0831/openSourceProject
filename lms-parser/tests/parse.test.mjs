import test from 'node:test';
import assert from 'node:assert/strict';
import {publicUrl, htmlText, htmlResources, isoDate, normalizeLearningX, parseCommons, parseCommonsDownloadPage, parseCourseLinks, parseModuleLinks, captionText} from '../parse.mjs';

test('HTML 본문과 첨부를 분리하고 스크립트·폼·서명 쿼리는 내보내지 않는다', () => {
  const html = '<h2>개념 &amp; 예제</h2><p>복습하세요.<br>둘째 줄</p><script>private-value</script><form>비밀번호</form><a href="/courses/10/files/30/download?verifier=fixture">자료</a>';
  assert.equal(htmlText(html), '개념 & 예제\n복습하세요.\n둘째 줄\n자료');
  assert.deepEqual(htmlResources(html, 'https://canvas.ssu.ac.kr'), [{url: 'https://canvas.ssu.ac.kr/courses/10/files/30/download?verifier=fixture', kind: 'file', name: '자료'}]);
  assert.equal(publicUrl('https://commons.ssu.ac.kr/view?content_id=c1&token=fixture&X-Amz-Signature=fixture'), 'https://commons.ssu.ac.kr/view?content_id=c1');
  assert.equal(publicUrl(undefined, 'https://canvas.ssu.ac.kr'), '');
  assert.equal(publicUrl('javascript:alert(1)'), '');
});

test('LearningX 주차 자료·영상과 시간대를 정규화한다', () => {
  const items = normalizeLearningX([{title: '1주차', module_items: [{module_item_id: 7, title: '영상', content_data: {due_at: '2026-11-10T23:59:00+09:00', item_content_data: {
    content_id: 'lecture-7', content_type: 'everlec', file_name: '강의.mp4', title: '기초 개념',
  }}}]}], '10', 'https://canvas.ssu.ac.kr');
  assert.equal(items[0].kind, 'video'); assert.equal(items[0].dueAt, '2026-11-10T14:59:00.000Z');
  assert.equal(items[0].contentId, 'lecture-7'); assert.equal(items[0].sourceUrl, 'https://canvas.ssu.ac.kr/courses/10/modules/items/7');
  assert.throws(() => normalizeLearningX({unexpected: []}, '10', 'https://canvas.ssu.ac.kr'), {code: 'SCHEMA'});
});

test('Commons XML에서 CDATA·상대 경로·영상·자막·HLS를 분리한다', () => {
  const xml = '<content><content_download_uri><![CDATA[/files/교재.pdf?a=1&amp;b=2]]></content_download_uri><media><media_uri>https://commons.ssu.ac.kr/video/a.mp4</media_uri><subtitle_uri>/captions/a.vtt</subtitle_uri><media_uri>/streams/a.m3u8</media_uri></media></content>';
  const resources = parseCommons(xml, 'https://commons.ssu.ac.kr');
  assert.deepEqual(resources.map(row => row.kind), ['file', 'video', 'caption', 'stream']);
  assert.match(resources[0].url, /a=1&b=2$/);
  assert.throws(() => parseCommons('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///private">]><x/>', 'https://commons.ssu.ac.kr'), {code: 'SCHEMA'});
});

test('문서 뷰어 디렉터리와 구형 Flash 재생 주소를 별도 영상으로 세지 않는다', () => {
  const docs = parseCommons(`<content_playing_info><content_type>sharedocs</content_type>
    <content_download_uri>/download.php?content_id=doc-fixture&amp;file_subpath=lecture.pdf</content_download_uri>
    <media><media_uri>https://ssu-toast.commonscdn.com/rendered/doc-fixture</media_uri></media>
    <media><media_uri>https://commons.ssu.ac.kr/rendered/doc-fixture</media_uri></media></content_playing_info>`, 'https://commons.ssu.ac.kr');
  assert.equal(docs.length, 1); assert.equal(docs[0].kind, 'file');
  const movie = parseCommons(`<content_playing_info><content_type>video1</content_type><media>
    <html5><method>progressive</method><media_uri>https://ssuin-object.commonscdn.com/media/lecture.mp4</media_uri></html5>
    <flash_fallback><method>stream</method><media_uri>https://commons.ssu.ac.kr/legacy/lecture.mp4</media_uri></flash_fallback>
    </media><mobile><html5><media_uri>https://ssuin-object.commonscdn.com/media/lecture.mp4</media_uri></html5></mobile></content_playing_info>`, 'https://commons.ssu.ac.kr');
  assert.deepEqual(movie.map(row => row.url), ['https://ssuin-object.commonscdn.com/media/lecture.mp4']);
  assert.equal(movie[0].kind, 'video');
});

test('Commons ZIP 뷰어에서 해당 자료의 다운로드 URL만 추출하고 스크립트는 실행하지 않는다', () => {
  const base = 'https://commons.ssu.ac.kr';
  const link = '/index.php?module=xn_media_content2013&act=dispXn_media_content2013DownloadContent&content_id=zip-fixture';
  const html = `<script>throw new Error('must not execute');
    $.ajax({type: "POST",url: "/update_read_cnt.php"});
    window.open("${link}"); download_iframe.attr('src', '${link.replaceAll('&', '&amp;')}');
    window.open("https://other.invalid${link}"); window.open("${link.replace('zip-fixture', 'other-content')}");</script>`;
  assert.deepEqual(parseCommonsDownloadPage(html, base, 'zip-fixture'), [{url: base + link, kind: 'file', name: '자료'}]);
  assert.deepEqual(parseCommonsDownloadPage(html, base, 'missing'), []);
});

test('브라우저 대체 파싱은 과목·주차의 링크와 표시된 날짜를 읽는다', () => {
  const canvas = 'https://canvas.ssu.ac.kr';
  assert.deepEqual(parseCourseLinks('<a href="/courses/10">기초설계</a><a href="https://external.invalid/courses/20">외부</a>', canvas), [{id: '10', name: '기초설계', course_code: ''}]);
  const items = parseModuleLinks('<main><li class="context_module_item"><a href="/courses/10/assignments/30">과제</a><time datetime="2026-11-10T14:59:00Z"></time></li><a href="/logout">로그아웃</a></main>', '10', canvas);
  assert.equal(items.length, 1); assert.equal(items[0].dueAt, '2026-11-10T14:59:00.000Z');
});

test('VTT 타임코드·연속 중복 자막을 요약 입력에서 제거한다', () => {
  assert.equal(captionText('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n안녕하세요.\n\n2\n00:00:03.000 --> 00:00:04.000\n안녕하세요.\n오늘은 <b>기초</b>입니다.'), '안녕하세요.\n오늘은 기초입니다.');
});

test('시간대 없는 마감과 잘못된 날짜를 추측하지 않고 미래 공개 자료를 잠금 처리한다', () => {
  assert.equal(isoDate('2026-11-10T10:00:00'), null);
  assert.equal(isoDate('2026-02-30T10:00:00Z'), null);
  const [item] = normalizeLearningX([{module_id: 7, title: '다음 주', module_items: [{module_item_id: 80,
    content_data: {unlock_at: '2099-01-01T00:00:00Z', due_at: '2099-01-08T09:00:00', item_content_data: {content_id: 'future'}}}]}], '10', 'https://canvas.ssu.ac.kr');
  assert.equal(item.locked, true); assert.equal(item.dateUnparsed, true); assert.equal(item.dueAt, null);
});
