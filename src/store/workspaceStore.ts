/**
 * 단일 Workspace Store. 대시보드와 픽셀 사무실이 같은 스토어를 읽는다.
 * - 들어오는 workspace 는 revision 이 현재보다 클 때만 받는다(역순 응답 거부).
 * - workspace_id 나 demo/live 가 바뀌면 화면 상태를 명시적으로 초기화한다.
 */
import { useSyncExternalStore } from 'react';
import type { Workspace } from '../domain/types';
import type { Command } from './commands';
import type { DataSource, WorkspaceProvider } from './providers/types';
import { ProviderNotConfiguredError } from './providers/types';
import { createDemoProvider } from './providers/demoProvider';
import { createLocalProvider } from './providers/localProvider';
import { createHttpProvider } from './providers/httpProvider';
import { createFirebaseProvider, firebaseConfigured, AuthRequiredError } from './providers/firebaseProvider';

export type StoreStatus = 'idle' | 'loading' | 'ready' | 'error' | 'not_configured' | 'auth_required';

export interface StoreState {
  source: DataSource;
  status: StoreStatus;
  error: string | null;
  workspace: Workspace | null;
  clockOffsetMs: number;
  lastSyncAt: string | null;
  /** 사용자 선택 대표 작업 (member_id → task_id). 서버 실행이 있으면 서버가 우선. */
  preferredTask: Record<string, string | null>;
  /** 역순/중복 응답이 거부된 횟수 (진단용) */
  rejectedUpdates: number;
}

const SOURCE_KEY = 'ai-office.data-source';
const DEMO_SESSION_KEY = 'ai-office.demo-session';

function readDefaultSource(): DataSource {
  try {
    if (sessionStorage.getItem(DEMO_SESSION_KEY) === '1') return 'demo';
    const saved = localStorage.getItem(SOURCE_KEY);
    if (saved === 'http' || saved === 'local' || (saved === 'firebase' && firebaseConfigured)) return saved;
  } catch { /* storage 없음 */ }
  if (firebaseConfigured) return 'firebase';
  return import.meta.env.VITE_AI_OFFICE_API ? 'http' : 'local';
}

export function createProvider(source: DataSource): WorkspaceProvider {
  if (source === 'demo') return createDemoProvider();
  if (source === 'firebase') return createFirebaseProvider();
  if (source === 'http') return createHttpProvider(import.meta.env.VITE_AI_OFFICE_API as string | undefined);
  let storage: Storage | null = null;
  try { storage = localStorage; } catch { storage = null; }
  return createLocalProvider(storage);
}

type Listener = () => void;

export class WorkspaceStore {
  private state: StoreState;
  private listeners = new Set<Listener>();
  private provider: WorkspaceProvider;
  private unsubscribeProvider: (() => void) | null = null;
  private loadToken = 0;

  private readonly makeProvider: (s: DataSource) => WorkspaceProvider;

  constructor(makeProvider: (s: DataSource) => WorkspaceProvider, initialSource: DataSource) {
    this.makeProvider = makeProvider;
    this.provider = makeProvider(initialSource);
    this.state = {
      source: initialSource, status: 'idle', error: null, workspace: null,
      clockOffsetMs: 0, lastSyncAt: null, preferredTask: {}, rejectedUpdates: 0,
    };
  }

  getState = (): StoreState => this.state;
  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(l => l());
  }

  get providerInfo() { return this.provider.info; }

  /** 서버 보정 시각. 렌더러 ticker 시각이 아니다. */
  now(): number { return Date.now() + this.state.clockOffsetMs; }

  async load(): Promise<void> {
    const token = ++this.loadToken;
    this.set({ status: 'loading', error: null });
    try {
      const ws = await this.provider.load();
      if (token !== this.loadToken) return;
      this.set({ workspace: ws, status: 'ready', error: null, clockOffsetMs: this.provider.clockOffsetMs(), lastSyncAt: new Date().toISOString() });
      this.unsubscribeProvider?.();
      this.unsubscribeProvider = this.provider.subscribe?.(
        incoming => this.accept(incoming),
        e => this.set({ error: e.message }),
      ) ?? null;
    } catch (e) {
      if (token !== this.loadToken) return;
      const status: StoreStatus = e instanceof ProviderNotConfiguredError ? 'not_configured' : e instanceof AuthRequiredError ? 'auth_required' : 'error';
      this.set({ status, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 들어온 workspace 를 revision 규칙으로 받아들인다. */
  accept(incoming: Workspace): boolean {
    const cur = this.state.workspace;
    if (cur && (cur.workspace_id !== incoming.workspace_id || cur.is_demo !== incoming.is_demo)) {
      // 재바인딩: 화면 상태를 명시적으로 초기화한다.
      this.set({ workspace: incoming, preferredTask: {}, lastSyncAt: new Date().toISOString(), clockOffsetMs: this.provider.clockOffsetMs() });
      return true;
    }
    if (cur && incoming.revision < cur.revision) {
      this.set({ rejectedUpdates: this.state.rejectedUpdates + 1 });
      return false;
    }
    if (cur && incoming.revision === cur.revision && incoming !== cur) {
      // 같은 revision 의 중복 응답: UI 설정만 갱신 가능 (update_ui 는 revision 을 올리지 않는다)
      this.set({ workspace: incoming, lastSyncAt: new Date().toISOString() });
      return true;
    }
    this.set({ workspace: incoming, lastSyncAt: new Date().toISOString(), clockOffsetMs: this.provider.clockOffsetMs() });
    return true;
  }

  async command(cmd: Command): Promise<void> {
    const ws = await this.provider.command(cmd);
    this.accept(ws);
  }

  setPreferredTask(memberId: string, taskId: string | null) {
    this.set({ preferredTask: { ...this.state.preferredTask, [memberId]: taskId } });
  }

  async switchSource(source: DataSource): Promise<void> {
    this.unsubscribeProvider?.();
    this.unsubscribeProvider = null;
    this.provider = this.makeProvider(source);
    try {
      if (source === 'demo') sessionStorage.setItem(DEMO_SESSION_KEY, '1');
      else { sessionStorage.removeItem(DEMO_SESSION_KEY); localStorage.setItem(SOURCE_KEY, source); }
    } catch { /* ignore */ }
    this.set({ source, workspace: null, status: 'idle', error: null, preferredTask: {}, rejectedUpdates: 0 });
    await this.load();
  }

  dispose() { this.unsubscribeProvider?.(); this.unsubscribeProvider = null; }
}

let singleton: WorkspaceStore | null = null;
export function getStore(): WorkspaceStore {
  if (!singleton) singleton = new WorkspaceStore(createProvider, readDefaultSource());
  return singleton;
}

export function useStoreState<T>(selector: (s: StoreState) => T): T {
  const store = getStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}
export function useWorkspace(): Workspace | null { return useStoreState(s => s.workspace); }
