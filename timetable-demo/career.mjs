import {courses} from './schedule.mjs';
export const careerSchema={type:'object',additionalProperties:false,properties:{evaluations:{type:'array',items:{type:'object',additionalProperties:false,properties:{courseId:{type:'string'},relevance:{type:'string',enum:['high','medium','uncertain']},reason:{type:'string'}},required:['courseId','relevance','reason']}}},required:['evaluations']};
export function validateEvaluations(raw,eligible){
  if(!Array.isArray(raw?.evaluations)||raw.evaluations.length!==eligible.length)throw new Error('진로 추천 응답의 과목 수를 확인하지 못했습니다. 다시 시도해 주세요.');
  const allowed=new Set(eligible.map(c=>c.id)),seen=new Set();
  return raw.evaluations.map(e=>{
    if(!e||!allowed.has(e.courseId)||seen.has(e.courseId)||!['high','medium','uncertain'].includes(e.relevance)||typeof e.reason!=='string'||!e.reason.trim()||e.reason.length>400)throw new Error('진로 추천 응답에 알 수 없거나 중복된 과목이 있습니다. 다시 시도해 주세요.');
    seen.add(e.courseId);return {courseId:e.courseId,relevance:e.relevance,reason:e.reason.trim()};
  });
}
export async function evaluateCareer(body,bridge){
  if(typeof body?.goal!=='string'||!body.goal.trim()||body.goal.length>400)throw new Error('희망 진로를 1~400자로 입력해 주세요.');
  const eligible=courses;
  // Do not send history, private notes, timetable events or other student data to the model.
  const ai=await bridge.recommend({goal:body.goal.trim(),department:'AI소프트웨어학부',courses:eligible.map(c=>({courseId:c.id,name:c.name}))},careerSchema,{mode:'career'});
  const evaluations=validateEvaluations(ai.data,eligible);
  return {evaluations,goal:body.goal.trim(),source:'course-name-ai',model:ai.model||'Codex',notice:'과목명 기반 추천입니다. 실제 수업 내용·수강 자격을 보장하지 않습니다. 현재 분반·시간·강의실은 가상 데이터입니다.'};
}
