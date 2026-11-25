import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {koreanProgramDate,programStatus,officialProgramUrl} from './public/program-model.mjs';

export const defaultProgramPath=new URL('../extracurricular-collector/output/programs.json',import.meta.url);
export function createProgramSource({file=process.env.SSU_PROGRAMS_FILE||defaultProgramPath}={}){
  return {async load(){
    try{
      const info=await stat(file);if(info.size>32*1024*1024)throw Error('size');
      return JSON.parse(await readFile(file,'utf8'));
    }catch(error){if(error.code==='ENOENT')return null;throw Error('비교과 자료를 읽지 못했어요. 잠시 후 다시 확인해 주세요.')}
  }};
}
function unavailable(reason,message){return {meta:{ready:false,reason,message,openCount:0,upcomingCount:0},programs:[]}}
export function prepareProgramData(snapshot,now=new Date()){
  if(!snapshot)return unavailable('missing','비교과 프로그램 정보를 준비 중이에요. 잠시 후 다시 확인해 주세요.');
  if(snapshot.schemaVersion!==1||snapshot.source!=='ssu-path-public'||!Array.isArray(snapshot.programs)||snapshot.programs.length>20000||!snapshot.run||!Number.isFinite(Date.parse(snapshot.collectedAt)))throw Error('비교과 자료 형식을 확인하지 못했어요.');
  const age=now.getTime()-Date.parse(snapshot.collectedAt),asOfDate=koreanProgramDate(now);
  if(age< -300000||age>36*3600000)return unavailable('stale','비교과 모집 정보가 오래되어 갱신이 필요해요. 최신 자료가 준비되면 다시 검색해 주세요.');
  if(snapshot.run.inventoryComplete!==true||snapshot.run.outcome!=='success')return unavailable('partial','비교과 정보를 갱신 중이에요. 전체 확인이 끝나면 다시 검색해 주세요.');
  const ids=new Set(),programs=[];
  for(const p of snapshot.programs){
    if(!p||typeof p.id!=='string'||!/^ssu-path:[A-Za-z0-9_-]{8,256}$/.test(p.id)||ids.has(p.id)||typeof p.title!=='string'||!p.title.trim()||p.title.length>500||typeof p.department!=='string'||typeof p.sourceStatus!=='string'||typeof p.presentInLatestInventory!=='boolean')throw Error('비교과 프로그램 식별 정보를 확인하지 못했어요.');
    ids.add(p.id);
    if(p.presentInLatestInventory&&(!Number.isFinite(Date.parse(p.lastSeenAt))||Date.parse(p.lastSeenAt)<Date.parse(snapshot.collectedAt)))throw Error('비교과 목록의 갱신 시각을 확인하지 못했어요.');
    const status=programStatus(p,asOfDate);
    if(!['open','upcoming'].includes(status))continue;
    if(!officialProgramUrl(p.sourceUrl)||!officialProgramUrl(p.applicationUrl))throw Error('학교 원문 주소를 확인하지 못했어요.');
    const detail=p.detailState==='ok'&&p.detail?.title===p.title&&Number.isFinite(Date.parse(p.lastDetailSuccessAt))&&Date.parse(p.lastDetailSuccessAt)>=Date.parse(p.lastSeenAt)?p.detail:null;
    const description=typeof detail?.description==='string'?detail.description:'';
    const text=(key,max=2000)=>typeof detail?.[key]==='string'?detail[key].slice(0,max):'';
    if(description.length>6000)throw Error('비교과 설명의 길이를 확인해 주세요.');
    programs.push({id:p.id,title:p.title,department:p.department,sourceStatus:p.sourceStatus,status,presentInLatestInventory:true,
      applicationStartDate:p.applicationStartDate,applicationEndDate:p.applicationEndDate,activityPeriod:String(p.activityPeriod||'').slice(0,300),
      description,evidenceType:description?'description':'name',category:text('category',300),target:text('target'),targetDetails:text('targetDetails'),
      sourceUrl:p.sourceUrl,applicationUrl:p.applicationUrl,lastSeenAt:p.lastSeenAt,lastDetailSuccessAt:p.lastDetailSuccessAt||null});
  }
  const observed=snapshot.programs.filter(p=>p.presentInLatestInventory).length;
  if(!Number.isInteger(snapshot.run.sourceTotal)||observed!==snapshot.run.sourceTotal||snapshot.run.observedPrograms!==observed)throw Error('비교과 전체 목록 건수를 확인하지 못했어요.');
  return {meta:{ready:true,reason:'ready',asOfDate,collectedAt:snapshot.collectedAt,dataVersion:'programs-'+createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0,16),
    totalCount:snapshot.programs.length,openCount:programs.filter(p=>p.status==='open').length,upcomingCount:programs.filter(p=>p.status==='upcoming').length,
    message:'공개 모집 정보를 기준으로 추천합니다. 신청 자격·여석·정확한 활동 시간은 학교 원문에서 확인해 주세요.'},programs};
}
