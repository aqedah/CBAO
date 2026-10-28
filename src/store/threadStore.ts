/**
 * 대화방 스토어 (Firebase 전용). 로컬/데모 모드에서는 비활성.
 * 쓰기는 소유자만(규칙), 실행·중계는 Runner 가 한다. 여기서는 큐에 넣기만 한다.
 *
 * V2: 메시지 원본은 threads/{id}/messages 하위 컬렉션. 대화방 목록은 요약만 구독하고,
 * 열어 둔 대화방 하나의 메시지만 최근 PAGE_MESSAGES 개씩 구독한다 (더 보기로 이전 페이지).
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { Thread, ChatMessage, PendingTurn, TurnMode } from '../domain/chat';
import { MAX_MESSAGES, PAGE_MESSAGES, newId } from '../domain/chat';
import { firebaseConfigured, getAuthState, onAuthState } from './providers/firebaseProvider';
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

/* ---------- 대화방 목록 ---------- */
let threads: Thread[] = [];
let loaded = false;
let error: string | null = null;
let snapshot: { threads: Thread[]; loaded: boolean; error: string | null } = { threads, loaded, error };
const listeners = new Set<() => void>();
const emit = () => { snapshot = { threads, loaded, error }; listeners.forEach(l => l()); };
let unsub: (() => void) | null = null;

let authWatcher: (() => void) | null = null;
export function startThreadSubscription() {
  if (unsub || !firebaseConfigured) return;
  const u = getAuthState().uid;
  if (!u) {
    if (!authWatcher) authWatcher = onAuthState(st => { if (st.uid) { authWatcher?.(); authWatcher = null; startThreadSubscription(); } else { threads = []; loaded = true; error = null; emit(); } });
    return;
  }
  void fs().then(({ fs: f, db }) => {
    const col = f.collection(db, 'workspaces', u, 'threads');
    unsub = f.onSnapshot(f.query(col, f.orderBy('updated_at', 'desc'), f.limit(100)), snap => {
      threads = snap.docs.map(d => d.data() as Thread); loaded = true; error = null; emit();
    }, e => { error = e.message; loaded = true; emit(); });
  }).catch(e => { error = e instanceof Error ? e.message : String(e); loaded = true; emit(); });
}
export function stopThreadSubscription() { unsub?.(); unsub = null; threads = []; loaded = false; emit(); stopMessages(); }

export function useThreads(): { threads: Thread[]; loaded: boolean; error: string | null } {
  useEffect(() => { startThreadSubscription(); }, []);
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => snapshot, () => snapshot);
}

/* ---------- 열어 둔 대화방의 메시지 (하위 컬렉션, 페이지네이션) ---------- */
interface MsgState { threadId: string | null; messages: ChatMessage[]; loaded: boolean; hasMore: boolean; error: string | null; legacy: boolean }
let msgState: MsgState = { threadId: null, messages: [], loaded: false, hasMore: false, error: null, legacy: false };
const msgListeners = new Set<() => void>();
const msgEmit = () => { msgState = { ...msgState }; msgListeners.forEach(l => l()); };
let msgUnsub: (() => void) | null = null;
let pageLimit = PAGE_MESSAGES;
function stopMessages() { msgUnsub?.(); msgUnsub = null; msgState = { threadId: null, messages: [], loaded: false, hasMore: false, error: null, legacy: false }; msgEmit(); }

function subscribeMessages(threadId: string, limit: number) {
  msgUnsub?.(); msgUnsub = null;
  const u = getAuthState().uid; if (!u) return;
  void fs().then(({ fs: f, db }) => {
    const col = f.collection(db, 'workspaces', u, 'threads', threadId, 'messages');
    msgUnsub = f.onSnapshot(f.query(col, f.orderBy('seq', 'desc'), f.limit(limit)), snap => {
      const rows = snap.docs.map(d => d.data() as ChatMessage).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      msgState = { ...msgState, threadId, messages: rows, loaded: true, hasMore: snap.docs.length >= limit, error: null };
      msgEmit();
    }, e => { msgState = { ...msgState, threadId, loaded: true, error: e.message }; msgEmit(); });
  }).catch(e => { msgState = { ...msgState, threadId, loaded: true, error: e instanceof Error ? e.message : String(e) }; msgEmit(); });
}

/** 메시지 구독 훅. schema 1(레거시) 대화방은 배열을 그대로 보여 주고, 옮기기는 Runner 가 한다. */
export function useThreadMessages(thread: Thread | null): MsgState & { loadMore(): void } {
  const id = thread?.thread_id ?? null;
  const schema = thread?.schema_version ?? 1;
  useEffect(() => {
    if (!id) { stopMessages(); return; }
    pageLimit = PAGE_MESSAGES;
    if (schema >= 2) { msgState = { threadId: id, messages: [], loaded: false, hasMore: false, error: null, legacy: false }; msgEmit(); subscribeMessages(id, pageLimit); }
    else { msgUnsub?.(); msgUnsub = null; msgState = { threadId: id, messages: [], loaded: true, hasMore: false, error: null, legacy: true }; msgEmit(); }
    return () => { /* 다음 대화방이 다시 구독한다 */ };
  }, [id, schema]);
  const st = useSyncExternalStore(l => { msgListeners.add(l); return () => { msgListeners.delete(l); }; }, () => msgState, () => msgState);
  const effective: MsgState = st.legacy && thread ? { ...st, messages: thread.messages ?? [] } : st;
  return { ...effective, loadMore: () => { if (id && schema >= 2) { pageLimit += PAGE_MESSAGES; subscribeMessages(id, pageLimit); } } };
}

async function threadRef(threadId: string) {
  const { fs: f, db } = await fs();
  return { f, db, ref: f.doc(db, 'workspaces', uid(), 'threads', threadId) };
}

export async function createThread(projectId: string, memberId: string, title: string): Promise<string> {
  const { f, ref } = await threadRef(newId('chat'));
  const id = ref.id;
  const t: Thread = {
    thread_id: id, project_id: projectId, title: title.trim().slice(0, 120) || '새 대화', created_at: nowIso(), updated_at: nowIso(), schema_version: 2,
    member_id: memberId, status: 'idle', pending: null, sessions: {}, messages: [], message_count: 0, last_message: null, next_messages: [],
    auto_review_member_id: null, auto_review_done: false, fix_rounds: 0, needs_owner: null, checkpoints: [], reviews: [], sync: null,
    context: { version: 0, decisions: [], open_questions: [], delivered: {} }, last_publish: null, publish_count: 0,
  };
  await f.setDoc(ref, clean(t));
  // 장부의 작업 카드와 1:1 연결 (대시보드·픽셀 사무실 상태용)
  await getStore().command({ type: 'create_task', project_id: projectId, assignee_member_id: memberId, title: t.title, goal: '(채팅 대화방)', done_criteria: '소유자 반영', idempotency_key: id, task_id: id });
  return id;
}

/**
 * 턴을 큐에 넣는다. 같은 client_message_id(=message_id) 는 한 번만 들어간다 (CHAT-06).
 * 실행 중이면: 메시지는 저장하고 next_messages 에 넣는다 (CHAT-02). 큐/실행 중복 시작은 하지 않는다.
 */
async function queueTurn(threadId: string, memberId: string, mode: TurnMode, message: ChatMessage | null, extra: Partial<PendingTurn> = {}): Promise<'queued' | 'saved_for_next'> {
  const { f, db, ref } = await threadRef(threadId);
  return f.runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new CommandError('대화방이 없습니다.', 'not_found');
    const t = snap.data() as Thread;
    const schema2 = (t.schema_version ?? 1) >= 2;
    let msgRef: import('firebase/firestore').DocumentReference | null = null;
    if (message) {
      if (schema2) {
        msgRef = f.doc(ref, 'messages', message.message_id);
        const exists = await tx.get(msgRef);
        if (exists.exists()) throw new CommandError('같은 메시지가 이미 들어갔습니다.', 'conflict');
      } else if (t.messages?.some(m => m.message_id === message.message_id)) throw new CommandError('같은 메시지가 이미 들어갔습니다.', 'conflict');
    }
    const next: Partial<Thread> = { updated_at: nowIso() };
    if (message) {
      if (schema2) {
        const seq = (t.message_count ?? 0) + 1;
        tx.set(msgRef!, clean({ ...message, seq }));
        next.message_count = seq; next.last_message = { kind: message.kind, role: message.role, text: message.text.slice(0, 160), at: message.at };
      } else next.messages = [...(t.messages ?? []), message].slice(-MAX_MESSAGES);
    }
    if (t.status !== 'idle') {
      if (!message || !['chat', 'discuss'].includes(mode)) throw new CommandError('지금 실행 중입니다. 끝난 뒤 보내세요.', 'conflict');
      next.next_messages = [...(t.next_messages ?? []), { message_id: message.message_id, mode, member_id: memberId }];
      tx.set(ref, clean({ ...t, ...next }));
      return 'saved_for_next';
    }
    const pending: PendingTurn = { turn_id: newId('turn'), member_id: memberId, mode, message_id: message?.message_id ?? null, requested_at: nowIso(), ...extra };
    tx.set(ref, clean({ ...t, ...next, member_id: ['chat', 'discuss'].includes(mode) ? memberId : t.member_id, status: 'queued', pending }));
    return 'queued';
  });
}

export async function sendOwnerMessage(threadId: string, memberId: string, text: string, mode: 'discuss' | 'chat' = 'chat', clientMessageId?: string) {
  const msg: ChatMessage = { message_id: clientMessageId ?? newId('msg'), role: 'owner', member_id: null, kind: 'chat', text: text.trim().slice(0, 20000), at: nowIso(), mode };
  return queueTurn(threadId, memberId, mode, msg);
}
export async function requestReview(threadId: string, reviewerId: string, targetSha: string | null, baseSha: string | null) {
  const msg: ChatMessage = { message_id: newId('msg'), role: 'system', member_id: reviewerId, kind: 'chat', text: `검토 요청 → ${reviewerId} (읽기 전용${targetSha ? `, 대상 ${targetSha.slice(0, 10)}` : ''})`, at: nowIso() };
  return queueTurn(threadId, reviewerId, 'review', msg, { target_sha: targetSha, base_sha: baseSha, review_id: newId('rev') });
}
export async function requestPublish(threadId: string, memberId: string) {
  const msg: ChatMessage = { message_id: newId('msg'), role: 'owner', member_id: null, kind: 'publish', text: '반영 요청 (작업 가지에 합치기 → 빌드 → 배포 가지)', at: nowIso() };
  return queueTurn(threadId, memberId, 'publish', msg);
}
export async function requestCheckpoint(threadId: string, memberId: string) {
  return queueTurn(threadId, memberId, 'checkpoint', { message_id: newId('msg'), role: 'owner', member_id: null, kind: 'chat', text: '체크포인트 저장 요청', at: nowIso() });
}
export async function requestShare(threadId: string, memberId: string) {
  return queueTurn(threadId, memberId, 'share', { message_id: newId('msg'), role: 'owner', member_id: null, kind: 'chat', text: '원격 공유 요청 (대화방 가지 push)', at: nowIso() });
}
export async function setAutoReview(threadId: string, reviewerId: string | null) {
  const { f, ref } = await threadRef(threadId);
  await f.updateDoc(ref, { auto_review_member_id: reviewerId, fix_rounds: 0, updated_at: nowIso() });
}
/** 소유자 결정을 맥락에 기록한다 (다음 세션 재개 때 전달됨). */
export async function recordDecision(threadId: string, text: string) {
  const { f, db, ref } = await threadRef(threadId);
  await f.runTransaction(db, async tx => {
    const snap = await tx.get(ref); if (!snap.exists()) return;
    const t = snap.data() as Thread;
    const ctx = t.context ?? { version: 0, decisions: [], open_questions: [], delivered: {} };
    const version = (ctx.version ?? 0) + 1;
    const decisions = [...(ctx.decisions ?? []), { version, kind: '소유자 결정', text: text.trim().slice(0, 500) }].slice(-40);
    tx.set(ref, clean({ ...t, context: { ...ctx, version, decisions }, needs_owner: null, updated_at: nowIso() }));
  });
}
export async function cancelPending(threadId: string) {
  const { f, db, ref } = await threadRef(threadId);
  await f.runTransaction(db, async tx => {
    const snap = await tx.get(ref); if (!snap.exists()) return;
    const t = snap.data() as Thread;
    if (t.status === 'queued') tx.set(ref, clean({ ...t, status: 'idle', pending: null, updated_at: nowIso() }));
  });
}
export async function dropNextMessage(threadId: string, messageId: string) {
  const { f, db, ref } = await threadRef(threadId);
  await f.runTransaction(db, async tx => {
    const snap = await tx.get(ref); if (!snap.exists()) return;
    const t = snap.data() as Thread;
    tx.set(ref, clean({ ...t, next_messages: (t.next_messages ?? []).filter(m => m.message_id !== messageId), updated_at: nowIso() }));
  });
}
