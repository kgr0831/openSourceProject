export const programStorageKey='ssu-career-programs-v1';
export const programEvidenceLabels={description:'공식 설명 기반',name:'제목 기반 · 상세 미확보'};
export function koreanProgramDate(now=new Date()){
  return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
}
export function validProgramDate(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
export function programStatus(program,today){
  const start=program.applicationStartDate,end=program.applicationEndDate;
  if(!program.presentInLatestInventory||!validProgramDate(start)||!validProgramDate(end)||start>end)return 'unknown';
  if(end<today||/마감|종료|취소/.test(program.sourceStatus))return 'closed';
  const open=['신청중','접수중','모집중'].includes(program.sourceStatus);
  if(!open&&program.sourceStatus!=='신청전'&&!/예정|대기/.test(program.sourceStatus))return 'unknown';
  if(start>today)return 'upcoming';
  return open?'open':'unknown';
}
export function officialProgramUrl(value){
  try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='path.ssu.ac.kr'&&!u.username&&!u.password&&!u.port}catch{return false}
}
export function validateProgramList(value){
  if(!value||value.version!==1||value.source!=='program-evidence-ai'||typeof value.goal!=='string'||!value.goal.trim()||value.goal.length>400||typeof value.model!=='string'||value.model.length>200||typeof value.dataVersion!=='string'||value.dataVersion.length>100||!validProgramDate(value.asOfDate)||typeof value.includeUpcoming!=='boolean'||!Array.isArray(value.programs)||value.programs.length>40||!Array.isArray(value.evaluations)||value.evaluations.length!==value.programs.length)throw Error('저장된 비교과 추천을 확인해 주세요.');
  const ids=new Set();
  if(!Number.isInteger(value.searchedProgramCount)||value.searchedProgramCount<0||value.searchedProgramCount>20000||value.evaluatedProgramCount!==value.programs.length)throw Error('비교과 추천 건수를 확인해 주세요.');
  for(const p of value.programs){
    if(!p||typeof p.id!=='string'||!/^ssu-path:[A-Za-z0-9_-]{8,256}$/.test(p.id)||ids.has(p.id)||!['description','name'].includes(p.evidenceType)||!validProgramDate(p.applicationStartDate)||!validProgramDate(p.applicationEndDate)||!officialProgramUrl(p.sourceUrl)||!officialProgramUrl(p.applicationUrl))throw Error('비교과 추천 프로그램 정보를 확인해 주세요.');
    for(const [key,max] of [['title',500],['department',300],['description',6000],['category',300],['target',2000],['targetDetails',2000],['activityPeriod',300],['sourceStatus',100]])if(typeof p[key]!=='string'||p[key].length>max)throw Error('비교과 추천 근거를 확인해 주세요.');
    if(p.evidenceType==='description'?!p.description:!!p.description)throw Error('비교과 설명 유형을 확인해 주세요.');
    ids.add(p.id);
  }
  const seen=new Set();
  for(const e of value.evaluations){
    if(!e||!ids.has(e.programId)||seen.has(e.programId)||!['high','medium','uncertain'].includes(e.relevance)||typeof e.reason!=='string'||!e.reason.trim()||e.reason.length>400)throw Error('비교과 추천 결과를 확인해 주세요.');
    seen.add(e.programId);
  }
  return value;
}
export function visibleProgramRecommendations(list,meta,today=koreanProgramDate()){
  if(!list||!meta?.ready||meta.dataVersion!==list.dataVersion||list.asOfDate!==today||meta.asOfDate!==today)return [];
  return list.evaluations.filter(e=>e.relevance!=='uncertain').flatMap(e=>{
    const p=list.programs.find(p=>p.id===e.programId),status=programStatus(p,today);
    return status==='open'||list.includeUpcoming&&status==='upcoming'?[{...p,...e,status}]:[];
  }).sort((a,b)=>Number(b.relevance==='high')-Number(a.relevance==='high')||a.applicationEndDate.localeCompare(b.applicationEndDate)||a.title.localeCompare(b.title,'ko'));
}
export function createProgramStore(storage){
  let list=null,raw=null,error='';
  try{raw=storage.getItem(programStorageKey);if(raw!==null)list=validateProgramList(JSON.parse(raw))}catch{error='저장된 비교과 추천을 읽지 못했어요. 해당 추천을 지운 뒤 다시 검색해 주세요.'}
  return {get list(){return list},get error(){return error},save(value){
    validateProgramList(value);
    if(error)throw Error(error);
    if(storage.getItem(programStorageKey)!==raw)throw Error('다른 탭의 비교과 추천이 변경됐어요. 새로고침해 주세요.');
    const next=JSON.stringify(value);
    try{storage.setItem(programStorageKey,next)}catch{throw Error('비교과 추천을 저장하지 못했어요. 브라우저 저장 공간과 설정을 확인해 주세요.')}
    raw=next;list=structuredClone(value);
  },clear(){storage.removeItem(programStorageKey);raw=null;list=null;error=''}};
}
