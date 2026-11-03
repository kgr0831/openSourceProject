import {assets} from './design-assets.js';
import {timeText} from './planner-core.mjs';

export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const icon=(screen,name)=>`<img class="icon" src="${assets[screen][name]}" alt="" aria-hidden="true">`;
export const button=(label,action,variant='primary',attrs='')=>`<button type="button" class="button ${variant}" data-action="${action}" ${attrs}>${label}</button>`;
export const link=(label,route,variant='quiet',attrs='')=>`<a class="button ${variant}" href="#${route}" ${attrs}>${label}</a>`;
export const heading=(title,description='')=>`<div class="heading"><h1 tabindex="-1">${title}</h1>${description?`<p>${description}</p>`:''}</div>`;
export const info=(title,description='',image='',dark=false)=>`<div class="info ${dark?'dark':''}">${image}<div><strong>${title}</strong>${description?`<p>${description}</p>`:''}</div></div>`;
export const field=(label,input)=>`<label class="field"><span>${label}</span>${input}</label>`;
export const toggle=(key,label,checked,description='')=>`<label class="toggle"><span>${label}${description?`<small>${description}</small>`:''}</span><input type="checkbox" data-pref="${key}" ${checked?'checked':''}><span class="switch" aria-hidden="true"></span></label>`;
export const tabs=(items,active,action)=>`<div class="tabs" role="group" data-tabs="${action}">${items.map(([id,label])=>button(esc(label),action,'tab',`data-value="${esc(id)}" aria-pressed="${String(id)===String(active)}"`)).join('')}<span class="tab-indicator" aria-hidden="true"></span></div>`;
export const footer=(content,hint='')=>`<footer class="action-footer">${hint?`<p>${hint}</p>`:''}${content}</footer>`;
export const dayNames=['월','화','수','목','금'];
const colors=['sage','lavender','blue','peach','sand'];
const courseColor=id=>({ds:'sage',algo:'lavender',db:'blue',media:'sand',bible:'peach'})[id]||colors[Array.from(id).reduce((sum,c)=>sum+c.charCodeAt(0),0)%colors.length];
export function timetable(candidate,action='section'){
  if(!candidate?.sections?.length)return '';
  const meetings=candidate.sections.flatMap(s=>s.meetings);
  const start=Math.min(600,Math.floor(Math.min(...meetings.map(m=>m[1]))/60)*60);
  const end=Math.max(1080,Math.ceil(Math.max(...meetings.map(m=>m[2]))/60)*60),hours=(end-start)/60;
  const labels=Array.from({length:hours},(_,i)=>`<span class="hour" data-offset="${i/hours*100}">${start/60+i}</span>`).join('');
  const rows=Array.from({length:hours},(_,i)=>`<span class="hour-line" data-offset="${i/hours*100}"></span>`).join('');
  const columns=dayNames.map((_,day)=>`<div class="day-column">${candidate.sections.map(s=>s.meetings.filter(m=>m[0]===day).map(([,from,to])=>{
    const label=`${s.name}, ${dayNames[day]} ${timeText(from)}–${timeText(to)}, ${s.building}`;
    return `<button class="class-block ${courseColor(s.courseId)} ${to-from<90?'short-class':''}" data-action="${action}" data-id="${esc(s.courseId)}" data-offset="${(from-start)/(end-start)*100}" data-length="${(to-from)/(end-start)*100}" aria-label="${esc(label)}" title="${esc(label)}"><strong>${esc(s.shortName||s.name)}</strong><span class="class-detail">${timeText(from)}<br>${esc(s.building)}</span></button>`;
  }).join('')).join('')}</div>`).join('');
  return `<div class="timetable" data-hours="${hours}" aria-label="주간 시간표"><div class="week-header"><span></span>${dayNames.map(d=>`<span>${d}</span>`).join('')}</div><div class="week-body"><div class="time-labels">${labels}</div><div class="schedule-grid">${rows}<div class="day-columns">${columns}</div></div></div></div>`;
}
export function layoutTimetables(){
  document.querySelectorAll('.timetable').forEach(el=>el.style.setProperty('--hours',el.dataset.hours));
  document.querySelectorAll('[data-offset]').forEach(el=>el.style.top=el.dataset.offset+'%');
  document.querySelectorAll('[data-length]').forEach(el=>el.style.height=`calc(${el.dataset.length}% - 4px)`);
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
