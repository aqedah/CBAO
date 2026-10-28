/** 캔버스와 같은 기능을 제공하는 DOM 목록. 키보드·스크린리더의 유일한 선택지(캔버스 오버레이는 aria-hidden). */
import { href } from '../../app/router';
import { StateIcon } from '../../shared/ui';
import type { SeatModel } from './officeViewAdapter';

interface Props {
  models: SeatModel[];
  selectedSeat: string | null;
  onSelectSeat(seatId: string): void;
  approvalCount: number;
  handoffCount: number;
  deviceLabel: string;
  projectFilter: string | null;
}

export function OfficeAccessibleList({ models, selectedSeat, onSelectSeat, approvalCount, handoffCount, deviceLabel, projectFilter }: Props) {
  return (
    <section aria-labelledby="h-seatlist">
      <h2 id="h-seatlist" style={{ marginTop: 14 }}>팀원 자리</h2>
      <ul className="member-list">
        {models.map(m => (
          <li key={m.seat.id}>
            <button type="button" aria-pressed={selectedSeat === m.seat.id} onClick={() => onSelectSeat(m.seat.id)} data-seat={m.seat.id}>
              <div className="ml-name">{m.title}{m.view && m.view.pendingOwnerCount > 0 && <> <span className="badge count">{m.view.pendingOwnerCount}</span></>}</div>
              <div className={`ml-state badge ${m.stateColor}`}><StateIcon icon={m.stateIcon} /> {m.stateLabel}</div>
              {m.taskLine && <div className="ml-task">{m.taskLine}{m.otherProject ? ' · 다른 프로젝트' : ''}</div>}
            </button>
          </li>
        ))}
      </ul>
      <nav className="accesspoints" aria-label="공간 접근점">
        <a className="btn small" href={href('/approvals')}>총괄·승인석{approvalCount ? ` (${approvalCount})` : ''}</a>
        <a className="btn small" href={href('/records/handoffs')}>검토·인계 테이블{handoffCount ? ` (${handoffCount})` : ''}</a>
        <a className="btn small" href={href('/records')}>공유 서가</a>
        <a className="btn small" href={href('/tasks', { project: projectFilter })}>작업 게시판</a>
        <a className="btn small" href={href('/settings/connections')}>실행 PC 콘솔 · {deviceLabel}</a>
        <a className="btn small" href={href('/settings/policies')}>커피 공간(움직임·소리 설정)</a>
      </nav>
    </section>
  );
}
