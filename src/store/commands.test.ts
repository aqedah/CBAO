import { describe, expect, test } from 'vitest';
import { applyCommand, CommandError } from './commands';
import { emptyLocalWorkspace, createLocalProvider, LOCAL_STORAGE_KEY } from './providers/localProvider';
import { buildDemoWorkspace } from './providers/demoFixture';
import { WorkspaceStore } from './workspaceStore';
import { createDemoProvider } from './providers/demoProvider';
import type { Workspace } from '../domain/types';

const T0 = '2026-10-28T01:00:00.000Z';
const T1 = '2026-10-28T01:01:00.000Z';

function seeded(): Workspace {
  let ws = emptyLocalWorkspace(T0);
  ws = applyCommand(ws, { type: 'register_project', name: 'CBSR', purpose: 't', repo_reference: null, idempotency_key: 'p1' }, T0);
  ws = applyCommand(ws, { type: 'register_member', display_name: 'Gemini', role_label: '자료', execution_mode: 'external', tool_label: 'Gemini 웹', idempotency_key: 'm1' }, T0);
  return ws;
}

describe('local commands (no runner, no auto execution)', () => {
  test('create_task stores ready, never starts a run', () => {
    const ws = seeded();
    const pid = ws.projects[0].project_id, mid = ws.members[0].member_id;
    const next = applyCommand(ws, { type: 'create_task', project_id: pid, assignee_member_id: mid, title: '시안', goal: '', done_criteria: '', idempotency_key: 'k1' }, T1);
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0].status).toBe('ready');
    expect(next.runs).toHaveLength(0);
    expect(next.revision).toBe(ws.revision + 1);
    // idempotent
    expect(applyCommand(next, { type: 'create_task', project_id: pid, assignee_member_id: mid, title: '시안', goal: '', done_criteria: '', idempotency_key: 'k1' }, T1)).toBe(next);
  });
  test('external report is user_reported with its own timestamp and never promotes to heartbeat', () => {
    let ws = seeded();
    const pid = ws.projects[0].project_id, mid = ws.members[0].member_id;
    ws = applyCommand(ws, { type: 'create_task', project_id: pid, assignee_member_id: mid, title: '시안', goal: '', done_criteria: '', idempotency_key: 'k1' }, T0);
    const tid = ws.tasks[0].task_id;
    ws = applyCommand(ws, { type: 'submit_external_report', task_id: tid, member_id: mid, status: 'working', note: '시작', link: null, idempotency_key: 'r1' }, T1);
    expect(ws.external_reports[0]).toMatchObject({ evidence_source: 'user_reported', reported_at: T1, status: 'working' });
    expect(ws.members[0].last_heartbeat_at).toBeNull();
    expect(ws.members[0].connection_state).toBe('unknown');
    expect(ws.tasks[0].status).toBe('active');
  });
  test('submitted report creates an approval; done only through owner decision', () => {
    let ws = seeded();
    const pid = ws.projects[0].project_id, mid = ws.members[0].member_id;
    ws = applyCommand(ws, { type: 'create_task', project_id: pid, assignee_member_id: mid, title: '시안', goal: '', done_criteria: '', idempotency_key: 'k1' }, T0);
    const tid = ws.tasks[0].task_id;
    ws = applyCommand(ws, { type: 'submit_external_report', task_id: tid, member_id: mid, status: 'submitted', note: '완료', link: 'https://example.com/x', idempotency_key: 'r2' }, T1);
    expect(ws.tasks[0].status).toBe('awaiting_owner');
    expect(ws.approvals).toHaveLength(1);
    expect(() => applyCommand(ws, { type: 'mark_task_status', task_id: tid, status: 'done', expected_revision: ws.tasks[0].revision }, T1)).toThrow(CommandError);
    const decided = applyCommand(ws, { type: 'decide_approval', approval_id: ws.approvals[0].approval_id, decision: 'approved', expected_revision: ws.tasks[0].revision, idempotency_key: 'd1' }, T1);
    expect(decided.tasks[0].status).toBe('done');
    expect(() => applyCommand(ws, { type: 'decide_approval', approval_id: ws.approvals[0].approval_id, decision: 'approved', expected_revision: 99, idempotency_key: 'd2' }, T1)).toThrow(/revision/);
  });
  test('http-only links are rejected', () => {
    let ws = seeded();
    const pid = ws.projects[0].project_id, mid = ws.members[0].member_id;
    ws = applyCommand(ws, { type: 'create_task', project_id: pid, assignee_member_id: mid, title: '시안', goal: '', done_criteria: '', idempotency_key: 'k1' }, T0);
    expect(() => applyCommand(ws, { type: 'submit_external_report', task_id: ws.tasks[0].task_id, member_id: mid, status: 'working', note: '', link: 'javascript:alert(1)', idempotency_key: 'r3' }, T1)).toThrow(/https/);
  });
  test('managed members cannot be registered without a server-side connection test', () => {
    const ws = seeded();
    expect(() => applyCommand(ws, { type: 'register_member', display_name: 'Claude', role_label: '구현', execution_mode: 'managed', tool_label: 'cli', idempotency_key: 'm2' }, T1)).toThrow(/연결 시험/);
  });
  test('request_cancel records pending delivery, never confirmed termination', () => {
    const ws = buildDemoWorkspace(T0);
    const next = applyCommand(ws, { type: 'request_cancel', run_id: 'demo-run-01', idempotency_key: 'c1' }, T1);
    const run = next.runs.find(r => r.run_id === 'demo-run-01')!;
    expect(run.status).toBe('stopping');
    expect(run.cancel_delivery).toBe('pending');
    expect(next.tasks.find(t => t.task_id === run.task_id)!.status).toBe('active');
    expect(() => applyCommand(ws, { type: 'request_cancel', run_id: 'demo-run-02', idempotency_key: 'c2' }, T1)).toThrow(/지원하지 않습니다/);
  });
  test('update_ui does not bump the business revision', () => {
    const ws = seeded();
    const next = applyCommand(ws, { type: 'update_ui', patch: { seat_bindings: { gemini: ws.members[0].member_id } } }, T1);
    expect(next.revision).toBe(ws.revision);
    expect(next.ui.seat_bindings.gemini).toBe(ws.members[0].member_id);
  });
});

describe('local provider storage boundary', () => {
  test('rejects demo data found in local storage instead of showing it live', async () => {
    const storage = new Map<string, string>();
    const api = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); } };
    api.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ ...buildDemoWorkspace(T0) }));
    await expect(createLocalProvider(api, () => new Date(T0)).load()).rejects.toThrow(/데모/);
  });
  test('starts with the owner-registered external members (Gemini, NotebookLM) and no fixtures', async () => {
    const storage = new Map<string, string>();
    const api = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); } };
    const p = createLocalProvider(api, () => new Date(T0));
    const ws = await p.load();
    expect(ws.members.map(m => m.display_name)).toEqual(['Gemini', 'NotebookLM']);
    expect(ws.members.every(m => m.execution_mode === 'external' && m.last_heartbeat_at === null)).toBe(true);
    expect(ws.ui.seat_bindings).toEqual({ gemini: 'm-gemini', notebooklm: 'm-notebooklm' });
    expect(ws.tasks).toHaveLength(0); expect(ws.runs).toHaveLength(0); expect(ws.devices).toHaveLength(0);
    expect(ws.is_demo).toBe(false);
    await p.command({ type: 'register_project', name: 'CBSR', purpose: '', repo_reference: null, idempotency_key: 'p1' });
    expect(JSON.parse(storage.get(LOCAL_STORAGE_KEY)!).projects).toHaveLength(1);
  });
});

describe('workspace store revision gate', () => {
  test('older revisions are rejected, newer accepted, demo/live switch resets', async () => {
    const store = new WorkspaceStore(() => createDemoProvider(() => new Date(T0)), 'demo');
    await store.load();
    const ws = store.getState().workspace!;
    expect(store.accept({ ...ws, revision: ws.revision - 1 })).toBe(false);
    expect(store.getState().rejectedUpdates).toBe(1);
    expect(store.accept({ ...ws, revision: ws.revision + 3 })).toBe(true);
    expect(store.getState().workspace!.revision).toBe(ws.revision + 3);
    store.setPreferredTask('claude', 'x');
    expect(store.accept({ ...ws, workspace_id: 'other', is_demo: false, revision: 0 })).toBe(true);
    expect(store.getState().preferredTask).toEqual({});
    store.dispose();
  });
});
