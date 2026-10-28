import { useState, type FormEvent } from 'react';
import { href, navigate, useRoute } from '../../app/router';
import { getStore, useStoreState } from '../../store/workspaceStore';
import { newIdempotencyKey, CommandError } from '../../store/commands';

/** S31 새 지시. 프로젝트·담당만 미리 채운다. 저장해도 즉시 실행되지 않는다. */
export function NewTaskPage() {
  const ws = useStoreState(s => s.workspace);
  const route = useRoute();
  const [project, setProject] = useState(() => route.query.get('project') ?? (ws && ws.projects.filter(p => !p.archived).length === 1 ? ws.projects.filter(p => !p.archived)[0].project_id : ''));
  const [assignee, setAssignee] = useState(route.query.get('assignee') ?? '');
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await getStore().command({ type: 'create_task', project_id: project, assignee_member_id: assignee || null, title, goal, done_criteria: done, idempotency_key: key });
      navigate('/tasks', { project });
    } catch (err) {
      setError(err instanceof CommandError ? err.message : '저장하지 못했습니다.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><h1>새 지시</h1></div>
      <div className="notice info">지시는 <strong>준비됨</strong> 상태로 저장됩니다. 실행은 연결된 Runner 와 정책 검토를 거쳐 별도로 시작되며, 저장만으로 실행되지 않습니다.</div>
      {ws.projects.length === 0 && <div className="notice">프로젝트가 없습니다. <a href={href('/projects')}>프로젝트</a>를 먼저 등록하세요.</div>}
      <form className="stack" onSubmit={submit}>
        <label>프로젝트
          <select value={project} onChange={e => setProject(e.target.value)} required>
            <option value="">선택</option>
            {ws.projects.filter(p => !p.archived).map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
          </select>
        </label>
        <label>담당 팀원
          <select value={assignee} onChange={e => setAssignee(e.target.value)}>
            <option value="">미배정</option>
            {ws.members.map(m => <option key={m.member_id} value={m.member_id}>{m.display_name} · {m.role_label}</option>)}
          </select>
        </label>
        <label>제목<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={500} /></label>
        <label>목적<textarea value={goal} onChange={e => setGoal(e.target.value)} /></label>
        <label>완료 조건<textarea value={done} onChange={e => setDone(e.target.value)} /></label>
        {error && <div className="notice error" role="alert">{error}</div>}
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || !project}>지시 저장</button>
          <a className="btn" href={href('/office')}>취소</a>
        </div>
      </form>
    </>
  );
}
