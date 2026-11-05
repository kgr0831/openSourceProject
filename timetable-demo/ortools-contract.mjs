// Independent Node-side verification. It never trusts a worker's feasibility label.
import {isDeepStrictEqual as equal} from 'node:util';

export class SolverError extends Error {
  constructor(code,message){super(message);this.name='SolverError';this.code=code}
}
const fail=message=>{throw new SolverError('ENGINE_VALIDATION_FAILED',message)};
export function scaled(value,scale){
  const match=String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if(!match)fail('학점 형식을 검증하지 못했습니다.');
  const digits=match[2]||'',exponent=Number(match[3]||0)-digits.length;
  if(Math.abs(exponent)>12)fail('학점 정밀도를 초과했습니다.');
  let n=BigInt(match[1]+digits)*BigInt(scale),d=1n;
  if(exponent>=0)n*=10n**BigInt(exponent);else d=10n**BigInt(-exponent);
  if(n%d)fail('학점 배율이 정확하지 않습니다.');
  return n/d;
}
const overlap=(a,b)=>a.day===b.day&&a.start<b.end&&b.start<a.end;
const sum=(items,f)=>items.reduce((n,item)=>n+f(item),0);
export function earliestLunch(events,lunch){
  if(!events.length||!lunch?.enabled)return null;
  for(let start=lunch.window_start;start<=lunch.window_end-lunch.duration;start++){
    const end=start+lunch.duration;
    if(events.some(e=>e.start<end&&start<e.end))continue;
    if(lunch.placement==='between_classes'&&!(events.some(e=>e.end<=start)&&events.some(e=>e.start>=end)))continue;
    return {start,end};
  }
  return null;
}
export function solverMetrics(sections,constraints,preferences,scale){
  const out={attendance_days:0,day_list:[],total_gap_minutes:0,latest_end:0,max_daily_teaching_minutes:0,morning_meeting_count:0,morning_day_count:0,friday_classes:0,building_changes:0,max_daily_courses:0,lunch_missed_days:0,back_to_back_classes:0,legacy_morning_count:0};
  const lunches=[];
  for(let day=1;day<=7;day++){
    const events=sections.flatMap(s=>s.meetings.filter(e=>e.day===day).map(e=>({...e,building:s.building||''}))).sort((a,b)=>a.start-b.start);
    if(!events.length)continue;
    out.attendance_days++;out.day_list.push(day);
    const teaching=sum(events,e=>e.end-e.start),cutoff=constraints.morning?.before_minute??720;
    out.total_gap_minutes+=events.at(-1).end-events[0].start-teaching;
    out.latest_end=Math.max(out.latest_end,events.at(-1).end);
    out.max_daily_teaching_minutes=Math.max(out.max_daily_teaching_minutes,teaching);
    out.max_daily_courses=Math.max(out.max_daily_courses,events.length);
    out.morning_meeting_count+=sum(events,e=>Number(e.start<cutoff));
    out.morning_day_count+=Number(events.some(e=>e.start<cutoff));
    out.legacy_morning_count+=sum(events,e=>Number(e.start<720));
    if(day===5)out.friday_classes+=events.length;
    out.lunch_missed_days+=Number(!earliestLunch(events,{enabled:true,window_start:720,window_end:840,duration:60,placement:'within_window'}));
    for(let i=1;i<events.length;i++){out.building_changes+=Number(events[i-1].building!==events[i].building);out.back_to_back_classes+=Number(events[i].start-events[i-1].end<30)}
    const interval=earliestLunch(events,constraints.lunch);if(interval)lunches.push({day,...interval,placement:constraints.lunch.placement});
  }
  const p=preferences||{},matched=new Set(sections.filter(s=>(p.preferred_course_ids||[]).includes(s.course_id)).map(s=>s.course_id)).size;
  out.legacy_cost_units=(p.late?out.legacy_morning_count*200:0)+(p.friday?out.friday_classes*320:0)+(p.compact?out.total_gap_minutes:0)+(p.travel?out.building_changes*80:0)+(p.fewDays?out.attendance_days*240:0)+(p.lunch?out.lunch_missed_days*500:0)+(p.breaks?out.back_to_back_classes*180:0)+(p.max_courses_per_day?Math.max(0,out.max_daily_courses-p.max_courses_per_day)*360:0)-matched*400;
  const credits=sections.reduce((n,s)=>n+scaled(s.credits,scale),0n);out.credits=Number(credits)/scale;
  return {metrics:out,lunches,credits};
}
export function constraintViolations(sections,c,request,scale){
  const violations=new Set(),events=sections.flatMap(s=>s.meetings),ids=new Set(sections.map(s=>s.section_id)),courses=new Set(sections.map(s=>s.course_id));
  if(events.some((a,i)=>events.slice(i+1).some(b=>overlap(a,b))))violations.add('H001');
  if(courses.size!==sections.length)violations.add('H002');
  const {metrics,lunches,credits}=solverMetrics(sections,c,request.legacy_preferences,scale);
  if(credits<scaled(c.credits.min,scale)||credits>scaled(c.credits.max,scale))violations.add('H003');
  if(c.required_course_ids.some(id=>!courses.has(id)))violations.add('H004');
  if(c.excluded_course_ids.some(id=>courses.has(id))||c.excluded_section_ids.some(id=>ids.has(id)))violations.add('H005');
  if(c.locked_section_ids.some(id=>!ids.has(id)))violations.add('H006');
  if(sections.some(s=>s.term!==request.term)||events.some(e=>!c.allowed_weekdays.includes(e.day)||e.start<c.earliest_start||e.end>c.latest_end))violations.add('H007');
  if(c.attendance_days&&(c.attendance_days.mode==='exact'?metrics.attendance_days!==c.attendance_days.value:metrics.attendance_days>c.attendance_days.value))violations.add('H008');
  if(c.morning&&metrics[c.morning.unit==='day'?'morning_day_count':'morning_meeting_count']>c.morning.max)violations.add('H009');
  if(c.lunch.enabled&&lunches.length!==metrics.attendance_days)violations.add('H010');
  const groups=sections.map(s=>s.group).filter(Boolean);if(new Set(groups).size!==groups.length)violations.add('COURSE_GROUP');
  for(const [kind,bounds] of Object.entries(c.kind_credits||{})){
    const count=sections.filter(s=>s.kind===kind).reduce((n,s)=>n+scaled(s.credits,scale),0n);
    if(count<scaled(bounds.min,scale)||count>scaled(bounds.max,scale))violations.add('KIND_CREDITS');
  }
  if(c.protected_total_credits!==undefined&&credits!==scaled(c.protected_total_credits,scale))violations.add('PROTECTED_CREDITS');
  return [...violations];
}
export function verifySolverResult(catalog,input,result){
  if(result.engine!=='ortools-cp-sat'||!/^\d+\.\d+\.\d+$/.test(result.engine_version)||!Array.isArray(result.phase_results))fail('실제 CP-SAT 실행 메타데이터가 없습니다.');
  const request=result.normalized_request,scale=result.credit_scale;
  for(const phase of result.phase_results){
    if(phase.proven!== (phase.raw_status==='OPTIMAL')||phase.relative_gap_limit!==0||phase.absolute_gap_limit!==0)fail('탐색 단계의 증명 정보가 맞지 않습니다.');
    // CP-SAT exposes the bound as a double (e.g. 21.999999999999996 for 22).
    // Keep the raw value; this serialization tolerance never changes solver gaps.
    const tolerance=Math.max(1e-7,Number.EPSILON*Math.max(1,Math.abs(phase.objective_value))*4);
    if(phase.proven&&phase.objective_value!==null&&(!Number.isFinite(phase.best_bound)||Math.abs(phase.objective_value-phase.best_bound)>tolerance))fail('최적값과 증명 경계가 일치하지 않습니다.');
  }
  if(result.original_status!=='PER_TARGET'&&result.original_status!=='BUDGET_EXHAUSTED'&&result.phase_results.find(p=>p.stage==='original/feasibility')?.raw_status!==result.original_status)fail('원래 조건의 판정 상태가 일치하지 않습니다.');
  if(result.coverage==='exhaustive'&&result.phase_results.at(-1)?.raw_status!=='INFEASIBLE')fail('전수 종료를 증명하지 않았습니다.');
  if(!Number.isInteger(scale)||scale<1||scale>1000000||request.term!==input.term||request.catalog_version!==catalog.version)fail('솔버의 입력 범위가 달라졌습니다.');
  const setFields=['allowed_weekdays','required_course_ids','excluded_course_ids','excluded_section_ids','locked_section_ids','section_ids','failed_section_ids','preferred_course_ids'];
  const normalizedEqual=(key,a,b)=>equal(setFields.includes(key)?[...a].sort():a,setFields.includes(key)?[...b].sort():b);
  for(const [key,value] of Object.entries(input.constraints))if(!normalizedEqual(key,value,request.constraints[key]))fail('원래 조건이 변경되었습니다: '+key);
  for(const key of ['ranking','selection','relaxation_policy','baseline','legacy_preferences','search_options'])if(input[key]!==undefined){for(const [field,value] of Object.entries(input[key]))if(!normalizedEqual(field,value,request[key]?.[field]))fail('요청 정책이 변경되었습니다: '+key)}
  if(!equal(result.original_constraints,request.constraints))fail('원래 조건 메타데이터가 일치하지 않습니다.');
  const known=new Map(catalog.sections.map(s=>[s.section_id,{kind:'major',group:null,building:'',name:s.course_id,...s}])),seen=new Set();
  for(const candidate of result.recommendations){
    if(!Array.isArray(candidate.section_ids)||new Set(candidate.section_ids).size!==candidate.section_ids.length||candidate.section_ids.some(id=>!known.has(id)))fail('알 수 없거나 중복된 분반이 반환되었습니다.');
    const identity=[...candidate.section_ids].sort().join('\u0000');if(seen.has(identity))fail('같은 시간표가 중복 반환되었습니다.');seen.add(identity);
    const sections=candidate.section_ids.map(id=>known.get(id)),effective=candidate.effective_constraints,original=structuredClone(request.constraints);
    if(candidate.credit_target!==undefined&&request.selection.mode==='by_credit'){if(!request.selection.credit_targets.includes(candidate.credit_target))fail('허용하지 않은 학점 목표입니다.');original.protected_total_credits=candidate.credit_target}
    const rebuilt=structuredClone(original),changes=candidate.changes||[],changedKeys=new Set();
    if(changes.length&&(result.mode!=='relax'||(candidate.target_original_status||result.original_status)!=='INFEASIBLE'))fail('불가능 증명 없이 조건을 완화했습니다.');
    if(changes.length>(request.relaxation_policy?.max_changed||0))fail('허용한 변경 수를 초과했습니다.');
    for(const change of changes){
      const rule=request.relaxation_policy?.rules?.[change.condition];
      if(!rule?.allow||changedKeys.has(change.condition)||!rule.allowed_values.some(v=>equal(v,change.to)))fail('허용되지 않은 조건 변경입니다.');
      changedKeys.add(change.condition);
      const source=change.condition==='credit_range'?original.credits:change.condition==='attendance_days'?original.attendance_days?.value:change.condition==='morning_limit'?original.morning?.max:change.condition==='lunch_duration'?original.lunch?.duration:undefined;
      if(!equal(source,change.from)||equal(change.from,change.to))fail('변경 전후 조건이 올바르지 않습니다.');
      const delta=change.condition==='credit_range'?Number(scaled(source.min,scale)-scaled(change.to.min,scale)+scaled(change.to.max,scale)-scaled(source.max,scale))/scale:Math.abs(source-change.to);
      if(scaled(delta,scale)!==BigInt(change.units)*scaled(rule.step,scale)||change.importance!==rule.importance)fail('완화 비용이 일치하지 않습니다.');
      if(change.condition==='credit_range')rebuilt.credits=change.to;
      else if(change.condition==='attendance_days')rebuilt.attendance_days.value=change.to;
      else if(change.condition==='morning_limit')rebuilt.morning.max=change.to;
      else rebuilt.lunch.duration=change.to;
    }
    if(!equal(rebuilt,effective))fail('보호 조건 또는 정책에 없는 조건이 변경되었습니다.');
    const {metrics,lunches,credits}=solverMetrics(sections,effective,request.legacy_preferences,scale);
    const effectiveErrors=constraintViolations(sections,effective,request,scale);
    if(effectiveErrors.length)fail('반환된 시간표가 조건을 어깁니다: '+effectiveErrors.join(', '));
    if(candidate.credit_target!==undefined&&credits!==scaled(candidate.credit_target,scale))fail('대표 학점이 일치하지 않습니다.');
    const cost={changed_condition_count:changes.length,sum_changed_importance:sum(changes,c=>c.importance),sum_normalized_change_units:sum(changes,c=>c.units)};
    if(result.mode==='alternative'){
      const baseline=request.baseline,old=baseline.section_ids.map(id=>known.get(id)),oldCourses=new Set(old.map(s=>s.course_id)),newCourses=new Set(sections.map(s=>s.course_id));
      const symmetric=(a,b)=>[...a].filter(x=>!b.has(x)).length+[...b].filter(x=>!a.has(x)).length;
      cost.course_changes=symmetric(oldCourses,newCourses);cost.section_changes=symmetric(new Set(baseline.section_ids),new Set(candidate.section_ids));
      if(candidate.section_ids.some(id=>baseline.failed_section_ids.includes(id))||(!baseline.allow_course_replacement&&cost.course_changes))fail('대체안의 과목/분반 보호 조건 위반입니다.');
      if(baseline.preserve_credit_total&&credits!==old.reduce((n,s)=>n+scaled(s.credits,scale),0n))fail('대체안이 기존 학점을 바꿨습니다.');
      const order=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
      const expected={removed_course_ids:[...oldCourses].filter(id=>!newCourses.has(id)).sort(order),added_course_ids:[...newCourses].filter(id=>!oldCourses.has(id)).sort(order),removed_section_ids:baseline.section_ids.filter(id=>!candidate.section_ids.includes(id)).sort(order),added_section_ids:candidate.section_ids.filter(id=>!baseline.section_ids.includes(id)).sort(order),section_replacements:[...oldCourses].filter(cid=>newCourses.has(cid)).sort(order).flatMap(cid=>{const from=old.find(s=>s.course_id===cid).section_id,to=sections.find(s=>s.course_id===cid).section_id;return from===to?[]:[{course_id:cid,from,to}]})};
      if(!equal(expected,candidate.alternative_changes))fail('대체안의 변경 내역이 실제 선택과 다릅니다.');
    }
    for(const [key,value] of Object.entries(metrics))if(!equal(value,candidate.metrics[key]))fail('솔버 지표 불일치: '+key);
    for(const [key,value] of Object.entries(candidate.model_metrics))if(!equal(value,{...metrics,...cost}[key]))fail('모델 지표 불일치: '+key);
    if(!equal(lunches,candidate.lunch_intervals))fail('점심 구간이 재계산 결과와 다릅니다.');
    candidate.validation={effective_valid:true,original_valid:constraintViolations(sections,original,request,scale).length===0,original_violations:constraintViolations(sections,original,request,scale)};
  }
  if(result.returned_unique_count!==seen.size||result.coverage==='partial'&&result.total_unique_count_or_null!==null||result.coverage==='exhaustive'&&result.total_unique_count_or_null!==seen.size)fail('고유 시간표 개수와 탐색 범위가 일치하지 않습니다.');
  return result;
}
