/**
 * Workspace(기존 스토어) → 픽셀 사무실 읽기 모델(OfficeSnapshot) 투영.
 * 별도 업무 DB를 만들지 않는다. 승인·명령·상태 전이는 여기서 일어나지 않는다.
 */
import type {
  ExecutionMode, ConnectionState, OfficeSnapshot, SnapshotMember, Workspace, Task, Run,
} from './types';

const EXEC: ExecutionMode[] = ['managed', 'observed', 'external', 'unconfigured'];
const CONN: ConnectionState[] = ['healthy', 'delayed', 'offline', 'unknown'];
const TASK_STATUS = ['draft', 'ready', 'active', 'review', 'awaiting_owner', 'done', 'needs_changes', 'blocked', 'cancelled'];
const RUN_STATUS = ['queued', 'leased', 'starting', 'running', 'succeeded', 'failed', 'cancelled', 'waiting_input', 'stopping', 'lost'];
const EVIDENCE = ['runner_observed', 'tool_reported', 'server_derived'];
const PHASE = ['implementing', 'testing', 'reviewing', 'researching', 'unknown'];
const EXT_STATUS = ['working', 'submitted', 'blocked'];
const OPEN_TASK = new Set(['ready', 'active', 'review', 'awaiting_owner', 'needs_changes', 'blocked']);
const ACTIVE_RUN = new Set(['queued', 'leased', 'starting', 'running', 'waiting_input', 'stopping']);

/**
 * 대표 작업 선택. 서버의 현재 실행 → 사용자 선택 → 서버 순서상 최신 열린 작업.
 * '최신'은 sequence(서버 순서)이며 브라우저가 문자열 시각을 보고 추측하지 않는다.
 */
export function representativeTask(ws: Workspace, memberId: string, preferredTaskId?: string | null): { task: Task | null; run: Run | null } {
  const memberRuns = ws.runs.filter(r => r.member_id === memberId);
  const activeRun = memberRuns.filter(r => ACTIVE_RUN.has(r.status)).sort((a, b) => b.sequence - a.sequence)[0] ?? null;
  if (activeRun) {
    const task = ws.tasks.find(t => t.task_id === activeRun.task_id) ?? null;
    return { task, run: activeRun };
  }
  const memberTasks = ws.tasks.filter(t => t.assignee_member_id === memberId);
  if (preferredTaskId) {
    const chosen = memberTasks.find(t => t.task_id === preferredTaskId);
    if (chosen) return { task: chosen, run: latestRunFor(memberRuns, chosen.task_id) };
  }
  const open = memberTasks.filter(t => OPEN_TASK.has(t.status)).sort((a, b) => b.sequence - a.sequence)[0] ?? null;
  if (open) return { task: open, run: latestRunFor(memberRuns, open.task_id) };
  // 열린 작업이 없으면 최근 종료 실행이 있는 작업 (결과 확인 필요)을 보여준다.
  const lastRun = memberRuns.sort((a, b) => b.sequence - a.sequence)[0] ?? null;
  if (lastRun && (lastRun.status === 'succeeded' || lastRun.status === 'failed')) {
    const task = ws.tasks.find(t => t.task_id === lastRun.task_id) ?? null;
    if (task && task.status !== 'done' && task.status !== 'cancelled') return { task, run: lastRun };
  }
  return { task: null, run: null };
}

function latestRunFor(runs: Run[], taskId: string): Run | null {
  const r = runs.filter(x => x.task_id === taskId).sort((a, b) => b.sequence - a.sequence)[0];
  if (!r) return null;
  // 종료된 실행은 결과 확인용으로만 유지한다.
  return r.status === 'succeeded' || r.status === 'failed' ? r : (ACTIVE_RUN.has(r.status) ? r : null);
}

export function buildOfficeSnapshot(ws: Workspace, preferred: Record<string, string | null> = {}): OfficeSnapshot {
  const members: SnapshotMember[] = ws.members.map(m => {
    const { task, run } = representativeTask(ws, m.member_id, preferred[m.member_id]);
    const report = task
      ? ws.external_reports.filter(r => r.task_id === task.task_id && r.member_id === m.member_id)
        .sort((a, b) => b.sequence - a.sequence)[0] ?? null
      : null;
    const pending = ws.approvals.filter(a => a.decision === null && a.member_id === m.member_id).length;
    return {
      member_id: m.member_id,
      display_name: m.display_name,
      role_label: m.role_label,
      execution_mode: m.execution_mode,
      connection_state: m.connection_state,
      last_heartbeat_at: m.last_heartbeat_at,
      task: task ? { task_id: task.task_id, project_id: task.project_id, revision: task.revision, status: task.status, title: task.title } : null,
      // 실행은 관리형/관찰형 연결에만 존재한다. 외부 작업 멤버의 run 은 계약상 null.
      run: run && (m.execution_mode === 'managed' || m.execution_mode === 'observed')
        ? { run_id: run.run_id, status: run.status, evidence_source: run.evidence_source, last_confirmed_at: run.last_confirmed_at, phase: run.phase }
        : null,
      external_report: report && m.execution_mode === 'external'
        ? { status: report.status, reported_at: report.reported_at, evidence_source: 'user_reported' }
        : null,
      pending_owner_count: pending,
      capabilities: { request_cancel: m.capabilities.request_cancel },
    };
  });
  return {
    schema_version: '1.1.0',
    is_demo: ws.is_demo,
    workspace_id: ws.workspace_id,
    snapshot_sequence: ws.revision,
    captured_at: ws.captured_at,
    members,
  };
}

/** contracts/office-snapshot.schema.json 의 핵심 제약을 런타임에서 검사한다. */
export function validateSnapshot(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return ['snapshot is not an object'];
  const s = input as Record<string, unknown>;
  if (s.schema_version !== '1.1.0') errors.push('schema_version must be 1.1.0');
  if (typeof s.is_demo !== 'boolean') errors.push('is_demo must be boolean');
  if (typeof s.workspace_id !== 'string' || !s.workspace_id) errors.push('workspace_id required');
  if (!Number.isInteger(s.snapshot_sequence) || (s.snapshot_sequence as number) < 0) errors.push('snapshot_sequence must be integer >= 0');
  if (typeof s.captured_at !== 'string' || !Number.isFinite(Date.parse(s.captured_at))) errors.push('captured_at must be date-time');
  if (!Array.isArray(s.members)) { errors.push('members must be array'); return errors; }
  if (s.members.length > 100) errors.push('members max 100');
  s.members.forEach((m: Record<string, unknown>, i: number) => {
    const p = `members[${i}]`;
    if (typeof m.member_id !== 'string' || !m.member_id) errors.push(`${p}.member_id required`);
    if (typeof m.display_name !== 'string' || !m.display_name) errors.push(`${p}.display_name required`);
    if (typeof m.role_label !== 'string' || !m.role_label) errors.push(`${p}.role_label required`);
    if (!EXEC.includes(m.execution_mode as ExecutionMode)) errors.push(`${p}.execution_mode invalid`);
    if (!CONN.includes(m.connection_state as ConnectionState)) errors.push(`${p}.connection_state invalid`);
    if (m.last_heartbeat_at !== null && typeof m.last_heartbeat_at !== 'string') errors.push(`${p}.last_heartbeat_at invalid`);
    if (m.task !== null) {
      const t = m.task as Record<string, unknown> | undefined;
      if (!t || typeof t !== 'object') errors.push(`${p}.task invalid`);
      else {
        if (!TASK_STATUS.includes(t.status as string)) errors.push(`${p}.task.status invalid`);
        if (typeof t.title !== 'string' || t.title.length > 500) errors.push(`${p}.task.title invalid`);
        if (!Number.isInteger(t.revision) || (t.revision as number) < 1) errors.push(`${p}.task.revision invalid`);
      }
    }
    if (m.run !== null) {
      const r = m.run as Record<string, unknown> | undefined;
      if (!r || typeof r !== 'object') errors.push(`${p}.run invalid`);
      else {
        if (!RUN_STATUS.includes(r.status as string)) errors.push(`${p}.run.status invalid`);
        if (!EVIDENCE.includes(r.evidence_source as string)) errors.push(`${p}.run.evidence_source invalid`);
        if (!PHASE.includes(r.phase as string)) errors.push(`${p}.run.phase invalid`);
        if (typeof r.last_confirmed_at !== 'string') errors.push(`${p}.run.last_confirmed_at invalid`);
      }
    }
    if (m.external_report !== null) {
      const e = m.external_report as Record<string, unknown> | undefined;
      if (!e || typeof e !== 'object') errors.push(`${p}.external_report invalid`);
      else {
        if (!EXT_STATUS.includes(e.status as string)) errors.push(`${p}.external_report.status invalid`);
        if (e.evidence_source !== 'user_reported') errors.push(`${p}.external_report.evidence_source must be user_reported`);
      }
    }
    if (!Number.isInteger(m.pending_owner_count) || (m.pending_owner_count as number) < 0) errors.push(`${p}.pending_owner_count invalid`);
    const c = m.capabilities as Record<string, unknown> | undefined;
    if (!c || typeof c.request_cancel !== 'boolean') errors.push(`${p}.capabilities.request_cancel required`);
  });
  return errors;
}

/** view snapshot sequence 는 Runner 이벤트 sequence 가 아니다. workspace 재바인딩에서만 초기화한다. */
export function acceptSnapshot(
  current: OfficeSnapshot | null,
  incoming: OfficeSnapshot,
  { workspaceId, allowDemo = false }: { workspaceId: string; allowDemo?: boolean },
): OfficeSnapshot {
  if (!incoming || incoming.workspace_id !== workspaceId) throw new Error('Workspace mismatch');
  if (incoming.is_demo && !allowDemo) throw new Error('Demo data is prohibited in live mode');
  if (!Number.isSafeInteger(incoming.snapshot_sequence) || incoming.snapshot_sequence < 0) throw new Error('Invalid snapshot sequence');
  if (!Array.isArray(incoming.members)) throw new Error('Invalid members');
  if (new Set(incoming.members.map(m => m.member_id)).size !== incoming.members.length) throw new Error('Duplicate member ID');
  if (current && current.workspace_id !== workspaceId) throw new Error('Reset view state before switching workspace');
  if (current && current.is_demo !== incoming.is_demo) throw new Error('Reset view state before switching demo/live');
  if (current && incoming.snapshot_sequence <= current.snapshot_sequence) return current;
  return incoming;
}

export interface SeatBindingLike { member_binding: { seed_key: string; member_id: string | null } }

/** 명시적 바인딩만. 표시 이름이 같다고 연결된 멤버로 보지 않는다. */
export function resolveSeatMember<M extends { member_id: string }>(
  seat: SeatBindingLike, bindings: Record<string, string | null | undefined>, members: M[],
): M | null {
  const id = bindings[seat.member_binding.seed_key] ?? seat.member_binding.member_id;
  return id ? members.find(m => m.member_id === id) ?? null : null;
}
