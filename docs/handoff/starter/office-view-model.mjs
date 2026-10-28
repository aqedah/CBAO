/**
 * Read-only visual projection. No network, credentials, timers or workflow writes.
 * Validate incoming snapshots against contracts/office-snapshot.schema.json first.
 * nowMs must be supplied by the app's server-calibrated clock, not an arbitrary animation frame.
 */
export const DELAY_MS = 45_000;
export const OFFLINE_MS = 90_000;
const FUTURE_TOLERANCE_MS = 5_000;
const ACTIVE_RUN = new Set(['starting', 'running', 'waiting_input', 'stopping']);
const LIVE_MODES = new Set(['managed', 'observed']);
const TERMINAL_TASK = new Set(['done', 'cancelled']);
const STYLES = Object.freeze({
  unconfigured: ['미연결', 'still'], unknown: ['상태 확인 필요', 'still'],
  queued: ['배정 대기', 'waiting'], starting: ['실행 시작 확인 중', 'still'],
  working: ['작업 중', 'typing'], testing: ['검사 중', 'typing'],
  reviewing: ['검토·자료 확인 중', 'reading'], ai_reported: ['작업 중 · AI 보고', 'still'],
  server_reported: ['실행 중 · 서버 기록', 'still'], run_finished: ['실행 종료 · 결과 확인 필요', 'still'],
  external_work: ['외부 작업 · 직접 보고', 'still'], external_idle: ['외부 서비스 · 상태 미확인', 'still'],
  awaiting_owner: ['사용자 판단·승인 대기', 'waiting'], waiting_input: ['입력 대기', 'waiting'],
  blocked: ['진행 막힘', 'still'], error: ['실행 실패', 'still'], stopping: ['중지 요청 처리 중', 'still'],
  connection_delayed: ['상태 수신 지연', 'still'],
  connection_lost: ['연결 끊김 · 현재 실행 미확인', 'still'],
  submitted: ['결과 제출 · 검토 대기', 'waiting'], completed: ['업무 완료', 'still'],
  cancelled: ['취소 확인', 'still'], idle: ['대기', 'idle'],
  inconsistent: ['상태 불일치 · 새로 확인 필요', 'still']
});
function ageMs(value, nowMs) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > nowMs + FUTURE_TOLERANCE_MS) return null;
  return Math.max(0, nowMs - parsed);
}
function ageState(value, nowMs) {
  const age = ageMs(value, nowMs);
  if (age === null) return 'unknown';
  if (age >= OFFLINE_MS) return 'offline';
  if (age >= DELAY_MS) return 'delayed';
  return 'healthy';
}
/** Heartbeat freshness is independent of model output and manual reports. */
export function connectionFreshness(member, nowMs, snapshotCapturedAt) {
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
/** Do not call this function to change the authoritative task/run status. */
export function deriveMemberView(member, {
  nowMs, snapshotCapturedAt, reducedMotion = false, hidden = false, motionEnabled = true
}) {
  const task = member.task;
  const run = member.run;
  const connection = connectionFreshness(member, nowMs, snapshotCapturedAt);
  const isLive = LIVE_MODES.has(member.execution_mode);
  const runFreshness = run ? ageState(run.last_confirmed_at, nowMs) : 'unknown';
  let state;
  let note = '';
  const invalid = (run && !task) || (run && !isLive) ||
    (task && TERMINAL_TASK.has(task.status) && run && ACTIVE_RUN.has(run.status));
  if (invalid) {
    state = 'inconsistent';
    note = '서버 snapshot을 다시 조회한다. 임의로 업무 상태를 수정하지 않는다.';
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
    state = {working: 'external_work', submitted: 'submitted', blocked: 'blocked'}[member.external_report?.status] ?? 'external_idle';
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
      ['reviewing', 'researching'].includes(run.phase) ? 'reviewing' : 'working';
  } else state = 'idle';
  const [label, nominalClip] = STYLES[state];
  const workingState = ['working', 'testing', 'reviewing'].includes(state);
  const verifiedWork = workingState && connection === 'healthy' && runFreshness === 'healthy' && run?.evidence_source === 'runner_observed';
  const canAnimate = motionEnabled && !reducedMotion && !hidden && connection !== 'offline' &&
    connection !== 'delayed' && connection !== 'unknown' && nominalClip !== 'still';
  // Non-live reports may use status icons, but never a looping work clip.
  const animate = Boolean(canAnimate && (workingState ? verifiedWork : isLive));
  return Object.freeze({
    memberId: member.member_id, state, label, note, connection,
    taskId: task?.task_id ?? null, runId: run?.run_id ?? null,
    evidence: member.execution_mode === 'external' ? (member.external_report ? 'user_reported' : 'none') : (run?.evidence_source ?? 'none'),
    lastConfirmedAt: member.execution_mode === 'external' ? member.external_report?.reported_at ?? null : run?.last_confirmed_at ?? member.last_heartbeat_at,
    clip: animate ? nominalClip : 'still', nominalClip, animate,
    verifiedWork: Boolean(verifiedWork),
    canRequestCancel: Boolean(isLive && member.capabilities.request_cancel && run &&
      ['starting', 'running', 'waiting_input'].includes(run.status)),
    pendingOwnerCount: member.pending_owner_count
  });
}
/** A view snapshot sequence is NOT a Runner event sequence; reset only on workspace rebind. */
export function acceptSnapshot(current, incoming, {workspaceId, allowDemo = false}) {
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
/** Explicit binding only. A display name does not prove which member is connected. */
export function resolveSeatMember(seat, bindings, snapshot) {
  const id = bindings[seat.member_binding.seed_key] ?? seat.member_binding.member_id;
  return id ? snapshot.members.find(member => member.member_id === id) ?? null : null;
}
