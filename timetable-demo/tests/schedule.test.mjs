import test from 'node:test';
import assert from 'node:assert/strict';
import {courses,defaultRequest,generateCandidates,hasConflict,validateRequest,validateAiResult,applyIntent,intentSchema} from '../schedule.mjs';
const base=()=>structuredClone(defaultRequest);
const exact=(total,major,general)=>({total:{min:total,max:total},major:{min:major,max:major},general:{min:general,max:general}});
function verify(result){
  const r=result.request;
  assert.equal(new Set(result.candidates.map(c=>c.id)).size,result.candidates.length);
  for(const c of result.candidates){
    assert.equal(hasConflict(c.sections),false);
    assert.equal(new Set(c.sections.map(s=>s.courseId)).size,c.sections.length);
    const groups=c.sections.filter(s=>s.group).map(s=>s.group);assert.equal(new Set(groups).size,groups.length);
    assert.ok(r.requiredCourseIds.every(id=>c.sections.some(s=>s.courseId===id)));
    assert.ok(c.sections.every(s=>!r.excludedCourseIds.includes(s.courseId)));
    let major=0,general=0;
    for(const s of c.sections){
      const course=courses.find(t=>t.id===s.courseId),section=course.sections.find(t=>t.id===s.id);
      assert.ok(section);assert.deepEqual(s.meetings,section.meetings);
      if(course.kind==='major')major+=course.credits;else general+=course.credits;
      assert.ok(s.meetings.every(([d,start,end])=>r.allowedDays.includes(d)&&start>=r.earliestStart&&end<=r.latestEnd));
    }
    assert.equal(c.majorCredits,major);assert.equal(c.generalCredits,general);assert.equal(c.credits,major+general);
    for(const [key,n] of [['major',major],['general',general],['total',major+general]])assert.ok(n>=r.credits[key].min&&n<=r.credits[key].max);
  }
}
test('50과목 150분반, 학점·시간·고유 ID 일관성',()=>{
  assert.equal(courses.length,50);assert.equal(courses.filter(c=>c.kind==='major').length,32);
  assert.equal(courses.flatMap(c=>c.sections).length,150);
  assert.equal(new Set(courses.map(c=>c.id)).size,50);
  for(const c of courses)for(const s of c.sections){assert.ok(s.meetings.every(([d,start,end])=>d>=0&&d<=4&&start>=540&&end<=1260&&end>start));assert.ok(s.meetings.reduce((n,[,start,end])=>n+end-start,0)>=c.credits*60)}
});
test('인접 수업 허용, 두 번째 요일의 시간 충돌도 제외',()=>{
  assert.equal(hasConflict([{meetings:[[0,540,600]]},{meetings:[[0,600,660]]}]),false);
  assert.equal(hasConflict([{meetings:[[0,540,600],[2,540,600]]},{meetings:[[2,590,660]]}]),true);
});
test('수요일만 전공 6 + 교양 2학점 자동 선택',async()=>{
  const r=await generateCandidates({...base(),allowedDays:[2],credits:exact(8,6,2)});
  assert.ok(r.candidates.length>=3);verify(r);assert.ok(r.candidates.every(c=>c.metrics.days===1));
  assert.ok(new Set(r.defaultIds.map(id=>r.candidates.find(c=>c.id===id).sections.map(s=>s.courseId).sort().join(','))).size>=2);
});
test('교양만 6학점, 같은 교과목군 중복 선택 금지',async()=>{
  const r=await generateCandidates({...base(),credits:exact(6,0,6)});assert.ok(r.candidates.length>=3);verify(r);
  assert.ok(r.candidates.every(c=>c.sections.every(s=>s.kind==='general')));
});
test('전공 최소 9학점, 교양 최소 4학점으로 총 18학점',async()=>{
  const r=await generateCandidates({...base(),credits:{total:{min:18,max:18},major:{min:9,max:18},general:{min:4,max:9}}});assert.ok(r.candidates.length>=3);verify(r);
});
test('필수 과목·제외·수업 시작 종료 제한을 유지',async()=>{
  const r=await generateCandidates({...base(),requiredCourseIds:['db'],excludedCourseIds:['ml','os'],earliestStart:720,latestEnd:1260});assert.ok(r.candidates.length);verify(r);
});
test('월·수 집중 시간표도 실제 선택 요일만 사용',async()=>{
  const r=await generateCandidates({...base(),allowedDays:[0,2],credits:{total:{min:12,max:14},major:{min:6,max:9},general:{min:4,max:6}}});assert.ok(r.candidates.length);verify(r);
});
test('불가능한 학점과 교양 교과목군 충돌은 설명하고 반환하지 않는다',async()=>{
  const excessive=await generateCandidates({...base(),allowedDays:[2],credits:exact(18,12,6)});assert.equal(excessive.total,0);assert.match(excessive.diagnostics[0],/주 9시간/);
  const grouped=await generateCandidates({...base(),requiredCourseIds:['classic','reading']});assert.equal(grouped.total,0);assert.match(grouped.diagnostics[0],/교과목군/);
  const inconsistent=await generateCandidates({...base(),credits:{total:{min:10,max:10},major:{min:9,max:12},general:{min:4,max:6}}});assert.equal(inconsistent.total,0);
});
test('모든 요일별 작은 시간표와 여러 학점 조합의 하드 조건 검증',async()=>{
  let validCases=0;
  for(let day=0;day<5;day++)for(const [total,major,general] of [[6,6,0],[6,0,6],[8,6,2],[9,9,0]]){
    const r=await generateCandidates({...base(),allowedDays:[day],credits:exact(total,major,general),latestEnd:1260});verify(r);if(r.total)validCases++;
  }
  assert.ok(validCases>=12);
});
test('잘못된 요일·과목·범위·중복·긴 입력은 거절',()=>{
  assert.throws(()=>validateRequest({...base(),allowedDays:[]}));
  assert.throws(()=>validateRequest({...base(),allowedDays:[5]}));
  assert.throws(()=>validateRequest({...base(),requiredCourseIds:['fake']}));
  assert.throws(()=>validateRequest({...base(),requiredCourseIds:['db'],excludedCourseIds:['db']}));
  assert.throws(()=>validateRequest({...base(),credits:exact(-1,9,4)}));
  assert.throws(()=>validateRequest({...base(),note:'a'.repeat(401)}));
});
test('AI 해석 조건을 검증하고 필수·제외를 명시적 요청대로 변경',async()=>{
  const raw=Object.fromEntries(Object.keys(intentSchema.properties).map(k=>[k,null]));
  Object.assign(raw,{summary:'수요일 8학점',unsupported:[],allowedDays:[2],totalMin:8,totalMax:8,majorMin:6,majorMax:6,generalMin:2,generalMax:2,requiredCourseIds:['algo'],excludedCourseIds:['db'],preferredCourseIds:['introai'],preferences:{late:false}});
  const result=applyIntent({...base(),requiredCourseIds:['db']},raw);assert.deepEqual(result.request.allowedDays,[2]);assert.deepEqual(result.request.requiredCourseIds,['algo']);assert.ok(result.request.excludedCourseIds.includes('db'));assert.equal(result.request.preferences.friday,true);
  const plans=await generateCandidates(result.request);assert.ok(plans.total);verify(plans);
  assert.throws(()=>applyIntent(base(),{...raw,requiredCourseIds:['fake']}));
  assert.throws(()=>applyIntent(base(),{...raw,allowedDays:[-1]}));
});
test('AI 후보 ID 위조·중복·개수 오류를 거절',async()=>{
  const {candidates}=await generateCandidates(base());
  const valid={summary:'추천',recommendations:candidates.slice(0,3).map(c=>({id:c.id,reason:'조건 충족'}))};
  assert.deepEqual(validateAiResult(valid,candidates),valid);
  assert.throws(()=>validateAiResult({...valid,recommendations:[{id:'fake',reason:'가짜'},...valid.recommendations.slice(1)]},candidates));
  assert.throws(()=>validateAiResult({...valid,recommendations:[valid.recommendations[0],...valid.recommendations.slice(0,2)]},candidates));
});
