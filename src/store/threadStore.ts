/**
 * 대화방 스토어 (Firebase 전용). 로컬/데모 모드에서는 비활성.
 * 쓰기는 소유자만(규칙), 실행·중계는 Runner 가 한다. 여기서는 큐에 넣기만 한다.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { Thread, ChatMessage, PendingTurn } from '../domain/chat';
import { MAX_MESSAGES, newId } from '../domain/chat';
import { firebaseConfigured, getAuthState } from './providers/firebaseProvider';
import { getStore } from './workspaceStore';
import { CommandError } from './commands';

type Fs = typeof import('firebase/firestore');
let fsMod: Promise<{ fs: Fs; db: import('firebase/firestore').Firestore }> | null = null;
async function fs() {
  if (!fsMod) {
    fsMod = (async () => {
      const [{ getApps }, f] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
      const app = getApps()[0];
      if (!app) throw new Error('Firebase 가 초기화되지 않았습니다. 먼저 로그인하세요.');
      return { fs: f, db: f.getFirestore(app) };
    })().catch(e => { fsMod = null; throw e; });
  }
  return fsMod;
}
function uid(): string {
  const u = getAuthState().uid;
  if (!u) throw new CommandError('로그인이 필요합니다.', 'forbidden');
  return u;
}
const nowIso = () => new Date().toISOString();
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let threads: Thread[] = [];
let loaded = false;
let error: string | null = null;
/** useSyncExternalStore 는 같은 객체를 돌려줘야 한다 (매번 새 객체면 무한 렌더링). */
let snapshot: { threads: Thread[]; loaded: boolean; error: string | null } = { threads, loaded, error };
const listeners = new Set<() => void>();
const emit = () => { snapshot = { threads, loaded, error }; listeners.forEach(l => l()); };
let unsub: (() => void) | null = null;

export function startThreadSubscription() {
  if (unsub || !firebaseConfigured) return;
  const u = getAuthState().uid; if (!u) return;
  void fs().then(({ fs: f, db }) => {
    const col = f.collection(db, 'workspaces', u, 'threads');
    unsub = f.onSnapshot(f.query(col, f.orderBy('updated_at', 'desc'), f.limit(100)), snap => {
      threads = snap.docs.map(d => d.data() as Thread); loaded = true; error = null; emit();
    }, e => { error = e.message; loaded = true; emit(); });
  }).catch(e => { error = e instanceof Error ? e.message : String(e); loaded = true; emit(); });
}
export function stopThreadSubscription() { unsub?.(); unsub = null; threads = []; loaded = false; emit(); }

export function useThreads(): { threads: Thread[]; loaded: boolean; error: string | null } {
  useEffect(() => { startThreadSubscription(); }, []);
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => snapshot, () => snapshot);
}

async function threadRef(threadId: string) {
  const { fs: f, db } = await fs();
  return { f, db, ref: f.doc(db, 'workspaces', uid(), 'threads', threadId) };
}

export async function createThread(projectId: string, memberId: string, title: string): Promise<string> {
  const { f, ref } = await threadRef(newId('chat'));
  const id = ref.id;
  const t: Thread = {
    thread_id: id, project_id: projectId, title: title.trim().slice(0, 120) || '새 대화', created_at: nowIso(), updated_at: nowIso(),
    member_id: memberId, status: 'idle', pending: null, sessions: {}, messages: [], auto_review_member_id: null, auto_review_done: false,
    last_publish: null, publish_count: 0,
  };
  await f.setDoc(ref, clean(t));
  // 장부의 작업 카드와 1:1 연결 (대시보드·픽셀 사무실 상태용)
  await getStore().command({ type: 'create_task', project_id: projectId, assignee_member_id: memberId, title: t.title, goal: '(채팅 대화방)', done_criteria: '소유자 반영', idempotency_key: id, task_id: id });
  return id;
}

async function queueTurn(threadId: string, memberId: string, mode: PendingTurn['mode'], message: ChatMessage | null) {
  const { f, db, ref } = await threadRef(threadId);
  await f.runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new CommandError('대화방이 없습니다.', 'not_found');
    const t = snap.data() as Thread;
    if (t.status !== 'idle') throw new CommandError('지금 실행 중입니다. 끝난 뒤 보내세요.', 'conflict');
    const messages = [...t.messages, ...(message ? [message] : [])].slice(-MAX_MESSAGES);
    const pending: PendingTurn = { turn_id: newId('turn'), member_id: memberId, mode, message_id: message?.message_id ?? null, requested_at: nowIso() };
    tx.set(ref, clean({ ...t, messages, member_id: mode === 'chat' ? memberId : t.member_id, status: 'queued', pending, updated_at: nowIso(),
      auto_review_done: mode === 'chat' ? false : t.auto_review_done, auto_fix_done: mode === 'chat' ? false : (t as Thread & { auto_fix_done?: boolean }).auto_fix_done ?? false }));
  });
}

export async function sendOwnerMessage(threadId: string, memberId: string, text: string) {
  const msg: ChatMessage = { message_id: newId('msg'), role: 'owner', member_id: null, kind: 'chat', text: text.trim().slice(0, 8000), at: nowIso() };
  await queueTurn(threadId, memberId, 'chat', msg);
}
export async function requestReview(threadId: string, reviewerId: string) {
  const msg: ChatMessage = { message_id: newId('msg'), role: 'system', member_id: reviewerId, kind: 'chat', text: `검토 요청 → ${reviewerId} (읽기 전용)`, at: nowIso() };
  await queueTurn(threadId, reviewerId, 'review', msg);
}
export async function requestPublish(threadId: string, memberId: string) {
  const msg: ChatMessage = { message_id: newId('msg'), role: 'owner', member_id: null, kind: 'publish', text: '반영 요청 (GitHub main)', at: nowIso() };
  await queueTurn(threadId, memberId, 'publish', msg);
}
export async function setAutoReview(threadId: string, reviewerId: string | null) {
  const { f, ref } = await threadRef(threadId);
  await f.updateDoc(ref, { auto_review_member_id: reviewerId, updated_at: nowIso() });
}
export async function cancelPending(threadId: string) {
  const { f, db, ref } = await threadRef(threadId);
  await f.runTransaction(db, async tx => {
    const snap = await tx.get(ref); if (!snap.exists()) return;
    const t = snap.data() as Thread;
    if (t.status === 'queued') tx.set(ref, clean({ ...t, status: 'idle', pending: null, updated_at: nowIso() }));
  });
}
