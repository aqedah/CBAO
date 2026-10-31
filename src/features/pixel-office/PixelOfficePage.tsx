/**
 * S11 #/office/room — 픽셀 사무실. 기존 대시보드와 같은 스토어를 읽는 표현 계층.
 * 상단 전환 · 장면 · 접근 가능한 팀원 목록 · 상세 드로어 · 오류 경계.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { href, navigate, useRoute } from '../../app/router';
import { getStore, useStoreState } from '../../store/workspaceStore';
import { useServerNow } from '../../shared/ui';
import { OfficeHeader } from '../office-shared/OfficeHeader';
import { useMemberViews, useOfficeSnapshot, useProjectFilter } from '../office-shared/useOfficeSnapshot';
import { OfficeCanvas, type CanvasStatus, type Target } from './OfficeCanvas';
import { buildSeatModels, pendingApprovalCount } from './officeViewAdapter';
import { MemberNameplate, ObjectNameplate } from './MemberNameplate';
import { MemberDrawer } from './MemberDrawer';
import { OfficeAccessibleList } from './OfficeAccessibleList';
import { SCENE, type SceneAction } from './config/sceneTypes';
import { sceneToClient } from './renderer/projectCoordinates';
import { useThreads } from '../../store/threadStore';
import { memberBubbles } from './bubbles';

/** Canvas action enum → 기존 라우트. JSON 의 문자열을 임의 API 로 실행하지 않는다. */
const ACTION_ROUTE: Record<SceneAction, string | null> = {
  none: null, open_records: '/records', open_tasks: '/tasks', open_handoffs: '/records/handoffs',
  open_approvals: '/approvals', open_connections: '/settings/connections', open_ambience_settings: '/settings/policies',
};

function usePrefersReducedMotion(): boolean {
  const [v, setV] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const h = () => setV(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return v;
}
function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const h = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, []);
  return hidden;
}

export function PixelOfficePage() {
  const ws = useStoreState(s => s.workspace);
  const status = useStoreState(s => s.status);
  const snapshot = useOfficeSnapshot();
  const project = useProjectFilter();
  const route = useRoute();
  const reduced = usePrefersReducedMotion();
  const hidden = useDocumentHidden();
  const motionEnabled = ws?.ui.motion_enabled ?? true;
  const privacy = ws?.ui.privacy_mode ?? false;
  const env = useMemo(() => ({ reducedMotion: reduced, hidden, motionEnabled }), [reduced, hidden, motionEnabled]);
  const views = useMemberViews(snapshot, env);
  const now = useServerNow();
  const { threads } = useThreads();
  const bubbles = useMemo(() => memberBubbles(threads), [threads]);

  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const [hoveredSeat, setHoveredSeat] = useState<string | null>(null);
  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus>({ phase: 'loading', error: null, missingAssets: [], renderer: null });
  const [retryKey, setRetryKey] = useState(0);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  // 대시보드 '자리 보기'(?member=) → 해당 멤버가 연결된 자리 선택
  const memberParam = route.query.get('member');
  useEffect(() => {
    if (!memberParam || !ws) return;
    const seat = SCENE.seats.find(s => ws.ui.seat_bindings[s.member_binding.seed_key] === memberParam);
    if (seat) setSelectedSeat(seat.id);
  }, [memberParam, ws]);

  const models = useMemo(() => buildSeatModels(snapshot, views, ws, { projectFilter: project, selectedSeat, hoveredSeat, privacy }), [snapshot, views, ws, project, selectedSeat, hoveredSeat, privacy]);
  const seatVisuals = useMemo(() => new Map(models.map(m => [m.seat.id, m.visual])), [models]);
  const approvalCount = pendingApprovalCount(ws, project);
  const handoffCount = ws ? ws.handoffs.filter(h => !h.accepted_at).length : 0;
  const device = ws?.devices[0];
  const deviceLabel = device ? `${device.name} ${device.connection_state}` : 'PC 미등록';

  const selectSeat = useCallback((seatId: string | null) => {
    lastFocusRef.current = document.activeElement as HTMLElement | null;
    setSelectedSeat(seatId);
  }, []);
  const closeDrawer = useCallback(() => {
    setSelectedSeat(null);
    const el = lastFocusRef.current;
    if (el && document.contains(el)) el.focus();
    else (document.querySelector('[data-seat]') as HTMLElement | null)?.focus();
  }, []);

  const onCanvasSelect = useCallback((t: Target | null) => {
    if (!t) { setSelectedSeat(null); return; }
    if (t.kind === 'seat') { selectSeat(t.id); return; }
    const obj = SCENE.objects.find(o => o.id === t.id);
    const to = obj ? ACTION_ROUTE[obj.action] : null;
    if (to) navigate(to, to === '/tasks' ? { project } : undefined);
  }, [selectSeat, project]);
  const onCanvasHover = useCallback((t: Target | null) => setHoveredSeat(t?.kind === 'seat' ? t.id : null), []);
  const onStatus = useCallback((s: CanvasStatus) => setCanvasStatus(s), []);

  const selectedModel = models.find(m => m.seat.id === selectedSeat) ?? null;
  const motionPaused = hidden || reduced || !motionEnabled;

  return (
    <>
      <OfficeHeader view="room" />
      {!ws && status !== 'loading' && (
        <div className="notice">데이터가 없습니다. <a href={href('/settings/connections')}>연결 설정</a>에서 데이터 소스를 고르세요. 장면은 표시되지만 모든 자리는 미연결입니다.</div>
      )}
      {canvasStatus.phase === 'error' && (
        <div className="notice error" role="alert">
          {canvasStatus.error} — 아래 팀원 목록으로 모든 기능을 계속 쓸 수 있습니다.
          <button type="button" className="btn small" style={{ marginLeft: 8 }} onClick={() => setRetryKey(k => k + 1)}>다시 시도</button>
        </div>
      )}
      {canvasStatus.phase === 'ready' && canvasStatus.error && <div className="notice" role="status">{canvasStatus.error}</div>}
      {canvasStatus.phase === 'ready' && canvasStatus.missingAssets.length > 0 && (
        <div className="notice" role="status">누락 에셋 {canvasStatus.missingAssets.length}개는 대체 도형으로 표시: {canvasStatus.missingAssets.slice(0, 5).join(', ')}{canvasStatus.missingAssets.length > 5 ? ' …' : ''}</div>
      )}
      <div className={`room-layout${selectedModel ? '' : ' no-drawer'}`}>
        <div>
          {canvasStatus.phase !== 'error' && (
            <OfficeCanvas
              retryKey={retryKey}
              seatVisuals={seatVisuals}
              motionPaused={motionPaused}
              onSelect={onCanvasSelect}
              onHover={onCanvasHover}
              onStatus={onStatus}
              overlay={(camera, anchors) => {
                const avatarDx = -7; // 아틀라스 desk_avatar_offset.x 와 동일 (캐릭터 머리 위에 명패)
                const mini = camera.scale < 0.7; // 모바일 맞춤: 이름만. 상세는 DOM 목록·드로어
                const at = (p: { x: number; y: number }, dx: number, dy: number) => sceneToClient({ x: p.x + dx, y: p.y + dy }, camera, { left: 0, top: 0 });
                return (
                  <>
                    {models.map(m => {
                      const p = at(anchors.seat(m.seat.id), avatarDx + m.seat.label_offset[0], -70);
                      const expanded = m.visual.selected || m.visual.hovered;
                      return <MemberNameplate key={m.seat.id} model={m} x={p.x} y={p.y} nowMs={now} compact={!expanded} mini={mini && !expanded} bubble={m.member ? bubbles[m.member.member_id] : undefined} onSelect={() => selectSeat(m.seat.id)} />;
                    })}
                    {[
                      { id: 'owner-desk', label: '총괄·승인석', badge: approvalCount, dy: -66 },
                      { id: 'handoff-table', label: '검토·인계 테이블', badge: handoffCount, dy: -34 },
                      { id: 'rear-shelf', label: '공유 서가', dy: -92 },
                      { id: 'task-board', label: '작업 게시판', dy: -112 },
                      { id: 'runner-console', label: `실행 PC · ${deviceLabel}`, dy: 16 },
                    ].filter(o => !mini || o.id === 'owner-desk').map(o => {
                      const obj = SCENE.objects.find(x => x.id === o.id); if (!obj) return null;
                      const p = at(anchors.object(o.id), 0, o.dy);
                      return <ObjectNameplate key={o.id} label={o.label} badge={o.badge} x={p.x} y={p.y} onSelect={() => onCanvasSelect({ kind: 'object', id: o.id })} />;
                    })}
                  </>
                );
              }}
            />
          )}
          <OfficeAccessibleList models={models} selectedSeat={selectedSeat} onSelectSeat={id => selectSeat(id === selectedSeat ? null : id)} approvalCount={approvalCount} handoffCount={handoffCount} deviceLabel={deviceLabel} projectFilter={project} />
          <p className="meta" style={{ marginTop: 10 }}>
            고정 시점 2.5D 픽셀 장면입니다(카메라 회전 없음). 캐릭터 동작은 Runner 가 직접 확인한 실행에서만 반복되며, 수동 보고·AI 보고·연결 지연 상태에서는 정지합니다.
            {motionPaused && ' 현재 움직임 정지: '}{hidden ? '탭 숨김' : reduced ? '움직임 줄이기 설정' : !motionEnabled ? '사용자 설정' : ''}
          </p>
          <p className="meta">렌더러 {canvasStatus.renderer ?? '—'} · 데이터 revision {ws?.revision ?? '—'} · 거부된 역순 갱신 {useStoreState(s => s.rejectedUpdates)}건 · <button type="button" className="btn small" onClick={() => void getStore().load()}>snapshot 새로 조회</button></p>
        </div>
        {selectedModel && <MemberDrawer model={selectedModel} nowMs={now} onClose={closeDrawer} projectFilter={project} privacy={privacy} />}
      </div>
    </>
  );
}
