/**
 * 데모 fixture. examples/office.snapshot.demo.json 을 전체 workspace 로 확장한 것.
 * is_demo: true. live 화면에 기본으로 주입되지 않는다.
 * 시각은 로드 시점으로 찍는다(heartbeat 가 '현재'여야 데모에서 작업 동작을 볼 수 있다).
 * 데모 배지는 모든 화면에 표시된다.
 */
import type { Workspace } from '../../domain/types';

export function buildDemoWorkspace(nowIso: string): Workspace {
  const t = (minutesAgo: number) => new Date(Date.parse(nowIso) - minutesAgo * 60_000).toISOString();
  return {
    workspace_id: 'demo-pixel-office',
    is_demo: true,
    revision: 1,
    captured_at: nowIso,
    projects: [
      { project_id: 'MILAL', name: 'MILAL', purpose: '연구 규칙·계층 구조 (데모)', repo_reference: 'aqedah/MILAL', archived: false },
      { project_id: 'CBSR', name: 'CBSR', purpose: '성경 배경 자료 (데모)', repo_reference: 'aqedah/CBSR', archived: false },
      { project_id: 'CBWP', name: 'CBWP', purpose: '찬양 콘티 (데모)', repo_reference: 'aqedah/CBWP', archived: false },
    ],
    members: [
      { member_id: 'gpt', display_name: 'GPT', role_label: '연구·설계·검수', execution_mode: 'external', tool_label: 'ChatGPT 웹', connection_state: 'unknown', last_heartbeat_at: null, capabilities: { request_cancel: false } },
      { member_id: 'claude', display_name: 'Claude', role_label: '구현·개발', execution_mode: 'managed', tool_label: 'Claude Code CLI (stream-json)', connection_state: 'healthy', last_heartbeat_at: nowIso, capabilities: { request_cancel: true } },
      { member_id: 'gemini', display_name: 'Gemini', role_label: '자료·이미지', execution_mode: 'external', tool_label: 'Gemini 웹', connection_state: 'unknown', last_heartbeat_at: null, capabilities: { request_cancel: false } },
      { member_id: 'notebooklm', display_name: 'NotebookLM', role_label: '출처·문서 정리', execution_mode: 'external', tool_label: 'NotebookLM 웹', connection_state: 'unknown', last_heartbeat_at: null, capabilities: { request_cancel: false } },
      { member_id: 'codex', display_name: 'Codex', role_label: '코드·검사', execution_mode: 'managed', tool_label: 'Codex CLI (exec --json)', connection_state: 'healthy', last_heartbeat_at: nowIso, capabilities: { request_cancel: false } },
    ],
    tasks: [
      { task_id: 'DEMO-MILAL-001', project_id: 'MILAL', assignee_member_id: 'gpt', revision: 2, status: 'awaiting_owner', title: '계층 규칙 대안 비교', goal: '계층 규칙의 두 해석을 비교하고 근거를 제시한다.', done_criteria: '대안 2개 이상, 각 근거 출처 명시', created_at: t(240), updated_at: t(30), sequence: 1 },
      { task_id: 'DEMO-CBSR-001', project_id: 'CBSR', assignee_member_id: 'claude', revision: 1, status: 'active', title: '배경 태그 선택 규칙 구현', goal: '배경 자료의 태그 선택 규칙을 구현한다.', done_criteria: '단위 테스트 통과, 기존 화면 회귀 없음', created_at: t(120), updated_at: t(5), sequence: 2 },
      { task_id: 'DEMO-CBSR-002', project_id: 'CBSR', assignee_member_id: 'gemini', revision: 1, status: 'active', title: '배경 이미지 시안 정리', goal: '배경 이미지 후보를 정리한다.', done_criteria: '후보 6장과 출처', created_at: t(90), updated_at: t(20), sequence: 3 },
      { task_id: 'DEMO-MILAL-002', project_id: 'MILAL', assignee_member_id: 'notebooklm', revision: 1, status: 'review', title: '참고자료와 출처 연결', goal: '참고자료 목록에 출처를 연결한다.', done_criteria: '모든 항목에 출처 링크', created_at: t(200), updated_at: t(40), sequence: 4 },
      { task_id: 'DEMO-CBSR-003', project_id: 'CBSR', assignee_member_id: 'codex', revision: 1, status: 'ready', title: '회귀 검사', goal: 'CBSR 기존 화면 회귀 검사를 실행한다.', done_criteria: '검사 결과 보고', created_at: t(60), updated_at: t(60), sequence: 5 },
      { task_id: 'DEMO-CBWP-001', project_id: 'CBWP', assignee_member_id: 'claude', revision: 1, status: 'ready', title: '콘티 인쇄 여백 수정', goal: '콘티 인쇄 시 여백 문제를 고친다.', done_criteria: 'A4 인쇄 확인', created_at: t(30), updated_at: t(30), sequence: 6 },
    ],
    runs: [
      { run_id: 'demo-run-01', task_id: 'DEMO-CBSR-001', member_id: 'claude', status: 'running', evidence_source: 'runner_observed', last_confirmed_at: nowIso, phase: 'implementing', started_at: t(12), sequence: 7, cancel_requested_at: null, cancel_delivery: 'none' },
      { run_id: 'demo-run-02', task_id: 'DEMO-CBSR-003', member_id: 'codex', status: 'queued', evidence_source: 'runner_observed', last_confirmed_at: nowIso, phase: 'testing', started_at: t(1), sequence: 8, cancel_requested_at: null, cancel_delivery: 'none' },
    ],
    external_reports: [
      { report_id: 'demo-rep-01', task_id: 'DEMO-CBSR-002', member_id: 'gemini', status: 'working', reported_at: t(20), note: 'Gemini 웹에서 후보 이미지 정리 중 (사용자 직접 보고)', link: null, evidence_source: 'user_reported', sequence: 9 },
      { report_id: 'demo-rep-02', task_id: 'DEMO-MILAL-002', member_id: 'notebooklm', status: 'submitted', reported_at: t(40), note: '노트북에 출처 연결 완료, 검토 요청', link: 'https://notebooklm.google.com/', evidence_source: 'user_reported', sequence: 10 },
    ],
    approvals: [
      { approval_id: 'demo-ap-01', task_id: 'DEMO-MILAL-001', project_id: 'MILAL', member_id: 'gpt', kind: 'judgment', summary: '규칙 해석 선택: 대안 A(엄격) vs 대안 B(관용)', requested_at: t(30), decision: null, decided_at: null, sequence: 11 },
    ],
    handoffs: [
      { handoff_id: 'demo-ho-01', task_id: 'DEMO-MILAL-002', from_member_id: 'gpt', to_member_id: 'notebooklm', summary: '출처 목록 초안 → 출처 연결', requested_at: t(150), accepted_at: t(140), sequence: 12 },
    ],
    artifacts: [
      { artifact_id: 'demo-art-01', task_id: 'DEMO-MILAL-001', member_id: 'gpt', title: '대안 비교표 (데모)', kind: 'note', reference: '대안 A/B 비교 요약', content_hash: null, submitted_at: t(35) },
    ],
    devices: [
      { device_id: 'pc-a', name: 'PC-A (데모)', connection_state: 'healthy', last_heartbeat_at: nowIso, max_concurrent_managed_runs: 1,
        tools: [ { tool: 'claude-code', status: 'test_passed' }, { tool: 'codex', status: 'test_passed' } ] },
    ],
    ui: {
      seat_bindings: { gpt: 'gpt', claude: 'claude', gemini: 'gemini', notebooklm: 'notebooklm', codex: 'codex' },
      motion_enabled: true, sound_enabled: false, privacy_mode: false,
    },
  };
}
