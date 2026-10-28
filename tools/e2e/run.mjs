/**
 * 브라우저 인수 시험 (ACCEPTANCE_TESTS.md 의 AT-01~25 중 이 환경에서 실행 가능한 항목).
 * 실행: npm run build && npm run e2e
 * 환경: Playwright + headless Chromium(SwiftShader WebGL). 실제 사용자 PC/Whale 성능을 보장하지 않는다.
 * 결과: docs/test-results/e2e-results.json, docs/test-results/screenshots/*.png
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PKG || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'docs/test-results');
const shotDir = path.join(outDir, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
const PORT = 4179;
const BASE = `http://localhost:${PORT}/CBAO`;
const GL_ARGS = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'];

const results = [];
const record = (id, name, pass, detail = '') => { results.push({ id, name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = (page, name) => page.screenshot({ path: path.join(shotDir, `${name}.png`) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newPage(browser, { width = 1366, height = 768, demo = false, reduced = false, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  if (demo) await page.addInitScript(() => { try { sessionStorage.setItem('ai-office.demo-session', '1'); } catch {} });
  if (init) await page.addInitScript(init);
  return page;
}
const seatInfo = (page, id) => page.evaluate(id => window.__aiOfficeDebug?.scene.debugSeat(id), id);
const waitRoom = async page => { await page.waitForFunction(() => !!window.__aiOfficeDebug?.scene, null, { timeout: 15000 }); await sleep(600); };

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  await sleep(2500);
  const browser = await chromium.launch({ args: GL_ARGS });
  try {
    // ---------- AT-01 기본 진입 (로컬 모드, 빈 데이터) ----------
    {
      const page = await newPage(browser);
      await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
      await sleep(500);
      record('AT-01', '기본 진입은 대시보드(#/office)', page.url().endsWith('#/office') && await page.locator('h1', { hasText: '사무실' }).count() > 0, page.url());
      await shot(page, 'at01-dashboard-local-empty');
      // AT-02 보기 전환 / 직접 링크 / 뒤로가기
      await page.click('.view-switch >> text=픽셀 사무실');
      await waitRoom(page);
      const toRoom = page.url().includes('#/office/room');
      await page.goBack(); await sleep(400);
      const back = page.url().endsWith('#/office') && (await page.locator('canvas').count()) === 0;
      await page.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await waitRoom(page);
      record('AT-02', '보기 전환·뒤로가기·직접 링크', toRoom && back && page.url().includes('#/office/room'));
      // AT-03 미연결 자리 (로컬 모드에는 팀원이 없음)
      const unbound = await page.locator('.member-list .ml-name', { hasText: '미연결' }).count();
      const seatNote = await page.locator('.drawer').count();
      const seeded = await page.locator('.member-list .ml-state', { hasText: '외부 서비스 · 상태 미확인' }).count();
      record('AT-03', '미연결 자리(GPT·Claude·Codex)는 미연결, 초기 등록된 Gemini·NotebookLM 은 외부 작업·상태 미확인', unbound === 3 && seeded === 2 && seatNote === 0, `미연결 ${unbound}/5, 외부 ${seeded}`);
      await shot(page, 'at03-room-local-unbound');
      await page.click('.member-list button >> nth=0'); await sleep(300);
      record('AT-03b', '미연결 자리 클릭 → 설정 안내 드로어', (await page.locator('.drawer >> text=팀원·자리 설정').count()) > 0);
      await shot(page, 'at03-room-local-unbound-drawer');
      record('AT-23c', '로컬 모드 페이지 오류 없음', page.errors.length === 0, page.errors.join(' | ').slice(0, 300));
      await page.context().close();
    }

    // ---------- 데모: 데스크톱 ----------
    {
      const page = await newPage(browser, { demo: true });
      await page.goto(`${BASE}/#/office`, { waitUntil: 'networkidle' }); await sleep(500);
      const dashTask = await page.locator('table tbody tr', { hasText: 'Claude' }).locator('a[href*="/tasks/"]').first().getAttribute('href');
      await shot(page, 'demo-dashboard-1366');
      record('AT-24a', '데모 배지가 대시보드에 표시', (await page.locator('.demo-banner').count()) === 1);
      await page.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await waitRoom(page);
      await shot(page, 'demo-room-1366');
      const created1 = await page.evaluate(() => window.__aiOfficeDebug.created);
      // AT-10 관리형 live 실행만 동작
      const c0 = await seatInfo(page, 'seat-claude'); await sleep(700); const c1 = await seatInfo(page, 'seat-claude');
      const g0 = await seatInfo(page, 'seat-gemini'); await sleep(400); const g1 = await seatInfo(page, 'seat-gemini');
      record('AT-10', 'Runner 확인 실행(Claude)만 typing 동작, 외부 보고(Gemini)는 정지', c0.animate && c0.clip === 'typing' && c1.frameIndex !== c0.frameIndex && !g0.animate && g0.clip === 'still' && g1.frameIndex === 0, `claude ${c0.frameIndex}→${c1.frameIndex}, gemini ${g0.clip}`);
      // AT-11 외부 수동 보고 표기
      const gemText = await page.locator('.member-list button[data-seat="seat-gemini"]').textContent();
      record('AT-11', '외부 작업은 직접 보고로 표기', /직접 보고/.test(gemText));
      // AT-08 자리 클릭 → 동일 task
      await page.click('.member-list button[data-seat="seat-claude"]'); await sleep(300);
      const drawerTask = await page.locator('.drawer a', { hasText: '작업 열기' }).getAttribute('href');
      record('AT-08', '자리 클릭 → 대시보드와 같은 task 로 연결', !!drawerTask && drawerTask === dashTask, `${dashTask} vs ${drawerTask}`);
      await shot(page, 'demo-room-1366-drawer');
      // AT-05 선택이 장면을 재생성하지 않음
      const created2 = await page.evaluate(() => window.__aiOfficeDebug.created);
      const sel = await seatInfo(page, 'seat-claude');
      record('AT-05', '선택·상태 변경이 renderer 를 재생성하지 않음', created1 === created2 && sel.selected === true, `created ${created1}→${created2}`);
      // AT-13 승인석 배지 = 실제 승인 요청 수, 클릭 → 승인함
      const badge = await page.locator('.nameplate.object', { hasText: '총괄·승인석' }).locator('.badge.count').textContent();
      await page.click('.nameplate.object >> text=총괄·승인석'); await sleep(300);
      record('AT-13', '승인석 배지=승인 요청 수, 클릭 시 승인함 이동(그림 안 승인 없음)', badge?.trim() === '1' && page.url().includes('#/approvals'));
      await page.goBack(); await waitRoom(page);
      // AT-04 프로젝트 필터: 위치 보존, 다른 프로젝트 작업은 흐림(대기 아님)
      await page.selectOption('select[aria-label="프로젝트 필터"]', 'MILAL'); await sleep(400);
      const dimmed = await seatInfo(page, 'seat-claude');
      const claudeText = await page.locator('.member-list button[data-seat="seat-claude"]').textContent();
      record('AT-04', '프로젝트 필터 시 다른 프로젝트 작업은 흐림 처리, 상태는 유지', dimmed.alpha < 1 && /작업 중/.test(claudeText) && /다른 프로젝트/.test(claudeText));
      await shot(page, 'demo-room-filter-milal');
      await page.selectOption('select[aria-label="프로젝트 필터"]', ''); await sleep(300);
      // AT-14 중지 요청: 확인 대화상자 → 전달 대기
      page.once('dialog', d => d.accept());
      await page.click('.member-list button[data-seat="seat-claude"]'); await sleep(200);
      await page.click('.drawer >> text=중지 요청'); await sleep(400);
      const drawerText = await page.locator('.drawer').textContent();
      record('AT-14', '중지 요청은 확인 후 전달 대기로만 표시(종료 확인 아님)', /전달 대기/.test(drawerText) && /중지 요청 처리 중/.test(drawerText));
      await shot(page, 'demo-room-cancel-pending');
      // AT-15 45/90초 경계 (브라우저 시계 전진)
      await page.context().close();
    }
    {
      // 서버 보정 시계(Date.now)만 앞당겨 heartbeat 나이를 만든다. fixture 시각은 로드 시점 그대로.
      const page50 = await newPage(browser, { demo: true, init: () => { const o = Date.now; Date.now = () => o() + 50_000; } });
      await page50.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await waitRoom(page50);
      const t50 = await page50.locator('.member-list button[data-seat="seat-claude"]').textContent();
      const a50 = await seatInfo(page50, 'seat-claude');
      await shot(page50, 'demo-room-connection-delayed');
      await page50.context().close();
      const page95 = await newPage(browser, { demo: true, init: () => { const o = Date.now; Date.now = () => o() + 95_000; } });
      await page95.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await waitRoom(page95);
      const t95 = await page95.locator('.member-list button[data-seat="seat-claude"]').textContent();
      await page95.click('.member-list button[data-seat="seat-claude"]'); await sleep(200);
      const d95 = await page95.locator('.drawer').textContent();
      record('AT-15', '45초→상태 수신 지연(동작 정지), 90초→연결 끊김·현재 실행 미확인, 실행 상태는 running 유지', /상태 수신 지연/.test(t50) && !a50.animate && /연결 끊김/.test(t95) && /실행 중 \(implementing\)/.test(d95), `${t50?.slice(0, 40)} / ${t95?.slice(0, 40)}`);
      await shot(page95, 'demo-room-connection-lost');
      await page95.context().close();
    }
    // ---------- AT-20 1920×1080 ----------
    {
      const page = await newPage(browser, { demo: true, width: 1920, height: 1080 });
      await page.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await waitRoom(page);
      await shot(page, 'demo-room-1920');
      // 명패와 hit 영역 정렬: Claude 명패 중앙 아래 클릭 → Claude 선택
      const box = await page.locator('.nameplate', { hasText: 'Claude' }).boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height + 22); await sleep(300);
      const title = await page.locator('#drawer-title').textContent().catch(() => '');
      record('AT-20', '1920×1080 에서 명패 아래 캐릭터 클릭이 같은 자리를 선택', title === 'Claude', `drawer=${title}`);
      await page.context().close();
    }
    // ---------- AT-19 모바일 390×844 ----------
    {
      const page = await newPage(browser, { demo: true, width: 390, height: 844 });
      await page.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await waitRoom(page);
      await shot(page, 'demo-room-mobile-390');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      const btn = await page.locator('.member-list button').first().boundingBox();
      await page.click('.member-list button[data-seat="seat-gemini"]'); await sleep(300);
      const drawerBox = await page.locator('.drawer').boundingBox();
      await shot(page, 'demo-room-mobile-390-drawer');
      record('AT-19', '모바일: 가로 스크롤 없음, 44px 이상 조작 영역, 하단 시트 상세', overflow && btn.height >= 44 && drawerBox && drawerBox.width >= 360, `btn ${Math.round(btn.height)}px, drawer ${Math.round(drawerBox?.width ?? 0)}px`);
      await page.context().close();
    }
    // ---------- AT-18 키보드 ----------
    {
      const page = await newPage(browser, { demo: true });
      await page.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await waitRoom(page);
      await page.focus('.member-list button[data-seat="seat-codex"]');
      await page.keyboard.press('Enter'); await sleep(300);
      const opened = (await page.locator('#drawer-title').textContent()) === 'Codex';
      const focusInDrawer = await page.evaluate(() => document.activeElement?.id === 'drawer-title');
      await page.keyboard.press('Escape'); await sleep(300);
      const closed = (await page.locator('.drawer').count()) === 0;
      const focusBack = await page.evaluate(() => document.activeElement?.getAttribute('data-seat') === 'seat-codex');
      const overlayHidden = await page.evaluate(() => document.querySelector('.room-overlay')?.getAttribute('aria-hidden') === 'true');
      record('AT-18', '키보드: Enter 선택, 초점 이동, Escape 닫기 후 초점 복귀, 캔버스 오버레이는 보조기술에서 숨김', opened && focusInDrawer && closed && focusBack && overlayHidden);
      await page.context().close();
    }
    // ---------- AT-21 reduce motion ----------
    {
      const page = await newPage(browser, { demo: true, reduced: true });
      await page.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await waitRoom(page);
      const c = await seatInfo(page, 'seat-claude');
      const tickerStopped = await page.evaluate(() => !window.__aiOfficeDebug.app.ticker.started);
      const text = await page.locator('.member-list button[data-seat="seat-claude"]').textContent();
      record('AT-21', 'prefers-reduced-motion: 동작·ticker 정지, 상태 문구는 유지', !c.animate && tickerStopped && /작업 중/.test(text));
      await page.context().close();
    }
    // ---------- AT-22 20회 진입·이탈 ----------
    {
      const page = await newPage(browser, { demo: true });
      await page.goto(`${BASE}/#/office`, { waitUntil: 'networkidle' });
      for (let i = 0; i < 20; i++) {
        await page.goto(`${BASE}/#/office/room`); await page.waitForFunction(() => !!window.__aiOfficeDebug?.scene); await sleep(120);
        await page.goto(`${BASE}/#/office`); await sleep(80);
      }
      const d = await page.evaluate(() => ({ created: window.__aiOfficeDebug.created, destroyed: window.__aiOfficeDebug.destroyed, canvases: document.querySelectorAll('canvas').length }));
      await page.goto(`${BASE}/#/office/room`); await waitRoom(page);
      const after = await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, listeners: window.__aiOfficeDebug.app.ticker.count }));
      record('AT-22', '20회 진입·이탈 후 renderer 생성=파괴, canvas 중복 없음', d.created === 20 && d.destroyed === 20 && d.canvases === 0 && after.canvases === 1 && page.errors.length === 0, `created ${d.created} destroyed ${d.destroyed} canvases ${d.canvases}→${after.canvases} ticker listeners ${after.listeners} errors ${page.errors.length}`);
      await page.context().close();
    }
    // ---------- AT-23 에셋 실패 / 렌더러 실패 ----------
    {
      const page = await newPage(browser, { demo: true });
      await page.route('**/pixel-office/atlas.json', r => r.abort());
      await page.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await waitRoom(page);
      const notice = await page.locator('.notice', { hasText: '에셋 로딩 실패' }).count();
      const list = await page.locator('.member-list button').count();
      record('AT-23a', '에셋 로딩 실패 → 대체 도형 + 안내, DOM 목록 유지', notice === 1 && list === 5);
      await shot(page, 'at23-asset-failure');
      await page.context().close();
    }
    {
      const page = await newPage(browser, { demo: true, init: () => { HTMLCanvasElement.prototype.getContext = () => null; } });
      await page.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await sleep(2500);
      const err = await page.locator('.notice.error', { hasText: '렌더러' }).count();
      const list = await page.locator('.member-list button').count();
      const retry = await page.locator('button', { hasText: '다시 시도' }).count();
      record('AT-23b', 'WebGL/Canvas 생성 실패 → 오류 안내 + 다시 시도 + DOM 목록 유지', err === 1 && list === 5 && retry === 1);
      await shot(page, 'at23-renderer-failure');
      await page.context().close();
    }
    {
      // WebGL 비활성 → Pixi canvas renderer fallback 확인
      const b2 = await chromium.launch({ args: ['--disable-webgl', '--disable-webgl2'] });
      const page = await newPage(b2, { demo: true });
      await page.goto(`${BASE}/#/office/room`, { waitUntil: 'networkidle' }); await sleep(2500);
      const name = await page.evaluate(() => window.__aiOfficeDebug?.app?.renderer?.name ?? null);
      const list = await page.locator('.member-list button').count();
      record('AT-23d', 'WebGL 없는 브라우저: Pixi canvas renderer 로 fallback (또는 오류 안내)', (name === 'canvas' || (await page.locator('.notice.error').count()) === 1) && list === 5, `renderer=${name}`);
      await shot(page, 'at23-canvas-fallback');
      await page.context().close(); await b2.close();
    }
    // ---------- AT-24 XSS 문자열 / AT-25 로컬 업무 회귀 / AT-09 새 지시 ----------
    {
      const page = await newPage(browser);
      await page.goto(`${BASE}/#/projects`, { waitUntil: 'networkidle' }); await sleep(300);
      await page.fill('form.stack input >> nth=0', 'CBSR'); await page.click('form.stack button[type=submit]'); await sleep(300);
      await page.goto(`${BASE}/#/settings/team`); await sleep(300);
      await page.fill('form.stack input >> nth=0', 'GPT'); await page.fill('form.stack input >> nth=1', '연구·설계·검수');
      await page.selectOption('form.stack select', 'external'); await page.click('form.stack button[type=submit]'); await sleep(300);
      const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-office.local-workspace.v1')).members.map(m => m.member_id));
      const memberId = ids[0]; // 초기 등록된 m-gemini
      await page.selectOption('select[aria-label="GPT 자리에 연결할 팀원"]', ids[2]); await sleep(300);
      const other = await page.locator('select[aria-label="Claude 자리에 연결할 팀원"] option[disabled]').count();
      record('AT-03c', '자리 바인딩은 member_id 로, 이미 자리에 있는 팀원(3명)은 다른 자리에서 선택 불가', ids.length === 3 && other === 3);
      await shot(page, 'at25-team-binding');
      // AT-09 새 지시: 프로젝트·담당 미리 채움, 저장해도 실행 없음
      await page.goto(`${BASE}/#/office/room`); await waitRoom(page);
      await page.click('.member-list button[data-seat="seat-gemini"]'); await sleep(200);
      await page.click('.drawer >> text=이 담당에게 새 지시'); await sleep(300);
      const pre = await page.evaluate(() => ({ project: document.querySelector('form.stack select').value, assignee: document.querySelectorAll('form.stack select')[1].value }));
      const xss = '<img src=x onerror="document.title=\'XSS\'">배경 시안';
      await page.fill('form.stack input[required]', xss); await page.click('form.stack button[type=submit]'); await sleep(400);
      const ws1 = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-office.local-workspace.v1')));
      record('AT-09', '새 지시: 프로젝트·담당 미리 채움, 저장은 ready 이며 실행 없음', pre.project !== '' && pre.assignee === memberId && ws1.tasks.length === 1 && ws1.tasks[0].status === 'ready' && ws1.runs.length === 0);
      await page.goto(`${BASE}/#/office/room`); await waitRoom(page);
      const imgs = await page.locator('img').count();
      const titleOk = await page.evaluate(() => document.title !== 'XSS');
      const shown = await page.locator('.member-list button[data-seat="seat-gemini"]').textContent();
      record('AT-24b', '업무명의 HTML 은 텍스트로만 표시(XSS 미실행)', imgs === 0 && titleOk && shown.includes('<img'));
      await shot(page, 'at24-xss-text');
      // AT-11/AT-12/AT-25: 외부 직접 보고 → 결과 제출 → 승인 → done
      await page.click('.member-list button[data-seat="seat-gemini"]'); await sleep(200);
      await page.click('.drawer >> text=결과 등록'); await sleep(300);
      await page.selectOption('form.stack select', 'working'); await page.fill('form.stack textarea', 'Gemini 웹에서 시작'); await page.click('form.stack button[type=submit]'); await sleep(400);
      await page.goto(`${BASE}/#/office/room`); await waitRoom(page);
      const g = await seatInfo(page, 'seat-gemini');
      const gt = await page.locator('.member-list button[data-seat="seat-gemini"]').textContent();
      record('AT-11b', '로컬 모드 직접 보고: 외부 작업·직접 보고 표시, heartbeat·동작 없음', /직접 보고/.test(gt) && !g.animate && g.clip === 'still');
      await shot(page, 'at25-room-local-external-work');
      const tid = ws1.tasks[0].task_id;
      await page.goto(`${BASE}/#/tasks/${encodeURIComponent(tid)}/external-report`); await sleep(300);
      await page.selectOption('form.stack select', 'submitted'); await page.fill('form.stack textarea', '결과 제출'); await page.fill('form.stack input[placeholder="https://"]', 'https://example.com/result');
      await page.click('form.stack button[type=submit]'); await sleep(400);
      let ws2 = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-office.local-workspace.v1')));
      const awaiting = ws2.tasks[0].status === 'awaiting_owner' && ws2.approvals.length === 1;
      await page.goto(`${BASE}/#/office`); await sleep(300);
      await shot(page, 'at25-dashboard-local-decision');
      await page.goto(`${BASE}/#/approvals`); await sleep(300);
      page.once('dialog', d => d.accept());
      await page.click('button:has-text("승인")'); await sleep(400);
      ws2 = await page.evaluate(() => JSON.parse(localStorage.getItem('ai-office.local-workspace.v1')));
      record('AT-12/25', '결과 제출은 승인 대기, 업무 완료(done)는 승인함 승인으로만', awaiting && ws2.tasks[0].status === 'done' && ws2.approvals[0].decision === 'approved');
      await shot(page, 'at25-approvals-decided');
      record('AT-25b', '로컬 업무 흐름 중 페이지 오류 없음', page.errors.length === 0, page.errors.join(' | ').slice(0, 300));
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  const summary = { ran_at: new Date().toISOString(), environment: `node ${process.version}, playwright ${require(path.join(process.env.PLAYWRIGHT_PKG || 'playwright', 'package.json')).version}, headless chromium (swiftshader)`, pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length, results };
  fs.writeFileSync(path.join(outDir, 'e2e-results.json'), JSON.stringify(summary, null, 2));
  console.log(`\n${summary.pass} passed, ${summary.fail} failed`);
  process.exit(summary.fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
