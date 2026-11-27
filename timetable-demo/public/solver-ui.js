import {esc,icon,field,button,dayNames} from './ui.js';
import {timeText} from './planner-core.mjs';
import {relaxationChoices,relaxationRule} from './relaxation-options.mjs';

const labels={'ranking-profile':'추천 기준','attendance-mode':'등교일 조건','attendance-value':'등교일 수','morning-max':'오전 수업 상한','morning-unit':'오전 집계 단위','lunch-duration':'필수 점심 길이','lunch-placement':'필수 점심 위치','relax-count':'최대 변경 항목 수'};
function select(id,items,value){return '<select id="'+id+'" aria-label="'+labels[id]+'">'+items.map(([key,label])=>'<option value="'+key+'" '+(String(key)===String(value)?'selected':'')+'>'+label+'</option>').join('')+'</select>'}
export function hardConditions(r){
  const attendance=r.attendanceDays,morning=r.morning,lunch=r.lunch;
  return field('추천 기준',select('ranking-profile',[['personalized','내 선호 함께 반영'],['compact','공강이 짧은 순'],['fewer_days','등교일이 적은 순'],['balanced','하루 수업량이 고른 순']],r.rankingProfile))+
    '<small>세부 선호는 ‘내 선호 함께 반영’에서 반영해요. 다른 기준은 해당 기준의 우선순위를 엄격하게 지켜요.</small>'+
    '<details class="disclosure"><summary>반드시 지킬 생활 조건</summary><div class="stack compact">'+
    field('등교일 수',select('attendance-mode',[['','제한 없음'],['max','최대'],['exact','정확히']],attendance?.mode||'')+select('attendance-value',[1,2,3,4,5,6,7].map(n=>[n,n+'일']),attendance?.value??3))+
    field('오전 12시 이전 수업',select('morning-max',[['','제한 없음'],...[0,1,2,3,4,5,6].map(n=>[n,'최대 '+n])],morning?.max??'')+select('morning-unit',[['meeting','수업 횟수로 계산'],['day','수업이 있는 날로 계산']],morning?.unit||'meeting'))+
    '<label class="replace-confirm"><input id="hard-lunch" type="checkbox" '+(lunch.enabled?'checked':'')+'>점심시간을 반드시 확보하기</label>'+
    field('12시–14시 사이 연속 휴식',select('lunch-duration',[30,45,60,75,90].map(n=>[n,n+'분']),lunch.duration||60)+select('lunch-placement',[['within_window','점심 구간 안에서 확보'],['between_classes','앞뒤로 수업이 있는 사이']],lunch.placement||'within_window'))+
    '<small>조건을 만족하지 못하면 추천하지 않아요. 조건 변경은 따로 허용해야 해요.</small></div></details>';
}
export function updateHardCondition(r,element){
  const el=id=>document.getElementById(id),id=element.id;
  if(id==='ranking-profile')r.rankingProfile=element.value;
  if(id.startsWith('attendance-'))r.attendanceDays=el('attendance-mode').value?{mode:el('attendance-mode').value,value:Number(el('attendance-value').value)}:null;
  if(id.startsWith('morning-'))r.morning=el('morning-max').value!==''?{before_minute:720,max:Number(el('morning-max').value),unit:el('morning-unit').value}:null;
  if(['hard-lunch','lunch-duration','lunch-placement'].includes(id))r.lunch={enabled:el('hard-lunch').checked,window_start:720,window_end:840,duration:Number(el('lunch-duration').value),placement:el('lunch-placement').value};
  if(['ranking-profile','hard-lunch'].includes(id)||/^(attendance|morning|lunch)-/.test(id))r.relaxationPolicy={max_changed:0,rules:{}};
}
export function relaxationDialog(r){
  const choices=relaxationChoices(r);
  return '<div class="dialog-heading"><h2 id="dialog-title">어디까지 바꿔도 괜찮나요?</h2>'+button(icon('close'),'close-dialog','icon-button','aria-label="닫기"')+'</div><p>선택한 항목 중 가장 적게 바꾸는 방법을 찾아요. 과목·요일·시간과 전공·교양 학점 조건은 유지해요.</p><form id="relax-form" class="stack">'+Object.entries(choices).map(([key,item])=>'<label class="replace-confirm"><input type="checkbox" name="'+key+'">'+esc(item.label)+'</label>').join('')+field('한 번에 바꿀 항목 수',select('relax-count',[[1,'최대 1개'],[2,'최대 2개']],1))+'<small>모든 항목의 중요도는 같아요. 변경된 조건을 확인한 뒤 시간표를 저장할 수 있어요.</small><p id="relax-error" class="form-error" role="alert"></p><button type="submit" class="button primary">허용한 범위에서 찾기</button></form>';
}
export function relaxationPolicy(r,form){
  const values=new FormData(form),rules={};
  for(const [key,item] of Object.entries(relaxationChoices(r)))if(values.has(key))rules[key]=relaxationRule(item);
  if(!Object.keys(rules).length)throw new Error('변경을 허용할 항목을 하나 이상 선택해 주세요.');
  return {max_changed:Number(document.getElementById('relax-count').value),rules};
}
const conditionLabels={
  attendance_days:'등교일',morning_limit:'오전 수업 상한',credit_range:'총 학점 범위',lunch_duration:'필수 점심시간',
  earliest_start:'시작 가능 시각',latest_end:'종료 가능 시각'
};
function conditionChange({condition,from,to},separator=' '){
  const value=condition==='earliest_start'||condition==='latest_end'?timeText:
    v=>typeof v==='object'?v.min+'–'+v.max:String(v);
  return conditionLabels[condition]+separator+value(from)+' → '+value(to);
}
function emptyReason(reason){
  const {kind,course,issues}=reason;
  if(kind==='missing')return course+'의 모든 분반에서 수업 시간을 확인할 수 없어요.';
  if(kind==='excluded')return course+'은 현재 고정·제외 조건에서 선택할 수 있는 분반이 없어요.';
  if(kind==='window')return course+'의 선택 가능한 분반이 현재 요일·시간 조건에 맞지 않아요.';
  if(kind==='attendance'){
    return '현재 조건에서 수업일은 최대 '+reason.actual+'일이에요. 등교일을 정확히 '+reason.expected+'일로 설정했어요.';
  }
  if(kind==='overlap'){
    const names=reason.courses.join(' · ');
    if(!reason.overlap)return names+'을 모두 배치할 수 있는 분반 조합이 없어요.';
    const {day,start,end}=reason.overlap;
    const time=dayNames[day]+'요일 '+timeText(start)+'~'+timeText(end);
    return names+(reason.example?'의 분반 조합마다 시간이 겹쳐요. '+time+'은 겹치는 시간의 한 예예요.':'의 수업이 '+time+'에 겹쳐요.');
  }
  const days=[...new Set(issues.map(({day})=>dayNames[day]+'요일'))].join('·');
  if(kind==='day')return course+'의 선택 가능한 분반마다 '+days+'처럼 등교 요일에서 빠진 날에 수업이 있어요.';

  const times=[...new Set(issues.map(({day,minute})=>dayNames[day]+'요일 '+timeText(minute)))].join(', ');
  return course+'의 선택 가능한 분반마다 '+times+(kind==='early'?'처럼 시작 조건보다 이른 수업이 있어요. 설정한 시작 가능 시각은 ':
    '처럼 종료 조건보다 늦게 끝나는 수업이 있어요. 설정한 종료 가능 시각은 ')+timeText(issues[0].limit)+'이에요.';
}
export function emptyGuidanceView(guidance){
  const reasons=guidance.reasons.length?'<ul>'+guidance.reasons.map(reason=>'<li>'+esc(emptyReason(reason))+'</li>').join('')+'</ul>':
    '<p>현재 자료와 설정만으로는 원인을 특정할 수 없어요.</p>';
  const options=guidance.options.length?'<ol class="empty-option-list">'+guidance.options.map(({changes},i)=>
    '<li><h3>조건 '+changes.length+'개 변경</h3><ul id="empty-option-changes-'+i+'">'+
    changes.map(change=>'<li>'+esc(conditionChange(change))+'</li>').join('')+'</ul>'+
    button('이 조건으로 후보 보기','view-empty-option','secondary','data-value="'+i+'" aria-describedby="empty-option-changes-'+i+'"')+'</li>').join('')+'</ol>':
    '<p>검증된 변경안이 없어요.</p>';
  return '<div class="empty-guidance"><section class="card" aria-labelledby="empty-reasons-heading">'+
    '<h2 id="empty-reasons-heading">내 시간표가 나오지 않은 이유</h2>'+reasons+'</section>'+
    '<section class="card" aria-labelledby="empty-options-heading"><h2 id="empty-options-heading">가능한 변경안</h2>'+options+'</section></div>';
}

export function changesNotice(candidate){
  const r=candidate.solverResult;if(!r)return '';
  const changes=[...(candidate.previewChanges||[]),...(r.changes||[])].map(change=>esc(conditionChange(change,': ')));
  if(r.alternative_changes)changes.push(...r.alternative_changes.section_replacements.map(p=>esc(p.from+' → '+p.to)));
  return changes.length?'<div class="card condition-changes" role="status"><strong>이 추천안에서 달라지는 점</strong>'+changes.map(text=>'<p>'+text+'</p>').join('')+'<small>저장 전까지 기존 시간표와 입력 조건은 그대로예요.</small></div>':'';
}
