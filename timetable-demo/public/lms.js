import {mergeLmsCalendar,restoreLmsCalendar} from './lms-calendar.mjs';

const $=id=>document.getElementById(id);
const node=(tag,text='',className='')=>{const element=document.createElement(tag);element.textContent=text;element.className=className;return element};
const storageKey=account=>'ssu-timetable-lms-v1:'+account;
const busyConnections=new Set(['restoring','opening','waiting','checking','loading','background','disconnecting']);

export function setupLms(planner){
  let state=null,account=null,cache=null,selected=new Set(),acting=false,issued=0,applied=0,timer=null;
  let courseSignature='',termSignature='',localNotice='',resultDetail='',failedResult=null;
  const running=()=>['collecting','cancelling'].includes(state?.job?.phase);
  const locked=()=>acting||running();
  const visibleCourses=()=> (state?.courses||[]).filter(course=>(!$('lms-term').value||course.termId===$('lms-term').value)&&
    `${course.name} ${course.code}`.toLowerCase().includes($('lms-search').value.trim().toLowerCase()));

  function switchAccount(next){
    if(next===account)return;
    account=next;cache=null;selected=new Set();localNotice='';resultDetail='';failedResult=null;
    if(account){
      try{
        const raw=localStorage.getItem(storageKey(account));
        if(raw){cache=restoreLmsCalendar(JSON.parse(raw),account);selected=new Set(cache.selectedCourseIds.filter(id=>state.courses.some(course=>course.id===id)))}
      }catch{localNotice='저장된 LMS 일정을 읽지 못했어요. 원래 기록은 보존했으니 과목을 선택해 다시 가져와 주세요.'}
    }
    planner.setLmsCalendar(cache);
  }

  function apply(next,sequence){
    if(sequence<applied)return;applied=sequence;
    state=next;
    switchAccount(state.connection==='connected'&&!state.job?.reconnect?state.accountKey:null);
    const result=state.result;
    if(account&&result?.accountKey===account&&result.id!==cache?.lastResultId&&result.id!==failedResult){
      try{
        const merged=mergeLmsCalendar(cache,result);
        localStorage.setItem(storageKey(account),JSON.stringify(merged.cache));
        cache=merged.cache;planner.setLmsCalendar(cache);
        const {added,updated,removed,retained}=merged.changes;
        resultDetail=`새 일정 ${added}개 · 변경 ${updated}개 · 학교에서 없어진 일정 ${removed}개`+(retained?` · 확인하지 못한 기존 일정 ${retained}개 보존`:'');
        localNotice='';
      }catch{
        failedResult=result.id;
        localNotice='가져온 일정을 브라우저에 저장하지 못했어요. 기존 일정은 그대로예요. 저장 공간을 확인한 뒤 다시 가져와 주세요.';
      }
    }
    render();
  }

  async function request(route,body){
    const sequence=++issued;
    try{
    const response=await fetch('/api/lms/'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Timetable-App':'1'},body:JSON.stringify(body)});
    if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'학교 연결을 확인해 주세요.')}
    apply(await response.json(),sequence);
    }catch(error){error.sequence=sequence;throw error}
  }
  async function refresh(){
    clearTimeout(timer);
    try{await request('state')}
    catch(error){
      if(error.sequence<applied){timer=setTimeout(refresh,1200);return}
      applied=error.sequence;
      planner.setLmsCalendar(null);state=null;account=null;cache=null;
      localNotice='학교 연결 상태를 확인하지 못했어요. 시간표 데모가 실행 중인지 확인한 뒤 다시 연결해 주세요.';render();
    }
    timer=setTimeout(refresh,running()||busyConnections.has(state?.connection)?1200:5000);
  }
  async function act(route,body={}){
    if(acting)return;acting=true;localNotice='';render();
    try{await request(route,body)}catch(error){localNotice=error.message}
    finally{acting=false;render()}
  }

  function renderCourses(){
    const courses=state?.courses||[];
    const terms=[...new Map(courses.map(course=>[course.termId,course.termName])).entries()];
    const nextTerms=JSON.stringify(terms);
    if(nextTerms!==termSignature){
      termSignature=nextTerms;const previous=$('lms-term').value;
      const all=node('option','모든 학기');all.value='';$('lms-term').replaceChildren(all);
      for(const [id,name] of terms){if(!id)continue;const option=node('option',name);option.value=id;$('lms-term').append(option)}
      $('lms-term').value=terms.some(([id])=>id===previous)?previous:'';
    }
    const visible=visibleCourses(),signature=JSON.stringify([visible,[...selected],locked()]);
    if(signature!==courseSignature){
      courseSignature=signature;$('lms-courses').replaceChildren();
      for(const course of visible){
        const label=node('label','','lms-course'),checkbox=document.createElement('input');
        checkbox.type='checkbox';checkbox.value=course.id;checkbox.checked=selected.has(course.id);checkbox.disabled=locked();
        checkbox.addEventListener('change',()=>{if(checkbox.checked)selected.add(course.id);else selected.delete(course.id);render()});
        const copy=node('span');copy.append(node('strong',course.name),node('small',course.termName));label.append(checkbox,copy);$('lms-courses').append(label);
      }
    }
    $('lms-no-courses').hidden=visible.length>0;
    $('lms-selection-count').textContent=`${selected.size}개 선택`;
    $('lms-sync').disabled=locked()||!account||!selected.size;
    $('lms-sync').textContent=cache?'선택한 과목 일정 새로고침':'선택한 과목 일정 가져오기';
    for(const id of ['lms-search','lms-term','lms-select-visible','lms-clear'])$(id).disabled=locked();
  }

  function render(){
    const connection=state?.connection||'disconnected',pending=busyConnections.has(connection),connected=connection==='connected';
    const titles={restoring:'저장된 학교 로그인 확인 중',opening:'학교 로그인 창을 열고 있어요',waiting:'학교 창에서 로그인을 완료해 주세요',checking:'로그인 확인 중',loading:'내 수강 과목을 확인하고 있어요',background:'학교 연결을 백그라운드로 전환 중',disconnecting:'학교 연결을 해제하고 있어요',connected:'학교 계정 연결됨',disconnected:'내 수강 과목과 연결하기',error:'학교 계정을 다시 연결해 주세요'};
    $('lms-connection-title').textContent=state?.job?.reconnect?'학교 계정을 다시 연결해 주세요':titles[connection];
    $('lms-connection-description').textContent=connected?(state.remembered?'다음 실행에도 이 프로젝트의 학교 연결을 복원해요.':'이 실행에서 연결되어 있어요. 다음에 다시 로그인해야 할 수 있어요.'):pending?'로그인이 끝나면 학교 창은 자동으로 닫힙니다.':'연결 후 가져올 과목을 직접 고를 수 있어요.';
    $('lms-badge').textContent=running()?'일정 가져오는 중':pending?'연결 중':account?'연결됨':'연결 필요';
    $('lms-badge').className=account?'badge':'badge neutral';
    $('lms-connect').hidden=connected&&!state?.job?.reconnect;
    $('lms-connect').disabled=acting||running()||pending;
    $('lms-connect').textContent=state?.job?.reconnect?'학교 계정 다시 연결':'숭실대 LMS 연결';
    $('lms-disconnect').hidden=!connected&&!pending;
    $('lms-disconnect').disabled=acting||running()||connection==='disconnecting';
    $('lms-disconnect').textContent=pending?'연결 취소':'학교 로그아웃';
    $('lms-login-help').hidden=!['waiting','checking'].includes(connection);
    $('lms-confirm').disabled=acting||connection!=='waiting';$('lms-focus').disabled=acting;
    const message=localNotice||state?.notice||'';
    $('lms-message').textContent=message;$('lms-message').hidden=!message;
    $('lms-message').className='message'+(localNotice||connection==='error'||state?.job?.phase==='error'?' error':'');
    $('lms-course-picker').hidden=!account;renderCourses();
    $('lms-cancel').hidden=!running();$('lms-cancel').disabled=acting||state?.job?.phase==='cancelling';
    $('lms-progress').hidden=!running();
    if(running()){
      $('lms-progress-label').textContent=state.job.phase==='cancelling'?'가져오기를 중단하고 있어요.':`${state.job.current}/${state.job.total} 과목 확인 중 · ${state.job.name||'연결 확인'}`;
      $('lms-progress-bar').max=Math.max(1,state.job.total);$('lms-progress-bar').value=state.job.current;
    }
    $('lms-result').hidden=!cache;
    if(cache){
      $('lms-result-title').textContent=`LMS 일정 ${cache.events.length}개가 캘린더에 있어요.`;
      $('lms-result-detail').textContent=resultDetail||'마지막 가져오기 · '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(cache.syncedAt));
      $('lms-show-calendar').disabled=!cache.events.length;
    }
    const warnings=account&&cache?.lastResultId===state?.result?.id?state?.result?.warnings||[]:[];
    $('lms-warnings').hidden=!warnings.length;
    $('lms-warnings').textContent=`일부 정보를 확인하지 못한 항목이 ${warnings.length}개 있어요. 확인된 일정은 반영했고, 누락된 기존 일정은 보존했어요. 최종 마감은 LMS 원문에서도 확인해 주세요.`;
  }

  $('lms-connect').addEventListener('click',()=>act('connect'));
  $('lms-disconnect').addEventListener('click',()=>act('disconnect'));
  $('lms-focus').addEventListener('click',()=>act('focus-login'));
  $('lms-confirm').addEventListener('click',()=>act('confirm-login'));
  $('lms-sync').addEventListener('click',()=>{failedResult=null;act('collect',{courseIds:[...selected]})});
  $('lms-cancel').addEventListener('click',()=>act('cancel'));
  $('lms-search').addEventListener('input',renderCourses);$('lms-term').addEventListener('change',renderCourses);
  $('lms-select-visible').addEventListener('click',()=>{for(const course of visibleCourses())selected.add(course.id);render()});
  $('lms-clear').addEventListener('click',()=>{selected.clear();render()});
  $('lms-show-calendar').addEventListener('click',()=>planner.showLmsCalendar());
  refresh();
}
