/**
 * 채팅 모드 데이터. Firestore `workspaces/{uid}/threads/{thread_id}` 문서 하나 = 대화방 하나.
 * 대화방은 장부의 Task 와 1:1 (task_id === thread_id, 레거시 매핑). 실행(run)은 턴마다 Runner 가 만든다.
 *
 * schema_version 2 (V2): 메시지 원본은 `threads/{id}/messages/{message_id}` 하위 컬렉션에 하나씩 영속 저장한다.
 * 대화방 문서에는 요약(message_count, last_message)과 작은 상태(체크포인트·검토·동기화·맥락)만 둔다.
 * schema_version 1 (레거시): messages 배열. 읽기만 지원하고, Runner 가 하위 컬렉션으로 옮긴다 (원본 배열은 지우지 않는다).
 */
export type ChatRole = 'owner' | 'member' | 'system';
export type ChatKind = 'chat' | 'progress' | 'result' | 'error' | 'review' | 'publish' | 'question' | 'checkpoint';
/** discuss: 읽기·분석·제안만 (파일 쓰기 없음) · chat: 승인 범위 실행 · review: 고정 버전 읽기 전용 검토 */
export type TurnMode = 'discuss' | 'chat' | 'review' | 'publish' | 'checkpoint' | 'share';

export interface ChatMessage {
  message_id: string;
  seq?: number;
  role: ChatRole;
  member_id: string | null;
  kind: ChatKind;
  text: string;
  at: string;
  run_id?: string | null;
  mode?: string;
  review_id?: string;
  verdict?: ReviewVerdict;
  target_sha?: string;
  checkpoint_sha?: string;
  capsule?: string;
}

export type TurnStatus = 'idle' | 'queued' | 'running';

export interface PendingTurn {
  turn_id: string;
  member_id: string;
  mode: TurnMode;
  message_id: string | null;
  requested_at: string;
  target_sha?: string | null;
  base_sha?: string | null;
  review_id?: string | null;
}

export type ReviewVerdict = 'pass' | 'changes_required' | 'needs_human' | 'blocked' | 'error';
export interface ReviewFinding {
  id: string; severity: string; location: string; claim: string; evidence: string; suggested_action: string;
  requires_human_judgment: boolean; status: 'open' | 'fixed' | 'disputed' | 'needs_human';
}
export interface Review {
  review_id: string; reviewer_id: string; target_sha: string | null; base_sha?: string | null;
  verdict: ReviewVerdict; findings: ReviewFinding[]; checked: string[]; unverified: string[]; error?: string | null;
  at: string; run_id?: string; stale: boolean; context_version?: number;
}
export interface Checkpoint {
  checkpoint_id: string; branch: string; base_sha: string | null; candidate_sha: string; changed_paths: string[];
  origin: 'office' | 'app'; run_id?: string | null; at: string; remote_sync_status: 'local_only' | 'pushed'; note?: string; context_version?: number;
}
export interface SyncState {
  branch: string; head_sha: string | null; dirty_paths: string[]; checked_at: string;
  remote: 'unknown' | 'unchecked' | 'synced' | 'ahead' | 'behind' | 'diverged' | 'local_only'; worktree: string; app_writing?: boolean;
}
export interface ThreadContext {
  version: number;
  decisions: Array<{ version: number; kind: string; text: string }>;
  open_questions?: string[];
  current_goal?: string;
  /** 도구별로 어느 맥락 버전까지 세션에 전달했는가 */
  delivered?: Record<string, number>;
}

export interface Thread {
  thread_id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  schema_version?: number;
  /** 현재 지시 대상 팀원 */
  member_id: string;
  status: TurnStatus;
  pending: PendingTurn | null;
  /** 도구별 이어가기 세션 ID (Claude Code --resume 등). 비밀값 아님 */
  sessions: Record<string, string>;
  /** 레거시(schema 1) 메시지 배열. schema 2 에서는 비어 있거나 옮기기 전 원본. */
  messages: ChatMessage[];
  message_count?: number;
  last_message?: { kind: ChatKind; role: ChatRole; text: string; at: string } | null;
  /** 실행 중에 받아 둔 다음 요청 (CHAT-02) */
  next_messages?: Array<{ message_id: string; mode: TurnMode; member_id?: string }>;
  /** 구현 턴이 끝나면 상대 팀원에게 자동으로 읽기 전용 검토 → 지적이 있으면 수정 → 재검토 (최대 2회) */
  auto_review_member_id: string | null;
  auto_review_done?: boolean;
  auto_fix_done?: boolean;
  fix_rounds?: number;
  needs_owner?: { reason: string; review_id?: string; at: string } | null;
  checkpoints?: Checkpoint[];
  reviews?: Review[];
  sync?: SyncState | null;
  context?: ThreadContext | null;
  working_checkpoint_id?: string | null;
  reviewed_checkpoint_id?: string | null;
  accepted_checkpoint_id?: string | null;
  last_publish: { status: 'pushed' | 'failed' | 'nothing'; message: string; at: string; commit: string | null; deploy_commit?: string | null; deployed?: boolean } | null;
  /** 반영된 커밋 수 (대화방 수명 동안) */
  publish_count: number;
}

/** 화면 한 페이지에 불러오는 메시지 수. 보존 한도가 아니다 (원본은 전부 남는다). */
export const PAGE_MESSAGES = 80;
/** 레거시 배열 한도 (schema 1 전용) */
export const MAX_MESSAGES = 300;
export const MAX_FIX_ROUNDS = 2;

export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  pass: '문제 없음(범위 내)', changes_required: '수정 필요', needs_human: '소유자 판단 필요', blocked: '검토 불가', error: '판정 오류(통과 아님)',
};
export const MODE_LABEL: Record<TurnMode, string> = {
  discuss: '논의', chat: '실행', review: '검토', publish: '반영', checkpoint: '체크포인트 저장', share: '원격 공유',
};

export function newId(prefix: string): string {
  const c = globalThis.crypto;
  const rand = c && typeof c.randomUUID === 'function' ? c.randomUUID().replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 12);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}-${stamp}-${rand}`;
}

/** 검토가 현재 코드 버전에 대한 것인가 (stale 플래그와 SHA 비교 둘 다 본다). */
export function reviewIsCurrent(r: Review, headSha: string | null | undefined): boolean {
  return !r.stale && !!headSha && r.target_sha === headSha;
}
