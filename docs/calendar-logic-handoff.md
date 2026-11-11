# 학기 캘린더 처리 계약

추천 후보를 선택해 확정하면 분반의 모든 요일과 시간 블록에서 날짜별 수업을 생성한다. 기존 학기 일정의 편집, 휴강, 충돌 표시, LMS 가져오기와 ICS 내보내기를 사용한다. 이번 변경에서 필드 단위 편집, 연결된 시험·보강, 변경 미리보기와 기록, 되돌리기, 적용일 기준의 시간표 교체를 추가했다. 추천 후보의 생성·비교·분반 탐색에서는 캘린더를 저장하지 않는다. 일정 계산은 기존 OR-Tools 추천 경로와 독립적으로 실행된다.

## 데이터

| 필드 | 의미 |
| --- | --- |
| `version`, `revision` | 저장 스키마는 `2`. 성공한 쓰기마다 `revision`이 증가한다. |
| `semester` | `{start, end, candidate, effectiveDate?}`. `candidate.sections`가 현재 기본 주간 시간표다. `effectiveDate`는 마지막 시간표 교체의 적용일이다. |
| `events`, `experiences`, `history` | 날짜별 일정, 기존 수강 기록, 캘린더 변경 작업이다. LMS 캐시는 별도 브라우저 저장소에서 관리한다. |
| `courseId`, `sectionId`, `seriesId`, `id` | 과목, 분반, 분반 내 반복 시간 블록, 개별 일정의 식별자다. 같은 분반의 월·수 수업과 같은 날의 두 시간 블록도 각각 다른 `seriesId`를 갖는다. 날짜를 옮겨도 `id`는 유지된다. |
| `original` | 반복 수업을 생성할 때의 날짜·시간·이름·장소·종류. 제공된 `building`, `room`만 담는다. 현재 표시 장소는 `location`이다. |
| `status`, `exception`, `retired` | 저장된 진행·취소 상태, 이번 일정만 수정한 예외, 시간표 교체로 종료된 반복 수업을 나타낸다. |
| `examMode`, `originalEventId` | 시험은 `replacement` 또는 `additional`이다. 대체 시험은 원래 수업을 반드시 연결한다. 별도 시험과 보강은 원래 수업을 연결할 수 있다. 개인 일정에는 과목 연결이 없다. |

날짜는 `YYYY-MM-DD`, 시간은 한국 시간(`Asia/Seoul`) 자정부터의 정수 분이다. 예를 들어 09:30은 `570`이다. 날짜 계산은 UTC 달력 연산으로 시스템 시간대의 영향을 피한다. 학기 시작일과 종료일을 모두 포함하고 최대 31주를 허용한다. 후보의 `meetings`는 `[요일, 시작 분, 종료 분]`이며 월요일이 `0`, 일요일이 `6`이다. 휴일·휴강은 사용자가 확인 후 등록한다.

## 표시와 편집 연결

`public/calendar-display.mjs`의 `toCalendarEvents`는 `calendarEvents`로 계산한 표시 상태와 LMS 일정을 FullCalendar 입력으로 변환한다. 내부 일정 ID를 FullCalendar ID로 사용한다. 대체 시험으로 가려진 원래 수업은 화면 이벤트에서 제외하고, 별도 휴강은 휴강 표시로 남긴다. 월간 필터는 변환 결과에서 활성 정규 수업만 숨긴다. 과목 색은 학기의 일정 순서로 배정하므로 보기나 필터를 바꾸어도 동일하다.

`public/calendar-view.js`는 FullCalendar Standard의 `timeGridWeek`, `dayGridMonth`, `listDay`를 사용한다. `timeZone: 'Asia/Seoul'`을 설정하고 수업 시간은 `+09:00`이 붙은 ISO 시각으로 전달한다. LMS 시간 일정은 원래 ISO 시각, 종일 일정은 날짜와 배타적 종료일을 전달한다. 마감은 종료 시각이 없는 시점으로 유지하고, 주간에 그릴 때만 최소 높이의 마커로 표시한다. [시간대](https://fullcalendar.io/docs/timeZone) · [이벤트 종료일 규칙](https://fullcalendar.io/docs/event-parsing)

`app.js`는 편집을 열 때 고정한 원본과 입력 초안을 별도로 관리한다. 저장 직전에 폼 값을 다시 읽어 원본과 비교한 필드만 `edit`로 전달한다. 수업에서 시험으로 바뀌면 `add`와 `examMode: 'replacement'`를 사용한다. 편집 팝업은 캘린더가 다시 렌더링되는 영역 밖에 있고, 충돌 확인을 닫으면 같은 초안으로 돌아온다. `store.apply`가 성공한 뒤에만 변경된 일정을 다시 표시한다. 보기·날짜·월간 필터는 브라우저 화면 상태이며 저장 스키마와 `revision`을 변경하지 않는다.

로컬 번들은 `package.json`에서 FullCalendar `7.1.4`로 고정한다. `prepare-dependencies.mjs`가 Windows 실행 파일과 `npm start`에서 의존성을 준비한다. `server.mjs`는 허용 목록에 있는 번들·테마·로캘 파일을 `/vendor/fullcalendar/`에서 제공한다. [공식 라이선스](https://fullcalendar.io/license) · [배포본 MIT 고지](licenses/fullcalendar.txt)

## 호출 순서

`public/calendar-logic.mjs`는 DOM, 브라우저 저장소, 추천 엔진 없이 사용할 수 있다. 초기 상태는 `emptyPlanner()`로 만든다. 저장된 JSON은 `loadCalendar(value)`로 검증·마이그레이션한다. `calendarEvents(state.events)`는 화면, 충돌 표시 및 ICS에 사용할 표시 상태를 반환한다. 원래 수업을 대체 시험이 가리는 동안 해당 수업의 표시 상태는 `cancelled`이고 `replacedBy`가 시험 ID를 가리킨다. 저장 상태는 수업 자체의 휴강 여부를 기록한다.

```js
const preview = previewCalendar(state, command, {externalEvents: lmsEvents});
if (!preview.ok) showErrors(preview.errors);
else if (preview.requiresReview) showReviewChoices(preview.review);
else showConfirmation(preview);

// 검토가 필요하면 command에 decisions를 넣어 다시 미리보기한다.
// 확인 화면에서 사용자가 실제 겹침을 승인한 경우 acceptConflicts를 true로 전달한다.
const next = applyCalendar(state, confirmedPreview, {
  externalEvents: lmsEvents, acceptConflicts: userAcceptedConflicts
});
```

`previewCalendar`는 원본을 변경하지 않는다. 성공 결과의 `changes`는 `{id, type, before, after}` 목록이다. `type`은 `add`, `update`, `cancel`, 또는 되돌리기로 추가 일정이 제거되는 경우 `remove`다. 없는 쪽 값은 `null`이다. `semester`는 학기 변경 전후 값을 담는다. `preserved`는 유지된 예외 등의 `{reason, event}` 목록이다. `review`는 `{id, reason, event, options, decision}` 목록이며 선택이 남으면 `requiresReview`가 `true`다.

`conflicts`는 변경 후 영향을 받은 일정에 대해 `{date, start, end, events: [{id, title}, {id, title}]}`을 반환한다. `start`와 `end`는 실제 교집합이다. 취소 일정, 종료와 시작이 맞닿는 일정, LMS 종일 일정과 마감 시점은 충돌에서 제외한다. 자정을 넘는 LMS 시간 일정은 날짜별로 나눠 비교한다. 입력 오류는 `ok: false`와 `errors: [{code, message}]`로 반환한다. 적용 시 `REVIEW_REQUIRED`, `CONFLICT_CONFIRMATION_REQUIRED`, `STALE_PREVIEW` 등을 구분할 수 있다. 버전과 미리보기 결과를 다시 검사하므로 LMS가 확인 도중 바뀌어 겹침 결과가 달라져도 재확인이 필요하다.

### 명령 예시

아래 `candidate`는 추천 응답에서 사용자가 선택한 후보, `id`는 날짜별 수업 ID다.

```js
// 첫 학기 생성. 현재 후보와 기간이 동일한 재요청은 상태를 그대로 반환한다.
{type: 'initialize', candidate, start: '2026-10-19', end: '2026-11-08'}

// 장소만 변경. scope 기본값은 one, action 기본값은 edit.
{type: 'edit', id, patch: {location: '정보관'}}
{type: 'edit', id, scope: 'future', patch: {start: 600, end: 690}}
{type: 'edit', id, action: 'cancel'}
{type: 'edit', id, action: 'resume'}
{type: 'edit', id, action: 'restore'}

// 공통 입력. event.kind를 exam, makeup, personal 중에서 선택한다.
const fields = {title: '중간시험', date: '2026-10-26', start: 540, end: 630, location: ''};
{type: 'add', event: {...fields, kind: 'exam'}, examMode: 'replacement', originalEventId: id}
{type: 'add', event: {...fields, kind: 'exam'}, examMode: 'additional', courseId: 'db'}
{type: 'add', event: {...fields, title: '보강', kind: 'makeup'}, originalEventId: cancelledLessonId}
{type: 'add', event: {...fields, title: '개인 약속', kind: 'personal'}}

{type: 'replace', candidate: nextCandidate, effectiveDate: '2026-10-26'}
{type: 'replace', candidate: nextCandidate, effectiveDate: '2026-10-26',
  decisions: {[reviewEventId]: 'keep'}} // 반환된 모든 검토 항목에 선택을 지정
{type: 'undo', operationId: state.history.at(-1).id}
```

`edit`에서 변경하는 필드는 `title`, `date`, `start`, `end`, `location`이다. 종류는 추가 시 확정한다. `scope: 'future'`는 선택 일정의 최초 발생일 이후 같은 `seriesId`에만 적용한다. `date`를 요청하면 선택 수업의 최초 발생일과 요청 날짜의 차이를 각 수업의 최초 발생일에 적용한다. 개별 수정·휴강과 대체 시험 연결은 유지하며 미리보기에서 확인할 수 있다. 적용 대상 하나라도 날짜나 시간 검증에 실패하면 작업 전체를 거절한다.

`resume`은 취소를 해제하고 이미 수정된 날짜·장소 등을 유지한다. `restore`는 반복 수업의 날짜·시간·장소 등을 `original`로 복원하고 해당 개별 예외를 해제한다. 시간표 교체로 종료된 수업은 기본 정보를 복원해도 취소 상태를 유지한다. 대체 시험을 취소하면 독립적으로 휴강 처리되지 않은 원래 수업이 다시 표시된다. 시험을 재개하면 원래 수업이 다시 가려진다. 한 수업에 활성 대체 시험은 하나까지다. 보강을 취소하거나 재개해도 연결된 휴강 수업의 상태는 유지된다.

## 시간표 교체 및 되돌리기

- 데모는 브라우저에 한 학기를 저장한다. `replace`는 그 학기 안에서 적용일을 선택하며 마지막 적용일과 같거나 이후여야 한다. 교체 계획은 적용일 전의 표시 상태와 모든 개인 일정을 보존한다.
- 변경되지 않은 분반의 시간 블록은 일정 ID와 예외를 유지한다. 새 블록은 적용일 이후에 생성한다. 빠진 블록의 이후 정규 수업은 종료·취소 상태로 남긴다. 이미 표시 날짜가 적용일 이전인 수업은 최초 발생일이 이후라도 보존한다.
- 적용일 이후의 영향받는 시험·보강·개별 예외는 검토 항목으로 돌려준다. `keep`은 기존 분반·수업 링크와 상태를 보존하고 `cancel`은 기존 링크를 보존한 채 취소한다. 대체 시험을 취소하면 적용일 전 수업이 다시 표시되는 경우에는 `keep`만 제공한다. 새 분반에는 기존 예외를 자동 이전하지 않는다.
- `history` 항목에는 작업 ID·버전·적용 범위·시각(UTC ISO)·영향받은 ID·저장 값의 전후 차이와 표시 상태 차이를 담는다. 일괄 변경 하나는 한 항목이다. `undo`는 직전 작업 ID와 현재 값을 확인해 역으로 적용하며, 복원에 따른 겹침도 미리보기에서 계산한다. 되돌리기 역시 기록되며 직전 되돌리기를 다시 되돌리면 이전 변경을 재적용한다. 수강 기록 저장은 캘린더의 되돌리기 대상에서 제외한다.

## 마이그레이션과 연결

- `public/planner.js`는 `{getItem(key), setItem(key, value)}`를 받는다. 브라우저 키 `ssu-timetable-planner-v1`을 유지하고 v1을 읽을 때 메모리에서 v2로 변환한다. 첫 성공 쓰기에서 v2를 기록한다. 기존 시간표·일정 ID·휴강·개인 일정·수강 기록을 유지한다.
- v1에서 한 수업의 종류를 시험으로 바꾼 경우, 기존 ID는 시험에 두고 `:class`가 붙은 별도 원래 수업을 연결한다. v1에서 이미 취소된 대체 시험의 원래 수업도 취소 상태로 시작한다. v1의 별도 시험·보강에 연결 정보가 없으면 해당 일정은 유지하고 연결을 추정하지 않는다. v1 이전 변경의 작업 기록은 빈 배열로 시작한다.
- `store.preview(command, options)`와 `store.apply(preview, options)`를 기존 저장 화면에서 사용한다. `store.data`는 읽기 전용이다. 브라우저 쓰기 성공 후 메모리를 갱신하고, 앞서 저장된 다른 탭의 데이터가 감지되면 새로고침을 요구한다. `localStorage`에는 원자적 비교·쓰기 연산이 없어 동시 실행을 완전히 직렬화할 수 없다.
- 현재 화면에서 기존 수업을 편집할 때 종류를 대체 시험으로 선택할 수 있다. 일정 추가 화면은 별도 시험의 과목과 보강의 휴강 수업을 선택할 수 있다. 시간표 저장 화면은 적용일·검토·충돌 확인을 연결했다. 작업 기록 목록과 되돌리기 버튼은 프론트에서 `history` 및 `undo` 명령에 연결할 수 있다.
- 향후 백엔드에서는 `loadCalendar`로 읽고, `applyCalendar`의 계산 결과를 `revision` 조건부 갱신으로 한 트랜잭션에서 저장한다. 일정과 기록을 함께 갱신하고, 버전이 달라진 경우 다시 읽어 미리보기를 생성한다.

## 실행

```powershell
cd timetable-demo
node prepare-dependencies.mjs
node examples/calendar-workflow.mjs
node --test tests/calendar-logic.test.mjs tests/calendar-display.test.mjs
npm test
npm run test:ui
```

예제는 시간표 확정, 휴강, 보강과 개인 일정 충돌 확인, 보강 등록 되돌리기, 분반 교체 후 개인 일정·휴강·시험 보존을 검증한다. `npm test`에는 기존 추천 테스트가 포함되므로 최초 실행 전 `npm run setup:solver`가 필요하다. UI 검증은 `lms-parser`의 고정 npm 의존성과 Chrome을 사용한다.

`tests/calendar-browser.mjs`는 실제 `select` 입력과 저장으로 대체 시험을 검증한다. 로스앤젤레스 시간대로 설정한 Chrome에서 한국 시간, 종일 종료일, 자정을 넘는 LMS 일정을 확인한다. 실제 학교 로그인과 Codex 실계정 호출은 검증 범위에서 제외한다. 스크린샷은 `.ui-qa/` 또는 `TIMETABLE_SCREENSHOT_DIR`에 생성한다.
