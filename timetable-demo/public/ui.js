import {sectionLocation, timeText} from './planner-core.mjs';

export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// One stroke icon set, drawn on a 24px grid and coloured by the surrounding text.
const iconPaths={
  back:'<path d="M15 18l-6-6 6-6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close:'<path d="M6 6l12 12M18 6 6 18"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  home:'<path d="M4 10.5 12 4l8 6.5V20H15v-6H9v6H4z"/>',
  build:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/>',
  career:'<circle cx="12" cy="12" r="8"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  calendar:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  download:'<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14"/>',
  alert:'<path d="M12 4 3 20h18z"/><path d="M12 10v4M12 17v.5"/>',
  search:'<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  spark:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  book:'<path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  minus:'<path d="M5 12h14"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  sliders:'<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  info:'<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8v.5"/>',
  sun:'<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  moon:'<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  lunch:'<path d="M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3"/>',
  compact:'<path d="M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3M5 12h14"/>',
  pencil:'<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/><path d="m14.5 6.5 3 3"/>',
  bookmark:'<path d="M7 4h10v16l-5-3.5L7 20z"/>',
  pin:'<path d="M12 21s6-5.4 6-10.5a6 6 0 0 0-12 0C6 15.6 12 21 12 21z"/><circle cx="12" cy="10.5" r="2"/>',
  cap:'<path d="M3 9.5 12 5l9 4.5-9 4.5z"/><path d="M7 12v4c1.5 1.3 3.2 2 5 2s3.5-.7 5-2v-4"/>',
  layers:'<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>',
  chat:'<path d="M5 6h14v10H10l-4 3.5V16H5z"/>',
  logout:'<path d="M10 5H5v14h5M15 8l4 4-4 4M9 12h10"/>',
  refresh:'<path d="M19 12a7 7 0 1 1-2.2-5.1M19 5v4h-4"/>',
  award:'<circle cx="12" cy="9" r="5"/><path d="m9 13.5-1.5 6.5 4.5-2.5 4.5 2.5-1.5-6.5"/>',
  walk:'<circle cx="13" cy="5" r="1.6"/><path d="m9 21 2.5-6-2-2.5L11 8l3 2.5 3 1M11.5 15l3 2.5V21M9.5 10.5 8 13"/>'
};
export const icon=name=>`<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name]}</svg>`;
export const button=(label,action,variant='primary',attrs='')=>`<button type="button" class="button ${variant}" data-action="${action}" ${attrs}>${label}</button>`;
export const link=(label,route,variant='quiet',attrs='')=>`<a class="button ${variant}" href="#${route}" ${attrs}>${label}</a>`;
export const heading=(title,description='')=>`<div class="heading"><h1 tabindex="-1">${title}</h1>${description?`<p>${description}</p>`:''}</div>`;
export const info=(title,description='',image='',dark=false)=>`<div class="info ${dark?'dark':''}">${image}<div><strong>${title}</strong>${description?`<p>${description}</p>`:''}</div></div>`;
export const field=(label,input)=>`<label class="field"><span>${label}</span>${input}</label>`;
export const toggle=(key,label,checked,description='')=>`<label class="toggle"><span>${label}${description?`<small>${description}</small>`:''}</span><input type="checkbox" data-pref="${key}" ${checked?'checked':''}><span class="switch" aria-hidden="true"></span></label>`;
export const tabs=(items,active,action)=>`<div class="tabs" role="group" data-tabs="${action}">${items.map(([id,label])=>button(esc(label),action,'tab',`data-value="${esc(id)}" aria-pressed="${String(id)===String(active)}"`)).join('')}<span class="tab-indicator" aria-hidden="true"></span></div>`;
export const footer=(content,hint='')=>`<footer class="action-footer">${hint?`<p>${hint}</p>`:''}${content}</footer>`;
export const dayNames=['월','화','수','목','금','토','일'];
const colors=['blue','peach','sage','lavender','rose','teal','olive','slate'];
const sampleColors={ds:'sage',algo:'lavender',db:'blue',media:'olive',bible:'peach'};
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
  document.querySelectorAll('[data-length]').forEach(el=>el.style.height=el.dataset.length+'%');
  document.querySelectorAll('[data-span]').forEach(el=>el.style.height=el.dataset.span+'%');
  document.querySelectorAll('[data-lanes]').forEach(el=>Object.assign(el.style,{left:el.dataset.lane/el.dataset.lanes*100+'%',right:'auto',width:100/el.dataset.lanes+'%'}));
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
