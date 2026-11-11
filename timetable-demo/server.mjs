import {evaluateCareer} from './career.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CodexBridge,openBrowser} from './codex.mjs';
import {courses,defaultRequest,generateCandidates,validateRequest,validateAiResult,outputSchema,applyIntent,intentSchema} from './schedule.mjs';
import {catalogInfo} from './catalog.mjs';
import {ortoolsProvider} from './ortools-provider.mjs';
import {friendlyError} from '../lms-parser/errors.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
function reply(res,status,data,type='application/json; charset=utf-8'){
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"});
  res.end(type.startsWith('application/json')?JSON.stringify(data):data);
}
async function readJson(req){
  if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('요청 형식이 올바르지 않습니다.');
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8192)throw new Error('입력이 너무 깁니다.')}
  try{return JSON.parse(body)}catch{throw new Error('입력을 확인해 주세요.')}
}
const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/planner.js':['planner.js','text/javascript; charset=utf-8'],'/planner-core.mjs':['planner-core.mjs','text/javascript; charset=utf-8'],'/lms.js':['lms.js','text/javascript; charset=utf-8'],'/lms-calendar.mjs':['lms-calendar.mjs','text/javascript; charset=utf-8']};
files['/ui.js']=['ui.js','text/javascript; charset=utf-8'];
files['/design-assets.js']=['design-assets.js','text/javascript; charset=utf-8'];
files['/career-model.mjs']=['career-model.mjs','text/javascript; charset=utf-8'];
files['/solver-ui.js']=['solver-ui.js','text/javascript; charset=utf-8'];
files['/lms.css']=['lms.css','text/css; charset=utf-8'];
export function createTimetableServer({port=4317,bridge=new CodexBridge(),createLms=async()=>new (await import('./lms-service.mjs')).LmsCalendarService()}={}) {
let recommendationBusy=false,lmsPromise=null,lms=null;
async function getLms(){
  if(!lmsPromise)lmsPromise=Promise.resolve().then(createLms).then(app=>{lms=app;app.resume();return app}).catch(()=>{lmsPromise=null;throw new Error('LMS 구성 요소를 준비하지 못했어요. 시간표 데모 시작 파일을 다시 실행해 주세요.')});
  return lmsPromise;
}
const server=http.createServer(async(req,res)=>{
  const activePort=server.address()?.port||port,localUrl=`http://127.0.0.1:${activePort}`;
  const allowedHosts=new Set([`127.0.0.1:${activePort}`,`localhost:${activePort}`]);
  if(!allowedHosts.has(req.headers.host))return reply(res,403,{error:'허용되지 않은 접근입니다.'});
  const url=new URL(req.url,localUrl);
  if(req.headers.origin && ![`http://127.0.0.1:${activePort}`,`http://localhost:${activePort}`].includes(req.headers.origin))return reply(res,403,{error:'허용되지 않은 접근입니다.'});
  if(url.pathname.startsWith('/api/') && req.headers['sec-fetch-site']==='cross-site')return reply(res,403,{error:'허용되지 않은 접근입니다.'});
  const controller=new AbortController();
  res.once('close',()=>{if(!res.writableEnded)controller.abort()});
  try {
    if(req.method==='GET' && files[url.pathname]){const [file,type]=files[url.pathname];return reply(res,200,await readFile(path.join(root,'public',file)),type)}
    if(req.method==='GET' && /^\/assets\/(?:figma\/[A-Za-z0-9-]+\.svg|noto-sans-kr-(?:400|500|700)\.woff2|OFL-NotoSansKR\.txt)$/.test(url.pathname)){
      const type=url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.woff2')?'font/woff2':'text/plain; charset=utf-8';
      try{return reply(res,200,await readFile(path.join(root,'public',url.pathname.slice(1))),type)}
      catch(error){if(error.code==='ENOENT')return reply(res,404,{error:'파일을 찾을 수 없습니다.'});throw error}
    }
    if(req.method==='GET' && url.pathname==='/api/health')return reply(res,200,{app:'timetable-demo',version:'0.1.0',pid:process.pid});
    if(req.method==='GET' && url.pathname==='/api/meta')return reply(res,200,{courses:courses.map(({sections,...course})=>course),defaultRequest,catalogInfo});
    if(req.method==='GET' && url.pathname==='/api/lms/state')return reply(res,200,(await getLms()).view());
    if(req.method==='GET' && url.pathname==='/api/status')return reply(res,200,{...await bridge.status(),busy:recommendationBusy||bridge.busy});
    if(req.method!=='POST')return reply(res,404,{error:'페이지를 찾을 수 없습니다.'});
    if(req.headers['x-timetable-app']!=='1')return reply(res,403,{error:'앱 화면에서 다시 시도해 주세요.'});
    const body=await readJson(req);
    if(url.pathname.startsWith('/api/lms/')){
      const actions={'/api/lms/connect':app=>app.connect(),'/api/lms/confirm-login':app=>app.confirmLogin(),
        '/api/lms/focus-login':app=>app.focusLogin(),'/api/lms/disconnect':app=>app.disconnect({forget:true}),
        '/api/lms/collect':app=>app.start({courseIds:body?.courseIds}),'/api/lms/cancel':app=>app.cancel()};
      if(!Object.hasOwn(actions,url.pathname))return reply(res,404,{error:'요청을 찾을 수 없습니다.'});
      const app=await getLms();
      try{await actions[url.pathname](app);return reply(res,200,app.view())}
      catch(error){return reply(res,400,{error:friendlyError(error)})}
    }
    if(recommendationBusy&&['/api/connect','/api/cancel'].includes(url.pathname))throw new Error('추천이 끝난 뒤 계정을 변경해 주세요.');
    if(url.pathname==='/api/career'){
      if(recommendationBusy||bridge.busy)throw new Error('추천을 생성 중입니다. 잠시 기다려 주세요.');
      recommendationBusy=true;
      try{return reply(res,200,await evaluateCareer(body,bridge))}finally{recommendationBusy=false}
    }
    if(url.pathname==='/api/connect')return reply(res,200,await bridge.connect());
    if(url.pathname==='/api/cancel')return reply(res,200,await bridge.cancelLogin());
    if(['/api/candidates','/api/relax','/api/alternatives'].includes(url.pathname)){
      const mode=url.pathname==='/api/relax'?'relax':url.pathname==='/api/alternatives'?'alternative':'recommend';
      return reply(res,200,await generateCandidates(mode==='alternative'?body.request:body,{mode,baseline:mode==='alternative'?body.baseline:undefined,signal:controller.signal}));
    }
    if(url.pathname==='/api/recommend') {
      if(recommendationBusy)throw new Error('이미 추천을 생성하고 있습니다. 잠시 기다려 주세요.');
      recommendationBusy=true;
      try{
        let request=validateRequest(body),interpretation=null;
        if(request.note){
          const intent=await bridge.recommend({task:'요청을 수업 요일·시간·학점·과목 조건으로 해석해 주세요. 명시되지 않은 값은 null. 해석 불가능한 요청은 unsupported에 표시.',currentSettings:request,note:request.note,catalog:courses.map(({sections,...course})=>course)},intentSchema,{mode:'interpret'});
          ({request,interpretation}=applyIntent(request,intent.data));
        }
        const result=await generateCandidates(request,{signal:controller.signal}),candidates=result.candidates;
        if(!result.total)return reply(res,200,{...result,interpretation,summary:'조건에 맞는 시간표를 찾지 못했어요.',recommendations:[],source:interpretation?'codex':'rules'});
        const ai=await bridge.recommend({task:`서로 다른 후보 ${Math.min(3,candidates.length)}개 추천. summary 1문장, reason은 전공·교양 선택 이유와 시간상 장단점 2~3문장. 수업 난이도·성적·과제량은 판단하지 마세요.`,request,defaultIds:result.defaultIds,note:request.note,metricDefinitions:{morningClasses:'12시 이전 시작 수업 횟수',fridayClasses:'금요일 수업 횟수',gapMinutes:'일별 수업 사이 빈 시간의 주간 합(분)',buildingChanges:'일별 건물 변경 횟수의 주간 합'},candidates:candidates.map(({sections,...c})=>({...c,courses:sections.map(s=>({courseId:s.courseId,name:s.name,kind:s.kind,credits:s.credits,topic:s.topic}))}))},outputSchema);
        return reply(res,200,{...result,interpretation,...validateAiResult(ai.data,candidates),source:'codex',model:ai.model});
      }finally{recommendationBusy=false}
    }
    return reply(res,404,{error:'요청을 찾을 수 없습니다.'});
  }catch(error){if(!res.destroyed)reply(res,error.code?.startsWith('ENGINE_')?503:400,{error:error.message||'요청을 처리하지 못했습니다.',code:error.code})}
});
server.requestTimeout=300000;
server.closeServices=async()=>{bridge.close();ortoolsProvider.close();if(lmsPromise)await lmsPromise.catch(()=>{});await lms?.close()};
return server;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4317);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
  const localUrl=`http://127.0.0.1:${port}`,server=createTimetableServer({port});
  server.on('error',async error=>{
    if(error.code==='EADDRINUSE' && process.argv.includes('--open')) {
      try{const health=await fetch(`${localUrl}/api/health`,{signal:AbortSignal.timeout(2000)}).then(r=>r.json());if(health.app==='timetable-demo'){await openBrowser(localUrl);process.exit(0)}}catch{}
    }
    console.error('데모를 시작하지 못했습니다. 포트 사용 상태를 확인해 주세요.');process.exit(1);
  });
  server.listen(port,'127.0.0.1',()=>{
    console.log(`시간표 추천 데모: ${localUrl}`);
    if(process.argv.includes('--open'))openBrowser(localUrl).catch(()=>console.error('브라우저 자동 열기에 실패했습니다.'));
  });
  let closing=false;
  async function shutdown(){
    if(closing)return;closing=true;
    setTimeout(()=>process.exit(0),8000).unref();
    await server.closeServices();server.close(()=>process.exit(0));server.closeIdleConnections();
  }
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
