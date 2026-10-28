/**
 * #/chat — 채팅 모드. 프로젝트와 담당을 고르고 지시하면 Runner 가 PC 에서 실행하고 같은 방에 보고한다.
 * 반영(GitHub main)은 소유자 버튼으로만. AI 끼리는 '검토 요청' 1회 인계만.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { href, navigate, useRoute } from '../../app/router';
import { useStoreState } from '../../store/workspaceStore';
import { useThreads, createThread, sendOwnerMessage, requestReview, requestPublish, setAutoReview, cancelPending } from '../../store/threadStore';
import { Badge, formatAge, formatTime, useServerNow } from '../../shared/ui';
import type { ChatMessage } from '../../domain/chat';
import { CommandError } from '../../store/commands';

const MANAGED = new Set(['managed', 'observed']);

export function ChatPage({ threadId }: { threadId: string | null }) {
  const ws = useStoreState(s => s.workspace);
  const source = useStoreState(s => s.source);
  const { threads, loaded, error } = useThreads();
  const route = useRoute();
  const [projectId, setProjectId] = useState(() => { try { return route.query.get('project') ?? localStorage.getItem('ai-office.chat-project') ?? ''; } catch { return route.query.get('project') ?? ''; } });
  const [memberId, setMemberId] = useState(route.query.get('member') ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const now = useServerNow();
  const bottomRef = useRef<HTMLDivElement>(null);

  const thread = useMemo(() => threads.find(t => t.thread_id === threadId) ?? null, [threads, threadId]);
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
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages.length, thread?.status]);

  if (source !== 'firebase') return <div className="notice">채팅 모드는 Firebase 공용 장부에서만 됩니다. 설정 → 연결에서 Firebase 를 고르고 로그인하세요.</div>;
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !memberId || !projectId) return;
    setBusy(true); setMsg(null);
    try {
      let id = thread?.thread_id ?? null;
      if (!id) { id = await createThread(projectId, memberId, text.trim().slice(0, 60)); navigate(`/chat/${id}`); }
      await sendOwnerMessage(id, memberId, text.trim());
      setText('');
    } catch (err) { setMsg(err instanceof CommandError ? err.message : `보내지 못했습니다: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setBusy(false); }
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); } catch (err) { setMsg(err instanceof CommandError ? err.message : `실패: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setBusy(false); }
  };
  const memberName = (id: string | null) => ws.members.find(m => m.member_id === id)?.display_name ?? id ?? '';
  const others = managedMembers.filter(m => m.member_id !== (thread?.member_id ?? memberId));
  const project = ws.projects.find(p => p.project_id === (thread?.project_id ?? projectId));

  return (
    <div className="chat-layout">
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
                    {t.status !== 'idle' && <Badge tone="active">{t.status === 'running' ? '실행 중' : '대기'}</Badge>}</div>
                  <div className="meta">{t.project_id} · {memberName(t.member_id)} · {formatAge(t.updated_at, now)}</div>
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
            <p className="meta">프로젝트와 담당을 고르고 첫 지시를 보내면 대화방이 열립니다. 담당은 PC 에 연결된 팀원(Claude·Codex·Gemini CLI)만 고를 수 있습니다.</p>
          </div>
        ) : (
          <div className="chat-head row">
            <strong>{thread.title}</strong>
            <span className="meta">{thread.project_id}{project?.repo_reference ? ` · ${project.repo_reference}` : ''}{project?.work_branch ? ` · 작업 가지 ${project.work_branch}` : ''}</span>
            <span className="spacer" />
            {thread.status === 'running' && <Badge tone="active">{memberName(thread.pending?.member_id ?? thread.member_id)} 실행 중</Badge>}
            {thread.status === 'queued' && <><Badge tone="attention">Runner 대기</Badge><button type="button" className="btn small" onClick={() => void act(() => cancelPending(thread.thread_id), '취소했습니다.')}>취소</button></>}
            <a className="btn small" href={href(`/tasks/${thread.thread_id}`)}>작업 카드</a>
            {thread.sessions?.claude && <span className="meta" title="PC 터미널에서 같은 대화를 이어가려면">터미널: <code>claude --resume {thread.sessions.claude}</code></span>}
          </div>
        )}
        <div className="chat-messages">
          {thread?.messages.map(m => <Bubble key={m.message_id} m={m} name={memberName(m.member_id)} />)}
          {thread && thread.messages.length === 0 && <p className="empty">아직 메시지가 없습니다.</p>}
          <div ref={bottomRef} />
        </div>
        {msg && <div className="notice" role="status">{msg}</div>}
        {thread && thread.last_publish && (
          <div className={`notice ${thread.last_publish.status === 'failed' ? 'error' : 'info'}`}>
            반영 {thread.last_publish.status === 'pushed' ? '완료' : thread.last_publish.status === 'nothing' ? '— 바뀐 파일 없음' : '실패'}: {thread.last_publish.message} ({formatTime(thread.last_publish.at)}){thread.last_publish.commit && <> · 커밋 <code>{thread.last_publish.commit.slice(0, 7)}</code></>}
          </div>
        )}
        <form className="chat-input" onSubmit={send}>
          <div className="row">
            <select value={projectId} onChange={e => setProjectId(e.target.value)} disabled={!!thread} aria-label="프로젝트" style={!projectId ? { borderColor: 'var(--attention)', background: '#fbf1e0' } : undefined}>
              <option value="">▶ 프로젝트를 고르세요</option>
              {ws.projects.filter(p => !p.archived).map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
            </select>
            <select value={memberId} onChange={e => setMemberId(e.target.value)} aria-label="담당 팀원">
              {managedMembers.length === 0 && <option value="">연결된 팀원 없음</option>}
              {managedMembers.map(m => <option key={m.member_id} value={m.member_id}>{m.display_name} · {m.tool_label}</option>)}
            </select>
            {thread && (
              <label className="meta row" title="구현 턴이 끝나면 상대에게 읽기 전용 검토를 1회 자동 요청">
                자동 검토
                <select value={thread.auto_review_member_id ?? ''} onChange={e => void act(() => setAutoReview(thread.thread_id, e.target.value || null), '자동 검토 설정을 바꿨습니다.')} aria-label="자동 검토 팀원">
                  <option value="">끄기</option>
                  {others.map(m => <option key={m.member_id} value={m.member_id}>{m.display_name}</option>)}
                </select>
              </label>
            )}
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder={thread ? `${memberName(memberId)}에게 지시…` : '첫 지시를 적으세요. 예: README 의 파일 표에 설명이 빠진 html 파일 설명을 채워 줘'} rows={3}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(e as unknown as FormEvent); } }} />
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy || !text.trim() || !memberId || !projectId || (thread?.status ?? 'idle') !== 'idle'}>보내기 (Ctrl+Enter)</button>
            {!projectId && <span className="dim-note">먼저 프로젝트를 고르세요</span>}
            {projectId && !memberId && <span className="dim-note">PC에 연결된 팀원이 없습니다 (심부름꾼 확인)</span>}
            {thread && thread.status === 'idle' && others.map(m => (
              <button key={m.member_id} type="button" className="btn" disabled={busy} onClick={() => void act(() => requestReview(thread.thread_id, m.member_id), `${m.display_name}에게 검토를 요청했습니다.`)}>{m.display_name}에게 검토 요청</button>
            ))}
            {thread && thread.status === 'idle' && project?.repo_reference && (() => {
              const work = project.work_branch || 'main';
              const deploy = project.deploy_dir ? (project.deploy_branch || 'main') : null;
              const label = deploy && deploy !== work ? `${work} → 빌드 → ${deploy}` : work;
              const explain = deploy && deploy !== work
                ? `지금까지의 변경을 GitHub ${project.repo_reference} 의 ${work} 가지에 올리고, 바로 빌드(${project.build_command || '빌드 명령 없음'})해서 결과를 ${deploy} 가지에 반영할까요? 사이트에 그대로 적용됩니다.`
                : `지금까지의 변경을 GitHub ${project.repo_reference} 의 ${work} 에 바로 반영할까요? 사이트에 그대로 적용됩니다.`;
              return <button type="button" className="btn danger" disabled={busy} onClick={() => { if (window.confirm(explain)) void act(() => requestPublish(thread.thread_id, thread.member_id), '반영을 요청했습니다. Runner 가 결과를 보고합니다.'); }}>반영 (GitHub {label})</button>;
            })()}
          </div>
          <p className="meta">파일 수정·검사·빌드·git 읽기 명령은 자동 허용, 커밋·push·가지 바꾸기·외부 전송은 AI 가 못 하고 Runner 가 '반영' 때만 합니다. AI 끼리는 검토 1회 + 수정 1회까지만 자동으로 오갑니다.</p>
        </form>
      </section>
    </div>
  );
}

function Bubble({ m, name }: { m: ChatMessage; name: string }) {
  const cls = `bubble ${m.role} ${m.kind}`;
  const who = m.role === 'owner' ? '나' : m.role === 'system' ? '사무실' : name;
  return (
    <div className={cls}>
      <div className="bubble-head"><strong>{who}</strong> <span className="meta">{kindLabel(m.kind)} · {formatTime(m.at)}</span></div>
      <div className="bubble-text">{m.text}</div>
    </div>
  );
}
function kindLabel(k: ChatMessage['kind']): string {
  return { chat: '', progress: '진행', result: '결과 보고', error: '오류', review: '검토 의견', publish: '반영' }[k] ?? k;
}
