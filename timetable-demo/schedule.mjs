import {courses} from './catalog.mjs';
export {courses} from './catalog.mjs';
export const defaultRequest={requiredCourseIds:[],excludedCourseIds:[],preferredCourseIds:[],allowedDays:[0,1,2,3,4],earliestStart:540,latestEnd:1080,credits:{total:{min:13,max:15},major:{min:9,max:12},general:{min:4,max:6}},preferences:{late:true,friday:true,compact:false,travel:false,fewDays:true,lunch:true,breaks:false},maxCoursesPerDay:3,note:''};
const known=new Map(courses.map(c=>[c.id,c]));
const preferenceKeys=Object.keys(defaultRequest.preferences);
function ids(value,label){if(!Array.isArray(value)||value.length>courses.length||value.some(id=>!known.has(id))||new Set(value).size!==value.length)throw new Error(label+' 과목을 확인해 주세요.');return [...value].sort()}
export function validateRequest(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('조건을 다시 선택해 주세요.');
  const requiredCourseIds=ids(raw.requiredCourseIds,'필수 포함'),excludedCourseIds=ids(raw.excludedCourseIds,'제외'),preferredCourseIds=ids(raw.preferredCourseIds||[],'관심');
  if(requiredCourseIds.some(id=>excludedCourseIds.includes(id)))throw new Error('같은 과목을 필수 포함과 제외로 동시에 지정할 수 없습니다.');
  if(!Array.isArray(raw.allowedDays)||!raw.allowedDays.length||raw.allowedDays.some(d=>!Number.isInteger(d)||d<0||d>4)||new Set(raw.allowedDays).size!==raw.allowedDays.length)throw new Error('등교할 수 있는 요일을 1개 이상 선택해 주세요.');
  const {earliestStart,latestEnd}=raw;
  if(!Number.isInteger(earliestStart)||!Number.isInteger(latestEnd)||earliestStart<540||latestEnd>1260||earliestStart>=latestEnd)throw new Error('수업 시간은 09:00~21:00 안에서 시작보다 끝이 늦어야 합니다.');
  const credits={};
  for(const key of ['total','major','general']){
    const range=raw.credits?.[key];
    if(!range||!Number.isInteger(range.min)||!Number.isInteger(range.max)||range.min<0||range.max>24||range.min>range.max)throw new Error('학점 범위는 0~24 안에서 최소가 최대보다 작거나 같아야 합니다.');
    credits[key]={min:range.min,max:range.max};
  }
  if(credits.total.min<1)throw new Error('총 학점은 1학점 이상으로 설정해 주세요.');
  const preferences={};for(const key of preferenceKeys){const value=raw.preferences?.[key]??(['lunch','breaks'].includes(key)?false:undefined);if(typeof value!=='boolean')throw new Error('선호 조건을 확인해 주세요.');preferences[key]=value}
  const maxCoursesPerDay=raw.maxCoursesPerDay??null;
  if(maxCoursesPerDay!==null&&(!Number.isInteger(maxCoursesPerDay)||maxCoursesPerDay<1||maxCoursesPerDay>8))throw new Error('하루 수업량은 1~8과목으로 선택해 주세요.');
  if(typeof raw.note!=='string'||raw.note.length>400)throw new Error('AI 요청은 400자 이내로 입력해 주세요.');
  return {requiredCourseIds,excludedCourseIds,preferredCourseIds,allowedDays:[...raw.allowedDays].sort(),earliestStart,latestEnd,credits,preferences,maxCoursesPerDay,note:raw.note.trim()};
}
export function hasConflict(sections){const events=sections.flatMap(s=>s.meetings);return events.some((a,i)=>events.slice(i+1).some(b=>a[0]===b[0]&&a[1]<b[2]&&a[2]>b[1]))}
export function measure(sections){
  const metrics={days:0,dayList:[],morningClasses:0,fridayClasses:0,gapMinutes:0,buildingChanges:0,maxDailyCourses:0,longestDayMinutes:0,lunchMissedDays:0,backToBackClasses:0};
  for(let day=0;day<5;day++){
    const events=sections.flatMap(s=>s.meetings.filter(m=>m[0]===day).map(m=>({start:m[1],end:m[2],building:s.building}))).sort((a,b)=>a.start-b.start);
    if(events.length){metrics.days++;metrics.dayList.push(day)}
    metrics.maxDailyCourses=Math.max(metrics.maxDailyCourses,events.length);
    metrics.longestDayMinutes=Math.max(metrics.longestDayMinutes,events.reduce((n,e)=>n+e.end-e.start,0));
    if(events.length){
      const lunch=events.filter(e=>e.start<840&&e.end>720);let cursor=720,largest=0;
      for(const e of lunch){largest=Math.max(largest,Math.max(720,e.start)-cursor);cursor=Math.max(cursor,Math.min(840,e.end))}
      largest=Math.max(largest,840-cursor);if(largest<60)metrics.lunchMissedDays++;
      metrics.backToBackClasses+=events.filter((e,i)=>i>0&&e.start-events[i-1].end<30).length;
    }
    events.forEach((event,i)=>{if(event.start<720)metrics.morningClasses++;if(day===4)metrics.fridayClasses++;if(i){metrics.gapMinutes+=event.start-events[i-1].end;if(event.building!==events[i-1].building)metrics.buildingChanges++}});
  }
  return metrics;
}
function candidate(sections,request){
  const metrics=measure(sections),p=request.preferences;
  const majorCredits=sections.filter(s=>s.kind==='major').reduce((n,s)=>n+s.credits,0),generalCredits=sections.filter(s=>s.kind==='general').reduce((n,s)=>n+s.credits,0);
  const matched=sections.filter(s=>request.preferredCourseIds.includes(s.courseId)).length;
  const cost=(p.late?metrics.morningClasses*10:0)+(p.friday?metrics.fridayClasses*16:0)+(p.compact?metrics.gapMinutes/20:0)+(p.travel?metrics.buildingChanges*4:0)+(p.fewDays?metrics.days*12:0)+(p.lunch?metrics.lunchMissedDays*25:0)+(p.breaks?metrics.backToBackClasses*9:0)+(request.maxCoursesPerDay?Math.max(0,metrics.maxDailyCourses-request.maxCoursesPerDay)*18:0)-matched*20;
  return {id:sections.map(s=>s.id).sort().join('_'),sections,metrics,credits:majorCredits+generalCredits,majorCredits,generalCredits,cost:Math.round(cost*10)/10};
}
function compare(a,b){return a.cost-b.cost||a.id.localeCompare(b.id)}
function compatible(plan,section,request){
  if(plan.sections.some(s=>s.courseId===section.courseId||(section.group&&s.group===section.group)))return false;
  if(hasConflict([...plan.sections,section]))return false;
  const max=request.credits;
  return plan.credits+section.credits<=max.total.max&&plan.majorCredits+(section.kind==='major'?section.credits:0)<=max.major.max&&plan.generalCredits+(section.kind==='general'?section.credits:0)<=max.general.max;
}
function complete(plan,request){return [['total',plan.credits],['major',plan.majorCredits],['general',plan.generalCredits]].every(([key,n])=>n>=request.credits[key].min&&n<=request.credits[key].max)}
// Bounded beam search. Returned schedules satisfy hard constraints; no claim of global optimality.
function prune(plans,perCredit=36){
  const buckets=new Map();let limited=false;
  for(const plan of plans){const key=plan.majorCredits+'/'+plan.generalCredits;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(plan)}
  const kept=[];
  for(const entries of buckets.values()){
    entries.sort(compare);
    if(entries.length<=perCredit){kept.push(...entries);continue}
    limited=true;const groups=new Map();
    for(const p of entries){const key=p.metrics.dayList.join('');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p)}
    const lists=[...groups.values()];let count=0;
    for(let layer=0;count<perCredit;layer++){let found=false;for(const list of lists){if(list[layer]){kept.push(list[layer]);count++;found=true;if(count===perCredit)break}}if(!found)break}
  }
  return {plans:kept,limited};
}
export function selectDiverse(candidates,count=3){
  const remaining=[...candidates].sort(compare),selected=[];
  while(remaining.length&&selected.length<count){
    let best=0,bestScore=Infinity;
    remaining.forEach((p,i)=>{
      const subjects=new Set(p.sections.map(s=>s.courseId));
      const similarity=selected.length?Math.max(...selected.map(s=>{const common=s.sections.filter(t=>subjects.has(t.courseId)).length;return 24*common/Math.max(p.sections.length,s.sections.length)+(p.metrics.dayList.join('')===s.metrics.dayList.join('')?8:0)})):0;
      const score=p.cost+similarity;if(score<bestScore){bestScore=score;best=i}
    });
    selected.push(remaining.splice(best,1)[0]);
  }
  return selected;
}
export function generateCandidates(raw){
  const request=validateRequest(raw),diagnostics=[];
  const empty=()=>({request,total:0,candidates:[],defaultIds:[],limited:false,diagnostics});
  const ranges=request.credits;
  if(ranges.major.min+ranges.general.min>ranges.total.max||ranges.major.max+ranges.general.max<ranges.total.min){diagnostics.push('전공·교양 학점 범위와 총 학점 범위가 맞지 않습니다.');return empty()}
  const availableMinutes=request.allowedDays.length*(request.latestEnd-request.earliestStart);
  if(ranges.total.min*60>availableMinutes){diagnostics.push('선택한 요일·시간은 주 '+availableMinutes/60+'시간입니다. 최소 '+ranges.total.min+'학점을 담으려면 요일이나 수업 시간을 늘리거나 학점을 줄여 주세요.');return empty()}
  const pool=courses.filter(c=>!request.excludedCourseIds.includes(c.id)).map(c=>({...c,sections:c.sections.filter(s=>s.meetings.every(([d,start,end])=>request.allowedDays.includes(d)&&start>=request.earliestStart&&end<=request.latestEnd)).map(s=>({...s,courseId:c.id,name:c.name,shortName:c.shortName,credits:c.credits,kind:c.kind,classification:c.classification,group:c.group,topic:c.topic}))}));
  const required=pool.filter(c=>request.requiredCourseIds.includes(c.id));
  for(const c of required)if(!c.sections.length)diagnostics.push(c.name+': 선택한 요일·시간에 가능한 분반이 없습니다.');
  const groups=required.filter(c=>c.group).map(c=>c.group);
  if(new Set(groups).size!==groups.length)diagnostics.push('같은 교양 교과목군은 한 과목만 포함할 수 있습니다.');
  if(diagnostics.length)return empty();
  let plans=[candidate([],request)],limited=false;
  for(const course of required){
    const next=plans.flatMap(p=>course.sections.filter(s=>compatible(p,s,request)).map(s=>candidate([...p.sections,s],request)));
    const cut=prune(next);plans=cut.plans;limited||=cut.limited;
    if(!plans.length){diagnostics.push('필수 포함 과목끼리 시간이 겹치거나 최대 학점을 초과합니다.');return {...empty(),limited}}
  }
  const optional=pool.filter(c=>!request.requiredCourseIds.includes(c.id)&&c.sections.length).sort((a,b)=>Number(request.preferredCourseIds.includes(b.id))-Number(request.preferredCourseIds.includes(a.id))||a.id.localeCompare(b.id));
  for(const course of optional){
    const next=[...plans];
    for(const p of plans)for(const s of course.sections)if(compatible(p,s,request))next.push(candidate([...p.sections,s],request));
    const cut=prune(next);plans=cut.plans;limited||=cut.limited;
  }
  const valid=plans.filter(p=>complete(p,request)).sort(compare);
  const candidates=selectDiverse(valid,36);
  if(!candidates.length)diagnostics.push('현재 조건에서 시간표를 찾지 못했습니다. 학점 범위를 넓히거나 등교 요일·시간을 늘려 주세요.');
  return {request,total:valid.length,candidates,defaultIds:selectDiverse(candidates).map(c=>c.id),limited,diagnostics};
}
export function validateAiResult(raw,candidates){
  const allowed=new Set(candidates.map(c=>c.id)),count=Math.min(3,candidates.length);
  if(!raw||typeof raw.summary!=='string'||raw.summary.length>500||!Array.isArray(raw.recommendations)||raw.recommendations.length!==count)throw new Error('AI 응답 형식이 올바르지 않습니다. 다시 추천해 주세요.');
  const seen=new Set();for(const r of raw.recommendations){if(!r||!allowed.has(r.id)||seen.has(r.id)||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>400)throw new Error('검증되지 않은 AI 추천입니다. 다시 추천해 주세요.');seen.add(r.id)}
  return {summary:raw.summary,recommendations:raw.recommendations.map(r=>({id:r.id,reason:r.reason}))};
}
export const outputSchema={type:'object',additionalProperties:false,properties:{summary:{type:'string'},recommendations:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},reason:{type:'string'}},required:['id','reason']}}},required:['summary','recommendations']};
const nullableNumber={type:['integer','null']},nullableIds={type:['array','null'],items:{type:'string'}},nullableBool={type:['boolean','null']};
const intentProperties={summary:{type:'string'},unsupported:{type:'array',items:{type:'string'}},allowedDays:{type:['array','null'],items:{type:'integer'}},earliestStart:nullableNumber,latestEnd:nullableNumber,totalMin:nullableNumber,totalMax:nullableNumber,majorMin:nullableNumber,majorMax:nullableNumber,generalMin:nullableNumber,generalMax:nullableNumber,requiredCourseIds:nullableIds,excludedCourseIds:nullableIds,preferredCourseIds:nullableIds,preferences:{type:'object',additionalProperties:false,properties:Object.fromEntries(preferenceKeys.map(k=>[k,nullableBool])),required:preferenceKeys}};
export const intentSchema={type:'object',additionalProperties:false,properties:intentProperties,required:Object.keys(intentProperties)};
export function applyIntent(base,raw){
  const result=structuredClone(validateRequest(base));
  if(!raw||typeof raw.summary!=='string'||raw.summary.length>500||!Array.isArray(raw.unsupported)||raw.unsupported.length>8||raw.unsupported.some(s=>typeof s!=='string'||s.length>300))throw new Error('AI가 해석한 조건을 확인하지 못했습니다. 다시 요청해 주세요.');
  for(const field of ['allowedDays','earliestStart','latestEnd','preferredCourseIds'])if(raw[field]!==null&&raw[field]!==undefined)result[field]=raw[field];
  for(const key of ['total','major','general'])for(const bound of ['min','max']){const field=key+(bound==='min'?'Min':'Max');if(raw[field]!==null&&raw[field]!==undefined)result.credits[key][bound]=raw[field]}
  const added=raw.requiredCourseIds===null?[]:ids(raw.requiredCourseIds,'AI 필수 포함'),removed=raw.excludedCourseIds===null?[]:ids(raw.excludedCourseIds,'AI 제외');
  if(added.some(id=>removed.includes(id)))throw new Error('AI가 같은 과목을 포함과 제외로 해석했습니다. 요청을 구체적으로 적어 주세요.');
  result.requiredCourseIds=[...new Set([...result.requiredCourseIds,...added])].filter(id=>!removed.includes(id));
  result.excludedCourseIds=[...new Set([...result.excludedCourseIds,...removed])].filter(id=>!added.includes(id));
  for(const key of preferenceKeys)if(raw.preferences?.[key]!==null&&raw.preferences?.[key]!==undefined)result.preferences[key]=raw.preferences[key];
  return {request:validateRequest(result),interpretation:{summary:raw.summary,unsupported:raw.unsupported}};
}
