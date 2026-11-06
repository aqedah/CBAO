# CBAO 장부 데이터 구조 — 한 장 요약 (설계서 작성용)

기준: 2026-11-06, 심부름꾼 0.8.1, 웹 `main`. 설계서는 **이 구조 위에 얹는다**. 새 컬렉션·새 서버를 만들지 않는다. 필드를 더할 수는 있고, 뜻을 바꾸거나 지우지 않는다.

## 1. 어디에 무엇이 있나 (Firestore)

```
workspaces/{uid}                      ← 장부 본문 (문서 하나). 웹·심부름꾼이 트랜잭션으로 고친다. revision 단조 증가.
  projects[]   members[]   tasks[]   runs[]   approvals[]   handoffs[]   artifacts[]   external_reports[]   devices[]   ui{}
workspaces/{uid}/threads/{thread_id}  ← 대화방 (작업 카드와 1:1: thread_id === task_id)
workspaces/{uid}/threads/{thread_id}/messages/{message_id}  ← 메시지 원본 (seq 순). 삭제 불가
workspaces/{uid}/threads/{thread_id}/diffs/{sha}            ← 체크포인트별 변경 내용 (심부름꾼만 씀)
```

규칙: 소유자 이메일 1명만 읽기/쓰기. 심부름꾼은 Admin SDK(서비스 계정)로 규칙 없이 접근. 다른 사용자는 없다.

## 2. 장부 본문의 주요 항목

| 항목 | 핵심 필드 | 누가 쓰나 |
|---|---|---|
| Project | `project_id, name, purpose, repo_reference, archived, work_branch, build_command, deploy_dir, deploy_branch, roadmap_path, roadmap{}` | 웹(설정) · roadmap 은 심부름꾼 |
| Member | `member_id, display_name, role_label, execution_mode(managed/observed/external/unconfigured), tool_label, connection_state, last_heartbeat_at, capabilities{request_cancel}` | 심부름꾼이 등록·heartbeat, 웹은 이름·역할·자리 |
| Task (작업 카드) | `task_id, project_id, assignee_member_id, revision, status(draft/ready/active/review/awaiting_owner/done/needs_changes/blocked/cancelled), title, goal, done_criteria, sequence, run_requested_at, publish_requested_at, publish{}` | 웹(지시·상태) · 심부름꾼(active/review/blocked/done) |
| Run (실행) | `run_id, task_id, member_id, status(queued…succeeded/failed/cancelled/waiting_input/lost), evidence_source(runner_observed/tool_reported/server_derived), phase, started_at, cancel_*, observed?, chat?, mode?` | 심부름꾼만 |
| Approval (승인함) | `approval_id, task_id, project_id, member_id, kind(result/judgment/scope), summary, decision(approved/needs_changes/rejected), decided_at` | 웹 (현재는 작업 카드 흐름에서만 생김 — **대화방 판단과 미연결**) |
| Artifact | `artifact_id, task_id, member_id, title, kind(file/link/note), reference, content_hash, submitted_at` | 심부름꾼(로그·체크포인트·반영 커밋 링크) |
| RunnerDevice | `device_id, name, connection_state, tools[], runner_version, workspace_uid, worktrees_root, policy{revision, tools{claude/codex/gemini: discuss[], exec[], enforced_by, capabilities{}}, rules[], protected_paths[]}` | 심부름꾼 heartbeat (10초) |
| ui | `seat_bindings, motion_enabled, sound_enabled, privacy_mode` | 웹 |

`done` 은 소유자 승인(또는 반영)으로만. 실행 종료 ≠ 완료.

## 3. 대화방(thread) 문서

```jsonc
{
  "thread_id": "chat-20261028-…", "project_id": "…", "title": "…", "member_id": "m-claude",   // 현재 대화 상대
  "schema_version": 2, "message_count": 41, "last_message": {"kind","role","text(160자)","at"},
  "status": "idle | queued | running",
  "pending": {"turn_id","member_id","mode": "discuss|chat|review|publish|checkpoint|share","message_id","requested_at","target_sha?","base_sha?","review_id?"},
  "next_messages": [{"message_id","mode","member_id"}],          // 실행 중에 받아 둔 다음 요청
  "sessions": {"claude": "<세션ID>", "codex": "<id>"},             // 이어가기 근거. 심부름꾼이 stream-json 에서 읽음
  "auto_review_member_id": "m-codex|null", "fix_rounds": 0,      // 자동 검토·보완 (최대 2회)
  "needs_owner": {"reason","review_id?","at"} | null,            // 소유자 판단 필요 (대시보드 '내 차례'의 원천)
  "checkpoints": [ {"checkpoint_id":"cp-<sha10>","branch":"office/<id>","base_sha","candidate_sha","changed_paths[]","origin":"office|app","run_id","at","remote_sync_status":"local_only|pushed","note","stat","context_version"} ],
  "reviews": [ {"review_id","reviewer_id","target_sha","base_sha","verdict":"pass|changes_required|needs_human|blocked|error","findings":[{"id","severity","location","claim","evidence","suggested_action","requires_human_judgment","status"}],"checked[]","unverified[]","error","at","run_id","stale":false,"context_version"} ],
  "sync": {"branch","head_sha","dirty_paths[]","checked_at","remote":"unknown|unchecked|synced|ahead|behind|diverged|local_only","worktree":"C:\\CBAO\\worktrees\\…","app_writing?":bool},
  "context": {"version": 7, "decisions":[{"version","kind","text"}], "open_questions[]", "current_goal?", "delivered": {"claude": 5}},   // 세션 밖 사건. delivered 는 도구별 전달 커서
  "working_checkpoint_id", "reviewed_checkpoint_id", "accepted_checkpoint_id",   // 작업 중 / 현재 버전 검토 통과 / 반영됨
  "last_publish": {"status":"pushed|failed|nothing","message","at","commit","deploy_commit","deployed":false}, "publish_count": 1,
  "messages": []   // schema 1 레거시 배열. schema 2 에서는 쓰지 않음(보존만)
}
```

메시지(`messages/{message_id}`): `{message_id, seq, role: owner|member|system, member_id, kind: chat|progress|result|error|review|publish|question|checkpoint, text, at, run_id, mode?, review_id?, verdict?, target_sha?, checkpoint_sha?, capsule?}`.

변경 내용(`diffs/{sha}`): `{sha, base_sha, stat, diff(≤20만자), truncated, at, origin}`.

## 4. 흐름과 누가 쓰는가

| 사건 | 쓰는 쪽 | 바뀌는 것 |
|---|---|---|
| 소유자가 메시지 보냄 | 웹 트랜잭션 | messages 추가, `pending`, `status=queued` (같은 message_id 는 한 번만). 실행 중이면 `next_messages` |
| 턴 시작 | 심부름꾼 | runs 추가, `status=running`, 진행 메시지(5초마다 갱신). 실행 모드면 worktree 보장·`sync` |
| 턴 종료 | 심부름꾼 | 결과 메시지, `sessions`, 체크포인트(+diffs), `sync`, `context.version++`, 검토면 `reviews`, 자동 흐름 다음 `pending` 또는 `needs_owner` |
| 앱(터미널)에서 수정 | 심부름꾼 30초 폴링 | `sync.dirty_paths` / 새 커밋이면 origin=app 체크포인트 + 이전 reviews `stale=true` |
| 체크포인트 저장 / 원격 공유 / 반영 | 웹이 pending(mode) → 심부름꾼 | `checkpoints`, `remote_sync_status`, `last_publish`, `accepted_checkpoint_id`, 작업 카드 `done`, artifacts 링크 |
| 소유자 결정 기록 | 웹 | `context.decisions` 추가, `needs_owner=null` |

'내 차례'(`attentionItems`)는 thread 에서만 계산: `needs_owner`, 마지막 메시지가 question/error, 현재 버전 검토가 changes_required 이고 자동 검토 꺼짐, `sync.dirty_paths` 있음, `last_publish.failed`. 실행 중이면 제외.

## 5. 설계서가 지켜야 할 불변 규칙

1. `thread_id === task_id`. 대화방과 작업 카드는 같은 업무다. 통합 화면은 둘을 합쳐 읽는 **읽기 모델**로 만든다.
2. 검토의 유효성은 `review.target_sha === sync.head_sha && !stale`. 승인·반영도 같은 SHA 를 가리켜야 한다. 다르면 무효.
3. 상태는 서로 다른 네 가지: 체크포인트 저장(local_only) → 원격 공유(pushed) → 반영(last_publish.pushed) → 배포 확인(deployed, 아직 미구현).
4. 쓰기 권한: 체크포인트·검토·sync·runs 는 심부름꾼만 만든다. 웹은 지시·결정·설정만. (규칙으로는 아직 분리 안 됨 — 사용자 1명이라 보류)
5. PC당 쓰기 실행 1개. 자동 보완은 최대 2회. 그 뒤는 사람.
6. AI 는 커밋·push·가지 바꾸기·배포·외부 전송 불가. 정책 데이터(`devices[].policy`)가 단일 출처.

## 6. 프로젝트 여권으로 더할 자리 (P2 후보 — 아직 없음)

Project 에 `principles(text)`, `protected_paths[]`, `test_command`, `done_criteria_default`, `review_tier(low/normal/high)` 를 더하면, 심부름꾼이 지시서 머리말·검토 프롬프트·체크포인트 제외 목록에 자동으로 넣을 수 있다. 지금 고정 보호 목록은 `cbao_v2.POLICY.protected_paths`.

## 7. P0 합격표 (사용자 PC 실측)

| 항목 | 합격 조건 | 확인 위치 |
|---|---|---|
| 실제 실행 | Claude 가 승인 범위 안 파일을 수정 | 대화방 결과 메시지 + `runs[]` |
| 기록 | 체크포인트 SHA·변경 파일이 남음 | 패널 체크포인트, `diffs/{sha}` |
| 독립 검토 | Codex 가 **같은 SHA** 를 검토, JSON 판정 | `reviews[].target_sha` |
| 재수정 | 지적이 수정 담당 입력에 전달됨 | 보완 턴 메시지(`review_id` 포함) |
| 동기화 | 터미널 수정 → "앱에서 수정됨" 감지 | `sync.dirty_paths` |
| 승인 전 반영 없음 | 반영 버튼 전까지 origin 의 작업 가지 변화 없음 | GitHub 커밋 기록 |
| 반영 ≠ 배포 | `last_publish.pushed` 와 사이트 확인을 따로 적음 | 대화방 반영 알림 |
| 복원 | 심부름꾼 재시작 후 대화·체크포인트 그대로 | 장부(재시작 무관) |
