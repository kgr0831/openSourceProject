# LMS 모아 · 숭실대 학습 자료 보관함

본인 계정에서 볼 수 있는 과목, 공지, 과제·퀴즈 설명과 마감, 페이지, 주차 자료, 직접 다운로드 가능한 영상·자막을 로컬에 수집합니다. 독립 UI·CLI와 다른 프로젝트가 사용하는 공통 파서 모듈을 제공합니다. `timetable-demo`는 공통 모듈로 실제 LMS 일정을 학기 캘린더에 반영하며, 가상 추천 과목 데이터는 그대로 구분합니다.

## 프로젝트에서 재사용하기

`index.mjs`가 공통 진입점입니다. 가져오기만 해서는 UI·서버·로그인 창이 실행되지 않습니다.

| 구성 | 역할 |
| --- | --- |
| `connection.mjs` · `LmsConnection` | 로그인 창, 암호화 복원, 백그라운드 전환, 수강 목록, 계정 확인, 연결 해제 |
| `collect.mjs` · `collectLms` | Canvas → LearningX → Commons 수집. `includeMaterials: false`이면 일정에 필요한 API만 조회 |
| `calendar.mjs` · `calendarEvents` | 계정별 안정 ID, 개인 마감, 종일 일정, Canvas/LearningX 중복 제거 |
| `app-service.mjs` · `server.mjs` · `cli.mjs` | 독립 자료 보관 프로그램의 작업·다운로드·내보내기·화면 |
| `../timetable-demo/lms-service.mjs` | 공통 모듈을 본 프로젝트의 일정 수집 API에 연결 |

두 프로그램은 별도로 실행하며 작업과 로그인 보관함을 공유하지 않습니다. 기존 `LMS 모아 시작.vbs`·`.bat`, 다운로드 위치와 CLI 사용법은 유지합니다. 본 프로젝트에서는 자료·동영상을 자동 다운로드하지 않습니다.

## 화면으로 사용하기 (Windows)

1. 저장소 폴더의 **`LMS 모아 시작.vbs`**를 더블클릭하세요. VBS 실행이 막혀 있으면 **`LMS 모아 시작.bat`**를 사용하세요.
2. 화면에서 **숭실대 LMS 연결하기**를 누르세요. 새로 열리는 학교 창에서 로그인하고 강의실에 들어가면 수강 과목이 자동으로 나타납니다. 자동 확인이 늦으면 **로그인 완료했어요**를 누르세요.
3. 연결이 확인되면 학교 창은 자동으로 닫힙니다. 과목에 체크하고 **공지와 일정 / 강의자료까지 / 동영상까지** 중 원하는 범위를 고른 뒤 **저장하기**를 누르세요.
4. 완료 화면에서 **저장 폴더 열기**, **내 캘린더에 일정 넣기**, **AI 요약용 자료 받기**를 사용하세요.

명령어를 입력할 필요가 없습니다. Node.js **20.18.1 이상**과 Chrome 또는 Edge가 필요하며, 실행 파일이 설치 여부를 확인하고 누락 시 안내합니다. npm 구성 요소는 첫 실행 때 자동으로 준비합니다. Node.js 자체를 설치하거나 컴퓨터 설정을 변경하지는 않습니다.

화면에서 저장한 자료는 **내 다운로드 폴더 → LMS 모아**에 사용자·실행별로 보관됩니다. 저장 중 **중단**을 누를 수 있고, 이미 완성된 파일은 남습니다. 일부 자료를 못 가져온 경우 해당 과목과 안내를 완료 화면에 표시합니다.

**앱 창을 모두 닫아도 백그라운드에서 저장이 계속됩니다.** `LMS 모아 시작`을 다시 열면 같은 작업의 진행 상황과 결과가 나타납니다. 완전히 끝내려면 화면의 **앱 종료**를 누르세요. 앱 종료·PC 종료는 진행 중인 작업을 중단하며, 절전 중에는 작업이 진행되지 않습니다. Windows 시작 프로그램이나 예약 수집을 설치하지 않습니다. 앱은 이 PC의 `127.0.0.1:4318`에서만 실행되며 외부에 배포하지 않습니다.

**다음 실행에는 저장된 로그인으로 자동 연결합니다.** 로그인 창의 세션을 Windows 계정으로 암호화해 `%LOCALAPPDATA%\SSU LMS Moa\login.dpapi`에 보관합니다. 비밀번호를 입력받거나 기존 Chrome/Edge 프로필을 읽지 않으며, 평문 인증 파일을 만들지 않습니다. 앱 종료 후에도 로그인은 남고, 화면의 **로그아웃**을 누르면 이 앱의 저장된 로그인만 지웁니다. 로그인 보관을 지원하는 환경은 Windows이며, 보관 실패는 화면에 안내합니다.

학교가 발급한 쿠키의 만료 시각을 변경하지 않습니다. 갱신 쿠키를 반영하고, Canvas 세션 만료 시 기존 학교 통합 로그인으로 재연결을 시도합니다. 학교 통합 로그인까지 만료되거나 재인증이 요구되면 다시 로그인해야 합니다. 인터넷 장애 시에는 저장된 로그인을 지우지 않습니다.

화면의 AI 버튼은 **요약용 원문 텍스트**와 요청 문구를 준비합니다. 실제 AI 요약이나 캘린더 자동 동기화는 실행하지 않습니다. 받은 캘린더 파일은 사용 중인 캘린더의 가져오기 기능을 이용하세요.

## 명령어로 실행 (개발자용)

Node.js **20.18.1 이상**과 Google Chrome이 필요합니다. 저장소 루트에서:

```powershell
cd lms-parser
npm ci
npm start -- collect --download all
```

새로 열린 Chrome에서 `lms.ssu.ac.kr`에 직접 통합 로그인한 뒤 강의실까지 들어갑니다. 터미널로 돌아와 Enter를 누르면 학교 창을 닫고 백그라운드 브라우저로 수집합니다. 기존 브라우저 프로필을 읽거나 비밀번호를 입력받지 않습니다. **CLI는 임시 세션을 사용하므로 매번 로그인합니다.** Windows 화면 앱의 로그인 보관과는 별개입니다.

Chrome 대신 Edge를 사용하려면 `--browser msedge`를 붙입니다. 둘 다 없는 환경에서는 `npx playwright install chromium` 후 `--browser chromium`을 사용할 수 있습니다.

```powershell
# 공개 주소 연결 확인: 로그인·다운로드 없음
npm start -- probe

# 공지·본문·자료 목록·일정만 수집
npm start -- collect

# 특정 과목의 문서와 자막 다운로드 (영상 제외)
npm start -- collect --course 12345 --download files

# 여러 과목의 문서·직접 영상·자막 다운로드
npm start -- collect --course 12345,67890 --download all

# Canvas 학기 ID, 파일 하나당 최대 용량, 출력 상위 폴더 지정
npm start -- collect --term 10 --download all --max-file-mb 4096 --out ../lms-output
```

위 숫자는 예시입니다. 과목 ID는 강의실 주소의 `/courses/12345`에서 확인합니다. 학기 ID는 첫 수집 결과의 `courses[].term.id`에 있습니다. 기본값은 Canvas의 **활성 수강 목록 전체**이며 현재 학기를 추측하지 않습니다. 이전 학기 과목도 활성 상태일 수 있으므로 범위를 줄이려면 `--course` 또는 `--term`을 사용하세요.

학교에서 발급 가능한 개인 Canvas API 토큰을 이미 사용하는 경우 `SSU_LMS_TOKEN` 환경 변수를 설정하고 `--auth token`으로 실행할 수 있습니다. 토큰을 명령 인자나 저장소 파일에 넣지 마세요. 이 모드는 Canvas API 전용으로, LearningX의 별도 로그인 인증 및 브라우저 대체 수집이 필요한 과목은 경고를 남깁니다. 기본 브라우저 방식이 숭실대 전체 자료 수집에 적합합니다.

## 결과

화면에서 실행하면 내 다운로드 폴더의 `LMS 모아/`, CLI로 실행하면 저장소의 `lms-output/`에 저장됩니다. 그 아래 `<계정 구분 해시>/<수집 시각-임의값>/`으로 사용자와 실행마다 새 폴더를 만들며 이전 결과를 덮어쓰지 않습니다. CLI 기본 출력 폴더는 Git에서 제외했습니다. 다른 `--out` 경로는 직접 관리해야 합니다.

| 파일 | 용도 |
| --- | --- |
| `snapshot.json` | 과목, 항목, 일정, 첨부 메타데이터, 다운로드 상태, 실패 내역 |
| `calendar.ics` | 캘린더 앱으로 가져올 개인별 마감·일정 |
| `study.md` | 수집된 공지·페이지·과제 설명 등 읽기용 원문 |
| `summary-input.jsonl` | 출처와 항목 ID를 보존한 AI 요약 입력, 최대 10,000자 단위 |
| `summary.txt` | 같은 요약 입력을 읽기 쉬운 일반 텍스트로 저장. 화면의 AI 자료 받기 버튼에서 사용 |
| `summary-prompt.txt` | 근거 표시와 미분석 자료 구분을 포함한 요약 요청 예시 |
| `downloads/` | 요청한 범위의 원본 파일, 영상, 자막 |

`summary.txt` 또는 `summary-input.jsonl`과 `summary-prompt.txt`를 사용하는 AI에 전달하면 됩니다. 화면에서 받는 파일에는 ‘AI 요약용 원문.txt’, ‘요약 요청 문구.txt’라는 이름을 붙입니다. HTML 본문과 다운로드한 2 MiB 이하 UTF-8 TXT/MD/CSV, VTT/SRT 자막에서 텍스트를 만듭니다. PDF/PPT/HWP는 원본 다운로드까지 지원하며, 해당 파일을 읽을 수 있는 AI 또는 별도 텍스트 추출기에 함께 전달해야 합니다. 자막 없는 영상은 별도 음성 전사가 필요합니다. **이 파서는 AI 서비스에 업로드하거나 실제 요약·음성 전사를 실행하지 않습니다.**

ICS는 학생에게 적용되는 Canvas `due_at`을 사용합니다. UTC 시각, 종일 일정, 한글 줄 접기를 지원하며 동일 계정·항목의 UID는 재실행해도 같습니다. Google/Apple/Outlook 등에서 파일을 가져올 수 있으나 외부 캘린더 자동 동기화와 기존 시간표 데모 화면에 대한 자동 반영은 구현하지 않았습니다. 캘린더 앱에 따라 반복 가져오기가 중복 일정이 될 수 있습니다. 삭제된 과제의 기존 캘린더 일정 제거도 별도 동기화 작업입니다.

## 수집 경로와 범위

1. **Canvas REST API**: `canvas.ssu.ac.kr/api/v1`에서 현재 사용자, 수강 목록, 과제, 퀴즈 설명, 공지, 페이지, 모듈·파일, 캘린더를 읽습니다. `Link` 헤더의 다음 페이지를 모두 따라갑니다. 퀴즈 문제·제출물·다른 학생 정보는 수집하지 않습니다.
2. **LearningX API**: `/learningx/api/v1/courses/{id}/modules?include_detail=true`에서 주차별 `module_items`와 `content_data.item_content_data`를 읽습니다. 브라우저 인증에서는 현재 세션의 LearningX 인증을 메모리에서 사용합니다.
3. **Commons 자료**: 수강 목록에 나온 `content_id`만 사용해 `commons.ssu.ac.kr/viewer/ssplayer/uniplayer_support/content.php`에서 원본 다운로드·미디어·자막 주소를 찾습니다. `sharedocs`의 문서 뷰어 디렉터리와 구형 `flash_fallback` 스트리밍 주소는 파일로 세지 않고, 문서 원본과 현행 HTML5 영상 주소를 사용합니다. 모바일·데스크톱에 반복되는 같은 영상 주소도 한 번만 저장합니다. 일반 파일·ZIP은 LearningX가 제공한 Commons 뷰어 HTML에서 해당 콘텐츠의 다운로드 링크를 읽습니다. 뷰어 스크립트는 실행하지 않습니다. MP4/WebM 등 직접 파일을 스트리밍 저장합니다.
4. **브라우저 대체 수집**: API 과목 목록이나 주차 목록이 실패하면 같은 로그인 세션에서 렌더링한 과목/모듈 목록의 링크·표시된 날짜를 읽습니다. API가 막힌 상태에서 얻지 못한 상세 본문까지 복구한다고 가정하지 않습니다. 실패 단계는 `warnings`에 남습니다.

각 실행의 수집 API·다운로드는 GET만 사용합니다. 브라우저 대체 수집 중에는 GET/HEAD 이외 요청과 미디어 재생 요청을 차단합니다. 로그인·통합 로그인 갱신은 정상적인 학교 인증 요청을 허용하며, 목록 수집이 끝나면 빈 페이지로 이동합니다. 개별 강의 플레이어나 출석·시청 완료 API를 실행하지 않습니다. 학교에서 자료 접근·다운로드 로그를 남길 수는 있습니다.

HTTP 429/502/503/504는 최대 3회 시도합니다. Canvas API의 인증 만료·로그인 리디렉션은 통합 로그인 복원 후 같은 GET을 한 번만 재시도하며, 계정이 바뀌면 중단합니다. 권한 부족(403)이나 LearningX 인증 오류를 무한 재시도하지 않습니다. 다운로드는 메모리에 전체 영상을 올리지 않고 임시 파일로 스트리밍한 뒤 성공 시에만 완성 파일을 만들고 SHA-256과 바이트 수를 기록합니다. 다른 사용자의 과목 ID, 복원할 수 없는 Canvas 인증, 잘못된 목록 형식은 빈 성공으로 처리하지 않습니다.

## 실패 내역 확인

- 종료 코드 `0`: 완료. `2`: 일부 요청 실패를 포함한 결과 저장. `1`: 실행 실패. `130`: 사용자 중단.
- `snapshot.json.warnings`: 실패 단계, 과목 ID, 오류 코드. `resources[].status`: `available`, `downloaded`, `locked`, `stream_only`, `failed`.
- `files / FORBIDDEN`: 교수자가 파일 탭을 비활성화했을 수 있습니다. Canvas는 이 경우에도 HTTP 401을 반환할 수 있으므로, 같은 클라이언트의 사용자 확인 API로 로그인이 유효한지 검증합니다. 유효하면 해당 자료의 권한 경고로 남기고 접근 가능한 개별 파일과 LearningX/Commons 자료 수집을 계속합니다. 사용자 확인까지 실패한 실제 세션 만료는 수집을 중단합니다.
- `learningx / AUTH_REQUIRED`: LearningX 인증이 없거나 만료되었습니다. 브라우저 인증으로 강의실에 들어간 후 재실행하세요.
- `HOST_NOT_ALLOWED`: 지원 목록에 없는 자료 서버입니다. 기본 허용 호스트는 Canvas, LMS, Commons와 숭실대 Commons 메타데이터에서 확인한 `ssuin-object.commonscdn.com`, `ssu-toast.commonscdn.com`입니다. 그 밖의 정상 호스트는 확인 후 CLI의 `--allow-host media.example.edu`처럼 정확한 호스트를 추가하세요. HTTPS만 사용하고 Bearer 인증은 대응하는 Canvas/LearningX API에만 보냅니다.
- `NO_MEDIA`: Commons 버전·권한 때문에 직접 파일 주소를 확인하지 못했습니다. 해당 항목의 `sourceUrl`에서 직접 확인하세요.
- HLS(`m3u8`)/DASH(`mpd`)는 `stream_only`로 목록에 남깁니다. 스트림 병합, DRM 처리, 화면 녹화는 구현하지 않았습니다. 직접 MP4 주소가 함께 있으면 MP4는 다운로드할 수 있습니다.
- 서명이 붙은 다운로드 URL은 실행 중 메모리에만 있고 저장 결과에서는 쿼리를 제거합니다. **기존 `snapshot.json`만으로 다운로드를 재개하는 기능은 없습니다.** 다시 수집해 새 주소를 받아야 합니다.

## 프로젝트에서 재사용

`collectLms()`는 `{snapshot, assets}`를 반환합니다. `snapshot`은 직렬화할 수 있고, `assets`는 다운로드 시에만 쓰는 임시 URL Map입니다. 서버나 DB에 `assets` 또는 인증 정보를 저장하지 마세요. 사용자마다 별도 클라이언트·브라우저 세션을 만들고 종료 시 닫아야 합니다.

```js
import {HttpClient} from './lms-parser/http.mjs';
import {collectLms} from './lms-parser/collect.mjs';
import {calendarEvents, exportIcs} from './lms-parser/export.mjs';

const client = new HttpClient({token: process.env.SSU_LMS_TOKEN});
const {snapshot} = await collectLms({client, courseIds: ['12345']});
const events = calendarEvents(snapshot); // 사용자별 일정 저장/동기화의 입력
const ics = exportIcs(snapshot);
```

`snapshot.version`은 `1`입니다. 과목별 `items`는 공통 `id`, `kind`, `title`, `text`, `sourceUrl`, `resources`를 가지며 해당하는 항목에만 `dueAt`, `startAt`, `locked`, `contentId` 등이 있습니다. 일정의 ID에는 계정 구분값을 포함하고, 모든 절대 시각은 ISO 8601 UTC로 정규화합니다. 시간대 없는 마감은 추측하지 않고 경고 후 일정에서 제외합니다.

## 검증 및 확인한 근거

```powershell
npm test
npm run test:ui
npm start -- probe
```

개발 중 화면만 실행하려면 `npm run ui`를 사용합니다. 브라우저 테스트에는 Chrome이 필요하며 실제 학교 계정 대신 합성 응답을 사용합니다. 로그인 대기·자동 연결, 과목 검색·학기 필터·선택 유지, 저장·부분 성공, 캘린더 다운로드, 작은 화면, 중단과 재연결, 로컬 서버의 접근 제한을 검증합니다. Windows 실행 파일은 기존 `timetable-demo/windows-job.cs`를 재사용하므로 저장소 전체를 함께 보관하세요. `powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File start-ui.ps1 -VerifyStart`로 창을 열지 않고 시작·종료를 검사할 수 있습니다.

화면 관련 코드는 `server.mjs`(로컬 서버), `app-service.mjs`(연결·작업 상태), `public/`(화면), `start-ui.ps1`(Windows 실행)에 있습니다. `browser.mjs`가 로그인 창과 백그라운드 컨텍스트 전환·복원을, `session-store.mjs`가 Windows DPAPI 암호화 보관을, `session-cookies.mjs`가 API 응답 쿠키 갱신을 담당합니다. 작업 상태는 실행 중 메모리에만 있고, 앱을 완전히 종료한 뒤 실행하면 로그인을 복원하고 과목 목록을 새로 읽습니다. 저장한 파일은 그대로 남지만 중단된 다운로드를 이어받지는 않습니다.

추가 검증은 합성 로그인 세션만 사용합니다. Windows 암호화 저장·재시작 복원·지우기, 세션 쿠키 갱신, 실제 Chrome의 로그인 후 숨김 전환과 SSO POST 재인증, 다른 계정으로 바뀐 세션 거부, 앱 화면을 닫은 동안 작업 완료 및 다시 열기, 로그인 복원 취소를 확인합니다. 시작 검사(`-VerifyStart`)는 저장된 학교 로그인에 접근하지 않습니다.

문서 뷰어 경로를 영상으로 잘못 집계하거나 구형 재생 주소를 중복 다운로드하지 않는지, 일반 파일 뷰어의 다운로드 링크에서 다른 콘텐츠·외부 호스트를 제외하는지, 영상 CDN에 API 토큰을 보내지 않는지도 합성 응답으로 검증합니다. ZIP은 원본 파일로 저장하며 자동 압축 해제나 실행은 하지 않습니다.

테스트에는 실제 계정·강의·세션 자료를 넣지 않았습니다. 합성 응답으로 Canvas 페이지네이션/XSSI, 학생별 마감, 파일 탭 403, LearningX/Commons 해석, 브라우저 목록 대체 수집, 다운로드 중단·크기 제한, 인증 범위, ICS와 요약 입력을 검증합니다. 실제 로그인한 수강 과목과 영상 전체 경로는 사용자 계정으로 확인해야 합니다. 학교의 비공개 API 변경에 따라 어댑터 수정이 필요할 수 있습니다.

2026-11-09 공개 접근 확인: LMS 포털 HTTP 200, Canvas 과목 API 미인증 HTTP 401, Commons 초기 HTTP 302. 로그인 이후 화면을 검증한 결과는 아닙니다.

- [숭실대 LMS의 LearningX 자료 검색](https://lms.ssu.ac.kr/oer/search?search_term=learningx)
- [Canvas 과목 API](https://developerdocs.instructure.com/services/canvas/resources/courses), [과제와 학생별 due_at](https://developerdocs.instructure.com/services/canvas/resources/assignments), [페이지네이션](https://developerdocs.instructure.com/services/canvas/basics/file.pagination)
- [숭실대 LearningX/Commons 경로 관찰 기록](https://github.com/ghdtjdwn/ssuMCP/blob/main/docs/adr/0033-lms-material-zip-export.md): 비공식 운영 관찰로 참고했으며 학교가 보장한 API 명세는 아닙니다.
- [LearningX 인증 및 목록 경로 관찰 기록](https://github.com/cwon-z/skku-icampus-mcp/blob/main/docs/icampus-notes.md): 다른 학교의 같은 플랫폼 사례이며 숭실대에서 동일하게 동작하는지는 실계정 검증이 필요합니다.
- [Playwright 브라우저 컨텍스트와 인증](https://playwright.dev/docs/auth)
- [Windows DPAPI의 현재 사용자 암호화](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata)
