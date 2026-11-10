import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const parserRoot=fileURLToPath(new URL('../lms-parser/',import.meta.url));
const requireParser=createRequire(path.join(parserRoot,'package.json'));
async function ready(){
  try{requireParser.resolve('playwright');await import('../lms-parser/index.mjs');return true}catch{return false}
}
if(!await ready()){
  console.log('LMS 연결에 필요한 구성 요소를 처음 한 번 준비합니다.');
  const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),
    path.join(process.env.ProgramFiles||'C:/Program Files','nodejs/node_modules/npm/bin/npm-cli.js')];
  const npm=candidates.find(candidate=>candidate&&candidate.endsWith('.js')&&existsSync(candidate));
  if(!npm){console.error('Node.js를 설치한 뒤 다시 실행해 주세요. 개발자는 lms-parser 폴더에서 npm ci를 실행할 수 있어요.');process.exit(1)}
  const code=await new Promise(resolve=>{
    const child=spawn(process.execPath,[npm,'ci','--prefix',parserRoot,'--no-audit','--no-fund'],{stdio:'inherit',windowsHide:true});
    child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));
  });
  if(code!==0){console.error('LMS 구성 요소를 준비하지 못했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.');process.exit(1)}
  // A failed module import is cached by Node; verify the fresh install in a new process.
  const codeCheck=await new Promise(resolve=>{
    const child=spawn(process.execPath,['--input-type=module','-e',"await import('./index.mjs'); await import('playwright');"],{cwd:parserRoot,stdio:'ignore',windowsHide:true});
    child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));
  });
  if(codeCheck!==0){console.error('LMS 구성 요소를 불러오지 못했어요. Node.js 20.18.1 이상인지 확인해 주세요.');process.exit(1)}
}
