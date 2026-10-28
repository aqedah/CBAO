/**
 * 읽기 전용 시각 투영. starter/office-view-model.mjs 를 TypeScript로 이식했다.
 * 네트워크·비밀키·타이머·자동 실행·업무 상태 쓰기를 포함하지 않는다.
 * nowMs 는 앱의 서버 보정 시계에서 받는다. animation frame 시각을 넣지 않는다.
 */
import type { SnapshotMember } from './types';

export const DELAY_MS = 45_000;
export const OFFLINE_MS = 90_000;
const FUTURE_TOLERANCE_MS = 5_000;
const ACTIVE_RUN = new Set(['starting', 'running', 'waiting_input', 'stopping']);
const LIVE_MODES = new Set(['managed', 'observed']);
const TERMINAL_TASK = new Set(['done', 'cancelled']);

export type VisualState =
  | 'unconfigured' | 'unknown' | 'queued' | 'starting' | 'working' | 'testing' | 'reviewing'
  | 'ai_reported' | 'server_reported' | 'run_finished' | 'external_work' | 'external_idle'
  | 'awaiting_owner' | 'waiting_input' | 'blocked' | 'error' | 'stopping'
  | 'connection_delayed' | 'connection_lost' | 'submitted' | 'completed' | 'cancelled'
  | 'idle' | 'inconsistent';

export type Clip = 'still' | 'idle' | 'typing' | 'reading' | 'waiting';
export type Freshness = 'healthy' | 'delayed' | 'offline' | 'unknown' | 'not_applicable';
export type ColorToken = 'active' | 'attention' | 'error' | 'muted';

interface StyleEntry { label: string; clip: Clip; color: ColorToken; icon: string }

export const STYLES: Readonly<Record<VisualState, StyleEntry>> = Object.freeze({
  unconfigured: { label: '미연결', clip: 'still', color: 'muted', icon: 'plug' },
  unknown: { label: '상태 확인 필요', clip: 'still', color: 'muted', icon: 'question' },
  queued: { label: '배정 대기', clip: 'waiting', color: 'muted', icon: 'clock' },
  starting: { label: '실행 시작 확인 중', clip: 'still', color: 'muted', icon: 'clock' },
  working: { label: '작업 중', clip: 'typing', color: 'active', icon: 'keyboard' },
  testing: { label: '검사 중', clip: 'typing', color: 'active', icon: 'checklist' },
  reviewing: { label: '검토·자료 확인 중', clip: 'reading', color: 'active', icon: 'book' },
  ai_reported: { label: '작업 중 · AI 보고', clip: 'still', color: 'muted', icon: 'message' },
  server_reported: { label: '실행 중 · 서버 기록', clip: 'still', color: 'muted', icon: 'server' },
  run_finished: { label: '실행 종료 · 결과 확인 필요', clip: 'still', color: 'attention', icon: 'inbox' },
  external_work: { label: '외부 작업 · 직접 보고', clip: 'still', color: 'attention', icon: 'external' },
  external_idle: { label: '외부 서비스 · 상태 미확인', clip: 'still', color: 'muted', icon: 'external' },
  awaiting_owner: { label: '사용자 판단·승인 대기', clip: 'waiting', color: 'attention', icon: 'bell' },
  waiting_input: { label: '입력 대기', clip: 'waiting', color: 'attention', icon: 'question' },
  blocked: { label: '진행 막힘', clip: 'still', color: 'attention', icon: 'warning' },
  error: { label: '실행 실패', clip: 'still', color: 'error', icon: 'warning' },
  stopping: { label: '중지 요청 처리 중', clip: 'still', color: 'attention', icon: 'pause' },
  connection_delayed: { label: '상태 수신 지연', clip: 'still', color: 'muted', icon: 'clock' },
  connection_lost: { label: '연결 끊김 · 현재 실행 미확인', clip: 'still', color: 'muted', icon: 'disconnect' },
  submitted: { label: '결과 제출 · 검토 대기', clip: 'waiting', color: 'attention', icon: 'inbox' },
  completed: { label: '업무 완료', clip: 'still', color: 'active', icon: 'check' },
  cancelled: { label: '취소 확인', clip: 'still', color: 'muted', icon: 'stop' },
  idle: { label: '대기', clip: 'idle', color: 'muted', icon: 'chair' },
  inconsistent: { label: '상태 불일치 · 새로 확인 필요', clip: 'still', color: 'error', icon: 'warning' },
});

function ageMs(value: string | null | undefined, nowMs: number): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > nowMs + FUTURE_TOLERANCE_MS) return null;
  return Math.max(0, nowMs - parsed);
}
function ageState(value: string | null | undefined, nowMs: number): 'unknown' | 'offline' | 'delayed' | 'healthy' {
  const age = ageMs(value, nowMs);
  if (age === null) return 'unknown';
  if (age >= OFFLINE_MS) return 'offline';
  if (age >= DELAY_MS) return 'delayed';
  return 'healthy';
}

/** Heartbeat 신선도는 모델 출력·수동 보고와 독립이다. */
export function connectionFreshness(member: SnapshotMember, nowMs: number, snapshotCapturedAt: string): Freshness {
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  if (member.execution_mode === 'external') return 'not_applicable';
  if (member.execution_mode === 'unconfigured') return 'unknown';
  if (member.connection_state === 'offline') return 'offline';
  if (member.connection_state === 'unknown') return 'unknown';
  const hb = ageState(member.last_heartbeat_at, nowMs);
  const feed = ageState(snapshotCapturedAt, nowMs);
  if (hb === 'unknown' || feed === 'unknown') return 'unknown';
  if (hb === 'offline' || feed === 'offline') return 'offline';
  if (hb === 'delayed' || feed === 'delayed' || member.connection_state === 'delayed') return 'delayed';
  return 'healthy';
}

export interface DeriveOptions {
  nowMs: number;
  snapshotCapturedAt: string;
  reducedMotion?: boolean;
  hidden?: boolean;
  motionEnabled?: boolean;
}

export interface MemberView {
  memberId: string;
  state: VisualState;
  label: string;
  note: string;
  connection: Freshness;
  taskId: string | null;
  runId: string | null;
  evidence: 'runner_observed' | 'tool_reported' | 'server_derived' | 'user_reported' | 'none';
  lastConfirmedAt: string | null;
  clip: Clip;
  nominalClip: Clip;
  animate: boolean;
  verifiedWork: boolean;
  canRequestCancel: boolean;
  pendingOwnerCount: number;
  color: ColorToken;
  icon: string;
}

/** 이 함수로 task/run 의 권한 있는 상태를 바꾸지 않는다. */
export function deriveMemberView(member: SnapshotMember, {
  nowMs, snapshotCapturedAt, reducedMotion = false, hidden = false, motionEnabled = true,
}: DeriveOptions): MemberView {
  const task = member.task;
  const run = member.run;
  const connection = connectionFreshness(member, nowMs, snapshotCapturedAt);
  const isLive = LIVE_MODES.has(member.execution_mode);
  const runFreshness = run ? ageState(run.last_confirmed_at, nowMs) : 'unknown';
  let state: VisualState;
  let note = '';
  const invalid = (run && !task) || (run && !isLive) ||
    (task && TERMINAL_TASK.has(task.status) && run && ACTIVE_RUN.has(run.status));
  if (invalid) {
    state = 'inconsistent';
    note = '서버 snapshot을 다시 조회합니다. 임의로 업무 상태를 수정하지 않습니다.';
  } else if (task?.status === 'done') state = 'completed';
  else if (task?.status === 'cancelled') state = 'cancelled';
  else if (run?.status === 'stopping') {
    state = 'stopping';
    note = connection === 'healthy' ? '종료 확인 전입니다.' : '중지 전달·종료 여부를 확인할 수 없습니다.';
  } else if (task?.status === 'blocked') state = 'blocked';
  else if (task?.status === 'awaiting_owner') state = 'awaiting_owner';
  else if (run?.status === 'failed') state = 'error';
  else if (run?.status === 'waiting_input') state = 'waiting_input';
  else if (run?.status === 'succeeded') state = 'run_finished';
  else if (run?.status === 'cancelled') { state = 'cancelled'; note = '현재 실행 취소. 업무 전체의 완료·취소와 구분합니다.'; }
  else if (run?.status === 'lost') state = 'connection_lost';
  else if (member.execution_mode === 'unconfigured') state = 'unconfigured';
  else if (member.execution_mode === 'external') {
    const map: Record<string, VisualState> = { working: 'external_work', submitted: 'submitted', blocked: 'blocked' };
    state = (member.external_report && map[member.external_report.status]) || 'external_idle';
    note = member.external_report ? `직접 보고: ${member.external_report.reported_at}` : '외부 웹의 현재 상태를 자동 관찰하지 않습니다.';
  } else if (run?.status === 'queued' || run?.status === 'leased') state = 'queued';
  else if (run && ACTIVE_RUN.has(run.status)) {
    if (connection === 'offline') state = 'connection_lost';
    else if (connection === 'delayed') state = 'connection_delayed';
    else if (connection === 'unknown') state = 'unknown';
    else if (runFreshness !== 'healthy') {
      state = 'unknown'; note = 'PC는 연결되어 있지만 현재 실행의 생존 확인이 오래되었습니다.';
    } else if (run.status === 'starting') state = 'starting';
    else if (run.evidence_source === 'tool_reported') state = 'ai_reported';
    else if (run.evidence_source === 'server_derived') state = 'server_reported';
    else state = run.phase === 'testing' ? 'testing' :
      (run.phase === 'reviewing' || run.phase === 'researching') ? 'reviewing' : 'working';
  } else state = 'idle';

  const style = STYLES[state];
  const workingState = state === 'working' || state === 'testing' || state === 'reviewing';
  const verifiedWork = workingState && connection === 'healthy' && runFreshness === 'healthy' && run?.evidence_source === 'runner_observed';
  const canAnimate = motionEnabled && !reducedMotion && !hidden && connection !== 'offline' &&
    connection !== 'delayed' && connection !== 'unknown' && style.clip !== 'still';
  // 직접 관찰되지 않은 보고는 상태 아이콘만 쓰고 반복 작업 동작을 쓰지 않는다.
  const animate = Boolean(canAnimate && (workingState ? verifiedWork : isLive));
  return Object.freeze({
    memberId: member.member_id, state, label: style.label, note, connection,
    taskId: task?.task_id ?? null, runId: run?.run_id ?? null,
    evidence: member.execution_mode === 'external'
      ? (member.external_report ? 'user_reported' : 'none')
      : (run?.evidence_source ?? 'none'),
    lastConfirmedAt: member.execution_mode === 'external'
      ? member.external_report?.reported_at ?? null
      : run?.last_confirmed_at ?? member.last_heartbeat_at,
    clip: animate ? style.clip : 'still', nominalClip: style.clip, animate,
    verifiedWork: Boolean(verifiedWork),
    canRequestCancel: Boolean(isLive && member.capabilities.request_cancel && run &&
      (run.status === 'starting' || run.status === 'running' || run.status === 'waiting_input')),
    pendingOwnerCount: member.pending_owner_count,
    color: style.color, icon: style.icon,
  });
}
