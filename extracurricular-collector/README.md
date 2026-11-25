# SSU-PATH 비교과 수집기

학교 로그인 없이 공개된 **비교과 모집공고 목록·상세 설명**을 수집한다. 앱·LMS·DB와 독립적으로 실행되며 Python 표준 라이브러리만 사용한다. 현재 범위는 SSU-PATH다. 홍보센터·진로취업센터 통합, 추천 UI, 자동 신청은 포함하지 않는다.

## 실행

Linux/macOS 또는 WSL의 Python **3.11 이상**, 학교 사이트로 나가는 HTTPS 연결이 필요하다. 별도 패키지 설치·AWS 키·학교 계정은 필요하지 않다.

```bash
cd extracurricular-collector
python3 -m ssu_collector --output ./output
```

실행할 때마다 **전체 목록 페이지**를 확인한다. 프로그램 식별자 기준으로 신규·변경 정보를 반영하고, 모집 중·예정 또는 최근 활동 종료 프로그램의 상세를 재수집한다. 오래전에 종료된 프로그램은 목록 정보만 저장하며 기존 상세가 있으면 보존한다. 기본적으로 요청 사이 최소 0.6초 대기, 요청당 30초 제한, 일시적 오류 최대 3회 시도를 적용한다.

```bash
# 작은 실사이트 확인: 전체 수집이 아니므로 정상 응답이어도 종료 코드 2
python3 -m ssu_collector --max-pages 2 --detail-limit 3 --output /tmp/ssu-path-sample

# 대기 시간·종료 후 상세 재확인 기간 변경
python3 -m ssu_collector --delay 1 --refresh-days 14 --output ./output

# 과거 프로그램 상세까지 확보할 때만 사용. 요청량·소요시간이 크게 늘어남
python3 -m ssu_collector --include-archived-details --output ./output
```

페이지·상세 제한은 샘플용이다. 일일 운영 명령에는 붙이지 않는다. 전체 목록이 수천 건이므로 완료까지 수분 이상 걸릴 수 있다. 사용자 추천 요청마다 실행하는 대신 하루 한 번 저장 결과를 갱신한다.

## 저장 결과

| 파일 | 내용 |
|---|---|
| `programs.json` | 프로그램 목록과 실행 범위·완료 여부·수집 시각 |
| `programs.previous.json` | 직전 저장 파일 백업 |
| `last-run.json` | 가장 최근 실행의 성공·부분 성공·실패 및 건수 |

JSON 파일은 소유자 읽기·쓰기 및 그룹 읽기(`0640`)로 저장한다. 웹 서비스가 별도 사용자라면 저장 디렉터리 접근 권한과 공유 그룹을 함께 설정한다.

진행·오류는 stderr에 JSON 한 줄씩, 최종 요약은 stdout에 출력한다. 결과 파일과 로그는 Git에 올리지 않는다.

주요 프로그램 필드:

- `id`, `sourceId`: 공개 상세 조회용 식별자. **목록의 표시 순번이나 제목을 ID로 사용하지 않는다.**
- `title`, `department`, `year`, `semester`: 프로그램 기본 정보.
- `applicationPeriod`, `applicationStartDate`, `applicationEndDate`: 원문 신청기간과 날짜. 시간 정보는 추정하지 않는다.
- `activityPeriod`, `activityStartDate`, `activityEndDate`: 활동기간. 매일 참여하는 일정이라는 의미는 아니다.
- `sourceStatus`, `effectiveStatus`, `warnings`: 원문 상태와 한국 날짜 기준 보정 상태(`open/upcoming/closed/unknown/unlisted`). 원문 모순은 경고로 남긴다.
- `detail`: 프로그램 목표·소개·유형·분류·신청대상 및 원문 표. 상세 페이지가 제공한 항목만 저장한다.
- `detailState`, `lastDetailSuccessAt`, `lastDetailAttemptAt`: 설명의 수집 상태와 최신성. `stale/failed/deferred`는 최신 설명 확인이 안 된 상태다. `unavailable`은 학교가 명시적으로 조회 불가를 응답한 경우이며, 이전 설명이 남아 있으면 `unavailable_cached`로 구분한다.
- `sourceUrl`, `applicationUrl`, `listUrl`: 원문과 학교 로그인·신청 진입 주소. 신청은 학교에서 진행한다.
- `firstSeenAt`, `lastSeenAt`, `lastChangedAt`, `contentHash`: 신규·변경 추적.

이미지·첨부 링크는 발견되면 `detail.assets`에 남기지만 다운로드·OCR하지 않는다. 상세가 비어 있으면 내용을 생성하지 않는다. 개인정보·개인 신청 이력은 수집하지 않는다.

## 실패·변경 대응

- 종료 코드 **0**: 전체 목록과 대상 상세 확인 완료. 학교가 명시한 상세 조회 불가는 `detailUnavailable`로 집계하며 설명 확보를 뜻하지 않는다. **1**: 요청·파싱·저장 실패. **2**: 페이지 제한 또는 일부 상세 실패/보류로 부분 완료. **130**: 사용자 중단.
- 로그인으로 이동, 표 열 변경, 중복 ID, 전체 건수 불일치, 수집 도중 목록 변경은 오류로 처리하고 기존 `programs.json`을 덮어쓰지 않는다.
- 상세 일부만 실패하면 최신 목록과 이전 설명을 함께 저장하고 `stale`로 표시한다. 신규 항목의 실패는 `failed`로 표시한다. 부분 실행은 마지막 전체 성공 시각을 갱신하지 않는다.
- 학교가 `조회할 수 없는 프로그램입니다`라고 명시한 경우에는 통신·파싱 실패와 구분한다. 목록은 유지하고 공개 설명은 미확보로 표시하며, 신청 권한이나 로그인 필요 여부는 추정하지 않는다.
- 전체 목록에서 사라진 프로그램은 지우지 않고 `unlisted`로 표시한다. 샘플 수집은 조회하지 않은 항목을 미게재로 바꾸지 않는다.
- 결과 파일은 임시 파일 작성 후 원자적으로 교체한다. 같은 저장 경로의 동시 실행은 OS 잠금으로 차단하며, 프로세스 종료 시 잠금은 해제된다.
- SSL 검증은 끄지 않는다. macOS 인증서 환경에 따라 시스템 CA 경로 설정이 필요한 경우 `SSL_CERT_FILE=/etc/ssl/cert.pem`을 사용할 수 있다.

목록은 학교 측 트랜잭션 스냅샷이 아니다. 첫 페이지·총수·중복 검사는 변경 감지용이며, 수집 중 발생하는 모든 변경을 완전히 보장하지 않는다. 모집 상태·신청 자격은 최종적으로 학교 원문에서 확인한다.

## AWS 배포 담당자: 매일 한 번 실행

기존 EC2가 **systemd를 사용하는 Linux**라면 `deploy/` 예시를 적용할 수 있다. 기본 실행 시각은 **매일 03:00 Asia/Seoul**이며 서버가 UTC여도 한국 시간으로 해석한다. 팀 합의에 따라 timer의 `OnCalendar`를 수정한다. 서버가 꺼져 놓친 실행은 재기동 시 한 번 보완한다.

1. 저장소를 배포하고 Python 3.11 이상인지 확인한다.
2. 서비스 전용 사용자 `ssu-collector`를 준비하고, 해당 사용자가 배포 코드를 읽을 수 있게 한다.
3. `deploy/ssu-extracurricular.service`의 `WorkingDirectory`와 Python 경로를 실제 환경에 맞춘다. 예시는 코드가 `/opt/openSourceProject`에 있다고 가정한다.
4. 아래 설정을 적용하고 수동 실행 결과부터 확인한다. 기본 저장 경로 `/var/lib/ssu-extracurricular`는 systemd가 생성·권한 설정한다.

```bash
# Ubuntu 예시. 사용자 생성은 이미 존재한다면 생략
sudo useradd --system --no-create-home --shell /usr/sbin/nologin ssu-collector
sudo cp deploy/ssu-extracurricular.service deploy/ssu-extracurricular.timer /etc/systemd/system/
sudo systemctl daemon-reload
systemd-analyze calendar '*-*-* 03:00:00 Asia/Seoul'
sudo systemctl start ssu-extracurricular.service
sudo journalctl -u ssu-extracurricular.service -n 50 --no-pager
sudo cat /var/lib/ssu-extracurricular/last-run.json

# 수동 수집 완료를 확인한 뒤 예약 활성화
sudo systemctl enable --now ssu-extracurricular.timer
systemctl list-timers ssu-extracurricular.timer
```

부분 완료(종료 코드 2)도 서비스 실패로 표시하므로 로그를 확인한다. HTTP 재시도 외 무한 자동 재실행은 하지 않는다. 재실행은 `sudo systemctl start ssu-extracurricular.service`, 예약 중지는 `sudo systemctl disable --now ssu-extracurricular.timer`다. timer 파일 수정 후에는 daemon-reload 및 timer 재시작이 필요하다.

서버·DB 접속 없이 코드와 예시만 제공하며 자동 설치하지 않는다. PR 병합만으로 예약이 켜지지 않는다. 배포 담당자가 위 설정을 적용해야 한다. DB 연결은 후속 단계에서 `programs.json`을 읽어 `id` 기준 upsert하는 방식으로 붙일 수 있다.

## 추천 기능 연결 시

기존 시간표 앱에 [진로 기반 비교과 추천](../timetable-demo/README.md#진로-기반-비교과-추천)이 연결되어 있다. 앱 서비스의 `SSU_PROGRAMS_FILE`을 이 수집기의 `programs.json` 경로로 설정하면 재시작 없이 갱신된 JSON을 읽는다. 환경변수 자체를 변경할 때는 앱 서비스를 재시작한다.

기본 추천은 최근 실행이 전체 완료인지 확인한 뒤, `presentInLatestInventory=true`, `effectiveStatus=open`인 항목을 사용한다. 실행이 오래됐거나 부분 완료라면 마지막 확인 시각·누락 가능성을 표시한다. 상세가 `ok`가 아니면 최신 설명으로 단정하지 않고 과목명 추천과 동일하게 제목 중심으로 판단한다. 수집 실패 시 마지막 성공 데이터는 보존되지만, 현재 날짜로 신청 마감 여부를 다시 판정해야 한다.

현재 공개 표의 활동기간만으로 수업 시간과의 충돌을 계산하지 않는다. 신청대상의 `전체` 표기 역시 무조건 신청 가능하다는 보장은 아니다.

## 검증

```bash
python3 -m unittest discover -s tests -v
```

표 변경·로그인 응답 거부, HTML 엔티티·본문 추출, 페이지 중복·변경, 안정 ID, 일일 갱신, 상세 실패 시 기존 설명 보존, 과거 항목 처리, 원자적 저장·백업·동시 실행 차단 등을 검사한다. 실사이트 소규모 확인은 별도 출력 경로에서 수행한다.

### PR 전 검증 결과 — 2026-11-25

| 확인 항목 | 결과 |
|---|---|
| 전체 실사이트 목록 | 408페이지, 4,072건. 사이트 총수와 고유 ID 수 일치 |
| 상세 확인 대상 | 모집 중·예정 및 최근 종료 106건 중 설명 105건 확보. 나머지 1건은 학교가 조회 불가로 응답 |
| 과거 종료 프로그램 | 나머지 3,966건은 목록 정보만 보존. 모든 과거 설명을 가져온 것은 아님 |
| 재처리·백업 | 실제 수집 결과를 재생해 신규 0·변경 0·유지 4,072건과 이전 파일 백업 확인. 전체 사이트를 두 번째로 재요청한 테스트는 아님 |
| 자동 테스트 | macOS 및 일회용 Ubuntu 24.04 환경에서 19개 통과 |
| 예약 설정 | Ubuntu의 `systemd-analyze verify` 통과. 03:00 Asia/Seoul이 18:00 UTC로 해석됨을 확인 |

전체 실사이트 검사에서 두 가지를 보완했다. ① 2018년 과거 게시물의 따옴표·꺾쇠가 깨진 제목 HTML을 명시적 프로그램 ID와 원문 제목으로 복원하고 회귀 테스트에 추가했다. ② 처음에는 일반 상세 실패로 기록됐던 학교의 명시적 조회 불가 응답을 `unavailable`로 분리했다. 최종 분류는 실제 응답 재확인과 전체 수집 결과 재생으로 검증했다.

실서버에 파일을 배포하거나 timer를 활성화하지는 않았다. 실제 AWS에서의 네트워크 접근·파일 권한·예약 실행은 배포 담당자가 적용 후 확인해야 한다. 검증용 수집 파일은 임시 경로에 보관하며 Git에 포함하지 않는다.

출처: [공개 목록](https://path.ssu.ac.kr/ptfol/imng/icmpNsbjtPgm/dialog/nsbjtPgmList.do) · [systemd 예약 문법](https://www.freedesktop.org/software/systemd/man/latest/systemd.time.html) · [timer 동작](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)
