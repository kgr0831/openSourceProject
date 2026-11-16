// A career list is reference data, never a solver constraint by itself.
export function validateCareerList(value){
  if(!value||typeof value.goal!=='string'||!value.goal.trim()||value.goal.length>400||value.source!=='course-name-ai'||typeof value.notice!=='string'||value.notice.length>600||typeof value.model!=='string'||value.model.length>200||!Array.isArray(value.evaluations)||value.evaluations.length>500)throw new Error('저장된 진로 추천 목록을 확인해 주세요.');
  const seen=new Set();
  for(const e of value.evaluations){
    if(!e||typeof e.courseId!=='string'||!e.courseId||e.courseId.length>160||seen.has(e.courseId)||!['high','medium','uncertain'].includes(e.relevance)||typeof e.reason!=='string'||!e.reason.trim()||e.reason.length>400)throw new Error('진로 추천 과목 정보를 확인해 주세요.');
    seen.add(e.courseId);
  }
  return value;
}
export function groupCareerCourses(list,courses){
  const groups={major:[],general:[]},known=new Map(courses.map(c=>[c.id,c]));
  for(const e of list?.evaluations||[]){
    const c=known.get(e.courseId);
    if(c&&e.relevance!=='uncertain'&&groups[c.kind])groups[c.kind].push({...c,...e});
  }
  for(const group of Object.values(groups))group.sort((a,b)=>Number(b.relevance==='high')-Number(a.relevance==='high')||a.name.localeCompare(b.name,'ko'));
  return groups;
}
export function toggleRequiredCourse(request,id){
  const selected=!request.requiredCourseIds.includes(id);
  return {...request,requiredCourseIds:selected?[...request.requiredCourseIds,id]:request.requiredCourseIds.filter(x=>x!==id),excludedCourseIds:selected?request.excludedCourseIds.filter(x=>x!==id):[...request.excludedCourseIds]};
}
