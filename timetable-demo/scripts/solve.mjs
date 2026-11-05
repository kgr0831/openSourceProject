import {readFile} from 'node:fs/promises';
import {ortoolsProvider} from '../ortools-provider.mjs';
try{
  let input='';
  if(process.argv[2])input=await readFile(process.argv[2],'utf8');
  else for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>4*1024*1024)throw new Error('Input exceeds 4 MB')}
  const {catalog,request,mode}=JSON.parse(input.replace(/^\uFEFF/,''));
  console.log(JSON.stringify(await ortoolsProvider.solve(catalog,request,{mode}),null,2));
}catch(error){console.log(JSON.stringify({error:{code:error.code||'INVALID_INPUT',message:error.message}}));process.exitCode=1}
