/**
 * 기존 스토어 selector. 대시보드와 픽셀 사무실이 같은 snapshot 을 본다.
 * 픽셀 화면이 별도 구독을 만들지 않는다.
 */
import { useMemo } from 'react';
import { useStoreState, getStore } from '../../store/workspaceStore';
import { buildOfficeSnapshot, acceptSnapshot } from '../../domain/snapshot';
import { deriveMemberView, type MemberView } from '../../domain/viewModel';
import type { OfficeSnapshot, SnapshotMember } from '../../domain/types';
import { useRoute } from '../../app/router';
import { useServerNow } from '../../shared/ui';

let lastAccepted: OfficeSnapshot | null = null;

export function useOfficeSnapshot(): OfficeSnapshot | null {
  const ws = useStoreState(s => s.workspace);
  const preferred = useStoreState(s => s.preferredTask);
  return useMemo(() => {
    if (!ws) { lastAccepted = null; return null; }
    const built = buildOfficeSnapshot(ws, preferred);
    // 대표 작업 선택(preferred)은 sequence 를 올리지 않으므로 같은 sequence 의 재계산은 허용한다.
    if (lastAccepted && lastAccepted.workspace_id === built.workspace_id && lastAccepted.is_demo === built.is_demo &&
        built.snapshot_sequence < lastAccepted.snapshot_sequence) {
      return lastAccepted; // 역순 거부
    }
    try {
      lastAccepted = acceptSnapshot(
        lastAccepted && lastAccepted.snapshot_sequence < built.snapshot_sequence ? lastAccepted : null,
        built, { workspaceId: built.workspace_id, allowDemo: built.is_demo },
      );
    } catch {
      lastAccepted = built;
    }
    return lastAccepted;
  }, [ws, preferred]);
}

export interface MotionEnv { reducedMotion: boolean; hidden: boolean; motionEnabled: boolean }

export function useMemberViews(snapshot: OfficeSnapshot | null, env: MotionEnv): Map<string, MemberView> {
  const now = useServerNow();
  return useMemo(() => {
    const map = new Map<string, MemberView>();
    if (!snapshot) return map;
    for (const m of snapshot.members) {
      map.set(m.member_id, deriveMemberView(m, { nowMs: now, snapshotCapturedAt: snapshot.captured_at, ...env }));
    }
    return map;
  }, [snapshot, now, env.reducedMotion, env.hidden, env.motionEnabled]);
}

/** 프로젝트 필터는 URL 쿼리(project=)에 둔다. 두 보기에서 공유된다. */
export function useProjectFilter(): string | null {
  const route = useRoute();
  return route.query.get('project') || null;
}

export function memberById(snapshot: OfficeSnapshot | null, id: string | null): SnapshotMember | null {
  if (!snapshot || !id) return null;
  return snapshot.members.find(m => m.member_id === id) ?? null;
}

export function serverNow(): number { return getStore().now(); }
