export const programNow=new Date('2026-11-26T03:00:00+09:00');
export function programSnapshot(){
  const collectedAt='2026-11-25T23:37:22+09:00';
  const make=(suffix,title,extra={})=>({id:'ssu-path:program'+suffix,sourceId:'program'+suffix,title,department:'AI교육팀',sourceStatus:'신청중',presentInLatestInventory:true,
    applicationStartDate:'2026-11-20',applicationEndDate:'2026-12-01',activityPeriod:'2026.12.03 ~ 2026.12.03',detailState:'ok',
    detail:{title,description:'컴퓨터비전과 영상 인식 실습으로 AI 개발 역량을 기릅니다.',category:'특강/워크숍',target:'숭실대학교',targetDetails:'학년: 전체'},
    sourceUrl:'https://path.ssu.ac.kr/ptfol/imng/icmpNsbjtPgm/dialog/nsbjtPgmInfo.do?encSddpbSeq=program'+suffix,applicationUrl:'https://path.ssu.ac.kr/',lastSeenAt:collectedAt,lastDetailSuccessAt:collectedAt,...extra});
  const programs=[make('001','컴퓨터비전 실습 워크숍'),make('002','AI 개발 멘토링',{detailState:'unavailable',detail:null}),
    make('003','컴퓨터비전 프로젝트',{applicationStartDate:'2026-11-28',applicationEndDate:'2026-12-10',sourceStatus:'신청전'}),
    make('004','AI 종료 프로그램',{applicationEndDate:'2026-11-24',effectiveStatus:'open'}),
    make('005','AI 접수 마감 프로그램',{sourceStatus:'신청마감'}),
    make('006','AI 목록에서 사라진 프로그램',{presentInLatestInventory:false}),
    make('007','AI 기간 미확인',{applicationEndDate:null})];
  return {schemaVersion:1,source:'ssu-path-public',collectedAt,run:{outcome:'success',inventoryComplete:true,sourceTotal:6,observedPrograms:6},programs};
}
export function programBridge(){
  const calls=[];
  return {calls,close(){},status:async()=>({connected:true,busy:false}),async recommend(payload,schema,{mode}){
    calls.push({payload,mode});
    if(payload.goal==='실패 확인')throw Error('비교과 검색 실패 테스트');
    return mode==='program-query'?{model:'mock',data:{keywords:['컴퓨터비전','AI']}}:
      {model:'mock',data:{evaluations:payload.programs.map(p=>({programId:p.programId,relevance:'high',reason:p.evidenceType==='name'?'제목에서 AI 진로와의 연관성을 판단했어요.':'영상 인식 실습이 컴퓨터비전 진로와 관련돼요.'}))}};
  }};
}
