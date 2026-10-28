import { href, navigate, useRoute } from '../../app/router';
import { useStoreState } from '../../store/workspaceStore';
import { SourceLine } from '../../shared/ui';
import { useProjectFilter } from './useOfficeSnapshot';

/** 대시보드 | 픽셀 사무실 전환, 프로젝트 필터, 새 지시, 상태 신선도. 두 보기에서 공유. */
export function OfficeHeader({ view }: { view: 'dashboard' | 'room' }) {
  const ws = useStoreState(s => s.workspace);
  const project = useProjectFilter();
  const route = useRoute();
  const setProject = (p: string) => navigate(route.path, { ...Object.fromEntries(route.query.entries()), project: p || null });
  return (
    <header>
      <div className="page-head">
        <h1>인력사무소</h1>
        <div className="view-switch" role="group" aria-label="보기 전환">
          <a href={href('/office', { project })} aria-current={view === 'dashboard' ? 'page' : undefined}>대시보드</a>
          <a href={href('/office/room', { project })} aria-current={view === 'room' ? 'page' : undefined}>픽셀 사무실</a>
        </div>
        <label className="row">
          <span className="meta">프로젝트</span>
          <select value={project ?? ''} onChange={e => setProject(e.target.value)} aria-label="프로젝트 필터" style={{ minHeight: 40, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line)' }}>
            <option value="">전체 프로젝트</option>
            {ws?.projects.filter(p => !p.archived).map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
          </select>
        </label>
        <span className="spacer" />
        <a className="btn primary" href={href('/tasks/new', { project })}>+ 새 지시</a>
      </div>
      <SourceLine />
    </header>
  );
}
