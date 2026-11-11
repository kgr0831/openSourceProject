import {validateCareerList} from './career-model.mjs';
import {emptyPlanner,restorePlanner,createSemesterEvents,editEvents,validateEvent} from './planner-core.mjs';

export const storageKey='ssu-timetable-planner-v1';

// Preserve the existing storage format, semesters and private notes.
export function createPlannerStore(storage) {
  let data=emptyPlanner(),readError='';
  try{const raw=storage.getItem(storageKey);if(raw)data=restorePlanner(JSON.parse(raw))}
  catch{readError='저장된 기록을 읽지 못했어요. 기존 데이터는 보존했습니다. 브라우저 저장 설정을 확인해 주세요.'}
  function save(next){
    if(readError)throw new Error(readError);
    restorePlanner(next);
    try{storage.setItem(storageKey,JSON.stringify(next))}
    catch{throw new Error('브라우저에 저장하지 못했어요. 저장 공간과 브라우저 설정을 확인해 주세요.')}
    data=next;
  }
  return {
    get data(){return data},get readError(){return readError},
    setSemester(candidate,start,end){
      const events=createSemesterEvents(candidate,start,end);
      save({...data,semester:{start,end,candidate:structuredClone(candidate)},events});
    },
    saveCareerList(list){
      validateCareerList(list);
      save({...data,careerRecommendations:structuredClone(list)});
    },
    changeEvent(id,patch,options){save({...data,events:editEvents(data.events,id,patch,{...options,period:data.semester})})},
    addEvent(patch){
      if(!data.semester)throw new Error('먼저 시간표를 저장해 주세요.');
      if(data.events.length>=2000)throw new Error('저장 가능한 일정 수를 초과했어요.');
      const event=validateEvent({...patch,id:crypto.randomUUID(),status:'active'});
      if(event.date<data.semester.start||event.date>data.semester.end)throw new Error('학기 기간 안의 날짜를 선택해 주세요.');
      save({...data,events:[...data.events,event]});
    },
    addRecord(title,body,candidate){
      if(!candidate)throw new Error('기록할 시간표를 먼저 선택해 주세요.');
      if(!title.trim()||!body.trim())throw new Error('제목과 선택한 이유를 입력해 주세요.');
      if(data.experiences.length>=50)throw new Error('내 기록은 최대 50개까지 저장할 수 있어요.');
      const entry={id:crypto.randomUUID(),title:title.trim(),body:body.trim(),courseNames:candidate.sections.map(s=>s.name)};
      save({...data,experiences:[...data.experiences,entry]});
    }
  };
}
