import type { Workspace } from '../../domain/types';
import { applyCommand, type Command } from '../commands';
import type { WorkspaceProvider } from './types';
import { buildDemoWorkspace } from './demoFixture';

/** 데모: 메모리 안에서만 동작. 새로고침하면 사라진다. 모든 화면에 데모 배지가 붙는다. */
export function createDemoProvider(now: () => Date = () => new Date()): WorkspaceProvider {
  let ws: Workspace | null = null;
  return {
    info: { id: 'demo', label: '데모', description: '가짜 fixture 데이터. 실제 실행·연결·보고가 아닙니다.', provides_live_runs: false },
    async load() {
      ws = buildDemoWorkspace(now().toISOString());
      return ws;
    },
    async command(cmd: Command) {
      if (!ws) ws = buildDemoWorkspace(now().toISOString());
      ws = applyCommand(ws, cmd, now().toISOString());
      return ws;
    },
    clockOffsetMs: () => 0,
  };
}
