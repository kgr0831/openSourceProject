import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function run(command,args){await new Promise((resolve,reject)=>{const p=spawn(command,args,{cwd:root,stdio:'inherit',windowsHide:true,shell:false,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error('설치 명령 실패: '+code)))})}
try{
  await run(process.platform==='win32'?'python':'python3',['-m','venv','.venv']);
  const python=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  await run(python,['-m','pip','install','--disable-pip-version-check','-r','solver/requirements.txt']);
  await run(python,['-c','import ortools; from ortools.sat.python import cp_model; m=cp_model.CpModel(); x=m.new_bool_var("x"); m.add(x==1); s=cp_model.CpSolver(); status=s.solve(m); assert status==cp_model.OPTIMAL and s.value(x)==1; print("OR-Tools "+ortools.__version__+" CP-SAT ready")']);
}catch(error){console.error('Python 3.10 이상과 네트워크 연결을 확인해 주세요. '+error.message);process.exitCode=1}
