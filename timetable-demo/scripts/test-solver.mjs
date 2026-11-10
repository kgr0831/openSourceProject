import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {solverPython} from '../ortools-provider.mjs';
const child=spawn(solverPython(),['-m','unittest','discover','-s','solver','-p','test_*.py','-v'],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:'inherit',windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
child.on('error',()=>{console.error('Run npm run setup:solver first.');process.exitCode=1});
child.on('close',code=>{process.exitCode=code??1});
