import { describe, expect, test } from 'vitest';
import { buildDemoWorkspace } from '../../store/providers/demoFixture';
import { buildOfficeSnapshot } from '../../domain/snapshot';
import { deriveMemberView, type MemberView } from '../../domain/viewModel';
import { buildSeatModels, pendingApprovalCount } from './officeViewAdapter';

const NOW = '2026-10-28T00:14:00.000Z';
const ws = buildDemoWorkspace(NOW);
const snap = buildOfficeSnapshot(ws);
const views = new Map<string, MemberView>(snap.members.map(m => [m.member_id, deriveMemberView(m, { nowMs: Date.parse(NOW), snapshotCapturedAt: NOW })]));
const opts = { projectFilter: null, selectedSeat: null, hoveredSeat: null, privacy: false };

describe('seat adapter', () => {
  test('unbound seats show 미연결 even when a member has the same display name', () => {
    const unbound = { ...ws, ui: { ...ws.ui, seat_bindings: {} } };
    const models = buildSeatModels(snap, views, unbound, opts);
    expect(models.every(m => m.member === null)).toBe(true);
    expect(models[0].title).toContain('미연결');
    expect(models[0].visual.bound).toBe(false);
    expect(models[0].visual.clip).toBe('still');
  });
  test('bound seats show the member state and only runner-verified work animates', () => {
    const models = buildSeatModels(snap, views, ws, opts);
    const claude = models.find(m => m.seat.id === 'seat-claude')!;
    expect(claude.member?.member_id).toBe('claude');
    expect(claude.visual.animate).toBe(true);
    expect(claude.visual.clip).toBe('typing');
    const gemini = models.find(m => m.seat.id === 'seat-gemini')!;
    expect(gemini.visual.animate).toBe(false);
    expect(gemini.stateLabel).toContain('직접 보고');
  });
  test('project filter dims other-project work but does not turn it idle', () => {
    const models = buildSeatModels(snap, views, ws, { ...opts, projectFilter: 'MILAL' });
    const claude = models.find(m => m.seat.id === 'seat-claude')!;
    expect(claude.otherProject).toBe(true);
    expect(claude.visual.dimmed).toBe(true);
    expect(claude.stateLabel).toBe('작업 중');
    expect(pendingApprovalCount(ws, 'MILAL')).toBe(1);
    expect(pendingApprovalCount(ws, 'CBSR')).toBe(0);
  });
  test('privacy mode hides task titles but keeps state', () => {
    const models = buildSeatModels(snap, views, ws, { ...opts, privacy: true });
    expect(models.find(m => m.seat.id === 'seat-claude')!.taskLine).toBe('업무명 숨김');
  });
});
