/** 선택한 팀원의 상세 드로어. 행동은 기존 라우트/명령 핸들러로만 연결한다. 그림 안에서 승인·실행하지 않는다. */
import { useEffect, useRef, useState } from 'react';
import { href } from '../../app/router';
import { getStore, useStoreState } from '../../store/workspaceStore';
import { Badge, StateIcon, formatAge, formatTime } from '../../shared/ui';
import { EVIDENCE_LABEL, EXEC_MODE_LABEL, RUN_STATUS_LABEL, TASK_STATUS_LABEL } from '../../domain/types';
import { CommandError, newIdempotencyKey } from '../../store/commands';
import type { SeatModel } from './officeViewAdapter';

interface Props { model: SeatModel; nowMs: number; onClose(): void; projectFilter: string | null; privacy: boolean }

export function MemberDrawer({ model, nowMs, onClose, projectFilter, privacy }: Props) {
  const ws = useStoreState(s => s.workspace);
  const preferred = useStoreState(s => s.preferredTask);
  const [msg, setMsg] = useState<string | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headRef.current?.focus(); }, [model.seat.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { member, view, seat } = model;
  const fullMember = ws?.members.find(m => m.member_id === member?.member_id) ?? null;
  const memberTasks = ws && member ? ws.tasks.filter(t => t.assignee_member_id === member.member_id && !['done', 'cancelled'].includes(t.status)).sort((a, b) => b.sequence - a.sequence) : [];
  const activeRunCount = ws && member ? ws.runs.filter(r => r.member_id === member.member_id && ['starting', 'running', 'waiting_input', 'stopping'].includes(r.status)).length : 0;
  const queuedCount = ws && member ? ws.runs.filter(r => r.member_id === member.member_id && ['queued', 'leased'].includes(r.status)).length : 0;
  const artifacts = ws && member ? ws.artifacts.filter(a => a.member_id === member.member_id).slice(-3).reverse() : [];
  const run = ws && view?.runId ? ws.runs.find(r => r.run_id === view.runId) ?? null : null;

  /** 외부 작업: 지시 묶음을 복사해 해당 웹 서비스에 붙여 넣는다. 자동 전송은 없다. */
  const fullTask = ws && member?.task ? ws.tasks.find(t => t.task_id === member.task!.task_id) ?? null : null;
  const serviceUrl = externalServiceUrl(fullMember?.tool_label ?? '', member?.display_name ?? '');
  const copyBundle = async () => {
    if (!fullTask) return;
    const text = [
      `[바이브코딩인력사무소 지시 묶음]`, `프로젝트: ${fullTask.project_id}`, `작업 ID: ${fullTask.task_id} (rev ${fullTask.revision})`,
      `제목: ${fullTask.title}`, `목적: ${fullTask.goal || '(없음)'}`, `완료 조건: ${fullTask.done_criteria || '(없음)'}`,
      ``, `끝나면 결과 링크와 요약을 사무실의 "결과 등록"에 직접 적어 주세요.`,
    ].join('\n');
    try { await navigator.clipboard.writeText(text); setMsg('지시 묶음을 복사했습니다. 서비스를 열어 붙여 넣으세요.'); }
    catch { setMsg('복사하지 못했습니다. 작업 열기에서 내용을 직접 복사하세요.'); }
  };
  const requestCancel = async () => {
    if (!view?.runId) return;
    if (!window.confirm('중지 요청을 보낼까요? 요청만으로 종료가 확인되지는 않으며, Runner 의 종료 확인이 올 때까지 "전달 대기"로 표시됩니다.')) return;
    try { await getStore().command({ type: 'request_cancel', run_id: view.runId, idempotency_key: newIdempotencyKey() }); setMsg('중지 요청 기록 · 전달 대기'); }
    catch (e) { setMsg(e instanceof CommandError ? e.message : '요청 실패'); }
  };

  return (
    <aside className="drawer" aria-labelledby="drawer-title">
      <div className="drawer-head">
        <h2 id="drawer-title" ref={headRef} tabIndex={-1}>{model.title}</h2>
        <button type="button" className="btn small" onClick={onClose} aria-label="상세 닫기">닫기</button>
      </div>
      {!member && (
        <>
          <p>이 자리는 아직 팀원과 연결되지 않았습니다. 제안 역할: <strong>{seat.suggested_role}</strong></p>
          <p className="meta">자리 이름이 {seat.label} 이라는 이유로 계정이나 실행이 연결된 것은 아닙니다. 팀원을 등록하고 자리에 연결하세요.</p>
          <a className="btn primary" href={href('/settings/team')}>팀원·자리 설정</a>
        </>
      )}
      {member && view && (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <Badge tone={view.color}><StateIcon icon={view.icon} /> {view.label}</Badge>
            {view.pendingOwnerCount > 0 && <Badge tone="count">{view.pendingOwnerCount}</Badge>}
            {model.otherProject && <Badge tone="attention">다른 프로젝트 작업 중</Badge>}
          </div>
          {view.note && <p className="meta">{view.note}</p>}
          {msg && <div className="notice" role="status">{msg}</div>}
          <dl className="kv">
            <dt>역할</dt><dd>{member.role_label}</dd>
            <dt>연결 방식</dt><dd>{EXEC_MODE_LABEL[member.execution_mode]}</dd>
            <dt>실행 도구</dt><dd>{fullMember?.tool_label || '—'}</dd>
            <dt>연결 상태</dt><dd>{view.connection === 'not_applicable' ? '해당 없음(외부 작업)' : view.connection} {member.last_heartbeat_at && `· heartbeat ${formatAge(member.last_heartbeat_at, nowMs)}`}</dd>
            <dt>현재 업무</dt><dd>{member.task ? (privacy ? '업무명 숨김' : `${member.task.project_id} / ${member.task.title}`) : '없음'}</dd>
            <dt>업무 상태</dt><dd>{member.task ? TASK_STATUS_LABEL[member.task.status] : '—'}</dd>
            <dt>실행 상태</dt><dd>{member.run ? `${RUN_STATUS_LABEL[member.run.status]} (${member.run.phase})` : member.execution_mode === 'external' ? '실행 없음 (외부 작업)' : '실행 없음'}</dd>
            {run?.cancel_requested_at && <><dt>중지 요청</dt><dd>{formatTime(run.cancel_requested_at)} · {run.cancel_delivery === 'pending' ? '전달 대기' : run.cancel_delivery === 'delivered' ? '전달됨 · 종료 미확인' : run.cancel_delivery === 'confirmed' ? '종료 확인' : '—'}</dd></>}
            <dt>근거 출처</dt><dd>{EVIDENCE_LABEL[view.evidence]}</dd>
            <dt>마지막 확인</dt><dd>{formatTime(view.lastConfirmedAt)} {view.lastConfirmedAt && `(${formatAge(view.lastConfirmedAt, nowMs)})`}</dd>
            <dt>동시 작업</dt><dd>실행 {activeRunCount} / 대기 {queuedCount} / 승인 {view.pendingOwnerCount}</dd>
            <dt>다음 행동</dt><dd>{nextAction(view.state, member.execution_mode)}</dd>
          </dl>
          {memberTasks.length > 1 && (
            <label className="row" style={{ marginTop: 8 }}>
              <span className="meta">대표 작업</span>
              <select value={preferred[member.member_id] ?? ''} onChange={e => getStore().setPreferredTask(member.member_id, e.target.value || null)} disabled={activeRunCount > 0} aria-label="대표 작업 선택" style={{ minHeight: 36, borderRadius: 6, border: '1px solid var(--line)' }}>
                <option value="">서버 순서상 최신</option>
                {memberTasks.map(t => <option key={t.task_id} value={t.task_id}>{privacy ? t.task_id : t.title}</option>)}
              </select>
              {activeRunCount > 0 && <span className="meta">실행 중이면 서버 실행이 우선</span>}
            </label>
          )}
          {memberTasks.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>대기 작업 ({memberTasks.length})</h3>
              <ul className="list">{memberTasks.slice(0, 5).map(t => <li key={t.task_id}><a href={href(`/tasks/${t.task_id}`)}>{privacy ? t.task_id : t.title}</a> <span className="meta">{TASK_STATUS_LABEL[t.status]}</span></li>)}</ul>
            </>
          )}
          {artifacts.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>관련 결과물</h3>
              <ul className="list">{artifacts.map(a => <li key={a.artifact_id}>{privacy ? a.artifact_id : a.title} <span className="meta">{formatTime(a.submitted_at)}</span></li>)}</ul>
            </>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {member.task && <a className="btn primary" href={href(`/tasks/${member.task.task_id}`)}>작업 열기</a>}
            {view.pendingOwnerCount > 0 && <a className="btn" href={href('/approvals')}>승인함 열기 ({view.pendingOwnerCount})</a>}
            <a className="btn" href={href('/tasks/new', { project: projectFilter ?? member.task?.project_id ?? null, assignee: member.member_id })}>이 담당에게 새 지시</a>
            <a className="btn" href={href('/records')}>자료 보기</a>
            {member.execution_mode === 'external' && member.task && <button type="button" className="btn" onClick={() => void copyBundle()}>지시 묶음 복사</button>}
            {member.execution_mode === 'external' && serviceUrl && <a className="btn" href={serviceUrl} target="_blank" rel="noopener noreferrer">서비스 열기</a>}
            {member.execution_mode === 'external' && member.task && <a className="btn" href={href(`/tasks/${member.task.task_id}/external-report`)}>결과 등록</a>}
            {view.canRequestCancel && <button type="button" className="btn danger" onClick={() => void requestCancel()}>중지 요청</button>}
          </div>
          {member.execution_mode === 'external' && <p className="meta" style={{ marginTop: 8 }}>외부 서비스의 현재 상태는 자동 관찰하지 않습니다. 시작·완료는 직접 보고로 기록됩니다.</p>}
        </>
      )}
    </aside>
  );
}

/** 외부 서비스 주소는 고정 목록(https)만 허용한다. */
function externalServiceUrl(toolLabel: string, name: string): string | null {
  const k = `${toolLabel} ${name}`.toLowerCase();
  if (k.includes('notebooklm')) return 'https://notebooklm.google.com/';
  if (k.includes('gemini')) return 'https://gemini.google.com/';
  if (k.includes('chatgpt') || k.includes('gpt')) return 'https://chatgpt.com/';
  if (k.includes('claude')) return 'https://claude.ai/';
  return null;
}

function nextAction(state: string, mode: string): string {
  switch (state) {
    case 'awaiting_owner': return '승인함에서 판단';
    case 'run_finished': return '결과 확인 · 결과물 제출 여부 검토';
    case 'submitted': return '제출된 결과 검토·승인';
    case 'blocked': return '막힌 원인 확인 후 지시 수정';
    case 'error': return '실행 로그 확인 후 재시도 지시';
    case 'unconfigured': return '연결 설정';
    case 'connection_lost': case 'connection_delayed': case 'unknown': return 'PC·Runner 연결 확인 (실패로 바꾸지 않음)';
    case 'external_idle': return mode === 'external' ? '외부 서비스에서 작업 후 직접 보고' : '—';
    case 'idle': return '새 지시 또는 대기';
    case 'inconsistent': return 'snapshot 새로 조회';
    default: return '기다리기';
  }
}
