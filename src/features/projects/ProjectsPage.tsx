import { useState, type FormEvent } from 'react';
import { href } from '../../app/router';
import { getStore, useStoreState } from '../../store/workspaceStore';
import { CommandError, newIdempotencyKey } from '../../store/commands';

const CANDIDATES = ['MILAL', 'MILALWV', 'CBSR', 'CBWP'];

function ProjectRow({ p }: { p: { project_id: string; name: string; purpose: string; repo_reference: string | null; archived: boolean; work_branch?: string | null; build_command?: string | null; deploy_dir?: string | null; deploy_branch?: string | null; roadmap_path?: string | null; roadmap?: { parse_status: string; item_count?: number; done_count?: number } | null } }) {
  const [edit, setEdit] = useState(false);
  const [purpose, setPurpose] = useState(p.purpose);
  const [repo, setRepo] = useState(p.repo_reference ?? '');
  const [workBranch, setWorkBranch] = useState(p.work_branch ?? '');
  const [buildCmd, setBuildCmd] = useState(p.build_command ?? '');
  const [deployDir, setDeployDir] = useState(p.deploy_dir ?? '');
  const [deployBranch, setDeployBranch] = useState(p.deploy_branch ?? '');
  const [roadmapPath, setRoadmapPath] = useState(p.roadmap_path ?? '');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try { await getStore().command({ type: 'update_project', project_id: p.project_id, patch: { purpose, repo_reference: repo.trim() || null, work_branch: workBranch.trim() || null, build_command: buildCmd.trim() || null, deploy_dir: deployDir.trim() || null, deploy_branch: deployBranch.trim() || null, roadmap_path: roadmapPath.trim() || null } }); setEdit(false); }
    catch (e) { setErr(e instanceof CommandError ? e.message : '저장 실패'); }
  };
  return (
    <li>
      <div className="row"><strong>{p.name}</strong> <span className="meta">{p.project_id}</span><span className="spacer" />
        <button type="button" className="btn small" onClick={() => setEdit(v => !v)}>{edit ? '취소' : '수정'}</button></div>
      {!edit && <div className="meta">{p.purpose || '목적 없음'} · 저장소 {p.repo_reference ?? '없음 (심부름꾼은 빈 폴더에서 시작)'} · 작업 가지 {p.work_branch || 'main'}{p.build_command ? ` · 빌드 "${p.build_command}"` : ''}{p.deploy_dir ? ` · 배포 ${p.deploy_dir}/ → ${p.deploy_branch || 'main'}` : ''}{p.roadmap_path ? ` · 로드맵 ${p.roadmap_path}${p.roadmap ? ` (${p.roadmap.parse_status === 'parsed' ? `${p.roadmap.done_count ?? 0}/${p.roadmap.item_count ?? 0}` : p.roadmap.parse_status})` : ' (아직 안 읽음)'}` : ''} · <a href={href(`/projects/${p.project_id}`)}>개요·로드맵</a></div>}
      {edit && (
        <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="목적" style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} />
          <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="저장소 참조 예: aqedah/CBSR" style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} />
          <div className="meta">아래 세 칸은 "원본 가지와 빌드 결과 가지가 다른" 저장소(CBSR 등)에만 적습니다. 보통은 비워 둡니다.</div>
          <input value={workBranch} onChange={e => setWorkBranch(e.target.value)} placeholder="작업 가지 (원본이 있는 가지, 예: source · 비우면 main)" style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} />
          <input value={buildCmd} onChange={e => setBuildCmd(e.target.value)} placeholder="빌드 명령 (예: python app/build_site.py)" style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} />
          <div className="row">
            <input value={deployDir} onChange={e => setDeployDir(e.target.value)} placeholder="배포 폴더 (예: site)" style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 6, flex: 1 }} />
            <input value={deployBranch} onChange={e => setDeployBranch(e.target.value)} placeholder="배포 가지 (비우면 main)" style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 6, flex: 1 }} />
          </div>
          <input value={roadmapPath} onChange={e => setRoadmapPath(e.target.value)} placeholder="기존 로드맵 문서 경로 (저장소 안, 예: docs/ROADMAP.md · 읽기 전용으로 가져옴)" style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} />
          {err && <div className="notice error">{err}</div>}
          <div className="row"><button type="button" className="btn primary small" onClick={() => void save()}>저장</button></div>
        </div>
      )}
    </li>
  );
}

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
            <ul className="list">{ws.projects.map(p => <ProjectRow key={p.project_id} p={p} />)}</ul>
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
