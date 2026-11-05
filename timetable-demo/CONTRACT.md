# OR-Tools 연결 계약

`../timetable_ortools_rulebase/ortools_rulebase`의 2026-11-01 명세를 현재 데모에 적용한 계약이다. 이 폴더의 JSON은 실행 코드나 테스트 결과가 아니다.

## 실행 경로

`public/app.js` → `server.mjs` → 비동기 `generateCandidates()` → `OrToolsCandidateProvider.solve()` → Python `solver/worker.py` → `solver/engine.py`의 실제 `CpModel`/`CpSolver.solve()`.

반환 결과는 `ortools-contract.mjs`에서 과목·분반·모든 시간 블록·학점·생활 조건·변경 내역·지표를 독립 재계산한다. 과거 빔 탐색 경로는 제거했다. AI는 유효 후보 해석/설명에만 참여하며 분반 선택을 대신하지 않는다.

```powershell
cd timetable-demo
npm run setup:solver
npm start
npm test
npm run test:solver
```

Node 20+, Python 3.10+, OR-Tools **9.15.6755**. 설치 스크립트는 프로젝트 `.venv`에만 설치하고 실제 작은 CP-SAT 문제를 풀어 확인한다. 검증 환경은 Windows/Python 3.13.7이다. `TIMETABLE_PYTHON`으로 별도 Python 경로를 지정할 수 있다. 런처는 버전과 실제 solve를 먼저 확인한다.

## 브라우저 API

기존 UI 요청의 학점/요일/선호 필드는 유지한다. 추가 필드는 `term`, `catalogVersion`, `rankingProfile`, `attendanceDays`, `morning`, `lunch`, `lockedSectionIds`, `excludedSectionIds`, `relaxationPolicy`다. 누락한 기존 요청에는 기본값을 채운다. UI 요일은 기존대로 월요일 0–금요일 4이며 어댑터에서 ISO 1–7로 변환한다.

| 요청 | 본문 | 동작 |
|---|---|---|
| `POST /api/candidates` | UI request | 원래 조건 추천 |
| `POST /api/relax` | UI request + 명시적 `relaxationPolicy` | 원래 조건의 INFEASIBLE 증명 후 허용한 항목만 완화 |
| `POST /api/alternatives` | `{request, baseline}` | 실패 분반을 제외하는 대체안 |
| `POST /api/recommend` | UI request | 기존 AI 해석 → CP-SAT → AI 설명 |

POST는 `Content-Type: application/json`, `X-Timetable-App: 1`이 필요하다. 로컬 호스트/출처 검사와 8 KB 요청 제한을 유지한다. `generateCandidates()`는 이제 Promise를 반환하므로 호출자는 `await`해야 한다.

`total`은 이번에 반환한 후보 수다. 전체 가능 시간표 수는 `totalUniqueCount`이며 전수 종료 증명 전에는 `null`이다. `solver`에 상세 증명 메타데이터가 있고 각 후보의 `solverResult`에 원래/유효 조건 및 변경 내역이 있다. 저장 데이터 형식은 유지하고 후보에 원래 요청 스냅샷을 추가했다.

## Node/worker 및 CLI 입력

셸을 거치지 않는 자식 프로세스의 stdin/stdout으로 UTF-8 JSON 문서 한 개씩 통신한다. 오류는 `{error:{code,message}}`다. 진단 로그는 JSON 채널에 넣지 않는다.

```json
{
  "mode": "recommend",
  "catalog": {
    "version": "example-v1",
    "sections": [
      {
        "section_id": "A-01", "course_id": "A", "term": "2026-2",
        "name": "자료구조", "credits": 1.5, "kind": "major",
        "building": "정보과학관",
        "meetings": [{"day": 1, "start": 600, "end": 690}]
      }
    ]
  },
  "request": {
    "term": "2026-2", "catalog_version": "example-v1",
    "constraints": {
      "allowed_weekdays": [1, 2, 3, 4, 5],
      "credits": {"min": 1.5, "max": 1.5},
      "required_course_ids": ["A"], "excluded_course_ids": [],
      "locked_section_ids": [], "excluded_section_ids": [],
      "attendance_days": {"mode": "max", "value": 3},
      "morning": {"before_minute": 720, "unit": "meeting", "max": 2},
      "lunch": {"enabled": true, "window_start": 720, "window_end": 840, "duration": 60, "placement": "within_window"}
    },
    "ranking": {"mode": "lexicographic", "profile": "compact"},
    "selection": {"mode": "top_k", "k": 3},
    "search_options": {"time_limit_seconds": 10, "workers": 1, "seed": 42}
  }
}
```

파일 입력: `node scripts/solve.mjs input.json`. stdin도 지원한다. npm 실행 메시지 없이 JSON만 받으려면 Node 명령을 직접 사용한다. 실제 실행 예시는 `solver/evidence/*.json`의 `input` 필드다. `node scripts/solver-evidence.mjs`로 세 경로의 기록을 재생성할 수 있다.

분반은 최대 500개, 분반별 블록은 최대 30개다. 시간이 미상이거나 내부 블록이 겹치는 분반은 진단과 함께 제외하고 원래 필수 과목 요구는 유지한다. 중복 분반 ID는 입력 오류다. 학점은 십진수/십진 문자열을 정확한 유리수로 파싱해 정수 배율을 사용한다. 배율은 최대 1,000,000이며 지원 범위를 넘으면 명시적으로 거절한다. 시간은 분 단위 `[start,end)`로 처리한다.

카탈로그 `term`과 요청 학기를 비교한다. 데모의 150개 분반은 가상 데이터이므로 UI 어댑터는 선택 학기를 그 가상 분반에 부여한다. 이것은 실제 학기별 개설 목록이 아니다. 실데이터를 CLI/Provider로 넘길 때는 원본 학기를 유지하며 다른 학기 분반은 선택되지 않는다. 학년·선수과목·졸업 자격은 기존처럼 판정하지 않는다.

## 필수 조건과 목표 순서

H001 충돌, H002 과목당 한 분반, H004 필수 과목, H005 제외 과목/분반, H006 고정 분반, H007 요일/학기는 완화하지 않는다. 기존 앱의 수업 시작/종료 한도, 전공/교양 학점, 교양 교과목군 중복 금지도 추가 보호 조건이다.

H003 총 학점, H008 등교일 정확히/최대, H009 오전 상한, H010 연속 점심시간을 모델에 직접 넣는다. 오전은 시작 시각이 경계보다 **작을 때만** 세며 `meeting`은 블록 수, `day`는 해당 요일 수다. 점심은 등교하는 날마다 모든 정수 분 시작을 검토한다. `between_classes`는 점심 앞뒤에 선택된 수업이 모두 있어야 한다. 논리적으로 동일한 점심 위치만 합치며 15분 격자로 반올림하지 않는다.

| 프로필 | 엄격한 사전식 최소화 순서 |
|---|---|
| `compact` | 주간 공강 합 → 가장 늦은 종료 → 하루 최대 수업 분 → 오전 수업 횟수 → ID 목록 |
| `fewer_days` | 등교일 → 공강 합 → 가장 늦은 종료 → ID 목록 |
| `balanced` | 하루 최대 수업 분 → 공강 합 → 가장 늦은 종료 → ID 목록 |

ID 목록은 Unicode 코드 포인트 순으로 정렬한 문자열 목록의 사전식 비교다. 앞부분이 같으면 짧은 목록이 먼저다. ID 숫자 합이나 seed로 대체하지 않는다. 각 목표가 OPTIMAL일 때만 그 값을 고정한다. 모든 solve의 상대/절대 gap 한도는 0이다.

OR-Tools가 `best_objective_bound`를 double로 노출하므로 22가 21.999999999999996으로 기록될 수 있다. 원시 bound는 그대로 보관하고 Node의 부가 일치 검사는 부동소수점 표현 오차만 허용한다. 정수 목표·학점 값을 반올림하거나 solver gap을 완화하지 않으며 1 이상의 잘못된 목표 경계는 거절한다.

기존 선호를 보존하는 확장 `personalized`는 기존 가중 점수 ×20인 정수 `legacy_cost_units`를 먼저 최소화하고 위 프로필을 적용한다. 기본 UI의 `selection.mode=profiles`는 등교일/균형/공강 순으로 서로 다른 후보를 하나씩 찾는다. 후속 후보는 앞서 반환한 분반 집합을 제외한 범위에서 해당 프로필을 최적화한다. 이 세 가지 비교안 전체를 한 프로필의 전역 Top-3라고 표시하지 않는다. 엄격한 세 프로필에서는 기존 가중 선호를 사용하지 않는다.

## Top-K와 학점별 대표안

매 순위는 새 모델에서 선호를 다시 최적화한다. 이전 순위의 숫자 목표 고정은 이어받지 않는다. 제외식은 전체 분반 변수에 대해 `sum(1-x for selected) + sum(x for unselected) >= 1`이다. 따라서 `{A}`를 제외해도 `{A,B}`를 삭제하지 않는다. 점심 위치만 다른 결과는 같은 시간표다.

`selection.mode=by_credit`, `credit_targets=[15,18,21]`은 목표별 독립 실행이다. 각 목표 학점을 보호된 등식으로 넣고 그 목표의 원래 조건 판정·완화 최적 벡터를 별도로 기록한다. 전역 상위 3개를 학점 대표로 재사용하지 않는다. 전체 시간 예산은 공유한다.

`selection.mode=enumerate`는 목적함수 없이 분반 집합을 최대 `k`개 찾는다(최대 2,000). 남은 모델이 INFEASIBLE일 때만 `coverage=exhaustive`와 전체 개수를 반환한다. K개 도달 또는 시간 중단은 `partial`, 전체 개수는 `null`이다. 완화 전수 열거와 대체+완화 복합 모드는 지원하지 않는다는 입력 오류를 반환한다.

## 명시적 최소 완화

`mode=relax`라도 원래 모델을 먼저 푼다. 원래 조건에서 유효 해를 찾으면 조건을 바꾸지 않는다. UNKNOWN/시간 종료를 INFEASIBLE로 바꾸지 않는다. 다음과 같은 정책을 **명시적으로** 받은 경우에만 원래 INFEASIBLE 이후 완화한다.

```json
{
  "max_changed": 1,
  "scope": "minimum_cost_only",
  "rules": {
    "morning_limit": {"allow": true, "importance": 2, "step": 1, "allowed_values": [3,4]},
    "lunch_duration": {"allow": false}
  }
}
```

허용 그룹은 `attendance_days`, `morning_limit`, `credit_range`, `lunch_duration`이다. 누락/allow=false는 원래 값을 유지하고 importance=0도 허용을 뜻하지 않는다. 각 그룹은 원래 값과 허용 값 중 하나를 선택한다. 원래 등교일 모드, 오전 경계/단위, 점심 창/위치는 바꾸지 않는다. 최대 등교일·오전 상한은 증가만, 점심 길이는 감소만, 학점 범위는 확대만 허용한다. 정확한 등교일은 명시된 양방향 값이 가능하다. 학점 최소/최대 변경은 한 그룹이고 각 경계가 step 배수여야 한다.

F1 변경 그룹 수 → F2 변경한 그룹의 중요도 합 → F3 정확한 변화량/step 합 → 선택 프로필 순으로 푼다. 최초 증명한 F1–F3 벡터만 이후 후보 전체에 고정하고 각 순위의 선호는 다시 푼다. 후보가 모자라도 더 큰 완화 비용으로 채우지 않는다. 원래 점심 조건으로 카탈로그를 사전 삭제하지 않는다.

변경 결과마다 `original_constraints`, `effective_constraints`, `changes`, `validation.original_valid`, `validation.original_violations`를 구분한다. 원래 request나 저장한 캘린더를 자동 덮어쓰지 않는다. 사용자가 변경 내역을 확인하고 저장한 후보에서 대체안을 찾으면 그 후보의 유효 조건을 사용한다.

## 대체안

`mode=alternative`의 `baseline`은 `section_ids`, `failed_section_ids`, 선택적 `allow_course_replacement`(기본 false), `preserve_credit_total`(기본 true)를 받는다. 실패 분반은 기존 시간표의 일부여야 하며 고정 분반과 겹치면 오류다. 원래 과목/학점 보존 → 실패 분반 제외 → 과목 대칭차 → 분반 대칭차 → 프로필 순으로 처리한다. 보호 조건과 사용자 필수 조건은 항상 유지한다.

`alternative_changes`는 제거/추가 과목·분반과 같은 과목의 분반 교체 쌍을 반환한다. 한 과목의 분반 변경에서 분반 대칭차 2를 ‘두 과목 변경’으로 표시하지 않는다.

## 상태·예산·오류

10초 기본 예산을 원래 판정/완화/모든 사전식 단계/Top-K에 공유한다. 지원 범위는 0.001–120초, workers 1–8이며 기본 및 수용 검증은 workers=1, seed=42다. 모델 구성 시간도 예산에 포함한다. Node는 Python 시작·입출력용 여유 5초를 더해 프로세스 응답 기한을 관리한다. 중단/연결 종료 시 자식 프로세스를 종료하며 동시 실행은 최대 4개다. 별도 상주 Python 서비스는 없다.

`OPTIMAL`만 해당 목표의 증명이다. `FEASIBLE`은 유효하지만 미증명인 해다. `UNKNOWN`, `BUDGET_EXHAUSTED`, `MODEL_INVALID` 이후에도 앞 단계의 유효 해가 있으면 보존한다. 유효 해가 없으면 불가능 판정과 구분된 빈 결과 또는 명시적 오류를 반환한다. 초기 모델 오류는 `MODEL_INVALID`, Python/라이브러리 부재는 `ENGINE_UNAVAILABLE`, 응답 기한은 `ENGINE_TIMEOUT`, 독립 검증 실패는 `ENGINE_VALIDATION_FAILED`다. 자동 fallback은 없다.

메타데이터에는 실제 엔진 버전, 모델 build ID, 카탈로그 버전/SHA-256, 정규화 요청, 단계별 raw status/value/bound/시간, 증명된 목표 prefix, 최소성/순위 증명 여부, 범위·종료 이유·고유 개수가 있다. 완화 전수 종료는 `coverage_scope.mode=minimum_cost_only` 범위의 종료이며 모든 더 비싼 조정안을 탐색했다는 뜻이 아니다. 학점별 실행은 `target_results`에 각각의 증명을 남긴다.

검증 세부와 미제공 회귀 데이터는 [solver/VALIDATION.md](solver/VALIDATION.md)를 참고한다.
