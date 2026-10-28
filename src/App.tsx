import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useRoute, match, href, ROUTE_ALIASES, navigate } from './app/router';
import { getStore, useStoreState } from './store/workspaceStore';
import { DemoBanner } from './shared/ui';
import { AuthGate } from './shared/AuthGate';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { TasksPage } from './features/tasks/TasksPage';
import { TaskDetailPage } from './features/tasks/TaskDetailPage';
import { NewTaskPage } from './features/tasks/NewTaskPage';
import { ApprovalsPage } from './features/approvals/ApprovalsPage';
import { RecordsPage } from './features/records/RecordsPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { ConnectionsPage } from './features/settings/ConnectionsPage';
import { TeamPage } from './features/settings/TeamPage';
import { PoliciesPage } from './features/settings/PoliciesPage';
import { ExternalReportPage } from './features/tasks/ExternalReportPage';

// 픽셀 사무실은 라우트를 열 때만 렌더러·에셋을 불러온다.
const PixelOfficePage = lazy(() => import('./features/pixel-office/PixelOfficePage').then(m => ({ default: m.PixelOfficePage })));

function NavLink({ to, children, current, badge }: { to: string; children: ReactNode; current: boolean; badge?: number }) {
  return (
    <a href={href(to)} aria-current={current ? 'page' : undefined}>
      <span>{children}</span>
      {badge ? <span className="badge count" aria-label={`${badge}건`}>{badge}</span> : null}
    </a>
  );
}

export default function App() {
  const route = useRoute();
  const status = useStoreState(s => s.status);
  const ws = useStoreState(s => s.workspace);

  useEffect(() => {
    const store = getStore();
    if (store.getState().status === 'idle') void store.load();
  }, []);

  useEffect(() => {
    const alias = ROUTE_ALIASES[route.path];
    if (alias) navigate(alias);
  }, [route.path]);

  const pending = ws ? ws.approvals.filter(a => a.decision === null).length : 0;
  const path = route.path;
  const is = (p: string) => path === p || path.startsWith(p + '/');

  let page: ReactNode;
  let params: Record<string, string> | null;
  if (path === '/office') page = <DashboardPage />;
  else if (path === '/office/room') page = <Suspense fallback={<p className="empty">픽셀 사무실 불러오는 중…</p>}><PixelOfficePage /></Suspense>;
  else if (path === '/projects') page = <ProjectsPage />;
  else if (path === '/tasks') page = <TasksPage />;
  else if (path === '/tasks/new') page = <NewTaskPage />;
  else if ((params = match('/tasks/:id/external-report', path))) page = <ExternalReportPage taskId={params.id} />;
  else if ((params = match('/tasks/:id', path))) page = <TaskDetailPage taskId={params.id} />;
  else if (path === '/approvals') page = <ApprovalsPage />;
  else if (path === '/records' || path === '/records/handoffs') page = <RecordsPage tab={path === '/records/handoffs' ? 'handoffs' : 'all'} />;
  else if (path === '/settings/connections') page = <ConnectionsPage />;
  else if (path === '/settings/team') page = <TeamPage />;
  else if (path === '/settings/policies') page = <PoliciesPage />;
  else if (ROUTE_ALIASES[path]) page = <p className="empty">이동 중…</p>;
  else page = <div className="card"><h1>페이지를 찾을 수 없습니다</h1><p><a href={href('/office')}>사무실로 돌아가기</a></p></div>;

  return (
    <div className="app">
      <nav className="app-nav" aria-label="주 메뉴">
        <div className="brand">AI OFFICE</div>
        <NavLink to="/office" current={is('/office')}>사무실</NavLink>
        <NavLink to="/projects" current={is('/projects')}>프로젝트</NavLink>
        <NavLink to="/tasks" current={is('/tasks')}>작업함</NavLink>
        <NavLink to="/approvals" current={is('/approvals')} badge={pending}>승인함</NavLink>
        <NavLink to="/records" current={is('/records')}>기록·자료</NavLink>
        <div className="nav-group">설정</div>
        <NavLink to="/settings/connections" current={is('/settings/connections')}>연결</NavLink>
        <NavLink to="/settings/team" current={is('/settings/team')}>팀원·자리</NavLink>
        <NavLink to="/settings/policies" current={is('/settings/policies')}>정책</NavLink>
      </nav>
      <main className="app-main">
        <DemoBanner />
        <AuthGate />
        {status === 'loading' && !ws && <p className="empty" role="status">데이터 불러오는 중…</p>}
        {page}
      </main>
    </div>
  );
}
