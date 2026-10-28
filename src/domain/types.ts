/**
 * AI Office 도메인 타입.
 * 업무의 기준은 서버 DB(지시·승인·상태)이며, 이 타입은 그 읽기 모델이다.
 * 픽셀 사무실의 표현 상태(view state)는 여기에 저장하지 않는다.
 */

export type ExecutionMode = 'managed' | 'observed' | 'external' | 'unconfigured';
export type ConnectionState = 'healthy' | 'delayed' | 'offline' | 'unknown';
export type TaskStatus =
  | 'draft' | 'ready' | 'active' | 'review' | 'awaiting_owner'
  | 'done' | 'needs_changes' | 'blocked' | 'cancelled';
export type RunStatus =
  | 'queued' | 'leased' | 'starting' | 'running' | 'succeeded'
  | 'failed' | 'cancelled' | 'waiting_input' | 'stopping' | 'lost';
export type RunEvidence = 'runner_observed' | 'tool_reported' | 'server_derived';
export type RunPhase = 'implementing' | 'testing' | 'reviewing' | 'researching' | 'unknown';
export type ExternalReportStatus = 'working' | 'submitted' | 'blocked';

export interface Project {
  project_id: string;
  name: string;
  purpose: string;
  repo_reference: string | null;
  archived: boolean;
}

export interface Member {
  member_id: string;
  display_name: string;
  role_label: string;
  execution_mode: ExecutionMode;
  /** 실제 실행 도구 이름 (예: claude-code-cli). 외부 작업이면 서비스 이름. */
  tool_label: string;
  connection_state: ConnectionState;
  last_heartbeat_at: string | null;
  capabilities: { request_cancel: boolean };
}

export interface Task {
  task_id: string;
  project_id: string;
  assignee_member_id: string | null;
  revision: number;
  status: TaskStatus;
  title: string;
  goal: string;
  done_criteria: string;
  created_at: string;
  updated_at: string;
  /** 서버 순서. 대표 작업 선택에 사용. 클라이언트 시각으로 정렬하지 않는다. */
  sequence: number;
  /** 소유자가 '실행 요청'을 누른 시각. 이 값이 있어야 Runner 가 받아간다. 저장만으로는 실행되지 않는다. */
  run_requested_at?: string | null;
  /** 소유자가 'GitHub에 올리기'를 누른 시각. Runner 가 검토용 브랜치에 push 한다. main 직접 반영은 하지 않는다. */
  publish_requested_at?: string | null;
  publish?: { status: 'pending' | 'pushed' | 'failed' | 'nothing_to_publish'; branch: string | null; compare_url: string | null; message: string; at: string } | null;
}

export interface Run {
  run_id: string;
  task_id: string;
  member_id: string;
  status: RunStatus;
  evidence_source: RunEvidence;
  last_confirmed_at: string;
  phase: RunPhase;
  started_at: string;
  sequence: number;
  /** 중지 요청이 서버에 접수되었지만 Runner에 전달·종료 확인이 되지 않은 상태. */
  cancel_requested_at: string | null;
  cancel_delivery: 'none' | 'pending' | 'delivered' | 'confirmed';
  /** 사무실 밖(터미널)에서 직접 실행한 세션을 훅으로 관찰한 기록. 중지·반영 불가 */
  observed?: boolean;
}

export interface ExternalReport {
  report_id: string;
  task_id: string;
  member_id: string;
  status: ExternalReportStatus;
  reported_at: string;
  note: string;
  link: string | null;
  evidence_source: 'user_reported';
  sequence: number;
}

export type ApprovalKind = 'result' | 'judgment' | 'scope';
export type ApprovalDecision = 'approved' | 'needs_changes' | 'rejected';

export interface Approval {
  approval_id: string;
  task_id: string;
  project_id: string;
  member_id: string | null;
  kind: ApprovalKind;
  summary: string;
  requested_at: string;
  decision: ApprovalDecision | null;
  decided_at: string | null;
  sequence: number;
}

export interface Handoff {
  handoff_id: string;
  task_id: string;
  from_member_id: string;
  to_member_id: string;
  summary: string;
  requested_at: string;
  accepted_at: string | null;
  sequence: number;
}

export interface Artifact {
  artifact_id: string;
  task_id: string;
  member_id: string;
  title: string;
  kind: 'file' | 'link' | 'note';
  reference: string;
  content_hash: string | null;
  submitted_at: string;
}

export interface RunnerDevice {
  device_id: string;
  name: string;
  connection_state: ConnectionState;
  last_heartbeat_at: string | null;
  /** 기본 PC당 관리형 실행 1개. 사무실 그림 때문에 바꾸지 않는다. */
  max_concurrent_managed_runs: number;
  tools: Array<{ tool: string; status: 'not_installed' | 'installed' | 'logged_in' | 'test_passed' | 'connected' }>;
}

/** 사용자별 UI 설정. 서버 권한을 대체하지 않는다. */
export interface UiSettings {
  /** seat seed_key → member_id. 명시적 바인딩만 허용. */
  seat_bindings: Record<string, string | null>;
  motion_enabled: boolean;
  sound_enabled: boolean;
  privacy_mode: boolean;
}

export interface Workspace {
  workspace_id: string;
  is_demo: boolean;
  /** 권한 있는 read model의 단조 증가 revision. */
  revision: number;
  captured_at: string;
  projects: Project[];
  members: Member[];
  tasks: Task[];
  runs: Run[];
  external_reports: ExternalReport[];
  approvals: Approval[];
  handoffs: Handoff[];
  artifacts: Artifact[];
  devices: RunnerDevice[];
  ui: UiSettings;
}

/* ---------- 픽셀 사무실 읽기 모델 (contracts/office-snapshot.schema.json) ---------- */

export interface SnapshotTask {
  task_id: string;
  project_id: string;
  revision: number;
  status: TaskStatus;
  title: string;
}
export interface SnapshotRun {
  run_id: string;
  status: RunStatus;
  evidence_source: RunEvidence;
  last_confirmed_at: string;
  phase: RunPhase;
}
export interface SnapshotExternalReport {
  status: ExternalReportStatus;
  reported_at: string;
  evidence_source: 'user_reported';
}
export interface SnapshotMember {
  member_id: string;
  display_name: string;
  role_label: string;
  execution_mode: ExecutionMode;
  connection_state: ConnectionState;
  last_heartbeat_at: string | null;
  task: SnapshotTask | null;
  run: SnapshotRun | null;
  external_report: SnapshotExternalReport | null;
  pending_owner_count: number;
  capabilities: { request_cancel: boolean };
}
export interface OfficeSnapshot {
  schema_version: '1.1.0';
  is_demo: boolean;
  workspace_id: string;
  snapshot_sequence: number;
  captured_at: string;
  members: SnapshotMember[];
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  draft: '초안', ready: '준비됨', active: '진행 중', review: '검토 중',
  awaiting_owner: '내 판단 대기', done: '완료', needs_changes: '보완 필요',
  blocked: '막힘', cancelled: '취소',
};
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: '대기열', leased: '배정됨', starting: '시작 중', running: '실행 중',
  succeeded: '실행 종료(성공)', failed: '실행 실패', cancelled: '실행 취소',
  waiting_input: '입력 대기', stopping: '중지 처리 중', lost: '연결 유실',
};
export const EXEC_MODE_LABEL: Record<ExecutionMode, string> = {
  managed: '관리형 실행', observed: '관찰형 연결', external: '외부 작업(수동 보고)', unconfigured: '미연결',
};
export const EVIDENCE_LABEL: Record<RunEvidence | 'user_reported' | 'none', string> = {
  runner_observed: 'Runner 직접 관찰', tool_reported: 'AI 자체 보고', server_derived: '서버 기록',
  user_reported: '사용자 직접 보고', none: '근거 없음',
};
