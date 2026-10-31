# CBAO V2 — 대화 중심 업무실 1차 구현 보고

- 기준 커밋: `a26da1b` (설계 묶음이 검토한 커밋) → 착수 시 HEAD `41f115b` (그 사이 2 커밋: 프로젝트별 가지 흐름·Runner 0.7.0). 설계 묶음과 HEAD 의 차이는 `work_branch/build_command/deploy_dir/deploy_branch` 가 이미 있다는 점이며, V2 는 그 위에 얹었다.
- 완료 커밋: 이 문서와 함께 올라간 커밋 (git log 의 "V2 1차").
- 설계: GPT (`CBAO_V2_UX_DESIGN.zip`). 구현·시험: Claude. 검수: 사용자.
- 유지한 것: 대시보드(`#/office`), 픽셀 사무실(`#/office/room`), Firebase 장부·규칙, Python Runner, GitHub Pages. 새 서버·Supabase 없음.

## 1. 첫 검수 목표에 대한 상태

목표: **오피스에서 대화하고 수정한 뒤 앱에서 이어가고, 앱의 변경을 오피스가 다시 받아 같은 기준으로 검토한다.**

| 단계 | 구현 | 근거(시험) | 상태 |
|---|---|---|---|
| 1. 논의 모드 (파일 쓰기 없음) | Claude `--allowedTools` 를 읽기 도구만으로, Codex `--sandbox read-only`. 프롬프트가 아니라 도구 허용 목록으로 강제 | 모의 CHAT-01 ×2 | **실제 연결** (Claude·Codex) · Gemini 는 미검증 표시 |
| 2. 실행 모드 → 체크포인트 | 대화방 전용 worktree `C:\CBAO\worktrees\<프로젝트>\<대화방>` + 가지 `office/<대화방>`. 끝나면 바뀐 파일을 **명시 목록**으로 커밋(`git add -A` 없음), 보호 파일(.env·serviceAccount.json·*.pem…) 제외. base/candidate SHA·파일 목록 기록 | 모의 SYNC-01, SYNC-09, 보호 파일 | **실제 연결** |
| 3. 앱에서 이어하기 | 대화방 오른쪽 패널에 `cd <worktree>` + `claude --resume <세션>` / `codex resume <id>` 복사, '맥락 묶음 복사'. 세션 ID 는 Runner 가 stream-json 에서 읽어 저장한 값 | 모의 "세션 ID 저장" | **세션 이어가기: 실제 연결**(같은 PC·같은 계정). 앱을 자동으로 여는 기능은 없음(명령 복사 = 맥락 인계) |
| 4. 앱 → 오피스 감지 | Runner 가 30초마다 대화방 worktree 의 HEAD·dirty 를 확인. 미커밋 → "앱에서 수정됨 · 아직 커밋 안 됨"(pull/reset 안 함). 새 커밋 → origin `app` 체크포인트, 이전 검토 stale, 맥락 버전 올림. 터미널 Claude 세션이 열려 있으면(훅 관찰) 그 폴더에서 실행 턴 시작 안 함 | 모의 SYNC-03, SYNC-04 | **실제 연결** (git 상태 기준). 외부 편집기까지 잠그지는 않음 |
| 5. 고정 버전 검토 | 검토자는 `git worktree add --detach <target_sha>` 사본에서 읽기 전용 실행. 결과 끝의 ```json 블록(`review_id`·`target_sha`·`verdict`·`findings`)만 판정으로 인정. 없거나 SHA 불일치 → `error`(통과 아님) | 모의 REVIEW-02/03/05, SHA 불일치 | **실제 연결** |
| 6. 지적 전달 → 보완 → 재검토 | 자동 수정 턴 입력에 `review_id`·`target_sha`·findings JSON 전문 포함. 세션 재개 시 '사무실 맥락 묶음'(세션 밖 체크포인트·검토·소유자 결정, 전달 커서 이후분만) 주입. 새 체크포인트가 생기면 자동 재검토. 보완 최대 2회, 그 뒤 `needs_owner` | 모의 REVIEW-01/04, 재검토 pass, 맥락 주입 | **실제 연결** |
| 7. 사람 판단 | `needs_human/blocked/error/한도 초과` 는 대화방에 '소유자 판단 필요' 카드. '결정 기록'이 맥락 버전에 들어가 다음 세션에 전달 | 모의 REVIEW-05 → needs_owner | **실제 연결** (승인함 카드로의 복제는 아직 없음) |
| 8. 반영 | 체크포인트 저장 / 원격 공유(office 가지 push) / 반영(작업 가지 merge → push → 빌드 → 배포 가지) 를 분리. `deployed=false` 로 push≠배포 명시 | 모의 SYNC-05, 반영 | **실제 연결** · 실제 배포 확인(사이트 응답)은 미구현 |
| 로드맵 | 프로젝트에 `roadmap_path` 를 적으면 Runner 가 HEAD 의 파일을 읽어 제목/체크 항목으로 구조화(읽기 전용, blob SHA·commit 기록). 못 읽으면 원문만 | 모의 ROADMAP-01/02, e2e V2-ROADMAP-UI | **실제 연결(읽기)**. 편집·JSON 전환·이슈 연결 없음 |

**실제 사용자 PC 에서의 실행은 아직 하지 않았다.** 위 '실제 연결'은 코드 경로가 가짜 CLI·임시 git 저장소로 끝까지 돌았다는 뜻이다. 윈도우 경로·실제 Claude Code 2.1.x 의 `--resume`·Firestore 규칙은 소유자 PC 에서 확인해야 한다 (아래 7).

## 2. 변경 파일

- Runner: `runner/runner.py` (0.8.0, 대화 부분 재작성), **새 파일 `runner/cbao_v2.py`**(정책 데이터·worktree·체크포인트·검토 계약·맥락 묶음·로드맵 파서), `runner/tests/test_v2_flow.py`, `runner/tests/fake_claude.py`, `runner/README.md`, `runner/config.json`(`workspace_uid`).
- 웹: `src/domain/chat.ts`(schema 2 계약), `src/store/threadStore.ts`(messages 하위 컬렉션·페이지네이션·next_messages·idempotent 큐), `src/features/chat/ChatPage.tsx`(전면 개편), `src/features/chat/Markdown.tsx`, `src/features/settings/PoliciesPage.tsx`(Runner 정책 데이터 표시), `src/features/projects/ProjectDetailPage.tsx`(새 라우트 `#/projects/:id`), `src/features/projects/ProjectsPage.tsx`(roadmap_path), `src/features/dashboard/DashboardPage.tsx`(이어서 하기·로드맵 요약), `src/domain/types.ts`, `src/store/commands.ts`, `src/shared/AuthGate.tsx`(장부 UID 표시), `src/App.tsx`, `src/index.css`, `src/firebase/firestore.rules`(messages 하위 컬렉션).
- 의존성 추가: `marked`, `dompurify` (Markdown 표시·살균).

## 3. 설계 지시서의 '반드시 먼저 수정할 연결 문제' 처리

| 지시 | 처리 |
|---|---|
| 메시지 배열 잘라내기를 보존 정책으로 쓰지 말 것 | schema 2: `threads/{id}/messages/{message_id}` 하나씩 영속. 대화방 문서엔 `message_count`·`last_message` 만. 화면은 80개씩 페이지네이션. Runner 시작 시 schema 1 대화방을 옮기고 **원본 배열은 지우지 않음**(message_id 를 문서 ID 로 써서 재실행해도 중복 없음). Runner 결과 저장 한도 4000→40000자(진행 중계는 별도) |
| resume 때 세션 밖 사건을 명시 주입 | `context.version` 과 도구별 `delivered` 커서. 재개 프롬프트 = 맥락 묶음(새 체크포인트·검토 findings·소유자 결정) + 지시. 실행 성공 후 커서 갱신 |
| "문제 없음" 문자열 판정 금지 | `cbao_v2.parse_review`: 마지막 ```json 블록만, verdict 열거값·target_sha·review_id 검증. 시험에서 "문제 없음이라고 볼 수 없다" 문장 + JSON changes_required → changes_required 로 판정 |
| 저장/원격 공유/main 반영/배포 구분 | 버튼 3개(체크포인트 저장·원격 공유·반영)와 `remote_sync_status`·`last_publish.deployed=false`. 체크포인트 저장 없이는 반영 불가 |
| 정책 문구 = 실제 동작 | `cbao_v2.POLICY` 하나에서 `--allowedTools` 와 heartbeat `policy` 를 만들고, 정책 화면·대화방 하단 문구는 그 데이터를 표시. Runner 미연결이면 '미확인' |
| 검토는 고정 체크포인트, 수정 뒤 이전 승인 무효 | detached worktree 사본 + `stale` + `reviewed_checkpoint_id` 초기화 |
| workspace UID 고정 (A07/OPS-03) | `config.json.workspace_uid`. 비어 있고 장부가 둘 이상이면 시작 거부. 웹 '연결'에 UID 표시 |

## 4. 실제 실행한 시험과 결과

| 시험 | 방법 | 결과 |
|---|---|---|
| Runner 수직 흐름 (28개) | `python runner/tests/test_v2_flow.py` — 가짜 Claude CLI(stream-json)·임시 bare 저장소(source/main)·메모리 장부. 리눅스 | **28/28 통과** (`docs/test-results/runner-v2-flow.json`) |
| 웹 단위 | `npx vitest run` | 53/53 통과 (V2 규칙 2개 추가) |
| 웹 E2E (로컬 모드, Playwright) | `node tools/e2e/run.mjs` | 31/31 통과 (V2 UI 3개 추가: 프로젝트 개요·정책 미확인·대화 Firebase 전용) · 캡처 `docs/test-results/screenshots/v2-*.png` |
| 타입·빌드 | `tsc -b`, `vite build` | 통과 |

**하지 않은 것**: 소유자 Firebase·PC 에서의 실행, Firestore 규칙 게시, 실제 Claude Code/Codex 세션 재개, 윈도우 경로·CRLF, 대화방 화면 캡처(Firebase 로그인 필요 — 로컬 모드에서는 열리지 않음).

## 5. 인수 시험 ID 별 상태 (설계 묶음 45개)

- 모의 통과: CHAT-01, CHAT-02(다음 요청 큐), CHAT-06(client_message_id 중복 거부 — 웹 트랜잭션), SYNC-01, SYNC-03, SYNC-04, SYNC-05, SYNC-09, SYNC-10(살아 있는 터미널 세션이면 시작 안 함), REVIEW-01~05, REVIEW-07(한도), ROADMAP-01/02/04(UI 규칙), OPS-03(UID 고정), POLICY-06(자료는 권한이 아님 — 프롬프트 규칙 + 허용 목록).
- 구현했으나 실제 환경 확인 필요: CHAT-03(IME), CHAT-04(Markdown·방향성), CHAT-05(새 응답 N개), CHAT-07, CHAT-08(하위 컬렉션 이전), SYNC-02(실제 `--resume`), SYNC-07(fetch 실패 → unknown), OPS-01/02(이전 재실행), OPS-04(push≠배포 표시).
- 미구현: SYNC-06(분기 조정 경로 — 충돌 시 멈추고 메시지만), SYNC-08(재개 실패 시 자동 맥락 재구성 — 세션 ID 를 지우고 다음 턴에 새 세션으로 시작), REVIEW-06(MILAL 보호선 — 보호 경로 목록만, 정본 규칙 미등록), REVIEW-08(GPT API 어댑터 없음 — 대화 상대 목록에서 제외하고 '외부 작업'으로 표시), POLICY-01~05/07(범위 기반 권한 기억·회수 UI — 현재는 고정 정책 데이터), ROADMAP-03(원본 변경은 5분 주기 blob 비교로만), ROADMAP-05/06, OPS-05(완료 이벤트 재전달 — PC당 1개 실행 구조로 간접 방지), OPS-06.

## 6. 데이터 이전·롤백

- 이전: Runner 0.8.0 시작 시 `status=idle` 인 schema 1 대화방의 `messages[]` 를 `messages/{message_id}` 로 복사하고 `schema_version=2`, `legacy_message_count` 기록. 배열은 그대로 둔다. 웹은 schema 1 이면 배열을, 2 이면 하위 컬렉션을 읽는다. 두 곳에 동시에 쓰지 않는다 (schema 로 분기).
- 롤백: 웹을 이전 커밋으로 되돌리면 배열(schema 1 시점까지의 내용)을 다시 읽는다. 하위 컬렉션은 지우지 않아도 무해하다. schema 2 이후 새로 쌓인 메시지는 배열에 없으므로, 롤백 전에 하위 컬렉션을 보관해야 한다. 새 기록을 지운 뒤 배열로 덮는 롤백은 하지 않는다.
- Firestore 규칙에 `threads/{id}/messages` 허용을 추가해야 웹이 메시지를 읽고 쓴다. Runner(Admin SDK)는 규칙과 무관하다.

## 7. 소유자가 할 일 (순서)

1. Firebase 콘솔 → Firestore → 규칙에 `src/firebase/firestore.rules` 를 붙여 넣고 게시 (messages 하위 컬렉션).
2. `C:\CBAO\runner\` 에 새 `runner.py`·`cbao_v2.py`·`README.md` 가 들어갔는지 확인하고, `config.json` 에 `"workspace_uid": "<연결 화면의 장부 UID>"` 를 적은 뒤 `start.bat` 재시작. 시작 로그에 "대화방 N개의 메시지를 하위 컬렉션으로 옮겼습니다" 와 "장부 연결: workspaces/<UID>" 가 보여야 한다.
3. 웹 새로고침 → 대화 → CBSR 대화방을 열어 '논의'로 한 번, '승인 범위 실행'으로 한 번 보내고, 오른쪽 패널에 체크포인트·현재 버전이 생기는지 확인.
4. 터미널에서 패널의 `cd … && claude --resume …` 를 붙여 넣어 이어가고, 파일을 하나 고친 뒤 대화방에 "앱에서 수정됨 · 아직 커밋 안 됨" 이 뜨는지 확인. (커밋까지 하면 '앱에서 저장한 새 버전'.)
5. 자동 검토를 Codex 로 켜고 실행 한 번 → 검토 카드의 판정이 JSON 기준으로 나오는지 확인.

## 8. 알려진 제약

- GPT 는 API 어댑터가 없어 대화 상대가 아니다 (설계의 V2-E 범위). 화면에서도 상대 목록에 없다.
- 실행 중 끼어들기(steering)는 Claude/Codex 비대화형 실행에서 미지원 → '다음 요청으로 저장'만.
- 응답은 토큰 단위 스트리밍이 아니라 5초 간격 진행 요약 중계다. 완료 시 결과 원문(최대 4만 자)을 저장한다.
- 보호 경로는 고정 목록이며 프로젝트별 정본(MILAL) 보호선은 아직 등록되지 않았다.
- 픽셀 사무실은 대화방의 run 을 그대로 투영한다(모드 표시 없음). 게시판 로드맵 연결은 아직 없다.


## 9. 2026-10-31 추가 — 다른 "AI 사무실" 제품을 참고한 UX 보강

참고한 것 (공개 자료 기준):
- [Pixel Agents](https://github.com/pablodelucca/pixel-agents): 캐릭터 하나 = 세션 하나, 입력 대기·권한 요청을 말풍선으로, 훅 기반 상태. (우리와 같은 방식. 오케스트레이션·작업판은 그쪽도 '아직'.)
- [Roundtable 픽셀 사무실 글](https://baeseokjae.github.io/posts/roundtable-pixel-office-replay/): 고정 자리, 어깨 너머로 터미널 보기, 실패는 붉게.
- [Conductor](https://thenewstack.io/a-hands-on-review-of-conductor-an-ai-parallel-runner-app/) / [conductor.build](https://www.conductor.build/workflows/run-parallel-claude-codes): 작업마다 worktree·가지, diff 뷰어에서 검토한 뒤 합치기. 비판: 작업·가지 이름 관계가 헷갈림.
- [OpenAI Codex 앱 가이드](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/): "스레드 = 작업 공간(worktree)", 여러 스레드를 돌려 두고 나중에 돌아와 검토, 인라인 diff·PR 패널, 범위 밖 동작은 묻기.
- [Pixcode](https://feedbagel.com/post/pixcode), [Agent Office/AI Studio 논의](https://community.openai.com/t/agent-office-ai-studio-the-next-interface-after-chat/1381771): 여러 CLI 를 한 웹에서, "채팅 다음 인터페이스는 사무실".

반영한 것 (모두 장부 상태에서만 계산, 꾸밈 없음):
1. **내 차례(attention) 받은편지함** — 대시보드 맨 위 카드 + 메뉴 '대화' 배지 + 탭 제목 `(N)`. 항목: 소유자 판단 필요, AI 질문, 자동 검토 꺼진 상태의 수정 필요 지적, 앱에서 고치고 커밋 안 함, 반영 실패, 오류. 실행 중인 방은 '내 차례'가 아니다. (Codex 앱의 "돌려 두고 돌아와서 검토")
2. **변경 보기(diff)** — 체크포인트마다 Runner 가 `threads/{id}/diffs/{sha}` 에 diff 를 저장(20만 자 한도), 대화방 패널 '변경 보기'로 +/− 색 표시. 반영 전에 눈으로 확인 가능. (Conductor/Codex 의 diff 뷰어)
3. **브라우저 알림** — 정책 화면에서 켜면, 다른 탭을 보는 동안 새 '내 차례'가 생길 때 알림. 이미 보고 있는 탭에는 띄우지 않음. (Pixel Agents 의 완료/권한 chime 과 같은 역할, 소리 대신 알림)
4. **픽셀 사무실 말풍선** — 실행 중인 팀원 머리 위에 마지막 진행 한 줄(💬), 나를 기다리면 ✋ 질문, 실패는 ⚠. (Pixel Agents·Roundtable)
5. **대화방 제목 바꾸기(✎)** — 제목과 가지 이름(office/…)을 분리해 두고, 바꿔도 가지는 그대로임을 명시. (Conductor 비판 반영)

시험: vitest 58 (attention·말풍선 규칙 5개 추가), e2e 31, Runner 모의 29/29 (diff 문서 저장 추가). Runner 0.8.1.
