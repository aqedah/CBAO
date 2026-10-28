// handoff tests/core.test.mjs 를 TypeScript 이식본에 대해 그대로 실행한다.
import { describe, expect, test } from 'vitest';
import fixture from '../../docs/handoff/examples/office.snapshot.demo.json';
import scene from '../features/pixel-office/config/office.scene.json';
import visuals from '../features/pixel-office/config/office.visual-states.json';
import { deriveMemberView, connectionFreshness } from './viewModel';
import { acceptSnapshot, resolveSeatMember } from './snapshot';
import type { OfficeSnapshot, SnapshotMember } from './types';
import { projectIso, unprojectIso, sceneToClient, clientToScene, compareWorldObjects } from '../features/pixel-office/renderer/projectCoordinates';

const FX = fixture as unknown as OfficeSnapshot;
const NOW = Date.parse(FX.captured_at);
const options = { nowMs: NOW, snapshotCapturedAt: FX.captured_at };
const clone = (index = 1): SnapshotMember => structuredClone(FX.members[index]);
const view = (m: SnapshotMember, extra: Record<string, unknown> = {}) => deriveMemberView(m, { ...options, ...extra });

describe('view model (handoff contract)', () => {
  test('fresh observed run animates, and input remains unchanged', () => {
    const m = clone(), before = JSON.stringify(m), v = view(m);
    expect(v.state).toBe('working'); expect(v.clip).toBe('typing'); expect(v.verifiedWork).toBe(true);
    expect(JSON.stringify(m)).toBe(before);
  });
  test('external work report never generates live working animation', () => {
    const v = view(clone(2)); expect(v.state).toBe('external_work'); expect(v.animate).toBe(false); expect(v.connection).toBe('not_applicable'); expect(v.canRequestCancel).toBe(false);
  });
  test('45-second heartbeat boundary becomes delayed', () => {
    const m = clone(); m.last_heartbeat_at = new Date(NOW - 45000).toISOString();
    expect(view(m).state).toBe('connection_delayed'); expect(view(m).animate).toBe(false);
  });
  test('90-second heartbeat boundary becomes offline, not failure', () => {
    const m = clone(); m.last_heartbeat_at = new Date(NOW - 90000).toISOString();
    expect(view(m).state).toBe('connection_lost'); expect(m.run!.status).toBe('running');
  });
  test('missing heartbeat cannot be upgraded by a healthy flag', () => {
    const m = clone(); m.last_heartbeat_at = null; expect(view(m).connection).toBe('unknown'); expect(view(m).animate).toBe(false);
  });
  test('old feed snapshot invalidates work motion even with a fresh heartbeat', () => {
    expect(view(clone(), { snapshotCapturedAt: new Date(NOW - 90000).toISOString() }).animate).toBe(false);
  });
  test('fresh PC heartbeat does not replace stale process confirmation', () => {
    const m = clone(); m.run!.last_confirmed_at = new Date(NOW - 60000).toISOString(); expect(view(m).state).toBe('unknown'); expect(view(m).animate).toBe(false);
  });
  test('model-reported progress is not runner-observed activity', () => {
    const m = clone(); m.run!.evidence_source = 'tool_reported'; expect(view(m).state).toBe('ai_reported'); expect(view(m).animate).toBe(false);
  });
  test('successful run is finished, not proof of artifact submission or task done', () => {
    const m = clone(); m.run!.status = 'succeeded'; expect(view(m).state).toBe('run_finished'); expect(m.task!.status).toBe('active');
  });
  test('owner approval state is distinct from successful execution', () => {
    const m = clone(); m.run!.status = 'succeeded'; m.task!.status = 'awaiting_owner'; expect(view(m).state).toBe('awaiting_owner');
  });
  test('task done plus terminated run can show completed even with offline connection', () => {
    const m = clone(); m.task!.status = 'done'; m.run!.status = 'succeeded'; m.connection_state = 'offline';
    expect(view(m).state).toBe('completed'); expect(view(m).connection).toBe('offline');
  });
  test('closed task plus running run is flagged as inconsistent', () => {
    const m = clone(); m.task!.status = 'done'; expect(view(m).state).toBe('inconsistent'); expect(view(m).animate).toBe(false);
  });
  test('offline stopping is pending, never confirmed cancelled', () => {
    const m = clone(); m.run!.status = 'stopping'; m.connection_state = 'offline'; expect(view(m).state).toBe('stopping'); expect(view(m).animate).toBe(false);
  });
  test('cancel capability may queue an explicit request offline; no automatic command', () => {
    const m = clone(); m.connection_state = 'offline'; expect(view(m).canRequestCancel).toBe(true);
    m.capabilities.request_cancel = false; expect(view(m).canRequestCancel).toBe(false);
  });
  test('reduced motion and hidden route both stop animation but preserve status', () => {
    for (const extra of [{ reducedMotion: true }, { hidden: true }, { motionEnabled: false }]) {
      const v = view(clone(), extra); expect(v.state).toBe('working'); expect(v.animate).toBe(false);
    }
  });
  test('testing and reviewing phases use explicit run data', () => {
    const m = clone(); m.run!.phase = 'testing'; expect(view(m).state).toBe('testing');
    m.run!.phase = 'reviewing'; expect(view(m).clip).toBe('reading');
  });
  test('future timestamps outside tolerance are unknown', () => {
    const m = clone(); m.last_heartbeat_at = new Date(NOW + 60000).toISOString(); expect(connectionFreshness(m, NOW, FX.captured_at)).toBe('unknown');
  });
  test('external run data is rejected as inconsistent', () => {
    const m = clone(); m.execution_mode = 'external'; expect(view(m).state).toBe('inconsistent');
  });
  test('demo input is rejected by live snapshot gate', () => {
    expect(() => acceptSnapshot(null, FX, { workspaceId: FX.workspace_id })).toThrow(/Demo/);
  });
  test('snapshot gate rejects foreign workspace and duplicate member IDs', () => {
    expect(() => acceptSnapshot(null, FX, { workspaceId: 'different', allowDemo: true })).toThrow(/Workspace/);
    const dup = structuredClone(FX); dup.members.push(dup.members[0]);
    expect(() => acceptSnapshot(null, dup, { workspaceId: FX.workspace_id, allowDemo: true })).toThrow(/Duplicate/);
  });
  test('equal and older snapshots cannot roll state back', () => {
    const current = { ...FX, snapshot_sequence: 5 };
    expect(acceptSnapshot(current, FX, { workspaceId: FX.workspace_id, allowDemo: true })).toBe(current);
    expect(acceptSnapshot(current, { ...FX, snapshot_sequence: 5 }, { workspaceId: FX.workspace_id, allowDemo: true })).toBe(current);
  });
  test('newer snapshot is accepted without synthesizing events', () => {
    const newer = { ...FX, snapshot_sequence: 2 }; expect(acceptSnapshot(FX, newer, { workspaceId: FX.workspace_id, allowDemo: true })).toBe(newer);
  });
  test('seat labels never auto-bind to real member IDs', () => {
    expect(resolveSeatMember(scene.seats[0], {}, FX.members)).toBeNull();
    expect(resolveSeatMember(scene.seats[0], { gpt: 'gpt' }, FX.members)!.member_id).toBe('gpt');
  });
  test('isometric transform round-trips positive fractional and elevated coordinates', () => {
    for (const p of [{ x: 0, y: 0, z: 0 }, { x: 3.5, y: 7.25, z: 2 }, { x: 23, y: 17, z: 0 }]) {
      const back = unprojectIso(projectIso(p, scene.world), scene.world, p.z);
      expect(Math.abs(back.x - p.x)).toBeLessThan(1e-10); expect(Math.abs(back.y - p.y)).toBeLessThan(1e-10); expect(back.z).toBe(p.z);
    }
  });
  test('DOM and canvas coordinates match pan/zoom and element offset', () => {
    const p = { x: 222, y: 140 }, c = { scale: 1.5, panX: 12, panY: -45 }, r = { left: 240, top: 100 };
    expect(clientToScene(sceneToClient(p, c, r), c, r)).toEqual(p);
  });
  test('depth uses ground contact, not sprite head height', () => {
    const a = { id: 'a', position: { x: 3, y: 3, z: 7 } }, b = { id: 'b', position: { x: 5, y: 5, z: 0 } };
    expect(compareWorldObjects(a, b, scene.world)).toBeLessThan(0);
  });
  test('depth ties are deterministic', () => {
    const a = { id: 'a', position: { x: 3, y: 4, z: 0 } }, b = { id: 'b', position: { x: 4, y: 3, z: 0 } };
    expect(compareWorldObjects(a, b, scene.world)).toBeLessThan(0);
  });
  test('invalid camera and grid dimensions fail explicitly', () => {
    expect(() => clientToScene({ x: 0, y: 0 }, { scale: 0, panX: 0, panY: 0 }, { left: 0, top: 0 })).toThrow(RangeError);
    expect(() => projectIso({ x: 0, y: 0, z: 0 }, { ...scene.world, tile_width: 0 })).toThrow(RangeError);
  });
  test('every fixture visual state exists in the JSON style contract', () => {
    for (const m of FX.members) expect((visuals.states as Record<string, unknown>)[view(m).state]).toBeTruthy();
  });
  test('server-derived run record is not mislabeled as AI self-report', () => {
    const m = clone(); m.run!.evidence_source = 'server_derived'; const v = view(m);
    expect(v.state).toBe('server_reported'); expect(v.animate).toBe(false);
  });
  test('manual submitted report remains manual, not verified artifact delivery', () => {
    const v = view(clone(3)); expect(v.state).toBe('submitted'); expect(v.evidence).toBe('user_reported'); expect(v.animate).toBe(false);
  });
});
