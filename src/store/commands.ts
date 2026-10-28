/**
 * 명령 정의와 로컬 적용 규칙.
 * 서버(HTTP) 모드에서는 같은 명령을 기존 서버 API로 전달하고 서버가 검증한다.
 * 로컬/데모 모드에서는 이 reducer 가 적용한다. 자동 실행·자동 승인·자동 배포는 없다.
 */
import type {
  Workspace, Task, ExternalReport, Approval, ApprovalDecision, ExternalReportStatus,
  Member, ExecutionMode, Project, UiSettings,
} from '../domain/types';

export type Command =
  | { type: 'create_task'; project_id: string; assignee_member_id: string | null; title: string; goal: string; done_criteria: string; idempotency_key: string }
  | { type: 'submit_external_report'; task_id: string; member_id: string; status: ExternalReportStatus; note: string; link: string | null; idempotency_key: string }
  | { type: 'decide_approval'; approval_id: string; decision: ApprovalDecision; expected_revision: number; idempotency_key: string }
  | { type: 'request_cancel'; run_id: string; idempotency_key: string }
  | { type: 'accept_handoff'; handoff_id: string; idempotency_key: string }
  | { type: 'register_member'; display_name: string; role_label: string; execution_mode: ExecutionMode; tool_label: string; idempotency_key: string }
  | { type: 'update_member'; member_id: string; patch: Partial<Pick<Member, 'display_name' | 'role_label' | 'execution_mode' | 'tool_label'>> }
  | { type: 'register_project'; name: string; purpose: string; repo_reference: string | null; idempotency_key: string }
  | { type: 'update_project'; project_id: string; patch: Partial<Pick<Project, 'name' | 'purpose' | 'repo_reference' | 'archived'>> }
  | { type: 'update_ui'; patch: Partial<UiSettings> }
  | { type: 'mark_task_status'; task_id: string; status: Task['status']; expected_revision: number }
  | { type: 'request_run'; task_id: string; expected_revision: number; idempotency_key: string }
  | { type: 'demo_refresh' };

export class CommandError extends Error {
  readonly code: 'not_supported' | 'not_found' | 'conflict' | 'forbidden' | 'invalid';
  constructor(message: string, code: 'not_supported' | 'not_found' | 'conflict' | 'forbidden' | 'invalid') {
    super(message);
    this.name = 'CommandError';
    this.code = code;
  }
}

const SAFE_HTTPS = /^https:\/\/[^\s]+$/i;

function nextSeq(ws: Workspace): number {
  const all = [...ws.tasks, ...ws.runs, ...ws.external_reports, ...ws.approvals, ...ws.handoffs].map(x => x.sequence);
  return (all.length ? Math.max(...all) : 0) + 1;
}

function slug(prefix: string, ws: Workspace, count: number): string {
  return `${prefix}-${String(count + 1).padStart(3, '0')}-${ws.revision + 1}`;
}

function bump(ws: Workspace, nowIso: string): Workspace {
  return { ...ws, revision: ws.revision + 1, captured_at: nowIso };
}

function hasKey(ws: Workspace, key: string): boolean {
  return ws.tasks.some(t => t.task_id.endsWith(key)) ||
    ws.external_reports.some(r => r.report_id.endsWith(key)) ||
    ws.members.some(m => m.member_id.endsWith(key)) ||
    ws.projects.some(p => p.project_id.endsWith(key));
}

/** 순수 함수. 로컬/데모 모드에서만 호출한다. */
export function applyCommand(ws: Workspace, cmd: Command, nowIso: string): Workspace {
  switch (cmd.type) {
    case 'create_task': {
      if (hasKey(ws, cmd.idempotency_key)) return ws;
      if (!ws.projects.some(p => p.project_id === cmd.project_id)) throw new CommandError('프로젝트가 없습니다.', 'not_found');
      if (cmd.assignee_member_id && !ws.members.some(m => m.member_id === cmd.assignee_member_id)) throw new CommandError('담당 팀원이 없습니다.', 'not_found');
      if (!cmd.title.trim()) throw new CommandError('제목이 필요합니다.', 'invalid');
      const task: Task = {
        task_id: `${cmd.project_id}-${slug('T', ws, ws.tasks.length)}-${cmd.idempotency_key}`,
        project_id: cmd.project_id,
        assignee_member_id: cmd.assignee_member_id,
        revision: 1,
        // 지시는 '준비됨'으로 저장되며, 실행은 Runner 가 있을 때 별도 절차로 시작한다.
        status: 'ready',
        title: cmd.title.trim().slice(0, 500),
        goal: cmd.goal,
        done_criteria: cmd.done_criteria,
        created_at: nowIso,
        updated_at: nowIso,
        sequence: nextSeq(ws),
      };
      return bump({ ...ws, tasks: [...ws.tasks, task] }, nowIso);
    }
    case 'submit_external_report': {
      if (hasKey(ws, cmd.idempotency_key)) return ws;
      const task = ws.tasks.find(t => t.task_id === cmd.task_id);
      if (!task) throw new CommandError('작업이 없습니다.', 'not_found');
      const member = ws.members.find(m => m.member_id === cmd.member_id);
      if (!member) throw new CommandError('팀원이 없습니다.', 'not_found');
      if (member.execution_mode !== 'external') throw new CommandError('외부 작업 팀원에게만 직접 보고를 등록할 수 있습니다.', 'forbidden');
      if (cmd.link && !SAFE_HTTPS.test(cmd.link)) throw new CommandError('링크는 https 주소만 허용합니다.', 'invalid');
      const report: ExternalReport = {
        report_id: `R-${cmd.idempotency_key}`,
        task_id: cmd.task_id, member_id: cmd.member_id, status: cmd.status,
        reported_at: nowIso, note: cmd.note, link: cmd.link, evidence_source: 'user_reported',
        sequence: nextSeq(ws),
      };
      // 보고는 작업 상태를 '진행 중/검토 중'으로만 옮긴다. done 은 사용자 승인으로만 간다.
      const nextStatus: Task['status'] = cmd.status === 'submitted' ? 'review' : cmd.status === 'blocked' ? 'blocked' : 'active';
      const tasks = ws.tasks.map(t => t.task_id === task.task_id
        ? { ...t, status: t.status === 'done' || t.status === 'cancelled' ? t.status : nextStatus, updated_at: nowIso }
        : t);
      let approvals = ws.approvals;
      if (cmd.status === 'submitted' && !approvals.some(a => a.task_id === task.task_id && a.decision === null)) {
        const approval: Approval = {
          approval_id: `A-${cmd.idempotency_key}`, task_id: task.task_id, project_id: task.project_id,
          member_id: cmd.member_id, kind: 'result', summary: `외부 결과 제출: ${task.title}`,
          requested_at: nowIso, decision: null, decided_at: null, sequence: nextSeq(ws) + 1,
        };
        approvals = [...approvals, approval];
      }
      const withApproval = { ...ws, tasks, external_reports: [...ws.external_reports, report], approvals };
      return bump(cmd.status === 'submitted'
        ? { ...withApproval, tasks: withApproval.tasks.map(t => t.task_id === task.task_id && t.status !== 'done' && t.status !== 'cancelled' ? { ...t, status: 'awaiting_owner' } : t) }
        : withApproval, nowIso);
    }
    case 'decide_approval': {
      const approval = ws.approvals.find(a => a.approval_id === cmd.approval_id);
      if (!approval) throw new CommandError('승인 요청이 없습니다.', 'not_found');
      if (approval.decision !== null) return ws; // idempotent
      const task = ws.tasks.find(t => t.task_id === approval.task_id);
      if (!task) throw new CommandError('작업이 없습니다.', 'not_found');
      if (task.revision !== cmd.expected_revision) throw new CommandError('작업 revision 이 달라졌습니다. 새로 확인하세요.', 'conflict');
      const status: Task['status'] = cmd.decision === 'approved' ? 'done' : cmd.decision === 'needs_changes' ? 'needs_changes' : 'cancelled';
      return bump({
        ...ws,
        approvals: ws.approvals.map(a => a.approval_id === approval.approval_id ? { ...a, decision: cmd.decision, decided_at: nowIso } : a),
        tasks: ws.tasks.map(t => t.task_id === task.task_id ? { ...t, status, revision: t.revision + 1, updated_at: nowIso } : t),
      }, nowIso);
    }
    case 'request_cancel': {
      const run = ws.runs.find(r => r.run_id === cmd.run_id);
      if (!run) throw new CommandError('실행이 없습니다.', 'not_found');
      const member = ws.members.find(m => m.member_id === run.member_id);
      if (!member?.capabilities.request_cancel) throw new CommandError('이 연결은 중지 요청을 지원하지 않습니다.', 'not_supported');
      if (run.cancel_requested_at) return ws;
      // 로컬/데모 모드에는 Runner 가 없으므로 '전달 대기'까지만 기록한다. 종료 확인은 Runner 이벤트가 있어야 한다.
      return bump({
        ...ws,
        runs: ws.runs.map(r => r.run_id === run.run_id
          ? { ...r, status: 'stopping', cancel_requested_at: nowIso, cancel_delivery: 'pending', last_confirmed_at: r.last_confirmed_at }
          : r),
      }, nowIso);
    }
    case 'accept_handoff': {
      const h = ws.handoffs.find(x => x.handoff_id === cmd.handoff_id);
      if (!h) throw new CommandError('인계 기록이 없습니다.', 'not_found');
      if (h.accepted_at) return ws;
      return bump({ ...ws, handoffs: ws.handoffs.map(x => x.handoff_id === h.handoff_id ? { ...x, accepted_at: nowIso } : x) }, nowIso);
    }
    case 'register_member': {
      if (hasKey(ws, cmd.idempotency_key)) return ws;
      if (!cmd.display_name.trim()) throw new CommandError('이름이 필요합니다.', 'invalid');
      if (cmd.execution_mode === 'managed' || cmd.execution_mode === 'observed') {
        // 로컬 모드에는 Runner 연결 시험 결과가 없다. 연결 시험 없이 관리형으로 등록하지 않는다.
        throw new CommandError('관리형/관찰형 연결은 연결 시험을 통과한 서버 모드에서만 등록할 수 있습니다.', 'not_supported');
      }
      const member: Member = {
        member_id: `m-${cmd.idempotency_key}`,
        display_name: cmd.display_name.trim(), role_label: cmd.role_label.trim() || '역할 미정',
        execution_mode: cmd.execution_mode, tool_label: cmd.tool_label.trim(),
        connection_state: 'unknown', last_heartbeat_at: null, capabilities: { request_cancel: false },
      };
      return bump({ ...ws, members: [...ws.members, member] }, nowIso);
    }
    case 'update_member': {
      if (!ws.members.some(m => m.member_id === cmd.member_id)) throw new CommandError('팀원이 없습니다.', 'not_found');
      if (cmd.patch.execution_mode === 'managed' || cmd.patch.execution_mode === 'observed') {
        const m = ws.members.find(x => x.member_id === cmd.member_id)!;
        if (m.execution_mode !== cmd.patch.execution_mode) throw new CommandError('관리형/관찰형 전환은 연결 시험 후 서버에서만 가능합니다.', 'not_supported');
      }
      return bump({ ...ws, members: ws.members.map(m => m.member_id === cmd.member_id ? { ...m, ...cmd.patch } : m) }, nowIso);
    }
    case 'register_project': {
      if (hasKey(ws, cmd.idempotency_key)) return ws;
      if (!cmd.name.trim()) throw new CommandError('프로젝트 이름이 필요합니다.', 'invalid');
      const project: Project = {
        project_id: cmd.name.trim().toUpperCase().replace(/[^A-Z0-9가-힣]+/g, '-').slice(0, 24) + '-' + cmd.idempotency_key.slice(-4),
        name: cmd.name.trim(), purpose: cmd.purpose, repo_reference: cmd.repo_reference, archived: false,
      };
      return bump({ ...ws, projects: [...ws.projects, project] }, nowIso);
    }
    case 'update_project': {
      if (!ws.projects.some(p => p.project_id === cmd.project_id)) throw new CommandError('프로젝트가 없습니다.', 'not_found');
      if (cmd.patch.repo_reference && !/^([\w.-]+\/[\w.-]+|https:\/\/[^\s]+)$/.test(cmd.patch.repo_reference)) throw new CommandError('저장소 참조는 owner/repo 또는 https 주소여야 합니다.', 'invalid');
      return bump({ ...ws, projects: ws.projects.map(p => p.project_id === cmd.project_id ? { ...p, ...cmd.patch } : p) }, nowIso);
    }
    case 'update_ui':
      // UI 설정 변경은 업무 revision 을 올리지 않는다.
      return { ...ws, ui: { ...ws.ui, ...cmd.patch, seat_bindings: { ...ws.ui.seat_bindings, ...(cmd.patch.seat_bindings ?? {}) } } };
    case 'mark_task_status': {
      const task = ws.tasks.find(t => t.task_id === cmd.task_id);
      if (!task) throw new CommandError('작업이 없습니다.', 'not_found');
      if (task.revision !== cmd.expected_revision) throw new CommandError('작업 revision 이 달라졌습니다.', 'conflict');
      if (cmd.status === 'done') throw new CommandError('완료는 승인함에서 승인으로만 처리합니다.', 'forbidden');
      return bump({ ...ws, tasks: ws.tasks.map(t => t.task_id === task.task_id ? { ...t, status: cmd.status, revision: t.revision + 1, updated_at: nowIso } : t) }, nowIso);
    }
    case 'request_run': {
      const task = ws.tasks.find(t => t.task_id === cmd.task_id);
      if (!task) throw new CommandError('작업이 없습니다.', 'not_found');
      if (task.revision !== cmd.expected_revision) throw new CommandError('작업 revision 이 달라졌습니다.', 'conflict');
      const member = ws.members.find(m => m.member_id === task.assignee_member_id);
      if (!member || (member.execution_mode !== 'managed' && member.execution_mode !== 'observed')) throw new CommandError('관리형 연결 팀원에게 배정된 작업만 실행 요청할 수 있습니다.', 'forbidden');
      if (!['ready', 'needs_changes'].includes(task.status)) throw new CommandError('준비됨/보완 필요 상태의 작업만 실행 요청할 수 있습니다.', 'invalid');
      if (task.run_requested_at) return ws;
      // 실행 요청만 기록한다. 실제 실행 시작·상태 변경은 Runner 가 PC당 1개 규칙으로 처리한다.
      return bump({ ...ws, tasks: ws.tasks.map(t => t.task_id === task.task_id ? { ...t, run_requested_at: nowIso, updated_at: nowIso } : t) }, nowIso);
    }
    case 'demo_refresh': {
      if (!ws.is_demo) throw new CommandError('데모 모드에서만 가능합니다.', 'forbidden');
      // 데모 fixture 의 heartbeat/확인 시각을 현재로 다시 찍는다. 실제 Runner 가 아니라는 점은 데모 배지로 표시한다.
      return bump({
        ...ws,
        members: ws.members.map(m => m.last_heartbeat_at ? { ...m, last_heartbeat_at: nowIso } : m),
        runs: ws.runs.map(r => ({ ...r, last_confirmed_at: nowIso })),
        devices: ws.devices.map(d => d.last_heartbeat_at ? { ...d, last_heartbeat_at: nowIso } : d),
      }, nowIso);
    }
  }
}

export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}
