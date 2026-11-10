import {setupPlanner} from './planner.js';
import {setupLms} from './lms.js';
const $=id=>document.getElementById(id),dayNames=['월','화','수','목','금'];
let planner;
const preferenceLabels={fewDays:'등교일 줄이기',late:'오전 수업 피하기',friday:'금요일 공강 선호',compact:'수업 사이 빈 시간 줄이기',travel:'건물 이동 줄이기'};
const state={courses:[],defaults:null,selection:new Map(),preferredCourseIds:[],candidates:[],recommendations:[],active:0,connected:false,waiting:false,busy:false,revision:0,source:'rules',wantRecommendation:false,poll:null,previewTimer:null};
async function api(route,body){
  const response=await fetch('/api/'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Timetable-App':'1'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'연결을 확인해 주세요.');return data;
}
function el(tag,content,className){const node=document.createElement(tag);node.textContent=content;if(className)node.className=className;return node}
function time(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}
function range(r){return r.min===r.max?String(r.min):r.min+'~'+r.max}
function message(text,type='error'){$('message').textContent=text;$('message').className='message '+type;$('message').hidden=!text}
function setBusy(value){state.busy=value;$('inputs').disabled=value;$('recommend').disabled=value||state.waiting;$('connect').disabled=value||state.waiting;$('recommend').textContent=value?'요청 해석·시간표 추천 중…':state.waiting?'로그인 승인 대기…':'✦ AI로 시간표 짜기'}
function request(){
  return {requiredCourseIds:[...state.selection].filter(([,v])=>v==='required').map(([id])=>id),excludedCourseIds:[...state.selection].filter(([,v])=>v==='excluded').map(([id])=>id),preferredCourseIds:state.preferredCourseIds,allowedDays:[...document.querySelectorAll('input[name=day]:checked')].map(n=>Number(n.value)),earliestStart:Number($('earliestStart').value),latestEnd:Number($('latestEnd').value),credits:Object.fromEntries(['total','major','general'].map(k=>[k,{min:Number($(k+'-min').value),max:Number($(k+'-max').value)}])),preferences:Object.fromEntries(Object.keys(preferenceLabels).map(k=>[k,$('pref-'+k).checked])),note:$('note').value};
}
function applyRequest(r){
  for(const input of document.querySelectorAll('input[name=day]'))input.checked=r.allowedDays.includes(Number(input.value));
  for(const id of ['earliestStart','latestEnd']){if(![...$(id).options].some(o=>Number(o.value)===r[id])){const option=el('option',time(r[id]));option.value=r[id];$(id).append(option)}$(id).value=r[id]}
  for(const kind of ['total','major','general'])for(const bound of ['min','max'])$(kind+'-'+bound).value=r.credits[kind][bound];
  for(const key of Object.keys(preferenceLabels))$('pref-'+key).checked=r.preferences[key];
  state.selection=new Map([...r.requiredCourseIds.map(id=>[id,'required']),...r.excludedCourseIds.map(id=>[id,'excluded'])]);state.preferredCourseIds=r.preferredCourseIds||[];$('note').value=r.note;renderCatalog();renderConditions(r);
}
function renderConditions(r){
  $('condition-summary').replaceChildren(el('span',r.allowedDays.map(d=>dayNames[d]).join('·')+' '+time(r.earliestStart)+'–'+time(r.latestEnd)),el('span','총 '+range(r.credits.total)+'학점'),el('span','전공 '+range(r.credits.major)),el('span','교양 '+range(r.credits.general)));
  const required=r.requiredCourseIds.length,excluded=r.excludedCourseIds.length;
  if(r.preferredCourseIds?.length)$('condition-summary').append(el('span','관심 과목 '+r.preferredCourseIds.length+'개 우선'));
  $('course-selection-count').textContent=required||excluded?'필수 포함 '+required+'과목 · 제외 '+excluded+'과목':'과목 자동 선택 · 아래 목록에서 포함·제외 지정';
}
function basicReason(c){const matched=c.sections.filter(s=>state.preferredCourseIds.includes(s.courseId));return '전공 '+c.majorCredits+'학점과 교양 '+c.generalCredits+'학점을 자동으로 조합했어요. '+c.metrics.dayList.map(d=>dayNames[d]).join('·')+'요일에 등교하며, 수업 사이 빈 시간은 주간 총 '+c.metrics.gapMinutes+'분이에요.'+(matched.length?' 관심 과목 '+matched.map(s=>s.name).join('·')+'을 포함했어요.':'')}
function render(){
  $('result-count').textContent=state.recommendations.length;
  $('result-source').textContent=state.source==='codex'?(state.recommendations.length?'Codex AI 추천':'AI 조건 해석'):'기본 추천';
  $('result-source').className=state.source==='codex'?'badge':'badge neutral';
  $('candidate-tabs').replaceChildren();
  state.recommendations.forEach((item,index)=>{
    const c=state.candidates.find(c=>c.id===item.id);if(!c)return;
    const button=el('button','','candidate');button.type='button';button.setAttribute('aria-pressed',String(index===state.active));
    button.append(el('span','추천 '+(index+1),'rank'),el('strong',c.credits+'학점 · 주 '+c.metrics.days+'일'),el('small','전공 '+c.majorCredits+' · 교양 '+c.generalCredits),el('small',c.metrics.dayList.map(d=>dayNames[d]).join('·')+' · 오전 '+c.metrics.morningClasses+'회'));
    button.addEventListener('click',()=>{state.active=index;render()});$('candidate-tabs').append(button);
  });
  const current=state.recommendations[state.active],c=state.candidates.find(c=>c.id===current?.id);
  $('timetable-panel').hidden=!c;$('recommendation-note').hidden=!c;$('semester-save').hidden=!c;$('selected-courses').replaceChildren();planner?.selectionChanged(c);if(!c)return;
  $('timetable-title').textContent='추천 '+(state.active+1);
  $('metrics').replaceChildren(el('span','빈 시간 '+c.metrics.gapMinutes+'분'),el('span','건물 변경 '+c.metrics.buildingChanges+'회'));
  $('reason-title').textContent=state.source==='codex'?'AI 추천 이유':'조건에 따른 추천';$('reason').textContent=current.reason;
  document.querySelector('.timetable').style.setProperty('--day-count',c.metrics.days);
  document.querySelectorAll('.week-header > span').forEach((node,index)=>{if(index)node.classList.toggle('empty-day',!c.metrics.dayList.includes(index-1))});
  $('week-columns').replaceChildren();
  for(let day=0;day<5;day++){
    const column=el('div','','day-column'+(c.metrics.dayList.includes(day)?'':' empty-day'));
    for(const section of c.sections)for(const [d,start,end] of section.meetings){
      if(d!==day)continue;
      const color=state.courses.findIndex(course=>course.id===section.courseId)%8;
      const event=el('div','','event color-'+color);event.style.top='calc('+(start-540)/720*100+'% + 2px)';event.style.height='calc('+(end-start)/720*100+'% - 4px)';
      const label=dayNames[day]+'요일 '+time(start)+'–'+time(end)+' '+section.name+' · '+section.building;
      event.title=label;event.setAttribute('aria-label',label);event.append(el('strong',section.shortName),el('span',time(start)+'–'+time(end)));column.append(event);
    }
    $('week-columns').append(column);
  }
  for(const s of c.sections){
    const row=el('div','','selected-course'),info=el('div','','selected-course-info'),kind=s.kind==='major'?'전공':'교양';
    info.append(el('strong',s.name),el('small',s.meetings.map(([d,start,end])=>dayNames[d]+' '+time(start)+'–'+time(end)).join(' · ')+' / '+s.building));
    row.append(el('span',kind,'course-kind '+s.kind),info,el('span',s.credits+'학점','subtle'));$('selected-courses').append(row);
  }
}
function renderCatalog(){
  const query=$('course-search').value.trim().toLowerCase(),kind=$('course-kind').value;
  const list=state.courses.filter(c=>(kind==='all'||c.kind===kind||(kind==='chosen'&&state.selection.has(c.id)))&&[c.name,c.topic,c.classification,c.group||''].join(' ').toLowerCase().includes(query));
  $('courses').replaceChildren();$('catalog-empty').hidden=!!list.length;
  $('catalog-description').textContent='전공 32 · 교양 18 · 포함·제외 지정';
  for(const c of list){
    const row=el('div','','catalog-course'),info=el('div','','catalog-info');info.append(el('strong',c.shortName),el('small',c.classification+' · '+c.credits+'학점 · '+(c.year?c.year+'학년 · ':'')+c.topic));
    if(c.group)info.append(el('small',c.group));info.title=c.name;
    const select=document.createElement('select');select.setAttribute('aria-label',c.name+' 선택 방식');select.dataset.course=c.id;
    for(const [value,label] of [['auto','자동 선택'],['required','필수 포함'],['excluded','제외']]){const option=el('option',label);option.value=value;select.append(option)}
    select.value=state.selection.get(c.id)||'auto';row.dataset.selection=select.value;
    select.addEventListener('change',()=>{if(select.value==='auto')state.selection.delete(c.id);else state.selection.set(c.id,select.value);row.dataset.selection=select.value;schedulePreview()});
    row.append(info,select);$('courses').append(row);
  }
}
function showResult(result,source='rules'){
  state.candidates=result.candidates;state.active=0;state.source=source;
  state.recommendations=result.recommendations||result.defaultIds.map(id=>({id,reason:basicReason(result.candidates.find(c=>c.id===id))}));
  $('result-context').textContent=result.summary||(result.total?'검증된 후보 '+result.total+'개 중 추천 · 탐색 범위 내 결과':'조건을 조정해 주세요.');
  const interpretation=result.interpretation;
  $('interpretation').hidden=!interpretation;$('interpretation').textContent=interpretation?'AI가 적용한 조건: '+interpretation.summary:'';
  $('action-hint').textContent=source==='codex'?'조건을 바꾸거나 요청을 추가해 다시 추천할 수 있어요.':'AI 요청은 추천 버튼을 누르면 적용돼요. 현재 결과는 화면에 설정된 조건 기준이에요.';
  const warnings=[...(result.diagnostics||[]),...(interpretation?.unsupported||[])];message(warnings.join(' '),result.total?'warning':'error');
  renderConditions(result.request);render();
}
async function refreshCandidates(){
  clearTimeout(state.previewTimer);const revision=++state.revision;state.source='rules';
  try{
    const body=request();renderConditions(body);const result=await api('candidates',body);if(revision!==state.revision)return;
    showResult(result);
  }catch(error){if(revision!==state.revision)return;state.candidates=[];state.recommendations=[];$('result-context').textContent='조건을 확인해 주세요.';$('interpretation').hidden=true;render();message(error.message)}
}
function schedulePreview(){if(state.busy)return;clearTimeout(state.previewTimer);state.previewTimer=setTimeout(refreshCandidates,220)}
async function refreshStatus(){
  clearTimeout(state.poll);
  try{
    const status=await api('status');state.connected=status.connected;state.waiting=status.loginState==='waiting';
    $('connection-title').textContent=state.waiting?'브라우저에서 로그인을 완료해 주세요':state.connected?'Codex 연결됨':'AI 추천 연결';
    $('connection-description').textContent=state.waiting?'승인이 끝나면 자동으로 이어져요.':state.connected?'조건 해석과 과목 추천에 이 PC의 Codex 계정을 사용해요.':status.message||'버튼을 누르면 브라우저 로그인 화면이 열려요.';
    $('connection-badge').textContent=state.waiting?'승인 대기':state.connected?'● 연결됨':'연결 필요';$('connection-badge').className=state.connected?'badge':'badge neutral';
    $('connect').textContent=state.connected?'다른 계정 연결':'Codex 연결';$('cancel-login').hidden=!state.waiting;setBusy(state.busy);
    if(state.wantRecommendation&&state.connected){state.wantRecommendation=false;await recommend()}
    else if(status.loginState==='error'){state.wantRecommendation=false;message(status.message)}
  }catch(error){state.connected=false;$('connection-title').textContent='연결을 확인해 주세요';$('connection-description').textContent=error.message;$('connection-badge').textContent='연결 오류';$('connection-badge').className='badge neutral';$('connect').disabled=state.busy}
  state.poll=setTimeout(refreshStatus,state.waiting?1500:15000);
}
async function connect(){if(state.waiting)return;state.waiting=true;setBusy(state.busy);try{await api('connect',{});await refreshStatus()}catch(error){state.waiting=false;state.wantRecommendation=false;message(error.message);setBusy(state.busy)}}
async function recommend(){
  if(state.busy)return;
  if(!state.connected){state.wantRecommendation=true;await connect();return}
  clearTimeout(state.previewTimer);++state.revision;setBusy(true);message('요청을 조건으로 바꾸고, 학점과 시간이 맞는 과목 조합을 찾고 있어요.','loading');
  try{const result=await api('recommend',request());applyRequest(result.request);showResult(result,result.source)}
  catch(error){message(error.message)}finally{setBusy(false)}
}
function preset(name){
  const r=structuredClone(state.defaults);
  const exact=(total,major,general)=>({total:{min:total,max:total},major:{min:major,max:major},general:{min:general,max:general}});
  if(name==='wednesday'){r.allowedDays=[2];r.credits=exact(8,6,2);r.preferences.late=false;r.note='수요일에만 전공 6학점, 교양 2학점으로 총 8학점을 듣고 싶어. 과목은 알아서 골라줘.'}
  if(name==='balanced'){r.credits=exact(13,9,4);r.note='전공 9학점과 교양 4학점을 골라줘. 전공은 인공지능과 데이터 쪽이 좋아. 교양은 알아서 골라줘.'}
  if(name==='general'){r.credits=exact(6,0,6);r.note='교양만 6학점 듣고 싶어. 독서와 글쓰기에 관심 있어. 전공은 제외하고 교양을 골라줘.'}
  if(name==='twoDays'){r.allowedDays=[0,2];r.credits={total:{min:12,max:14},major:{min:6,max:9},general:{min:4,max:6}};r.note='월요일과 수요일에만 등교할게. 전공은 최소 6학점, 교양은 최소 4학점, 총 12~14학점으로 골라줘.'}
  applyRequest(r);refreshCandidates();
}
$('connect').addEventListener('click',connect);
$('cancel-login').addEventListener('click',async()=>{state.wantRecommendation=false;try{await api('cancel',{});await refreshStatus()}catch(error){message(error.message)}});
$('preferences-form').addEventListener('submit',event=>{event.preventDefault();recommend()});
$('preview').addEventListener('click',refreshCandidates);
$('reset').addEventListener('click',()=>{applyRequest(structuredClone(state.defaults));refreshCandidates()});
$('inputs').addEventListener('change',event=>{if(!['note','course-search','course-kind'].includes(event.target.id)&&!event.target.dataset.course)schedulePreview()});
$('note').addEventListener('input',()=>{$('action-hint').textContent='AI 요청이 바뀌었어요. 추천 버튼을 누르면 새 조건을 적용해요.'});
$('course-search').addEventListener('input',renderCatalog);$('course-search').addEventListener('keydown',e=>{if(e.key==='Enter')e.preventDefault()});
$('course-kind').addEventListener('change',renderCatalog);
for(const button of document.querySelectorAll('[data-preset]'))button.addEventListener('click',()=>preset(button.dataset.preset));
dayNames.forEach((name,d)=>{const label=el('label','','day-choice'),input=document.createElement('input');input.type='checkbox';input.name='day';input.value=d;input.setAttribute('aria-label',name+'요일 등교 가능');label.append(input,el('span',name));$('days').append(label)});
for(let minute=540;minute<=1260;minute+=30)for(const id of ['earliestStart','latestEnd']){const option=el('option',time(minute));option.value=minute;$(id).append(option)}
for(const [key,labelText] of Object.entries(preferenceLabels)){const label=el('label','','preference'),input=document.createElement('input');input.type='checkbox';input.id='pref-'+key;label.append(el('span',labelText),input,el('span','','switch'));$('preferences').append(label)}
for(let i=0;i<=12;i++){const label=el('span',String(9+i).padStart(2,'0'),'time-label');label.style.top=i/12*100+'%';$('time-labels').append(label)}
try{
  const meta=await api('meta');state.courses=meta.courses;state.defaults=meta.defaultRequest;
  $('catalog-count').textContent=meta.catalogInfo.majorCount+' 전공 · '+meta.catalogInfo.generalCount+' 교양 · '+meta.catalogInfo.sectionCount+' 가상 분반';$('data-notice').textContent=meta.catalogInfo.notice;
  planner=setupPlanner({courses:state.courses,getCandidate:()=>state.candidates.find(c=>c.id===state.recommendations[state.active]?.id),applyCourses:async(preferred,completed=[])=>{
    if(state.busy)throw new Error('AI 추천이 끝난 뒤 과목을 적용해 주세요.');
    const r=request();r.preferredCourseIds=preferred;r.requiredCourseIds=r.requiredCourseIds.filter(id=>!completed.includes(id));r.excludedCourseIds=[...new Set([...r.excludedCourseIds,...completed])].filter(id=>!preferred.includes(id));applyRequest(r);await refreshCandidates();
  }});
  setupLms(planner);
  applyRequest(meta.defaultRequest);await Promise.all([refreshCandidates(),refreshStatus()]);
}catch(error){message(error.message)}
