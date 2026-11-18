import * as liveScheduler from './schedule.mjs';
import {retrieveCareerCourses} from './career-data.mjs';
const querySchema={type:'object',additionalProperties:false,properties:{keywords:{type:'array',minItems:1,maxItems:24,items:{type:'string',minLength:2,maxLength:60}}},required:['keywords']};
export const careerSchema={type:'object',additionalProperties:false,properties:{evaluations:{type:'array',items:{type:'object',additionalProperties:false,properties:{courseId:{type:'string'},relevance:{type:'string',enum:['high','medium','uncertain']},reason:{type:'string'}},required:['courseId','relevance','reason']}}},required:['evaluations']};
export function validateEvaluations(raw,eligible){
  if(!Array.isArray(raw?.evaluations)||raw.evaluations.length!==eligible.length)throw new Error('진로 추천 응답의 과목 수를 확인하지 못했습니다. 다시 시도해 주세요.');
  const allowed=new Set(eligible.map(c=>c.id)),seen=new Set();
  return raw.evaluations.map(e=>{
    if(!e||!allowed.has(e.courseId)||seen.has(e.courseId)||!['high','medium','uncertain'].includes(e.relevance)||typeof e.reason!=='string'||!e.reason.trim()||e.reason.length>400)throw new Error('진로 추천 응답에 알 수 없거나 중복된 과목이 있습니다. 다시 시도해 주세요.');
    seen.add(e.courseId);return {courseId:e.courseId,relevance:e.relevance,reason:e.reason.trim()};
  });
}
export async function evaluateCareer(body,bridge,scheduler=liveScheduler,{signal}={}){
  if(typeof body?.goal!=='string'||!body.goal.trim()||body.goal.length>400)throw new Error('희망 진로를 1~400자로 입력해 주세요.');
  const term=body.term??scheduler.defaultRequest.term,department=body.department??scheduler.defaultRequest.department;
  const eligible=scheduler.getCourses({term,department});
  if(scheduler.careerCatalog){
    signal?.throwIfAborted();
    const query=await bridge.recommend({goal:body.goal.trim()},querySchema,{mode:'career-query',signal});
    const keywords=query.data?.keywords;
    if(!Array.isArray(keywords)||!keywords.length||keywords.length>24||keywords.some(k=>typeof k!=='string'||k.trim().length<2||k.length>60))throw new Error('진로 검색어를 확인하지 못했습니다. 다시 시도해 주세요.');
    const candidates=retrieveCareerCourses(scheduler.careerCatalog,[...keywords,body.goal.trim()]);
    signal?.throwIfAborted();
    const ai=candidates.length?await bridge.recommend({goal:body.goal.trim(),department,courses:candidates.map(c=>({courseId:c.id,name:c.name,department:c.department,evidenceType:c.evidenceType,description:c.description,sourceYear:c.sourceYear}))},careerSchema,{mode:'career',signal}):null;
    signal?.throwIfAborted();
    const evaluations=ai?validateEvaluations(ai.data,candidates):[];
    return {evaluations,courses:candidates,goal:body.goal.trim(),term,department,catalogVersion:scheduler.catalogVersion,careerDataVersion:scheduler.careerDataVersion,
      source:'course-evidence-ai',model:ai?.model||query.model||'Codex',keywords:keywords.map(k=>k.trim()),searchedCourseCount:scheduler.careerCatalog.length,evaluatedCourseCount:candidates.length,
      notice:'전체 과목에서 진로 관련 후보를 검색한 후 AI가 과목명·학과·확보된 설명으로 판단합니다. 설명이 없으면 과목명으로 판단하며, 이전 과목 설명은 참고용입니다. 과거 자료는 현재 수업과 다를 수 있습니다. 꼭 듣기에는 선택한 학기·학과에서 조회되는 강좌만 연결합니다. 수강 자격은 학교에서 확인해 주세요.'};
  }
  // Do not send history, private notes, timetable events or other student data to the model.
  const ai=await bridge.recommend({goal:body.goal.trim(),department,courses:eligible.map(c=>({courseId:c.id,name:c.name}))},careerSchema,{mode:'career'});
  const evaluations=validateEvaluations(ai.data,eligible);
  return {evaluations,goal:body.goal.trim(),term,department,catalogVersion:scheduler.catalogVersion,source:'course-name-ai',model:ai.model||'Codex',notice:'선택한 학기·학과의 과목명 기반 추천입니다. 실제 수업 내용·수강 자격을 보장하지 않으며 수강대상과 개설 변경은 학교에서 확인해 주세요.'};
}
