import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SolverError,verifySolverResult} from './ortools-contract.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const worker=path.join(root,'solver','worker.py');
export function solverPython(){
  if(process.env.TIMETABLE_PYTHON)return process.env.TIMETABLE_PYTHON;
  const local=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  return existsSync(local)?local:(process.platform==='win32'?'python':'python3');
}
export class OrToolsCandidateProvider {
  constructor({python=solverPython(),workerPath=worker}={}){this.python=python;this.workerPath=workerPath;this.children=new Set()}
  async solve(catalog,request,{mode='recommend',signal}={}){
    if(this.children.size>=4)throw new SolverError('ENGINE_BUSY','추천 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.');
    if(signal?.aborted)throw new SolverError('ENGINE_CANCELLED','추천 요청을 취소했습니다.');
    const seconds=request.search_options?.time_limit_seconds??10;
    if(!Number.isFinite(seconds)||seconds<=0||seconds>120)throw new SolverError('INVALID_INPUT','실행 시간 범위를 확인해 주세요.');
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(this.python,['-u',this.workerPath],{cwd:root,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
      this.children.add(child);let output='',bytes=0,done=false;
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);this.children.delete(child);error?reject(error):resolve(value)};
      const abort=()=>{child.kill();finish(new SolverError('ENGINE_CANCELLED','추천 요청을 취소했습니다.'))};
      const timer=setTimeout(()=>{child.kill();finish(new SolverError('ENGINE_TIMEOUT','추천 엔진의 응답 제한을 초과했습니다. 받은 결과 없이 종료됐습니다.'))},seconds*1000+5000);
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
      child.on('error',()=>finish(new SolverError('ENGINE_UNAVAILABLE','Python 추천 엔진을 시작하지 못했습니다. npm run setup:solver를 실행해 주세요.')));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>16*1024*1024){child.kill();finish(new SolverError('ENGINE_PROTOCOL_ERROR','추천 응답 크기를 초과했습니다.'))}else output+=chunk});
      child.stderr.resume(); // Worker diagnostics never enter the JSON channel or expose request contents.
      child.stdin.on('error',()=>{});
      child.on('close',code=>{
        if(done)return;
        try{const parsed=JSON.parse(output);if(parsed.error)return finish(new SolverError(parsed.error.code,parsed.error.message));if(code!==0)throw new Error();finish(null,parsed)}
        catch{finish(new SolverError('ENGINE_PROTOCOL_ERROR','추천 엔진이 정상적인 결과를 반환하지 못했습니다.'))}
      });
      child.stdin.end(JSON.stringify({catalog,request,mode}));
    });
    return verifySolverResult(catalog,request,result);
  }
  close(){for(const child of this.children)child.kill();this.children.clear()}
}
export const ortoolsProvider=new OrToolsCandidateProvider();
