import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpClient} from '../http.mjs';
import {collectLms} from '../collect.mjs';
import {fixtureFetch} from './fixtures.mjs';
import {calendarEvents} from '../calendar.mjs';

test('프로젝트 일정 수집은 개인 마감을 유지하고 자료·영상·뷰어를 요청하지 않는다', async () => {
  const fixture = fixtureFetch();
  const {snapshot, assets} = await collectLms({client: new HttpClient({fetchImpl: fixture.fetch}), courseIds: ['10'], includeMaterials: false});
  assert.equal(calendarEvents(snapshot).length, 3);
  assert.equal(snapshot.resources.length, 0); assert.equal(assets.size, 0);
  assert.ok(fixture.requested.every(({path}) => /^\/api\/v1\/(users\/self|courses(?:\/10\/(assignments|quizzes))?|calendar_events)$/.test(path) || path === '/learningx/api/v1/courses/10/modules'));
  assert.deepEqual(snapshot.warnings, []);
});

test('Canvas→LearningX→Commons 수집: 페이지 누락·개인 마감·파일 탭 403 처리', async () => {
  const fixture = fixtureFetch();
  const {snapshot, assets} = await collectLms({client: new HttpClient({fetchImpl: fixture.fetch}), courseIds: ['10'], termId: '3'});
  const items = snapshot.courses[0].items;
  assert.equal(items.find(item => item.kind === 'assignment').dueAt, '2026-11-10T14:59:00.000Z');
  assert.ok(items.some(item => item.title === '두 번째 페이지'));
  assert.equal(items.filter(item => item.kind === 'quiz').length, 0);
  assert.equal(snapshot.resources.length, 3);
  assert.deepEqual(snapshot.resources.map(row => row.kind), ['file', 'video', 'caption']);
  assert.equal(snapshot.warnings.length, 1); assert.equal(snapshot.warnings[0].stage, 'files');
  assert.ok(assets.values().next().value.url.includes('signature=fixture'));
  assert.doesNotMatch(JSON.stringify(snapshot), /signature|verifier|not-exported/);
  assert.ok(fixture.requested.every(request => request.method === 'GET'));
  assert.ok(fixture.requested.every(request => !/attend|progress|submissions|items\/\d+$/.test(request.path)));
});

test('LearningX 인증만 실패하면 브라우저 목록으로 보완하고 실패를 기록한다', async () => {
  const fixture = fixtureFetch({learningxForbidden: true});
  const visited = [];
  const browser = {async html(url) { visited.push(url); return '<main><a href="/courses/10/pages/fallback">브라우저 안내</a></main>'; }};
  const {snapshot} = await collectLms({client: new HttpClient({fetchImpl: fixture.fetch}), browser});
  assert.deepEqual(visited, ['/courses/10/modules']);
  assert.ok(snapshot.courses[0].items.some(item => item.title === '브라우저 안내'));
  assert.ok(snapshot.warnings.some(row => row.stage === 'learningx' && row.code === 'AUTH_REQUIRED'));
});

test('Canvas 세션 만료는 빈 성공 결과가 되지 않는다', async () => {
  const fixture = fixtureFetch();
  const client = new HttpClient({fetchImpl: (url, options) => new URL(url).pathname.endsWith('/assignments')
    ? new Response(null, {status: 401}) : fixture.fetch(url, options)});
  await assert.rejects(collectLms({client}), {code: 'AUTH_REQUIRED'});
});

test('로그인이 유효한 파일 목록의 401은 권한 경고로 남기고 다른 자료 수집을 계속한다', async () => {
  const fixture = fixtureFetch();
  const client = new HttpClient({refreshAuth: async () => ({id: 99}), fetchImpl: (url, options) =>
    new URL(url).pathname === '/api/v1/courses/10/files' ? new Response(null, {status: 401}) : fixture.fetch(url, options)});
  const {snapshot, assets} = await collectLms({client, courseIds: ['10']});
  assert.equal(snapshot.courses.length, 1);
  assert.ok(snapshot.courses[0].items.some(item => item.kind === 'assignment'));
  assert.equal(snapshot.resources.length, 3); assert.equal(assets.size, 3);
  assert.ok(snapshot.warnings.some(row => row.stage === 'files' && row.code === 'FORBIDDEN' && row.status === 401));
});

test('다른 계정 과목 ID와 없는 학기를 조용히 전체 과목으로 대체하지 않는다', async () => {
  const fixture = fixtureFetch(); const client = new HttpClient({fetchImpl: fixture.fetch});
  await assert.rejects(collectLms({client, courseIds: ['999']}), {code: 'COURSE_NOT_FOUND'});
  await assert.rejects(collectLms({client, termId: '999'}), {code: 'NO_COURSES'});
});

test('PDF 원본·현행 MP4·일반 ZIP을 모으고 뷰어·구형 주소는 다운로드하지 않는다', async () => {
  const fixture = fixtureFetch(), requested = [];
  const client = new HttpClient({fetchImpl: async (url, options) => {
    const parsed = new URL(url); requested.push(parsed.pathname);
    if (parsed.pathname.startsWith('/learningx/')) return Response.json([{module_id: 7, module_items: [
      {module_item_id: 71, content_data: {item_content_data: {content_id: 'pdf-fixture', content_type: 'pdf', title: '교재', file_name: '강의자료.pdf'}}},
      {module_item_id: 72, content_data: {item_content_data: {content_id: 'movie-fixture', content_type: 'movie', title: '동영상 강의'}}},
      {module_item_id: 73, content_data: {item_content_data: {content_id: 'zip-fixture', content_type: 'file', title: '실습자료', file_name: '실습.zip', view_url: 'https://commons.ssu.ac.kr/em/zip-fixture'}}},
    ]}]);
    if (parsed.pathname === '/viewer/ssplayer/uniplayer_support/content.php') {
      if (parsed.searchParams.get('content_id') === 'pdf-fixture') return new Response('<content_playing_info><content_type>sharedocs</content_type><content_download_uri>/download.php?content_id=pdf-fixture</content_download_uri><media_uri>https://ssu-toast.commonscdn.com/rendered/pdf-fixture</media_uri></content_playing_info>');
      assert.equal(parsed.searchParams.get('content_id'), 'movie-fixture');
      return new Response('<content_playing_info><content_type>video1</content_type><html5><media_uri>https://ssuin-object.commonscdn.com/media/lesson.mp4</media_uri></html5><flash_fallback><media_uri>https://commons.ssu.ac.kr/legacy/lesson.mp4</media_uri></flash_fallback></content_playing_info>');
    }
    if (parsed.pathname === '/em/zip-fixture') return new Response(`<script>download_iframe.attr('src', '/index.php?module=xn_media_content2013&act=dispXn_media_content2013DownloadContent&content_id=zip-fixture');</script>`);
    return fixture.fetch(url, options);
  }});
  const {snapshot, assets} = await collectLms({client, courseIds: ['10']});
  assert.equal(snapshot.resources.length, 4);
  assert.equal(snapshot.resources.filter(row => row.kind === 'video').length, 1);
  assert.ok(snapshot.resources.some(row => row.name === '실습.zip'));
  assert.ok(snapshot.resources.some(row => row.name === '강의자료.pdf'));
  assert.ok(snapshot.resources.some(row => row.name === '동영상 강의.mp4'));
  assert.ok([...assets.values()].every(asset => !/legacy|rendered/.test(asset.url)));
  assert.ok(requested.includes('/em/zip-fixture'));
  assert.ok(snapshot.warnings.every(warning => warning.stage !== 'commons'));
});
