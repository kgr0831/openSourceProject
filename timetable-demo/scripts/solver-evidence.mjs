import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ortoolsProvider} from '../ortools-provider.mjs';
const dir=fileURLToPath(new URL('../solver/evidence/',import.meta.url));
const block=(start,end)=>({day:1,start,end});
const catalog={version:'acceptance-synthetic-v1',sections:[
  {section_id:'A',course_id:'A',name:'기초 과목',term:'2026-2',credits:1,meetings:[block(540,600)]},
  {section_id:'B',course_id:'B',name:'실습 과목',term:'2026-2',credits:1,meetings:[block(600,660)]},
  {section_id:'C1',course_id:'C',name:'선택 과목',term:'2026-2',credits:1,meetings:[block(660,720)]},
  {section_id:'C2',course_id:'C',name:'선택 과목',term:'2026-2',credits:1,meetings:[block(670,730)]}
]};
const request={term:'2026-2',catalog_version:catalog.version,constraints:{allowed_weekdays:[1],credits:{min:3,max:3},required_course_ids:['A','B','C'],morning:{before_minute:720,unit:'meeting',max:3}},ranking:{mode:'lexicographic',profile:'compact'},selection:{mode:'top_k',k:3},search_options:{time_limit_seconds:5,workers:1,seed:42}};
await mkdir(dir,{recursive:true});
for(const mode of ['recommend','alternative','relax']){
  const input=structuredClone(request);
  if(mode==='alternative')input.baseline={section_ids:['A','B','C1'],failed_section_ids:['C1']};
  if(mode==='relax'){input.constraints.morning.max=2;input.relaxation_policy={max_changed:1,rules:{morning_limit:{allow:true,importance:2,step:1,allowed_values:[3,4]}}}}
  const result=await ortoolsProvider.solve(catalog,input,{mode});
  await writeFile(dir+mode+'.json',JSON.stringify({recorded_at:new Date().toISOString(),input:{catalog,request:input,mode},result},null,2)+'\n');
  console.log(JSON.stringify({mode,engine:result.engine_version,status:result.original_status,count:result.returned_unique_count,cost:result.minimum_relaxation_cost,ranking_proven:result.ranking_proven,coverage:result.coverage}));
}
const limited=structuredClone(request);limited.search_options.time_limit_seconds=0.001;
const observed=await ortoolsProvider.solve(catalog,limited);
await writeFile(dir+'time-limited.json',JSON.stringify({recorded_at:new Date().toISOString(),input:{catalog,request:limited,mode:'recommend'},result:observed},null,2)+'\n');
console.log(JSON.stringify({mode:'observed-time-limit',original_status:observed.original_status,termination:observed.termination_reason,count:observed.returned_unique_count}));
