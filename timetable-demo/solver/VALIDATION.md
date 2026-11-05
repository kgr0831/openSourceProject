# OR-Tools 적용 검증

검증일: 2026-11-06. Windows, Python 3.13.7, 실제 OR-Tools **9.15.6755**. 원본 규칙 패키지의 `artifact_validation.json`과 `ortools_acceptance.json`은 명세이며 실행 결과로 사용하지 않았다.

## 실행한 검증

| 검증 | 결과 |
|---|---|
| `npm test` | 기존 30개 + Node/worker 통합 6개 = **36개 통과** |
| `npm run test:solver` | **20개 통과** (실제 엔진 17개, 명시적 상태 경계 대역 3개) |
| 기존 Chrome 기능 흐름 | **19개 통과**: 저장·캘린더·휴강/복원·ICS·기록·빈 결과·오류·취소·4개 화면 폭 등 |
| `scripts/browser-solver-check.mjs` | **5개 통과**: 필수 조건 전달, 명시적 최소 완화, 원본 조건 보존/저장 전 표시, 대체안/캘린더 보존, 320·390·768·1440px |
| `node scripts/check-solver.mjs` | 고정 버전의 실제 CP-SAT solve 성공 |
| 기존 Chrome 모션 검증 | 애니메이션·탭·키보드 포커스·하단 버튼·동작 줄이기·5개 화면 폭 통과 |

기존 Node 테스트의 추천 호출만 비동기 `await`로 전환했다. 의미 있는 기존 assertion은 유지했다. 50과목·150개 가상 분반에 대한 일별/학점 조합과 기존 선호 계산도 실제 엔진을 거친다. 브라우저 검증은 별도 Chrome 컨텍스트에서 수행했으며 사용자의 저장 데이터와 실제 AI 계정 요청은 사용하지 않았다.

브라우저 추가 검증 재실행: 실행 중인 앱에 대해 설치된 Playwright 모듈 경로를 `PLAYWRIGHT_MODULE`, 앱 주소를 `TIMETABLE_URL`로 지정하고 `node scripts/browser-solver-check.mjs`를 실행한다. 기본 스크린샷/보고서 위치는 OS 임시 폴더의 `timetable-ortools-qa`다. Playwright는 앱 런타임 의존성이 아니다.

## ORT001–ORT014 대응

| 항목 | 실행 증거 |
|---|---|
| ORT001 | 실제 버전·solve, 존재하지 않는 Python, `python -S`로 라이브러리 부재 확인. 명시적 오류이며 fallback 없음 |
| ORT002 | Node 실제 통신과 `evidence/recommend.json`, `alternative.json`, `relax.json`의 실제 단계 기록 |
| ORT003 | 충돌하는 필수 두 과목의 실제 INFEASIBLE, 인접 수업은 허용. Node 독립 검증 및 위조 결과 거절 |
| ORT004 | 실제 오전 2→3 최소 완화, 원래/유효 조건 분리, F1–F3 값과 증명 확인 |
| ORT005 | `ControlledStatusBoundaryTests`의 FEASIBLE 상태 대역: 다음 목표 고정/증명 진행 금지 |
| ORT006 | UNKNOWN/MODEL_INVALID 대역에서 앞 유효 해 유지. 실제 0.001초 제한도 관측 상태만 검증하며 특정 시간 내 특정 상태를 강요하지 않음 |
| ORT007 | 실제 열거에서 `{A}`와 `{A,B}`가 모두 보존됨 |
| ORT008 | 점심 위치가 여럿이어도 한 분반 집합을 1개로 집계, 잔여 모델 INFEASIBLE 후만 전수 종료 |
| ORT009 | 공강 0분·60분 Top-2를 모두 반환, 첫 순위의 공강 등식을 다음 순위에 유지하지 않음 |
| ORT010 | 1.5+0.3=1.8 학점을 배율 10으로 처리하고 Node BigInt 재검증 |
| ORT011 | 점심 60→45분일 때 필요한 기존 카탈로그 과목이 실제 완화 결과에 포함됨 |
| ORT012 | 한글 ID/이름·복수 요일·정책·상태의 Node/worker/CLI UTF-8 통신, 취소 시 프로세스 정리 |
| ORT013 | 최소 비용에서 공강 0분·10분 후보를 다시 최적화. 더 비싼 오전 4회 후보로 K개를 채우지 않음 |
| ORT014 | 정확한 ID 목록/짧은 prefix 순서, seed 변경 시 같은 완전 순위, gap=0 및 objective/bound 검증 |

추가 실제 엔진 검증: 12:07 시작 연속 점심, 점심 앞뒤 수업 요구, 오전 횟수/일수와 경계, allow=false/중요도 0, 학점 양쪽 경계를 한 그룹으로 계산, 학점별 별도 보호 목표/최소 완화, 작은 카탈로그의 독립 조합 열거와 결과 집합 일치, 학기/요일/불완전 시간 데이터 제외.

상태 경계 대역은 실제 모델을 먼저 풀고 반환 상태를 제어하는 테스트 전용 factory다. 실제 엔진 성능이나 임의 입력에서 그 상태가 자연 발생했다는 증거로 쓰지 않는다. 일반 통합/운영 경로에는 대역 주입이 없다.

## 보관한 실제 실행 기록

`node scripts/solver-evidence.mjs`로 재생성한다. 각 파일에는 입력 전체와 실제 엔진의 raw status, 값, bound, 증명 prefix, 원래/유효 조건, Node 재검증 결과를 저장했다. 아래 사례는 작은 합성 카탈로그이며 원본 CSV 결과가 아니다.

| 파일 | 결과 |
|---|---|
| [recommend.json](evidence/recommend.json) | 정상 추천 2개, 순위 증명 및 해당 범위 전수 종료 |
| [alternative.json](evidence/alternative.json) | 실패 C1을 C2로 교체, 과목/학점 보존, 대체안 1개 |
| [relax.json](evidence/relax.json) | 원래 INFEASIBLE, 오전 2→3, 최소 비용 `[1,2,1]`, 같은 비용의 후보 2개 |
| [time-limited.json](evidence/time-limited.json) | 실제 0.001초 예산의 관측 상태/종료 이유 기록. 실행 환경에 따라 상태는 달라질 수 있음 |

## 미실행 범위

규칙 패키지에서 언급한 **기존 핵심 100개, R001–R030, I031–I040 스위트 및 원본 CSV**는 이 저장소에 제공되지 않았다. 해당 테스트를 실행·통과했다고 주장하지 않는다. 원본 CSV의 동일 해시·범위·조건이 없으므로 **676개(15학점 524 / 18학점 140 / 21학점 12)** 결과 역시 미검증이다.

실제 대학의 개설·수강 자격·졸업 요건과 외부 캘린더 연동은 이 적용의 검증 대상이 아니다. 현재 UI 데이터는 기존 150개 가상 분반이다. 엔진 및 계약 검증이 실제 수강 신청 가능성을 보증하지 않는다.
