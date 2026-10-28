import { useEffect, useState, type ReactNode } from 'react';
import { getStore, useStoreState } from '../store/workspaceStore';
import type { ColorToken } from '../domain/viewModel';

export function Badge({ tone, children, title }: { tone: ColorToken | 'demo' | 'count'; children: ReactNode; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

/** 서버 보정 시각을 5초마다 갱신. 애니메이션 프레임이 아니다. */
export function useServerNow(intervalMs = 5000): number {
  const store = getStore();
  const [now, setNow] = useState(() => store.now());
  useEffect(() => {
    const id = setInterval(() => setNow(store.now()), intervalMs);
    return () => clearInterval(id);
  }, [store, intervalMs]);
  return now;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function formatAge(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '확인 기록 없음';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '시각 오류';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export function DemoBanner() {
  const ws = useStoreState(s => s.workspace);
  const source = useStoreState(s => s.source);
  if (!ws?.is_demo && source !== 'demo') return null;
  return (
    <div className="demo-banner" role="status">
      <span>데모 데이터 — 실제 실행·연결·보고가 아닙니다. 가짜 fixture 를 보고 있습니다.</span>
      <button type="button" onClick={() => void getStore().command({ type: 'demo_refresh' })}>데모 시각 새로고침</button>
      <button type="button" onClick={() => void getStore().switchSource(import.meta.env.VITE_AI_OFFICE_API ? 'http' : 'local')}>데모 끄기</button>
    </div>
  );
}

export function SourceLine() {
  const source = useStoreState(s => s.source);
  const status = useStoreState(s => s.status);
  const lastSync = useStoreState(s => s.lastSyncAt);
  const error = useStoreState(s => s.error);
  const ws = useStoreState(s => s.workspace);
  const now = useServerNow();
  const info = getStore().providerInfo;
  const label = status === 'ready' ? '정상' : status === 'loading' ? '불러오는 중' : status === 'not_configured' ? '미설정' : status === 'error' ? '오류' : '대기';
  return (
    <div className="source-line">
      <span>데이터: <strong>{info.label}</strong> · {label}</span>
      {ws && <span>revision {ws.revision} · 기준 시각 {formatTime(ws.captured_at)} ({formatAge(ws.captured_at, now)})</span>}
      {lastSync && <span>마지막 동기화 {formatTime(lastSync)}</span>}
      {source !== 'demo' && !info.provides_live_runs && <span className="badge attention">Runner 없음 · 수동 보고만 가능</span>}
      {error && <span className="badge error">{error}</span>}
    </div>
  );
}

export function StateIcon({ icon }: { icon: string }) {
  const map: Record<string, string> = {
    plug: '⏚', question: '?', clock: '◷', keyboard: '⌨', checklist: '☑', book: '📖', message: '💬', external: '↗',
    bell: '🔔', warning: '⚠', pause: '⏸', disconnect: '⛔', inbox: '📥', check: '✔', stop: '■', chair: '·', server: '▣',
  };
  return <span className="state-icon" aria-hidden="true">{map[icon] ?? '·'}</span>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https:\/\//i.test(href)) return <span>{children} (허용되지 않은 링크)</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}
