/**
 * 채팅 모드 데이터. Firestore `workspaces/{uid}/threads/{thread_id}` 문서 하나 = 대화방 하나.
 * 대화방은 장부의 Task 와 1:1 (task_id === thread_id). 실행(run)은 턴마다 Runner 가 만든다.
 * 메시지는 사실만 기록한다: 소유자의 지시, Runner 가 중계한 진행·결과, 반영·검토 결과.
 */
export type ChatRole = 'owner' | 'member' | 'system';
export type ChatKind = 'chat' | 'progress' | 'result' | 'error' | 'review' | 'publish';

export interface ChatMessage {
  message_id: string;
  role: ChatRole;
  member_id: string | null;
  kind: ChatKind;
  text: string;
  at: string;
  run_id?: string | null;
}

export type TurnStatus = 'idle' | 'queued' | 'running';

export interface PendingTurn {
  turn_id: string;
  member_id: string;
  /** 'chat' 일반 지시, 'review' 읽기 전용 교차 검토, 'publish' main 반영 */
  mode: 'chat' | 'review' | 'publish';
  message_id: string | null;
  requested_at: string;
}

export interface Thread {
  thread_id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** 현재 지시 대상 팀원 */
  member_id: string;
  status: TurnStatus;
  pending: PendingTurn | null;
  /** 도구별 이어가기 세션 ID (Claude Code --resume 등). 비밀값 아님 */
  sessions: Record<string, string>;
  messages: ChatMessage[];
  /** 구현 턴이 끝나면 상대 팀원에게 자동으로 읽기 전용 검토 1회 */
  auto_review_member_id: string | null;
  /** 이번 사이클에서 자동 검토가 이미 수행되었는가 (무한 토론 방지) */
  auto_review_done: boolean;
  /** 자동 검토 뒤 자동 수정 1회가 수행되었는가 */
  auto_fix_done?: boolean;
  last_publish: { status: 'pushed' | 'failed' | 'nothing'; message: string; at: string; commit: string | null } | null;
  /** 반영된 커밋 수 (대화방 수명 동안) */
  publish_count: number;
}

export const MAX_MESSAGES = 300;

export function newId(prefix: string): string {
  const c = globalThis.crypto;
  const rand = c && typeof c.randomUUID === 'function' ? c.randomUUID().replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 12);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}-${stamp}-${rand}`;
}
