/**
 * 기존 도메인(snapshot + view) → 자리별 읽기 전용 모델.
 * 자리 seed_key 와 member_id 는 명시적 바인딩(ui.seat_bindings)으로만 연결한다.
 */
import type { OfficeSnapshot, SnapshotMember, Workspace } from '../../domain/types';
import type { MemberView } from '../../domain/viewModel';
import { resolveSeatMember } from '../../domain/snapshot';
import { SCENE, type SceneSeat } from './config/sceneTypes';
import type { SeatVisual } from './renderer/createOfficeScene';

export interface SeatModel {
  seat: SceneSeat;
  member: SnapshotMember | null;
  view: MemberView | null;
  /** 프로젝트 필터 밖의 작업을 하는 중 */
  otherProject: boolean;
  visual: SeatVisual;
  /** 명패 문구 */
  title: string;
  stateLabel: string;
  stateColor: 'active' | 'attention' | 'error' | 'muted';
  stateIcon: string;
  taskLine: string | null;
}

export function buildSeatModels(
  snapshot: OfficeSnapshot | null, views: Map<string, MemberView>, ws: Workspace | null,
  opts: { projectFilter: string | null; selectedSeat: string | null; hoveredSeat: string | null; privacy: boolean },
): SeatModel[] {
  const bindings = ws?.ui.seat_bindings ?? {};
  return SCENE.seats.map(seat => {
    const member = snapshot ? resolveSeatMember(seat, bindings, snapshot.members) : null;
    const view = member ? views.get(member.member_id) ?? null : null;
    const otherProject = Boolean(member?.task && opts.projectFilter && member.task.project_id !== opts.projectFilter);
    const visual: SeatVisual = {
      bound: Boolean(member),
      avatarKey: seat.avatar_asset_id,
      clip: view ? view.clip : 'still',
      animate: Boolean(view?.animate),
      dimmed: otherProject,
      selected: opts.selectedSeat === seat.id,
      hovered: opts.hoveredSeat === seat.id,
    };
    const taskLine = member?.task
      ? (opts.privacy ? '업무명 숨김' : `${member.task.project_id} / ${member.task.title}`)
      : (member ? '배정된 업무 없음' : null);
    return {
      seat, member, view, otherProject, visual,
      title: member ? member.display_name : `${seat.label} (미연결)`,
      stateLabel: view ? view.label : '미연결',
      stateColor: view ? view.color : 'muted',
      stateIcon: view ? view.icon : 'plug',
      taskLine,
    };
  });
}

/** 총괄석 배지: 권한 있는 실제 승인 요청 수 (프로젝트 필터 적용). */
export function pendingApprovalCount(ws: Workspace | null, projectFilter: string | null): number {
  if (!ws) return 0;
  return ws.approvals.filter(a => a.decision === null && (!projectFilter || a.project_id === projectFilter)).length;
}
