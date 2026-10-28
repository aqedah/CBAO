# AI Office v1.0 — 기능 명세와 화면 설계

설계일: 2026-10-28 · 대상: 사용자 1인이 총괄하는 통합형 AI 사무실 · 언어: 한국어

이 문서는 개발 기준안이다. 실제 계정·PC·저장소의 연결이나 배포를 수행한 보고서가 아니다. 화면의 업무 번호, 건수, 시간, 테스트 결과는 명시적으로 예시 데이터로 취급한다. 외부 기능은 아래 공식 문서를 확인했으며, 설치된 도구의 버전·인증·권한은 최초 연결 시험에서 다시 검증한다.

## 0. 제품 정의와 결정 사항

**사용자는 목적과 완료 조건을 지시하고, 연결된 실행 도구는 허용된 범위에서 작업·검증·인계를 진행하며, 사무실은 실제 근거와 사용자에게 필요한 결정을 보여준다.**

| 항목 | v1 기준 |
|---|---|
| 운영 모델 | 기존 웹 서비스 유지 + 로컬 실행 도구 연동 + 연결되지 않은 작업의 수동 인계 |
| 사용자 | 소유자 1인. 팀원은 AI 역할이며, 계정 공유나 다중 직원 조직은 후속 범위 |
| 첫 실행 환경 | Windows PC 1대. 장치 추가를 지원할 데이터 구조는 확보 |
| 기본 동시 실행 | PC당 관리형 실행 1개. 검증 후 제한을 늘림 |
| 초기 프로젝트 | MILAL, MILALWV, CBSR, CBWP를 등록 후보로 제시하되 경로·원격·권한은 확인 후 저장 |
| 사무실 표현 | 실제 업무 카드가 놓인 팀원 자리. 3D·아바타 애니메이션은 제외 |
| 업무의 기준 | 서버 DB의 지시·승인·상태, Git의 코드 버전, 해시가 있는 결과물 |
| 첫 완료 수준 | 작업 지시→실제 실행→검사→인계→사용자 승인. 자동 병합·배포는 제외 |
| 보존 원칙 | 기존 서비스, WIP, human judgment, frozen artifact를 덮어쓰지 않음 |

성공의 기준은 화면을 꾸미는 것이 아니라 **복사·전달 횟수 감소, 근거 있는 진행 상태, 재시작 후 이력 보존, 사용자 판단에만 집중할 수 있는 승인함**이다.

## 1. 범위와 비범위

### 1.1 v1 필수 범위

프로젝트와 원칙 등록, 팀원 역할 배정, 지시서 버전 관리, 실행 대기열, Codex 실행 수집, Claude Code 실행 수집, 외부 작업 인계, 검사 결과, 읽기 전용 교차 검토, 제한된 수정 반복, 승인함, 결과물·근거 보관, 재연결·중복 방지, 중지 요청, 접근 통제.

### 1.2 v1에서 하지 않는 일

일반 ChatGPT·Claude·NotebookLM 웹페이지의 모든 대화를 자동 감시하지 않는다. 로그인 쿠키를 수집하거나 비공식 내부 API를 이용하지 않는다. 기존 데스크톱 세션 전체에 자동으로 접속했다고 표시하지 않는다. 모델의 내부 사고과정을 관제 데이터로 사용하지 않는다. 임의의 진행률, 비용 0원, 테스트 통과, 배포 완료를 추정하지 않는다.

무제한 AI 토론, 자동 연구 판정, main 강제 동기화, reset/force push, 자동 병합·배포, 사용자 승인 없는 업무 범위 확대는 제외한다. 수동 작업을 자동 연결 작업처럼 표시하지 않는다.

## 2. 팀원과 실행 도구의 분리

### 2.1 도메인 구분

- **팀원(Member)**: 화면에 보이는 지속적인 역할. 예: GPT 연구·검수, Claude 구현, Codex 회귀 검사, Gemini 자료·이미지.
- **역할 배정(Role assignment)**: 프로젝트별 책임과 금지사항. 같은 팀원도 프로젝트마다 달라질 수 있음.
- **실행 연결(Connection)**: 실제 호출하거나 관찰할 수 있는 CLI/API/외부 웹 연결.
- **작업(Task)**: 사용자가 지시한 목적과 완료 조건. 수정해도 동일 업무 ID 유지.
- **단계(Step)**: 구현, 검사, 검토, 승인 등 승인된 순서.
- **실행(Run)**: 특정 단계의 한 번의 실행. 재시도는 새 run ID.

예: ‘GPT 연구원’은 ChatGPT 웹에서 수동으로 일할 수도 있고, 별도 API 연결로 자동 검토할 수도 있다. Codex 실행 결과를 기존 ChatGPT 대화의 자동 응답으로 표현하지 않는다.

### 2.2 연동 방식과 한계

| 연결 | v1 방식 | 관찰·제어 범위 | 근거 |
|---|---|---|---|
| Codex CLI | 관리형 실행, JSONL 스트림 | 사무실이 실행한 작업의 이벤트·파일 변경·종료 수집 | S01 |
| Codex App Server | 후속 어댑터 | 세션·턴·승인·스트리밍 통합. 버전별 계약 시험 필요 | S02 |
| Claude Code CLI | 관리형 실행, stream-json | 사무실이 실행한 작업의 도구 이벤트·결과 수집 | S03 |
| Claude Code hooks | 선택적 관찰 모드 | 사용자가 허용한 기존 세션의 작업 이벤트. 훅만으로 원격 시작·중지를 보장하지 않음 | S04 |
| ChatGPT / Claude 웹 | 외부 작업 | 지시 묶음 전달, 링크 기록, 사용자의 시작·완료 보고와 결과 첨부 | 제품 범위 결정 |
| Gemini 웹 / NotebookLM | 외부 작업 | 노트북 링크·산출물·작업 번호 연결. 일반 웹 세션 실시간 관찰은 v1 제외 | S05에서 확인한 Enterprise 범위와 구분 |
| Gemini API | 후속 관리형 연결 | 별도 API 요청 결과 수집. 기존 Gemini 웹/NotebookLM 대화를 감시하는 연결이 아님 | S06 |
| GitHub | 근거 연결 | commit, PR, 검사 결과. AI 작업 중이라는 직접 증거는 아님 | 제품 범위 결정 |

Codex 초기 버전은 `codex exec --json` 중심으로 구현한다. App Server를 버리는 것이 아니라, 더 깊은 상호작용은 별도 어댑터로 격리한다. 현재 공식 문서에서 App Server·WebSocket 경로의 실험적 성격을 경고하므로 이를 v1 안정성의 단일 전제로 삼지 않는다.

Claude 구독 인증은 사용자가 공식 Claude Code에서 직접 수행하고 사무실 서버는 해당 세션 토큰을 수집하지 않는다. Agent SDK 또는 제품형 API 연동은 API 키·지원 클라우드 인증을 별도로 구성한다. 인증 방식과 과금 방식은 연결 화면에 표시한다(S07, S08).

### 2.3 연결 능력 표

각 연결은 아래 능력을 실제 연결 시험 결과로 저장한다.

`start_run`, `observe_events`, `request_cancel`, `resume_session`, `steer_running_turn`, `interactive_approval`, `usage_reporting`, `enforced_workspace_isolation`.

지원되지 않는 동작은 버튼을 숨기거나 비활성화하고 이유를 표시한다. ‘설치됨’과 ‘로그인됨’과 ‘실행 시험 통과’와 ‘현재 연결됨’은 서로 다른 상태다.

## 3. 정보 구조와 화면 목록

상시 메뉴는 **사무실 / 프로젝트 / 작업함 / 승인함 / 기록·자료** 5개다. 연결·팀원·예산은 설정으로 넣는다. PC에서는 왼쪽 메뉴, 모바일에서는 현황·작업·승인·더보기로 축약한다.

| 화면 ID | 경로(해시 라우팅) | 목적 |
|---|---|---|
| S00 | `#/setup` | 최초 연결과 권한 범위 설정 |
| S10 | `#/office` | 누구의 어느 작업이 진행 중이고 무엇을 결정해야 하는지 확인 |
| S20 | `#/projects` | 프로젝트 선택·추가·보관 |
| S21 | `#/projects/:id` | 개요 / 작업 / 결과 / 원칙 |
| S30 | `#/tasks` | 전체 작업 필터·대기열·상태 조회 |
| S31 | `#/tasks/new` | 새 지시. 작은 화면에서는 전용 페이지 |
| S32 | `#/tasks/:id` | 지시·단계·실행·결과·인계의 단일 업무 화면 |
| S40 | `#/approvals` | 결과 승인 / 내용 판단 / 범위·권한 요청 |
| S50 | `#/records` | 결과물, 결정 기록, 근거 검색 |
| S60 | `#/settings/connections` | 장치·실행 도구·인증·검증 상태 |
| S61 | `#/settings/team` | 프로젝트별 역할, 능력, 검토자 |
| S62 | `#/settings/policies` | 한도·보존·알림·권한 정책 |

GitHub Pages에 배포하는 첫 화면은 해시 라우팅을 사용한다. 정적 화면과 실행 서버를 분리한다(S09).

## 4. 화면별 구체 명세

### S00 — 최초 설정

① 소유자 로그인 → ② PC 연결 → ③ 프로젝트 경로·저장소 확인 → ④ 도구 연결 시험 → ⑤ 정책 검토.

PC는 소유자가 생성한 짧은 유효기간의 일회용 페어링 코드로 등록한다. 코드 사용 후 폐기하고 장치별 회수 가능한 인증을 발급한다. 등록을 위한 PC 에이전트 설치·공식 로그인은 최초 1회 필요하며 웹페이지가 임의로 PC에 설치하지 않는다.

프로젝트 등록은 폴더를 명시적으로 선택한다. MILAL의 기존 `C:\MILAL`은 후보일 뿐, 실제 경로로 확인하기 전 확정하지 않는다. README·HANDOFF·관련 지시서를 읽어 정책 후보를 제안하되 소유자 승인 없이 실행 정책으로 승격하지 않는다. 기존 문서를 수정하지 않고 읽은 commit과 해시를 기록한다.

연결 시험은 실행 파일 위치, 버전, 인증 경로, 권한, 샘플 읽기 작업, 스트림 파싱, 취소·종료, 경로 격리를 확인한다. 도구가 없으면 설치 안내만 제공하고 정상 연결로 표시하지 않는다. 유료 호출이 발생하는 시험은 실행 전에 알린다.

### S10 — 사무실

우선순위: **사용자 결정 → 팀원 현황 → 진행 작업 → 최근 결과**.

```text
AI OFFICE  [전체 프로젝트 ▼] [검색]       [+ 새 지시] [실행 제어]
연결: PC-A 정상 · 마지막 상태 수신 시각 / 동기화 지연 경고

[내 결정이 필요한 일]
MILAL / 규칙 해석 선택    [근거·대안 보기]
CBSR / 결과 검토         [변경점·검사 보기]

[팀원 자리]
GPT                    Claude                   Gemini / NotebookLM
연구·검수               구현                     자료·이미지
외부 검토 중             CBSR-021 테스트 수정     이미지 결과물 대기
직접 보고 · 12분 전       실행 이벤트 · 3초 전      수동 인계 · 30분 전
[작업 열기]             [작업 열기]              [결과 등록]

[진행 작업]
프로젝트 | 작업 | 담당 | 현재 단계 | 막힌 이유 | 다음 행동

[최근 검증된 결과]
검사 결과 / 사용자 결정 / 제출된 결과물
```

위 시간·업무 번호는 화면 예시다. 실서비스에서는 실제 기록을 사용한다.

팀원 카드 필수 필드: 표시 이름, 프로젝트별 역할, 현재 단계의 작업 ID, 한 줄 작업 내용, 실행 모드, 상태 근거, 마지막 이벤트 시각, 연결 신선도, 다음 행동. 여러 작업을 맡아도 현재 실행과 대기열을 분리한다. 사용자 브라우저 접속 여부로 AI가 일한다고 판단하지 않는다.

‘새 지시’는 항상 보인다. 작업 중지와 신규 배정 일시정지는 구분한다. 전체 중지는 실행 중인 작업과 예상 영향을 보여주고 확인 후 요청한다. 미연결 장치는 ‘중지 전달 대기’로 표시한다.

빈 화면에는 무의미한 0건 그래프 대신 ‘PC 연결 → 프로젝트 등록 → 첫 지시’의 필요한 행동을 표시한다. 샘플 자료는 별도 데모 배지와 격리된 데이터 공간을 사용한다.

### S21 — 프로젝트 작업실

상단에는 목적 1문장, 현재 목표, 코드 기준 commit, 적용 정책 버전, 연결 PC, 운영 사이트 링크를 둔다. 탭은 4개다.

| 탭 | 내용 |
|---|---|
| 개요 | 목표, 담당·검토 역할, 막힌 일, 최근 결정, 다음 작업 |
| 작업 | 동일 작업함 컴포넌트에 프로젝트 필터 적용. 새 작업·선후행 관계 |
| 결과 | 변경 묶음, 보고서, 이미지, 검사와 사용자 승인 기록 |
| 원칙 | 고정 원칙, 수정 금지 범위, 근거 문서, 승인된 결정 이력 |

MILAL 템플릿은 연구 판단과 기술 구현을 구분한다. frozen artifact, human judgment, production hierarchy, native_tab과 mother_chain_depth의 독립 보존 등 기존 원칙은 확인된 문서와 연결한다. 저장소에서 경로를 확인하지 않은 보호 항목은 ‘정책 경로 확인 필요’로 남기고 쓰기 실행을 차단한다.

CBSR·CBWP도 기존 기능 보존과 범위 제한을 정책으로 상속한다. 프로젝트를 추가했다고 그 프로젝트를 읽거나 수정할 권한이 자동 부여되지는 않는다.

### S31 — 새 지시

기본 입력은 프로젝트, 지시 내용, 담당, 완료 조건이다. 제목은 지시 첫 문장에서 제안하되 수정할 수 있다. 사용자가 매번 작성하지 않도록 역할·정책·검사 템플릿을 상속한다.

```text
프로젝트  [CBSR ▼]          담당 [Claude ▼]
지시      [배경 이미지 선택을 태그 기준으로 바꾸십시오.]
완료 조건 [무관한 배경 방지 / 기존 QT 흐름 보존 / 회귀 검사]
참고자료  [파일 첨부] [작업·문서 연결]

진행 방식 [개발 → 검사 → 검토 → 내 승인]
자동 수행  승인된 범위의 구현·검사·인계, 보완 최대 2회
고정 제한  main 직접 수정 금지 / 운영 데이터 변경 금지
[상세 범위·예산·권한 펼치기]

[초안 저장] [지시 확정·배정]
```

AI가 분해한 세부 작업은 제안이다. 명시적으로 승인된 워크플로·정책 범위 안에서만 큐에 등록한다. 원본 지시와 구조화된 작업 명세를 함께 저장한다. 실행 중인 지시를 수정하면 새 revision을 만들고 현재 작업에 조용히 덮어쓰지 않는다.

담당이 외부 웹이면 실행 버튼 대신 ‘지시 묶음 만들기’를 표시한다. 지시 묶음에는 작업 번호, 목적, 범위, 자료 링크, 결과 양식이 포함된다. 결과를 등록하기 전에는 자동 실행이라고 표시하지 않는다.

### S32 — 작업 상세

상단은 작업 ID, 제목, 담당·검토자, 실행 모드, 상태, 현재 단계, 지시 revision이다. 좌측 2/3에는 요약·결과·변경점·이력, 우측 1/3에는 원칙·완료 조건·근거·다음 행동을 둔다.

단계 띠: `지시 확정 → 구현 → 자동 검사 → 교차 검토 → 사용자 승인`. 현재 단계만 강조한다. 진행률 대신 ‘완료 조건 4개 중 3개 확인’, ‘필수 검사 12개 중 11개 통과·1개 실패’를 사용한다.

| 상태/모드 | 주 행동 |
|---|---|
| 초안 | 지시 수정·확정 |
| 배정 대기 | 배정 취소·우선순위 변경 |
| 관리형 실행 중 | 공개 작업 로그, 중지 요청, 다음 단계용 추가 지시 |
| 관찰형 실행 | 외부 실행 열기. 제어 미지원 시 원격 중지 없음 |
| 외부 작업 | 서비스 열기, 시작 직접 보고, 결과 등록 |
| 검사 실패 | 실패 증거 보기, 승인 범위 내 보완 또는 한도 초과 보고 |
| 사용자 판단 대기 | 질문·대안·근거 보기, 결정 입력 |
| 결과 승인 대기 | 변경점·검사·제한 확인, 승인 또는 보완 요청 |
| 통신 끊김 | 마지막 확인 시각, 미전달 명령, 재연결 확인 |

추가 지시는 실행 능력에 따라 처리한다. v1 CLI 모드에서는 현재 턴에 적용됐다고 표현하지 않고 다음 안전 경계/새 실행에 적용한다. 도구의 정상 중지 지원을 연결 시험에서 확인한다. 강제 종료는 미완료 파일을 남길 수 있으므로 파일을 보존하고 재개 전 점검한다.

결과 미리보기는 코드 diff, Markdown 보고서, 이미지, 검사 JSON을 지원한다. 임의 HTML·스크립트는 실행하지 않는다. 내부 추론 원문 대신 공개된 실행 이벤트, 도구 행동, 최종 보고와 근거를 노출한다.

### S40 — 승인함

| 구분 | 필수 표시 | 결정 |
|---|---|---|
| 결과 승인 | 원래 지시, 변경 내용, 통과·실패·미실행 검사, 근거, 남은 제한 | 승인 / 보완 요청 |
| 내용 판단 | 쟁점, 대안, 각 근거, 반례, 미확정 사항, 후속 영향 | 대안 선택 / 직접 결정 / 보류 |
| 범위·권한 | 요청된 추가 행동·파일·네트워크, 필요 이유, 위험과 대안 | 이번 요청만 허용 / 거절 |
| 운영 반영 | 후속 기능. 승인 대상 commit·배포 대상·검사 | 별도 명시적 승인 |

승인은 `(task_id, revision, policy_version, input_manifest_hash, candidate_hash, action_scope)`에 결속한다. 도구 권한 요청은 도구 이름·정규화된 인자 hash도 포함한다. 대상이 바뀌면 기존 승인은 무효다. AI가 자기 승인을 기록할 권한은 없다.

연구 판단에 AI 간 다수결을 사용하지 않는다. 판단 내용과 사유, 선택하지 않은 대안도 결정 이력에 남긴다. 승인함에서 같은 실행의 중복 알림은 묶되 서로 다른 위험한 요청을 무심코 일괄 승인하게 만들지 않는다.

‘작업 완료’는 결과를 받아들였다는 뜻이며, main 병합·배포 완료와 다르다. v1은 운영 반영 버튼을 비활성화하거나 명확한 수동 절차로 구분한다.

### S50·S60 — 기록과 설정

기록 검색 키: 프로젝트, 작업 번호, 팀원, 날짜, 파일명, 본문 구절/키워드, commit, 결과 유형. 결과물이 없으면 ‘없음’, 아직 전송되지 않았으면 ‘전송 대기’, 확인할 수 없으면 ‘확인 불가’로 분리한다.

연결 설정은 설치·인증·실행 시험·마지막 접속을 따로 표시한다. 비용은 확인된 사용량, 추정 사용량, 확인 불가를 구분한다. 구독 사용량과 API 과금을 섞지 않고 알 수 없는 값을 0원으로 넣지 않는다. 한국어 UI, UTC 저장·Asia/Seoul 표시를 기본값으로 한다.

모바일 승인 화면에서도 지시·검사·남은 위험을 확인한 뒤 승인할 수 있어야 한다. 작은 화면 때문에 근거를 숨긴 채 승인 버튼만 제공하지 않는다.

## 5. 필수 기능 명세

| ID | 기능 | 입력 → 처리 → 출력 | 검수 기준 |
|---|---|---|---|
| F01 | 프로젝트 등록 | 경로·원격·목적 → 읽기 확인 → 프로젝트·기준 버전 | 기존 파일 변경 0건 |
| F02 | 역할 배정 | 팀원·프로젝트·권한 → 역할 저장 | 구현자와 검토자 구분 |
| F03 | 지시 버전 | 원본·완료 조건 → 불변 revision 생성 | 실행 중 수정 이력 보존 |
| F04 | 컨텍스트 묶음 | 정책·근거·버전·결정 → manifest와 hash | 모델이 받는 입력 재현 가능 |
| F05 | 대기열 | 확정 지시 → 조건 검사·원자적 claim → run | 중복 요청에도 실행 1회 |
| F06 | 관리형 실행 | 검증된 adapter → 이벤트 수집 → 현재 단계 | 실제 로컬 프로세스 실행 |
| F07 | 외부 작업 | 지시 묶음 → 사용자 작업 → 결과 등록 | 수동 근거 배지 유지 |
| F08 | 자동 검사 | 후보 버전·승인된 명령 → 실행·결과 수집 | 미실행은 통과 아님 |
| F09 | 교차 검토 | 고정 diff·근거 → 읽기 전용 검토 | 검토자가 후보 코드를 수정하지 않음 |
| F10 | 보완 반복 | 구조화 실패 → 허용 범위 검사 → 다음 run | 최대 2회 이후 소유자에게 보고 |
| F11 | 인계 | 결과물+검증+manifest → 스키마·hash 검증 → 다음 단계 | 누락·불일치면 인계 중단 |
| F12 | 승인 | 대상 snapshot → 소유자 결정 → 감사 이력 | 대상 변경 시 stale 처리 |
| F13 | 상태 표시 | 정규화 이벤트 → 서버 상태 전이 → 실시간 갱신 | 보고 근거·최근 시각 포함 |
| F14 | 중지 | 대상 run → 요청·전달·확인 → 종료 | 미전달을 완료로 표시하지 않음 |
| F15 | 작업 보존 | branch/worktree·정책 → 격리 실행 | 기존 WIP·main 불변 |
| F16 | 재연결 | event outbox·cursor → 재전송·중복 제거 | 순서 역전·중복 완료 없음 |
| F17 | 비용·한도 | 확인된 사용량·시간·횟수 → 경계 검사 | 알 수 없는 비용은 unknown |
| F18 | 자료 보호 | 권한·서명 URL·정화 → 제한된 열람 | 익명 접근과 비밀값 노출 차단 |
| F19 | 결정 기록 | 소유자 판단 → decision ID·근거 기록 | 후속 지시에 고정된 결정 연결 |
| F20 | 내보내기 | 작업·결과·결정 → MD/JSON bundle | 특정 SaaS 없이 기록 재열람 |

## 6. 업무 흐름

### 6.1 개발·검증 템플릿

1. 사용자가 지시를 확정한다. 프로젝트 원칙과 기본 완료 조건을 상속한다.
2. 서버가 정책·필수 자료·연결 능력·대기열 한도를 확인한다.
3. Runner가 지시 revision과 입력 hash를 검증하고, 기존 저장소를 보존한 작업 공간을 만든다.
4. 구현자가 승인된 범위만 수정한다. 후보 commit 또는 파일 manifest를 고정한다.
5. 별도 검사 단계가 후보 버전에 대해 필수 검사를 실행한다.
6. 다른 팀원/실행 역할이 동일 후보를 읽기 전용으로 검토한다.
7. 실패하면 보완 가능한 기술 문제에 한해 최대 2회 수정→재검사→재검토한다.
8. 통과하면 사용자 승인함에 제출한다. 사용자 승인 후 업무를 완료로 기록한다.
9. 운영 반영은 별도다. v1에서 자동 merge·deploy하지 않는다.

교차 검토가 다른 AI라고 해서 오류 없는 판정이 되는 것은 아니다. 기계 검사와 인간의 연구·내용 판단을 구분한다.

### 6.2 MILAL 연구 템플릿

`문제·근거 수집 → 분석과 경쟁 대안 → 사용자 판단 → 승인된 규칙의 기술 구현 → 회귀 검사 → 사용자 결과 승인`.

사용자 판단 전에 연구 대안을 production 규칙으로 통합하지 않는다. additive analysis 작업은 기존 판정과 frozen 자료를 건드리지 않는 별도 출력으로 제한한다. 새로운 해석, 범위 변경, 원칙 충돌, production rule 변경 요청은 자동 루프를 멈춘다.

`docs/HANDOFF.md`는 읽고 기준으로 연결한다. 쓰기 업데이트가 필요하면 별도 후보 변경으로 제출하고 사용자 승인 없이 원본을 덮어쓰지 않는다.

### 6.3 Gemini/NotebookLM 외부 작업 템플릿

`작업 번호가 있는 지시 묶음 → 외부 서비스에서 수행 → 이미지/보고서와 출처·노트북 링크 등록 → 검토자에게 인계 → 승인`.

파일 등록만으로 내용이 맞다고 판정하지 않는다. 이미지 태그·성경 본문 적합성·출처와 사용 범위는 별도 검토 항목이다. 파일명만으로 작업을 자동 확정하지 않고 작업 ID 선택 또는 확인을 요구한다.

### 6.4 반복·중단 규칙

자동 보완 2회는 최초 실행 외에 허용되는 보완 횟수다. 네트워크 재시도와 작업 재실행을 별도로 센다. 같은 실패 지문이 반복되거나 의미 있는 진전이 없으면 한도 이내라도 사용자에게 올린다. 두 AI의 장시간 토론을 자동으로 생성하지 않는다.

권한 확대, 수정 금지 파일, 데이터 삭제·마이그레이션, 운영 반영, 새 연구 판단, 기준 버전 불일치, 사용량·실행시간 한도 초과는 소유자 판단을 요구한다.

## 7. 상태 모델

### 7.1 업무 상태

`draft → ready → active → review → awaiting_owner → done`

`review → needs_changes → active`는 보완 한도 내에서만 허용한다. 어느 비종료 상태에서도 `blocked` 또는 `cancelled`로 갈 수 있다. blocked는 이유와 재개할 이전 단계를 저장한다. `done`을 되돌려 조용히 수정하지 않고 새 revision/후속 작업을 만든다.

### 7.2 실행 상태

`queued → leased → starting → running → succeeded | failed | cancelled`

필요 시 `waiting_input`, `stopping`, `lost`를 사용한다. 프로세스 종료 0, 모델의 ‘완료’ 발언, 테스트 일부 통과는 업무 done의 조건이 아니다. 실행 성공, 단계 검증, 사용자 승인은 다른 사건이다.

### 7.3 연결 상태와 근거

연결은 `healthy / delayed / offline / unknown`, 증거는 `runner_observed / tool_reported / user_reported / server_derived`로 구분한다. 현재 단계 설명이 모델의 자체 보고라면 ‘AI 보고’라고 표시한다. 외부 웹의 사용자 보고는 네트워크 heartbeat와 무관하다.

## 8. 기술 구성

```text
브라우저 — React / TypeScript / Vite
  │ 소유자 인증, 조회, 지시·승인 명령
  ▼
제어 서버 — Supabase Auth / Postgres / Storage / Realtime
  + 짧은 API 핸들러(Edge Functions), 정책·상태 전이 함수
  │ 원자적 대기열 claim, 명령, 이벤트 승인
  ▲ PC가 시작하는 HTTPS 연결 (외부에서 PC 포트 개방하지 않음)
Windows Runner — Node.js / TypeScript
  ├ 장치 인증, 로컬 outbox, heartbeat, 프로세스 감독
  ├ Codex CLI adapter
  ├ Claude Code CLI adapter / 선택적 hooks observer
  ├ 정책 검사·worktree·파일 manifest
  └ 격리된 검사 프로세스

GitHub / 로컬 Git — 기준 commit·PR·검사 근거
외부 웹 AI — 지시 묶음·수동 보고·결과 첨부
```

프론트엔드는 GitHub Pages에 둘 수 있다. GitHub Pages는 정적 호스팅이므로 장시간 AI 실행을 맡기지 않는다(S09). Edge Function도 실행 프로세스를 호스팅하는 대신 짧은 인증·대기열·이벤트 처리를 담당한다.

Supabase Realtime은 DB 변경의 알림 수단이다(S10). 작업의 정본은 DB의 상태·감사 이벤트이고, 재연결 시 조회 API로 빠진 데이터를 다시 가져온다. 브라우저가 닫혀도 이미 시작한 로컬 실행은 Runner가 관리한다. PC 종료 시 작업은 계속되지 않는다.

서버의 업무 큐는 v1 규모에서는 Postgres로 구현한다. 별도의 메시지 브로커·다중 에이전트 프레임워크·3D 엔진을 처음부터 추가하지 않는다.

## 9. 데이터 모델

모든 업무 데이터는 `workspace_id`, 작성·수정 시간, 필요한 작성자/버전을 가진다. 민감 정보는 결과물에서 분리한다. 아래는 논리 모델이며 물리 테이블을 병합할 때도 식별자·참조와 불변성은 보존한다.

| 엔터티 | 핵심 필드 / 규칙 |
|---|---|
| workspaces, memberships | 소유자, 권한. v1은 owner 1명 |
| projects | 이름, 목적, repo reference, 기본 정책, 보호 대상 등록 상태 |
| project_policies | immutable version, 허용/금지 경로, 검사, 데이터 분류, 위험 행동 |
| team_members, role_assignments | 표시 이름, 프로젝트별 역할, 검토 독립성 |
| connections | provider, mode, adapter version, capabilities, auth/billing label |
| runners, runner_projects | 장치, 인증 public metadata, heartbeat, 허용된 프로젝트 루트 |
| tasks, task_revisions | 업무 상태와 불변 지시·완료 조건·정책 참조 |
| workflow_steps, step_dependencies | 단계 역할, 선행 단계, 입력·출력 계약, 상태 |
| runs | step, attempt, revision, runner, provider session ID, lease/fence, 상태 |
| run_events | event ID, run sequence, source, server cursor, type, payload, hash |
| artifacts, artifact_versions | private object key, sha256, MIME, 크기, 생성 run, 분류 |
| checks, check_results | 필수 여부, 명령·환경, 후보 hash, exit code, pass/fail/skip |
| review_results | 검토자, 후보 hash, 발견사항, 근거, verdict |
| handoffs | input/output manifest, 대상 단계, 검증 상태, immutable revision |
| approvals, decisions | 소유자, 대상 snapshot hash, 요청 유형, 결정·근거·시각 |
| resource_locks | repo/worktree, holder run, lease epoch, quarantine 상태 |
| command_requests | 실행·중지·추가지시의 idempotency key와 전달/확인 상태 |
| usage_records | 제공자가 준 사용량·측정 범위·추정/확정/unknown |
| audit_events | 정책·승인·권한·명령 변경 이력. 모델은 수정 불가 |

핵심 제약:

- `UNIQUE(run_id, sequence)` 및 `UNIQUE(event_id)`로 중복 제거한다.
- 명령은 `(workspace_id, idempotency_key)` 고유. 동일 버튼 중복 클릭으로 실행을 늘리지 않는다.
- 재시도는 새 run이며 이전 실행을 덮어쓰지 않는다.
- 승인과 검사·검토는 특정 지시 revision과 후보 결과 hash에 결속한다.
- 같은 저장소의 관리형 쓰기는 v1에서 직렬화한다. 독립 브랜치도 의미 충돌은 생길 수 있다.
- 승인·원칙·코드 기준·결과 해시를 모델의 자유 텍스트로 갱신하지 않는다.

## 10. API와 이벤트 계약

### 10.1 사용자 명령

| 메서드·경로 | 책임 |
|---|---|
| `POST /api/projects` | 명시적으로 확인된 프로젝트 등록 |
| `POST /api/tasks` | 초안 생성 |
| `POST /api/tasks/:id/revisions` | 새 지시 revision 작성 |
| `POST /api/tasks/:id/dispatch` | 정책 검사 후 단계·실행 계획 확정 |
| `POST /api/runs/:id/cancel` | 중지 요청 생성. 즉시 성공 종료를 의미하지 않음 |
| `POST /api/tasks/:id/instructions` | 추가 지시 저장, 적용할 revision/안전 경계 명시 |
| `POST /api/tasks/:id/external-reports` | 소유자 직접 보고·외부 결과 등록 |
| `POST /api/approvals/:id/decide` | 소유자 인증·대상 hash 검사 후 결정 |
| `GET /api/tasks/:id/snapshot` | 상태와 일관된 이벤트 cursor 반환 |
| `GET /api/events?after=CURSOR` | 권한 범위 내 누락 이벤트 복구 |
| `POST /api/artifacts/uploads` | 제한된 파일의 업로드 권한 발급 |
| `POST /api/artifacts/:id/finalize` | 저장 완료·서버 hash·타입 확인 후 결과물 등록 |
| `POST /api/tasks/:id/export` | MD/JSON 인계 묶음 생성 |

변경 명령은 인증, `Idempotency-Key`, 예상 revision을 요구한다. 충돌 시 409와 현재 revision을 반환한다. 비동기 명령은 202와 command ID를 반환하며, UI는 전달·수락·완료 상태를 따로 보여준다.

### 10.2 Runner 전용 명령

`POST /api/runner/pair`, `POST /api/runner/heartbeat`, `POST /api/runner/claim`, `POST /api/runner/leases/:id/renew`, `POST /api/runner/events:batch`, `GET /api/runner/commands`, `POST /api/runner/commands/:id/ack`.

claim은 서버 트랜잭션에서 선행 조건·정지 상태·한도·잠금을 확인하고 하나의 실행만 반환한다. 인증 토큰은 프로젝트·장치·실행 범위로 제한한다. Runner는 승인·정책을 수정하는 권한을 갖지 않는다.

### 10.3 정규화 이벤트

필수 필드: `schema_version, event_id, project_id, task_id, task_revision, run_id, sequence, runner_id, lease_epoch, occurred_at, event_type, source, payload`.

서버는 `received_at, cursor, validated_actor`를 추가한다. 클라이언트 시각만으로 상태 순서를 정하지 않는다. 이벤트 type 예: `run.started`, `step.reported`, `tool.started`, `tool.completed`, `artifact.submitted`, `check.completed`, `approval.requested`, `run.completed`, `run.failed`, `run.cancelled`.

CLI의 provider 이벤트를 그대로 업무 상태로 사용하지 않고 adapter에서 정규화한다. 모델이 도구 출력에 ‘approval granted’라고 써도 승인 이벤트로 승격하지 않는다. 상세 스키마는 `contracts/office-event.schema.json` 참조.

### 10.4 인계 계약

인계에는 목적, 범위, 수행 내용, 결과물 hash, 후보 버전, 검사, 검토 필요 사항, 알려진 제한, 다음 담당의 행동, 기준 입력 manifest가 있어야 한다. 데이터가 없으면 빈 배열·null을 명시하고 ‘통과’를 꾸며 채우지 않는다.

검사를 수행하지 못한 인계도 자료 보존을 위해 제출할 수 있으나, 다음 단계 진행 여부는 필수 검사 정책이 결정한다. 제출과 인계 수락은 다른 상태다. 상세 스키마는 `contracts/handoff.schema.json` 참조.

## 11. 실시간과 장애 복구

아래 숫자는 서비스의 현재 성능이 아니라 **초기 설계값과 시험 목표**다.

| 항목 | 초기 기준 |
|---|---|
| 이벤트 전달 | 서버 수신 후 UI 반영 p95 2초 이내(정상 연결 시험) |
| 장치 heartbeat | 15초 |
| 지연 표시 | 45초 이상 heartbeat 없음 |
| 연결 끊김 | 90초 이상 heartbeat 없음. 마지막 확인 시각 병기 |
| 대기열 조회 | 대기 중 약 5초, 유휴 시 backoff |
| 텍스트 스트림 | 0.5~1초 단위로 묶음. 토큰마다 DB 행 생성하지 않음 |
| 보완 한도 | 최초 실행 뒤 최대 2회 |
| PC 동시 실행 | 기본 1개 |
| 실행시간 상한 | 기본 30분, 작업 유형별 명시적 변경 가능. 완료 예상시간 아님 |

Runner는 이벤트를 로컬 SQLite outbox에 먼저 기록하고 서버 확인 뒤 전송 완료로 표시한다. 서버는 멱등하게 수신한다. 재접속 시 snapshot과 server cursor 이후 이벤트를 가져오고 중복을 제거한다. 실시간 구독 시작과 snapshot 사이의 경쟁 상태도 cursor 재조회로 메운다.

활동 로그가 잠시 없다는 이유만으로 작업을 실패 처리하지 않는다. heartbeat는 도구 로그와 분리한다. 컴퓨터가 살아 있어도 provider가 응답하지 않을 수 있으므로 단계 시간 상한을 따로 둔다.

**lease 만료만으로 쓰기 작업을 다른 PC에 재배정하지 않는다.** 기존 프로세스가 남아 있을 수 있으므로 lost/quarantine으로 두고 종료·workspace 점검을 확인한 뒤 재개한다. 이전 lease epoch의 이벤트는 감사용 격리 기록으로 보존하고 새 상태를 덮어쓰지 못하게 한다.

연결이 끊기면 새 단계·위험 행동은 시작하지 않는다. 이미 실행 중인 명령은 즉시 정지할 수 있다고 보장하지 않으며 다음 제어 지점에서 멈추고 상태를 확인한다. 브라우저의 ‘중지 요청’과 실제 프로세스 종료 확인은 다르다.

## 12. 코드·권한·데이터 보호

### 12.1 코드 보존

worktree는 같은 저장소에 분리된 작업 트리를 만들 수 있다(S11). 그러나 보안 격리나 의미 충돌 방지 그 자체는 아니다. 정책·프로세스 권한·검사가 추가로 필요하다.

기존 checkout은 읽기 기준으로만 다루고, 쓰기 작업은 승인된 base SHA에서 별도 branch/worktree로 실행한다. 원본 WIP는 자동 stash/reset/정리하지 않는다. WIP를 입력에 포함해야 하면 소유자가 선택한 snapshot으로 별도 고정하고 이력을 남긴다. 작업 전후 원본·보호 파일 hash를 검사한다.

v1에서는 원본 main, frozen 파일, production hierarchy, human judgment 수정 금지. 별도 worktree에서도 보호 경로 수정은 차단한다. `.git`, 명령 스크립트, package lifecycle, hooks, symlink/junction 경로도 정책 검사 대상이다. 경로는 Windows 대소문자·UNC·상위 이동·junction을 정규화해서 검사한다.

### 12.2 실제 실행 경계

프롬프트의 ‘수정 금지’만으로 강제한다고 주장하지 않는다. 도구의 sandbox·권한 설정과 OS 접근 제어/격리 환경을 사용하고, 통합 시험으로 원본·보호 경로 쓰기 차단을 확인한다. 해당 실행 환경에서 강제가 검증되지 않으면 자동 쓰기를 비활성화하고 읽기 전용/명시적 수동 실행만 허용한다.

검사 프로세스는 AI 인증키·DB 권한·배포 토큰을 상속하지 않는다. 허용된 검사 명령도 임의 코드를 실행할 수 있으므로 일반 셸 전체 권한과 동등하게 취급하지 않고 별도 제한 환경에서 실행한다. 의존성 설치·네트워크 접근은 사전 승인된 범위 또는 별도 요청으로 처리한다.

### 12.3 서비스 권한

브라우저에는 공개용 publishable key와 사용자 인증만 둔다. RLS와 서버의 owner 검사로 다른 작업 공간 접근을 차단한다. 비밀키는 서버에만 보관한다. 공개키는 사용자 인증을 대신하지 않으며 서버 비밀키는 RLS를 우회할 수 있으므로 별도 권한 확인이 필수다(S12).

로컬 장치에는 범위가 제한된 장치 인증을 제공하고 DB 관리자 키를 주지 않는다. 실행 자식 프로세스는 장치 인증을 상속하지 않는다. 배포·merge 권한은 v1 실행 도구에 전달하지 않는다.

자료·로그의 성도 개인정보, 미공개 연구 자료, 인증값은 최소 전달·마스킹·private 저장을 기본으로 한다. 다른 모델/제공자에게 자료를 인계하는 허용 범위를 프로젝트 정책에 둔다. 외부 문서·모델 출력·repository README는 신뢰된 시스템 명령이 아니라 데이터다.

웹훅을 도입할 때 GitHub 서명 검증, delivery ID 중복 제거, 허용 저장소·이벤트 확인을 적용한다(S13). 초기에는 GitHub 읽기 전용 증거 연결만으로도 시작할 수 있다.

### 12.4 보존과 복구

확정 결과물·승인·결정은 사용자 보관 해제 전까지 유지한다. 원시 상세 로그는 기본 30일 정책을 제안하되 확정 근거는 별도 보존한다. 삭제는 소유자 요청으로만 수행하며 보존 기간을 UI에 표시한다. 내보낸 bundle의 manifest·hash 검증과 복구 시험을 출시 조건으로 둔다.

## 13. 구현 순서와 완료 관문

| 순서 | 구현 | 통과해야 하는 관문 |
|---|---|---|
| M0 | 계약·상태 전이·정책·샘플 이벤트·권한 테스트 | 모의 이벤트에도 승인 우회·중복 전이 불가 |
| M1 | 소유자 인증·PC pairing·큐·Codex 읽기 전용 수직 흐름 | 웹 지시가 실제 로컬 실행으로 이어지고 이벤트·결과가 재접속 후 유지 |
| M2 | workspace 격리·Claude adapter·검사·인계·보완 | 임시 저장소에서 구현→검사→다른 역할 검토→승인. 원본 불변 |
| M3 | 외부 웹 작업·자료·프로젝트 원칙·모바일 승인·검색 | 수동/자동 근거 구분, 실제 사용자 업무로 전체 시나리오 통과 |
| M4 | GitHub 근거 확장, optional API·App Server, 운영 반영 | 각각 능력 시험·보안 검수·별도 권한 승인 후 추가 |

M1~M3가 v1의 필수 완료 범위다. M1 화면만 완성했다고 통합형 사무실 완료로 보고하지 않는다. M0 이전에 기존 프로젝트를 변경하지 않고, M2까지는 폐기 가능한 시험 저장소로 검증한다.

권장 소스 구조:

```text
apps/web/                  화면·클라이언트 상태
apps/runner/               장치·실행 감독·로컬 outbox
apps/runner/adapters/      codex, claude-code, observed hooks
packages/contracts/       이벤트·인계·API 스키마
packages/workflows/       순수 상태 전이와 정책 평가
supabase/migrations/      테이블·RLS·트랜잭션 함수
supabase/functions/       인증된 명령·이벤트 API
fixtures/                 가짜 이벤트·별도 시험 저장소
tests/                   계약·권한·복구·전체 흐름 시험
```

Node/프레임워크·SDK 버전은 설치 시 지원 범위를 확인해 lockfile에 고정한다. 실험 기능은 feature flag와 계약 시험을 통과한 경우에만 활성화한다.

## 14. 인수 시험

| ID | 시나리오 | 기대 결과 |
|---|---|---|
| A01 | 실제 Codex 작업 실행 | 연결·시작·이벤트·결과가 동일 run으로 추적됨 |
| A02 | 실제 Claude Code 작업 실행 | stream event·결과·세션 참조 연결 |
| A03 | 새로고침/브라우저 재시작 | 현재 단계·결과·승인 상태 복구 |
| A04 | 연결 중단 뒤 재접속 | outbox 재전송, 이벤트 중복·역전 없음 |
| A05 | 실행 버튼 빠르게 두 번 클릭 | run 1개만 실행 |
| A06 | PC 중단/lease 만료 | lost 표시, 쓰기 작업 자동 재배정 안 함 |
| A07 | 중지 요청을 PC가 받지 못함 | ‘전달 대기’ 표시, 중지 완료 허위 표시 없음 |
| A08 | 모델이 ‘모두 완료’ 보고, 필수 검사 미실행 | 업무 done 차단 |
| A09 | 테스트 실패 | 보완 반복은 허용 범위·한도 안에서만 수행 |
| A10 | 보완 한도 초과 | 사용자 판단함, 추가 호출 없음 |
| A11 | 승인 후 후보 내용 변경 | 이전 승인 stale, 재검사·재승인 |
| A12 | 기존 WIP와 frozen 파일이 있음 | 원본 불변, 보호 위반 시 실행 중단 |
| A13 | symlink/junction로 보호 경로 접근 | 쓰기 차단 또는 자동 쓰기 불가 처리 |
| A14 | 익명/다른 workspace 접근 | 데이터·파일·Realtime 접근 거절 |
| A15 | 모델/Runner가 승인 API 호출 | 소유자 권한 부재로 거절 |
| A16 | NotebookLM 결과 수동 첨부 | 수동 근거와 작업 번호 표시, 자동 실행으로 오인하지 않음 |
| A17 | 인증 만료·rate limit·provider 오류 | 구체 이유·현재 실행 결과, 무한 재실행 없음 |
| A18 | 로그·업로드에 토큰/개인정보 포함 | 마스킹·격리 또는 등록 차단 |
| A19 | handoff 파일 누락/hash 불일치 | 인계 차단, 기존 결과 보존 |
| A20 | MILAL 새 해석을 구현하려는 요청 | 내용 판단 단계에서 멈춤 |
| A21 | 기록 bundle 내보내기·복원 | manifest hash·작업/결정/결과 참조 일치 |
| A22 | 실제 이벤트가 없는 팀원 | ‘대기/확인 불가/외부 보고’ 표시, 가짜 활동 없음 |
| A23 | 모바일에서 결과 승인 | 원본 지시·검사·위험 열람 가능 |
| A24 | 권한 거절 뒤 같은 요청 재시도 | 정책 우회 불가, 요청 이력 보존 |

## 15. 공식 근거

아래 문서는 2026-10-28 확인했다. 시스템의 임계값·화면·데이터 모델은 본 설계의 제안이지 제공자의 보장 수치가 아니다. 로컬 설치 버전과 제품 제공 범위는 별도 연결 시험으로 확인한다.

```text
S01 OpenAI — Non-interactive mode
https://developers.openai.com/codex/noninteractive
S02 OpenAI — Codex App Server
https://learn.chatgpt.com/docs/app-server
S03 Anthropic — Run Claude Code programmatically
https://code.claude.com/docs/en/headless
S04 Anthropic — Hooks reference
https://code.claude.com/docs/en/hooks
S05 Google Cloud — Create and manage notebooks (API)
https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks
S06 Google — Gemini API text generation
https://ai.google.dev/gemini-api/docs/text-generation
S07 Anthropic — Agent SDK quickstart
https://code.claude.com/docs/en/agent-sdk/quickstart
S08 Anthropic — Authentication; Legal and compliance
https://code.claude.com/docs/en/authentication
https://code.claude.com/docs/en/legal-and-compliance
S09 GitHub — What is GitHub Pages?
https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
S10 Supabase — Postgres Changes
https://supabase.com/docs/guides/realtime/postgres-changes
S11 Git — git-worktree
https://git-scm.com/docs/git-worktree
S12 Supabase — API keys; Row Level Security
https://supabase.com/docs/guides/getting-started/api-keys
https://supabase.com/docs/guides/database/postgres/row-level-security
S13 GitHub — Validating webhook deliveries
https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
```
