import { describe, expect, test } from 'vitest';
import { buildDemoWorkspace } from '../store/providers/demoFixture';
import { buildOfficeSnapshot, representativeTask, validateSnapshot } from './snapshot';
import { deriveMemberView } from './viewModel';
import fixture from '../../docs/handoff/examples/office.snapshot.demo.json';

const NOW = '2026-10-28T00:14:00.000Z';

describe('workspace → office snapshot projection', () => {
  const ws = buildDemoWorkspace(NOW);
  const snap = buildOfficeSnapshot(ws);

  test('demo workspace projects to a schema-valid snapshot', () => {
    expect(validateSnapshot(snap)).toEqual([]);
    expect(snap.is_demo).toBe(true);
    expect(snap.snapshot_sequence).toBe(ws.revision);
  });
  test('projection matches the handoff demo fixture member states', () => {
    for (const fm of fixture.members) {
      const m = snap.members.find(x => x.member_id === fm.member_id)!;
      expect(m.task?.task_id).toBe(fm.task?.task_id);
      expect(m.run?.status).toBe(fm.run?.status ?? undefined);
      expect(m.external_report?.status).toBe(fm.external_report?.status ?? undefined);
      expect(m.pending_owner_count).toBe(fm.pending_owner_count);
      const a = deriveMemberView(m, { nowMs: Date.parse(NOW), snapshotCapturedAt: NOW });
      const b = deriveMemberView(fm as never, { nowMs: Date.parse(NOW), snapshotCapturedAt: fixture.captured_at });
      expect(a.state).toBe(b.state);
    }
  });
  test('external members never carry a run; managed members never carry external_report', () => {
    for (const m of snap.members) {
      if (m.execution_mode === 'external') expect(m.run).toBeNull();
      if (m.execution_mode === 'managed') expect(m.external_report).toBeNull();
    }
  });
  test('representative task: server run first, then preferred, then latest open by sequence', () => {
    // claude 는 실행 중 run 이 있으므로 preferred 를 줘도 run 의 task 가 우선
    expect(representativeTask(ws, 'claude', 'DEMO-CBWP-001').task?.task_id).toBe('DEMO-CBSR-001');
    const noRun = { ...ws, runs: ws.runs.filter(r => r.member_id !== 'claude') };
    expect(representativeTask(noRun, 'claude', 'DEMO-CBWP-001').task?.task_id).toBe('DEMO-CBWP-001');
    expect(representativeTask(noRun, 'claude').task?.task_id).toBe('DEMO-CBWP-001'); // sequence 6 > 2
    expect(representativeTask(ws, 'nobody').task).toBeNull();
  });
  test('finished run keeps task visible as run_finished until owner decides', () => {
    const done = { ...ws, runs: ws.runs.map(r => r.run_id === 'demo-run-01' ? { ...r, status: 'succeeded' as const } : r), tasks: ws.tasks.filter(t => t.task_id !== 'DEMO-CBWP-001') };
    const s = buildOfficeSnapshot(done);
    const m = s.members.find(x => x.member_id === 'claude')!;
    expect(m.run?.status).toBe('succeeded');
    expect(deriveMemberView(m, { nowMs: Date.parse(NOW), snapshotCapturedAt: NOW }).state).toBe('run_finished');
    expect(m.task?.status).toBe('active');
  });
  test('validateSnapshot reports contract violations', () => {
    const bad = structuredClone(snap) as unknown as Record<string, unknown>;
    (bad.members as Array<Record<string, unknown>>)[0].execution_mode = 'magic';
    bad.schema_version = '9';
    const errors = validateSnapshot(bad);
    expect(errors.some(e => e.includes('execution_mode'))).toBe(true);
    expect(errors.some(e => e.includes('schema_version'))).toBe(true);
  });
});
