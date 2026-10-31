/** 이름·상태·업무·근거·시각을 DOM 으로 표시. 이미지에 굽지 않는다. 카메라 변환은 장면과 동일. */
import type { SeatModel } from './officeViewAdapter';
import { StateIcon, formatAge } from '../../shared/ui';
import { EVIDENCE_LABEL } from '../../domain/types';

import type { Bubble } from './bubbles';

interface Props { model: SeatModel; x: number; y: number; nowMs: number; onSelect(): void; compact: boolean; /** 작은 배율(모바일 맞춤): 이름만 */ mini?: boolean; /** 대화방에서 온 말풍선 (마지막 진행 한 줄 / 질문 / 오류) */ bubble?: Bubble }

export function MemberNameplate({ model, x, y, nowMs, onSelect, compact, mini = false, bubble }: Props) {
  const { view, member } = model;
  const cls = ['nameplate', model.stateColor, model.visual.selected ? 'selected' : '', model.otherProject ? 'dimmed' : '', mini ? 'mini' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} style={{ left: x, top: y }} tabIndex={-1} aria-hidden="true" onClick={onSelect}>
      <div className="np-name"><span>{mini ? model.title.replace(' (미연결)', '') : model.title}</span>{mini && <StateIcon icon={model.stateIcon} />}{view && view.pendingOwnerCount > 0 && <span className="badge count">{view.pendingOwnerCount}</span>}</div>
      {!mini && <div className="np-state"><StateIcon icon={model.stateIcon} /> {model.stateLabel}</div>}
      {!mini && bubble && <div className={`np-bubble ${bubble.tone}`} title={bubble.text}>{bubble.tone === 'question' ? '✋ ' : bubble.tone === 'error' ? '⚠ ' : '💬 '}{bubble.text}</div>}
      {!compact && model.taskLine && <div className="np-task">{model.taskLine}</div>}
      {!compact && model.otherProject && <div className="dim-note">다른 프로젝트 작업 중</div>}
      {!compact && view && member && (
        <div className="np-meta">{EVIDENCE_LABEL[view.evidence]} · {view.lastConfirmedAt ? formatAge(view.lastConfirmedAt, nowMs) : '확인 없음'}</div>
      )}
    </button>
  );
}

export function ObjectNameplate({ label, x, y, badge, onSelect }: { label: string; x: number; y: number; badge?: number; onSelect(): void }) {
  return (
    <button type="button" className="nameplate object" style={{ left: x, top: y }} tabIndex={-1} aria-hidden="true" onClick={onSelect}>
      {label}{badge ? <> <span className="badge count">{badge}</span></> : null}
    </button>
  );
}
