// Official 2026 course names/credits. All sections, rooms and times are fictional.
export const sources=[
  {title:'AI소프트웨어학부 2026학년도 교과과정',url:'https://ai.ssu.ac.kr/board/dataroom/791?prev=%2Fboard%2Fdataroom%3F'},
  {title:'베어드학부대학 2026학년도 교양필수 교과과정',url:'https://ssubaird.ssu.ac.kr/교양필수-교과과정/'}
];
const majorRows=[
  ['prog1','프로그래밍기초1',1,'전공기초','프로그래밍',4],
  ['prog2','프로그래밍기초2',1,'전공기초','프로그래밍',4],
  ['aimath','기초 AI 수학',1,'전공선택','수학'],
  ['discrete','이산수학',1,'전공기초','수학'],
  ['creative','창의적공학설계',1,'전공선택','설계'],
  ['open','오픈소스기초설계',1,'전공선택','소프트웨어'],
  ['introai','인공지능입문',1,'전공선택','인공지능'],
  ['stats','확률및통계',2,'전공기초','수학'],
  ['ds','자료구조',2,'전공필수','소프트웨어'],
  ['algo','알고리즘',2,'전공필수','소프트웨어'],
  ['ml','머신러닝',2,'전공필수','인공지능'],
  ['arch','컴퓨터구조',2,'전공선택','시스템'],
  ['math2','고급AI수학',2,'전공선택','수학'],
  ['prog3','고급프로그래밍',2,'전공선택','프로그래밍',4],
  ['digital','디지털시스템입문',2,'전공선택','시스템'],
  ['datacom','데이터통신과 네트워크',2,'전공선택','시스템'],
  ['drive','자율주행 프로그래밍',2,'전공선택','로봇'],
  ['web','웹프로그래밍',2,'전공선택','웹'],
  ['os','운영체제',3,'전공필수','시스템'],
  ['sys','시스템프로그래밍',3,'전공선택','시스템'],
  ['db','데이터베이스',3,'전공선택','데이터'],
  ['net','네트워크',3,'전공선택','시스템'],
  ['science','데이터사이언스',3,'전공선택','데이터'],
  ['deep','딥러닝프로그래밍',3,'전공선택','인공지능'],
  ['robot','로봇프로그래밍',3,'전공선택','로봇'],
  ['crypto','암호응용',3,'전공선택','보안'],
  ['bigdata','빅데이터분석',3,'전공선택','데이터'],
  ['server','서버프로그래밍',3,'전공선택','웹'],
  ['design','소프트웨어분석 및설계',3,'전공선택','설계'],
  ['nlp','자연언어처리',3,'전공선택','인공지능'],
  ['vision','컴퓨터비전',4,'전공선택','인공지능'],
  ['security','시스템보안',4,'전공선택','보안']
];
const generalRows=[
  ['debate','인문적상상력과데이터기반토론','인문적상상력과소통','토론'],
  ['reading','융합독서디베이트','인문적상상력과소통','독서'],
  ['future','디지털미래세계와소통','인문적상상력과소통','디지털'],
  ['classic','고전읽기와상상력','인문적상상력과소통','독서'],
  ['writing','비판적사고와학술적글쓰기','비판적사고와표현','글쓰기'],
  ['media','미디어사회와비평적글쓰기','비판적사고와표현','미디어'],
  ['techwrite','기술혁신사회와과학기술글쓰기','비판적사고와표현','글쓰기'],
  ['bible','인문학과성서','인간과성서','인문'],
  ['civil','인류문명과기독교','인간과성서','역사'],
  ['issues','현대사회이슈와기독교','인간과성서','사회'],
  ['global','글로벌시민과국제기구','글로벌시민의식','국제'],
  ['world','세계화와글로벌이슈','글로벌시민의식','국제'],
  ['city','글로벌도시이해','글로벌시민의식','도시'],
  ['english','CTE(Career Track English) for IT, Engineering & Natural Science','글로벌소통과언어','영어',3],
  ['nocode','노코드스타트업','창의적사고와혁신','창업'],
  ['thinking','디자인씽킹','창의적사고와혁신','디자인'],
  ['startup','미래기술스타트업','창의적사고와혁신','창업'],
  ['venture','혁신과기업가정신','창의적사고와혁신','창업']
];
const buildings=['정보과학관','형남공학관','진리관','백마관'];
function sections(id,index,hours,kind){
  const duration=hours*60,starts=hours===4?[540,780,1020]:hours===3?[540,720,900,1080]:[540,660,780,900,1020,1140];
  const start=starts[index%starts.length],half=duration/2;
  const pair=index%2?[1,3]:[0,2],pairStart=540+(index%5)*90;
  const otherDay=[0,1,3,4][index%4],otherStart=starts[(Math.floor(index/4)+index+1)%starts.length];
  return [
    {id:`${id}-01`,building:buildings[(index+(kind==='general'?2:0))%4],meetings:[[2,start,start+duration]]},
    {id:`${id}-02`,building:buildings[(index+1)%4],meetings:pair.map(day=>[day,pairStart,pairStart+half])},
    {id:`${id}-03`,building:buildings[(index+2)%4],meetings:[[otherDay,otherStart,otherStart+duration]]}
  ];
}
export const courses=[
  ...majorRows.map(([id,name,year,classification,topic,hours=3],index)=>({id,name,shortName:name,kind:'major',credits:3,year,classification,group:null,topic,sections:sections(id,index,hours,'major')})),
  ...generalRows.map(([id,name,group,topic,credits=2],index)=>({id,name,shortName:id==='english'?'CTE 영어(IT·공학·자연)':name,kind:'general',credits,year:null,classification:'교양필수',group,topic,sections:sections(id,index+2,credits,'general')}))
];
export const catalogInfo={university:'숭실대학교',department:'AI소프트웨어학부',majorCount:majorRows.length,generalCount:generalRows.length,sectionCount:courses.reduce((n,c)=>n+c.sections.length,0),verifiedAt:'2026-10-13',notice:'과목명·학점은 숭실대 교육과정 기준. 시간·분반·강의실은 가상이며 실제 개설 학기·수강 자격·졸업 요건을 판정하지 않습니다.'};
