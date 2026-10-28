import { useState, type FormEvent } from 'react';
import { getStore, useStoreState } from '../../store/workspaceStore';
import { CommandError, newIdempotencyKey } from '../../store/commands';
import { EXEC_MODE_LABEL, type ExecutionMode } from '../../domain/types';
import scene from '../pixel-office/config/office.scene.json';
import { Badge } from '../../shared/ui';

/** S61 팀원과 자리 바인딩. 자리 seed 이름은 member_id 가 아니다. 명시적으로 연결한다. */
export function TeamPage() {
  const ws = useStoreState(s => s.workspace);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [mode, setMode] = useState<ExecutionMode>('external');
  const [tool, setTool] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!ws) return <p className="empty">데이터가 없습니다.</p>;

  const bind = (seed: string, memberId: string) => {
    void getStore().command({ type: 'update_ui', patch: { seat_bindings: { [seed]: memberId || null } } });
  };
  const register = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try { await getStore().command({ type: 'register_member', display_name: name, role_label: role, execution_mode: mode, tool_label: tool, idempotency_key: newIdempotencyKey() }); setName(''); setRole(''); setTool(''); }
    catch (err) { setError(err instanceof CommandError ? err.message : '등록 실패'); }
  };
  const usedBy = (memberId: string) => Object.entries(ws.ui.seat_bindings).filter(([, v]) => v === memberId).map(([k]) => k);

  return (
    <>
      <div className="page-head"><h1>팀원·자리</h1></div>
      <section className="card">
        <h2>픽셀 사무실 자리 연결</h2>
        <p className="meta">자리의 이름(GPT, Claude …)은 제안일 뿐이며, 실제 팀원 ID 와 명시적으로 연결해야 상태가 표시됩니다. 팀원 하나를 두 자리에 복제하지 않습니다. 연결하지 않은 자리는 '미연결'로 표시됩니다.</p>
        <table>
          <thead><tr><th>자리</th><th>제안 역할 · 방식</th><th>연결된 팀원</th></tr></thead>
          <tbody>
            {scene.seats.map(seat => {
              const seed = seat.member_binding.seed_key;
              const current = ws.ui.seat_bindings[seed] ?? '';
              return (
                <tr key={seat.id}>
                  <td><strong>{seat.label}</strong> <span className="meta">{seat.id}</span></td>
                  <td>{seat.suggested_role} · {EXEC_MODE_LABEL[seat.suggested_mode as ExecutionMode]}</td>
                  <td>
                    <select value={current} onChange={e => bind(seed, e.target.value)} aria-label={`${seat.label} 자리에 연결할 팀원`} style={{ minHeight: 40, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line)' }}>
                      <option value="">미연결</option>
                      {ws.members.map(m => {
                        const elsewhere = usedBy(m.member_id).filter(k => k !== seed);
                        return <option key={m.member_id} value={m.member_id} disabled={elsewhere.length > 0}>{m.display_name} ({m.member_id}){elsewhere.length ? ` — 이미 ${elsewhere.join(',')} 자리` : ''}</option>;
                      })}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="grid-2">
        <section className="card">
          <h2>팀원</h2>
          {ws.members.length === 0 ? <p className="empty">등록된 팀원이 없습니다.</p> : (
            <ul className="list">{ws.members.map(m => <li key={m.member_id}><strong>{m.display_name}</strong> <span className="meta">{m.member_id}</span> <Badge tone={m.execution_mode === 'managed' ? 'active' : 'muted'}>{EXEC_MODE_LABEL[m.execution_mode]}</Badge><div className="meta">{m.role_label} · {m.tool_label || '도구 미지정'} · 중지 요청 {m.capabilities.request_cancel ? '지원' : '미지원'}</div></li>)}</ul>
          )}
        </section>
        <section className="card">
          <h2>팀원 등록</h2>
          <p className="meta">관리형/관찰형 연결은 연결 시험을 통과한 서버 모드에서만 등록됩니다. 이름이 GPT/Claude 라는 이유로 계정이나 실행 능력이 증명되지 않습니다.</p>
          <form className="stack" onSubmit={register}>
            <label>이름<input value={name} onChange={e => setName(e.target.value)} required /></label>
            <label>역할<input value={role} onChange={e => setRole(e.target.value)} placeholder="예: 연구·설계·검수" /></label>
            <label>연결 방식
              <select value={mode} onChange={e => setMode(e.target.value as ExecutionMode)}>
                <option value="external">외부 작업 (수동 보고)</option>
                <option value="unconfigured">미연결</option>
                <option value="managed">관리형 실행 (서버 모드 필요)</option>
                <option value="observed">관찰형 연결 (서버 모드 필요)</option>
              </select>
            </label>
            <label>실제 도구/서비스<input value={tool} onChange={e => setTool(e.target.value)} placeholder="예: ChatGPT 웹, Claude Code CLI" /></label>
            {error && <div className="notice error" role="alert">{error}</div>}
            <button className="btn primary" type="submit">등록</button>
          </form>
        </section>
      </div>
    </>
  );
}
