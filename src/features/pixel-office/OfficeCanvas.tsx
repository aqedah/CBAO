/**
 * PixiJS 생명주기 + 카메라 + 포인터. React effect 가 외부 시스템(renderer)과 동기화·정리한다.
 * - init 전 unmount: cancelled 플래그. init 완료 후 canvas 를 붙이지 않고 바로 정리.
 * - 상태 변경: 기존 scene 객체에 setSeatVisual 만 호출. renderer 재생성 금지.
 * - DOM 명패와 포인터는 같은 카메라 변환(sceneToClient/clientToScene)을 쓴다. DPR 은 CSS 변환에만 맡긴다.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type WheelEvent as RWheelEvent } from 'react';
import { Application } from 'pixi.js';
import { loadAtlas } from './renderer/assets';
import { createOfficeScene, type OfficeScene, type SeatVisual } from './renderer/createOfficeScene';
import { SCENE } from './config/sceneTypes';
import { clientToScene, type Camera } from './renderer/projectCoordinates';

export interface Target { kind: 'seat' | 'object'; id: string }
export interface CanvasStatus { phase: 'loading' | 'ready' | 'error'; error: string | null; missingAssets: string[]; renderer: string | null }

interface Props {
  seatVisuals: Map<string, SeatVisual>;
  motionPaused: boolean;
  onSelect(target: Target | null): void;
  onHover(target: Target | null): void;
  onStatus(status: CanvasStatus): void;
  /** 카메라 변환이 정해진 뒤 DOM 오버레이를 그린다 (명패). */
  overlay(camera: Camera, anchors: { seat(id: string): { x: number; y: number }; object(id: string): { x: number; y: number } }): ReactNode;
  retryKey: number;
}

const [LW, LH] = SCENE.renderer.logical_size;
const ZOOM_LEVELS = [1, 1.5, 2, 3];
/** 장면 내용이 차지하는 논리 영역 (벽 포함). 빈 여백이 아니라 방에 맞춘다. */
const CONTENT = { x: 130, y: 36, w: 712, h: 440 };

export function OfficeCanvas({ seatVisuals, motionPaused, onSelect, onHover, onStatus, overlay, retryKey }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasHolderRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const [ready, setReady] = useState(false);
  const [fitScale, setFitScale] = useState(1);
  const [zoomIdx, setZoomIdx] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean; pointerId: number } | null>(null);
  const lastHoverRef = useRef<string | null>(null);

  const scale = fitScale * ZOOM_LEVELS[zoomIdx];
  const camera: Camera = { scale, panX: Math.round(pan.x), panY: Math.round(pan.y) };

  // ---- renderer 생명주기
  useEffect(() => {
    let cancelled = false;
    let initialized = false;
    const app = new Application();
    appRef.current = app;
    onStatus({ phase: 'loading', error: null, missingAssets: [], renderer: null });
    const host = canvasHolderRef.current;
    let onLost: (() => void) | null = null;
    (async () => {
      let atlas = null;
      let assetError: string | null = null;
      try { atlas = await loadAtlas(); } catch (e) { assetError = e instanceof Error ? e.message : String(e); }
      if (cancelled) return;
      try {
        await app.init({ width: LW, height: LH, antialias: false, resolution: 1, autoDensity: false, backgroundAlpha: 0, preference: ['webgl', 'canvas'], powerPreference: 'low-power' });
      } catch (e) {
        if (!cancelled) onStatus({ phase: 'error', error: `렌더러(WebGL/Canvas)를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, missingAssets: [], renderer: null });
        return;
      }
      initialized = true;
      if (cancelled) { app.destroy(true, { children: true }); return; }
      const scene = createOfficeScene(atlas);
      sceneRef.current = scene;
      app.stage.addChild(scene.root);
      app.ticker.maxFPS = SCENE.motion.renderer_fps_cap;
      app.ticker.add(t => scene.tick(t.deltaMS));
      const canvas = app.canvas as HTMLCanvasElement;
      canvas.style.imageRendering = 'pixelated';
      canvas.style.transformOrigin = '0 0';
      canvas.style.position = 'absolute';
      canvas.style.left = '0'; canvas.style.top = '0';
      canvas.setAttribute('aria-hidden', 'true');
      const rendererName = app.renderer.name;
      onLost = () => onStatus({ phase: 'error', error: 'WebGL context 가 손실되었습니다. 다시 시도하세요.', missingAssets: scene.missingAssets, renderer: rendererName });
      canvas.addEventListener('webglcontextlost', onLost);
      host?.appendChild(canvas);
      // e2e 진단용 훅 (명령·데이터 접근 없음, renderer 객체만)
      const prevDbg = (window as unknown as { __aiOfficeDebug?: { created?: number; destroyed?: number } }).__aiOfficeDebug;
      (window as unknown as { __aiOfficeDebug?: unknown }).__aiOfficeDebug = { app, scene, created: (prevDbg?.created ?? 0) + 1, destroyed: prevDbg?.destroyed ?? 0 };
      setReady(true);
      const missing = [...scene.missingAssets];
      onStatus({ phase: 'ready', error: assetError ? `에셋 로딩 실패: ${assetError} (대체 도형으로 표시)` : null, missingAssets: missing, renderer: rendererName });
    })();
    return () => {
      cancelled = true;
      setReady(false);
      const scene = sceneRef.current; sceneRef.current = null;
      if (initialized) {
        if (onLost) (app.canvas as HTMLCanvasElement).removeEventListener('webglcontextlost', onLost);
        try { scene?.destroy(); } catch { /* already destroyed */ }
        app.destroy(true, { children: true });
      }
      appRef.current = null;
      const dbg = (window as unknown as { __aiOfficeDebug?: { created?: number; destroyed?: number } }).__aiOfficeDebug;
      if (dbg) { dbg.destroyed = (dbg.destroyed ?? 0) + (initialized ? 1 : 0); }
    };
    // retryKey 가 바뀌면 전체를 다시 만든다 (명시적 재시도)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  // ---- 상태 반영 (scene 재생성 없음)
  useEffect(() => {
    const scene = sceneRef.current; if (!scene || !ready) return;
    for (const [seatId, v] of seatVisuals) scene.setSeatVisual(seatId, v);
  }, [seatVisuals, ready]);

  // ---- 움직임 정지 (숨김 탭, reduce motion, 사용자 설정)
  useEffect(() => {
    const scene = sceneRef.current, app = appRef.current; if (!scene || !app || !ready) return;
    scene.setMotionPaused(motionPaused);
    if (motionPaused) app.ticker.stop(); else app.ticker.start();
  }, [motionPaused, ready]);

  // ---- 카메라 맞춤 + 리사이즈
  const fit = useCallback(() => {
    const host = hostRef.current; if (!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const s = Math.min(w / CONTENT.w, h / CONTENT.h);
    const snapped = s >= 1 ? Math.floor(s * 4) / 4 : s;
    setFitScale(snapped);
    setZoomIdx(0);
    setPan({ x: (w - CONTENT.w * snapped) / 2 - CONTENT.x * snapped, y: (h - CONTENT.h * snapped) / 2 - CONTENT.y * snapped });
  }, []);
  useLayoutEffect(() => {
    fit();
    const host = hostRef.current; if (!host) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(host);
    return () => ro.disconnect();
  }, [fit]);
  useLayoutEffect(() => {
    const app = appRef.current; if (!app || !ready) return;
    (app.canvas as HTMLCanvasElement).style.transform = `translate(${camera.panX}px, ${camera.panY}px) scale(${camera.scale})`;
  }, [camera.panX, camera.panY, camera.scale, ready]);

  const zoomTo = (idx: number, cx?: number, cy?: number) => {
    const host = hostRef.current; if (!host) return;
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx));
    const s0 = fitScale * ZOOM_LEVELS[zoomIdx], s1 = fitScale * ZOOM_LEVELS[next];
    const px = cx ?? host.clientWidth / 2, py = cy ?? host.clientHeight / 2;
    // 커서/중심 아래 장면 점을 고정
    setPan(p => ({ x: px - (px - p.x) * (s1 / s0), y: py - (py - p.y) * (s1 / s0) }));
    setZoomIdx(next);
  };

  // ---- 포인터: 드래그(이동량 임계값) vs 클릭
  const hitAt = (clientX: number, clientY: number): Target | null => {
    const scene = sceneRef.current, host = hostRef.current; if (!scene || !host) return null;
    const rect = host.getBoundingClientRect();
    const p = clientToScene({ x: clientX, y: clientY }, camera, rect);
    // 화면 아래쪽(앞)에 있는 대상이 우선 → 나중에 검사된 것이 덮는다
    const hits = scene.hitTargets.filter(t => t.contains(p.x, p.y)).sort((a, b) => b.anchor.y - a.anchor.y);
    const h = hits[0];
    return h ? { kind: h.kind, id: h.id } : null;
  };
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.nameplate, .room-toolbar')) return;
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false, pointerId: e.pointerId };
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d && e.pointerId === d.pointerId) {
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; setDragging(true); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }
      if (d.moved) setPan({ x: d.panX + dx, y: d.panY + dy });
      return;
    }
    if (e.pointerType === 'mouse') {
      const t = hitAt(e.clientX, e.clientY);
      const key = t ? `${t.kind}:${t.id}` : null;
      if (key !== lastHoverRef.current) { lastHoverRef.current = key; onHover(t); }
    }
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current; dragRef.current = null;
    setDragging(false);
    if (!d || d.moved) return;
    if ((e.target as HTMLElement).closest('.nameplate, .room-toolbar')) return;
    onSelect(hitAt(e.clientX, e.clientY));
  };
  const onWheel = (e: RWheelEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return; // 페이지 스크롤 우선
    e.preventDefault();
    const rect = hostRef.current!.getBoundingClientRect();
    zoomTo(zoomIdx + (e.deltaY < 0 ? 1 : -1), e.clientX - rect.left, e.clientY - rect.top);
  };
  useEffect(() => {
    // React 의 onWheel 은 passive 라 preventDefault 가 안 되므로 직접 등록
    const host = hostRef.current; if (!host) return;
    const h = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    host.addEventListener('wheel', h, { passive: false });
    return () => host.removeEventListener('wheel', h);
  }, []);

  const anchors = {
    seat: (id: string) => sceneRef.current?.seatAnchor(id) ?? { x: 0, y: 0 },
    object: (id: string) => sceneRef.current?.objectAnchor(id) ?? { x: 0, y: 0 },
  };

  return (
    <div
      ref={hostRef}
      className={`room-stage${dragging ? ' dragging' : ''}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onPointerLeave={() => { if (lastHoverRef.current) { lastHoverRef.current = null; onHover(null); } }}
      onWheel={onWheel}
      role="presentation"
    >
      <div ref={canvasHolderRef} style={{ position: 'absolute', inset: 0 }} />
      <div className="room-toolbar">
        <button type="button" className="btn" onClick={fit} aria-label="화면 맞춤">맞춤</button>
        <button type="button" className="btn" onClick={() => zoomTo(zoomIdx + 1)} aria-label="확대" disabled={zoomIdx >= ZOOM_LEVELS.length - 1}>＋</button>
        <button type="button" className="btn" onClick={() => zoomTo(zoomIdx - 1)} aria-label="축소" disabled={zoomIdx <= 0}>－</button>
      </div>
      {ready && <div className="room-overlay" aria-hidden="true">{overlay(camera, anchors)}</div>}
      <div className="room-hint">드래그: 이동 · Ctrl+휠 또는 버튼: 확대</div>
    </div>
  );
}
