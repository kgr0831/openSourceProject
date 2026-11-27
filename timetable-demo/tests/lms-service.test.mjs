import {scheduler} from './fixtures/schedule.mjs';
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
  const server=createTimetableServer({scheduler,port:0,bridge,createLms:async()=>app});
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
  const server=createTimetableServer({scheduler,port:0,bridge:{close(){}},createLms:async()=>{throw new Error('sensitive synthetic diagnostic')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const failure=await fetch(base+'/api/lms/state');assert.equal(failure.status,400);assert.doesNotMatch(await failure.text(),/sensitive/);
  assert.equal((await fetch(base+'/api/meta')).status,200);
});

// A school that accepts "right-<id>" as the password for <id>.
function school(){
  const fixture=fixtureFetch(),seen=[];
  const create=()=>{
    let user=null;
    return new LmsCalendarService({windowLogin:false,createSession:async()=>({
      restore:async()=>null,passwordLogin:async({userId,password})=>{seen.push(userId);if(password!=='right-'+userId)throw Object.assign(new Error('refused'),{code:'CREDENTIALS'});user=Number(userId)},
      useInBackground:async()=>{},ensureLogin:async()=>user&&{id:user},save:async()=>{},close:async()=>{user=null},remembered:false}),
      createClient:(_,signal)=>new HttpClient({signal,fetchImpl:async(url,options)=>new URL(url).pathname==='/api/v1/users/self'?Response.json({id:user,name:'학생'+user}):fixture.fetch(url,options)})});
  };
  return {create,seen};
}
const lmsCookie=response=>response.headers.get('set-cookie')?.split(';')[0]||'';

test('학교 아이디·비밀번호 로그인 경로는 비밀번호를 응답에 싣지 않고 시도 횟수를 제한한다',async t=>{
  const {create}=school(),app=create();let clock=0;
  const server=createTimetableServer({scheduler,port:0,bridge:{close(){}},createLms:async()=>app,now:()=>clock});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await server.closeServices();await new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const signIn=(userId,password,headers={})=>fetch(base+'/api/lms/sign-in',{method:'POST',headers:{'Content-Type':'application/json','X-Timetable-App':'1',...headers},body:JSON.stringify({userId,password})});
  assert.equal((await fetch(base+'/api/lms/sign-in',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await signIn('','x')).status,400);
  const refused=await signIn('20201234','wrong-secret');assert.equal(refused.status,200);await app.loginTask;
  let state=await fetch(base+'/api/lms/state').then(r=>r.json());
  assert.equal(state.connection,'error');assert.match(state.notice,/^학번 또는 비밀번호가 맞지 않아요/);assert.doesNotMatch(JSON.stringify(state),/wrong-secret/);
  const accepted=await signIn('20201234','right-20201234');assert.equal(accepted.status,200);assert.doesNotMatch(await accepted.text(),/right-20201234/);await app.loginTask;
  state=await fetch(base+'/api/lms/state').then(r=>r.json());
  assert.equal(state.connection,'connected');assert.equal(state.accountName,'학생20201234');assert.equal(accepted.headers.get('set-cookie'),null);
  // Five tries per account in ten minutes, counted before anything is sent to the school.
  for(let i=0;i<3;i++)await signIn('20201234','again').then(()=>app.loginTask);
  const limited=await signIn('20201234','again');assert.equal(limited.status,429);
  assert.equal((await signIn('20205678','wrong')).status,200);await app.loginTask;
  clock+=600001;assert.equal((await signIn('20201234','right-20201234')).status,200);await app.loginTask;
});

test('호스팅 서버는 방문자마다 학교 세션을 따로 두고 쿠키 없이는 아무것도 보여 주지 않는다',async t=>{
  const {create}=school(),apps=[];let clock=0;
  const server=createTimetableServer({scheduler,port:0,bridge:{close(){}},lmsSessions:true,now:()=>clock,createLms:async()=>{const app=create();apps.push(app);return app}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await server.closeServices();await new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(route,{cookie='',body,address='203.0.113.1'}={})=>fetch(base+'/api/lms/'+route,body===undefined?{headers:{Cookie:cookie}}:
    {method:'POST',headers:{'Content-Type':'application/json','X-Timetable-App':'1','X-Real-IP':address,Cookie:cookie},body:JSON.stringify(body)});
  const blank=await call('state').then(r=>r.json());
  assert.equal(blank.connection,'disconnected');assert.equal(blank.windowLogin,false);assert.equal(apps.length,0);
  assert.equal((await call('collect',{body:{courseIds:['10']}})).status,400);
  assert.equal((await call('connect',{body:{}})).status,400);assert.equal(apps.length,0);
  const first=await call('sign-in',{body:{userId:'20201234',password:'right-20201234'}}),one=lmsCookie(first);
  assert.match(first.headers.get('set-cookie'),/^lms_sid=[\w-]{43}; Path=\/api\/lms; HttpOnly; Secure; SameSite=Strict; Max-Age=86400$/);
  const second=await call('sign-in',{body:{userId:'20205678',password:'right-20205678'},address:'203.0.113.2'}),two=lmsCookie(second);
  await Promise.all(apps.map(app=>app.loginTask));assert.notEqual(one,two);assert.equal(apps.length,2);
  assert.equal((await call('state',{cookie:one}).then(r=>r.json())).accountName,'학생20201234');
  assert.equal((await call('state',{cookie:two}).then(r=>r.json())).accountName,'학생20205678');
  assert.equal((await call('state',{cookie:'lms_sid='+'A'.repeat(43)}).then(r=>r.json())).accountName,null);
  assert.equal((await call('connect',{cookie:one,body:{}})).status,400);
  // Signing out ends that visitor's seat only.
  const out=await call('disconnect',{cookie:one,body:{}});assert.equal(out.status,200);assert.match(out.headers.get('set-cookie'),/^lms_sid=; .*Max-Age=0$/);
  assert.equal((await call('state',{cookie:one}).then(r=>r.json())).connection,'disconnected');
  assert.equal((await call('state',{cookie:two}).then(r=>r.json())).connection,'connected');
  // When every seat is taken, the one unused for longest makes room; the newest stays.
  const cookies=[];
  for(let i=0;i<8;i++){clock+=1000;const response=await call('sign-in',{body:{userId:'2021000'+i,password:'right-2021000'+i},address:'203.0.113.'+(10+i)});assert.equal(response.status,200);cookies.push(lmsCookie(response));await Promise.all(apps.map(app=>app.loginTask))}
  assert.equal((await call('state',{cookie:two}).then(r=>r.json())).connection,'disconnected');
  assert.equal((await call('state',{cookie:cookies.at(-1)}).then(r=>r.json())).accountName,'학생20210007');
  assert.equal((await call('state',{cookie:cookies[0]}).then(r=>r.json())).accountName,'학생20210000');
});
