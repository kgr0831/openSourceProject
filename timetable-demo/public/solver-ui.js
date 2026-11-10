import {esc,field,button} from './ui.js';

const labels={'ranking-profile':'추천 기준','attendance-mode':'등교일 조건','attendance-value':'등교일 수','morning-max':'오전 수업 상한','morning-unit':'오전 집계 단위','lunch-duration':'필수 점심 길이','lunch-placement':'필수 점심 위치','relax-count':'최대 변경 항목 수'};
function select(id,items,value){return '<select id="'+id+'" aria-label="'+labels[id]+'">'+items.map(([key,label])=>'<option value="'+key+'" '+(String(key)===String(value)?'selected':'')+'>'+label+'</option>').join('')+'</select>'}
export function hardConditions(r){
  const attendance=r.attendanceDays,morning=r.morning,lunch=r.lunch;
  return field('추천 기준',select('ranking-profile',[['personalized','내 선호 함께 반영'],['compact','공강이 짧은 순'],['fewer_days','등교일이 적은 순'],['balanced','하루 수업량이 고른 순']],r.rankingProfile))+
    '<small>세부 선호는 ‘내 선호 함께 반영’에서 반영해요. 다른 기준은 해당 기준의 우선순위를 엄격하게 지켜요.</small>'+
    '<details class="disclosure"><summary>반드시 지킬 생활 조건</summary><div class="stack compact">'+
    field('등교일 수',select('attendance-mode',[['','제한 없음'],['max','최대'],['exact','정확히']],attendance?.mode||'')+select('attendance-value',[1,2,3,4,5].map(n=>[n,n+'일']),attendance?.value??3))+
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
export function relaxationChoices(r){
  const rules={};
  if(r.attendanceDays){const v=r.attendanceDays.value,values=[v-1,v+1].filter(n=>n>=1&&n<=r.allowedDays.length&&(r.attendanceDays.mode==='exact'||n>v));if(values.length)rules.attendance_days={label:'등교일 '+v+'일 → '+values.join('일 또는 ')+'일',values,step:1}}
  if(r.morning)rules.morning_limit={label:'오전 수업 상한 '+r.morning.max+' → '+(r.morning.max+1)+' 또는 '+(r.morning.max+2),values:[r.morning.max+1,r.morning.max+2],step:1};
  const c=r.credits.total,values=[1,2].map(n=>({min:Math.max(1,c.min-n),max:Math.min(24,c.max+n)})).filter(v=>v.min!==c.min||v.max!==c.max);
  if(values.length)rules.credit_range={label:'총 학점 범위를 위아래 최대 2학점 넓히기',values,step:1};
  if(r.lunch.enabled&&r.lunch.duration>15)rules.lunch_duration={label:'필수 점심 '+r.lunch.duration+'분 → '+[15,30].map(n=>r.lunch.duration-n).filter(n=>n>0).join('분 또는 ')+'분',values:[15,30].map(n=>r.lunch.duration-n).filter(n=>n>0),step:15};
  return rules;
}
export function relaxationDialog(r){
  const choices=relaxationChoices(r);
  return '<div class="dialog-heading"><h2 id="dialog-title">어디까지 바꿔도 괜찮나요?</h2>'+button('×','close-dialog','icon-button','aria-label="닫기"')+'</div><p>선택한 항목 중 가장 적게 바꾸는 방법을 찾아요. 과목·요일·시간과 전공·교양 학점 조건은 유지해요.</p><form id="relax-form" class="stack">'+Object.entries(choices).map(([key,item])=>'<label class="replace-confirm"><input type="checkbox" name="'+key+'">'+esc(item.label)+'</label>').join('')+field('한 번에 바꿀 항목 수',select('relax-count',[[1,'최대 1개'],[2,'최대 2개']],1))+'<small>모든 항목의 중요도는 같아요. 변경된 조건을 확인한 뒤 시간표를 저장할 수 있어요.</small><p id="relax-error" class="form-error" role="alert"></p><button type="submit" class="button primary">허용한 범위에서 찾기</button></form>';
}
export function relaxationPolicy(r,form){
  const values=new FormData(form),rules={};
  for(const [key,item] of Object.entries(relaxationChoices(r)))if(values.has(key))rules[key]={allow:true,importance:1,step:item.step,allowed_values:item.values};
  if(!Object.keys(rules).length)throw new Error('변경을 허용할 항목을 하나 이상 선택해 주세요.');
  return {max_changed:Number(document.getElementById('relax-count').value),rules};
}
export function changesNotice(candidate){
  const r=candidate.solverResult;if(!r)return '';
  const labels={attendance_days:'등교일',morning_limit:'오전 수업 상한',credit_range:'총 학점 범위',lunch_duration:'필수 점심시간'};
  const value=v=>typeof v==='object'?v.min+'–'+v.max:String(v);
  const changes=(r.changes||[]).map(c=>esc(labels[c.condition]+': '+value(c.from)+' → '+value(c.to)));
  if(r.alternative_changes)changes.push(...r.alternative_changes.section_replacements.map(p=>esc(p.from+' → '+p.to)));
  return changes.length?'<div class="card condition-changes" role="status"><strong>이 추천안에서 달라지는 점</strong>'+changes.map(text=>'<p>'+text+'</p>').join('')+'<small>저장 전까지 기존 시간표와 입력 조건은 그대로예요.</small></div>':'';
}
