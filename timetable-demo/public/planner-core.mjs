import {validateCareerList} from './career-model.mjs';
import {validateLmsEvent} from './lms-calendar.mjs';

export const careerTracks = [
  {id:'vision',name:'AI · 컴퓨터비전',description:'수학과 프로그래밍 기초부터 영상 이해까지 살펴보는 예시예요.',stages:[['기초',['prog1','aimath','stats']],['핵심',['ds','ml','math2']],['심화',['deep','vision','drive']]]},
  {id:'data',name:'데이터 분석',description:'데이터를 저장하고 분석하는 과목을 단계별로 살펴봐요.',stages:[['기초',['prog1','stats','aimath']],['핵심',['db','science','ml']],['심화',['bigdata','deep','nlp']]]},
  {id:'web',name:'웹 · 백엔드',description:'프로그래밍에서 웹 서비스와 시스템까지 이어지는 예시예요.',stages:[['기초',['prog1','prog2','ds']],['핵심',['web','db','net']],['심화',['server','os','design']]]}
];
export const experienceExamples = [
  {id:'foundation',title:'기초부터 쌓는 학기',track:'web',stage:0,courseIds:['prog1','discrete','open'],body:'처음 접하는 분야라면 기초 과목을 먼저 살펴보세요. 공식 강의계획서와 본인의 학습 경험을 확인한 뒤 선택하는 흐름을 시연해요.'},
  {id:'vision',title:'컴퓨터비전을 탐색하는 학기',track:'vision',stage:1,courseIds:['aimath','ml','deep'],body:'관심 분야의 과목을 우선 추천하되, 모든 과목을 한 학기에 넣을 필요는 없어요. 학점과 등교일 조건에 맞는 조합을 비교하는 예시예요.'},
  {id:'balance',title:'전공과 교양을 함께 고르는 학기',track:'data',stage:1,courseIds:['db','science','reading','writing'],body:'전공 관심 분야와 교양의 주제를 함께 고려하는 예시예요. 과제량이나 학점 취득 난이도를 보장하는 수강 후기는 아니에요.'}
];
const kinds = new Set(['class','exam','makeup','personal']);
export const kindLabels = {class:'수업',exam:'시험',makeup:'보강',personal:'개인 일정'};
const dayMs = 86400000;
export function parseDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('날짜를 확인해 주세요.');
  const date=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new Error('날짜를 확인해 주세요.');
  return date;
}
export function addDays(value,days){const date=parseDate(value);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
export function daysBetween(a,b){return (parseDate(b)-parseDate(a))/dayMs}
export function weekStart(value){return addDays(value,-((parseDate(value).getUTCDay()+6)%7))}
export function koreanToday(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
export function timeText(minutes){return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')}
export function timeValue(value){if(typeof value!=='string'||!/^\d{2}:\d{2}$/.test(value))return NaN;const [h,m]=value.split(':').map(Number);return h<24&&m<60?h*60+m:NaN}
export function validatePeriod(start,end){const length=daysBetween(start,end);if(length<0||length>216)throw new Error('학기 기간은 시작일부터 최대 31주까지 설정해 주세요.');return {start,end}}
export function validateEvent(event) {
  if(event?.source==='lms')return validateLmsEvent(event);
  if(!event||typeof event!=='object'||typeof event.id!=='string'||!event.id||event.id.length>200)throw new Error('일정 정보를 확인해 주세요.');
  parseDate(event.date);
  if(typeof event.title!=='string'||!event.title.trim()||event.title.length>100)throw new Error('일정 이름을 100자 이내로 입력해 주세요.');
  if(typeof event.location!=='string'||event.location.length>100)throw new Error('장소는 100자 이내로 입력해 주세요.');
  if(!Number.isInteger(event.start)||!Number.isInteger(event.end)||event.start<0||event.end>1439||event.start>=event.end)throw new Error('일정의 종료 시간은 시작 시간보다 늦어야 해요.');
  if(!kinds.has(event.kind)||!['active','cancelled'].includes(event.status))throw new Error('일정 종류를 확인해 주세요.');
  return event;
}
export function createSemesterEvents(candidate,start,end) {
  validatePeriod(start,end);
  if(!candidate?.sections?.length||candidate.sections.length>30)throw new Error('먼저 추천 시간표를 선택해 주세요.');
  const events=[];
  for(let date=start;date<=end;date=addDays(date,1)) {
    const day=(parseDate(date).getUTCDay()+6)%7;
    for(const section of candidate.sections)for(const [index,[meetingDay,from,to]] of section.meetings.entries()) {
      if(day!==meetingDay)continue;
      const original={date,start:from,end:to,title:section.name,location:section.building,kind:'class'};
      events.push(validateEvent({...original,id:`${section.id}:${date}:${index}`,seriesId:`${section.id}:${index}`,courseId:section.courseId,original,status:'active'}));
    }
  }
  if(!events.length)throw new Error('선택한 기간에 수업이 없어요. 학기 시작일과 종료일을 확인해 주세요.');
  return events;
}
export function editEvents(events,id,patch,{scope='one',action='edit',period}={}) {
  const target=events.find(event=>event.id===id);
  if(!target)throw new Error('수정할 일정을 찾지 못했어요.');
  if(!['one','future'].includes(scope)||!['edit','cancel','restore'].includes(action))throw new Error('일정 변경 방식을 확인해 주세요.');
  if(scope==='future'&&!target.seriesId)throw new Error('반복 수업에만 이후 일정 변경을 적용할 수 있어요.');
  if(action==='restore'&&!target.original&&target.status!=='cancelled')throw new Error('취소된 일정을 선택해 주세요.');
  const shift=action==='edit'?daysBetween(target.date,patch.date):0;
  const updated=events.map(event=>{
    const matches=event.id===id||(scope==='future'&&event.seriesId===target.seriesId&&event.original.date>=target.original.date);
    if(!matches)return event;
    let next;
    if(action==='restore')next={...event,...(event.original||{}),status:'active'};
    else if(action==='cancel')next={...event,status:'cancelled'};
    else next={...event,title:patch.title.trim(),location:patch.location.trim(),kind:patch.kind,start:patch.start,end:patch.end,date:addDays(event.date,shift)};
    validateEvent(next);
    if(period&&(next.date<period.start||next.date>period.end))throw new Error('변경된 일정이 학기 기간을 벗어나요. 이번 일정만 변경하거나 학기 안의 날짜를 선택해 주세요.');
    return next;
  });
  return updated;
}
export function conflictPairs(events) {
  const active=events.filter(event=>event.status==='active'&&!event.point&&!event.allDay).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start),pairs=[];
  for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length&&active[j].date===active[i].date;j++) {
    if(active[j].start>=active[i].end)break;
    if(active[i].start<active[j].end)pairs.push([active[i].id,active[j].id]);
  }
  return pairs;
}
export function careerSelection(trackId,stage,completed,courseList) {
  const track=careerTracks.find(track=>track.id===trackId),known=new Set(courseList.map(course=>course.id));
  if(!track||!Number.isInteger(stage)||stage<0||stage>=track.stages.length)throw new Error('진로와 학습 단계를 선택해 주세요.');
  if(!Array.isArray(completed)||completed.some(id=>!known.has(id)))throw new Error('이수한 과목을 확인해 주세요.');
  return track.stages[stage][1].filter(id=>known.has(id)&&!completed.includes(id));
}
function escapeIcs(value){return String(value).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,')}
function foldIcs(line) {
  const encoder=new TextEncoder();let output='',part='',length=0;
  for(const char of line){const bytes=encoder.encode(char).length;if(length+bytes>75){output+=part+'\r\n';part=' ';length=1}part+=char;length+=bytes}
  return output+part;
}
function utcStamp(date,minute){return new Date(date+'T'+timeText(minute)+':00+09:00').toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}
export function exportCalendar(events,now=new Date()) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//SSU Timetable Demo//KO','CALSCALE:GREGORIAN','X-WR-CALNAME:숭실대 학기 일정'];
  const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  for(const event of events) {
    validateEvent(event);if(event.status==='cancelled')continue;
    if(event.source==='lms'){
      lines.push('BEGIN:VEVENT','UID:'+encodeURIComponent(event.id)+'@ssu-timetable.local','DTSTAMP:'+stamp);
      if(event.allDay)lines.push('DTSTART;VALUE=DATE:'+event.date.replace(/-/g,''),'DTEND;VALUE=DATE:'+event.endDate.replace(/-/g,''));
      else{
        const format=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
        lines.push('DTSTART:'+format(event.startAt));if(event.endAt)lines.push('DTEND:'+format(event.endAt));
      }
      lines.push('SUMMARY:'+escapeIcs(event.title),'LOCATION:'+escapeIcs(event.location),'DESCRIPTION:'+escapeIcs(event.lmsKind==='deadline'?'LMS 마감 기한':'LMS 일정'));
      if(event.sourceUrl)lines.push('URL:'+escapeIcs(event.sourceUrl));
      lines.push('END:VEVENT');continue;
    }
    lines.push('BEGIN:VEVENT','UID:'+encodeURIComponent(event.id)+'@ssu-timetable.local','DTSTAMP:'+stamp,'DTSTART:'+utcStamp(event.date,event.start),'DTEND:'+utcStamp(event.date,event.end),'SUMMARY:'+escapeIcs(event.title),'LOCATION:'+escapeIcs(event.location),'DESCRIPTION:'+escapeIcs(kindLabels[event.kind]+' · 시간표 데모에서 내보낸 일정'),'END:VEVENT');
  }
  lines.push('END:VCALENDAR');return lines.map(foldIcs).join('\r\n')+'\r\n';
}
export function emptyPlanner(){return {version:1,semester:null,events:[],experiences:[]}}
export function restorePlanner(value) {
  if(value?.careerRecommendations!==undefined)validateCareerList(value.careerRecommendations);
  if(!value||value.version!==1||!Array.isArray(value.events)||value.events.length>2000||!Array.isArray(value.experiences)||value.experiences.length>50)throw new Error('저장된 학기 기록을 읽지 못했어요.');
  if(value.semester){validatePeriod(value.semester.start,value.semester.end);if(!value.semester.candidate?.sections?.length)throw new Error('저장된 시간표가 올바르지 않아요.')}
  else if(value.events.length)throw new Error('학기 없는 일정은 불러올 수 없어요.');
  const ids=new Set();
  for(const event of value.events){validateEvent(event);if(ids.has(event.id))throw new Error('중복된 일정이 있어요.');ids.add(event.id);if(event.seriesId){if(typeof event.seriesId!=='string'||!event.original)throw new Error('반복 수업 정보가 올바르지 않아요.');validateEvent({...event,...event.original})}}
  for(const entry of value.experiences){if(typeof entry.id!=='string'||typeof entry.title!=='string'||entry.title.length>80||typeof entry.body!=='string'||entry.body.length>600||!Array.isArray(entry.courseNames)||entry.courseNames.length>30||entry.courseNames.some(name=>typeof name!=='string'||name.length>100))throw new Error('저장된 수강 경험이 올바르지 않아요.')}
  return value;
}
