/**
 * Firebase provider — "공용 장부".
 * - 구글 로그인(소유자 이메일만 규칙으로 허용) 후 Firestore `workspaces/{uid}` 문서 하나에 workspace 전체를 둔다.
 * - 명령은 로컬과 같은 reducer(applyCommand)를 트랜잭션 안에서 적용한다. revision 이 바뀌어 있으면 재시도한다.
 * - onSnapshot 으로 다른 기기의 변경을 받는다. 역순 응답은 store 가 revision 으로 거부한다.
 * - Runner(실행 PC) 연결은 아직 없다. 관리형 실행 데이터는 다음 단계(Runner → 서버)에서 들어온다.
 * - 시각은 브라우저 시계를 쓴다(서버 보정 없음). heartbeat 는 Runner 단계에서 서버 시각으로 기록한다.
 * Firebase SDK 는 이 provider 를 처음 쓸 때만 동적으로 불러온다.
 */
import type { Workspace } from '../../domain/types';
import { applyCommand, CommandError, type Command } from '../commands';
import { ProviderNotConfiguredError, type WorkspaceProvider } from './types';
import { initialLocalWorkspace } from './localProvider';
import config from '../../firebase/firebase.config.json';

export const firebaseConfigured = Boolean(config.projectId && config.apiKey);

export class AuthRequiredError extends Error {
  constructor() { super('로그인이 필요합니다.'); this.name = 'AuthRequiredError'; }
}

export interface AuthState { signedIn: boolean; email: string | null; uid: string | null }

type Fb = {
  auth: import('firebase/auth').Auth;
  db: import('firebase/firestore').Firestore;
  mods: { auth: typeof import('firebase/auth'); fs: typeof import('firebase/firestore') };
};

let fbPromise: Promise<Fb> | null = null;
async function fb(): Promise<Fb> {
  if (!firebaseConfigured) throw new ProviderNotConfiguredError('Firebase 설정(src/firebase/firebase.config.json)이 비어 있습니다.');
  if (!fbPromise) {
    fbPromise = (async () => {
      const [{ initializeApp, getApps }, authMod, fsMod] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
      const app = getApps()[0] ?? initializeApp(config);
      const auth = authMod.getAuth(app);
      await authMod.setPersistence(auth, authMod.browserLocalPersistence);
      const db = fsMod.getFirestore(app);
      return { auth, db, mods: { auth: authMod, fs: fsMod } };
    })().catch(e => { fbPromise = null; throw e; });
  }
  return fbPromise;
}

const authListeners = new Set<(s: AuthState) => void>();
let authState: AuthState = { signedIn: false, email: null, uid: null };
let authWatching = false;
async function watchAuth() {
  if (authWatching) return;
  authWatching = true;
  const { auth, mods } = await fb();
  mods.auth.onAuthStateChanged(auth, user => {
    authState = { signedIn: Boolean(user), email: user?.email ?? null, uid: user?.uid ?? null };
    authListeners.forEach(l => l(authState));
  });
}
export function getAuthState(): AuthState { return authState; }
export function onAuthState(l: (s: AuthState) => void): () => void { authListeners.add(l); void watchAuth().catch(() => undefined); return () => { authListeners.delete(l); }; }

/** 현재 로그인 사용자를 기다린다 (최초 상태 확정까지). */
async function currentUser(): Promise<import('firebase/auth').User | null> {
  const { auth, mods } = await fb();
  await watchAuth();
  return new Promise(resolve => {
    const off = mods.auth.onAuthStateChanged(auth, u => { off(); resolve(u); });
  });
}

export async function signInWithGoogle(): Promise<void> {
  const { auth, mods } = await fb();
  const provider = new mods.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await mods.auth.signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      await mods.auth.signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}
export async function signOut(): Promise<void> {
  const { auth, mods } = await fb();
  await mods.auth.signOut(auth);
}

/** Firestore 는 undefined 를 거부하므로 JSON 왕복으로 정리한다. */
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createFirebaseProvider(now: () => Date = () => new Date()): WorkspaceProvider {
  let uid: string | null = null;
  const docRef = async () => {
    const { db, mods } = await fb();
    if (!uid) throw new AuthRequiredError();
    return mods.fs.doc(db, 'workspaces', uid);
  };
  return {
    info: { id: 'firebase', label: 'Firebase 공용 장부', description: '구글 로그인(소유자만). 모든 기기에서 같은 사무실. Runner 연결은 다음 단계.', provides_live_runs: false },
    async load() {
      const user = await currentUser();
      if (!user) throw new AuthRequiredError();
      if (!user.email) throw new Error('이메일이 없는 계정은 사용할 수 없습니다.');
      uid = user.uid;
      const { mods } = await fb();
      const ref = await docRef();
      const snap = await mods.fs.getDoc(ref);
      if (snap.exists()) return snap.data() as Workspace;
      // 처음 로그인: 로컬 모드와 같은 초기 팀원(Gemini·NotebookLM)으로 시작. 데모 fixture 는 넣지 않는다.
      const ws: Workspace = { ...initialLocalWorkspace(now().toISOString()), workspace_id: `fb-${user.uid}` };
      await mods.fs.setDoc(ref, clean(ws));
      return ws;
    },
    subscribe(onWorkspace, onError) {
      let off: (() => void) | null = null;
      let stopped = false;
      (async () => {
        try {
          const { mods } = await fb();
          const ref = await docRef();
          if (stopped) return;
          off = mods.fs.onSnapshot(ref, snap => { if (snap.exists() && !snap.metadata.hasPendingWrites) onWorkspace(snap.data() as Workspace); }, e => onError(e));
        } catch (e) { onError(e instanceof Error ? e : new Error(String(e))); }
      })();
      return () => { stopped = true; off?.(); };
    },
    async command(cmd: Command) {
      const { db, mods } = await fb();
      const ref = await docRef();
      let result: Workspace | null = null;
      let appError: CommandError | null = null;
      await mods.fs.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('workspace 문서가 없습니다. 다시 로그인하세요.');
        const current = snap.data() as Workspace;
        try {
          const next = applyCommand(current, cmd, now().toISOString());
          result = next;
          if (next !== current) tx.set(ref, clean(next));
        } catch (e) {
          if (e instanceof CommandError) { appError = e; result = current; return; }
          throw e;
        }
      });
      if (appError) throw appError;
      return result!;
    },
    clockOffsetMs: () => 0,
  };
}
