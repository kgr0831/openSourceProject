// A career list is reference data, never a solver constraint by itself.
export function validateCareerList(value){
  if(!value||typeof value.goal!=='string'||!value.goal.trim()||value.goal.length>400||!['course-name-ai','course-evidence-ai'].includes(value.source)||typeof value.notice!=='string'||value.notice.length>600||typeof value.model!=='string'||value.model.length>200||!Array.isArray(value.evaluations)||value.evaluations.length>2500)throw new Error('저장된 진로 추천 목록을 확인해 주세요.');
  const seen=new Set();
  for(const e of value.evaluations){
    if(!e||typeof e.courseId!=='string'||!e.courseId||e.courseId.length>160||seen.has(e.courseId)||!['high','medium','uncertain'].includes(e.relevance)||typeof e.reason!=='string'||!e.reason.trim()||e.reason.length>400)throw new Error('진로 추천 과목 정보를 확인해 주세요.');
    seen.add(e.courseId);
  }
  if(value.source==='course-evidence-ai'){
    if(typeof value.careerDataVersion!=='string'||value.careerDataVersion.length>100||!Array.isArray(value.courses)||value.courses.length>80||value.courses.length!==seen.size)throw new Error('진로 추천 근거를 확인해 주세요.');
    const ids=new Set();
    for(const c of value.courses){
      if(!c||typeof c.id!=='string'||!/^career-[a-f0-9]{16}$/.test(c.id)||!seen.has(c.id)||ids.has(c.id)||typeof c.name!=='string'||c.name.length>300||typeof c.department!=='string'||c.department.length>200||!['major','general'].includes(c.kind)||!['description','reference','name'].includes(c.evidenceType)||typeof c.description!=='string'||c.description.length>6000||!Array.isArray(c.courseNumbers)||!c.courseNumbers.length||c.courseNumbers.length>500||c.courseNumbers.some(n=>typeof n!=='string'||!/^\d{10}$/.test(n)))throw new Error('진로 추천 근거 과목을 확인해 주세요.');
      if(c.evidenceType==='name'?!!c.description:!c.description)throw new Error('진로 추천 설명 유형을 확인해 주세요.');
      for(const [key,max] of [['sourceName',400],['sourceYear',200],['sourceUrl',2000],['reviewNote',3000]])if(typeof c[key]!=='string'||c[key].length>max)throw new Error('진로 추천 출처 정보를 확인해 주세요.');
      ids.add(c.id);
    }
  }
  return value;
}
export function matchCareerOfferings(record,courses){
  return courses.filter(c=>c.name===record.name&&(c.offerings||c.sections||[]).some(s=>s.offeredBy===record.department&&record.courseNumbers.includes(s.courseNumber)&&
    ('available' in s?s.available:!s.unavailableReason)));
}
export function groupCareerCourses(list,courses,{selectable=false}={}){
  const groups={major:[],general:[]},v2=list?.source==='course-evidence-ai',known=new Map((v2?list.courses:courses).map(c=>[c.id,c]));
  for(const e of list?.evaluations||[]){
    const c=known.get(e.courseId);
    if(!c||e.relevance==='uncertain')continue;
    const matches=v2?matchCareerOfferings(c,courses):[c];
    if(v2&&selectable){
      for(const actual of matches)if(groups[actual.kind])groups[actual.kind].push({...c,...e,...actual,careerCourseId:c.id,department:c.department});
    }else if(groups[c.kind])groups[c.kind].push({...c,...e,availableNow:matches.length>0});
  }
  for(const [kind,group] of Object.entries(groups)){
    group.sort((a,b)=>Number(b.relevance==='high')-Number(a.relevance==='high')||a.name.localeCompare(b.name,'ko'));
    groups[kind]=group.filter((c,i)=>group.findIndex(other=>other.id===c.id)===i);
  }
  return groups;
}
export function toggleRequiredCourse(request,id){
  const selected=!request.requiredCourseIds.includes(id);
  return {...request,requiredCourseIds:selected?[...request.requiredCourseIds,id]:request.requiredCourseIds.filter(x=>x!==id),excludedCourseIds:selected?request.excludedCourseIds.filter(x=>x!==id):[...request.excludedCourseIds]};
}
