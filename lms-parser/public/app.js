const $ = id => document.getElementById(id);
let state = null, stopped = false, polling, toastTimer, courseSignature = '', dismissedJob = null;
const selected = new Set(), pending = new Set();
const runningPhases = ['collecting', 'downloading', 'exporting', 'cancelling'];
const text = (id, value) => { const node = $(id); if (node.textContent !== String(value)) node.textContent = value; };
const show = (id, visible) => { $(id).hidden = !visible; };
const running = () => runningPhases.includes(state?.job?.phase);

function toast(message) {
  text('toast', message); show('toast', true); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show('toast', false), 5500);
}

async function api(route, body) {
  const response = await fetch('/api/' + route, body === undefined ? {cache: 'no-store'} : {
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-Lms-App': '1'}, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '요청을 마치지 못했어요. 다시 시도해 주세요.');
  return result;
}

function update(next) {
  if (state && next.revision < state.revision) return;
  const previousConnection = state?.connection;
  if (!state && next.job) {
    for (const id of next.job.courseIds || []) selected.add(id);
    const radio = [...document.querySelectorAll('input[name=mode]')].find(node => node.value === next.job.mode);
    if (radio) radio.checked = true;
  }
  if (next.connection === 'disconnected' || (next.connection === 'restoring' && previousConnection !== 'restoring')) {
    selected.clear(); courseSignature = ''; dismissedJob = null;
    $('course-search').value = ''; $('term-filter').value = '';
  }
  const oldPhase = state?.job?.phase;
  state = next; render();
  if (next.job?.phase !== oldPhase) {
    if (next.job?.phase === 'complete') $('result-title').focus({preventScroll: true});
    else if (next.job?.phase === 'collecting') $('progress-title').focus({preventScroll: true});
    else if (['cancelled', 'error'].includes(next.job?.phase)) $('interrupted-title').focus({preventScroll: true});
  }
}

async function action(route, body = {}) {
  if (pending.has(route) || stopped) return;
  pending.add(route); render();
  try { const next = await api(route, body); show('offline', false); update(next); return true; }
  catch (error) { toast(error.message || '앱과 연결하지 못했어요. 다시 실행해 주세요.'); return false; }
  finally { pending.delete(route); render(); }
}

async function poll() {
  clearTimeout(polling);
  if (stopped) return;
  try { update(await api('state')); show('offline', false); }
  catch { show('offline', true); }
  finally { if (!stopped) polling = setTimeout(poll, 1200); }
}

function visibleCourses() {
  const query = $('course-search').value.trim().toLocaleLowerCase(), term = $('term-filter').value;
  return (state?.courses || []).filter(course => (!term || course.termId === term) &&
    (!query || `${course.name} ${course.code}`.toLocaleLowerCase().includes(query)));
}

function renderCourses() {
  const signature = JSON.stringify(state.courses);
  if (signature !== courseSignature) {
    courseSignature = signature;
    const oldTerm = $('term-filter').value;
    $('term-filter').replaceChildren(new Option('전체 학기', ''));
    const terms = new Map();
    for (const course of state.courses) if (course.termId) terms.set(course.termId, course.termName);
    for (const [id, name] of [...terms.entries()].sort((a, b) => b[1].localeCompare(a[1], 'ko'))) $('term-filter').add(new Option(name, id));
    if (terms.has(oldTerm)) $('term-filter').value = oldTerm;
    for (const id of selected) if (!state.courses.some(course => course.id === id)) selected.delete(id);
    rebuildCourses();
  }
  const visible = visibleCourses(), checked = visible.filter(course => selected.has(course.id)).length;
  $('select-all').checked = Boolean(visible.length && checked === visible.length);
  $('select-all').indeterminate = checked > 0 && checked < visible.length;
  $('select-all').disabled = !visible.length;
  $('clear-selection').disabled = !selected.size;
  text('selected-count', `${selected.size}개 선택`);
  text('courses-description', `${state.courses.length}개 과목 · ${state.remembered ? '로그인 유지 중 · ' : ''}학교 창 없이 자료를 모아요.`);
  const button = $('start-button');
  button.disabled = !selected.size || pending.has('collect') || running();
  button.firstChild.textContent = selected.size ? `선택한 ${selected.size}과목 저장하기` : '과목을 선택해 주세요';
}

function rebuildCourses() {
  const fragment = document.createDocumentFragment(), courses = visibleCourses();
  for (const course of courses) {
    const label = document.createElement('label'); label.className = 'course-row';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = course.id; checkbox.checked = selected.has(course.id);
    checkbox.setAttribute('aria-label', `${course.name} 선택`);
    checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(course.id) : selected.delete(course.id); renderCourses(); });
    const info = document.createElement('span'); info.className = 'course-info';
    const title = document.createElement('strong'); title.textContent = course.name;
    const detail = document.createElement('small'); detail.textContent = course.code || '내 수강 과목'; info.append(title, detail);
    const badge = document.createElement('span'); badge.className = 'course-tag'; badge.textContent = course.termName;
    label.append(checkbox, info, badge); fragment.append(label);
  }
  $('course-list').replaceChildren(fragment); show('course-list', courses.length > 0); show('no-courses', !courses.length);
}

function renderProgress() {
  const job = state.job, phase = job.phase;
  const titles = {collecting: '수업 자료를 확인하고 있어요.', downloading: '내 PC에 차곡차곡 저장 중이에요.', exporting: '공부하기 좋게 정리하고 있어요.', cancelling: '안전하게 저장을 중단하고 있어요.'};
  text('progress-title', titles[phase]);
  text('progress-description', phase === 'cancelling' ? '이미 저장된 파일은 남겨두고, 잠시 후 돌아갈게요.' : phase === 'exporting' ? '캘린더와 AI 요약용 자료를 준비하는 마지막 단계예요.' : '완료된 자료부터 내 폴더에 보관돼요.');
  text('progress-name', job.name || (phase === 'exporting' ? '캘린더와 요약용 자료 준비' : '잠시만 기다려 주세요'));
  text('progress-counter', job.total && phase !== 'exporting' ? `${job.current} / ${job.total}${phase === 'collecting' ? ' 과목' : ' 파일'}` : '');
  const fraction = job.totalBytes ? Math.min(job.bytes / job.totalBytes, 1) : null;
  if (phase === 'downloading' && fraction !== null) { $('progress-bar').max = 1; $('progress-bar').value = fraction; }
  else $('progress-bar').removeAttribute('value');
  const size = value => value > 1024 ** 3 ? (value / 1024 ** 3).toFixed(1) + ' GB' : (value / 1024 ** 2).toFixed(1) + ' MB';
  text('progress-detail', job.bytes ? `${size(job.bytes)}${job.totalBytes ? ' / ' + size(job.totalBytes) : ''} 저장 중` : phase === 'collecting' ? '공지, 과제와 강의 자료를 살펴보고 있어요.' : phase === 'exporting' ? '원문과 출처를 함께 정리하고 있어요.' : '파일에 따라 조금 더 걸릴 수 있어요.');
  const index = {collecting: 1, downloading: 2, exporting: 3, cancelling: 0}[phase];
  for (let i = 1; i <= 3; i++) $('job-step-' + i).className = i === index ? 'active' : i < index ? 'done' : '';
  $('cancel-job').disabled = ['cancelling', 'exporting'].includes(phase) || pending.has('cancel');
  text('cancel-job', phase === 'cancelling' ? '중단하는 중…' : '저장 중단');
}

function renderResult() {
  const result = state.result, counts = result.counts;
  text('result-courses', counts.courses); text('result-events', counts.events); text('result-files', counts.downloaded);
  text('result-title', result.issues.length ? '자료를 모았어요. 일부 확인이 필요해요.' : '공부할 준비가 끝났어요.');
  text('result-description', result.mode === 'none' ? '선택한 수업의 공지와 일정을 내 PC에 모아뒀어요.' : '선택한 수업의 자료를 내 PC에 모아뒀어요.');
  show('summary-download', result.hasSummary); $('copy-prompt').disabled = !result.hasSummary;
  show('result-issues', Boolean(result.issues.length));
  text('issues-summary', `확인이 필요한 항목 ${result.issues.length}개`);
  const signature = JSON.stringify(result.issues);
  if ($('issues-list').dataset.signature !== signature) {
    $('issues-list').dataset.signature = signature;
    $('issues-list').replaceChildren(...result.issues.map(issue => {
      const li = document.createElement('li'), title = document.createElement('strong'), desc = document.createElement('p'), link = document.createElement('a');
      title.textContent = issue.title; desc.textContent = issue.text;
      link.textContent = 'LMS에서 확인하기'; link.href = issue.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      li.append(title, desc, link); return li;
    }));
  }
}

function render() {
  if (!state || stopped) return;
  const connected = state.connection === 'connected', job = state.job;
  const showJob = job && dismissedJob !== job.startedAt;
  const complete = showJob && job.phase === 'complete', interrupted = showJob && ['cancelled', 'error'].includes(job.phase);
  const waiting = ['restoring', 'opening', 'waiting', 'checking', 'background', 'loading', 'disconnecting'].includes(state.connection);
  show('demo-banner', state.demo); show('connect-panel', !connected); show('selection-panel', connected && !running() && !complete && !interrupted);
  show('progress-panel', running()); show('result-panel', Boolean(complete && state.result)); show('interrupted-panel', Boolean(interrupted));
  show('connect-idle', !waiting); show('connect-waiting', waiting);
  show('notice', Boolean(state.notice)); if (state.notice) text('notice', state.notice);
  $('connection-badge').classList.toggle('connected', connected);
  $('connection-badge').lastChild.textContent = connected ? '학교 계정 연결됨' : waiting ? '학교 계정 연결 중' : '학교 계정 연결 전';
  show('disconnect-button', connected || state.remembered); $('disconnect-button').disabled = running() || waiting || pending.has('forget-login');
  $('connect-button').disabled = waiting || pending.has('connect');
  $('confirm-login').disabled = state.connection !== 'waiting' || pending.has('confirm-login');
  $('focus-login').disabled = state.connection !== 'waiting' || pending.has('focus-login');
  $('cancel-login').disabled = state.connection === 'disconnecting' || pending.has('disconnect');
  show('login-actions', ['waiting', 'checking'].includes(state.connection));
  text('login-title', ({restoring: '저장된 로그인으로 연결하고 있어요', opening: '학교 로그인 창을 열고 있어요', waiting: '학교 로그인을 기다리고 있어요', checking: '로그인을 확인하고 있어요', background: '학교 창을 닫고 연결을 유지하고 있어요', loading: '내 수강 과목을 불러오고 있어요', disconnecting: '연결을 정리하고 있어요'})[state.connection] || '학교 로그인을 기다리고 있어요');
  text('login-copy', ['restoring', 'background', 'loading'].includes(state.connection)
    ? '잠시만 기다려 주세요. 학교 창을 열어두지 않아도 돼요.' : '학교 창에서 로그인 후 강의실에 들어가 주세요. 연결이 확인되면 학교 창은 자동으로 닫혀요.');
  const step = !connected ? 1 : running() || complete ? 3 : 2;
  for (let i = 1; i <= 3; i++) { $('step-' + i).className = i === step ? 'current' : i < step ? 'done' : ''; $('step-' + i).setAttribute('aria-current', i === step ? 'step' : 'false'); }
  if (connected) renderCourses();
  if (running()) renderProgress();
  if (complete && state.result) renderResult();
  if (interrupted) {
    text('interrupted-title', job.phase === 'cancelled' ? '잠시 멈췄어요.' : '저장을 마치지 못했어요.');
    text('interrupted-copy', state.result ? `${state.result.counts.downloaded}개의 파일은 안전하게 저장됐어요. 다시 시작하면 새 폴더에 저장해요.` : '선택한 과목과 저장 옵션은 그대로예요. 다시 시도할 수 있어요.');
    show('partial-folder', Boolean(state.result));
    $('retry-button').firstChild.textContent = job.reconnect ? '학교 계정 다시 연결하기' : '선택 화면으로 돌아가기';
  }
}

$('connect-button').addEventListener('click', () => action('connect'));
$('confirm-login').addEventListener('click', () => action('confirm-login'));
$('focus-login').addEventListener('click', () => action('focus-login'));
$('cancel-login').addEventListener('click', () => action('disconnect'));
$('disconnect-button').addEventListener('click', () => action('forget-login'));
$('start-button').addEventListener('click', () => { dismissedJob = null; action('collect', {courseIds: [...selected], mode: document.querySelector('input[name=mode]:checked').value}); });
$('cancel-job').addEventListener('click', () => action('cancel'));
$('course-search').addEventListener('input', () => { rebuildCourses(); renderCourses(); });
$('term-filter').addEventListener('change', () => { rebuildCourses(); renderCourses(); });
$('select-all').addEventListener('change', () => { for (const course of visibleCourses()) $('select-all').checked ? selected.add(course.id) : selected.delete(course.id); rebuildCourses(); renderCourses(); });
$('clear-selection').addEventListener('click', () => { selected.clear(); rebuildCourses(); renderCourses(); });
document.querySelectorAll('input[name=mode]').forEach(radio => radio.addEventListener('change', () => text('mode-hint', {
  none: '공지·과제 본문과 캘린더를 준비해요. 원본 첨부파일은 내려받지 않아요.',
  files: '강의 문서와 제공되는 자막을 함께 저장해요.',
  all: '영상까지 저장하면 시간이 더 걸리고 저장 공간이 많이 필요할 수 있어요.',
}[radio.value])));
for (const id of ['collect-again', 'retry-button', 'home-nav']) $(id).addEventListener('click', () => {
  if (running()) return;
  if (id === 'retry-button' && state?.job?.reconnect) { action('connect'); return; }
  dismissedJob = state?.job?.startedAt; render(); $('selection-title').scrollIntoView({block: 'nearest'});
});
for (const id of ['open-result', 'partial-folder']) $(id).addEventListener('click', () => action('open-folder', {result: true}));
$('copy-prompt').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/files/summary-prompt.txt'); if (!response.ok) throw new Error();
    await navigator.clipboard.writeText(await response.text()); toast('복사했어요. AI에 자료를 첨부하고 붙여넣어 주세요.');
  } catch { toast('복사하지 못했어요. 옆의 ‘문구 파일 받기’를 이용해 주세요.'); }
});
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.action === 'help') $('help-dialog').showModal();
  if (button.dataset.action === 'open-folder') action('open-folder', {result: false});
  if (button.dataset.action === 'shutdown') running() ? $('exit-dialog').showModal() : shutdown();
}));
for (const id of ['close-help', 'help-done']) $(id).addEventListener('click', () => $('help-dialog').close());
$('stay-button').addEventListener('click', () => $('exit-dialog').close());
$('exit-confirm').addEventListener('click', () => { $('exit-dialog').close(); shutdown(); });
$('reconnect-ui').addEventListener('click', poll);

async function shutdown() {
  try {
    await api('shutdown', {}); stopped = true; clearTimeout(polling);
    const box = document.querySelector('.page-content'), heading = document.createElement('h1'), copy = document.createElement('p');
    heading.textContent = '다음 공부 때 또 만나요.'; copy.className = 'page-description'; copy.textContent = '앱이 종료되었어요. 저장된 로그인은 다음 실행에도 이어져요. 이제 이 창을 닫아도 됩니다.';
    box.replaceChildren(heading, copy); $('connection-badge').lastChild.textContent = '앱 종료'; show('disconnect-button', false);
  } catch { toast('앱과 연결이 끊겼어요. 이 창을 닫아도 됩니다.'); }
}

poll();
