/**
 * #/chat — 프로젝트 대화방 (V2). 논의(읽기만) / 실행(승인 범위 수정) / 검토(고정 버전) 를 같은 방에서.
 * 화면은 Runner 가 장부에 쓴 사실만 보여 준다: 체크포인트(SHA), 검토 판정(JSON 계약), 동기화 상태, 맥락 버전.
 * 반영은 소유자 버튼으로만. 체크포인트 저장 / 원격 공유 / 반영 / 배포 확인은 서로 다른 상태다.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { href, navigate, useRoute } from '../../app/router';
import { useStoreState } from '../../store/workspaceStore';
import { useThreads, useThreadMessages, createThread, sendOwnerMessage, requestReview, requestPublish, requestCheckpoint, requestShare, setAutoReview, cancelPending, recordDecision, dropNextMessage } from '../../store/threadStore';
import { Badge, formatAge, formatTime, useServerNow } from '../../shared/ui';
import type { ChatMessage, Thread, Review, Checkpoint } from '../../domain/chat';
import { MAX_FIX_ROUNDS, MODE_LABEL, VERDICT_LABEL, newId, reviewIsCurrent } from '../../domain/chat';
import type { Project, RunnerDevice } from '../../domain/types';
import { CommandError } from '../../store/commands';
import { Markdown } from './Markdown';

const MANAGED = new Set(['managed', 'observed']);
type SendMode = 'discuss' | 'chat';
type Act = (fn: () => Promise<unknown>, ok: string) => Promise<void>;
type NameFn = (id: string | null | undefined) => string;

export function ChatPage({ threadId }: { threadId: string | null }) {
  const ws = useStoreState(s => s.workspace);
  const source = useStoreState(s => s.source);
  const { threads, loaded, error } = useThreads();
  const route = useRoute();
  const [projectId, setProjectId] = useState(() => { try { return route.query.get('project') ?? localStorage.getItem('ai-office.chat-project') ?? ''; } catch { return route.query.get('project') ?? ''; } });
  const [memberId, setMemberId] = useState(route.query.get('member') ?? '');
  const [text, setText] = useState('');
  const [sendMode, setSendMode] = useState<SendMode>('discuss');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const now = useServerNow();

  const thread = useMemo(() => threads.find(t => t.thread_id === threadId) ?? null, [threads, threadId]);
  const messages = useThreadMessages(thread);
  const managedMembers = useMemo(() => (ws?.members ?? []).filter(m => MANAGED.has(m.execution_mode)), [ws]);
  const device = ws?.devices.find(d => d.connection_state === 'healthy');

  useEffect(() => {
    if (thread) { setProjectId(thread.project_id); setMemberId(thread.member_id); }
    else if (!memberId && managedMembers[0]) setMemberId(managedMembers[0].member_id);
  }, [thread, managedMembers, memberId]);
  useEffect(() => {
    if (!thread && !projectId && ws && ws.projects.filter(p => !p.archived).length === 1) setProjectId(ws.projects.filter(p => !p.archived)[0].project_id);
  }, [thread, projectId, ws]);
  useEffect(() => { if (projectId) { try { localStorage.setItem('ai-office.chat-project', projectId); } catch { /* ignore */ } } }, [projectId]);
  // 실행을 이미 허용한 대화방(체크포인트가 있음)은 실행 모드를 유지, 새 대화는 논의가 기본
  const tid = thread?.thread_id ?? null; const hasCp = (thread?.checkpoints?.length ?? 0) > 0;
  useEffect(() => { setSendMode(tid && hasCp ? 'chat' : 'discuss'); }, [tid, hasCp]);

  if (source !== 'firebase') return <div className="notice">채팅 모드는 Firebase 공용 장부에서만 됩니다. 설정 → 연결에서 Firebase 를 고르고 로그인하세요.</div>;
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;

  const project = ws.projects.find(p => p.project_id === (thread?.project_id ?? projectId));
  const memberName: NameFn = id => ws.members.find(m => m.member_id === id)?.display_name ?? id ?? '';
  const others = managedMembers.filter(m => m.member_id !== (thread?.member_id ?? memberId));
  const running = (thread?.status ?? 'idle') !== 'idle';
  const headSha = thread?.sync?.head_sha ?? null;

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || !memberId || !projectId || busy) return;
    setBusy(true); setMsg(null);
    const clientId = newId('msg');
    try {
      let id = thread?.thread_id ?? null;
      if (!id) { id = await createThread(projectId, memberId, text.trim().slice(0, 60)); navigate(`/chat/${id}`); }
      const r = await sendOwnerMessage(id, memberId, text.trim(), sendMode, clientId);
      setText('');
      setMsg(r === 'saved_for_next' ? '저장했습니다. 지금 실행이 끝나면 다음 요청으로 이어서 보냅니다 (실행 중 끼어들기는 이 도구에서 지원되지 않음).' : null);
    } catch (err) { setMsg(err instanceof CommandError ? err.message : `보내지 못했습니다: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setBusy(false); }
  };
  const act: Act = async (fn, ok) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); } catch (err) { setMsg(err instanceof CommandError ? err.message : `실패: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setBusy(false); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 IME 조합 중 Enter 는 전송하지 않는다 (CHAT-03). Enter 전송, Shift+Enter 줄바꿈.
    const native = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
    if (native.isComposing || native.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  return (
    <div className={`chat-layout ${panelOpen && thread ? 'with-panel' : ''}`}>
      <aside className="chat-list">
        <div className="row" style={{ marginBottom: 8 }}><h1 style={{ fontSize: '1.1rem' }}>대화</h1><span className="spacer" /><a className="btn small primary" href={href('/chat')}>+ 새 대화</a></div>
        {!device && <div className="notice" style={{ fontSize: '.85rem' }}>실행 PC(심부름꾼)가 꺼져 있습니다. 지시는 저장되고, 켜지면 처리됩니다.</div>}
        {error && <div className="notice error">{error}</div>}
        {!loaded ? <p className="empty">불러오는 중…</p> : threads.length === 0 ? <p className="empty">대화가 없습니다.</p> : (
          <ul className="list">
            {threads.map(t => (
              <li key={t.thread_id} className={t.thread_id === threadId ? 'selected' : ''}>
                <a href={href(`/chat/${t.thread_id}`)} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="row"><strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</strong>
                    {t.status !== 'idle' && <Badge tone="active">{t.status === 'running' ? '실행 중' : '대기'}</Badge>}
                    {t.needs_owner && t.status === 'idle' && <Badge tone="attention">판단</Badge>}</div>
                  <div className="meta">{ws.projects.find(p => p.project_id === t.project_id)?.name ?? t.project_id} · {memberName(t.member_id)} · {formatAge(t.updated_at, now)}</div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="chat-main">
        {!thread ? (
          <div className="card">
            <h2>새 대화</h2>
            <p className="meta">프로젝트와 상대를 고르고 첫 메시지를 보내면 대화방이 열립니다. 기본은 <strong>논의</strong>(파일을 쓰지 않음)이고, 구현을 시키려면 <strong>승인 범위 실행</strong>으로 바꿔 보냅니다. 상대는 PC 에 연결된 팀원(Claude·Codex·Gemini CLI)만 고를 수 있습니다. GPT 는 API 어댑터가 아직 없어 '외부 작업(수동 보고)'입니다.</p>
          </div>
        ) : (
          <ThreadHead thread={thread} project={project} memberName={memberName} busy={busy} act={act} onTogglePanel={() => setPanelOpen(o => !o)} panelOpen={panelOpen} />
        )}
        <MessageList thread={thread} messages={messages.messages} loaded={messages.loaded} hasMore={messages.hasMore} legacy={messages.legacy} loadMore={messages.loadMore} memberName={memberName} headSha={headSha} />
        {msg && <div className="notice" role="status">{msg}</div>}
        {thread?.needs_owner && thread.status === 'idle' && <OwnerDecision thread={thread} busy={busy} act={act} />}
        {thread && (thread.next_messages?.length ?? 0) > 0 && (
          <div className="notice info">실행이 끝나면 이어서 보낼 요청 {thread.next_messages!.length}개 {thread.next_messages!.map(n => <button key={n.message_id} type="button" className="btn small" style={{ marginLeft: 6 }} disabled={busy} onClick={() => void act(() => dropNextMessage(thread.thread_id, n.message_id), '지웠습니다.')}>{MODE_LABEL[n.mode]} 요청 지우기</button>)}</div>
        )}
        {thread && thread.last_publish && (
          <div className={`notice ${thread.last_publish.status === 'failed' ? 'error' : 'info'}`}>
            반영 {thread.last_publish.status === 'pushed' ? '완료(GitHub 에 올림)' : thread.last_publish.status === 'nothing' ? '— 바뀐 파일 없음' : '실패'}: {thread.last_publish.message} ({formatTime(thread.last_publish.at)}){thread.last_publish.commit && <> · 커밋 <code>{thread.last_publish.commit.slice(0, 7)}</code></>}
            {thread.last_publish.status === 'pushed' && <span className="meta"> · 실제 서비스 배포 확인은 별도입니다 (push ≠ 배포 완료)</span>}
          </div>
        )}
        <form className="chat-input" onSubmit={send}>
          <div className="row wrap">
            <select value={projectId} onChange={e => setProjectId(e.target.value)} disabled={!!thread} aria-label="프로젝트" style={!projectId ? { borderColor: 'var(--attention)', background: '#fbf1e0' } : undefined}>
              <option value="">▶ 프로젝트를 고르세요</option>
              {ws.projects.filter(p => !p.archived).map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
            </select>
            <select value={memberId} onChange={e => setMemberId(e.target.value)} aria-label="대화 상대">
              {managedMembers.length === 0 && <option value="">연결된 팀원 없음</option>}
              {managedMembers.map(m => <option key={m.member_id} value={m.member_id}>{m.display_name} · {m.tool_label}</option>)}
            </select>
            <div className="seg" role="radiogroup" aria-label="대화 모드">
              <button type="button" className={`btn small ${sendMode === 'discuss' ? 'primary' : ''}`} role="radio" aria-checked={sendMode === 'discuss'} onClick={() => setSendMode('discuss')} title="읽기·분석·제안만. 파일을 쓰지 않습니다.">논의</button>
              <button type="button" className={`btn small ${sendMode === 'chat' ? 'primary' : ''}`} role="radio" aria-checked={sendMode === 'chat'} onClick={() => setSendMode('chat')} title="이 폴더 안 파일 수정·검사 명령을 허용합니다. 끝나면 체크포인트가 남습니다.">승인 범위 실행</button>
            </div>
            {thread && (
              <label className="meta row" title="실행 턴이 끝나면 상대에게 고정 버전 검토를 자동 요청. 지적이 있으면 수정 → 재검토 (최대 2회)">
                자동 검토
                <select value={thread.auto_review_member_id ?? ''} onChange={e => void act(() => setAutoReview(thread.thread_id, e.target.value || null), '자동 검토 설정을 바꿨습니다.')} aria-label="자동 검토 팀원">
                  <option value="">끄기</option>
                  {others.map(m => <option key={m.member_id} value={m.member_id}>{m.display_name}</option>)}
                </select>
              </label>
            )}
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey} rows={3}
            placeholder={thread ? (sendMode === 'discuss' ? `${memberName(memberId)}와 논의… (Enter 전송 · Shift+Enter 줄바꿈)` : `${memberName(memberId)}에게 실행 지시… (Enter 전송)`) : '첫 메시지를 적으세요. 예: 지도에 니느웨가 왜 뜨는지 원인을 찾아 설명해 줘'} />
          <div className="row wrap">
            <button className="btn primary" type="submit" disabled={busy || !text.trim() || !memberId || !projectId}>{running ? '다음 요청으로 저장' : sendMode === 'discuss' ? '논의 보내기' : '실행 보내기'}</button>
            {!projectId && <span className="dim-note">먼저 프로젝트를 고르세요</span>}
            {projectId && !memberId && <span className="dim-note">PC에 연결된 팀원이 없습니다 (심부름꾼 확인)</span>}
            {thread && !running && others.map(m => (
              <button key={m.member_id} type="button" className="btn" disabled={busy || !headSha} title={headSha ? `현재 버전 ${headSha.slice(0, 10)} 을 고정해서 검토` : '체크포인트가 있어야 검토할 수 있습니다'} onClick={() => void act(() => requestReview(thread.thread_id, m.member_id, headSha, lastBase(thread)), `${m.display_name}에게 검토를 요청했습니다.`)}>{m.display_name}에게 검토 요청</button>
            ))}
          </div>
          <PolicyLine device={device} />
        </form>
      </section>
      {thread && panelOpen && <ContextPanel thread={thread} project={project} device={device} memberName={memberName} busy={busy} act={act} now={now} />}
    </div>
  );
}

function lastBase(t: Thread): string | null {
  const cps = t.checkpoints ?? [];
  return cps.length ? cps[cps.length - 1].base_sha : null;
}

function ThreadHead({ thread, project, memberName, busy, act, onTogglePanel, panelOpen }: { thread: Thread; project?: Project; memberName: NameFn; busy: boolean; act: Act; onTogglePanel(): void; panelOpen: boolean }) {
  const sync = thread.sync;
  const dirty = (sync?.dirty_paths?.length ?? 0) > 0;
  const cps = thread.checkpoints ?? [];
  const last = cps[cps.length - 1];
  const saved = last ? (last.remote_sync_status === 'pushed' && sync?.remote !== 'ahead' ? '다른 PC 에서도 이어갈 수 있음' : '이 PC 에 저장됨') : '저장된 버전 없음';
  return (
    <div className="chat-head row wrap">
      <strong>{thread.title}</strong>
      <span className="meta">{project?.name ?? thread.project_id}{project?.repo_reference ? ` · ${project.repo_reference}` : ''}{sync?.branch ? ` · ${sync.branch}` : ''}</span>
      <Badge tone={dirty ? 'attention' : last ? 'active' : 'muted'}>{dirty ? `앱에서 수정됨 · 아직 커밋 안 됨 (${sync!.dirty_paths.length})` : saved}</Badge>
      {sync?.app_writing && <Badge tone="attention">앱에서 작업 중 · 논의만</Badge>}
      <span className="spacer" />
      {thread.status === 'running' && <Badge tone="active">{memberName(thread.pending?.member_id ?? thread.member_id)} {MODE_LABEL[thread.pending?.mode ?? 'chat']} 중</Badge>}
      {thread.status === 'queued' && <><Badge tone="attention">{MODE_LABEL[thread.pending?.mode ?? 'chat']} · Runner 대기</Badge><button type="button" className="btn small" disabled={busy} onClick={() => void act(() => cancelPending(thread.thread_id), '취소했습니다.')}>취소</button></>}
      <a className="btn small" href={href(`/tasks/${thread.thread_id}`)}>작업 카드</a>
      <button type="button" className="btn small" onClick={onTogglePanel}>{panelOpen ? '맥락 닫기' : '맥락 열기'}</button>
    </div>
  );
}

function MessageList({ thread, messages, loaded, hasMore, legacy, loadMore, memberName, headSha }: { thread: Thread | null; messages: ChatMessage[]; loaded: boolean; hasMore: boolean; legacy: boolean; loadMore(): void; memberName: NameFn; headSha: string | null }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const lastCount = useRef(0);
  const curId = thread?.thread_id ?? null;
  // 사용자가 위쪽을 읽는 중이면 강제로 내리지 않고 '새 응답 N개' 를 보여 준다 (CHAT-05)
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    if (messages.length > lastCount.current) {
      if (stuck) el.scrollTop = el.scrollHeight; else setUnseen(u => u + (messages.length - lastCount.current));
    }
    lastCount.current = messages.length;
  }, [messages.length, stuck]);
  useEffect(() => { lastCount.current = 0; setUnseen(0); setStuck(true); }, [curId]);
  const onScroll = () => {
    const el = boxRef.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStuck(atBottom); if (atBottom) setUnseen(0);
  };
  return (
    <div className="chat-messages-wrap">
      <div className="chat-messages" ref={boxRef} onScroll={onScroll}>
        {thread && legacy && <p className="meta">이 대화방은 예전 저장 방식입니다. 심부름꾼이 켜지면 메시지를 새 방식으로 옮깁니다 (원본은 그대로 둡니다).</p>}
        {thread && hasMore && <button type="button" className="btn small" onClick={loadMore} style={{ alignSelf: 'center' }}>이전 메시지 더 보기</button>}
        {thread && !loaded && <p className="empty">메시지 불러오는 중…</p>}
        {messages.map(m => <Bubble key={m.message_id} m={m} name={memberName(m.member_id)} headSha={headSha} />)}
        {thread && loaded && messages.length === 0 && <p className="empty">아직 메시지가 없습니다.</p>}
      </div>
      {unseen > 0 && <button type="button" className="btn small primary new-replies" onClick={() => { const el = boxRef.current; if (el) el.scrollTop = el.scrollHeight; setUnseen(0); setStuck(true); }}>새 응답 {unseen}개 ↓</button>}
    </div>
  );
}

function Bubble({ m, name, headSha }: { m: ChatMessage; name: string; headSha: string | null }) {
  const [open, setOpen] = useState(false);
  const cls = `bubble ${m.role} ${m.kind}`;
  const who = m.role === 'owner' ? '나' : m.role === 'system' ? '사무실' : name;
  const collapsible = m.kind === 'progress' && m.role === 'member';
  const staleReview = m.kind === 'review' && m.target_sha && headSha && m.target_sha !== headSha;
  return (
    <div className={cls}>
      <div className="bubble-head">
        <strong>{who}</strong> <span className="meta">{kindLabel(m.kind)}{m.mode && m.role === 'owner' ? ` · ${MODE_LABEL[m.mode as SendMode] ?? m.mode}` : ''} · {formatTime(m.at)}</span>
        {m.kind === 'review' && m.verdict && <Badge tone={m.verdict === 'pass' ? 'active' : m.verdict === 'error' ? 'error' : 'attention'}>{VERDICT_LABEL[m.verdict]}</Badge>}
        {staleReview && <Badge tone="muted">이전 버전({m.target_sha!.slice(0, 7)}) 검토</Badge>}
        {collapsible && <button type="button" className="btn small" style={{ marginLeft: 6 }} onClick={() => setOpen(o => !o)}>{open ? '접기' : '실행 기록 보기'}</button>}
      </div>
      {collapsible && !open ? <div className="meta">{m.text.split('\n').slice(-1)[0]?.slice(0, 120)}</div> : <Markdown text={m.text} />}
      {m.capsule && <details><summary className="meta">세션에 전달한 맥락 보기</summary><pre className="meta" style={{ whiteSpace: 'pre-wrap' }}>{m.capsule}</pre></details>}
    </div>
  );
}
function kindLabel(k: ChatMessage['kind']): string {
  return { chat: '', progress: '진행', result: '결과 보고', error: '오류', review: '검토 의견', publish: '반영', question: '질문', checkpoint: '체크포인트' }[k] ?? k;
}

function OwnerDecision({ thread, busy, act }: { thread: Thread; busy: boolean; act: Act }) {
  const [text, setText] = useState('');
  return (
    <div className="notice" style={{ borderColor: 'var(--attention)' }}>
      <strong>소유자 판단 필요:</strong> {thread.needs_owner!.reason}
      <div className="row" style={{ marginTop: 6 }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="결정을 한 줄로 (다음 세션 재개 때 전달됩니다)" style={{ flex: 1, padding: 6, border: '1px solid var(--line)', borderRadius: 6 }} />
        <button type="button" className="btn small primary" disabled={busy || !text.trim()} onClick={() => void act(() => recordDecision(thread.thread_id, text).then(() => setText('')), '결정을 기록했습니다. 다음 지시를 보내면 세션에 전달됩니다.')}>결정 기록</button>
      </div>
    </div>
  );
}

function PolicyLine({ device }: { device?: RunnerDevice }) {
  const p = device?.policy;
  if (!p) return <p className="meta">실행 PC 가 연결되면 심부름꾼이 실제로 강제하는 정책을 여기에 보여 줍니다. (지금은 미연결 — 문구만으로 차단을 보장하지 않습니다)</p>;
  const c = p.tools.claude;
  return <p className="meta">심부름꾼 정책 rev {p.revision}: 논의 모드는 읽기 도구만({c?.discuss.length}개), 실행 모드는 파일 수정·검사 명령({c?.exec.length}개 규칙, {c?.enforced_by}). 커밋·push·가지 바꾸기는 AI 가 못 합니다. <a href={href('/settings/policies')}>전체 보기</a></p>;
}

function ContextPanel({ thread, project, device, memberName, busy, act, now }: { thread: Thread; project?: Project; device?: RunnerDevice; memberName: NameFn; busy: boolean; act: Act; now: number }) {
  const sync = thread.sync;
  const cps = thread.checkpoints ?? [];
  const reviews = thread.reviews ?? [];
  const head = sync?.head_sha ?? null;
  const dirty = (sync?.dirty_paths?.length ?? 0) > 0;
  const idle = thread.status === 'idle';
  const work = project?.work_branch || 'main';
  const deploy = project?.deploy_dir ? (project.deploy_branch || 'main') : null;
  const flowLabel = deploy && deploy !== work ? `${work} 에 합치기 → 빌드 → ${deploy}` : `${work} 에 합치기`;
  const claudeSid = thread.sessions?.claude; const codexSid = thread.sessions?.codex;
  const cwd = sync?.worktree;
  const capsule = buildCapsule(thread, project, memberName);
  const copy = (s: string, ok: string) => act(() => navigator.clipboard.writeText(s), ok);
  const currentReview = reviews.filter(r => reviewIsCurrent(r, head)).slice(-1)[0];
  const rm = project?.roadmap;
  return (
    <aside className="chat-panel">
      <h3>버전</h3>
      {!sync ? <p className="meta">아직 실행이 없어 작업 폴더가 없습니다. 첫 턴에서 심부름꾼이 대화방 전용 가지를 만듭니다.</p> : (
        <dl className="kv small">
          <dt>작업 가지</dt><dd><code>{sync.branch}</code> (바탕 {work})</dd>
          <dt>현재 버전</dt><dd><code>{head ? head.slice(0, 10) : '—'}</code> {dirty && <Badge tone="attention">커밋 안 된 변경 {sync.dirty_paths.length}</Badge>}</dd>
          <dt>원격</dt><dd>{remoteLabel(sync.remote)}</dd>
          <dt>확인</dt><dd>{formatAge(sync.checked_at, now)}</dd>
          <dt>검토된 버전</dt><dd>{thread.reviewed_checkpoint_id ? <code>{thread.reviewed_checkpoint_id.slice(3, 13)}</code> : '없음'}</dd>
          <dt>승인(반영)된 버전</dt><dd>{thread.accepted_checkpoint_id ? <code>{thread.accepted_checkpoint_id.slice(3, 13)}</code> : '없음'}</dd>
        </dl>
      )}
      <div className="row wrap">
        <button type="button" className="btn small" disabled={busy || !idle || !sync || !dirty} title="커밋 안 된 변경을 대화방 가지에 저장" onClick={() => void act(() => requestCheckpoint(thread.thread_id, thread.member_id), '체크포인트 저장을 요청했습니다.')}>체크포인트 저장</button>
        <button type="button" className="btn small" disabled={busy || !idle || !cps.length} title="대화방 가지를 GitHub 에 올려 다른 PC 에서도 이어가기 (main 반영 아님)" onClick={() => void act(() => requestShare(thread.thread_id, thread.member_id), '원격 공유를 요청했습니다.')}>원격 공유</button>
        {project?.repo_reference && (
          <button type="button" className="btn small danger" disabled={busy || !idle || !cps.length || dirty} title={dirty ? '먼저 체크포인트를 저장하세요' : flowLabel} onClick={() => { if (window.confirm(`대화방 가지를 ${project.repo_reference} 의 ${flowLabel} 로 반영할까요? 사이트에 적용됩니다.${currentReview ? '' : '\n(현재 버전에 대한 검토가 없습니다.)'}`)) void act(() => requestPublish(thread.thread_id, thread.member_id), '반영을 요청했습니다.'); }}>반영 ({flowLabel})</button>
        )}
      </div>

      <h3>앱에서 이어하기</h3>
      {!cwd ? <p className="meta">작업 폴더가 생기면 여기에 이어가기 명령이 나옵니다.</p> : (
        <>
          <p className="meta">같은 PC 에서 터미널을 열고 아래를 붙여 넣으세요. 폴더·가지·세션이 이 대화방과 같습니다. 오피스 밖에서 저장(커밋)하면 여기서 감지합니다.</p>
          {dirty && <p className="meta" style={{ color: 'var(--attention)' }}>커밋 안 된 변경이 있습니다. 터미널에서 이어가도 되지만, 오피스 실행 턴은 먼저 그 변경을 '앱 체크포인트'로 저장합니다.</p>}
          <CopyLine label={`Claude Code${claudeSid ? ' · 세션 이어가기 (검증: Runner 가 저장한 세션 ID)' : ' · 새 세션 + 맥락 인계'}`} text={`cd "${cwd}"\nclaude${claudeSid ? ` --resume ${claudeSid}` : ''}`} onCopy={copy} />
          <CopyLine label={`Codex${codexSid ? ' · 세션 이어가기' : ' · 새 세션 + 맥락 인계'}`} text={`cd "${cwd}"\ncodex${codexSid ? ` resume ${codexSid}` : ''}`} onCopy={copy} />
          <button type="button" className="btn small" onClick={() => void copy(capsule, '맥락 묶음을 복사했습니다. 앱의 첫 메시지로 붙여 넣으세요.')}>맥락 묶음 복사 (맥락 인계)</button>
          {sync?.remote === 'local_only' || sync?.remote === 'unknown' ? <p className="meta">다른 PC 에서 이어가려면 먼저 '원격 공유'를 누르세요. 지금은 이 PC 에만 있습니다.</p> : null}
        </>
      )}

      <h3>체크포인트 ({cps.length})</h3>
      {cps.length === 0 ? <p className="meta">없음</p> : (
        <ul className="list small">{cps.slice(-5).reverse().map(c => <li key={c.checkpoint_id}><CheckpointRow c={c} head={head} /></li>)}</ul>
      )}

      <h3>검토 ({reviews.length})</h3>
      {reviews.length === 0 ? <p className="meta">없음 · 자동 검토를 켜거나 '검토 요청'을 누르세요. 보완은 최대 {MAX_FIX_ROUNDS}회, 그 뒤엔 소유자 판단.</p> : (
        <ul className="list small">{reviews.slice(-4).reverse().map(r => <li key={r.review_id}><ReviewRow r={r} head={head} memberName={memberName} /></li>)}</ul>
      )}

      <h3>맥락 (버전 {thread.context?.version ?? 0})</h3>
      {(thread.context?.decisions?.length ?? 0) === 0 ? <p className="meta">기록된 결정·사건이 없습니다.</p> : (
        <ul className="list small">{thread.context!.decisions.slice(-5).reverse().map(d => <li key={d.version}><span className="meta">v{d.version} · {d.kind}</span> {d.text}</li>)}</ul>
      )}
      {thread.context?.delivered && Object.keys(thread.context.delivered).length > 0 && <p className="meta">세션에 전달됨: {Object.entries(thread.context.delivered).map(([k, v]) => `${k} v${v}`).join(', ')}</p>}
      {(thread.context?.open_questions?.length ?? 0) > 0 && <p className="meta">미결 질문: {thread.context!.open_questions!.slice(-3).join(' / ')}</p>}

      <h3>로드맵</h3>
      {!project?.roadmap_path ? <p className="meta">프로젝트에 로드맵 경로가 없습니다. <a href={href('/projects')}>프로젝트 수정</a>에서 기존 문서를 연결하세요.</p>
        : !rm ? <p className="meta">심부름꾼이 아직 읽지 않았습니다 ({project.roadmap_path}).</p>
        : rm.parse_status !== 'parsed' ? <p className="meta">{rm.parse_status === 'missing' ? rm.error : '구조를 읽지 못해 원문만 보관'} · <a href={href(`/projects/${project.project_id}`)}>원문 보기</a></p>
        : <p className="meta">{rm.done_count ?? 0}/{rm.item_count ?? 0} 항목 완료 표시 · 현재 단계: {currentSection(rm.sections)} · <a href={href(`/projects/${project.project_id}`)}>전체 보기</a></p>}
      {!device && <p className="meta">실행 PC 미연결 — 위 상태는 마지막 보고 기준입니다.</p>}
    </aside>
  );
}

export function currentSection(sections: Array<{ title: string; items: Array<{ status: string }> }>): string {
  const s = sections.find(x => x.items.some(i => i.status === 'todo'));
  return s ? s.title : (sections.length ? '모두 완료 표시' : '—');
}
function remoteLabel(r: string | undefined): string {
  return { synced: '원격과 같음', ahead: '이 PC 가 앞섬 (원격 공유 필요)', behind: '원격이 앞섬 (앱에서 저장한 버전 있음)', diverged: '서로 갈라짐 · 조정 필요', local_only: '이 PC 에만 있음', unknown: '원격 확인 안 됨', unchecked: '원격 미확인' }[r ?? 'unchecked'] ?? r ?? '—';
}
function CheckpointRow({ c, head }: { c: Checkpoint; head: string | null }) {
  return (
    <>
      <div className="row wrap"><code>{c.candidate_sha.slice(0, 10)}</code> <Badge tone={c.origin === 'app' ? 'attention' : 'muted'}>{c.origin === 'app' ? '앱에서 저장' : '오피스'}</Badge> {c.candidate_sha === head && <Badge tone="active">현재</Badge>} <span className="meta">{c.remote_sync_status === 'pushed' ? '공유됨' : '이 PC 만'} · {formatTime(c.at)}</span></div>
      <div className="meta">{c.changed_paths.slice(0, 4).join(', ')}{c.changed_paths.length > 4 ? ` 외 ${c.changed_paths.length - 4}` : ''}{c.note ? ` · ${c.note}` : ''}</div>
    </>
  );
}
function ReviewRow({ r, head, memberName }: { r: Review; head: string | null; memberName: NameFn }) {
  const current = reviewIsCurrent(r, head);
  return (
    <>
      <div className="row wrap"><strong>{memberName(r.reviewer_id)}</strong> <Badge tone={r.verdict === 'pass' ? 'active' : r.verdict === 'error' ? 'error' : 'attention'}>{VERDICT_LABEL[r.verdict]}</Badge> {!current && <Badge tone="muted">이전 버전 {r.target_sha?.slice(0, 7)}</Badge>} <span className="meta">{formatTime(r.at)}</span></div>
      {r.error && <div className="meta">{r.error}</div>}
      {r.findings.slice(0, 3).map(f => <div key={f.id} className="meta">[{f.id} · {f.severity}] {f.location}: {f.claim}</div>)}
      {r.unverified.length > 0 && <div className="meta">미확인: {r.unverified.slice(0, 2).join(' / ')}</div>}
    </>
  );
}
function CopyLine({ label, text, onCopy }: { label: string; text: string; onCopy: (s: string, ok: string) => Promise<void> }) {
  return (
    <div className="copy-line">
      <div className="meta">{label}</div>
      <pre><code>{text}</code></pre>
      <button type="button" className="btn small" onClick={() => void onCopy(text, '복사했습니다.')}>복사</button>
    </div>
  );
}
function buildCapsule(t: Thread, project: Project | undefined, memberName: NameFn): string {
  const ctx = t.context; const sync = t.sync;
  const lines = [`[바이브코딩인력사무소 맥락 묶음 · 대화방 ${t.thread_id} · 맥락 버전 ${ctx?.version ?? 0}]`,
    `프로젝트: ${project?.name ?? t.project_id} · 저장소 ${project?.repo_reference ?? '없음'}`];
  if (sync?.head_sha) lines.push(`현재 코드 버전: 가지 ${sync.branch} · ${sync.head_sha.slice(0, 10)}${sync.dirty_paths?.length ? ' · 커밋 안 된 변경 있음' : ''}`);
  if (ctx?.decisions?.length) { lines.push('확정된 결정·사건:'); for (const d of ctx.decisions.slice(-8)) lines.push(`  - (${d.kind}) ${d.text}`); }
  const cur = (t.reviews ?? []).filter(r => reviewIsCurrent(r, sync?.head_sha)).slice(-1)[0];
  if (cur) { lines.push(`현재 버전 검토 (${memberName(cur.reviewer_id)}): ${VERDICT_LABEL[cur.verdict]}`); for (const f of cur.findings) lines.push(`  - [${f.id} · ${f.severity}] ${f.location}: ${f.claim} → ${f.suggested_action}`); }
  if (ctx?.open_questions?.length) lines.push('미결 질문: ' + ctx.open_questions.slice(-3).join(' / '));
  lines.push('규칙: 커밋·push 는 하지 말고 파일만 고치세요. 저장은 오피스에서 체크포인트로 합니다.');
  return lines.join('\n');
}
