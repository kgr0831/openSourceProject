import test from 'node:test';
import assert from 'node:assert/strict';
import {LmsCalendarService} from '../lms-service.mjs';
import {createTimetableServer} from '../server.mjs';
import {HttpClient} from '../../lms-parser/index.mjs';
import {fixtureFetch} from '../../lms-parser/tests/fixtures.mjs';
import {request} from 'node:http';

function service(options={}){
  const fixture=fixtureFetch();
  const session={restore:async()=>({id:99}),useInBackground:async()=>{},ensureLogin:async()=>({id:99}),save:async()=>{},close:async()=>{},remembered:true};
  const app=new LmsCalendarService({createSession:async()=>session,createClient:(_,signal)=>new HttpClient({fetchImpl:fixture.fetch,signal}),...options});
  return {app,fixture,session};
}

test('공유 파서로 선택한 과목 일정만 수집하고 파일·개인정보를 API에 노출하지 않는다',async t=>{
  const {app,fixture}=service();t.after(()=>app.close());app.resume();await app.loginTask;
  assert.equal(app.state.connection,'connected');assert.match(app.state.accountKey,/^[a-f0-9]{24}$/);
  assert.throws(()=>app.start({courseIds:[]}),{code:'SELECTION'});assert.throws(()=>app.start({courseIds:['999']}),{code:'SELECTION'});
  app.start({courseIds:['10']});await app.jobTask;
  assert.equal(app.state.job.phase,'complete');assert.equal(app.state.result.events.length,3);
  assert.doesNotMatch(JSON.stringify(app.view()),/signature|verifier|not-exported|resources|localPath/);
  assert.ok(fixture.requested.every(({path})=>!path.includes('/files')&&!path.includes('/viewer/')));
});

test('수집 중 계정 변경·중복 요청을 막고 취소나 만료를 빈 성공으로 처리하지 않는다',async t=>{
  const {app,session}=service({collect:async({client,includeMaterials})=>{
    assert.equal(includeMaterials,false);
    await new Promise((resolve,reject)=>{if(client.signal.aborted)reject({code:'CANCELLED'});else client.signal.addEventListener('abort',()=>reject({code:'CANCELLED'}),{once:true})});
  }});
  t.after(()=>app.close());app.resume();await app.loginTask;app.start({courseIds:['10']});
  assert.throws(()=>app.start({courseIds:['10']}),{code:'BUSY'});await assert.rejects(app.disconnect(),{code:'BUSY'});
  app.cancel();await app.jobTask;assert.equal(app.state.job.phase,'cancelled');assert.equal(app.state.result,null);
  session.ensureLogin=async()=>null;app.start({courseIds:['10']});await app.jobTask;
  assert.equal(app.state.job.phase,'error');assert.equal(app.state.job.reconnect,true);assert.equal(app.state.result,null);
});

test('수집 도중 계정이 바뀐 결과를 캘린더에 반영하지 않는다',async t=>{
  const {app}=service({collect:async()=>({snapshot:{accountKey:'f'.repeat(24),courses:[],warnings:[]}})});
  t.after(()=>app.close());app.resume();await app.loginTask;app.start({courseIds:['10']});await app.jobTask;
  assert.equal(app.state.job.phase,'error');assert.equal(app.state.job.reconnect,true);assert.equal(app.state.result,null);
});

test('프로젝트 LMS 경로도 로컬 Host·Origin·앱 헤더를 검증하고 일반 추천은 독립적으로 동작한다',async t=>{
  const {app}=service();const bridge={status:async()=>({connected:false}),close(){}};
  const server=createTimetableServer({port:0,bridge,createLms:async()=>app});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await server.closeServices();await new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/meta')).status,200);
  assert.equal((await fetch(base+'/api/lms/state',{headers:{Origin:'https://example.invalid'}})).status,403);
  const invalidHost=await new Promise((resolve,reject)=>{
    const req=request(base+'/api/lms/state',{headers:{Host:'example.invalid'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end();
  });
  assert.equal(invalidHost,403);
  assert.equal((await fetch(base+'/api/lms/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/lms/state')).status,200);await app.loginTask;
  const post=body=>fetch(base+'/api/lms/collect',{method:'POST',headers:{'Content-Type':'application/json','X-Timetable-App':'1'},body:JSON.stringify(body)});
  assert.equal((await post({courseIds:['999']})).status,400);
  assert.equal((await post({courseIds:['10']})).status,200);await app.jobTask;
  const state=await fetch(base+'/api/lms/state').then(r=>r.json());assert.equal(state.result.events.length,3);
});

test('LMS 구성 요소가 없더라도 기존 시간표 서버는 작동하고 오류는 안전한 안내로 바꾼다',async t=>{
  const server=createTimetableServer({port:0,bridge:{close(){}},createLms:async()=>{throw new Error('sensitive synthetic diagnostic')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const failure=await fetch(base+'/api/lms/state');assert.equal(failure.status,400);assert.doesNotMatch(await failure.text(),/sensitive/);
  assert.equal((await fetch(base+'/api/meta')).status,200);
});
