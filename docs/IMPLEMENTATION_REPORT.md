# 픽셀 사무실 구현 보고 (AI Office 1.1)

작성일: 2026-10-28 · 작성: Claude (Claude Code) · 기준 문서: `docs/handoff/CLAUDE_START_HERE.md`

## 0. 먼저 알아야 할 것

- **기존 AI Office 저장소는 없었다.** GitHub 계정과 PC(바탕화면·문서·C:\ 최상위)에서 찾지 못했고, 사용자가 "아직 없음 — 새로 만들기"를 선택했다. 그래서 v1 명세의 메인 대시보드를 **최소 구현으로 먼저 만들고**(`main`), 그 위에 픽셀 사무실을 추가했다(`feat/pixel-office`).
- **실제 서버·Runner·PC 에이전트는 없다.** 따라서 "실제 연결 검수(PX-09, AT-26)"는 **미실행**이다. 대신 ① 서버(HTTP) provider 경계(미검증 스텁) ② 로컬 모드(수동 보고만) ③ 데모(배지)를 분리해 구현하고 시험했다.
- 고정 시점 2.5D 픽셀아트(PixiJS 8.21.0)로 구현했다. 카메라 회전·3D 메시·자유 보행·자동 채팅은 없다.

## 1. 기준 브랜치 / 커밋 / 변경 파일

| 항목 | 값 |
|---|---|
| 저장소 | 로컬 신규 `ai-office` (GitHub 미푸시 — 사용자가 `CBAO` 저장소를 만들면 푸시 예정) |
| `main` | `77727f2` 기본 앱 (대시보드·작업함·승인함·기록·설정·store·provider) |
| `feat/pixel-office` | 이 보고와 함께 커밋 (픽셀 사무실 + 에셋 + 시험 + 문서) |
| 작업 범위 | 기존 파일 덮어쓰기·reset·force push·main 직접 수정·배포 없음 (신규 저장소) |

주요 파일:

```
src/domain/           types.ts, viewModel.ts(starter 이식), snapshot.ts(투영·검증·acceptSnapshot)
src/store/            workspaceStore.ts(단일 스토어, revision 게이트), commands.ts(명령 reducer)
src/store/providers/  httpProvider.ts(미검증), localProvider.ts, demoProvider.ts, demoFixture.ts
src/features/dashboard, tasks, approvals, records, projects, settings   # 기존 화면
src/features/office-shared/   OfficeHeader(보기 전환), useOfficeSnapshot(같은 selector)
src/features/pixel-office/    PixelOfficePage, OfficeCanvas, MemberNameplate, MemberDrawer,
                              OfficeAccessibleList, officeViewAdapter, renderer/*, config/*.json
tools/pixel-art/      코드로 그리는 픽셀 아틀라스 생성기 → public/pixel-office/
tools/e2e/run.mjs     브라우저 인수 시험 → docs/test-results/
```

### 라우트 변경표

| 명세 경로 | 실제 경로 | 비고 |
|---|---|---|
| `#/office` | `#/office` | 유지. 최초 진입 |
| `#/office/room` | `#/office/room` | 추가. 직접 링크 허용, `?project=&member=` 쿼리 |
| `#/setup` | `#/settings/connections` 로 alias | S00 은 별도 페이지 없이 연결 설정이 대신 |
| `#/room` | `#/office/room` 로 alias | 짧은 링크 |
| `#/tasks/:id/external-report` | 추가 | 외부 작업 직접 보고 폼 |
| `#/records/handoffs` | 추가 | 인계 기록 (검토·인계 테이블 접근점) |

### 명세와 다른 점 (PX-01 기록)

1. 기존 앱이 없어 "같은 스토어"는 새로 만든 `WorkspaceStore` 하나다. 대시보드와 픽셀 사무실은 모두 `useOfficeSnapshot()` 한 selector 를 읽는다.
2. `office-snapshot` 계약은 `buildOfficeSnapshot(workspace)` 투영으로 만든다. 별도 tasks/runs/approvals 테이블·endpoint 없음.
3. `snapshot_sequence` = workspace `revision`. UI 설정 변경(자리 바인딩·움직임)은 revision 을 올리지 않는다.
4. `room-shell` 한 장 대신 타일 단위 벽 패널로 제작했고, `light-overlay` 는 PNG 대신 Pixi Graphics 정적 광량이다.
5. 장면 JSON 에 장식 `floor-lamp` 1개와 `plant-right.variant` 를 추가했다. 좌표·ID 는 그대로다.
6. `desk-standard.avatar_slot` offset 은 초기값 (0,-18) 대신 실제 에셋 측정값 (-7,-4) 을 아틀라스 meta 에 기록해 사용한다.
7. Pixi 8.21 에는 Canvas renderer 가 있어 `preference: ['webgl','canvas']` 로 두었다. WebGL 없는 환경에서 canvas fallback 이 실제로 동작함을 headless 시험으로 확인했다(AT-23d). 두 renderer 모두 실패하면 React 오류 안내 + DOM 목록 + 다시 시도.

## 2. 구현 항목 / 미구현 항목

### 구현 (PX-01 ~ PX-08)

- **보기 전환**: 상단 `대시보드 | 픽셀 사무실`, 프로젝트 필터(URL 쿼리 공유), 새 지시, 데이터 신선도 줄.
- **자리 바인딩**: 설정 → 팀원·자리에서 seed_key ↔ member_id 명시 연결. 이름이 같아도 자동 연결 없음. 한 팀원을 두 자리에 넣을 수 없음. 미연결 자리는 반투명 캐릭터 + "미연결" + 설정 안내.
- **읽기 모델**: starter `office-view-model` 을 TS 로 이식(`deriveMemberView`). 업무 상태·실행 상태·연결 신선도·근거 출처는 별개 값이며 투영만 한다. 45/90초 경계, run.succeeded ≠ task.done, 수동 보고 ≠ heartbeat, 중지 요청 ≠ 종료 확인.
- **렌더링**: architecture(바닥 432타일·벽 42패널) → floor_decor(러그) → world(접지점 y·bias·id 정렬) → lighting(정적) → selection → DOM UI. 책상은 rear/chair/avatar/front 로 분해되어 캐릭터 다리가 책상 앞판에 가려진다. 오브젝트별 독립 hit 영역(자리는 hit_polygon, 소품은 bounds).
- **카메라**: 방 내용에 맞춤(fit), `맞춤/＋/－` 버튼, Ctrl/Meta+휠 확대(일반 휠은 페이지 스크롤), 드래그 6px 임계값으로 이동과 클릭 구분, pan 정수 스냅. 포인터와 DOM 명패가 같은 `sceneToClient/clientToScene` 변환을 쓴다. 텍스처 nearest, antialias off, 논리 960×600 을 CSS 배율로 확대.
- **명패/드로어**: 이름·상태·업무·근거·마지막 확인은 DOM. 드로어 필드(역할·연결 방식·실행 도구·현재 업무·업무 상태·실행 상태·근거·마지막 확인·동시 작업 `실행 n / 대기 n / 승인 n`·다음 행동·대기 작업·결과물)와 행동(작업 열기·이 담당에게 새 지시·자료 보기·결과 등록·중지 요청). 대표 작업은 서버 실행 → 사용자 선택 → 서버 순서.
- **접근점**: 총괄·승인석(배지 = 권한 있는 미결 승인 수) → 승인함, 인계 테이블 → 인계 기록, 서가 → 기록, 게시판 → 작업함, 실행 PC → 연결 설정, 커피 → 정책(움직임·소리). 그림 안 승인·실행 없음.
- **동작 정책**: typing/reading 반복 동작은 `runner_observed` + 연결 healthy + 실행 생존 확인 healthy 일 때만. AI 보고·서버 기록·외부 보고·지연·끊김은 정지. reduce-motion·숨김 탭·사용자 설정 시 ticker 정지. 30fps 상한.
- **생명주기**: init 전 unmount 시 취소, StrictMode 이중 mount 에서도 canvas 1개(개발 서버에서 확인), 20회 진입·이탈 후 생성 20 = 파괴 20, 이탈 후 canvas 0.
- **회복**: 역순 revision 거부(카운터 표시), workspace/demo 전환 시 화면 상태 초기화, `snapshot 새로 조회` 버튼. 로컬 저장소에 데모 데이터가 섞여 있으면 거부.
- **접근성**: DOM 팀원 목록(캔버스와 같은 기능), 44px 이상 터치 영역, Tab/Enter/Escape, 닫은 뒤 초점 복귀, 캔버스 오버레이 `aria-hidden`(중복 낭독 방지), 색+텍스트+아이콘.
- **보안**: 업무명은 React 텍스트 노드(XSS 시험 통과), 외부 링크 https 만 + noopener/noreferrer, 장면 JSON 의 `action` 은 고정 enum → 라우트 매핑, 비밀키 없음.
- **프라이버시**: 정책 → "업무명 숨기기" (프로젝트명·작업명·결과물명 숨김, 역할·상태만).
- **에셋(PX-06)**: `docs/ASSET_RECORD.md` 참조. 105 프레임, 24 KB.

### 미구현 / 미검증

| 항목 | 상태 | 이유 |
|---|---|---|
| PX-09 실제 관리형 run 1건 관찰 | **미실행** | 서버·Runner·PC 에이전트 없음 |
| AT-26 실제 환경 검수, 사용자 PC/Whale 성능 | **미실행** | 동일 |
| 서버(HTTP) provider 동작 | **미검증** | 서버 없음. `GET /api/workspace`, `POST /api/commands` 최소 클라이언트만 |
| 중지 요청의 전달·종료 확인 | 로컬/데모는 "전달 대기"까지만 | Runner 이벤트 수신이 있어야 함 |
| 인계 수락 후 1회 이동 효과(P1) | 미구현 | 범위 밖 (캐릭터는 자리 고정) |
| 소리 | 토글만 | 소리 에셋 없음 |
| 자리 배치 편집, 테마, 3D 회전, 멀티룸 | 미구현 | P1/P2 범위 |
| 데모 데이터 영속 | 의도적으로 없음 | 새로고침하면 사라짐 (live 혼입 방지) |

## 3. 실제 연결 / 수동 보고 / 데모 구분

| 구분 | 어디서 | 화면 표시 | 동작 |
|---|---|---|---|
| 실제 연결(관리형/관찰형) | 서버 provider 만 (미검증) | `Runner 직접 관찰` / `AI 자체 보고` / `서버 기록` 근거 라벨 + heartbeat 나이 | 직접 관찰 + 신선도 healthy 일 때만 반복 동작 |
| 수동 보고(외부 작업) | 로컬·서버 모두 | `외부 작업 · 직접 보고` + 보고 시각, 연결 상태 "해당 없음" | 항상 정지. heartbeat 로 승격되지 않음(시험 AT-11/AT-11b) |
| 데모 | 명시적 "데모 켜기" | 모든 화면 상단 보라색 배지 + 데모 끄기 | 메모리 전용. live 저장소에 섞이면 거부 |

로컬 모드에서 관리형/관찰형 팀원 등록은 막혀 있다("연결 시험을 통과한 서버 모드에서만"). 이름이 GPT/Claude 라는 이유로 계정·실행 능력을 연결했다고 표시하지 않는다.

## 4. 화면 캡처 (`docs/test-results/screenshots/`)

| 파일 | 내용 |
|---|---|
| `demo-room-1366.png`, `demo-room-1920.png` | 데스크톱 픽셀 사무실(데모) |
| `demo-room-1366-drawer.png` | 자리 클릭 → 상세 드로어, 선택 테두리 |
| `demo-room-mobile-390.png`, `demo-room-mobile-390-drawer.png` | 모바일 390×844, 하단 시트 |
| `demo-dashboard-1366.png` | 같은 데이터의 대시보드 |
| `demo-room-filter-milal.png` | 프로젝트 필터: 다른 프로젝트 작업 흐림(대기 아님) |
| `demo-room-connection-delayed.png`, `demo-room-connection-lost.png` | 45초 지연 / 90초 끊김 (실행 상태는 running 유지) |
| `demo-room-cancel-pending.png` | 중지 요청 → 전달 대기 |
| `at03-room-local-unbound*.png` | 로컬 모드 미연결 자리 5개 + 설정 안내 |
| `at25-room-local-external-work.png` | 로컬 모드: Gemini 만 바인딩, 직접 보고 상태 |
| `at23-asset-failure.png` | 아틀라스 로딩 실패 → 대체 도형 + 안내 |
| `at23-renderer-failure.png` | WebGL/Canvas 생성 실패 → 오류 안내 + 다시 시도 + DOM 목록 |
| `at23-canvas-fallback.png` | WebGL 비활성 브라우저 → Pixi canvas renderer |
| `at24-xss-text.png` | 업무명 HTML 이 텍스트로 표시 |
| `at25-*.png` | 로컬 업무 흐름(팀원 바인딩·직접 보고·결정·승인) |
| `asset-preview.png` | 에셋 검수 미리보기 |

## 5. 시험 명령·결과·환경

환경: Linux 컨테이너, Node v22.23.4, npm 10.9.9, Playwright 1.63.0 + headless Chromium(SwiftShader WebGL), pixi.js 8.21.0 (lockfile 고정), React 19.3, Vite 8.3, vitest 5.0.5. 실행일 2026-10-28.

| 명령 | 결과 |
|---|---|
| `npx tsc -b` | 통과 (오류 0) |
| `npm run build` | 통과. 픽셀 사무실 chunk 는 lazy 분리(≈260 KB raw / 78 KB gzip, Pixi 포함). 아틀라스 24 KB |
| `npm test` (vitest) | **51/51 통과** — handoff `core.test.mjs` 31건 이식 + 투영·명령·store·adapter 20건 |
| `npm run e2e` | **28/28 통과** — `docs/test-results/e2e-results.json`. AT-01~05, 08~15, 18~25 해당 항목 |
| handoff 자체 `npm test` | 31/31 통과 (참고용 starter 검증) |
| StrictMode 개발 서버 이중 mount | canvas 1개, 오류 0 (수동 스크립트) |
| 미실행 | AT-26 실제 환경, 사용자 PC/Whale, DPR 2 실기기(headless 에서는 DPR 1 만 측정), 실제 서버 API |

e2e 가 확인한 핵심: 대시보드와 자리 드로어가 같은 task ID(`DEMO-CBSR-001`)를 가리킴(AT-08) · Runner 확인 실행만 프레임이 바뀌고 외부 보고는 정지(AT-10) · 45/90초 경계(AT-15) · 20회 진입·이탈 생성=파괴=20, canvas 0→1(AT-22) · 승인석 배지=1, 클릭 시 승인함(AT-13) · 결과 제출은 승인 대기, done 은 승인으로만(AT-12/25).

## 6. 기존 대시보드·지시·승인 회귀

로컬 모드에서 전 흐름을 브라우저로 돌렸다(AT-25): 프로젝트 등록 → 팀원(외부) 등록 → 자리 바인딩(중복 불가) → 픽셀 사무실에서 "이 담당에게 새 지시"(프로젝트·담당만 채움, 저장은 `ready`, run 0건) → 직접 보고(working) → 결과 제출 → 작업 `awaiting_owner` + 승인 요청 1건 → 승인함에서 승인 → `done`. 페이지 오류 0. `mark_task_status done` 은 명령 수준에서 거부된다(단위 시험).

## 7. 검토할 쟁점 (사용자 결정 필요)

1. **GitHub 푸시**: `CBAO` 빈 저장소를 만들어 주면 `main` + `feat/pixel-office` 를 올린다. 운영 반영(GitHub Pages 등)은 별도 승인.
2. **백엔드**: 지금은 로컬 모드라 다른 기기와 공유되지 않는다. v1 명세의 서버(인증·권한·Runner 이벤트·승인·idempotency)는 DB(Firestore 등)만으로는 되지 않고 서버 로직이 필요하다. 다음 단계로 ① 서버 API 설계 확정 ② PC 에이전트(Runner) ③ 실제 관리형 run 1건 검수(PX-09) 순서를 제안한다.
3. **Gemini/NotebookLM 자리**: 소유자 결정(2026-10-28)으로 두 팀원을 **별도 외부 작업 팀원**(`m-gemini`, `m-notebooklm`)으로 로컬 workspace 초기값에 등록하고 각 자리에 연결했다. 이미 저장된 로컬 데이터에는 적용되지 않으며, 설정 → 팀원·자리에서 바꿀 수 있다. 캡처 `local-initial-members.png`.
4. **에셋 완성도**: 코드로 그린 1차 제작본이다. 정식 도트 아티스트 에셋으로 교체하려면 같은 프레임명·anchor 로 아틀라스만 바꾸면 된다.
5. **데모 진입 방식**: 지금은 설정 → 연결에서 "데모 켜기"(세션 한정). URL 로 데모를 여는 기능은 live 혼입 위험 때문에 넣지 않았다.


## 2026-10-28 (저녁) — 프로젝트별 가지 흐름 · Runner 0.7.0
**문제 (CBSR 대화에서 발견):** Runner 가 Claude 에 허용한 명령이 `git status/diff/log`·테스트 명령뿐이라 `git show`·`git ls-tree`·`node` 가 전부 '승인 대기'로 막혔고, 작업 폴더는 main(빌드 결과물)이라 CBSR 규칙(원본은 source 가지)과 어긋났다. 결과: 원인은 찾았지만 고치지 못함.

**해결:**
- 프로젝트 설정에 작업 가지 / 빌드 명령 / 배포 폴더 → 배포 가지 추가 (`Project.work_branch|build_command|deploy_dir|deploy_branch`, `update_project` 검증).
- Runner: 작업 가지로 clone·checkout·pull, 다른 가지의 올리지 않은 변경은 stash 보관 후 알림. 반영 = 작업 가지 커밋·push → 빌드 → 배포 폴더를 임시 worktree 로 배포 가지에 커밋·push (배포 폴더는 작업 가지 커밋에서 제외). 작업 카드 '올리기' 도 작업 가지 기준.
- Claude 허용 명령 확대 (git 읽기 명령, node/python/npx/pip, ls/cat/head/tail/find). 커밋·push·가지 바꾸기는 여전히 AI 금지, 프롬프트에도 명시 (저장소 CLAUDE.md 가 '커밋하라' 해도 Runner 규칙 우선).
- 대화 화면 반영 버튼이 `source → 빌드 → main` 식으로 흐름을 보여 준다.

**검증:** vitest 51 통과, tsc·build 통과. 모의 저장소(source/main 두 가지, 작은 build_site.py)로 Runner 메서드 직접 실행: main→source 전환, 더러운 main 은 stash, source 커밋에 app/site 제외, 빌드 후 main 에 결과만 커밋, worktree 정리 확인 (실제 연결 아님 · 리눅스 시뮬레이션). 윈도우 실동작은 소유자 PC 에서 확인 필요.

## 2026-10-28 (밤) — V2 대화 중심 업무실 1차
자세한 보고: `docs/V2_REPORT.md`. 요약: 논의/실행/검토 모드, 대화방 전용 worktree·office 가지 체크포인트(명시 파일·보호 파일 제외), 앱 변경 감지(미커밋/새 커밋), 고정 SHA 검토 + JSON 판정 계약, findings 전문·맥락 묶음을 넣은 자동 보완(최대 2회)·재검토, 체크포인트/원격 공유/반영 분리, 메시지 하위 컬렉션 이전, 정책 데이터 단일 출처, workspace UID 고정, 로드맵 읽기 전용 연결. 모의 28/28 · vitest 53 · e2e 31 통과. 소유자 PC 실측은 아직.
