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
  book:'<path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9"/>'
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
const colors=['sage','lavender','blue','peach','sand','teal','rose','slate'];
export const courseColor=id=>({ds:'sage',algo:'lavender',db:'blue',media:'sand',bible:'peach'})[id]||colors[Array.from(id).reduce((sum,c)=>sum+c.charCodeAt(0),0)%colors.length];
// A section may carry `variant` (is-option / is-outside / is-conflict) and a short `note` for the builder's live week.
// `window` greys out the days and hours the student ruled out; `empty` draws the grid even with no classes yet.
export function timetable(candidate,action='section',{fullDetails=false,window=null,empty=false}={}){
  const sections=candidate?.sections||[];
  if(!sections.length&&!empty)return '';
  const meetings=sections.flatMap(s=>s.meetings);
  const shownDays=dayNames.slice(0,Math.max(5,...meetings.map(m=>m[0]+1),...(window?.allowedDays||[]).map(d=>d+1)));
  const start=Math.min(window?Math.min(540,Math.floor(window.earliestStart/60)*60):600,...meetings.map(m=>Math.floor(m[1]/60)*60));
  const end=Math.max(1080,...meetings.map(m=>Math.ceil(m[2]/60)*60)),hours=(end-start)/60;
  const labels=Array.from({length:hours},(_,i)=>`<span class="hour" data-offset="${i/hours*100}">${start/60+i}</span>`).join('');
  const rows=Array.from({length:hours},(_,i)=>`<span class="hour-line" data-offset="${i/hours*100}"></span>`).join('');
  const span=(from,to)=>`<span class="off-hours" aria-hidden="true" data-offset="${(from-start)/(end-start)*100}" data-span="${(to-from)/(end-start)*100}"></span>`;
  const offHours=window?(window.earliestStart>start?span(start,Math.min(window.earliestStart,end)):'')+(window.latestEnd<end?span(Math.max(window.latestEnd,start),end):''):'';
  const off=day=>window&&!window.allowedDays.includes(day);
  // Overlapping classes share their column side by side instead of hiding each other.
  const lanes=new Map();
  shownDays.forEach((_,day)=>{
    const items=sections.flatMap(s=>s.meetings.filter(m=>m[0]===day)).sort((a,b)=>a[1]-b[1]||a[2]-b[2]);
    let cluster=[],end=-1;
    const flush=()=>{const ends=[];for(const m of cluster){let lane=ends.findIndex(e=>e<=m[1]);if(lane<0)lane=ends.push(0)-1;ends[lane]=m[2];lanes.set(m,[lane])}for(const m of cluster)lanes.get(m).push(ends.length)};
    for(const m of items){if(cluster.length&&m[1]>=end){flush();cluster=[]}cluster.push(m);end=Math.max(end,m[2])}
    if(cluster.length)flush();
  });
  const columns=shownDays.map((_,day)=>`<div class="day-column${off(day)?' off':''}">${sections.map(s=>s.meetings.filter(m=>m[0]===day).map(meeting=>{
    const [,from,to]=meeting,location=sectionLocation(s,s.meetings.indexOf(meeting));
    const time=timeText(from)+'–'+timeText(to);
    const label=[s.name,dayNames[day]+' '+time,location,s.note].filter(Boolean).join(', ');
    const details=s.note?'<span class="class-detail">'+esc(s.note)+'</span>':fullDetails?'<span class="class-detail"><span>'+time+'</span><span>'+esc(location)+'</span></span>':
      '<span class="class-detail">'+timeText(from)+'<br>'+esc(location)+'</span>';
    const [lane,count]=lanes.get(meeting)||[0,1];
    return `<button class="class-block ${courseColor(s.courseId)} ${s.variant||''} ${to-from<90?'short-class':''}" ${count>1?`data-lane="${lane}" data-lanes="${count}"`:''} data-action="${action}" data-id="${esc(s.courseId)}" data-offset="${(from-start)/(end-start)*100}" data-length="${(to-from)/(end-start)*100}" aria-label="${esc(label)}" title="${esc(label)}"><strong>${esc(fullDetails?s.name:s.shortName||s.name)}</strong>${details}</button>`;
  }).join('')).join('')}</div>`).join('');
  return `<div class="timetable" data-hours="${hours}" data-days="${shownDays.length}" aria-label="주간 시간표"><div class="week-header"><span></span>${shownDays.map((d,day)=>`<span${off(day)?' class="off"':''}>${d}</span>`).join('')}</div><div class="week-body"><div class="time-labels">${labels}</div><div class="schedule-grid">${rows}${offHours}<div class="day-columns">${columns}</div></div></div></div>`;
}
export function layoutTimetables(){
  document.querySelectorAll('.timetable').forEach(el=>{el.style.setProperty('--hours',el.dataset.hours);el.style.setProperty('--days',el.dataset.days||5)});
  document.querySelectorAll('[data-offset]').forEach(el=>el.style.top=el.dataset.offset+'%');
  document.querySelectorAll('[data-length]').forEach(el=>el.style.height=`calc(${el.dataset.length}% - 4px)`);
  document.querySelectorAll('[data-span]').forEach(el=>el.style.height=el.dataset.span+'%');
  document.querySelectorAll('[data-lanes]').forEach(el=>Object.assign(el.style,{left:`calc(${el.dataset.lane/el.dataset.lanes*100}% + 2px)`,right:'auto',width:`calc(${100/el.dataset.lanes}% - 4px)`}));
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
