import {spawn} from 'node:child_process';
import {solverPython} from '../ortools-provider.mjs';
const code='import ortools; from ortools.sat.python import cp_model; assert ortools.__version__ == "9.15.6755"; m=cp_model.CpModel(); x=m.new_bool_var("x"); m.add(x==1); s=cp_model.CpSolver(); assert s.solve(m)==cp_model.OPTIMAL and s.value(x)==1; print("OR-Tools "+ortools.__version__+" ready")';
const child=spawn(solverPython(),['-c',code],{stdio:['ignore','inherit','ignore'],windowsHide:true});
const failed=()=>{console.error('추천 엔진 준비가 필요합니다. timetable-demo 폴더에서 npm run setup:solver를 실행해 주세요.');process.exitCode=1};
child.on('error',failed);child.on('close',status=>{if(status!==0)failed()});
