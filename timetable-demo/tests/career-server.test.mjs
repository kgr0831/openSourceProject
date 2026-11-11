import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimetableServer} from '../server.mjs';
import {defaultRequest} from '../schedule.mjs';
import {toggleRequiredCourse} from '../public/career-model.mjs';
test('career list API remains independent; selected course enters actual solver as required',async t=>{
  const bridge={close(){},recommend:async payload=>({model:'test-double',data:{evaluations:payload.courses.map(c=>({courseId:c.courseId,relevance:c.courseId==='ml'?'high':'uncertain',reason:'과목명 기반 추천'}))}})};
  const server=createTimetableServer({port:0,bridge});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await server.closeServices();await new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body,extra={})=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Timetable-App':'1',...extra},body:JSON.stringify(body)});
  assert.equal((await post('career',{},{Origin:'https://example.invalid'})).status,403);assert.equal((await post('career',{goal:''})).status,400);
  const response=await post('career',{goal:'컴퓨터비전'});assert.equal(response.status,200);const list=await response.json();
  assert.equal(list.source,'course-name-ai');assert.equal('request' in list,false);
  const request=toggleRequiredCourse({...structuredClone(defaultRequest),credits:{total:{min:3,max:3},major:{min:3,max:3},general:{min:0,max:0}}},'ml');
  const solved=await post('candidates',request);assert.equal(solved.status,200);const result=await solved.json();assert.ok(result.candidates.length);
  for(const c of result.candidates)assert.deepEqual(c.sections.map(s=>s.courseId),['ml']);
  assert.deepEqual(result.request.preferredCourseIds,[]);assert.equal((await fetch(base+'/career-model.mjs')).status,200);
});
