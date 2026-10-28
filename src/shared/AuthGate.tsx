/** Firebase 로그인 상태 표시와 로그인/로그아웃. 소유자 이메일만 Firestore 규칙으로 통과한다. */
import { useEffect, useState } from 'react';
import { getStore, useStoreState } from '../store/workspaceStore';
import { firebaseConfigured, getAuthState, onAuthState, signInWithGoogle, signOut, type AuthState } from '../store/providers/firebaseProvider';

export function useAuth(): AuthState {
  const [s, setS] = useState<AuthState>(getAuthState());
  useEffect(() => (firebaseConfigured ? onAuthState(setS) : undefined), []);
  return s;
}

export function AuthGate() {
  const source = useStoreState(s => s.source);
  const status = useStoreState(s => s.status);
  const error = useStoreState(s => s.error);
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 로그인 완료 → 장부 다시 불러오기
  useEffect(() => {
    if (source === 'firebase' && auth.signedIn && status === 'auth_required') void getStore().load();
  }, [source, auth.signedIn, status]);

  if (source !== 'firebase') return null;
  const login = async () => {
    setBusy(true); setMsg(null);
    try { await signInWithGoogle(); } catch (e) { setMsg(`로그인 실패: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  const logout = async () => { await signOut(); await getStore().load(); };

  if (status === 'auth_required' || !auth.signedIn) {
    return (
      <div className="notice info" role="status">
        <strong>공용 장부(Firebase)</strong>를 쓰려면 구글 로그인이 필요합니다. 소유자 계정만 허용됩니다.
        <button type="button" className="btn primary small" style={{ marginLeft: 10 }} onClick={() => void login()} disabled={busy}>구글로 로그인</button>
        {msg && <div className="meta" style={{ marginTop: 6 }}>{msg}</div>}
      </div>
    );
  }
  if (status === 'error' && error) {
    return (
      <div className="notice error" role="alert">
        장부를 읽지 못했습니다: {error} — 로그인한 계정({auth.email})이 허용 목록에 없거나 Firestore 규칙이 아직 게시되지 않았을 수 있습니다.
        <button type="button" className="btn small" style={{ marginLeft: 10 }} onClick={() => void getStore().load()}>다시 시도</button>
        <button type="button" className="btn small" style={{ marginLeft: 6 }} onClick={() => void logout()}>로그아웃</button>
      </div>
    );
  }
  return null;
}

export function AuthStatusInline() {
  const auth = useAuth();
  const source = useStoreState(s => s.source);
  if (source !== 'firebase') return null;
  return auth.signedIn
    ? <span>로그인: {auth.email} · 장부 UID <code title="심부름꾼 config.json 의 workspace_uid 에 적는 값">{auth.uid}</code> <button type="button" className="btn small" onClick={() => void signOut().then(() => getStore().load())}>로그아웃</button></span>
    : <span>로그인 안 됨</span>;
}
