// Synthetic fixtures only. No live LMS data, cookies, or signed download links.
export function fixtureFetch({filesForbidden = true, learningxForbidden = false} = {}) {
  const requested = [];
  const courses = [{id: 10, name: '기초설계', course_code: 'DESIGN', enrollment_term_id: 3, term: {id: 3, name: '2026-2'}, syllabus_body: '<p>기초 개념을 배웁니다.</p>'}];
  const routes = {
    '/api/v1/users/self': {id: 99, name: '테스트 사용자', email: 'not-exported@example.invalid'},
    '/api/v1/courses': courses,
    '/api/v1/courses/10/assignments': [{id: 20, name: '개인 마감', description: '<p>설계안을 제출하세요.</p><a href="/courses/10/files/30/download?verifier=fixture">교재</a>',
      due_at: '2026-11-10T23:59:00+09:00', all_dates: [{due_at: '2026-11-09T23:59:00+09:00'}], html_url: 'https://canvas.ssu.ac.kr/courses/10/assignments/20'}],
    '/api/v1/courses/10/quizzes': [{id: 21, assignment_id: 20, title: '연결된 퀴즈', due_at: '2026-11-09T23:59:00+09:00'}],
    '/api/v1/courses/10/discussion_topics': [{id: 40, title: '공지', message: '<p>다음 주 발표</p>', html_url: 'https://canvas.ssu.ac.kr/courses/10/discussion_topics/40'}],
    '/api/v1/courses/10/pages': [{page_id: 50, url: 'intro'}],
    '/api/v1/courses/10/pages/intro': {page_id: 50, title: '안내', body: '<p>교재 첫 장을 읽으세요.</p>', html_url: 'https://canvas.ssu.ac.kr/courses/10/pages/intro'},
    '/api/v1/courses/10/modules': [{id: 60, name: '1주차', items_count: 2}],
    '/api/v1/courses/10/modules/60/items': [{id: 61, type: 'File', title: '교재', content_id: 30, html_url: 'https://canvas.ssu.ac.kr/courses/10/modules/items/61'}],
    '/api/v1/files/30': {id: 30, display_name: '교재.txt', url: 'https://commons.ssu.ac.kr/files/book.txt?signature=fixture', 'content-type': 'text/plain'},
    '/api/v1/courses/10/files': [],
    '/learningx/api/v1/courses/10/modules': [{module_id: 7, title: '1주차', module_items: [{module_item_id: 70, content_data: {due_at: '2026-11-15T23:59:00+09:00', item_content_data: {content_id: 'synthetic-video', content_type: 'everlec', title: '개념 강의'}}}]}],
    '/api/v1/calendar_events': [{id: 80, title: '발표일', all_day: true, all_day_date: '2026-11-20', start_at: '2026-11-19T15:00:00Z', end_at: '2026-11-20T15:00:00Z'}],
  };
  return {requested, async fetch(url, options) {
    const parsed = new URL(url); requested.push({path: parsed.pathname, method: options?.method || 'GET'});
    if (parsed.pathname === '/api/v1/courses/10/files' && filesForbidden) return new Response(null, {status: 403});
    if (parsed.pathname.startsWith('/learningx/') && learningxForbidden) return new Response(null, {status: 401});
    if (parsed.pathname === '/viewer/ssplayer/uniplayer_support/content.php') return new Response('<content><media_uri>https://commons.ssu.ac.kr/media/lesson.mp4?signature=fixture</media_uri><subtitle_uri>/media/lesson.vtt?signature=fixture</subtitle_uri></content>');
    if (parsed.pathname === '/files/book.txt') return new Response('기초 설계의 핵심 내용');
    if (parsed.pathname === '/media/lesson.mp4') return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    if (parsed.pathname === '/media/lesson.vtt') return new Response('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n설계는 문제 정의부터 시작합니다.');
    if (parsed.pathname === '/api/v1/courses/10/modules/60/items' && parsed.searchParams.get('page') === '2') return Response.json([{id: 62, type: 'Page', title: '두 번째 페이지', html_url: 'https://canvas.ssu.ac.kr/courses/10/modules/items/62'}]);
    if (!(parsed.pathname in routes)) throw new Error('Unexpected fixture request');
    const headers = parsed.pathname === '/api/v1/courses/10/modules/60/items'
      ? {link: '<https://canvas.ssu.ac.kr/api/v1/courses/10/modules/60/items?page=2>; rel="next"'} : {};
    return new Response('while(1);' + JSON.stringify(routes[parsed.pathname]), {headers});
  }};
}
