import {createPlannerStore} from './planner.js';
import {careerTracks,careerSelection,kindLabels,createSemesterEvents,editEvents,validateEvent,conflictPairs,exportCalendar,parseDate,addDays,weekStart,koreanToday,timeText,timeValue} from './planner-core.mjs';
import {esc,icon,button,link,heading,info,field,toggle,tabs,footer,timetable,layoutTimetables,layoutTabs,animateElements,dayNames,compareOptions,longestDay} from './ui.js';

const $=id=>document.getElementById(id);
const store=createPlannerStore({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)});
const state={
  courses:[],request:null,options:[],active:0,query:'',kind:'major',showAll:false,route:'start',
  track:'data',stage:1,completed:new Set(),careerPicked:null,selectedDate:koreanToday(),editing:null,
  eventDraft:null,eventReturn:'calendar',error:'',diagnostics:[],busy:false,controller:null,
  source:'rules',aiStatus:null,aiMessage:'',noteTitle:'',noteBody:'',lastMode:'rules',resultRequest:null,interpretation:null
};
let toastTimer,pollTimer,requestVersion=0;
const titles={start:'캠퍼스 시간표',courses:'과목 고르기',preferences:'생활 패턴 정하기',advanced:'세부 선호',results:'추천 시간표',saved:'내 시간표',career:'진로에서 과목 찾기',calendar:'학기 일정',event:'일정 변경',export:'캘린더 내보내기',experience:'수강 경험',record:'나의 수강 기록',empty:'추천 결과',loading:'시간표 찾는 중',error:'연결 확인',ai:'AI에게 요청하기'};
const designScreen={results:'resultA'};
function current(){return state.options[state.active]}
function semesterLabel(){const start=store.data.semester?.start||koreanToday();return start.slice(0,4)+'년 '+(Number(start.slice(5,7))<=6?'1':'2')+'학기'}
function flash(text,error=false){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').className='toast'+(error?' error':'');$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5500)}
function go(route){if(location.hash==='#'+route){state.route=route;render()}else location.hash=route}
function back(){go(({courses:'start',preferences:'courses',advanced:'preferences',results:'preferences',career:'courses',calendar:'saved',experience:'career',record:'experience',export:'calendar',event:state.eventReturn,ai:'preferences',empty:'preferences',loading:'preferences',error:'preferences'})[state.route]||'saved')}
async function api(route,body,signal){
  const r=await fetch('/api/'+route,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Timetable-App':'1'},body:JSON.stringify(body)}),signal:signal||AbortSignal.timeout(20000)});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'잠시 뒤 다시 시도해 주세요.');return data;
}
function flowProgress(){
  const step={courses:0,preferences:1,results:2}[state.route];if(step===undefined)return '';
  return '<ol class="flow-progress" aria-label="시간표 만들기 진행 단계">'+['과목 선택','생활 패턴','추천 비교'].map((label,i)=>'<li class="'+(i===step?'current':i<step?'complete':'')+'" '+(i===step?'aria-current="step"':'')+'><span class="flow-number" aria-hidden="true">'+(i<step?'✓':i+1)+'</span><span>'+label+'</span></li>').join('')+'</ol>';
}
const body=(content,cls='')=>'<div class="screen-body '+cls+'">'+flowProgress()+content+'</div>';
function renderHeader(){
  const route=state.route,key=designScreen[route]||route,step=({courses:'1 / 3',preferences:'2 / 3',results:'3 / 3'})[route];
  const backButton=!['start','saved'].includes(route)?button(icon(key in {ai:1}?'preferences':key,'imgBack'),'back','icon-button','aria-label="이전 화면"'):'';
  const extra=step?'<span class="step-label">'+step+'</span>':route==='start'?icon('start','imgGrid'):route==='saved'?button(icon('saved','imgPlus'),'new','icon-button','aria-label="새 시간표 만들기"'):route==='career'?link('수강 경험','experience'):'';
  return '<header class="mobile-header">'+backButton+'<span class="page-name">'+titles[route]+'</span>'+extra+'</header>';
}
function sidebar(){
  const saved=state.route==='saved',screen=saved?'desktopSaved':'desktopCompare';
  const nav=[['saved','내 시간표','imgGrid1'],['courses','시간표 추천','imgSpark'],['career','과목 탐색','imgBook'],['calendar','학기 일정','imgCalendar']];
  return '<aside class="sidebar"><a class="brand" href="#start">'+icon(screen,'imgGrid')+'<span>캠퍼스 시간표</span></a><nav aria-label="주 메뉴">'+nav.map(([route,label,img],i)=>{
    const active=route==='saved'?saved:route==='courses'?['courses','preferences','results','advanced','ai'].includes(state.route):route===state.route;
    const iconScreen=img==='imgGrid1'?(active?'desktopSaved':'desktopCompare'):img==='imgSpark'?(active?'desktopCompare':'desktopSaved'):screen;
    return (i===2?'<hr>':'')+'<a class="side-link '+(active?'active':'')+'" href="#'+route+'" '+(active?'aria-current="page"':'')+'>'+icon(iconScreen,img)+label+'</a>';
  }).join('')+'</nav><p class="school">숭실대학교<br>AI소프트웨어학부</p></aside>';
}
function bottomNav(active){
  const screen=active==='calendar'?'calendar':'saved';
  return '<nav class="bottom-nav" aria-label="주 메뉴">'+[['saved','시간표','imgGrid'],['career','과목 탐색','imgBook'],['calendar','학기 일정','imgCalendar']].map(([route,label,img])=>'<a href="#'+route+'" class="'+(route===active?'active':'')+'" '+(route===active?'aria-current="page"':'')+'>'+icon(screen,img)+'<span>'+label+'</span></a>').join('')+'</nav>';
}
function startView(){
  const cta=link('내 시간표 만들기 <span class="button-arrow" aria-hidden="true">↗</span>','courses','primary');
  return body('<div class="welcome-copy"><span class="chip school-chip"><span class="school-dot" aria-hidden="true"></span>숭실대학교 · AI소프트웨어학부</span>'+heading('이번 학기,<br><span class="title-accent">내 리듬대로.</span>','듣고 싶은 수업과 나를 위한 시간.<br>둘 다 담은 한 주를 함께 찾아요.')+'</div>'+
    '<div class="welcome-preview"><div class="hero-week"><div class="hero-caption"><div><span class="hero-eyebrow">A WEEK, YOUR WAY</span><strong>나에게 맞는 한 주</strong></div><span class="preview-tag">예시</span></div><div class="hero-days">'+dayNames.map(d=>'<span>'+d+'</span>').join('')+'</div><div class="hero-classes"><div class="sage"><strong>자료구조</strong><span>나의 집중 시간</span></div><div class="white"><strong>여유</strong></div><div class="lavender"><strong>알고리즘</strong><span>차근차근</span></div><div class="blue"><strong>데이터<br>베이스</strong></div><div class="accent"><span class="free-day-icon" aria-hidden="true">✳</span><strong>공강</strong></div></div><div class="hero-bottom"><span class="mini-dot" aria-hidden="true"></span>수업 사이, 나만의 시간도.</div></div><div class="preview-note"><span class="note-check" aria-hidden="true">✓</span><span>공강도, 내 계획대로</span></div></div>'+
    '<div class="steps">'+['과목 고르고','내 패턴 담고','한 주 완성'].map((s,i)=>'<div><span>0'+(i+1)+'</span><p>'+s+'</p></div>').join('')+'</div><div class="welcome-action desktop-only">'+cta+'<p>약 1분이면 첫 추천을 볼 수 있어요</p></div>','start-body')+
    '<div class="mobile-only">'+footer(cta,'약 1분이면 첫 추천을 볼 수 있어요')+'</div>';
}
function courseList(){
  const r=state.request,q=state.query.trim().toLowerCase();
  let list=state.courses.filter(c=>(state.kind==='all'||c.kind===state.kind)&&[c.name,c.topic,c.classification].join(' ').toLowerCase().includes(q));
  list.sort((a,b)=>Number(r.requiredCourseIds.includes(b.id))-Number(r.requiredCourseIds.includes(a.id)));
  const count=list.length;list=list.slice(0,state.showAll||q?50:3);
  return list.map(c=>{
    const selected=r.requiredCourseIds.includes(c.id),excluded=r.excludedCourseIds.includes(c.id);
    return '<button class="course-card '+(selected?'selected':'')+'" data-action="course" data-id="'+esc(c.id)+'" aria-pressed="'+selected+'"><span class="course-symbol '+(c.kind==='major'?'blue':'sage')+'" aria-hidden="true">'+(c.kind==='major'?'전공':'교양')+'</span><span class="course-copy"><strong>'+esc(c.name)+'</strong><small>'+esc(c.classification)+' · '+c.credits+'학점'+(c.year?' · '+c.year+'학년':'')+(excluded?' · 추천 제외':'')+'</small></span><span class="selection-mark '+(selected?'checked':'')+'">'+(selected?icon('courses','imgCheck'):'+')+'</span></button>';
  }).join('')+(count===0?'<p class="empty-copy">검색 결과가 없어요. 다른 과목명으로 찾아보세요.</p>':'')+(!state.showAll&&!q&&count>3?button('다른 과목 '+(count-3)+'개 보기','more-courses','quiet'):'');
}
function selectionSummary(){const list=state.courses.filter(c=>state.request.requiredCourseIds.includes(c.id));return list.length?list.length+'과목 · '+list.reduce((n,c)=>n+c.credits,0)+'학점 선택':'과목을 고르지 않으면 조건에 맞춰 추천해요'}
function coursesView(){
  return body(heading('꼭 듣고 싶은 과목부터','필수 과목은 유지하고, 나머지는 추천받아요.')+
    '<label class="sr-only" for="course-search">과목명으로 검색</label><input id="course-search" type="search" placeholder="과목명으로 검색" value="'+esc(state.query)+'">'+
    tabs([['all','전체'],['major','전공'],['general','교양']],state.kind,'course-kind')+'<div id="course-list" class="stack compact">'+courseList()+'</div>'+(state.request.preferredCourseIds.length?'<div class="interest-box"><strong>우선 살펴볼 관심 과목</strong><div class="course-chips">'+state.request.preferredCourseIds.map(id=>button(esc(state.courses.find(c=>c.id===id)?.name)+' ×','remove-interest','interest-chip','data-id="'+id+'" aria-label="'+esc(state.courses.find(c=>c.id===id)?.name)+' 관심 해제"')).join('')+'</div><small>필수 과목과 시간 조건에 맞으면 우선 추천해요.</small></div>':'')+link('어떤 과목을 들을지 고민이라면','career')+
    '<details class="disclosure"><summary>추천에서 제외할 과목</summary><div class="exclude-list">'+state.courses.map(c=>'<label><input type="checkbox" data-exclude="'+esc(c.id)+'" '+(state.request.excludedCourseIds.includes(c.id)?'checked':'')+'>'+esc(c.name)+'</label>').join('')+'</div></details>','compact')+
    footer(link('생활 패턴 정하기','preferences','primary'),'<span id="selection-summary">'+selectionSummary()+'</span>');
}
function timeOptions(value){let out='';for(let m=540;m<=1260;m+=30)out+='<option value="'+m+'" '+(m===value?'selected':'')+'>'+timeText(m)+'</option>';return out}
function preferencesView(){
  const r=state.request;
  return body(heading('어떤 한 주가 편한가요?')+
    field('이번 학기 목표 학점','<div class="credit-target"><input aria-label="목표 학점" id="target-credits" type="number" min="1" max="24" value="'+r.credits.total.min+'"><strong>학점</strong><span>전공 '+r.credits.major.min+' · 교양 '+r.credits.general.min+'</span></div>')+
    '<fieldset class="field"><legend>등교할 수 있는 요일</legend><div class="day-picker">'+dayNames.map((d,i)=>'<label><input type="checkbox" data-day="'+i+'" '+(r.allowedDays.includes(i)?'checked':'')+'><span>'+(r.allowedDays.includes(i)?'✓ ':'')+d+'</span></label>').join('')+'</div><small>선택하지 않은 요일에는 수업을 넣지 않아요.</small></fieldset>'+
    field('수업 가능한 시간','<div class="time-range">'+icon('preferences','imgClock')+'<select id="earliestStart" aria-label="수업 시작 가능 시간">'+timeOptions(r.earliestStart)+'</select><span>~</span><select id="latestEnd" aria-label="수업 종료 한도">'+timeOptions(r.latestEnd)+'</select></div>')+
    toggle('compact','가능하면 공강 시간을 줄여 주세요',r.preferences.compact)+toggle('lunch','점심시간을 확보하고 싶어요',r.preferences.lunch)+link('더 세밀하게 설정하기','advanced')+link('문장으로 요청하고 싶다면','ai'),'compact')+
    footer(button('추천 시간표 보기','recommend'),'조건은 언제든 다시 바꿀 수 있어요');
}
function creditFields(){return ['total','major','general'].map((k,i)=>'<div class="credit-range"><span>'+['총 학점','전공','교양'][i]+'</span>'+['min','max'].map((b,j)=>(j?'<span>~</span>':'')+'<input type="number" min="'+(k==='total'?1:0)+'" max="24" data-credit="'+k+'" data-bound="'+b+'" aria-label="'+['총 학점','전공','교양'][i]+(j?' 최대':' 최소')+'" value="'+state.request.credits[k][b]+'">').join('')+'</div>').join('')}
function advancedView(){
  const r=state.request;
  return body(heading('조금 더 나답게','가능하면 반영할 조건이에요.<br>필수 과목과 가능한 시간은 그대로 유지돼요.')+
    field('하루의 수업량','<select id="daily-limit">'+[null,2,3,4,5,6].map(n=>'<option value="'+(n??'')+'" '+(n===r.maxCoursesPerDay?'selected':'')+'>'+(n?'하루 최대 '+n+'과목':'상관없음')+'</option>').join('')+'</select>')+
    toggle('breaks','연강을 줄이고 싶어요',r.preferences.breaks,'수업 사이 30분 이상 여유를 선호해요.')+
    toggle('lunch','점심시간 확보',r.preferences.lunch,'12시부터 14시 사이에 1시간을 비워요.')+
    toggle('fewDays','등교일 줄이기',r.preferences.fewDays)+toggle('late','오전 수업 피하기',r.preferences.late)+toggle('friday','금요일 공강 선호',r.preferences.friday)+toggle('travel','건물 이동 줄이기',r.preferences.travel)+
    '<details class="disclosure"><summary>학점 범위 직접 설정</summary><div class="stack compact">'+creditFields()+'<small>같은 숫자를 넣으면 정확히 맞춰요.</small></div></details>'+
    '<div class="card muted"><strong>교수·강의평으로 고르기</strong><p>확인할 수 있는 강의 정보가 생기면<br>과목 상세에서 제공할 예정이에요.</p></div>')+footer(link('선호 저장하기','preferences','primary'),'필수 조건 안에서 선호를 반영해요');
}
function candidateTabs(){return tabs(state.options.map((c,i)=>[i,c.strategy||'추천 '+(i+1)]),state.active,'candidate')}
function reason(c){
  return '주 '+c.metrics.days+'일 등교 · 하루 최대 '+(longestDay(c)/60)+'시간 수업 · 공강 총 '+c.metrics.gapMinutes+'분';
}
function comparisonCard(c,i){
  return '<button class="comparison-card '+(i===state.active?'selected':'')+'" data-action="candidate" data-value="'+i+'" aria-pressed="'+(i===state.active)+'"><span class="comparison-card-title"><span class="choice-dot" aria-hidden="true"></span><strong>'+esc(c.strategy)+'</strong><span class="option-number">0'+(i+1)+'</span></span><span class="comparison-stats"><span><b>'+c.metrics.days+'</b>일<small>등교</small></span><span><b>'+(longestDay(c)/60)+'</b>시간<small>하루 최대</small></span><span><b>'+c.metrics.gapMinutes+'</b>분<small>공강 합계</small></span></span></button>';
}
function resultsView(){
  const c=current();if(!c)return emptyView();
  const applied=state.resultRequest||state.request;
  const earliest=Math.min(...c.sections.flatMap(s=>s.meetings.map(m=>m[1])));
  const flags='✓ 필수 '+applied.requiredCourseIds.length+'과목 포함'+(!c.metrics.dayList.includes(4)?'　✓ 금요일 공강':'');
  const summary='<div class="metrics">'+[[c.credits+'학점','이번 학기'],[c.metrics.days+'일','등교'],[timeText(earliest),'첫 수업']].map(([v,l])=>'<div><strong>'+v+'</strong><span>'+l+'</span></div>').join('')+'</div>';
  return body('<div class="desktop-heading">'+heading('나에게 맞는 한 주를 골라요','필수 과목과 가능한 시간을 만족하는 추천안이에요.')+'</div><div class="mobile-only">'+heading('이런 한 주는 어때요?')+'</div>'+
    '<div class="compare-layout"><div class="schedule-main"><div class="mobile-only">'+candidateTabs()+summary+'</div><div class="desktop-only table-tools"><h2>'+esc(c.strategy)+'</h2><span class="chip">'+c.credits+'학점 · 등교 '+c.metrics.days+'일</span></div><div class="timetable-surface">'+timetable(c)+'</div>'+
    '<div class="recommendation-reason"><p class="accent-text">'+flags+'</p><p>'+reason(c)+'</p>'+(c.metrics.lunchMissedDays?'<small>점심 1시간을 확보하지 못한 날이 '+c.metrics.lunchMissedDays+'일 있어요.</small>':'')+'</div>'+link('조건 다시 조정하기','preferences')+
    '<details class="disclosure"><summary>과목과 추천 이유 자세히</summary><p>'+esc(c.aiReason||'필수 조건을 지킨 유효 후보 중 서로 다른 시간표를 골랐어요.')+'</p>'+c.sections.map(s=>'<p>'+esc(s.name)+' · '+s.credits+'학점</p>').join('')+'<p>적용 조건: '+applied.allowedDays.map(d=>dayNames[d]).join('·')+' / '+timeText(applied.earliestStart)+'–'+timeText(applied.latestEnd)+' / 총 '+applied.credits.total.min+'–'+applied.credits.total.max+'학점</p>'+(state.interpretation?.summary?'<p>'+esc(state.interpretation.summary)+'</p>':'')+(state.interpretation?.unsupported?.length?'<p>반영하지 못한 요청: '+state.interpretation.unsupported.map(esc).join(', ')+'</p>':'')+'<small>수업 시간·분반·강의실은 가상 데이터예요.</small></details></div>'+
    '<aside class="comparison-side desktop-only"><h2>나에게 중요한 기준</h2>'+state.options.map(comparisonCard).join('')+
    '<div class="criteria"><strong>모든 추천안에서 유지했어요</strong><p>✓ '+(applied.requiredCourseIds.map(id=>esc(state.courses.find(c=>c.id===id)?.name)).join(' · ')||'수업 시간 겹침 없음')+'</p><p>✓ 총 '+applied.credits.total.min+'–'+applied.credits.total.max+'학점 · '+timeText(applied.earliestStart)+' 이후 수업</p></div>'+button('이 시간표 저장','confirm')+'</aside></div>','wide-body')+
    '<div class="mobile-only">'+footer(button('이 시간표로 정하기','confirm'))+'</div>';
}
function savedView(){
  const c=store.data.semester?.candidate;
  if(!c)return body(heading('아직 시간표가 없어요.','내 생활 패턴에 맞는 첫 시간표를 만들어 보세요.'))+footer(link('시간표 만들기','courses','primary'));
  const today=koreanToday(),next=store.data.events.filter(e=>e.status==='active'&&e.date>=today).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start)[0];
  const first=c.sections[0];
  return body('<div class="desktop-heading heading-row">'+heading('이번 주도, 내 리듬대로.',semesterLabel()+' · 내 시간표')+link('추천안 다시 비교',state.options.length?'results':'preferences','secondary')+'</div>'+
    '<div class="mobile-only table-tools"><span class="chip">'+semesterLabel()+'</span><span class="muted">'+c.credits+'학점</span></div>'+
    '<div class="mobile-only">'+info('내 시간표로 저장했어요','수업을 누르면 상세 내용을 볼 수 있어요.',icon('saved','imgCheck'),true)+'</div>'+
    '<div class="saved-layout"><div class="schedule-main"><div class="table-tools desktop-only"><h2>나의 시간표</h2><span class="chip">'+c.credits+'학점 · '+c.sections.length+'과목</span></div><div class="timetable-surface">'+timetable(c)+'</div>'+
    '<small class="desktop-only">수업을 선택해 시간과 장소를 확인하세요.</small></div>'+
    '<aside class="saved-side"><p class="muted">'+(next?dateLabel(next.date):'이번 학기')+'</p><button class="card next-class" data-action="'+(next?'open-event':'section')+'" data-id="'+esc(next?.id||first.courseId)+'">'+icon('saved','imgClock')+'<span><strong>'+(next?timeText(next.start)+'　'+esc(next.title):esc(first.name))+'</strong><small>'+(next?esc(next.location)+' · '+timeText(next.end)+' 종료':'수업 정보를 확인해 보세요.')+'</small></span></button>'+
    '<div class="desktop-only card info"><div><strong>나만의 한 학기</strong><p>주간표는 반복되는 수업을,<br>학기 일정은 날짜별 변경을 보여줘요.</p>'+link('학기 일정 보기','calendar')+'</div></div></aside></div>','wide-body')+bottomNav('saved');
}

function dateLabel(date){return new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'UTC'}).format(parseDate(date))}
function careerIds(){return state.careerPicked??careerSelection(state.track,state.stage,[...state.completed],state.courses)}
function careerView(){
  const track=careerTracks.find(t=>t.id===state.track),ids=careerIds();
  return body(heading('관심 분야에서 시작해요','정답인 순서는 없어요. 지금 필요한 과목을 살펴보세요.')+
    tabs(careerTracks.map(t=>[t.id,t.name]),state.track,'track')+info(track.name,track.description,icon('career','imgSpark'))+
    '<div class="stage-path">'+track.stages.map(([name],i)=>button('<small>STEP '+(i+1)+'</small>'+name,'stage','stage '+(i===state.stage?'selected':''),'data-value="'+i+'" aria-pressed="'+(i===state.stage)+'"')).join('')+'</div><h2>이번 단계에서 살펴볼 과목</h2><div class="stack compact">'+track.stages[state.stage][1].map(id=>{const c=state.courses.find(c=>c.id===id);return c?'<button class="course-card '+(ids.includes(id)?'selected':'')+'" data-action="career-course" data-id="'+id+'" aria-pressed="'+ids.includes(id)+'" '+(state.completed.has(id)?'disabled':'')+'><span><strong>'+esc(c.name)+'</strong><small>'+c.credits+'학점 · '+(state.completed.has(id)?'이미 이수했어요':esc(c.topic))+'</small></span><span class="selection-mark '+(ids.includes(id)?'checked':'')+'">'+(ids.includes(id)?icon('career','imgCheck'):'+')+'</span></button>':''}).join('')+'</div>'+
    '<details class="disclosure"><summary>이미 들은 과목이 있어요</summary><div class="exclude-list">'+state.courses.filter(c=>c.kind==='major').map(c=>'<label><input type="checkbox" data-completed="'+c.id+'" '+(state.completed.has(c.id)?'checked':'')+'>'+esc(c.name)+'</label>').join('')+'</div></details><small>교육과정을 참고한 탐색 예시예요. 선수 과목과 개설 여부는 학교에서 확인해 주세요.</small>')+
    footer(button(ids.length+'과목을 관심 과목에 담기','apply-career','primary',ids.length?'':'disabled'),'필수 과목과 시간 조건 안에서 우선 추천해요');
}
function calendarView(){
  if(!store.data.semester)return body(heading('한 학기를 준비해 볼까요?','시간표를 먼저 저장하면 날짜별 일정을 관리할 수 있어요.'))+footer(link('시간표 만들기','courses','primary'));
  const date=state.selectedDate,start=weekStart(date),events=store.data.events.filter(e=>e.date===date).sort((a,b)=>a.start-b.start),conflicts=new Set(conflictPairs(store.data.events).flat());
  return body('<div class="heading-row">'+heading('한눈에 보는 한 주',semesterLabel())+link('내보내기','export','quiet')+'</div><div class="calendar-tools">'+button('‹','week','icon-button','data-value="-7" aria-label="이전 주"')+'<label class="date-jump"><span class="sr-only">날짜 선택</span><input type="date" id="calendar-date" value="'+date+'"></label>'+button('›','week','icon-button','data-value="7" aria-label="다음 주"')+button('오늘','today','quiet')+'</div>'+
    '<div class="week-picker" role="group" aria-label="이번 주 날짜">'+Array.from({length:7},(_,i)=>{const d=addDays(start,i);return button('<small>'+['월','화','수','목','금','토','일'][i]+'</small><strong>'+Number(d.slice(8))+'</strong>'+(store.data.events.some(e=>e.date===d&&e.status==='active')?'<span class="dot"></span>':'<span class="dot blank"></span>'),'date','date-button '+(d===date?'selected':''),'data-value="'+d+'" aria-pressed="'+(d===date)+'"')}).join('')+'</div>'+
    '<div class="section-title"><h2>'+dateLabel(date)+'</h2>'+button('+ 일정','add-event','quiet')+'</div><div class="agenda">'+(events.length?events.map(e=>'<button class="agenda-item '+(e.status==='cancelled'?'cancelled':'')+'" data-action="open-event" data-id="'+esc(e.id)+'"><span class="agenda-time">'+timeText(e.start)+'<small>'+timeText(e.end)+'</small></span><span class="agenda-detail '+(e.kind==='class'?'blue':e.kind==='exam'?'peach':'sage')+'"><span class="eyebrow">'+(e.status==='cancelled'?'휴강 · 취소':kindLabels[e.kind])+(conflicts.has(e.id)?' · 시간 겹침':'')+'</span><strong>'+esc(e.title)+'</strong><small>'+esc(e.location||'장소 미정')+'</small></span></button>').join(''):'<div class="empty-agenda">'+icon('calendar','imgCalendar')+'<h3>여유로운 하루예요</h3><p>필요한 일정을 직접 추가해 보세요.</p></div>')+'</div>','calendar-body')+bottomNav('calendar');
}
function eventView(){
  const d=state.eventDraft;if(!d)return body(heading('일정을 먼저 선택해 주세요.'))+footer(link('학기 일정 보기','calendar','primary'));
  const original=store.data.events.find(e=>e.id===state.editing),cancelled=original?.status==='cancelled';
  return body(heading(original?'일정을 조정해요':'새 일정을 더해요',original?'변경된 내용은 학기 일정에 반영돼요.':'시험, 보강, 개인 약속도 함께 관리해요.')+
    '<form id="event-form" class="stack">'+field('일정 이름','<input name="title" required maxlength="100" value="'+esc(d.title)+'">')+
    field('종류','<select name="kind">'+Object.entries(kindLabels).map(([key,label])=>'<option value="'+key+'" '+(key===d.kind?'selected':'')+'>'+label+'</option>').join('')+'</select>')+
    field('날짜','<input name="date" type="date" required min="'+store.data.semester.start+'" max="'+store.data.semester.end+'" value="'+d.date+'">')+
    '<div class="two-fields">'+field('시작','<input name="start" type="time" required value="'+timeText(d.start)+'">')+field('종료','<input name="end" type="time" required value="'+timeText(d.end)+'">')+'</div>'+
    field('장소','<input name="location" maxlength="100" placeholder="강의실 또는 약속 장소" value="'+esc(d.location)+'">')+
    (original?.seriesId?'<fieldset class="scope-picker"><legend>변경 범위</legend><label><input type="radio" name="scope" value="one" checked>이번 일정만</label><label><input type="radio" name="scope" value="future">이후 같은 반복 수업도</label><small>같은 분반의 같은 요일 수업에 적용돼요.</small></fieldset>':'')+
    '<p id="event-error" class="form-error" role="alert"></p></form>'+ (cancelled?info('휴강·취소된 일정이에요','복원하면 학기 일정에 다시 포함돼요.'):'')+
    (original?'<div class="inline-actions">'+(cancelled?button('일정 복원','restore-event','secondary'):button('휴강 · 일정 취소','cancel-event','danger'))+(original.original&&!cancelled?button('원래 수업으로 복원','restore-event','quiet'):'')+'</div>':''))+
    footer(button('변경 저장하기','save-event','primary',cancelled?'disabled':''));
}
function exportView(){
  const semester=store.data.semester,active=store.data.events.filter(e=>e.status==='active');
  return body(heading('익숙한 캘린더에서도','이번 학기 일정을 파일로 가져갈 수 있어요.')+
    '<div class="export-card">'+icon('export','imgDownload')+'<h2>'+semesterLabel()+' 일정</h2><p>'+active.length+'개의 일정 · .ics 파일</p>'+(semester?'<small>'+semester.start+' ~ '+semester.end+'</small>':'')+'</div>'+
    info('변경한 일정까지 함께','휴강·취소는 제외하고, 시험과 개인 일정은 포함해요.',icon('export','imgCalendar'))+
    '<ol class="export-help"><li>아래 버튼으로 일정 파일을 저장해요.</li><li>사용하는 캘린더의 가져오기를 선택해요.</li><li>저장한 .ics 파일을 열면 완료예요.</li></ol><small>파일을 가져온 뒤의 변경은 자동으로 동기화되지 않아요.</small>')+
    footer(semester?button('캘린더 파일 다운로드','download'):link('먼저 시간표 만들기','courses','primary'));
}
const examples=[
  {title:'전공의 기초를 단단하게',description:'자료구조와 알고리즘을 함께 살펴보는 조합',ids:['ds','algo'],color:'sage'},
  {title:'데이터와 친해지는 한 학기',description:'통계와 데이터베이스를 연결해 보는 조합',ids:['stats','db'],color:'lavender'},
  {title:'직접 만드는 경험을 더해요',description:'웹과 오픈소스 과목에 관심이 있다면',ids:['web','open'],color:'blue'}
];
function experienceView(){
  return body(heading('다른 조합도 살펴볼까요?','관심 있는 과목 조합을 내 조건에 적용해 보세요.')+
    '<span class="eyebrow">가상 조합 예시</span><div class="stack">'+examples.map((e,i)=>'<button class="experience-card card" data-action="example" data-value="'+i+'"><span class="experience-number '+e.color+'">0'+(i+1)+'</span><span><strong>'+e.title+'</strong><small>'+e.description+'</small><span class="course-chips">'+e.ids.map(id=>'<span>'+esc(state.courses.find(c=>c.id===id)?.name)+'</span>').join('')+'</span></span>'+icon('experience','imgChevron')+'</button>').join('')+'</div><small>실제 수강 후기가 아닌 탐색용 예시예요.</small>'+
    '<div class="section-title"><h2>나의 수강 기록</h2>'+link('+ 기록','record')+'</div>'+(store.data.experiences.length?store.data.experiences.slice().reverse().map(e=>'<article class="card record-card"><strong>'+esc(e.title)+'</strong><p>'+esc(e.body)+'</p><small>'+e.courseNames.map(esc).join(' · ')+'</small></article>').join(''):'<p class="muted">이번 시간표를 고른 이유를 남겨 보세요.</p>'))+footer(link('내 시간표 기록하기','record','secondary'));
}
function recordView(){
  const c=store.data.semester?.candidate||current();
  return body(heading('이번 선택을 기록해요','다음 학기의 나에게 작은 힌트를 남겨요.')+
    info('나만 볼 수 있는 기록','이 브라우저에만 저장돼요.',icon('record','imgUser'))+
    (c?'<div class="course-chips">'+c.sections.map(s=>'<span>'+esc(s.name)+'</span>').join('')+'</div>':'<p class="muted">먼저 추천 시간표를 선택해 주세요.</p>')+
    '<form id="record-form" class="stack">'+field('기록 제목','<input name="title" id="note-title" required maxlength="80" placeholder="이번 학기, 이렇게 골랐어요" value="'+esc(state.noteTitle)+'">')+
    field('이 조합을 고른 이유','<textarea name="body" id="note-body" required maxlength="600" rows="6" placeholder="수업을 고른 이유와 기대하는 점을 자유롭게 적어 보세요.">'+esc(state.noteBody)+'</textarea>')+'<p class="form-error" id="record-error" role="alert"></p></form>')+
    footer(button('내 기록 저장하기','save-record','primary',c?'':'disabled'),'다른 사람에게 공개되지 않아요');
}
function emptyView(){return body('<div class="state-illustration">'+icon('empty','imgSearch')+'</div>'+heading('조건을 조금만 바꿔 볼까요?','현재 조건에서는 시간표를 찾지 못했어요.')+'<div class="card">'+state.diagnostics.map(d=>'<p>'+esc(d)+'</p>').join('')+'</div>'+info('필수 과목은 그대로','등교 요일이나 수업 시간을 넓혀 보세요.',icon('empty','imgBook')))+footer(link('조건 조정하기','preferences','primary'))}
function loadingView(){return body('<div class="state-illustration loading-symbol">'+icon('loading','imgSpark')+'</div>'+heading('나에게 맞는 한 주를 찾고 있어요','과목이 겹치지 않는지 확인하고<br>생활 패턴에 맞는 조합을 비교해요.')+'<div class="loading-line" role="progressbar" aria-label="추천 생성 중"></div><p class="muted center">'+(state.lastMode==='ai'?'AI가 요청을 해석하고 이유를 정리하고 있어요.':'유효한 시간표를 비교하고 있어요.')+'</p>')+footer(link('조건으로 돌아가기','preferences','secondary'))}
function errorView(){return body('<div class="state-illustration">'+icon('error','imgAlert')+'</div>'+heading('잠시 확인이 필요해요',esc(state.error||'다시 시도하거나 조건을 확인해 주세요.'))+info('입력한 조건은 그대로예요','설정을 바꾸지 않고 다시 시도할 수 있어요.',icon('error','imgGrid')))+footer(button('다시 시도하기','retry')+link('조건 확인하기','preferences','secondary'))}
function aiView(){
  const s=state.aiStatus,waiting=s?.loginState==='waiting';
  return body(heading('말로 편하게 요청해요','원하는 요일, 학점, 관심 분야를 알려 주세요.')+
    field('AI에게 요청할 내용','<textarea id="ai-note" maxlength="400" rows="5" placeholder="수요일만 등교하고 전공 6학점, 교양 2학점으로 골라줘.">'+esc(state.request.note)+'</textarea>')+
    '<div class="card ai-connection"><strong>'+(s?.connected?'Codex가 연결되어 있어요':waiting?'브라우저에서 연결을 마쳐 주세요':'Codex 계정 연결')+'</strong><p id="ai-status" role="status">'+esc(state.aiMessage||'본인의 계정으로 요청을 해석하고 추천 이유를 정리해요.')+'</p>'+(waiting?button('연결 취소','cancel-login','secondary'):button(s?.connected?'연결 확인':'Codex 연결','connect','secondary'))+'</div><small>요청 내용에 따라 기존 학점·요일·필수 과목 조건이 바뀔 수 있어요. 결과의 적용 조건을 확인해 주세요.</small>')+
    footer(button('AI로 시간표 추천받기','recommend-ai','primary',s?.connected?'':'disabled')+button('현재 조건으로 기본 추천','recommend','secondary'));
}
const views={start:startView,courses:coursesView,preferences:preferencesView,advanced:advancedView,results:resultsView,saved:savedView,career:careerView,calendar:calendarView,event:eventView,export:exportView,experience:experienceView,record:recordView,empty:emptyView,loading:loadingView,error:errorView,ai:aiView};
function render(motion='none'){
  const sameRoute=$('content')?.dataset.route===state.route,focused=document.activeElement;
  const scrollTop=sameRoute?document.querySelector('.screen-body')?.scrollTop||0:0;
  const openDetails=sameRoute?[...document.querySelectorAll('main details')].map(el=>el.open):[];
  const focusSelector=sameRoute&&focused?.closest('#app')?(focused.id?'#'+CSS.escape(focused.id):focused.dataset.completed?'[data-completed="'+CSS.escape(focused.dataset.completed)+'"]':focused.dataset.action?'[data-action="'+CSS.escape(focused.dataset.action)+'"]'+['id','value'].filter(k=>focused.dataset[k]!==undefined).map(k=>'[data-'+k+'="'+CSS.escape(focused.dataset[k])+'"]').join(''):null):null;
  const previousTabs=new Map([...document.querySelectorAll('[data-tabs]')].filter(el=>el.offsetWidth).map(el=>[el.dataset.tabs,el.querySelector('[aria-pressed="true"]')?.getBoundingClientRect()]));
  const wide=['start','saved','results'].includes(state.route),content=(views[state.route]||startView)();
  $('app').innerHTML='<div class="app-shell">'+sidebar()+'<div class="workspace"><header class="desktop-topbar"><span>'+semesterLabel()+'</span><span class="user-label">나의 캠퍼스 '+icon('desktopSaved','imgUser')+'</span></header><main id="content" class="screen '+(wide?'wide':'')+'" data-route="'+state.route+'">'+renderHeader()+content+'</main></div></div>';
  layoutTimetables();layoutTabs(sameRoute?previousTabs:new Map());
  if(sameRoute)document.querySelectorAll('main details').forEach((el,i)=>el.open=!!openDetails[i]);
  document.querySelector('.screen-body')?.scrollTo(0,scrollTop);
  if(focusSelector){const matches=[...document.querySelectorAll(focusSelector)];matches.find(el=>el.offsetWidth)?.focus({preventScroll:true})}
  if(motion==='page'){
    animateElements(document.querySelectorAll('.screen-body > *'));
    if(state.route==='start')animateElements(document.querySelectorAll('.hero-classes > div'),{distance:18,duration:520,stagger:65});
  }else if(motion==='schedule')animateElements(document.querySelectorAll('.class-block'),{distance:8,duration:300,stagger:18,scale:.97});
  else if(motion==='list')animateElements(document.querySelectorAll('#course-list > .course-card'),{distance:6,duration:240,stagger:25});
  else if(motion==='agenda')animateElements(document.querySelectorAll('.agenda > *'),{distance:8,duration:260,stagger:35});
}
function routeChanged(){
  const route=location.hash.slice(1),next=views[route]?route:(store.data.semester?'saved':'start');
  if(state.busy&&next!=='loading'){state.controller?.abort();state.busy=false;requestVersion++}
  clearTimeout(pollTimer);state.route=next;
  if(next==='event'&&!state.eventDraft){go('calendar');return}
  if(next==='loading'&&!state.busy){go('preferences');return}
  window.scrollTo(0,0);render('page');document.querySelector('h1')?.focus({preventScroll:true});
  if(next==='ai')checkConnection();
}
async function recommend(mode='rules'){
  if(state.busy)return;
  state.lastMode=mode;state.busy=true;const version=++requestVersion;state.controller=new AbortController();
  go('loading');
  const timeout=setTimeout(()=>state.controller?.abort(),mode==='ai'?240000:20000);
  try{
    const result=await api(mode==='ai'?'recommend':'candidates',state.request,state.controller.signal);
    if(version!==requestVersion)return;
    state.request=result.request;state.resultRequest=structuredClone(result.request);state.interpretation=result.interpretation||null;state.diagnostics=result.diagnostics||[];
    state.options=mode==='ai'&&result.recommendations?.length?result.recommendations.map((r,i)=>({...result.candidates.find(c=>c.id===r.id),strategy:'AI 추천 '+(i+1),aiReason:r.reason})):compareOptions(result.candidates);
    state.active=0;state.source=result.source||'rules';state.busy=false;go(state.options.length?'results':'empty');
    if(result.interpretation?.summary)flash(result.interpretation.summary);
  }catch(e){if(version!==requestVersion)return;state.busy=false;state.error=e.name==='AbortError'?'응답이 오래 걸리고 있어요. 잠시 뒤 다시 시도해 주세요.':e.message;go('error')}
  finally{clearTimeout(timeout)}
}
function dialog(content){$('dialog').innerHTML=content;$('dialog').showModal()}
function closeDialog(){$('dialog').close()}
function confirmSemester(){
  const today=koreanToday(),year=today.slice(0,4),second=Number(today.slice(5,7))>=7;
  const start=store.data.semester?.start||year+(second?'-09-01':'-03-02'),end=store.data.semester?.end||year+(second?'-12-20':'-06-20');
  dialog('<div class="dialog-heading"><h2 id="dialog-title">이번 학기 시간표로 저장</h2>'+button('×','close-dialog','icon-button','aria-label="닫기"')+'</div><p>학기 기간을 정하면 수업 일정을 함께 만들어요.</p><form id="semester-form" class="stack">'+field('학기 시작일','<input name="start" type="date" required value="'+start+'">')+field('학기 종료일','<input name="end" type="date" required value="'+end+'">')+(store.data.semester?'<label class="replace-confirm"><input name="replace" type="checkbox" required>기존 학기 일정과 변경 내역을 새 시간표로 교체합니다. 수강 기록은 유지돼요.</label>':'')+'<p id="semester-error" class="form-error" role="alert"></p><button type="submit" class="button primary">내 시간표로 저장</button></form>');
}
function showSection(courseId){
  const c=state.route==='saved'?store.data.semester?.candidate:current(),s=c?.sections.find(s=>s.courseId===courseId);if(!s)return;
  dialog('<div class="dialog-heading"><h2 id="dialog-title">'+esc(s.name)+'</h2>'+button('×','close-dialog','icon-button','aria-label="닫기"')+'</div><span class="chip">'+esc(s.classification)+' · '+s.credits+'학점</span><div class="section-detail"><p>'+s.meetings.map(([d,f,t])=>dayNames[d]+'요일 '+timeText(f)+' ~ '+timeText(t)).join('<br>')+'</p><p>'+esc(s.building)+'</p><small>수업 시간·분반·강의실은 가상 데이터예요.</small></div>'+(state.route==='saved'?button('날짜별 일정 보기','section-calendar','primary','data-id="'+esc(courseId)+'"'):button('확인','close-dialog')));
}
function openEvent(id){const e=store.data.events.find(e=>e.id===id);if(!e)return;state.editing=id;state.eventDraft={...e};state.eventReturn=state.route==='saved'?'saved':'calendar';go('event')}
function addEvent(){if(!store.data.semester){go('courses');return}state.editing=null;state.eventDraft={title:'',date:state.selectedDate,start:720,end:780,location:'',kind:'personal'};state.eventReturn='calendar';go('event')}
function eventPatch(){const f=$('event-form'),data=new FormData(f);return {title:String(data.get('title')).trim(),date:String(data.get('date')),start:timeValue(data.get('start')),end:timeValue(data.get('end')),location:String(data.get('location')).trim(),kind:String(data.get('kind'))}}
function saveEvent(action='edit',confirmed=false){
  const f=$('event-form');if(action==='edit'&&!f.reportValidity())return;
  try{
    const patch=action==='edit'?eventPatch():{},scope=new FormData(f).get('scope')||'one';
    const preview=state.editing?editEvents(store.data.events,state.editing,patch,{action,scope,period:store.data.semester}):[...store.data.events,validateEvent({...patch,id:'preview-new-event',status:'active'})];
    if(!state.editing&&(patch.date<store.data.semester.start||patch.date>store.data.semester.end))throw new Error('학기 기간 안의 날짜를 선택해 주세요.');
    const before=new Set(conflictPairs(store.data.events).map(p=>p.slice().sort().join('|'))),newConflicts=conflictPairs(preview).filter(p=>!before.has(p.slice().sort().join('|')));
    if(newConflicts.length&&!confirmed){dialog('<div class="dialog-heading"><h2 id="dialog-title">겹치는 일정이 있어요</h2>'+button('×','close-dialog','icon-button','aria-label="닫기"')+'</div><p>변경 후 '+newConflicts.length+'개의 일정 겹침이 생겨요. 그래도 저장할까요?</p><div class="stack">'+button('겹침을 확인하고 저장','accept-conflict','primary','data-value="'+action+'"')+button('다시 수정하기','close-dialog','secondary')+'</div>');return}
    if(state.editing)store.changeEvent(state.editing,patch,{action,scope});else store.addEvent(patch);
    state.selectedDate=(action==='restore'?preview.find(e=>e.id===state.editing)?.date:patch.date)||state.eventDraft.date;
    closeDialog();go('calendar');flash(action==='cancel'?'일정을 취소했어요.':action==='restore'?'일정을 복원했어요.':'일정을 저장했어요.');
  }catch(e){$('event-error').textContent=e.message}
}
async function checkConnection(){
  try{state.aiStatus=await api('status');state.aiMessage=state.aiStatus.message||(state.aiStatus.connected?'연결된 계정으로 추천받을 수 있어요.':'연결 후 AI 추천을 사용할 수 있어요.');if(state.route==='ai'){const input=$('ai-note'),focused=document.activeElement===input,selection=[input?.selectionStart,input?.selectionEnd];if(input)state.request.note=input.value;render();if(focused){$('ai-note').focus({preventScroll:true});$('ai-note').setSelectionRange(...selection)}if(state.aiStatus.loginState==='waiting')pollTimer=setTimeout(checkConnection,2000)}}
  catch(e){state.aiMessage=e.message;if(state.route==='ai')render()}
}
async function act(action,el){
  switch(action){
    case 'back':back();break;
    case 'new':go('courses');break;
    case 'course':{const id=el.dataset.id,r=state.request,selected=!r.requiredCourseIds.includes(id);r.requiredCourseIds=selected?[...r.requiredCourseIds,id]:r.requiredCourseIds.filter(x=>x!==id);r.excludedCourseIds=r.excludedCourseIds.filter(x=>x!==id);el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',selected);const mark=el.querySelector('.selection-mark');mark.classList.toggle('checked',selected);mark.innerHTML=selected?icon('courses','imgCheck'):'+';el.querySelector('small').textContent=el.querySelector('small').textContent.replace(' · 추천 제외','');const excluded=document.querySelector('[data-exclude="'+id+'"]');if(excluded)excluded.checked=false;$('selection-summary').textContent=selectionSummary();animateElements([mark],{distance:0,duration:240,stagger:0,scale:.7});break}
    case 'course-kind':state.kind=el.dataset.value;render('list');break;
    case 'more-courses':state.showAll=true;render('list');break;
    case 'remove-interest':state.request.preferredCourseIds=state.request.preferredCourseIds.filter(id=>id!==el.dataset.id);render();break;
    case 'candidate':if(state.active!==Number(el.dataset.value)){state.active=Number(el.dataset.value);render('schedule')}break;
    case 'recommend':await recommend();break;
    case 'recommend-ai':await recommend('ai');break;
    case 'retry':if(!state.request)await init();else await recommend(state.lastMode);break;
    case 'confirm':confirmSemester();break;
    case 'close-dialog':closeDialog();break;
    case 'section':showSection(el.dataset.id);break;
    case 'section-calendar':{const events=store.data.events.filter(e=>e.courseId===el.dataset.id),upcoming=events.find(e=>e.date>=koreanToday())||events[0];if(upcoming)state.selectedDate=upcoming.date;closeDialog();go('calendar');break}
    case 'track':state.track=el.dataset.value;state.careerPicked=null;render();break;
    case 'stage':state.stage=Number(el.dataset.value);state.careerPicked=null;render();break;
    case 'career-course':{const ids=careerIds();state.careerPicked=ids.includes(el.dataset.id)?ids.filter(id=>id!==el.dataset.id):[...ids,el.dataset.id];render();break}
    case 'apply-career':{const ids=careerIds(),r=state.request;r.preferredCourseIds=[...new Set([...r.preferredCourseIds,...ids])].filter(id=>!state.completed.has(id));r.excludedCourseIds=[...new Set([...r.excludedCourseIds,...state.completed])].filter(id=>!ids.includes(id));r.requiredCourseIds=r.requiredCourseIds.filter(id=>!state.completed.has(id));go('courses');flash(ids.length+'과목을 관심 과목에 담았어요.');break}
    case 'example':{const ids=examples[Number(el.dataset.value)].ids.filter(id=>!state.completed.has(id));state.request.preferredCourseIds=[...new Set([...state.request.preferredCourseIds,...ids])];state.request.excludedCourseIds=state.request.excludedCourseIds.filter(id=>!ids.includes(id));go('courses');flash('관심 과목에 담았어요. 필수 과목은 그대로 유지해요.');break}
    case 'week':state.selectedDate=addDays(state.selectedDate,Number(el.dataset.value));render('agenda');break;
    case 'date':state.selectedDate=el.dataset.value;render('agenda');break;
    case 'today':state.selectedDate=koreanToday();render('agenda');break;
    case 'open-event':openEvent(el.dataset.id);break;
    case 'add-event':addEvent();break;
    case 'save-event':saveEvent();break;
    case 'cancel-event':saveEvent('cancel');break;
    case 'restore-event':saveEvent('restore');break;
    case 'accept-conflict':saveEvent(el.dataset.value,true);break;
    case 'download':{const url=URL.createObjectURL(new Blob([exportCalendar(store.data.events)],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='campus-'+store.data.semester.start+'.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);flash('캘린더 파일을 다운로드했어요.');break}
    case 'save-record':{if(!$('record-form').reportValidity())return;try{store.addRecord(state.noteTitle,state.noteBody,store.data.semester?.candidate||current());state.noteTitle='';state.noteBody='';go('experience');flash('내 기록을 저장했어요.')}catch(e){$('record-error').textContent=e.message}break}
    case 'connect':{el.disabled=true;try{const status=await api('status');if(!status.connected)await api('connect',{});await checkConnection()}finally{el.disabled=false}break}
    case 'cancel-login':await api('cancel',{});await checkConnection();break;
  }
}
document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(!el||el.disabled)return;act(el.dataset.action,el).catch(error=>flash(error.message,true))});
document.addEventListener('input',e=>{
  const el=e.target,r=state.request;if(!r)return;
  if(el.id==='course-search'){state.query=el.value;$('course-list').innerHTML=courseList()}
  if(el.id==='target-credits'){const n=Number(el.value);r.credits.total={min:n,max:n};r.credits.major.max=Math.max(r.credits.major.min,n);r.credits.general.max=Math.max(r.credits.general.min,n)}
  if(el.dataset.credit)r.credits[el.dataset.credit][el.dataset.bound]=Number(el.value);
  if(el.id==='note-title')state.noteTitle=el.value;
  if(el.id==='note-body')state.noteBody=el.value;
  if(el.id==='ai-note')r.note=el.value;
  if(el.closest('#event-form')&&state.eventDraft){if(['title','location','date','kind'].includes(el.name))state.eventDraft[el.name]=el.value;else if(['start','end'].includes(el.name)&&el.value)state.eventDraft[el.name]=timeValue(el.value)}
});
document.addEventListener('change',e=>{
  const el=e.target,r=state.request;if(!r)return;
  if(el.dataset.pref)r.preferences[el.dataset.pref]=el.checked;
  if(el.dataset.day!==undefined){const d=Number(el.dataset.day);r.allowedDays=el.checked?[...r.allowedDays,d].sort():r.allowedDays.filter(x=>x!==d);el.nextElementSibling.textContent=(el.checked?'✓ ':'')+dayNames[d]}
  if(['earliestStart','latestEnd'].includes(el.id))r[el.id]=Number(el.value);
  if(el.id==='daily-limit')r.maxCoursesPerDay=el.value?Number(el.value):null;
  if(el.dataset.exclude){const id=el.dataset.exclude;r.excludedCourseIds=el.checked?[...new Set([...r.excludedCourseIds,id])]:r.excludedCourseIds.filter(x=>x!==id);if(el.checked)r.requiredCourseIds=r.requiredCourseIds.filter(x=>x!==id);$('course-list').innerHTML=courseList();$('selection-summary').textContent=selectionSummary()}
  if(el.dataset.completed){if(el.checked)state.completed.add(el.dataset.completed);else state.completed.delete(el.dataset.completed);state.careerPicked=null;const open=el.closest('details')?.open;render();if(open)document.querySelector('details').open=true}
  if(el.id==='calendar-date'&&el.value){state.selectedDate=el.value;render()}
});
document.addEventListener('submit',e=>{
  e.preventDefault();if(e.target.id==='semester-form'){
    try{const f=new FormData(e.target);store.setSemester(current(),String(f.get('start')),String(f.get('end')));const today=koreanToday();state.selectedDate=today>=f.get('start')&&today<=f.get('end')?today:String(f.get('start'));closeDialog();go('saved');flash('시간표와 학기 일정을 저장했어요.')}catch(error){$('semester-error').textContent=error.message}
  }else if(e.target.id==='event-form')saveEvent();else if(e.target.id==='record-form')act('save-record',e.target);
});
window.addEventListener('hashchange',()=>{if(state.request)routeChanged()});
let resizeFrame;
window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>layoutTabs())});
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{if(event.matches)document.getAnimations().forEach(animation=>animation.cancel())});
async function init(){
  try{
    const meta=await api('meta');state.courses=meta.courses;state.request=structuredClone(meta.defaultRequest);
    Object.assign(state.request,{requiredCourseIds:['ds','algo','db'],allowedDays:[0,1,2,3],earliestStart:600,credits:{total:{min:13,max:13},major:{min:9,max:9},general:{min:4,max:4}}});
    routeChanged();if(store.readError)flash(store.readError,true);
  }catch(error){state.error=error.message;state.route='error';render()}
}
init();
