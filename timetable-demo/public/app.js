import {groupCareerCourses,toggleRequiredCourse} from './career-model.mjs';
import {createProgramStore} from './program-model.mjs';
import {programView} from './program-ui.js';
import {hardConditions,updateHardCondition,relaxationDialog,relaxationPolicy,changesNotice,emptyGuidanceView} from './solver-ui.js';
import {createPlannerStore} from './planner.js';
import {calendarEvents} from './calendar-logic.mjs';
import {calendarDateLabel,calendarPeriodLabel,calendarViews,calendarWeekBounds,eventKindLabel,koreanDate,stepCalendarDate,toCalendarEvents} from './calendar-display.mjs';
import {highlightCalendarDate,mountCalendar} from './calendar-view.js';
import {setupLms} from './lms.js';
import {lmsTimeLabel} from './lms-calendar.mjs';
import {kindLabels,exportCalendar,addDays,koreanToday,sectionLocation,timeText,timeValue} from './planner-core.mjs';
import {esc,icon,button,link,heading,info,field,toggle,tabs,footer,timetable,miniWeek,layoutTimetables,layoutTabs,animateElements,dayNames,longestDay,courseColor,duration} from './ui.js';
import {courseCompatibilityNotice,candidateTravelNotice} from './timetable-warning-ui.js';
import {evaluateCourseTimes} from './course-times.mjs';
import {courseFilterControls,selectedCourseTimes} from './course-flow-ui.js';
import {courseFilterOptions,matchesCourseFilters} from './course-filters.mjs';
import {courseCreditPlan,defaultCreditRanges,selectedCredits} from './course-credits.mjs';

const $=id=>document.getElementById(id);
const emptyCourseFilters=()=>({completion:[],credits:[],years:[]});
const store=createPlannerStore({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)});
const programStore=createProgramStore({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)});
const state={
  user:null,
  courses:[],catalogInfo:{},catalogBusy:false,request:null,options:[],active:0,query:'',kind:'major',showAll:false,route:'start',
  courseFilters:emptyCourseFilters(),creditChoice:{mode:'auto'},creditFeedback:{},
  careerGoal:store.data.careerRecommendations?.goal||'',careerBusy:false,selectedDate:koreanToday(),selectedMinute:null,
  programGoal:programStore.list?.goal||store.data.careerRecommendations?.goal||'',programBusy:false,programLoading:false,programMeta:null,programError:'',programUpcoming:programStore.list?.includeUpcoming||false,
  calendarMode:'week',showCalendarClasses:true,eventOriginal:null,eventDraft:null,error:'',diagnostics:[],busy:false,controller:null,
  hoverCourseId:null,source:'rules',aiStatus:null,aiMessage:'',noteTitle:'',noteBody:'',lastMode:'rules',resultRequest:null,interpretation:null,lmsCalendar:null,emptyGuidance:null
};
let toastTimer,pollTimer,requestVersion=0,lmsReady=false,pendingCalendar=null,calendarWidget=null;
let courseTimeCheck=null;
const allEvents=()=>[...calendarEvents(store.data.events),...(state.lmsCalendar?.events||[])];
const calendarOptions=()=>({externalEvents:state.lmsCalendar?.events||[]});
const titles={start:'캠퍼스 시간표',courses:'과목 담기',preferences:'생활 패턴',advanced:'세부 조건',results:'추천 비교',saved:'내 시간표',career:'희망진로 검색','career-list':'진로 추천 과목',programs:'비교과 프로그램',calendar:'학기 캘린더',export:'캘린더 내보내기',experience:'수강 경험',record:'나의 수강 기록',empty:'추천 결과',loading:'시간표 찾는 중',error:'연결 확인',ai:'AI에게 요청하기',login:'계정'};
// The same four destinations appear as the desktop top bar and the mobile tab bar.
const navGroups=[
  ['home','홈','home',['start','saved']],
  ['courses','시간표 만들기','build',['courses','preferences','advanced','results','ai','loading','empty','error']],
  ['career','진로','career',['career','career-list','programs','experience','record']],
  ['calendar','캘린더','calendar',['calendar','export']]
];
// Destinations reached from the main navigation; on desktop they need no back bar.
const topLevelRoutes=new Set(['start','saved','calendar','career','career-list','programs','login']);
const tabRoutes=new Set(['start','saved','career','career-list','programs','calendar','export','experience','record']);
function navHref(key){
  if(key==='home')return store.data.semester?'saved':'start';
  if(key==='career')return state.request&&careerList()?'career-list':'career';
  return key;
}
function termLabel(term){const m=/^(\d{4})-(.+?)(?:학기)?$/.exec(term||'');return m?m[1]+'년 '+m[2]+'학기':term||''}
function current(){return state.options[state.active]}
const scopeStorageKey='ssu-timetable-catalog-scope';
function careerList(request=state.request){const list=store.data.careerRecommendations;return list&&list.term===request.term&&list.department===request.department&&list.catalogVersion===request.catalogVersion&&(list.source!=='course-evidence-ai'||list.careerDataVersion===state.catalogInfo.careerDataVersion)?list:null}
function catalogControls(){
  const info=state.catalogInfo;if(!info.terms?.length)return '';
  const disabled=state.catalogBusy||state.careerBusy?'disabled':'';
  return '<section class="catalog-controls" aria-label="강좌 자료 선택">'+
    '<label><span class="sr-only">학기</span><select id="catalog-term" '+disabled+'>'+info.terms.map(term=>'<option value="'+esc(term)+'" '+(term===state.request.term?'selected':'')+'>'+esc(term)+'</option>').join('')+'</select></label>'+
    '<label><span class="sr-only">학과</span><select id="catalog-department" '+disabled+'>'+info.departments.map(department=>'<option '+(department===state.request.department?'selected':'')+'>'+esc(department)+'</option>').join('')+'</select></label>'+
    '<details class="catalog-notice"><summary aria-label="강좌 자료 안내">'+icon('info')+'</summary><small>'+esc(info.notice)+(info.selectedUnavailableSectionCount?' 시간 미등록·확인 필요 '+info.selectedUnavailableSectionCount+'개 분반은 자동 조합에서 제외해요.':'')+' 교양은 전체 목록이며 수강대상은 분반 상세에서 확인해 주세요.</small></details>'+
    '<p class="catalog-count sr-only" role="status">'+(state.catalogBusy?'강좌를 불러오는 중…':'전공 '+info.majorCount+' · 교양 '+info.generalCount+'과목')+'</p></section>';
}
async function changeCatalog(scope){
  if(state.catalogBusy||state.careerBusy)return;
  state.catalogBusy=true;render();
  try{
    const meta=await api('meta?'+new URLSearchParams(scope));
    state.courses=meta.courses;state.catalogInfo=meta.catalogInfo;
    Object.assign(state.request,scope,{requiredCourseIds:[],preferredCourseIds:[],excludedCourseIds:[],lockedSectionIds:[],excludedSectionIds:[],catalogVersion:meta.defaultRequest.catalogVersion});
    state.options=[];state.resultRequest=null;state.retryPayload=null;state.interpretation=null;state.solver=null;state.emptyGuidance=null;state.query='';state.showAll=false;state.courseFilters=emptyCourseFilters();
    syncCreditPlan();
    try{localStorage.setItem(scopeStorageKey,JSON.stringify(scope))}catch{flash('학기·학과 선택을 브라우저에 저장하지 못했어요.',true)}
    flash('학기·학과를 변경했어요. 듣고 싶은 과목을 다시 선택해 주세요.');
  }catch(error){flash(error.message,true)}finally{state.catalogBusy=false;render()}
}
function semesterLabel(){const start=store.data.semester?.start||koreanToday();return start.slice(0,4)+'년 '+(Number(start.slice(5,7))<=6?'1':'2')+'학기'}
function flash(text,error=false){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').className='toast'+(error?' error':'');$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5500)}
function go(route){if(location.hash==='#'+route){state.route=route;render()}else location.hash=route}
function back(){go(({courses:'start',preferences:'courses',advanced:'preferences',results:'preferences',career:'start','career-list':'career',programs:'start',calendar:'saved',experience:'career',record:'experience',export:'calendar',ai:'preferences',empty:'preferences',loading:'preferences',error:'preferences',login:'start'})[state.route]||'saved')}
async function api(route,body,signal){
  const r=await fetch('/api/'+route,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Timetable-App':'1'},body:JSON.stringify(body)}),signal:signal||AbortSignal.timeout(20000)});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'잠시 뒤 다시 시도해 주세요.');return data;
}
function flowProgress(){
  const step={courses:0,preferences:1,advanced:1,loading:2,results:2}[state.route];
  return '<ol class="flow-progress" aria-label="시간표 만들기 단계">'+[['courses','과목 담기'],['preferences','생활 패턴'],['results','추천 비교']].map(([route,label],i)=>{
    const content='<span class="flow-number" aria-hidden="true">'+(i<step?icon('check'):i+1)+'</span><span class="flow-label">'+label+'</span>';
    const reachable=i!==step&&(route!=='results'||state.options.length>0);
    return '<li class="'+(i===step?'current':i<step?'complete':'')+'">'+(reachable?'<button type="button" class="flow-step" data-action="step" data-value="'+route+'">'+content+'</button>':'<span class="flow-step" '+(i===step?'aria-current="step"':'')+'>'+content+'</span>')+'</li>';
  }).join('')+'</ol>';
}
const body=(content,cls='')=>'<div class="screen-body '+cls+'">'+content+'</div>';
// App bar: back, where you are, and at most one icon action. On PC it only appears inside a flow.
function renderHeader(){
  const route=state.route,step=({courses:1,preferences:2,advanced:2,loading:3,results:3})[route];
  const backButton=!['start','saved','career','career-list','programs','calendar'].includes(route)?button(icon('back'),'back','icon-button','aria-label="이전 화면"'):'';
  const extra=step?'<span class="step-label">'+step+' / 3</span>':
    route==='saved'?link(icon('refresh'),state.options.length?'results':'preferences','icon-button','aria-label="추천안 다시 비교"')+link(icon('download'),'export','icon-button','aria-label="캘린더 파일 내보내기"')+button(icon('plus'),'new','icon-button','aria-label="새 시간표 만들기"'):
    ['start','career','career-list','programs','calendar'].includes(route)?link(icon('user'),'login','icon-button','aria-label="'+(state.user?'계정':'LMS 로그인')+'"'):'';
  return '<header class="mobile-header'+(step?' flow-header':'')+'">'+backButton+'<span class="page-name">'+(route==='start'?brandMark:'')+titles[route]+'</span>'+(step?flowProgress():'')+extra+'</header>';
}
const brandMark='<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="10.5" fill="#20c5a0"/><rect x="6.5" y="7.5" width="5.5" height="10" rx="2" fill="#06231c"/><rect x="13.25" y="12" width="5.5" height="12.5" rx="2" fill="#fff"/><rect x="20" y="7.5" width="5.5" height="6" rx="2" fill="#06231c"/><rect x="20" y="15" width="5.5" height="9.5" rx="2" fill="#06231c"/></svg>';
// PC navigation is a slim rail: the mark, four destinations, the account.
function sidebar(){
  return '<aside class="sidebar"><a class="brand" href="#'+navHref('home')+'" aria-label="캠퍼스 시간표 홈">'+brandMark+'</a>'+
    '<nav class="side-nav" aria-label="주 메뉴">'+navGroups.map(([key,label,name,routes])=>'<a href="#'+navHref(key)+'" '+(routes.includes(state.route)?'aria-current="page"':'')+'>'+icon(name)+'<span>'+(key==='courses'?'만들기':label)+'</span></a>').join('')+'</nav>'+
    userBar()+'</aside>';
}
function tabbar(){
  if(!tabRoutes.has(state.route))return '';
  return '<nav class="bottom-nav" aria-label="주 메뉴">'+navGroups.map(([key,label,name,routes])=>'<a href="#'+navHref(key)+'" '+(routes.includes(state.route)?'aria-current="page"':'')+'>'+icon(name)+'<span>'+(key==='courses'?'만들기':label)+'</span></a>').join('')+'</nav>';
}
// The example week reuses the real grid so the first screen shows the actual result format.
const sampleWeek={sections:[
  {courseId:'ds',name:'자료구조',meetings:[[0,540,630],[2,540,630]]},
  {courseId:'db',name:'데이터베이스',meetings:[[1,630,720],[3,630,720]]},
  {courseId:'algo',name:'알고리즘',meetings:[[0,780,870]]},
  {courseId:'media',name:'오픈소스기초설계',meetings:[[1,900,990]]},
  {courseId:'bible',name:'채플',meetings:[[3,780,840]]}
]};
function startView(){
  const r=state.request;
  return body(heading(esc(termLabel(r?.term)||'시간표'),esc(r?.department||''))+
    '<div class="welcome-action">'+link(icon('plus')+'<span>시간표 만들기</span>','courses','primary large')+link(icon('career')+'<span>진로로 찾기</span>','career','secondary large')+'</div>'+
    '<section class="start-week week-card" aria-label="예시 시간표" inert><span class="chip">예시</span><div class="week-grid">'+timetable(sampleWeek,'none')+'</div></section>'+
    '<nav class="shortcut-list" aria-label="바로가기">'+lmsShortcut()+'<a href="#programs">'+icon('award')+'<span>비교과 프로그램</span>'+icon('chevron')+'</a></nav>','start-body');
}
const dayList=meetings=>[...new Set(meetings.map(m=>m[0]))].sort().map(d=>dayNames[d]).join('·');
function courseList(){
  const r=state.request,q=state.query.trim().toLowerCase();
  const filtered=Object.values(state.courseFilters).some(values=>values.length);
  let list=state.courses.filter(c=>(state.kind==='all'||c.kind===state.kind)&&matchesCourseFilters(c,state.courseFilters)&&
    [c.name,c.topic,c.classification].join(' ').toLowerCase().includes(q));
  list.sort((a,b)=>Number(r.requiredCourseIds.includes(b.id))-Number(r.requiredCourseIds.includes(a.id))||Number(b.availableSectionCount!==0)-Number(a.availableSectionCount!==0));
  const count=list.length,expanded=state.showAll||Boolean(q)||filtered;
  if(!expanded)list=list.slice(0,8);
  return list.map(c=>{
    const selected=r.requiredCourseIds.includes(c.id),excluded=r.excludedCourseIds.includes(c.id),unavailable=c.availableSectionCount===0;
    const open=(c.offerings||[]).filter(o=>o.meetings?.length),first=open[0]?.meetings;
    const when=first?dayList(first)+' '+timeText(Math.min(...first.map(m=>m[1])))+(open.length>1?' 외 '+(open.length-1):''):'';
    const meta=[when,c.credits+'학점',open.length===1&&open[0].instructor,excluded&&'추천 제외'].filter(Boolean).map(esc).join(' · ');
    return '<button class="course-card '+(selected?'selected '+courseColor(c.id):'')+'" data-action="course" data-id="'+esc(c.id)+'" aria-pressed="'+selected+'" '+(unavailable||state.catalogBusy?'disabled':'')+'><span class="course-copy"><strong>'+esc(c.name)+(c.classification?'<span class="course-tag">'+esc(String(c.classification).split('-')[0])+'</span>':'')+'</strong><small>'+meta+'</small>'+(unavailable?'<small>'+esc((c.unavailableReasons||['강의시간 확인 필요']).join(', '))+'</small>':'')+'</span><span class="selection-mark" aria-hidden="true">'+icon(selected?'check':'plus')+'</span></button>';
  }).join('')+(count===0?'<p class="empty-copy">'+(filtered?'조건에 맞는 과목이 없어요.':'검색 결과가 없어요.')+'</p>':'')+(!expanded&&count>8?button('<span>'+(count-8)+'개 더 보기</span>'+icon('down'),'more-courses','quiet'):'');
}
function selectionSummary(){
  const {count,total}=selectedCredits(state.courses,state.request.requiredCourseIds);
  return count?count+'과목 · '+total+'학점':'담은 과목 없음';
}
function syncCreditPlan(commitGoal=true){
  const request=state.request,choice=state.creditChoice;
  const selected=selectedCredits(state.courses,request.requiredCourseIds);
  state.creditFeedback=courseCreditPlan(selected,choice,request.credits);
  const {ranges,raisedTo}=state.creditFeedback;
  if(ranges)request.credits=ranges;
  if(commitGoal&&raisedTo!==undefined){
    state.creditChoice={mode:'goal',value:raisedTo,raisedFrom:choice.raisedFrom??choice.value};
  }
}
function toggleCourseSelection(id){
  state.request=toggleRequiredCourse(state.request,id);
  syncCreditPlan();
  render();
}
function renderSelectedCourseTimes(){
  renderWeekPreview();
  const preview=$('selected-course-times');
  if(!preview)return;
  const open=new Set([...preview.querySelectorAll('details[open]')].map(detail=>detail.dataset.courseTime));
  preview.innerHTML=selectedCourseTimes(courseTimeCheck,state.request,open);
}
function renderCourseTimeChecks(){
  const region=$('course-time-check'),result=courseTimeCheck?.result;
  if(region){
    region.dataset.status=result?.status??(courseTimeCheck?'pending':'idle');
    region.innerHTML=courseCompatibilityNotice(result,state.request.requiredCourseIds);
    $('course-time-shortcut').innerHTML=result?.status==='conflict'
      ? button('시간 충돌 확인','show-course-conflict','course-time-shortcut') : '';
  }
  const status=$('course-time-status');
  if(status){
    const key=result?.status??(courseTimeCheck?'pending':'idle');
    status.dataset.status=key;
    status.textContent={pending:'확인 중',compatible:'겹침 없음',conflict:'시간 겹침',unavailable:'가능한 분반 없음',unknown:'일부 시간 미확인',error:'확인 실패'}[key]??'';
  }
  renderSelectedCourseTimes();
}
function syncCourseCompatibility(){
  const request=['courses','preferences','advanced'].includes(state.route)&&!state.catalogBusy?state.request:null;
  if(!request||(!request.requiredCourseIds.length&&!request.lockedSectionIds.length)){
    courseTimeCheck?.controller.abort();
    courseTimeCheck=null;
    return;
  }
  const {term,department,catalogVersion,requiredCourseIds,lockedSectionIds,excludedSectionIds}=request;
  const payload={term,department,catalogVersion,requiredCourseIds,lockedSectionIds,excludedSectionIds,includeSections:true};
  const key=JSON.stringify(payload);
  if(courseTimeCheck?.key===key){renderCourseTimeChecks();return}
  courseTimeCheck?.controller.abort();
  const check={key,controller:new AbortController(),result:null};
  courseTimeCheck=check;
  renderCourseTimeChecks();
  api('course-compatibility',payload,AbortSignal.any([check.controller.signal,AbortSignal.timeout(5000)]))
    .catch(()=>({status:'error'}))
    .then(result=>{
      if(courseTimeCheck!==check)return;
      check.result=result;
      renderCourseTimeChecks();
    });
}
// Builder workspace: the step's controls beside the week they change; both stay on screen, only the panel scrolls.
function workspace(panel,week,actions,cls=''){
  return '<div class="workspace '+cls+'"><div class="workspace-panel">'+panel+'</div><div class="week-column"><section class="week-card" aria-label="내 한 주">'+week+'</section>'+(cls?'':'<div id="course-time-check" role="status" tabindex="-1" data-status="idle"></div>')+actions+'</div></div>';
}
function builderActions(action){
  return '<div class="week-actions"><p class="week-status"><span id="course-time-status" class="time-status" role="status"></span><span id="selection-summary">'+selectionSummary()+'</span></p><span id="course-time-shortcut"></span>'+action+'</div>';
}
function liveWeek(){
  const {total}=selectedCredits(state.courses,state.request.requiredCourseIds);
  return '<div class="week-card-head"><h2>내 한 주</h2><div class="credit-meter">'+icon('cap')+'<strong id="credit-meter-label">'+creditMeterLabel(total)+'</strong></div></div>'+
    '<div id="week-preview" class="week-preview">'+weekPreview()+'</div>';
}
// Sections come from the compatibility check when it has answered, and from the catalog until then, so a picked course shows at once.
let previewGroups=[];
const offeringGroup=c=>({course:{id:c.id,name:c.name},sections:(c.offerings||[]).map((o,i)=>({id:o.courseNumber||String(i),meetings:o.meetings||[],locations:[],eligible:true}))});
const overlaps=(a,b)=>a.meetings.some(([d,from,to])=>b.meetings.some(([d2,from2,to2])=>d===d2&&from<to2&&from2<to));
function weekPreview(){
  const r=state.request,result=courseTimeCheck?.result;
  if(result?.selected)previewGroups=result.selected;
  const known=new Map(previewGroups.map(g=>[g.course.id,g]));
  const groups=result?.selected??r.requiredCourseIds.map(id=>known.get(id)||offeringGroup(state.courses.find(c=>c.id===id)||{id,name:''}));
  const window=state.route==='courses'?null:r,sections=[];
  for(const g of evaluateCourseTimes(groups,window)){
    const fits=g.options.filter(o=>o.status==='matches'),usable=fits.length?fits:g.options.filter(o=>o.status==='outside');
    const teachers=new Map((state.courses.find(c=>c.id===g.course.id)?.offerings||[]).map(o=>[o.courseNumber,o.instructor]));
    usable.forEach((o,i)=>sections.push({courseId:g.course.id,name:g.course.name,meetings:o.meetings,locations:o.locations,
      variant:o.status==='outside'?'is-outside':usable.length>1?'is-option':'',
      note:o.status==='outside'?'조건 밖':usable.length>1?(teachers.get(o.courseNumber)||(i+1)+'분반'):''}));
  }
  const fixed=sections.filter(s=>!s.variant);
  for(const a of fixed)for(const b of fixed)if(a.courseId<b.courseId&&overlaps(a,b)){a.variant=b.variant='is-conflict';a.note=b.note='시간 겹침'}
  // Pointing at a course that is not picked yet shows where it would land.
  const hovered=state.route==='courses'&&!r.requiredCourseIds.includes(state.hoverCourseId)&&state.courses.find(c=>c.id===state.hoverCourseId);
  const lastHour=Math.max(1080,...sections.flatMap(s=>s.meetings.map(m=>Math.ceil(m[2]/60)*60)));
  let beyond='';
  if(hovered)for(const o of (hovered.offerings||[]).filter(o=>o.meetings?.length)){
    const inside=o.meetings.filter(m=>m[1]>=540&&m[2]<=lastHour),outside=o.meetings.filter(m=>!inside.includes(m));
    if(outside.length)beyond=dayList(outside)+' '+timeText(Math.min(...outside.map(m=>m[1])))+'–'+timeText(Math.max(...outside.map(m=>m[2])));
    if(!inside.length)continue;
    const ghost={courseId:hovered.id,name:hovered.name,meetings:inside,note:''};
    ghost.variant='is-preview'+(fixed.some(f=>overlaps(f,ghost))?' is-clash':'');sections.push(ghost);
  }
  const legend=[sections.some(s=>s.variant==='is-option')&&'<span class="legend-option">분반 후보</span>',sections.some(s=>s.variant==='is-outside')&&'<span class="legend-outside">조건 밖</span>',window&&'<span class="legend-off">수업 없는 시간</span>'].filter(Boolean).join('');
  const grid='<div class="week-grid">'+timetable({sections},'none',{window,empty:true})+'</div>';
  if(beyond)return grid+'<p class="week-legend"><span class="legend-beyond">'+esc(hovered.name)+' · '+esc(beyond)+'</span></p>';
  return (sections.length?grid:'<div class="week-empty">'+grid+'<p><span>'+(state.route==='courses'?'과목을 담으면 여기에 표시돼요':'담은 과목 없이 조건만으로 추천해요')+'</span></p></div>')+(legend?'<p class="week-legend">'+legend+'</p>':'');
}
// Only blocks that were not on the grid a moment ago animate in.
let shownBlocks=new Set();
function markBlocks(animate){
  const keys=new Set(),fresh=[];
  for(const block of document.querySelectorAll('#week-preview .class-block:not(.is-preview)')){
    const key=block.dataset.id+'|'+block.dataset.offset+'|'+[...block.parentElement.parentElement.children].indexOf(block.parentElement);
    keys.add(key);if(!shownBlocks.has(key))fresh.push(block);
  }
  if(animate)animateElements(fresh,{distance:0,duration:240,stagger:20,scale:.9});
  shownBlocks=keys;
}
function renderWeekPreview(){const el=$('week-preview');if(!el)return;el.innerHTML=weekPreview();layoutTimetables();markBlocks(true)}
function creditTarget(){const {min,max}=state.request.credits.total;return Number.isFinite(max)?max:Number.isFinite(min)?min:null}
function creditMeterLabel(total){return total+'학점'}
const stepLink=(label,route)=>link('<span>'+label+'</span>'+icon('arrow'),route,'primary');
function creditMeter(total){const target=creditTarget()||24;return '<progress id="credit-meter" max="'+target+'" value="'+Math.min(total,target)+'" aria-label="목표 학점 대비 담은 학점"></progress>'}
function coursesView(){
  const interests=state.request.preferredCourseIds.length?'<div class="interest-box"><strong>관심 과목</strong><div class="course-chips">'+state.request.preferredCourseIds.map(id=>button(esc(state.courses.find(c=>c.id===id)?.name)+' ×','remove-interest','interest-chip','data-id="'+id+'" aria-label="'+esc(state.courses.find(c=>c.id===id)?.name)+' 관심 해제"')).join('')+'</div></div>':'';
  return body(workspace('<div class="panel-head">'+heading('꼭 들을 과목')+catalogControls()+'</div>'+careerRequiredPanel()+
    '<div class="search-field">'+icon('search')+'<label class="sr-only" for="course-search">과목명으로 검색</label><input id="course-search" type="search" placeholder="과목명으로 검색" value="'+esc(state.query)+'"></div>'+
    tabs([['all','전체'],['major','전공'],['general','교양']],state.kind,'course-kind')+
    courseFilterControls(courseFilterOptions(state.courses),state.courseFilters,state.catalogBusy)+
    '<div id="course-list" class="course-list">'+courseList()+'</div>'+interests+
    '<div class="panel-links">'+link(icon('career')+'<span>진로 추천 과목에서 고르기</span>'+icon('chevron'),'career','row')+'</div>'+
    '<details class="disclosure"><summary>추천에서 제외할 과목</summary><div class="exclude-list">'+state.courses.map(c=>'<label><input type="checkbox" data-exclude="'+esc(c.id)+'" '+(state.request.excludedCourseIds.includes(c.id)?'checked':'')+'>'+esc(c.name)+'</label>').join('')+'</div></details>',
    liveWeek(),builderActions(stepLink('생활 패턴 정하기','preferences'))),'builder-body');
}
function timeOptions(value){return [...new Set([value,...Array.from({length:49},(_,i)=>i*30)])].sort((a,b)=>a-b).map(m=>'<option value="'+m+'" '+(m===value?'selected':'')+'>'+timeText(m)+'</option>').join('')}
const creditValue=value=>Number.isFinite(value)?value:'';
function creditRangesSummary(){
  const {total,major,general}=state.request.credits;
  const label=range=>!Number.isFinite(range.min)||!Number.isFinite(range.max)?'미입력':range.min===range.max?range.min:range.min+'~'+range.max;
  return (total.min!==total.max?'총 '+label(total)+' · ':'')+'전공 '+label(major)+' · 교양 '+label(general);
}
function creditFeedback(){
  return '<p id="credit-check" class="credit-feedback" role="status">'+esc(state.creditFeedback.message??'')+'</p>';
}
function updateCreditFeedback(){
  const summary=$('credit-ranges-summary'),recommendButton=$('recommend-timetable');
  if(summary)summary.textContent=creditRangesSummary();
  if(recommendButton)recommendButton.disabled=Boolean(state.creditFeedback.blocked);
  $('credit-check').textContent=state.creditFeedback.message??'';
  const meter=$('credit-meter');
  if(meter){
    const {total}=selectedCredits(state.courses,state.request.requiredCourseIds),target=creditTarget()||24;
    meter.max=target;meter.value=Math.min(total,target);$('credit-meter-label').textContent=creditMeterLabel(total);
  }
}
const prefRow=(name,label,control)=>'<div class="pref-row"><span class="pref-icon">'+icon(name)+'</span><div class="pref-main"><span class="pref-label">'+label+'</span>'+control+'</div></div>';
function preferencesView(){
  const r=state.request;
  const goal=state.creditChoice.mode==='goal'?state.creditChoice.value:r.credits.total.min;
  const courseTimes=r.requiredCourseIds.length||r.lockedSectionIds.length
    ? '<section class="selected-course-times" aria-labelledby="course-times-heading"><h2 id="course-times-heading">분반 시간</h2><div id="selected-course-times"></div></section>' : '';
  return body(workspace(heading('원하는 한 주')+
    '<div class="pref-list">'+
    prefRow('cap','<label for="target-credits">목표 학점</label>','<div class="credit-target">'+button(icon('minus'),'credit-step','stepper','data-value="-1" aria-label="학점 줄이기"')+'<input aria-describedby="credit-ranges-summary credit-check" id="target-credits" type="number" step="0.5" min="0.5" max="24" value="'+creditValue(goal)+'">'+button(icon('plus'),'credit-step','stepper','data-value="1" aria-label="학점 늘리기"')+'<span id="credit-ranges-summary">'+creditRangesSummary()+'</span></div>'+creditFeedback())+
    '<div class="pref-row" role="group" aria-labelledby="days-label"><span class="pref-icon">'+icon('calendar')+'</span><div class="pref-main"><span class="pref-label" id="days-label">등교 요일</span><div class="day-picker">'+dayNames.map((d,i)=>'<label><input type="checkbox" data-day="'+i+'" '+(r.allowedDays.includes(i)?'checked':'')+'><span>'+d+'</span></label>').join('')+'</div></div></div>'+
    prefRow('clock','수업 시간','<div class="time-range"><select id="earliestStart" aria-label="수업 시작 가능 시간">'+timeOptions(r.earliestStart)+'</select><span aria-hidden="true">–</span><select id="latestEnd" aria-label="수업 종료 한도">'+timeOptions(r.latestEnd)+'</select></div>')+
    '</div>'+courseTimes+
    '<div class="toggle-list">'+toggle('compact',icon('compact')+'공강 줄이기',r.preferences.compact)+toggle('lunch',icon('lunch')+'점심시간 확보',r.preferences.lunch)+'</div>'+
    '<div class="panel-links">'+link(icon('sliders')+'<span>더 세밀하게 설정하기</span>'+icon('chevron'),'advanced','row')+link(icon('chat')+'<span>문장으로 요청하기</span>'+icon('chevron'),'ai','row')+'</div>',
    liveWeek(),builderActions(button('추천 시간표 보기','recommend','primary','id="recommend-timetable" '+(state.creditFeedback.blocked?'disabled':'')))),'builder-body');
}
function creditFields(){return ['total','major','general'].map((k,i)=>'<div class="credit-range"><span>'+['총 학점','전공','교양'][i]+'</span>'+['min','max'].map((b,j)=>(j?'<span>~</span>':'')+'<input type="number" step="0.5" min="'+(k==='total'?0.5:0)+'" max="24" data-credit="'+k+'" data-bound="'+b+'" aria-label="'+['총 학점','전공','교양'][i]+(j?' 최대':' 최소')+'" value="'+creditValue(state.request.credits[k][b])+'">').join('')+'</div>').join('')}
function advancedView(){
  const r=state.request;
  return body(workspace(heading('세부 조건')+hardConditions(r)+
    field('하루 수업량','<select id="daily-limit">'+[null,2,3,4,5,6].map(n=>'<option value="'+(n??'')+'" '+(n===r.maxCoursesPerDay?'selected':'')+'>'+(n?'하루 최대 '+n+'과목':'상관없음')+'</option>').join('')+'</select>')+
    '<div class="toggle-list">'+toggle('breaks',icon('clock')+'연강 줄이기',r.preferences.breaks,'수업 사이 30분 이상')+
    toggle('lunch',icon('lunch')+'점심시간 확보',r.preferences.lunch,'12–14시 중 1시간')+
    toggle('fewDays',icon('calendar')+'등교일 줄이기',r.preferences.fewDays)+toggle('late',icon('sun')+'오전 수업 피하기',r.preferences.late)+toggle('friday',icon('moon')+'금요일 공강',r.preferences.friday)+toggle('travel',icon('walk')+'건물 이동 줄이기',r.preferences.travel)+'</div>'+
    '<div><details class="disclosure"><summary>학점 범위 직접 설정</summary><div class="stack compact">'+creditFields()+'<small>같은 숫자를 넣으면 정확히 맞춰요.</small></div></details>'+creditFeedback()+'</div>',
    liveWeek(),builderActions(stepLink('선호 저장하기','preferences'))),'builder-body');
}
const optionFigures=[['등교일 적게',o=>o.metrics.days],['공강 짧게',o=>o.metrics.gapMinutes],['하루 수업 짧게',longestDay]];
function optionName(c){
  if(/^AI/.test(c.strategy||''))return c.strategy;
  const win=optionFigures.find(([,value])=>state.options.every(o=>o===c||value(c)<value(o)));
  return win&&state.options.length>1?win[0]:'추천 '+('ABCDE'[state.options.indexOf(c)]||'');
}
// Each option is shown as its own small week, so the choice is made by looking, not by reading.
function comparisonCard(c,i){
  return '<button class="comparison-card '+(i===state.active?'selected':'')+'" data-action="candidate" data-value="'+i+'" aria-pressed="'+(i===state.active)+'">'+
    miniWeek(c.sections,{days:Math.max(5,...c.sections.flatMap(s=>s.meetings.map(m=>m[0]+1)))})+
    '<span class="comparison-copy"><span class="comparison-card-title"><span class="option-letter" aria-hidden="true">'+('ABCDE'[i]||i+1)+'</span><strong>'+esc(optionName(c))+'</strong>'+(i===state.active?icon('check'):'')+'</span>'+
    '<span class="comparison-stats">'+[['calendar',o=>o.metrics.days,v=>'주 '+v+'일'],['clock',longestDay,v=>'하루 최대 '+duration(v)],['compact',o=>o.metrics.gapMinutes,v=>'공강 '+duration(v)]].map(([name,value,text])=>
      '<span'+(state.options.some(o=>value(o)!==value(c))?' class="differs"':'')+'>'+icon(name)+text(value(c))+'</span>').join('')+'</span></span></button>';
}
function resultsView(){
  const c=current();if(!c)return emptyView();
  const applied=structuredClone(state.resultRequest||state.request);
  if(c.solverResult?.effective_constraints)applied.credits.total=c.solverResult.effective_constraints.credits;
  const earliest=Math.min(...c.sections.flatMap(s=>s.meetings.map(m=>m[1])));
  const flags=['필수 '+applied.requiredCourseIds.length+'과목',!c.metrics.dayList.includes(4)&&'금요일 공강'].filter(Boolean);
  const letter='ABCDE'[state.active]||state.active+1;
  const kept=[applied.requiredCourseIds.map(id=>esc(state.courses.find(c=>c.id===id)?.name)).join(', ')||'수업 시간 겹침 없음',(applied.credits.total.min===applied.credits.total.max?applied.credits.total.min:applied.credits.total.min+'–'+applied.credits.total.max)+'학점',timeText(applied.earliestStart)+' 이후 수업'];
  const panel=heading('추천 시간표')+
    '<div class="comparison-list">'+state.options.map(comparisonCard).join('')+'</div>'+
    '<section class="criteria" aria-label="모든 추천안에서 지킨 조건"><h2>지킨 조건</h2><ul>'+kept.map(text=>'<li>'+icon('check')+'<span>'+text+'</span></li>').join('')+'</ul></section>'+
    '<div class="panel-links">'+link(icon('sliders')+'<span>조건 다시 조정하기</span>'+icon('chevron'),'preferences','row')+'</div>';
  const week='<div class="week-card-head"><h2><span class="option-letter" aria-hidden="true">'+letter+'</span>'+esc(optionName(c))+'</h2><p class="fact-row"><span>'+icon('cap')+c.credits+'학점</span><span>'+icon('sun')+'첫 수업 '+timeText(earliest)+'</span></p></div>'+
    candidateTravelNotice(c.sections)+'<div class="week-preview timetable-surface"><div class="week-grid">'+timetable(c)+'</div></div>'+changesNotice(c)+
    '<div class="recommendation-reason"><p class="accent-text">'+flags.map(f=>'<span>'+icon('check')+f+'</span>').join('')+'</p>'+(c.metrics.lunchMissedDays?'<small>점심 1시간을 확보하지 못한 날이 '+c.metrics.lunchMissedDays+'일 있어요.</small>':'')+'</div>'+
    '<details class="disclosure"><summary>과목과 추천 이유</summary>'+(c.careerAssessment?'<p>희망 진로: '+esc(c.careerAssessment.goal)+'</p><small>'+esc(c.careerAssessment.notice)+'</small>':'')+'<p>'+esc(c.aiReason||'필수 조건을 지킨 유효 후보 중 서로 다른 시간표를 골랐어요.')+'</p>'+c.sections.map(s=>'<p>'+esc(s.name)+' · '+s.credits+'학점'+(c.careerAssessment?.evaluations.find(e=>e.courseId===s.courseId&&e.relevance!=='uncertain')?'<br>'+esc(c.careerAssessment.evaluations.find(e=>e.courseId===s.courseId).reason):'')+'</p>').join('')+'<p>'+esc(c.solverResult?.ranking_proven?'선택한 기준에서 우선순위를 확인한 결과예요.':'시간 안에 찾은 결과예요. 더 좋은 조합이 있을 수 있어요.')+'</p>'+'<p>적용 조건: '+applied.allowedDays.map(d=>dayNames[d]).join('·')+' / '+timeText(applied.earliestStart)+'–'+timeText(applied.latestEnd)+' / 총 '+applied.credits.total.min+'–'+applied.credits.total.max+'학점</p>'+(state.interpretation?.summary?'<p>'+esc(state.interpretation.summary)+'</p>':'')+(state.interpretation?.unsupported?.length?'<p>반영하지 못한 요청: '+state.interpretation.unsupported.map(esc).join(', ')+'</p>':'')+'<small>'+esc(state.catalogInfo.notice||'')+'</small></details>';
  return body(workspace(panel,week,'<div class="week-actions">'+button(icon('bookmark')+'<span>이 시간표 저장</span>','confirm')+'</div>','results-workspace'),'builder-body');
}
function plannerGrid(content,{id,label,mode='week',guide=false}){
  return '<div class="planner-grid-frame" data-mode="'+mode+'">'+(guide?'<p class="planner-grid-guide">↔ 좌우로 밀기</p>':'')+
    '<div id="'+id+'" class="planner-grid-scroll" role="region" aria-label="'+label+'" '+(mode==='week'?'tabindex="0"':'')+'>'+content+'</div></div>';
}
const koreanMinute=()=>timeValue(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()));
function relativeDay(date,today){return date===today?'오늘':date===addDays(today,1)?'내일':calendarDateLabel(date)}
// Home after saving: what is next, then the week with a line at the current time, then what is due.
function savedView(){
  const c=store.data.semester?.candidate;
  if(!c)return body(heading('저장한 시간표가 없어요')+'<div class="inline-actions">'+link(icon('plus')+'<span>시간표 만들기</span>','courses','primary')+'</div>','narrow');
  const today=koreanToday(),now=koreanMinute(),weekdayIndex=(new Date(today+'T00:00:00Z').getUTCDay()+6)%7,weekday=dayNames[weekdayIndex];
  const active=calendarEvents(store.data.events).filter(e=>e.status==='active');
  const todayClasses=active.filter(e=>e.date===today&&e.kind==='class').length;
  const next=active.filter(e=>e.date>today||(e.date===today&&e.end>now)).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start)[0];
  const first=c.sections[0];
  const agenda=allEvents().filter(e=>e.kind!=='class'&&(e.status??'active')==='active'&&e.date>=today).sort((a,b)=>a.date.localeCompare(b.date)||(a.start??0)-(b.start??0)).slice(0,5);
  const grid=plannerGrid(timetable(c,'section',{fullDetails:true,now:{day:weekdayIndex,minute:now}}),{id:'saved-grid-scroll',label:'주간 시간표'});
  const minutesLeft=next&&next.date===today?next.start-now:null;
  const nextLabel=next?(next.date===today?(minutesLeft>0&&minutesLeft<180?minutesLeft+'분 뒤':'오늘'):relativeDay(next.date,today)):'';
  const nextCard=next?
    '<button class="next-class '+(next.courseId?courseColor(next.courseId):'')+'" data-action="open-event" data-id="'+esc(next.id)+'"><span class="next-dot" aria-hidden="true"></span><span class="next-copy"><span class="next-when">다음 수업 · '+esc(nextLabel)+'</span><strong>'+esc(next.title)+'</strong><span class="next-meta"><span>'+icon('clock')+timeText(next.start)+'–'+timeText(next.end)+'</span>'+(next.location?'<span>'+icon('pin')+esc(next.location)+'</span>':'')+'</span></span>'+icon('chevron')+'</button>':
    '<button class="next-class '+courseColor(first.courseId)+'" data-action="section" data-id="'+esc(first.courseId)+'"><span class="next-dot" aria-hidden="true"></span><span class="next-copy"><strong>'+esc(first.name)+'</strong></span>'+icon('chevron')+'</button>';
  const days=c.metrics?.days??new Set(c.sections.flatMap(s=>s.meetings.map(m=>m[0]))).size;
  const weeklyMinutes=c.sections.flatMap(s=>s.meetings).reduce((sum,[,from,to])=>sum+to-from,0);
  const todayRows=active.filter(e=>e.date===today&&e.kind==='class').sort((a,b)=>a.start-b.start).map(e=>'<li><button class="agenda-row '+(e.courseId?courseColor(e.courseId):'')+'" data-action="open-event" data-id="'+esc(e.id)+'"><span class="next-dot" aria-hidden="true"></span><span><strong>'+esc(e.title)+(e.end<=now?'<span class="course-tag">종료</span>':'')+'</strong><small>'+esc([timeText(e.start)+'–'+timeText(e.end),e.location].filter(Boolean).join(' · '))+'</small></span></button></li>').join('');
  const rows=agenda.map(e=>'<li><button class="agenda-row" data-action="open-event" data-id="'+esc(e.id)+'"><span class="agenda-date '+(e.date===today?'today':'')+'">'+esc(relativeDay(e.date,today))+'</span><span><strong>'+esc(e.title)+'</strong><small>'+esc([e.source==='lms'?lmsTimeLabel(e):timeText(e.start),e.location].filter(Boolean).join(' · '))+'</small></span></button></li>').join('');
  return body('<div class="page-head"><div class="heading"><h1 tabindex="-1">'+(todayClasses?'오늘 수업 '+todayClasses+'개':weekday+'요일, 수업 없음')+'</h1><p>'+esc(calendarDateLabel(today))+' · '+semesterLabel()+'</p></div>'+
    '<div class="head-actions">'+link(icon('download')+'<span>내보내기</span>','export','secondary small')+link(icon('refresh')+'<span>다시 비교</span>',state.options.length?'results':'preferences','secondary small')+'</div></div>'+
    '<div class="saved-layout"><div class="schedule-main"><section class="week-card" aria-label="이번 주 시간표"><div class="week-card-head"><h2>이번 주</h2><p class="fact-row"><span>'+icon('cap')+c.credits+'학점</span><span>'+icon('layers')+c.sections.length+'과목</span><span>'+icon('calendar')+'주 '+days+'일</span><span>'+icon('clock')+duration(weeklyMinutes)+'</span></p></div>'+grid+'</section></div>'+
    '<aside class="saved-side">'+(todayRows?'<section class="agenda-card today-card"><h2>오늘</h2><ul class="agenda">'+todayRows+'</ul></section>':nextCard)+'<section class="agenda-card"><h2>다가오는 일정</h2>'+(rows?'<ul class="agenda">'+rows+'</ul>':'<p class="agenda-empty">'+icon('calendar')+'<span>일정 없음</span></p>')+'</section>'+
    link(icon('calendar')+'<span>학기 캘린더</span>'+icon('chevron'),'calendar','row')+'</aside></div>','wide-body');
}

function careerGroups(list,selectable=false){
  const groups=groupCareerCourses(list,selectable?state.courses.filter(c=>c.availableSectionCount!==0):state.courses,{selectable});
  return '<div class="career-columns">'+['major','general'].map(kind=>'<section><h2>'+({major:'전공',general:'교양'}[kind])+' '+groups[kind].length+'과목</h2><div>'+(groups[kind].map(c=>{
    const selected=state.request.requiredCourseIds.includes(c.id);
    const basis={description:'설명 기반',reference:'이전 과목 설명 참고',name:'과목명 기반'}[c.evidenceType]||'과목명 기반';
    const copy='<strong>'+esc(c.name)+'</strong><small>'+[c.department,c.credits!=null&&c.credits+'학점',c.relevance==='high'?'관련성 높음':'관련성 보통'].filter(Boolean).map(esc).join(', ')+'</small><small>'+basis+(!selectable&&list.source==='course-evidence-ai'?', '+(c.availableNow?'현재 선택 학기·학과에서 조회 가능':'현재 선택 학기·학과에서 연결 가능한 분반 없음'):'')+'</small><p>'+esc(c.reason)+'</p>';
    const sources=(c.sourceUrl||'').split(' ; ').filter(url=>/^https?:\/\//.test(url)).map(url=>'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">공식 원문 확인</a>').join(' · ');
    const detail=c.description&&!selectable?'<details><summary>과목 설명과 출처 보기</summary><p>'+esc(c.description)+'</p><small>'+esc(c.sourceName||'')+' · '+esc(c.sourceYear||'연도 미표기')+'</small><p>'+sources+'</p>'+(c.evidenceType==='reference'?'<p>이전 과목의 참고 설명입니다. 현재 과목 자체의 확정 설명이 아닙니다.</p>':'')+(c.reviewNote?.includes('오탈자검수 보류')?'<p>원문 일부 표현은 확인이 필요합니다.</p>':'')+'</details>':'';
    return selectable?'<button type="button" class="course-card '+(selected?'selected':'')+'" data-action="career-required" data-id="'+esc(c.id)+'" aria-pressed="'+selected+'"><span>'+copy+'</span><span>'+(selected?'✓ 담김':'+ 꼭 듣기')+'</span></button>':'<article class="course-card"><div>'+copy+detail+'</div></article>';
  }).join('')||'<p>관련 과목을 찾지 못했어요. 관련성이 불분명한 과목은 표시하지 않습니다.</p>')+'</div></section>').join('')+'</div>';
}
function careerRequiredPanel(){
  const list=careerList();
  return list?'<details class="disclosure" open><summary>진로 추천 과목에서 꼭 들을 과목 고르기</summary><p>희망 진로: '+esc(list.goal)+'</p><p>누른 과목만 필수 포함합니다. 선택하지 않은 추천 과목에는 자동 우선순위를 주지 않아요.</p>'+careerGroups(list,true)+'</details>':'';
}
// The career hub: one goal, two kinds of answers (courses and extracurricular programs).
function careerTabs(active){
  return '<nav class="hub-tabs" aria-label="진로 메뉴">'+[['career-list','추천 과목','book'],['programs','비교과 프로그램','award']].map(([route,label,name])=>'<a href="#'+route+'" '+(route===active?'aria-current="page"':'')+'>'+icon(name)+label+'</a>').join('')+'</nav>';
}
function careerView(){
  return body(careerTabs('career-list')+'<div class="panel-head">'+heading('어떤 일을 하고 싶나요?')+catalogControls()+'</div>'+
    '<label class="sr-only" for="career-goal">희망 진로</label><textarea id="career-goal" maxlength="400" rows="3" placeholder="예: 컴퓨터비전 개발자가 되고 싶어요">'+esc(state.careerGoal)+'</textarea>'+
    '<div class="inline-actions">'+button(icon('search')+'<span>'+(state.careerBusy?'관련 과목을 찾는 중…':'관련 과목 찾기')+'</span>','career-evaluate','primary',state.careerBusy?'disabled':'')+link('저장된 추천 과목 보기','career-list','quiet')+'</div>'+
    '<p class="field-note">진로와 공개된 과목 정보만 AI에 전달해요. 수강 자격은 학교에서 확인해 주세요.</p>'+
    '<div class="panel-links">'+link(icon('award')+'<span>같은 진로로 비교과 찾기</span>'+icon('chevron'),'programs','row','data-action="program-from-career"')+link(icon('book')+'<span>수강 경험</span>'+icon('chevron'),'experience','row')+link(icon('chat')+'<span>AI 연결 설정</span>'+icon('chevron'),'ai','row')+'</div>','narrow');
}
function careerListView(){
  const list=careerList();
  return body(careerTabs('career-list')+heading('진로 추천 과목',list?'희망 진로: '+esc(list.goal):'이 학기와 학과에 저장된 추천 과목이 없어요.')+catalogControls()+
    '<div class="career-list-actions">'+link(icon('search')+'<span>다른 진로로 찾기</span>','career','secondary')+link(icon('plus')+'<span>이번 학기에 들을 과목 고르기</span>','courses','primary')+'</div>'+
    (list?(list.searchedCourseCount?'<p class="field-note">전체 '+list.searchedCourseCount+'과목 검색, 관련 후보 '+list.evaluatedCourseCount+'과목 검토</p>':'')+careerGroups(list)+'<small>'+esc(list.notice)+'</small>':'<p>희망 진로를 입력하면 전공과 교양 추천 목록이 여기에 저장돼요.</p><div class="inline-actions">'+link('희망진로 검색하기','career','primary')+'</div>')+
    '','career-list-body');
}

const calendarModes={week:'주간',month:'월간',day:'일간 목록'};
function canAddEvent(date){
  const semester=store.data.semester;
  return Boolean(semester&&date>=semester.start&&date<=semester.end);
}
const lmsShortcut=()=>state.user?'':'<a href="#login">'+icon('cap')+'<span>LMS 로그인</span>'+icon('chevron')+'</a>';
function calendarSemesterLabel(){return semesterLabel()+(state.lmsCalendar?' · LMS '+state.lmsCalendar.events.length+'개':'')}
function calendarView(){
  return body('<div class="planner-page-heading"><div class="heading"><h1 tabindex="-1">학기 캘린더</h1><p id="calendar-semester-label">'+calendarSemesterLabel()+'</p></div><div class="head-actions">'+link(icon('cap')+'<span>LMS</span>','login','secondary','id="calendar-lms"')+link(icon('download'),'export','icon-button outlined','aria-label="내보내기"')+'</div></div>'+
    '<section class="calendar-surface" aria-label="학기 일정 보기">'+
    '<div class="calendar-toolbar"><div class="calendar-mode" role="group" aria-label="캘린더 보기">'+
    Object.entries(calendarModes).map(([mode,label])=>button(label,'calendar-mode','quiet','data-value="'+mode+'" aria-pressed="'+(mode===state.calendarMode)+'"')).join('')+
    '</div>'+button(icon('plus')+'<span>일정 추가</span>','add-event','primary','id="calendar-add"')+'</div>'+
    '<div class="calendar-toolbar calendar-navigation"><div class="calendar-move" role="group" aria-label="날짜 이동">'+
    button(icon('back'),'calendar-step','icon-button','data-value="-1" aria-label="이전"')+
    button('오늘','calendar-today','quiet')+button(icon('chevron'),'calendar-step','icon-button','data-value="1" aria-label="다음"')+
    '</div><h2 id="calendar-period" aria-live="polite"></h2><label class="date-jump"><span class="sr-only">선택 날짜</span>'+
    '<input type="date" id="calendar-date" value="'+state.selectedDate+'"></label></div>'+
    '<label id="calendar-class-filter" hidden><input id="show-calendar-classes" type="checkbox" '+(state.showCalendarClasses?'checked':'')+'> 월간에 일반 수업 표시</label>'+
    plannerGrid('<div id="semester-calendar"></div>',{id:'calendar-grid-scroll',label:'학기 캘린더 격자',mode:state.calendarMode,guide:true})+
    '</section>','calendar-body');
}
function updateCalendarControls(){
  if(!$('calendar-date'))return;
  $('calendar-date').value=state.selectedDate;
  $('calendar-period').textContent=calendarPeriodLabel(state.selectedDate,state.calendarMode);
  $('semester-calendar').dataset.calendarView=state.calendarMode;
  $('calendar-grid-scroll').parentElement.dataset.mode=state.calendarMode;
  $('calendar-grid-scroll').tabIndex=state.calendarMode==='week'?0:-1;
  highlightCalendarDate($('semester-calendar'),state.selectedDate);revealSelectedDay();
  $('calendar-class-filter').hidden=state.calendarMode!=='month';
  $('calendar-add').disabled=!canAddEvent(state.selectedDate);
  $('calendar-add').title=$('calendar-add').disabled?'시간표를 저장한 학기 안에서 일정을 추가할 수 있어요.':'';
  for(const control of document.querySelectorAll('[data-action="calendar-mode"]')){
    control.setAttribute('aria-pressed',String(control.dataset.value===state.calendarMode));
  }
}
function setCalendarDate(date,{mode=state.calendarMode,minute}={}){
  if(date!==state.selectedDate)state.selectedMinute=null;
  if(Number.isInteger(minute))state.selectedMinute=minute;
  const changedMode=mode!==state.calendarMode;
  state.selectedDate=date;state.calendarMode=mode;
  updateCalendarControls();
  calendarWidget?.batchRendering(()=>{
    if(calendarWidget.view.type!==calendarViews[mode])calendarWidget.changeView(calendarViews[mode],date);
    else if(koreanDate(calendarWidget.getDate())!==date)calendarWidget.gotoDate(date);
    if(changedMode)calendarWidget.refetchEvents();
    syncCalendarWeekBounds();
  });
}
function syncCalendarWeekBounds(){
  if(state.calendarMode!=='week')return;
  for(const [key,value] of Object.entries(calendarWeekBounds(allEvents(),state.selectedDate))){
    if(calendarWidget.getOption(key)!==value)calendarWidget.setOption(key,value);
  }
}
function refreshCalendarEvents(){
  calendarWidget?.batchRendering(()=>{
    syncCalendarWeekBounds();
    calendarWidget.refetchEvents();
  });
}
function revealSelectedDay(){
  const scroll=$('calendar-grid-scroll'),cell=scroll?.querySelector('[data-calendar-header][data-calendar-selected]');
  if(cell&&scroll.scrollWidth>scroll.clientWidth)scroll.scrollLeft+=cell.getBoundingClientRect().left-scroll.getBoundingClientRect().left-scroll.clientWidth/3;
}
function mountSemesterCalendar(){
  updateCalendarControls();
  calendarWidget=mountCalendar($('semester-calendar'),{
    mode:state.calendarMode,date:state.selectedDate,
    weekBounds:calendarWeekBounds(allEvents(),state.selectedDate),
    selectedDate:()=>state.selectedDate,
    events:()=>toCalendarEvents(allEvents(),{showClasses:state.calendarMode!=='month'||state.showCalendarClasses}),
    onOpen:openEvent,
    onDay:date=>setCalendarDate(date,{mode:'day'}),
    onTime:(date,minute)=>{
      setCalendarDate(date,{minute});
      if(canAddEvent(date))addEvent();
    }
  });
  revealSelectedDay();
}
function eventEditor(){
  const d=state.eventDraft,original=state.eventOriginal,cancelled=original?.status==='cancelled';
  const kinds=original?(original.kind==='class'&&original.seriesId&&!original.retired&&!original.replacedBy?['class','exam']:[original.kind]):['personal','exam','makeup'];
  const sections=store.data.semester.candidate.sections;
  const courseOptions=sections.map(s=>'<option value="'+esc(s.courseId)+'" '+(d.courseId===s.courseId?'selected':'')+'>'+esc(s.name)+'</option>').join('');
  const makeupOptions=store.data.events.filter(e=>e.seriesId&&e.status==='cancelled').map(e=>
    '<option value="'+esc(e.id)+'" '+(d.originalEventId===e.id?'selected':'')+'>'+esc(e.title)+' · '+e.date+' '+timeText(e.start)+'</option>').join('');
  const linked=store.data.events.find(e=>e.id===original?.originalEventId);
  const related=linked?esc(linked.title)+' · '+calendarDateLabel(linked.date):esc(sections.find(s=>s.courseId===original?.courseId)?.name);
  const details=original?'<div class="event-editor-summary"><p><strong>'+esc(eventKindLabel(original))+'</strong>'+
    (related?' · '+(linked?(original.kind==='makeup'?'보강 대상 ':'원래 수업 '):'')+related:'')+'</p>'+
    '<p class="planner-event-name">'+esc(original.title)+'</p><p>'+calendarDateLabel(original.date)+' · '+timeText(original.start)+'–'+timeText(original.end)+'</p>'+
    (original.location?'<p>'+esc(original.location)+'</p>':'')+'</div>':'';
  const form=details+
    '<form id="event-form" class="stack">'+field('일정 이름','<input name="title" required maxlength="100" value="'+esc(d.title)+'">')+
    field('종류','<select name="kind">'+kinds.map(key=>'<option value="'+key+'" '+(key===d.kind?'selected':'')+'>'+(original?.kind==='class'&&key==='exam'?'이 수업을 대체하는 시험':kindLabels[key])+'</option>').join('')+'</select>')+
    (!original?'<div id="event-course" '+(d.kind==='personal'?'hidden':'')+'>'+field('관련 과목','<select name="courseId"><option value="">과목 선택</option>'+courseOptions+'</select>')+'</div>'+
      '<div id="makeup-original" '+(d.kind!=='makeup'?'hidden':'')+'>'+field('보강할 휴강 수업','<select name="originalEventId"><option value="">연결 없이 추가</option>'+makeupOptions+'</select>')+'</div>':'')+
    field('날짜','<input name="date" type="date" required min="'+store.data.semester.start+'" max="'+store.data.semester.end+'" value="'+esc(d.date)+'">')+
    '<div class="two-fields">'+field('시작','<input name="start" type="time" required value="'+esc(d.start)+'">')+field('종료','<input name="end" type="time" required value="'+esc(d.end)+'">')+'</div>'+
    field('장소','<input name="location" maxlength="100" placeholder="강의실 또는 약속 장소" value="'+esc(d.location)+'">')+
    (original?.seriesId&&!original.retired?'<fieldset class="scope-picker"><legend>변경 범위</legend><label><input type="radio" name="scope" value="one" '+(d.scope!=='future'?'checked':'')+'>이번 일정만</label><label><input type="radio" name="scope" value="future" '+(d.scope==='future'?'checked':'')+'>이후 같은 반복 수업도</label><small>같은 분반의 같은 요일 수업에 적용돼요.</small></fieldset>':'')+
    '</form>'+
    (original?'<div class="inline-actions">'+(cancelled?'':button('휴강 · 일정 취소','cancel-event','danger'))+
      (original.seriesId?button('원래 수업 정보로 복원','restore-event','quiet'):'')+'</div>':'');
  const primary=cancelled?(original.retired?'':button('일정 복원','resume-event','primary')):
    button(original?'변경 저장하기':'일정 저장하기','save-event');
  return plannerDialogContent('event-dialog-title',original?'일정 상세 및 편집':'일정 추가','close-event',form,
    '<p id="event-error" class="form-error" role="alert"></p>'+primary);
}
function exportView(){
  const semester=store.data.semester,active=allEvents().filter(e=>e.status==='active');
  return body(heading('익숙한 캘린더에서도 보기','이번 학기 일정을 .ics 파일로 받아 구글, 애플, 아웃룩 캘린더로 가져갈 수 있어요.')+
    '<div class="export-card">'+icon('download')+'<h2>'+semesterLabel()+' 일정</h2><p>일정 '+active.length+'개, .ics 파일</p>'+(semester?'<small>'+semester.start+' ~ '+semester.end+'</small>':'')+'</div>'+
    info('변경한 일정까지 함께','휴강과 취소한 일정은 빼고, 시험과 개인 일정은 넣어요.',icon('calendar'))+
    '<ol class="export-help"><li>아래 버튼으로 일정 파일을 저장해요.</li><li>쓰는 캘린더에서 가져오기를 선택해요.</li><li>저장한 .ics 파일을 고르면 끝이에요.</li></ol><small>가져간 뒤의 변경은 자동으로 동기화되지 않아요.</small>','narrow')+
    footer(active.length?button('캘린더 파일 다운로드','download'):link('LMS 일정 가져오기','calendar','primary'));
}
const exampleDefinitions=[
  {title:'전공의 기초를 단단하게',description:'자료구조와 알고리즘을 함께 살펴보는 조합',names:['자료구조','알고리즘'],color:'lime'},
  {title:'데이터와 친해지는 한 학기',description:'통계와 데이터베이스를 연결해 보는 조합',names:['통계','데이터베이스'],color:'lavender'},
  {title:'직접 만드는 경험을 더해요',description:'웹과 오픈소스 과목에 관심이 있다면',names:['웹','오픈소스'],color:'sky'}
];
function examples(){return exampleDefinitions.map(e=>({...e,ids:e.names.flatMap(name=>{const c=state.courses.find(c=>c.name.includes(name)&&c.availableSectionCount!==0);return c?[c.id]:[]})})).filter(e=>e.ids.length)}
function experienceView(){
  return body(heading('다른 조합도 살펴볼까요?','관심 있는 과목 조합을 내 조건에 적용해 보세요.')+
    '<p class="field-note">탐색용 가상 조합이에요. 실제 수강 후기가 아니에요.</p><div class="stack">'+examples().map((e,i)=>'<button class="experience-card card" data-action="example" data-value="'+i+'"><span class="experience-number '+e.color+'">'+(i+1)+'</span><span><strong>'+e.title+'</strong><small>'+e.description+'</small><span class="course-chips">'+e.ids.map(id=>'<span>'+esc(state.courses.find(c=>c.id===id)?.name)+'</span>').join('')+'</span></span>'+icon('chevron')+'</button>').join('')+'</div>'+
    '<div class="section-title"><h2>나의 수강 기록</h2>'+link('+ 기록','record','quiet')+'</div>'+(store.data.experiences.length?store.data.experiences.slice().reverse().map(e=>'<article class="card record-card"><strong>'+esc(e.title)+'</strong><p>'+esc(e.body)+'</p><small>'+e.courseNames.map(esc).join(', ')+'</small></article>').join(''):'<p class="muted">이번 시간표를 고른 이유를 남겨 보세요.</p>'),'narrow')+footer(link('내 시간표 기록하기','record','secondary'));
}
function recordView(){
  const c=store.data.semester?.candidate||current();
  return body(heading('이번 선택을 기록해요','다음 학기의 나에게 작은 힌트를 남겨요.')+
    info('나만 볼 수 있는 기록','이 브라우저에만 저장돼요.',icon('user'))+
    (c?'<div class="course-chips">'+c.sections.map(s=>'<span>'+esc(s.name)+'</span>').join('')+'</div>':'<p class="muted">먼저 추천 시간표를 선택해 주세요.</p>')+
    '<form id="record-form" class="stack">'+field('기록 제목','<input name="title" id="note-title" required maxlength="80" placeholder="이번 학기, 이렇게 골랐어요" value="'+esc(state.noteTitle)+'">')+
    field('이 조합을 고른 이유','<textarea name="body" id="note-body" required maxlength="600" rows="6" placeholder="수업을 고른 이유와 기대하는 점을 자유롭게 적어 보세요.">'+esc(state.noteBody)+'</textarea>')+'<p class="form-error" id="record-error" role="alert"></p></form>','narrow')+
    footer(button('내 기록 저장하기','save-record','primary',c?'':'disabled'),'다른 사람에게 공개되지 않아요');
}
function emptyView(){
  const infeasible=state.solver?.original_status==='INFEASIBLE';
  return body('<div class="state-illustration">'+icon('search')+'</div>'+
    heading(infeasible?'조건을 조금 바꿔 볼까요?':'조금 더 찾아볼까요?',infeasible?'지금 조건을 모두 지키는 시간표가 없어요. 무엇이 막는지와 바꿀 수 있는 조건을 정리했어요.':'시간 안에 결과를 찾지 못했어요. 다시 시도할 수 있어요.')+
    '<div class="card">'+state.diagnostics.map(d=>'<p>'+esc(d)+'</p>').join('')+'</div>'+
    (infeasible&&state.emptyGuidance?emptyGuidanceView(state.emptyGuidance):'')+
    '<div class="inline-actions">'+(infeasible&&state.lastMode!=='alternative'?button('허용할 변경 범위 고르기','relax-options','secondary'):button('다시 찾아보기','retry','secondary'))+'</div>','narrow')+
    footer(link('조건 조정하기','preferences','primary'));
}
// While the solver runs the screen already has the shape of the answer.
const skeletonWeek={sections:[['ds',[[0,600,690],[2,600,690]]],['db',[[1,630,750]]],['algo',[[3,660,750]]],['media',[[0,780,870],[2,780,870]]],['bible',[[1,840,930],[3,840,930]]],['ds',[[4,600,720]]]].map(([courseId,meetings])=>({courseId,name:'',meetings}))};
function loadingView(){
  return body(workspace(heading('추천 시간표 만드는 중')+'<div class="comparison-list" aria-hidden="true">'+'<div class="comparison-card skeleton-card"></div>'.repeat(3)+'</div>',
    '<div class="week-card-head"><h2>내 한 주</h2></div><div class="week-preview loading-week" role="progressbar" aria-label="추천 생성 중" inert><div class="week-grid">'+timetable(skeletonWeek,'none')+'</div></div>',
    '<div class="week-actions">'+link('취소','preferences','secondary')+'</div>','results-workspace loading-workspace'),'builder-body');
}
function errorView(){return body('<div class="state-illustration">'+icon('alert')+'</div>'+heading('추천을 불러오지 못했어요',esc(state.error||'다시 시도하거나 조건을 확인해 주세요.'))+info('입력한 조건은 그대로예요','설정을 바꾸지 않고 다시 시도할 수 있어요.',icon('check')),'narrow')+footer(button('다시 시도하기','retry')+link('조건 확인하기','preferences','secondary'))}
function aiView(){
  const s=state.aiStatus,waiting=s?.loginState==='waiting';
  return body(heading('말로 편하게 요청해요','원하는 요일, 학점, 관심 분야를 문장으로 알려 주세요.')+
    field('AI에게 요청할 내용','<textarea id="ai-note" maxlength="400" rows="5" placeholder="수요일만 등교하고 전공 6학점, 교양 2학점으로 골라줘.">'+esc(state.request.note)+'</textarea>')+
    '<div class="card ai-connection"><strong>'+(s?.connected?'Codex가 연결되어 있어요':waiting?'브라우저에서 연결을 마쳐 주세요':'Codex 계정 연결')+'</strong><p id="ai-status" role="status">'+esc(state.aiMessage||'본인의 계정으로 요청을 해석하고 추천 이유를 정리해요.')+'</p>'+(waiting?button('연결 취소','cancel-login','secondary'):button(s?.connected?'연결 확인':'Codex 연결','connect','secondary'))+'</div><small>요청에 따라 기존 학점, 요일, 필수 과목 조건이 바뀔 수 있어요. 결과의 적용 조건을 확인해 주세요.</small>','narrow')+
    footer(button('AI로 시간표 추천받기','recommend-ai','primary',s?.connected?'':'disabled')+button('현재 조건으로 기본 추천','recommend','secondary'));
}
function userBar(){
  const name=state.user?.name||'';
  return '<div class="account">'+(state.user?'<a class="avatar" href="#login" aria-label="계정'+(name?': '+esc(name):'')+'">'+(name?esc([...name][0]):icon('user'))+'</a>':link(icon('user'),'login','icon-button','aria-label="LMS 로그인"'))+'</div>';
}
// Signing up and signing in are the same act: logging in to the school LMS. The panel itself lives in index.html.
function loginView(){
  return body('<section class="auth-card"><p class="auth-brand">'+brandMark+'<span>캠퍼스 시간표</span></p><h1 class="sr-only" tabindex="-1">계정</h1><div id="lms-slot"></div></section>','narrow auth-body');
}

const views={start:startView,courses:coursesView,preferences:preferencesView,advanced:advancedView,results:resultsView,saved:savedView,career:careerView,'career-list':careerListView,calendar:calendarView,export:exportView,experience:experienceView,record:recordView,empty:emptyView,loading:loadingView,error:errorView,ai:aiView};
views.programs=()=>body(careerTabs('programs')+programView({goal:state.programGoal,busy:state.programBusy,loading:state.programLoading,meta:state.programMeta,error:state.programError,list:programStore.list,includeUpcoming:state.programUpcoming,storageError:programStore.error}),'program-body');
views.login=loginView;
function render(motion='none'){
  const sameRoute=$('content')?.dataset.route===state.route,focused=document.activeElement;
  const scroller=()=>document.querySelector('.workspace-panel')||document.querySelector('.screen-body');
  const scrollTop=sameRoute?scroller()?.scrollTop||0:0;
  const openDetails=sameRoute?[...document.querySelectorAll('main details')].map(el=>el.open):[];
  const focusSelector=sameRoute&&focused?.closest('#app')?(focused.id?'#'+CSS.escape(focused.id):focused.dataset.action?'[data-action="'+CSS.escape(focused.dataset.action)+'"]'+['id','value'].filter(k=>focused.dataset[k]!==undefined).map(k=>'[data-'+k+'="'+CSS.escape(focused.dataset[k])+'"]').join(''):null):null;
  const previousTabs=new Map([...document.querySelectorAll('[data-tabs]')].filter(el=>el.offsetWidth).map(el=>[el.dataset.tabs,el.querySelector('[aria-pressed="true"]')?.getBoundingClientRect()]));
  const content=(views[state.route]||startView)();
  // Keep the LMS controller and its controls alive across the app's route renders.
  const lmsHost=$('lms-panel-host');lmsHost.hidden=true;document.body.append(lmsHost);
  calendarWidget?.destroy();
  calendarWidget=null;
  const plannerScreen=(['saved','calendar'].includes(state.route)?' planner-screen':'')+(topLevelRoutes.has(state.route)?' top-level':'')+(['courses','preferences','advanced','results','loading'].includes(state.route)?' builder-screen':'');
  $('app').innerHTML='<div class="app-shell">'+sidebar()+'<main id="content" class="screen'+plannerScreen+'" data-route="'+state.route+'">'+renderHeader()+content+'</main>'+tabbar()+'</div>';
  syncCourseCompatibility();
  if($('lms-slot')){$('lms-slot').append(lmsHost);lmsHost.hidden=false}
  if($('semester-calendar'))mountSemesterCalendar();
  layoutTimetables();layoutTabs(sameRoute?previousTabs:new Map());markBlocks(sameRoute&&motion!=='page');
  if(sameRoute)document.querySelectorAll('main details').forEach((el,i)=>el.open=!!openDetails[i]);
  scroller()?.scrollTo(0,scrollTop);
  if(focusSelector){const matches=[...document.querySelectorAll(focusSelector)];matches.find(el=>el.offsetWidth)?.focus({preventScroll:true})}
  // One orchestrated moment on the first screen; elsewhere motion only answers the user's action.
  if(motion==='schedule')animateElements(document.querySelectorAll('.class-block'),{distance:8,duration:300,stagger:18,scale:.97});
  else if(motion==='list')animateElements(document.querySelectorAll('#course-list > .course-card'),{distance:6,duration:240,stagger:25});
}
// Depth decides the direction: deeper screens push in from the right, going back pops, sibling tabs fade through.
const routeDepth={start:0,saved:0,career:0,'career-list':0,programs:0,calendar:0,login:1,export:1,experience:1,record:2,courses:1,preferences:2,advanced:3,ai:3,loading:4,results:5,empty:5,error:5};
function navigationKind(from,to){
  if(!from||from===to)return null;
  const a=routeDepth[from]??0,b=routeDepth[to]??0;
  return a===b?'fade':b>a?'push':'pop';
}
function viewTransition(kind,update){
  if(!kind||!document.startViewTransition||window.matchMedia('(prefers-reduced-motion: reduce)').matches){update();return}
  const root=document.documentElement;root.dataset.nav=kind;
  document.startViewTransition(update).finished.finally(()=>{if(root.dataset.nav===kind)delete root.dataset.nav});
}
function routeChanged(){
  const route=location.hash.slice(1),next=views[route]?route:(store.data.semester?'saved':'start');
  if(state.busy&&next!=='loading'){state.controller?.abort();state.busy=false;requestVersion++}
  if($('event-dialog').open){closeDialog();closeEventEditor()}
  clearTimeout(pollTimer);
  const previous=$('content')?.dataset.route;state.route=next;
  if(route==='event'){go('calendar');return}
  if(next==='loading'&&!state.busy){go('preferences');return}
  viewTransition(navigationKind(previous,next),()=>{
    window.scrollTo(0,0);render('page');document.querySelector('h1')?.focus({preventScroll:true});
    if(next==='ai')checkConnection();
    if(next==='programs'){
      if(!state.programGoal)state.programGoal=state.careerGoal;
      refreshProgramMeta();
    }
  });
}
async function refreshProgramMeta(){
  if(state.programLoading)return;
  state.programLoading=true;state.programError='';if(state.route==='programs')render();
  try{state.programMeta=await api('programs/meta')}
  catch(error){state.programMeta=null;state.programError=error.message}
  finally{state.programLoading=false;if(state.route==='programs')render()}
}
setInterval(()=>{if(state.route==='programs'&&!state.programBusy)refreshProgramMeta()},60000);
async function recommend(mode='rules',payload){
  if(state.busy||state.catalogBusy)return;
  if((mode==='rules'||mode==='ai')&&state.creditFeedback.blocked){
    flash(state.creditFeedback.message,true);return;
  }
  state.emptyGuidance=null;
  state.lastMode=mode;if(payload)state.retryPayload=payload;else if(!['relax','alternative'].includes(mode))state.retryPayload=null;state.busy=true;const version=++requestVersion;state.controller=new AbortController();
  go('loading');
  const timeout=setTimeout(()=>state.controller?.abort(),mode==='ai'?240000:30000);
  try{
    const route=({ai:'recommend',relax:'relax',alternative:'alternatives'})[mode]||'candidates';
    const result=await api(route,payload||state.retryPayload||state.request,state.controller.signal);
    if(version!==requestVersion)return;
    if(!['relax','alternative'].includes(mode)){
      const previous=state.request;
      state.request=result.request;
      if(mode==='ai'&&(JSON.stringify(previous.credits)!==JSON.stringify(result.request.credits)||
        JSON.stringify([...previous.requiredCourseIds].sort())!==JSON.stringify(result.request.requiredCourseIds))){
        state.creditChoice={mode:'ranges'};
        syncCreditPlan();
      }
    }
    state.solver=result.solver;state.resultRequest=structuredClone(result.request);state.interpretation=result.interpretation||null;state.diagnostics=result.diagnostics||[];
    state.emptyGuidance=result.emptyGuidance??null;
    state.options=mode==='ai'&&result.recommendations?.length?result.recommendations.map((r,i)=>({...result.candidates.find(c=>c.id===r.id),strategy:'AI 추천 '+(i+1),aiReason:r.reason})):result.candidates;
    if(careerList(result.request))for(const c of state.options)c.careerAssessment=structuredClone(careerList(result.request));
    state.active=0;state.source=result.source||'rules';state.busy=false;go(state.options.length?'results':'empty');
    if(result.interpretation?.summary)flash(result.interpretation.summary);
  }catch(e){if(version!==requestVersion)return;state.busy=false;state.error=e.name==='AbortError'?'응답이 오래 걸리고 있어요. 잠시 뒤 다시 시도해 주세요.':e.message;go('error')}
  finally{clearTimeout(timeout)}
}
function plannerDialogContent(titleId,title,closeAction,content,actions=''){
  return '<div class="planner-dialog-panel"><div class="dialog-heading"><h2 id="'+titleId+'">'+esc(title)+'</h2>'+
    button(icon('close'),closeAction,'icon-button','aria-label="닫기"')+'</div><div class="planner-dialog-body">'+content+'</div>'+
    (actions?'<div class="planner-dialog-actions">'+actions+'</div>':'')+'</div>';
}
function dialog(content,{planner=false}={}){
  const modal=$('dialog');delete modal.dataset.lmsAccount;modal.classList.toggle('planner-dialog',planner);
  modal.innerHTML=content;if(!modal.open)modal.showModal();
}
function closeDialog(){pendingCalendar=null;$('dialog').close()}
function confirmSemester(){
  const today=koreanToday(),semester=store.data.semester;
  const term=current()?.requestSnapshot?.term||state.request.term;
  const savedTerm=semester?.candidate?.requestSnapshot?.term;
  if(savedTerm&&savedTerm!==term){flash('저장된 '+savedTerm+'학기와 다른 학기예요. 현재 브라우저는 한 학기 시간표를 저장하며 기존 일정은 유지합니다.',true);return}
  const start=semester?.start||term.slice(0,4)+(term.endsWith('-2')?'-09-01':'-03-02'),end=semester?.end||term.slice(0,4)+(term.endsWith('-2')?'-12-20':'-06-20');
  const min=semester?.effectiveDate||start,effective=today<min?min:today>end?end:today;
  const dates=semester?field('새 시간표 적용 시작일','<input name="effectiveDate" type="date" required min="'+min+'" max="'+end+'" value="'+effective+'">'):
    field('학기 시작일','<input name="start" type="date" required value="'+start+'">')+field('학기 종료일','<input name="end" type="date" required value="'+end+'">');
  dialog(changesNotice(current())+'<div class="dialog-heading"><h2 id="dialog-title">이번 학기 시간표로 저장</h2>'+button(icon('close'),'close-dialog','icon-button','aria-label="닫기"')+'</div><form id="semester-form" class="stack">'+dates+'<p id="semester-error" class="form-error" role="alert"></p><button type="submit" class="button primary">'+(semester?'시간표 변경 미리보기':'저장')+'</button></form>');
}
function showSection(courseId){
  const c=state.route==='saved'?store.data.semester?.candidate:current(),s=c?.sections.find(s=>s.courseId===courseId);if(!s)return;
  const saved=state.route==='saved';
  const content='<span class="chip">'+[s.classification,Number.isFinite(s.credits)?s.credits+'학점':''].filter(Boolean).map(esc).join(' · ')+'</span>'+
    '<div class="section-detail"><p>'+s.meetings.map(([d,f,t],index)=>dayNames[d]+'요일 '+timeText(f)+' ~ '+timeText(t)+' · '+esc(sectionLocation(s,index))).join('<br>')+'</p>'+
    (s.courseNumber?'<p>과목번호 '+esc(s.courseNumber)+(s.sectionLabel?' · '+esc(s.sectionLabel):'')+'</p>':'')+
    (s.instructor?'<p>담당 교수: '+esc(s.instructor)+'</p>':'')+(s.target?'<p>수강대상: '+esc(s.target)+'</p>':'')+
    (s.notes?'<p>수강유의사항: '+esc(s.notes)+'</p>':'')+(s.lectureType?'<p>'+esc(s.lectureType)+'</p>':'')+
    '<small>'+esc(s.courseNumber?'제공된 강좌 자료입니다. 수강대상·개설 변경·여석은 학교에서 확인해 주세요.':'예시 시간표의 수업 정보입니다.')+'</small></div>';
  const actions=button('이 분반 대신 다른 분반 찾기','alternative','secondary','data-id="'+esc(s.id)+'"')+
    (saved?button('날짜별 일정 보기','section-calendar','primary','data-id="'+esc(courseId)+'"'):button('확인','close-dialog'));
  if(saved)dialog(plannerDialogContent('dialog-title','수업 상세','close-dialog',
    '<p class="planner-event-name">'+esc(s.name)+'</p>'+content,actions),{planner:true});
  else dialog('<div class="dialog-heading"><h2 id="dialog-title">'+esc(s.name)+'</h2>'+button(icon('close'),'close-dialog','icon-button','aria-label="닫기"')+'</div>'+content+'<div class="stack compact">'+actions+'</div>');
}
function openEvent(id){
  const e=allEvents().find(e=>e.id===id);if(!e)return;
  if(e.source==='lms'){
    const last=e.allDay?addDays(e.endDate,-1):e.endDate;
    const details='<p class="planner-event-name">'+esc(e.title)+'</p><p>'+calendarDateLabel(e.date)+(last!==e.date?' – '+calendarDateLabel(last):'')+' · '+esc(lmsTimeLabel(e))+'</p>'+
      (e.location?'<p>'+esc(e.location)+'</p>':'')+'<p class="muted">학교에서 가져온 일정이에요. 다시 가져오면 변경 사항을 반영해요.</p>';
    const source=e.sourceUrl?'<a id="lms-event-source" class="button primary" href="'+esc(e.sourceUrl)+'" target="_blank" rel="noopener noreferrer">LMS에서 원문 보기</a>':'';
    dialog(plannerDialogContent('dialog-title','LMS 일정','close-dialog',details,source),{planner:true});
    $('dialog').dataset.lmsAccount=e.accountKey;return;
  }
  setCalendarDate(e.date);
  showEventEditor(Object.freeze({...e}),{...e,start:timeText(e.start),end:timeText(e.end)});
}
function addEvent(){
  if(!canAddEvent(state.selectedDate))return;
  const start=state.selectedMinute??720;
  showEventEditor(null,{title:'',date:state.selectedDate,start:timeText(start),end:timeText(Math.min(start+60,1439)),location:'',kind:'personal'});
}
function showEventEditor(original,draft){
  state.eventOriginal=original;
  state.eventDraft=draft;
  const modal=$('event-dialog');
  modal.innerHTML=eventEditor();
  modal.showModal();
}
function closeEventEditor(){
  $('event-dialog').close();
  state.eventOriginal=null;
  state.eventDraft=null;
}
function readEventDraft(form){
  state.eventDraft=Object.fromEntries(new FormData(form));
  const kind=state.eventDraft.kind;
  if($('event-course')){
    $('event-course').hidden=kind==='personal';
    $('makeup-original').hidden=kind!=='makeup';
  }
  return state.eventDraft;
}
function commitCalendar(preview,done,acceptConflicts=false){
  store.apply(preview,{...calendarOptions(),acceptConflicts});
  closeDialog();done(preview);
}
function submitCalendar(command,done,confirm=false){
  const preview=store.preview(command,calendarOptions());
  if(!preview.ok)throw new Error(preview.errors[0].message);
  if(!confirm&&!preview.requiresReview&&!preview.conflicts.length&&!preview.preserved.length){commitCalendar(preview,done);return}
  pendingCalendar={preview,done};
  const counts={add:0,update:0,cancel:0};
  for(const change of preview.changes)if(Object.hasOwn(counts,change.type))counts[change.type]++;
  const conflicts=preview.conflicts.length?'<ul>'+preview.conflicts.map(c=>'<li>'+esc(c.events.map(e=>e.title).join(' / '))+' · '+c.date+' '+timeText(c.start)+'–'+timeText(c.end)+'</li>').join('')+'</ul>':'';
  const review=preview.requiresReview?'<form id="calendar-review" class="stack">'+preview.review.map(item=>field(
    esc(item.event.title)+' · '+item.event.date,
    '<select name="'+esc(item.id)+'" required><option value="">처리 방법 선택</option>'+item.options.map(option=>'<option value="'+option+'">'+(option==='keep'?'기존 연결과 상태 유지':'취소 상태로 보존')+'</option>').join('')+'</select>'
  )).join('')+'</form>':'';
  const content='<p>추가 '+counts.add+'개 · 수정 '+counts.update+'개 · 취소 '+counts.cancel+'개 · 예외 및 개인 일정 유지 '+preview.preserved.length+'개</p>'+
    (conflicts?'<p>시간이 겹치는 일정</p>'+conflicts:'')+review;
  const confirmButton=preview.requiresReview?'<button class="button primary" type="submit" form="calendar-review">선택 반영해 다시 보기</button>':
    button(preview.conflicts.length?'겹침을 확인하고 저장':'변경 확인하고 저장','apply-calendar');
  const actions='<p id="calendar-preview-error" class="form-error" role="alert"></p><div class="planner-confirm-actions">'+
    button($('event-dialog').open?'계속 편집':'취소','close-dialog','secondary')+confirmButton+'</div>';
  dialog(plannerDialogContent('dialog-title','일정 변경 미리보기','close-dialog',content,actions),{planner:true});
}
function saveEvent(action='edit'){
  const form=$('event-form');if(action==='edit'&&!form.reportValidity())return;
  try{
    const draft=readEventDraft(form),scope=draft.scope||'one',original=state.eventOriginal;
    const fields={title:draft.title.trim(),date:draft.date,start:timeValue(draft.start),
      end:timeValue(draft.end),location:draft.location.trim(),kind:draft.kind};
    const replacement=original?.kind==='class'&&action==='edit'&&fields.kind==='exam';
    if(replacement&&scope==='future')throw new Error('대체 시험은 이번 일정만 선택해 등록해 주세요.');
    const patch=original&&action==='edit'?Object.fromEntries(Object.entries(fields).filter(([key,value])=>
      (typeof original[key]==='string'?original[key].trim():original[key])!==value)):{};
    const command=original&&!replacement?{type:'edit',id:original.id,action,scope,patch}:{type:'add',event:fields};
    if(command.type==='add'&&fields.kind!=='personal'){
      const originalEventId=replacement?original.id:fields.kind==='makeup'?draft.originalEventId:null;
      if(originalEventId)command.originalEventId=originalEventId;
      if(draft.courseId)command.courseId=draft.courseId;
      if(fields.kind==='exam')command.examMode=replacement?'replacement':'additional';
    }
    submitCalendar(command,preview=>{
      const date=preview.changes.find(change=>change.type==='add'||change.id===original?.id)?.after?.date||original?.date||fields.date;
      closeEventEditor();
      setCalendarDate(date);
      if(state.route==='calendar')refreshCalendarEvents();else go('calendar');
      flash(action==='cancel'?'일정을 취소했어요.':['restore','resume'].includes(action)?'일정을 복원했어요.':'일정을 저장했어요.');
    });
  }catch(e){$('event-error').textContent=e.message}
}
async function checkConnection(){
  try{state.aiStatus=await api('status');state.aiMessage=state.aiStatus.message||(state.aiStatus.connected?'연결된 계정으로 추천받을 수 있어요.':'연결 후 AI 추천을 사용할 수 있어요.');if(state.route==='ai'){const input=$('ai-note'),focused=document.activeElement===input,selection=[input?.selectionStart,input?.selectionEnd];if(input)state.request.note=input.value;render();if(focused){$('ai-note').focus({preventScroll:true});$('ai-note').setSelectionRange(...selection)}if(state.aiStatus.loginState==='waiting')pollTimer=setTimeout(checkConnection,2000)}}
  catch(e){state.aiMessage=e.message;if(state.route==='ai')render()}
}
async function act(action,el){
  switch(action){
    case 'back':back();break;
    case 'step':go(el.dataset.value);break;
    case 'credit-step':{
      const input=$('target-credits'),value=Math.min(24,Math.max(.5,(input.valueAsNumber||0)+Number(el.dataset.value)));
      input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      break;
    }
    case 'new':go('courses');break;
    case 'course':toggleCourseSelection(el.dataset.id);break;
    case 'show-course-conflict':$('course-time-check').focus();break;
    case 'remove-conflicting-course':
      if(state.request.requiredCourseIds.includes(el.dataset.id)){
        toggleCourseSelection(el.dataset.id);$('course-search').focus();
      }
      break;
    case 'course-kind':state.kind=el.dataset.value;render('list');break;
    case 'course-filter':{
      const {id,value}=el.dataset,values=state.courseFilters[id];
      state.courseFilters[id]=values.includes(value)?values.filter(item=>item!==value):[...values,value];
      render('list');break;
    }
    case 'reset-course-filters':
      state.courseFilters=emptyCourseFilters();state.kind='all';state.query='';state.showAll=false;
      render('list');break;
    case 'more-courses':state.showAll=true;render('list');break;
    case 'remove-interest':state.request.preferredCourseIds=state.request.preferredCourseIds.filter(id=>id!==el.dataset.id);render();break;
    case 'candidate':if(state.active!==Number(el.dataset.value)){state.active=Number(el.dataset.value);render('schedule')}break;
    case 'recommend':await recommend();break;
    case 'recommend-ai':await recommend('ai');break;
    case 'view-empty-option':{
      const candidate=state.emptyGuidance?.options[Number(el.dataset.value)]?.candidate;
      if(state.route!=='empty'||!candidate)break;
      const request=candidate.requestSnapshot,career=careerList(request);
      state.options=[career?{...candidate,careerAssessment:structuredClone(career)}:candidate];
      state.resultRequest=structuredClone(request);
      state.active=0;
      go('results');break;
    }
    case 'relax-options':dialog(relaxationDialog(state.request));break;
    case 'alternative':{
      const c=state.route==='saved'?store.data.semester?.candidate:current();
      if(!c)return;
      const request=structuredClone(c.requestSnapshot||state.resultRequest||state.request);
      const effective=c.solverResult?.effective_constraints;
      if(effective){request.credits.total=effective.credits;request.attendanceDays=effective.attendance_days;request.morning=effective.morning;request.lunch=effective.lunch}
      request.relaxationPolicy={max_changed:0,rules:{}};
      const baseline={section_ids:c.sections.map(s=>s.id).sort(),failed_section_ids:[el.dataset.id],allow_course_replacement:false,preserve_credit_total:true};
      closeDialog();
      if(request.term!==state.request.term||request.department!==state.request.department){
        await changeCatalog({term:request.term,department:request.department});
        if(request.term!==state.request.term||request.department!==state.request.department)break;
      }
      await recommend('alternative',{request,baseline});break;
    }
    case 'retry':if(!state.request)await init();else await recommend(state.lastMode);break;
    case 'confirm':confirmSemester();break;
    case 'close-dialog':closeDialog();break;
    case 'close-event':closeEventEditor();break;
    case 'section':showSection(el.dataset.id);break;
    case 'section-calendar':{const events=store.data.events.filter(e=>e.courseId===el.dataset.id),upcoming=events.find(e=>e.date>=koreanToday())||events[0];if(upcoming)state.selectedDate=upcoming.date;closeDialog();go('calendar');break}
    case 'career-required':{
      const groups=groupCareerCourses(careerList(),state.courses.filter(c=>c.availableSectionCount!==0),{selectable:true});
      if(![...groups.major,...groups.general].some(c=>c.id===el.dataset.id&&c.availableSectionCount!==0))break;
      toggleCourseSelection(el.dataset.id);break;
    }
    case 'career-evaluate':{
      if(state.careerBusy||state.catalogBusy)break;
      const goal=state.careerGoal.trim();
      if(!goal){flash('희망 진로를 입력해 주세요.',true);break}
      const scope={term:state.request.term,department:state.request.department};
      state.careerBusy=true;render();
      try{
        const result=await api('career',{goal,...scope},AbortSignal.timeout(300000));
        if(goal!==state.careerGoal.trim())throw new Error('진로가 변경됐어요. 새 진로로 다시 분석해 주세요.');
        store.saveCareerList(result);
        go('career-list');
        flash('전공·교양 추천 목록을 저장했어요. 시간표에서 원하는 과목만 선택하세요.');
      }catch(error){flash(error.message,true)}finally{state.careerBusy=false;render()}
      break;
    }
    case 'program-from-career':state.programGoal=state.careerGoal||store.data.careerRecommendations?.goal||'';go('programs');break;
    case 'program-refresh':await refreshProgramMeta();break;
    case 'program-clear':try{programStore.clear();render()}catch{flash('저장된 비교과 추천을 지우지 못했어요.',true)}break;
    case 'program-evaluate':{
      if(state.programBusy||state.programLoading||!state.programMeta?.ready)break;
      const goal=state.programGoal.trim(),includeUpcoming=state.programUpcoming;
      if(!goal){flash('희망 진로를 입력해 주세요.',true);break}
      state.programBusy=true;render();
      try{
        const result=await api('programs/recommend',{goal,includeUpcoming},AbortSignal.timeout(300000));
        if(goal!==state.programGoal.trim()||includeUpcoming!==state.programUpcoming)throw Error('진로나 모집 옵션이 변경됐어요. 다시 검색해 주세요.');
        programStore.save(result);
        await refreshProgramMeta();
        if(state.route==='programs')render();
        flash('진로에 맞는 비교과 추천을 저장했어요. 신청은 학교에서 진행해 주세요.');
      }catch(error){flash(error.message,true)}finally{state.programBusy=false;if(state.route==='programs')render()}
      break;
    }
    case 'example':{const ids=examples()[Number(el.dataset.value)].ids;state.request.preferredCourseIds=[...new Set([...state.request.preferredCourseIds,...ids])];state.request.excludedCourseIds=state.request.excludedCourseIds.filter(id=>!ids.includes(id));go('courses');flash('관심 과목에 담았어요. 필수 과목은 그대로 유지해요.');break}
    case 'calendar-mode':setCalendarDate(state.selectedDate,{mode:el.dataset.value});break;
    case 'calendar-step':setCalendarDate(stepCalendarDate(state.selectedDate,state.calendarMode,Number(el.dataset.value)));break;
    case 'calendar-today':setCalendarDate(koreanToday());break;
    case 'open-event':openEvent(el.dataset.id);break;
    case 'add-event':addEvent();break;
    case 'save-event':saveEvent();break;
    case 'cancel-event':saveEvent('cancel');break;
    case 'restore-event':saveEvent('restore');break;
    case 'resume-event':saveEvent('resume');break;
    case 'apply-calendar':{
      if(!pendingCalendar)break;
      try{commitCalendar(pendingCalendar.preview,pendingCalendar.done,true)}
      catch(error){$('calendar-preview-error').textContent=error.message}
      break;
    }
    case 'download':{const url=URL.createObjectURL(new Blob([exportCalendar(allEvents())],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='campus-'+(store.data.semester?.start||koreanToday())+'.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);flash('캘린더 파일을 다운로드했어요.');break}
    case 'save-record':{if(!$('record-form').reportValidity())return;try{store.addRecord(state.noteTitle,state.noteBody,store.data.semester?.candidate||current());state.noteTitle='';state.noteBody='';go('experience');flash('내 기록을 저장했어요.')}catch(e){$('record-error').textContent=e.message}break}
    case 'connect':{el.disabled=true;try{const status=await api('status');if(!status.connected)await api('connect',{});await checkConnection()}finally{el.disabled=false}break}
    case 'cancel-login':await api('cancel',{});await checkConnection();break;
  }
}
document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(!el||el.disabled)return;act(el.dataset.action,el).catch(error=>flash(error.message,true))});
$('dialog').addEventListener('cancel',()=>{pendingCalendar=null});
$('event-dialog').addEventListener('cancel',event=>{event.preventDefault();closeEventEditor()});
document.addEventListener('input',e=>{
  const el=e.target,r=state.request;if(!r)return;
  if(el.id==='course-search'){state.query=el.value;$('course-list').innerHTML=courseList()}
  if(el.id==='target-credits'){
    const value=el.valueAsNumber;
    if(state.creditChoice.mode==='ranges')r.credits.total={min:value,max:value};
    else state.creditChoice={mode:'goal',value};
    syncCreditPlan(false);updateCreditFeedback();
  }
  if(el.dataset.credit){
    state.creditChoice={mode:'ranges'};
    r.credits[el.dataset.credit][el.dataset.bound]=el.valueAsNumber;
    syncCreditPlan();updateCreditFeedback();
  }
  if(el.id==='note-title')state.noteTitle=el.value;
  if(el.id==='career-goal')state.careerGoal=el.value;
  if(el.id==='program-goal')state.programGoal=el.value;
  if(el.id==='note-body')state.noteBody=el.value;
  if(el.id==='ai-note')r.note=el.value;
  if(el.form?.id==='event-form')readEventDraft(el.form);
});
document.addEventListener('change',e=>{
  const el=e.target,r=state.request;if(!r)return;
  if(el.id==='program-upcoming'){state.programUpcoming=el.checked;return}
  if(el.id==='catalog-term'||el.id==='catalog-department'){changeCatalog({term:$('catalog-term').value,department:$('catalog-department').value});return}
  updateHardCondition(r,el);
  if(el.dataset.pref)r.preferences[el.dataset.pref]=el.checked;
  if(el.id==='target-credits'){
    syncCreditPlan();
    if(state.creditChoice.mode==='goal')el.value=creditValue(state.creditChoice.value);
    updateCreditFeedback();
  }
  if(el.dataset.day!==undefined){
    const d=Number(el.dataset.day);
    r.allowedDays=el.checked?[...r.allowedDays,d].sort():r.allowedDays.filter(x=>x!==d);
    renderSelectedCourseTimes();
  }
  if(['earliestStart','latestEnd'].includes(el.id)){
    r[el.id]=Number(el.value);renderSelectedCourseTimes();
  }
  if(el.id==='daily-limit')r.maxCoursesPerDay=el.value?Number(el.value):null;
  if(el.dataset.exclude){
    const id=el.dataset.exclude;
    r.excludedCourseIds=el.checked?[...new Set([...r.excludedCourseIds,id])]:r.excludedCourseIds.filter(x=>x!==id);
    if(el.checked)r.requiredCourseIds=r.requiredCourseIds.filter(x=>x!==id);
    syncCreditPlan();render();
  }
  if(el.id==='calendar-date'&&el.value)setCalendarDate(el.value);
  if(el.id==='show-calendar-classes'){state.showCalendarClasses=el.checked;calendarWidget?.refetchEvents()}
  if(el.form?.id==='event-form')readEventDraft(el.form);
});

document.addEventListener('submit',e=>{
  e.preventDefault();if(e.target.id==='relax-form'){
    try{const request=structuredClone(state.request);request.relaxationPolicy=relaxationPolicy(request,e.target);closeDialog();recommend('relax',request)}catch(error){$('relax-error').textContent=error.message}
  }else if(e.target.id==='semester-form'){
    try{
      const f=new FormData(e.target),candidate=current(),effectiveDate=f.get('effectiveDate');
      const command=effectiveDate?{type:'replace',candidate,effectiveDate}:{type:'initialize',candidate,start:f.get('start'),end:f.get('end')};
      submitCalendar(command,()=>{
        const {start,end}=store.data.semester,today=koreanToday();
        state.selectedDate=effectiveDate||(today>=start&&today<=end?today:start);
        go('saved');flash('시간표와 학기 일정을 저장했어요.');
      },Boolean(effectiveDate));
    }catch(error){$('semester-error').textContent=error.message}
  }else if(e.target.id==='calendar-review'&&pendingCalendar){
    try{
      const {preview,done}=pendingCalendar,decisions=Object.fromEntries(new FormData(e.target));
      if(preview.revision!==store.data.revision)throw new Error('다른 변경이 저장되었어요. 미리보기를 다시 확인해 주세요.');
      submitCalendar({...preview.command,decisions},done,true);
    }catch(error){$('calendar-preview-error').textContent=error.message}
  }else if(e.target.id==='event-form')saveEvent();else if(e.target.id==='record-form')act('save-record',e.target);
});
window.addEventListener('hashchange',()=>{if(state.request)routeChanged()});
// Pointing at or focusing a course previews its time on the week before it is picked.
function previewCourse(event){
  const shown=event.type==='mouseover'||(event.type==='focusin'&&event.target.matches?.(':focus-visible'));
  const card=shown?event.target.closest?.('#course-list .course-card'):null;
  const id=card&&!card.disabled?card.dataset.id:null;
  if(id===state.hoverCourseId)return;
  state.hoverCourseId=id;renderWeekPreview();
}
if(window.matchMedia('(hover: hover)').matches)for(const type of ['mouseover','mouseout'])document.addEventListener(type,previewCourse);
for(const type of ['focusin','focusout'])document.addEventListener(type,previewCourse);
let resizeFrame;
window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>layoutTabs())});
if(window.visualViewport){
  const viewport=window.visualViewport, root=document.documentElement;
  let frame;
  const schedule=()=>{
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{
      if(viewport.scale!==1){
        root.style.removeProperty('--planner-visual-height');
        root.style.removeProperty('--planner-visual-bottom');
        return;
      }
      root.style.setProperty('--planner-visual-height',viewport.height+'px');
      root.style.setProperty('--planner-visual-bottom',Math.max(0,root.clientHeight-viewport.height-viewport.offsetTop)+'px');
      const input=document.activeElement;
      const body=input?.closest('.planner-dialog[open] .planner-dialog-body');
      if(!body)return;
      // The sheet settles to the new viewport one frame later, so measure the focused field then.
      frame=requestAnimationFrame(()=>{
        const field=input.getBoundingClientRect(),visible=body.getBoundingClientRect();
        if(field.bottom>visible.bottom)body.scrollTop+=field.bottom-visible.bottom+8;
        else if(field.top<visible.top)body.scrollTop-=visible.top-field.top+8;
      });
    });
  };
  viewport.addEventListener('resize',schedule);
  viewport.addEventListener('scroll',schedule);
  schedule();
}
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{if(event.matches)document.getAnimations().forEach(animation=>animation.cancel())});
async function init(){
  try{
    let scope=null;try{scope=JSON.parse(localStorage.getItem(scopeStorageKey))}catch{}
    let meta=await api('meta');
    if(meta.catalogInfo.terms?.includes(scope?.term)&&meta.catalogInfo.departments?.includes(scope?.department))meta=await api('meta?'+new URLSearchParams(scope));
    state.courses=meta.courses;state.catalogInfo=meta.catalogInfo;state.request=structuredClone(meta.defaultRequest);
    Object.assign(state.request,{requiredCourseIds:[],allowedDays:[0,1,2,3],earliestStart:600,credits:structuredClone(defaultCreditRanges)});
    syncCreditPlan();
    routeChanged();if(store.readError)flash(store.readError,true);
    if(!lmsReady){lmsReady=true;setupLms({
      setLmsAccount(user){if((state.user?.key||null)===(user?.key||null))return;state.user=user;render()},
      setLmsCalendar(value){
        if(state.lmsCalendar===value)return;
        state.lmsCalendar=value;
        if($('dialog').dataset.lmsAccount&&$('dialog').dataset.lmsAccount!==value?.accountKey)closeDialog();
        if(state.route==='calendar'){
          $('calendar-semester-label').textContent=calendarSemesterLabel();
          refreshCalendarEvents();
        }else if(state.route==='export')render();
      },
      showLmsCalendar(){
        const dates=(state.lmsCalendar?.events||[]).map(event=>event.date).sort();
        setCalendarDate(dates.find(date=>date>=koreanToday())||dates.at(-1)||koreanToday(),{mode:'day'});
        if(state.route!=='calendar')go('calendar');
        requestAnimationFrame(()=>$('semester-calendar')?.scrollIntoView({block:'start'}));
      }
    })}
  }catch(error){state.error=error.message;state.route='error';render()}
}

init();
