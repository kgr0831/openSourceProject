import {courses} from './catalog.mjs';
import {ortoolsProvider} from './ortools-provider.mjs';
export {courses} from './catalog.mjs';
export const defaultRequest={requiredCourseIds:[],excludedCourseIds:[],preferredCourseIds:[],allowedDays:[0,1,2,3,4],earliestStart:540,latestEnd:1080,credits:{total:{min:13,max:15},major:{min:9,max:12},general:{min:4,max:6}},preferences:{late:true,friday:true,compact:false,travel:false,fewDays:true,lunch:true,breaks:false},maxCoursesPerDay:3,note:''};
export const catalogVersion='ssu-fictional-v1';
const today=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Seoul'}));
Object.assign(defaultRequest,{term:today.getFullYear()+'-'+(today.getMonth()<6?'1':'2'),catalogVersion,rankingProfile:'personalized',attendanceDays:null,morning:null,lunch:{enabled:false},lockedSectionIds:[],excludedSectionIds:[],relaxationPolicy:{max_changed:0,rules:{}}});
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
  const term=raw.term??defaultRequest.term,version=raw.catalogVersion??catalogVersion,rankingProfile=raw.rankingProfile??'personalized';
  if(!/^\d{4}-[12]$/.test(term)||version!==catalogVersion)throw new Error('학기 또는 과목 데이터 버전을 확인해 주세요.');
  if(!['personalized','compact','fewer_days','balanced'].includes(rankingProfile))throw new Error('추천 기준을 확인해 주세요.');
  const sectionIds=new Set(courses.flatMap(c=>c.sections.map(s=>s.id)));
  const sectionList=key=>{const value=raw[key]??[];if(!Array.isArray(value)||value.some(id=>!sectionIds.has(id))||new Set(value).size!==value.length)throw new Error('고정·제외 분반을 확인해 주세요.');return [...value].sort()};
  const attendanceDays=raw.attendanceDays??null,morning=raw.morning??null,lunch=raw.lunch??{enabled:false};
  if(attendanceDays&&(!['exact','max'].includes(attendanceDays.mode)||!Number.isInteger(attendanceDays.value)||attendanceDays.value<0||attendanceDays.value>5))throw new Error('등교일 수를 확인해 주세요.');
  if(morning&&(!['meeting','day'].includes(morning.unit)||!Number.isInteger(morning.max)||morning.max<0||morning.max>30||!Number.isInteger(morning.before_minute)||morning.before_minute<0||morning.before_minute>1440))throw new Error('오전 수업 상한을 확인해 주세요.');
  if(typeof lunch.enabled!=='boolean'||lunch.enabled&&(!['within_window','between_classes'].includes(lunch.placement)||!Number.isInteger(lunch.window_start)||!Number.isInteger(lunch.window_end)||lunch.window_start<0||lunch.window_end>1440||!Number.isInteger(lunch.duration)||lunch.duration<1||lunch.window_start+lunch.duration>lunch.window_end))throw new Error('필수 점심시간을 확인해 주세요.');
  const relaxationPolicy=raw.relaxationPolicy??{max_changed:0,rules:{}};
  return {requiredCourseIds,excludedCourseIds,preferredCourseIds,allowedDays:[...raw.allowedDays].sort(),earliestStart,latestEnd,credits,preferences,maxCoursesPerDay,note:raw.note.trim(),term,catalogVersion:version,rankingProfile,attendanceDays:structuredClone(attendanceDays),morning:structuredClone(morning),lunch:structuredClone(lunch),lockedSectionIds:sectionList('lockedSectionIds'),excludedSectionIds:sectionList('excludedSectionIds'),relaxationPolicy:structuredClone(relaxationPolicy)};
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
export function solverInput(raw){
  const request=validateRequest(raw);
  const sections=courses.flatMap(c=>c.sections.map(s=>({...s,courseId:c.id,name:c.name,shortName:c.shortName,credits:c.credits,kind:c.kind,classification:c.classification,group:c.group,topic:c.topic})));
  const catalog={version:catalogVersion,sections:sections.map(s=>({section_id:s.id,course_id:s.courseId,name:s.name,term:request.term,credits:s.credits,kind:s.kind,group:s.group||null,building:s.building||'',meetings:s.meetings.map(([d,start,end])=>({day:d+1,start,end}))}))};
  const input={term:request.term,catalog_version:catalogVersion,constraints:{allowed_weekdays:request.allowedDays.map(d=>d+1),earliest_start:request.earliestStart,latest_end:request.latestEnd,credits:request.credits.total,kind_credits:{major:request.credits.major,general:request.credits.general},required_course_ids:request.requiredCourseIds,excluded_course_ids:request.excludedCourseIds,locked_section_ids:request.lockedSectionIds,excluded_section_ids:request.excludedSectionIds,attendance_days:request.attendanceDays,morning:request.morning,lunch:request.lunch},ranking:{mode:'lexicographic',profile:request.rankingProfile},selection:{mode:request.rankingProfile==='personalized'?'profiles':'top_k',k:3},legacy_preferences:{...request.preferences,preferred_course_ids:request.preferredCourseIds,max_courses_per_day:request.maxCoursesPerDay},relaxation_policy:request.relaxationPolicy,search_options:{time_limit_seconds:10,workers:1,seed:42}};
  return {request,catalog,input,sections};
}
export async function generateCandidates(raw,{mode='recommend',baseline,signal,searchOptions,selection}={}){
  const {request,catalog,input,sections}=solverInput(raw);
  if(baseline)input.baseline=baseline;
  if(searchOptions)input.search_options=searchOptions;
  if(selection)input.selection=selection;
  const solver=await ortoolsProvider.solve(catalog,input,{mode,signal});
  const knownSections=new Map(sections.map(s=>[s.id,s]));
  const names={fewer_days:'등교일 적게',balanced:'수업량 균형',compact:'공강 짧게'};
  const candidates=solver.recommendations.map((result,i)=>({...candidate(result.section_ids.map(id=>knownSections.get(id)),request),strategy:request.rankingProfile==='personalized'?names[result.profile]:names[result.profile]+' '+(i+1),solverResult:result,requestSnapshot:structuredClone(request)}));
  const diagnostics=[...solver.diagnostics];
  if(!candidates.length){
    if(solver.original_status==='INFEASIBLE'){
      const ranges=request.credits,availableMinutes=request.allowedDays.length*(request.latestEnd-request.earliestStart);
      const required=courses.filter(c=>request.requiredCourseIds.includes(c.id)),groups=required.filter(c=>c.group).map(c=>c.group);
      if(ranges.major.min+ranges.general.min>ranges.total.max||ranges.major.max+ranges.general.max<ranges.total.min)diagnostics.push('전공·교양 학점 범위와 총 학점 범위가 맞지 않습니다.');
      else if(ranges.total.min*60>availableMinutes)diagnostics.push('선택한 요일·시간은 주 '+availableMinutes/60+'시간입니다. 요일이나 시간을 늘리거나 학점을 줄여 주세요.');
      else if(new Set(groups).size!==groups.length)diagnostics.push('같은 교양 교과목군은 한 과목만 포함할 수 있습니다.');
      else diagnostics.push('현재 필수 조건을 모두 만족하는 시간표가 없습니다. 조건을 직접 조정하거나 허용할 완화 범위를 선택해 주세요.');
    }else diagnostics.push('제한 시간 안에 시간표를 찾지 못했습니다. 불가능하다고 판정한 것은 아니므로 다시 시도할 수 있어요.');
  }
  return {request,total:candidates.length,totalUniqueCount:solver.total_unique_count_or_null,candidates,defaultIds:candidates.slice(0,3).map(c=>c.id),limited:solver.coverage==='partial',diagnostics,solver};
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
