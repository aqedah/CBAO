import type { Workspace } from '../../domain/types';
import type { Command } from '../commands';

export type DataSource = 'http' | 'local' | 'demo';

export interface ProviderInfo {
  id: DataSource;
  label: string;
  /** 사용자에게 보여줄 한 줄 설명. 실제 연결 여부를 과장하지 않는다. */
  description: string;
  /** 이 provider 가 실제 Runner/서버 근거를 제공하는가 */
  provides_live_runs: boolean;
}

export interface WorkspaceProvider {
  readonly info: ProviderInfo;
  /** 전체 workspace 를 읽는다. 실패하면 throw. */
  load(): Promise<Workspace>;
  /** 서버 push/polling 이 있으면 구독. 없으면 undefined. 반환값은 해제 함수. */
  subscribe?(onWorkspace: (ws: Workspace) => void, onError: (e: Error) => void): () => void;
  /** 명령을 적용하고 새 workspace 를 돌려준다. */
  command(cmd: Command): Promise<Workspace>;
  /** 서버 시각 보정값(ms). 서버 응답이 없으면 0. */
  clockOffsetMs(): number;
}

export class ProviderNotConfiguredError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderNotConfiguredError'; }
}
