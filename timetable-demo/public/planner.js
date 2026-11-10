import {careerTracks,experienceExamples,kindLabels,careerSelection,createSemesterEvents,editEvents,conflictPairs,exportCalendar,emptyPlanner,restorePlanner,validateEvent,parseDate,addDays,weekStart,koreanToday,timeText,timeValue} from './planner-core.mjs';
import {occursOnDate,agendaEvents,lmsTimeLabel,lmsKindLabel} from './lms-calendar.mjs';

const $=id=>document.getElementById(id),storageKey='ssu-timetable-planner-v1';
const dayNames=['일','월','화','수','목','금','토'];
function node(tag,text='',className=''){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el}
function button(text,fn,className='button secondary'){const el=node('button',text,className);el.type='button';el.addEventListener('click',fn);return el}
function notice(text,error=false){$('planner-message').textContent=text;$('planner-message').className='message '+(error?'error':'success');$('planner-message').hidden=!text}
function dateLabel(date){const d=parseDate(date);return `${d.getUTCMonth()+1}/${d.getUTCDate()} (${dayNames[d.getUTCDay()]})`}

export function setupPlanner({courses,getCandidate,applyCourses}) {
  let data=emptyPlanner(),selectedDate=koreanToday(),editingId=null,lmsCalendar=null;
  const allEvents=()=>[...data.events,...(lmsCalendar?.events||[])];
  const completed=new Set(),known=new Map(courses.map(course=>[course.id,course]));
  try{const saved=localStorage.getItem(storageKey);if(saved)data=restorePlanner(JSON.parse(saved))}catch{notice('저장된 기록을 불러오지 못했어요. 기존 브라우저 데이터는 그대로 두었습니다.',true)}
  function showView(name){
    if(!['recommend','calendar','experience'].includes(name))return;
    for(const id of ['recommend','calendar','experience'])$(id+'-view').hidden=id!==name;
    document.querySelectorAll('.view-nav [data-view]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.view===name)));
    if(name==='calendar')renderCalendar();if(name==='experience')renderExperiences();
  }
  for(const el of document.querySelectorAll('[data-view]'))el.addEventListener('click',()=>showView(el.dataset.view));
  window.addEventListener('hashchange',()=>showView(location.hash.slice(1)));
  function save(next){
    restorePlanner(next);
    try{localStorage.setItem(storageKey,JSON.stringify(next))}catch{throw new Error('브라우저에 저장하지 못했어요. 저장 공간과 브라우저 설정을 확인해 주세요.')}
    data=next;renderCalendar();renderExperiences();
  }
  const guard=fn=>async()=>{try{await fn()}catch(error){notice(error.message,true)}};
  for(const track of careerTracks){const option=node('option',track.name);option.value=track.id;$('career-track').append(option)}
  function renderCareer(){
    const track=careerTracks.find(t=>t.id===$('career-track').value),stage=Number($('career-stage').value);
    $('career-roadmap').replaceChildren();
    track.stages.forEach(([label,ids],i)=>{
      const card=node('div','','roadmap-step'+(stage===i?' current':''));card.append(node('span',String(i+1).padStart(2,'0'),'eyebrow'),node('h3',label));
      for(const id of ids){const course=known.get(id);if(course)card.append(node('p',course.name+(completed.has(id)?' · 이수 완료':''),completed.has(id)?'completed':'') )}
      $('career-roadmap').append(card);
    });
    $('completed-courses').replaceChildren();
    for(const id of [...new Set(track.stages.flatMap(([,ids])=>ids))]){
      const label=node('label'),input=document.createElement('input');input.type='checkbox';input.checked=completed.has(id);input.dataset.completed=id;
      input.addEventListener('change',()=>{if(input.checked)completed.add(id);else completed.delete(id);renderCareer()});label.append(input,node('span',known.get(id).name));$('completed-courses').append(label);
    }
  }
  $('career-track').addEventListener('change',renderCareer);$('career-stage').addEventListener('change',renderCareer);
  $('career-apply').addEventListener('click',guard(async()=>{
    const preferred=careerSelection($('career-track').value,Number($('career-stage').value),[...completed],courses);
    await applyCourses(preferred,[...completed]);
    notice(preferred.length?`관심 과목 ${preferred.length}개를 우선 추천해요. 이수한 ${completed.size}과목은 제외했어요. 필수 포함 조건과 학점 범위는 유지돼요.`:'이 단계의 과목은 모두 이수했어요. 제외 조건을 적용했으니 다른 학습 단계를 선택해 보세요.');
  }));
  renderCareer();
  const today=koreanToday(),year=today.slice(0,4),firstHalf=Number(today.slice(5,7))<=6;
  $('semester-start').value=data.semester?.start||`${year}-${firstHalf?'03-02':'09-01'}`;
  $('semester-end').value=data.semester?.end||`${year}-${firstHalf?'06-21':'12-21'}`;
  $('calendar-month').value=selectedDate.slice(0,7);
  $('confirm-timetable').addEventListener('click',guard(()=>{
    const candidate=getCandidate(),start=$('semester-start').value,end=$('semester-end').value;
    const events=createSemesterEvents(candidate,start,end);
    if(data.semester&&!window.confirm('새 시간표로 캘린더를 다시 만들면 기존 일정 변경·휴강·개인 일정이 초기화됩니다. 계속할까요?'))return;
    save({...data,semester:{start,end,candidate:structuredClone(candidate)},events});
    selectedDate=today>=start&&today<=end?today:start;$('calendar-month').value=selectedDate.slice(0,7);showView('calendar');
    notice(`수업 일정 ${events.length}개를 저장했어요. 날짜를 골라 휴강·시험·장소 변경을 반영해 보세요.`);
  }));
  function renderCalendar(){
    const events=allEvents(),hasCalendar=!!data.semester||events.length>0;
    $('calendar-empty').hidden=hasCalendar;$('calendar-content').hidden=!hasCalendar;$('export-calendar').disabled=!events.length;
    $('add-event').disabled=!data.semester;$('add-event').title=data.semester?'':'추천 시간표를 저장하면 개인 일정도 추가할 수 있어요.';
    $('semester-label').textContent=data.semester?`${data.semester.start} – ${data.semester.end} · 전공 ${data.semester.candidate.majorCredits} + 교양 ${data.semester.candidate.generalCredits}학점`:'LMS를 연결하면 실제 과제·시험·강의 마감을 볼 수 있어요.';
    if(lmsCalendar)$('semester-label').textContent+=` · LMS ${lmsCalendar.events.length}개`;
    if(!hasCalendar)return;
    const active=events.filter(e=>e.status==='active'),nextExam=active.filter(e=>(e.kind==='exam'||e.source==='lms'&&e.lmsKind==='deadline')&&e.date>=today).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start)[0];
    const highlights=[['오늘의 일정',active.filter(e=>occursOnDate(e,today)).length+'개'],['다가오는 시험·마감',nextExam?dateLabel(nextExam.date)+' '+nextExam.title:'등록된 시험·마감 없음'],['변경·휴강',data.events.filter(e=>e.original&&(e.status==='cancelled'||['date','start','end','location','kind','title'].some(k=>e[k]!==e.original[k]))).length+'개']];
    $('calendar-highlights').replaceChildren(...highlights.map(([title,value])=>{const card=node('div');card.append(node('span',title),node('strong',value));return card}));
    const month=$('calendar-month').value||selectedDate.slice(0,7),first=month+'-01',offset=(parseDate(first).getUTCDay()+6)%7,last=new Date(parseDate(first));last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
    $('month-grid').replaceChildren();
    for(let i=0;i<offset;i++)$('month-grid').append(node('span','','month-spacer'));
    for(let day=1;day<=last.getUTCDate();day++){
      const date=month+'-'+String(day).padStart(2,'0'),items=events.filter(e=>occursOnDate(e,date)&&e.status==='active');
      const cell=button(String(day),()=>{selectedDate=date;renderCalendar()},'month-day'+(date===selectedDate?' selected':'')+(date===today?' today':''));
      cell.setAttribute('aria-label',date+' 일정 '+items.length+'개');cell.setAttribute('aria-pressed',String(date===selectedDate));
      const dots=node('span','','month-dots');if(items.some(e=>e.kind==='class'))dots.append(node('i','','class-dot'));if(items.some(e=>e.kind!=='class'))dots.append(node('i','','extra-dot'));cell.append(dots);$('month-grid').append(cell);
    }
    const from=weekStart(selectedDate),to=addDays(from,6);$('week-label').textContent=dateLabel(from)+' – '+dateLabel(to);
    const week=agendaEvents(events,from,to);
    const conflicts=new Set(conflictPairs(week).flat());$('week-agenda').replaceChildren();
    for(let n=0;n<7;n++){
      const date=addDays(from,n),items=week.filter(e=>e.date===date),group=node('section','','agenda-day'+(date===selectedDate?' selected':''));
      group.append(node('h3',dateLabel(date)+(date===today?' · 오늘':'')));
      if(!items.length)group.append(node('p','일정 없음','subtle'));
      for(const event of items){
        const cancelled=event.status==='cancelled',changed=event.original&&['date','start','end','location','kind','title'].some(k=>event[k]!==event.original[k]);
        const row=button('',()=>openEditor(event.id),'agenda-event'+(cancelled?' cancelled':'')+(conflicts.has(event.id)?' conflict':''));
        row.append(node('span',event.source==='lms'?lmsTimeLabel(event):timeText(event.start)+'–'+timeText(event.end),'agenda-time'));
        const info=node('span','','agenda-info');info.append(node('strong',event.title),node('small',(event.source==='lms'?'LMS · 눌러서 원문 확인':event.location||'장소 미정')+(changed?' · 변경됨':'')));row.append(info,node('span',cancelled?'휴강·취소':event.source==='lms'?lmsKindLabel(event):kindLabels[event.kind],'event-kind '+event.kind));
        if(conflicts.has(event.id))row.append(node('span','시간 겹침','conflict-label'));group.append(row);
      }
      $('week-agenda').append(group);
    }
  }
  function selectDate(date){selectedDate=date;$('calendar-month').value=date.slice(0,7);renderCalendar()}
  $('calendar-month').addEventListener('change',()=>{if($('calendar-month').value)selectDate($('calendar-month').value+'-01')});
  $('previous-week').addEventListener('click',()=>selectDate(addDays(selectedDate,-7)));$('next-week').addEventListener('click',()=>selectDate(addDays(selectedDate,7)));$('calendar-today').addEventListener('click',()=>selectDate(today));
  function openEditor(id=null){
    const imported=lmsCalendar?.events.find(event=>event.id===id);
    if(imported){
      $('lms-event-title').textContent=imported.title;
      const lastDate=imported.allDay?addDays(imported.endDate,-1):imported.endDate;
      $('lms-event-detail').textContent=`${dateLabel(imported.date)}${lastDate!==imported.date?' – '+dateLabel(lastDate):''} · ${lmsTimeLabel(imported)} · ${lmsKindLabel(imported)}`;
      $('lms-event-source').hidden=!imported.sourceUrl;
      if(imported.sourceUrl)$('lms-event-source').href=imported.sourceUrl;else $('lms-event-source').removeAttribute('href');
      $('lms-event-dialog').showModal();return;
    }
    if(!data.semester){notice('시간표를 먼저 학기 캘린더에 저장해 주세요.',true);return}
    editingId=id;const event=data.events.find(e=>e.id===id),series=!!event?.seriesId;
    $('event-dialog-title').textContent=event?'일정 변경':'일정 추가';$('event-error').hidden=true;
    $('event-title').value=event?.title||'';$('event-date').value=event?.date||(selectedDate>=data.semester.start&&selectedDate<=data.semester.end?selectedDate:data.semester.start);
    $('event-date').min=data.semester.start;$('event-date').max=data.semester.end;
    $('event-start').value=timeText(event?.start??720);$('event-end').value=timeText(event?.end??780);$('event-location').value=event?.location||'';$('event-kind').value=event?.kind||'personal';
    $('event-course').replaceChildren(node('option','과목 연결 없음'));$('event-course').firstChild.value='';
    for(const section of data.semester.candidate.sections){const option=node('option',section.name);option.value=section.courseId;$('event-course').append(option)}
    $('event-course').value=event?.courseId||'';$('event-course-label').hidden=series;
    $('event-scope-label').hidden=!series;$('event-scope').value='one';$('cancel-event').hidden=!event||event.status==='cancelled';$('cancel-event').textContent=series?'휴강 표시':'일정 취소';$('restore-event').hidden=!event||(!series&&event.status!=='cancelled');$('restore-event').textContent=series?'원래 수업 복원':'취소 되돌리기';
    $('event-edit-hint').textContent=series?'이번 일정만 바꾸면 다음 주 수업은 유지돼요. 종류를 시험으로 바꾸면 해당 수업을 대체하고, 별도 시험은 일정 추가로 등록해요.':'시험·보강은 과목을 연결할 수 있어요. 시간이 겹치면 캘린더에서 표시해요.';
    $('event-dialog').showModal();
  }
  $('add-event').addEventListener('click',()=>openEditor());$('close-event').addEventListener('click',()=>$('event-dialog').close());
  $('close-lms-event').addEventListener('click',()=>$('lms-event-dialog').close());
  function submitEvent(action='edit'){
    try{
      const patch={title:$('event-title').value.trim(),date:$('event-date').value,start:timeValue($('event-start').value),end:timeValue($('event-end').value),location:$('event-location').value.trim(),kind:$('event-kind').value};
      let events;
      if(editingId){
        events=editEvents(data.events,editingId,patch,{scope:$('event-scope').value,action,period:data.semester});
        if(!data.events.find(e=>e.id===editingId).seriesId&&action==='edit')events=events.map(e=>e.id===editingId?{...e,courseId:$('event-course').value}:e);
      }else{
        if(data.events.length>=2000)throw new Error('저장 가능한 일정 수를 초과했어요.');
        const event=validateEvent({...patch,id:crypto.randomUUID(),courseId:$('event-course').value,status:'active'});
        if(event.date<data.semester.start||event.date>data.semester.end)throw new Error('학기 기간 안의 날짜를 선택해 주세요.');
        events=[...data.events,event];
      }
      save({...data,events});$('event-dialog').close();selectDate(action==='edit'?patch.date:selectedDate);
      notice(action==='cancel'?'휴강·취소를 표시했어요. 다음 주 일정과 적용 범위를 확인해 주세요.':action==='restore'?'정규 수업을 원래 일정으로 복원했어요.':'일정을 저장했어요. 겹치는 일정은 캘린더에서 표시됩니다.');
    }catch(error){$('event-error').textContent=error.message;$('event-error').hidden=false}
  }
  $('event-form').addEventListener('submit',event=>{event.preventDefault();submitEvent()});$('cancel-event').addEventListener('click',()=>submitEvent('cancel'));$('restore-event').addEventListener('click',()=>submitEvent('restore'));
  $('export-calendar').addEventListener('click',guard(()=>{
    const text=exportCalendar(allEvents()),url=URL.createObjectURL(new Blob([text],{type:'text/calendar;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='숭실대_학기일정.ics';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    notice('캘린더 파일을 내려받았어요. 사용하는 캘린더의 가져오기로 열어 주세요. 변경 후에는 다시 내보내야 하며, 반복 가져오기는 일정이 중복될 수 있어요.');
  }));
  function renderExperiences(){
    $('experience-examples').replaceChildren();
    for(const example of experienceExamples){
      const card=node('article','','experience-card');card.append(node('span','가상 예시 · AI소프트웨어학부','eyebrow'),node('h2',example.title),node('p',example.body));
      const chips=node('div','','course-chips');for(const id of example.courseIds)chips.append(node('span',known.get(id).name));card.append(chips);
      card.append(button('이 과목들을 관심 과목으로',guard(async()=>{await applyCourses(example.courseIds.filter(id=>!completed.has(id)),[...completed]);showView('recommend');notice('예시의 과목들을 관심 과목으로 적용했어요. 현재 학점·요일 조건에 맞춰 추천해요.')})));$('experience-examples').append(card);
    }
    $('experience-records').replaceChildren();
    for(const entry of [...data.experiences].reverse()){
      const card=node('article','','experience-record');card.append(node('span','내 기록 · 이 브라우저에만 저장','eyebrow'),node('h3',entry.title),node('p',entry.body),node('p',entry.courseNames.join(' · '),'subtle'));$('experience-records').append(card);
    }
    if(!data.experiences.length)$('experience-records').append(node('p','아직 저장한 내 기록이 없어요.','subtle'));
  }
  $('experience-form').addEventListener('submit',async event=>{
    event.preventDefault();try{
      const candidate=getCandidate();if(!candidate)throw new Error('기록할 추천 시간표를 먼저 선택해 주세요.');
      if(data.experiences.length>=50)throw new Error('내 기록은 최대 50개까지 저장할 수 있어요.');
      const title=$('experience-name').value.trim(),body=$('experience-body').value.trim();if(!title||!body)throw new Error('제목과 조언을 입력해 주세요.');
      save({...data,experiences:[...data.experiences,{id:crypto.randomUUID(),title,body,courseNames:candidate.sections.map(s=>s.name)}]});$('experience-form').reset();notice('현재 시간표와 조언을 내 브라우저에 저장했어요.');
    }catch(error){notice(error.message,true)}
  });
  renderCalendar();renderExperiences();showView(location.hash.slice(1)||'recommend');
  return {setLmsCalendar(value){lmsCalendar=value;renderCalendar()},
    showLmsCalendar(){
      const dates=(lmsCalendar?.events||[]).map(event=>event.date).sort();
      selectDate(dates.find(date=>date>=today)||dates.at(-1)||today);showView('calendar');
      $('calendar-content').scrollIntoView({block:'start'});
    },selectionChanged(candidate){$('experience-selection').textContent=candidate?'기록할 시간표: '+candidate.credits+'학점 · '+candidate.sections.map(s=>s.name).join(' · '):'추천 시간표를 먼저 선택해 주세요.'}};
}
