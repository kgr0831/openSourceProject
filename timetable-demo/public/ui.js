import {sectionLocation, timeText} from './planner-core.mjs';

export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// One stroke icon set, drawn on a 24px grid and coloured by the surrounding text.
const iconPaths={
  back:'<path d="M14.5 6.5 9 12l5.5 5.5"/>',
  plus:'<path d="M12 5.5v13M5.5 12h13"/>',
  minus:'<path d="M5.5 12h13"/>',
  check:'<path d="m5.5 12.5 4.2 4.2 8.8-9.2"/>',
  close:'<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  chevron:'<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
  down:'<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  arrow:'<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
  home:'<path d="M4.5 11 11 5.3a1.6 1.6 0 0 1 2 0L19.5 11v6.5A2.5 2.5 0 0 1 17 20h-2.2v-4a1.8 1.8 0 0 0-1.8-1.8h-2A1.8 1.8 0 0 0 9.2 16v4H7a2.5 2.5 0 0 1-2.5-2.5z"/>',
  build:'<rect x="4" y="4" width="16" height="16" rx="5"/><path d="M4 10h16M10 10v10"/>',
  career:'<circle cx="12" cy="12" r="8.5"/><path d="m15.4 8.6-1.8 5-5 1.8 1.8-5z"/>',
  calendar:'<rect x="4" y="5.5" width="16" height="14.5" rx="4.5"/><path d="M4 10.5h16M8.5 3.5V7M15.5 3.5V7"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  download:'<path d="M12 4.5v10M7.5 10.5 12 15l4.5-4.5M5.5 19.5h13"/>',
  alert:'<path d="M10.3 5.2 3.6 17a2 2 0 0 0 1.7 3h13.4a2 2 0 0 0 1.7-3L13.7 5.2a2 2 0 0 0-3.4 0z"/><path d="M12 10v4M12 17v.2"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  user:'<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c.6-3.6 3.6-5.5 7.5-5.5s6.9 1.9 7.5 5.5"/>',
  spark:'<path d="M12 4c.6 4.4 3.6 7.4 8 8-4.4.6-7.4 3.6-8 8-.6-4.4-3.6-7.4-8-8 4.4-.6 7.4-3.6 8-8z"/>',
  book:'<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4H19v13H7.5A2.5 2.5 0 0 0 5 19.5z"/><path d="M5 19.5A2.5 2.5 0 0 0 7.5 22H19"/>',
  sliders:'<path d="M4.5 7.5h8M17.5 7.5h2M4.5 16.5h2M11.5 16.5h8"/><circle cx="15" cy="7.5" r="2.5"/><circle cx="9" cy="16.5" r="2.5"/>',
  info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.2"/>',
  sun:'<circle cx="12" cy="12" r="3.8"/><path d="M12 3.5v1.5M12 19v1.5M3.5 12H5M19 12h1.5M6 6l1 1M17 17l1 1M6 18l1-1M17 7l1-1"/>',
  moon:'<path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z"/>',
  lunch:'<path d="M5 9.5h11v4.5a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 5 14z"/><path d="M16 10.5h1a2.5 2.5 0 0 1 0 5h-1M8.5 3.5v3M12.5 3.5v3"/>',
  compact:'<path d="M12 3.5v5.5M9 6.5l3 3 3-3M12 20.5V15M9 17.5l3-3 3 3M5 12h14"/>',
  pencil:'<path d="M4.5 19.5l.9-4L16.2 4.7a2.1 2.1 0 0 1 3 3L8.5 18.6z"/><path d="m14.5 6.5 3 3"/>',
  bookmark:'<path d="M7 6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14l-5-3.5L7 20z"/>',
  pin:'<path d="M12 20.5s6.5-5.3 6.5-10.3a6.5 6.5 0 0 0-13 0c0 5 6.5 10.3 6.5 10.3z"/><circle cx="12" cy="10.2" r="2.3"/>',
  cap:'<path d="M3 9.5 12 5l9 4.5-9 4.5z"/><path d="M7 12v4c1.5 1.4 3.2 2 5 2s3.5-.6 5-2v-4"/>',
  layers:'<path d="m12 4.5 8 4-8 4-8-4z"/><path d="m4 12.5 8 4 8-4M4 16.5l8 4 8-4"/>',
  chat:'<path d="M7 5h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-5.5L7 19.5V16a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z"/>',
  logout:'<path d="M10 4.5H7.5a2.5 2.5 0 0 0-2.5 2.5v10a2.5 2.5 0 0 0 2.5 2.5H10M15 8l4 4-4 4M9.5 12H19"/>',
  refresh:'<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5M19.5 4.5v4.3h-4.3"/>',
  award:'<circle cx="12" cy="9.5" r="5.5"/><path d="m8.8 14-1.3 6 4.5-2.5 4.5 2.5-1.3-6"/>',
  walk:'<circle cx="13" cy="5" r="1.8"/><path d="m9 21 2.5-6-2-2.5L11 8l3 2.5 3 1M11.5 15l3 2.5V21M9.5 10.5 8 13"/>'
};
export const icon=name=>`<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name]}</svg>`;
export const button=(label,action,variant='primary',attrs='')=>`<button type="button" class="button ${variant}" data-action="${action}" ${attrs}>${label}</button>`;
export const link=(label,route,variant='quiet',attrs='')=>`<a class="button ${variant}" href="#${route}" ${attrs}>${label}</a>`;
export const heading=(title,description='')=>`<div class="heading"><h1 tabindex="-1">${title}</h1>${description?`<p>${description}</p>`:''}</div>`;
export const info=(title,description='',image='',dark=false)=>`<div class="info ${dark?'dark':''}">${image}<div><strong>${title}</strong>${description?`<p>${description}</p>`:''}</div></div>`;
export const field=(label,input)=>`<label class="field"><span>${label}</span>${input}</label>`;
export const toggle=(key,label,checked,description='')=>`<label class="toggle"><span>${label}${description?`<small>${description}</small>`:''}</span><input type="checkbox" data-pref="${key}" ${checked?'checked':''}><span class="switch" aria-hidden="true"></span></label>`;
export const tabs=(items,active,action)=>`<div class="tabs" role="group" data-tabs="${action}">${items.map(([id,label])=>button(esc(label),action,'tab',`data-value="${esc(id)}" aria-pressed="${String(id)===String(active)}"`)).join('')}<span class="tab-indicator" aria-hidden="true"></span></div>`;
export const footer=(content,hint='')=>`<footer class="action-footer">${hint?`<p>${hint}</p>`:''}${content}</footer>`;
export const dayNames=['월','화','수','목','금','토','일'];
const colors=['sky','peach','lime','lavender','pink','yellow','cocoa','slate'];
const sampleColors={ds:'lime',algo:'lavender',db:'sky',media:'yellow',bible:'pink'};
const colorKey='ssu-timetable-course-colors',colorStore=globalThis.localStorage;
let colorOrder=[];
try{colorOrder=JSON.parse(colorStore?.getItem(colorKey))||[]}catch{}
// Courses take the next colour in order of first appearance, so the ones on screen together differ.
// ponytail: round-robin over eight colours; a ninth simultaneous course repeats the first. Assign by least-used if that shows up.
export function courseColor(id){
  if(sampleColors[id])return sampleColors[id];
  let index=colorOrder.indexOf(id);
  if(index<0){index=colorOrder.push(id)-1;try{colorStore?.setItem(colorKey,JSON.stringify(colorOrder))}catch{}}
  return colors[index%colors.length];
}
export const duration=minutes=>minutes<60?minutes+'분':Math.floor(minutes/60)+'시간'+(minutes%60?' '+minutes%60+'분':'');
// A section may carry `variant` (is-option / is-outside / is-conflict) and a short `note` for the builder's live week.
// `window` greys out the days and hours the student ruled out; `empty` draws the grid even with no classes yet.
export function timetable(candidate,action='section',{fullDetails=false,window=null,empty=false,now=null}={}){
  const sections=candidate?.sections||[];
  if(!sections.length&&!empty)return '';
  const soft=s=>/is-option|is-preview/.test(s.variant||'');
  const placed=sections.flatMap(s=>s.meetings);
  const shownDays=dayNames.slice(0,Math.max(5,...sections.flatMap(s=>s.meetings).map(m=>m[0]+1),...(window?.allowedDays||[]).map(d=>d+1)));
  const start=Math.min(540,...placed.map(m=>Math.floor(m[1]/60)*60));
  const end=Math.max(1080,...placed.map(m=>Math.ceil(m[2]/60)*60)),hours=(end-start)/60;
  const labels=Array.from({length:hours},(_,i)=>`<span class="hour" data-offset="${i/hours*100}">${start/60+i}</span>`).join('');
  const rows=Array.from({length:hours},(_,i)=>`<span class="hour-line" data-offset="${i/hours*100}"></span>`).join('');
  const span=(from,to)=>`<span class="off-hours" aria-hidden="true" data-offset="${(from-start)/(end-start)*100}" data-span="${(to-from)/(end-start)*100}"></span>`;
  const offHours=window?(window.earliestStart>start?span(start,Math.min(window.earliestStart,end)):'')+(window.latestEnd<end?span(Math.max(window.latestEnd,start),end):''):'';
  const off=day=>window&&!window.allowedDays.includes(day);
  const lanes=new Map();
  shownDays.forEach((_,day)=>{
    const items=sections.filter(s=>!soft(s)).flatMap(s=>s.meetings.filter(m=>m[0]===day)).sort((a,b)=>a[1]-b[1]||a[2]-b[2]);
    let cluster=[],clusterEnd=-1;
    const flush=()=>{const ends=[];for(const m of cluster){let lane=ends.findIndex(e=>e<=m[1]);if(lane<0)lane=ends.push(0)-1;ends[lane]=m[2];lanes.set(m,[lane])}for(const m of cluster)lanes.get(m).push(ends.length)};
    for(const m of items){if(cluster.length&&m[1]>=clusterEnd){flush();cluster=[]}cluster.push(m);clusterEnd=Math.max(clusterEnd,m[2])}
    if(cluster.length)flush();
  });
  const nowLine=day=>now&&now.day===day&&now.minute>start&&now.minute<end?`<span class="now-line" aria-hidden="true" data-offset="${(now.minute-start)/(end-start)*100}"></span>`:'';
  const columns=shownDays.map((_,day)=>`<div class="day-column${off(day)?' off':''}${now?.day===day?' today':''}">${nowLine(day)}${sections.map(s=>s.meetings.filter(m=>m[0]===day).map(meeting=>{
    const [,from,to]=meeting,location=sectionLocation(s,s.meetings.indexOf(meeting));
    const time=timeText(from)+'–'+timeText(to);
    const label=[s.name,dayNames[day]+' '+time,location,s.note].filter(Boolean).join(', ');
    const details=s.note?'<span class="class-detail"><span>'+esc(s.note)+'</span></span>':'<span class="class-detail">'+(fullDetails?'<span>'+time+'</span>':'')+(location?'<span class="room">'+esc(location)+'</span><span class="room short">'+esc(location.match(/\S*\d\S*$/)?.[0]||location)+'</span>':'')+'</span>';
    const [lane,count]=lanes.get(meeting)||[0,1];
    return `<button class="class-block ${/is-preview/.test(s.variant||'')?'':courseColor(s.courseId)} ${s.variant||''}" ${count>1?`data-lane="${lane}" data-lanes="${count}"`:''} data-action="${action}" data-id="${esc(s.courseId)}" data-offset="${(from-start)/(end-start)*100}" data-length="${(to-from)/(end-start)*100}" aria-label="${esc(label)}" title="${esc(label)}"><strong>${esc(fullDetails?s.name:s.shortName||s.name)}</strong>${details}</button>`;
  }).join('')).join('')}</div>`).join('');
  return `<div class="timetable" data-hours="${hours}" data-days="${shownDays.length}" aria-label="주간 시간표"><div class="week-header"><span></span>${shownDays.map((d,day)=>`<span class="${off(day)?'off':''}${now?.day===day?' today':''}"><b>${d}</b></span>`).join('')}</div><div class="week-body"><div class="time-labels">${labels}</div><div class="schedule-grid">${rows}${offHours}<div class="day-columns">${columns}</div></div></div></div>`;
}
export function layoutTimetables(){
  document.querySelectorAll('.timetable').forEach(el=>{el.style.setProperty('--hours',el.dataset.hours);el.style.setProperty('--days',el.dataset.days||5)});
  document.querySelectorAll('[data-offset]').forEach(el=>el.style.top=el.dataset.offset+'%');
  document.querySelectorAll('.class-block[data-length]').forEach(el=>el.style.height=`calc(${el.dataset.length}% - 3px)`);
  document.querySelectorAll('[data-span]').forEach(el=>el.style.height=el.dataset.span+'%');
  document.querySelectorAll('[data-lanes]').forEach(el=>Object.assign(el.style,{left:`calc(${el.dataset.lane/el.dataset.lanes*100}% + 2px)`,right:'auto',width:`calc(${100/el.dataset.lanes}% - 4px)`}));
}
// A week drawn small: course rows and candidate cards show when a class meets instead of saying it.
export function miniWeek(sections,{days=5,from=540,to=1080,label=''}={}){
  const meetings=sections.flatMap(s=>s.meetings.map(m=>[s,m]));
  const end=Math.max(to,...meetings.map(([,m])=>m[2])),span=end-from,w=40/days;
  const rects=meetings.filter(([,m])=>m[0]<days).map(([s,[day,start,stop]])=>{
    const y=Math.max(0,(start-from)/span*32),h=Math.max(2,(Math.min(stop,end)-Math.max(start,from))/span*32);
    return `<rect class="${s.courseId?courseColor(s.courseId):''}" x="${(day*w+.5).toFixed(2)}" y="${y.toFixed(2)}" width="${(w-1).toFixed(2)}" height="${h.toFixed(2)}" rx="1"/>`;
  }).join('');
  const tracks=Array.from({length:days},(_,day)=>`<rect class="track" x="${(day*w+.5).toFixed(2)}" y="0" width="${(w-1).toFixed(2)}" height="32" rx="1"/>`).join('');
  return `<svg class="mini-week" viewBox="0 0 40 32" ${label?`role="img" aria-label="${esc(label)}"`:'aria-hidden="true"'} focusable="false">${tracks}${rects}</svg>`;
}
// Short, interruptible feedback. No animation delays navigation or data changes.
export function animateElements(elements,{distance=12,duration=360,stagger=35,scale=1}={}){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  [...elements].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&r.top<innerHeight&&r.bottom>0}).slice(0,12).forEach((el,i)=>{
    el.animate?.([{opacity:0,transform:`translateY(${distance}px) scale(${scale})`},{opacity:1,transform:'translateY(0) scale(1)'}],{duration,delay:Math.min(i*stagger,180),easing:'cubic-bezier(.22,1,.36,1)',fill:'backwards'});
  });
}
export function layoutTabs(previous=new Map()){
  document.querySelectorAll('[data-tabs]').forEach(group=>{
    const active=group.querySelector('[aria-pressed="true"]'),indicator=group.querySelector('.tab-indicator');
    if(!active||!indicator||!group.offsetWidth)return;
    Object.assign(indicator.style,{left:active.offsetLeft+'px',top:active.offsetTop+'px',width:active.offsetWidth+'px',height:active.offsetHeight+'px'});
    const before=previous.get(group.dataset.tabs),after=active.getBoundingClientRect();
    if(before&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      indicator.animate?.([{transform:`translateX(${before.left-after.left}px)`,width:before.width+'px'},{transform:'translateX(0)',width:after.width+'px'}],{duration:260,easing:'cubic-bezier(.22,1,.36,1)'});
    }
  });
}
// Rank valid candidates without relaxing hard constraints.
export function compareOptions(candidates){
  const picked=[],strategies=[
    {label:'등교일 적게',score:c=>c.metrics.days*10000+c.cost},
    {label:'고르게 듣기',score:c=>(c.metrics.longestDayMinutes??longestDay(c))*100+c.cost},
    {label:'공강 줄이기',score:c=>c.metrics.gapMinutes*100+c.cost}
  ];
  for(const strategy of strategies){
    const available=candidates.filter(c=>!picked.some(p=>p.id===c.id));
    available.sort((a,b)=>strategy.score(a)-strategy.score(b)||a.id.localeCompare(b.id));
    if(available[0])picked.push({...available[0],strategy:strategy.label});
  }
  return picked;
}
export function longestDay(c){return Math.max(...dayNames.map((_,d)=>c.sections.flatMap(s=>s.meetings).filter(m=>m[0]===d).reduce((n,m)=>n+m[2]-m[1],0)))}
