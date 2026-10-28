import { useState, type FormEvent } from 'react';
import { getStore, useStoreState } from '../../store/workspaceStore';
import { CommandError, newIdempotencyKey } from '../../store/commands';

const CANDIDATES = ['MILAL', 'MILALWV', 'CBSR', 'CBWP'];

export function ProjectsPage() {
  const ws = useStoreState(s => s.workspace);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [repo, setRepo] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try { await getStore().command({ type: 'register_project', name, purpose, repo_reference: repo || null, idempotency_key: newIdempotencyKey() }); setName(''); setPurpose(''); setRepo(''); }
    catch (err) { setError(err instanceof CommandError ? err.message : '등록 실패'); }
  };
  return (
    <>
      <div className="page-head"><h1>프로젝트</h1></div>
      <div className="grid-2">
        <section className="card"><h2>등록된 프로젝트</h2>
          {ws.projects.length === 0 ? <p className="empty">아직 없습니다. 등록 후보: {CANDIDATES.join(', ')} (경로·원격·권한은 확인 후 저장)</p> : (
            <ul className="list">{ws.projects.map(p => <li key={p.project_id}><strong>{p.name}</strong> <span className="meta">{p.project_id}</span><div className="meta">{p.purpose}{p.repo_reference ? ` · ${p.repo_reference}` : ''}</div></li>)}</ul>
          )}
        </section>
        <section className="card"><h2>프로젝트 등록</h2>
          <form className="stack" onSubmit={submit}>
            <label>이름<input value={name} onChange={e => setName(e.target.value)} required list="project-candidates" /><datalist id="project-candidates">{CANDIDATES.map(c => <option key={c} value={c} />)}</datalist></label>
            <label>목적<input value={purpose} onChange={e => setPurpose(e.target.value)} /></label>
            <label>저장소 참조 (owner/repo, 선택)<input value={repo} onChange={e => setRepo(e.target.value)} /></label>
            {error && <div className="notice error" role="alert">{error}</div>}
            <button className="btn primary" type="submit">등록</button>
          </form>
        </section>
      </div>
    </>
  );
}
