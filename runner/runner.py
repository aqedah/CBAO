# -*- coding: utf-8 -*-
"""
바이브코딩인력사무소 심부름꾼(Runner) — 사용자 PC에서 Claude Code / Codex 를 실행하고 장부(Firestore)에 사실만 기록한다.

하는 일
  1. 10초마다 heartbeat (PC 연결 상태) 기록
  2. 설치된 도구(claude / codex)를 '관리형 팀원'으로 등록하고 자리에 연결
  3. 소유자가 '실행 요청'을 누른 작업을 PC당 1개 규칙으로 실행 (지정 폴더 안에서만)
  4. 실행 중 진행 상태(살아 있음 확인·단계)를 기록, 끝나면 '실행 종료'와 결과물·승인 요청을 기록
  5. 사무실에서 '중지 요청'이 오면 프로세스를 종료하고 '종료 확인'을 기록

하지 않는 일
  - 작업을 자동으로 '완료'로 바꾸지 않는다 (승인은 소유자만)
  - git push, 배포, 지정 폴더 밖 수정을 하지 않는다
  - 일반 ChatGPT/Gemini/NotebookLM 웹을 관찰하지 않는다

파일 위치 (C:\\CBAO 기준)
  C:\\CBAO\\serviceAccount.json   Firebase 열쇠 (비밀. 이 PC 밖으로 내보내지 않는다)
  C:\\CBAO\\runner\\config.json     설정
  C:\\CBAO\\projects\\<프로젝트ID>\\ 작업 폴더 (없으면 만든다)
  C:\\CBAO\\runs\\<run_id>.log      실행 로그
"""
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
RUNNER_DIR = BASE / "runner"
CONFIG_PATH = RUNNER_DIR / "config.json"
KEY_PATH = BASE / "serviceAccount.json"
RUNS_DIR = BASE / "runs"
PROJECTS_DIR = BASE / "projects"
ACTIVE_RUN = {"queued", "leased", "starting", "running", "waiting_input", "stopping"}
VERSION = "0.3.0"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log(msg: str) -> None:
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- 설정
DEFAULT_CONFIG = {
    "device_id": "pc-a",
    "device_name": "작업용 PC A",
    "poll_seconds": 10,
    "max_concurrent_managed_runs": 1,
    "run_timeout_minutes": 30,
    "projects": {},
    "external_members": [
        {"member_id": "m-gpt", "display_name": "GPT", "role_label": "연구·설계·검수", "tool_label": "ChatGPT 웹", "seat": "gpt"},
        {"member_id": "m-gemini", "display_name": "Gemini", "role_label": "자료·이미지", "tool_label": "Gemini 웹", "seat": "gemini"},
        {"member_id": "m-notebooklm", "display_name": "NotebookLM", "role_label": "출처·문서 정리", "tool_label": "NotebookLM 웹", "seat": "notebooklm"},
    ],
    "tools": {
        "claude": {"command": "claude", "member_id": "m-claude", "display_name": "Claude", "role_label": "구현·개발", "seat": "claude",
                   "tool_label": "Claude Code CLI (stream-json)"},
        "codex": {"command": "codex", "member_id": "m-codex", "display_name": "Codex", "role_label": "코드·검사", "seat": "codex",
                  "tool_label": "Codex CLI (exec --json)"},
        "gemini": {"command": "gemini", "member_id": "m-gemini", "display_name": "Gemini", "role_label": "자료·이미지", "seat": "gemini",
                   "tool_label": "Gemini CLI (headless)"},
    },
}


def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if CONFIG_PATH.exists():
        try:
            user = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            for k, v in user.items():
                if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                    cfg[k].update(v)
                else:
                    cfg[k] = v
        except Exception as e:  # noqa: BLE001
            log(f"config.json 읽기 실패, 기본값 사용: {e}")
    return cfg


# ---------------------------------------------------------------- 도구 탐지
def candidate_dirs() -> list:
    """PATH 밖에 설치되는 흔한 위치들 (npm 전역, Claude 네이티브 설치, 사용자 로컬 bin)."""
    home = Path.home()
    env = os.environ
    dirs = []
    for d in (env.get("APPDATA"), env.get("LOCALAPPDATA"), env.get("ProgramFiles"), env.get("ProgramFiles(x86)")):
        if d:
            dirs += [Path(d) / "npm", Path(d) / "Programs" / "claude", Path(d) / "Programs" / "codex", Path(d) / "nodejs"]
    dirs += [home / ".local" / "bin", home / ".claude" / "bin", home / ".claude" / "local", home / ".codex" / "bin",
             home / "AppData" / "Roaming" / "npm", home / "scoop" / "shims", Path("C:/Program Files/nodejs")]
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if npm:
        for args in (["prefix", "-g"],):
            try:
                r = subprocess.run([npm, *args], capture_output=True, timeout=15)
                out = r.stdout.decode("utf-8", errors="replace").strip()
                if r.returncode == 0 and out:
                    dirs.append(Path(out))
            except Exception:  # noqa: BLE001
                pass
    return [d for d in dirs if d]


def which(cmd: str):
    # 절대 경로가 config 에 지정된 경우
    if os.path.isabs(cmd) and Path(cmd).exists():
        return cmd
    names = (cmd, cmd + ".cmd", cmd + ".exe", cmd + ".bat", cmd + ".ps1")
    for name in names:
        p = shutil.which(name)
        if p and not p.lower().endswith(".ps1"):
            return p
    for d in candidate_dirs():
        for name in names:
            p = d / name
            if p.exists() and not name.endswith(".ps1"):
                return str(p)
    return None


def detect_tools(cfg: dict) -> dict:
    """{'claude': {'path': ..., 'status': 'installed'|'not_installed', 'version': ...}}"""
    out = {}
    for key, t in cfg["tools"].items():
        path = which(t["command"])
        if not path:
            out[key] = {"path": None, "status": "not_installed", "version": None}
            log(f"  '{t['command']}' 를 PATH 와 흔한 설치 위치에서 찾지 못했습니다. 설치돼 있다면 config.json 의 tools.{key}.command 에 전체 경로를 적어 주세요.")
            continue
        version = None
        try:
            r = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=20, encoding="utf-8", errors="replace")
            version = (r.stdout or r.stderr).strip().splitlines()[0] if (r.stdout or r.stderr).strip() else None
        except Exception:  # noqa: BLE001
            pass
        out[key] = {"path": path, "status": "installed", "version": version}
    return out


# ---------------------------------------------------------------- 장부
class Ledger:
    def __init__(self):
        import firebase_admin
        from firebase_admin import credentials, firestore
        if not KEY_PATH.exists():
            raise SystemExit(f"열쇠 파일이 없습니다: {KEY_PATH}\nFirebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성 → 이 이름으로 저장하세요.")
        firebase_admin.initialize_app(credentials.Certificate(str(KEY_PATH)))
        self.fs = firestore
        self.db = firestore.client()
        docs = list(self.db.collection("workspaces").limit(5).stream())
        if not docs:
            raise SystemExit("장부(workspaces)가 비어 있습니다. 먼저 웹 사무실에서 구글 로그인을 한 번 하세요.")
        if len(docs) > 1:
            log(f"주의: workspace 문서가 {len(docs)}개입니다. 첫 번째를 사용합니다: {docs[0].id}")
        self.ref = docs[0].reference
        log(f"장부 연결: workspaces/{docs[0].id}")

    def mutate(self, fn):
        """fn(ws) -> bool(changed). 트랜잭션 안에서 적용. revision 을 올린다."""
        tx = self.db.transaction()
        fs = self.fs

        @fs.transactional
        def run(transaction):
            snap = self.ref.get(transaction=transaction)
            ws = snap.to_dict() or {}
            changed = fn(ws)
            if changed:
                ws["revision"] = int(ws.get("revision", 0)) + 1
                ws["captured_at"] = now_iso()
                transaction.set(self.ref, ws)
            return ws

        return run(tx)

    def read(self) -> dict:
        return self.ref.get().to_dict() or {}


def next_seq(ws: dict) -> int:
    m = 0
    for k in ("tasks", "runs", "external_reports", "approvals", "handoffs"):
        for x in ws.get(k, []):
            m = max(m, int(x.get("sequence", 0)))
    return m + 1


# ---------------------------------------------------------------- 실행
class RunProcess:
    def __init__(self, run_id: str, cmd: list, cwd: Path, prompt: str, log_path: Path, timeout_min: int):
        self.run_id = run_id
        self.cmd = cmd
        self.cwd = cwd
        self.prompt = prompt
        self.log_path = log_path
        self.timeout = timeout_min * 60
        self.proc = None
        self.started = time.time()
        self.last_output = time.time()
        self.phase = "implementing"
        self.result_text = ""
        self.exit_code = None
        self.error = None
        self.cancelled = False
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self.thread.start()

    def _run(self):
        try:
            with open(self.log_path, "a", encoding="utf-8") as lf:
                lf.write(f"# run {self.run_id}\n# cwd {self.cwd}\n# cmd {' '.join(self.cmd)}\n# started {now_iso()}\n\n")
                self.proc = subprocess.Popen(
                    self.cmd, cwd=str(self.cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace", bufsize=1,
                    creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
                try:
                    self.proc.stdin.write(self.prompt)
                    self.proc.stdin.close()
                except Exception as e:  # noqa: BLE001
                    lf.write(f"[stdin error] {e}\n")
                for line in self.proc.stdout:
                    self.last_output = time.time()
                    lf.write(line)
                    self._observe(line)
                self.exit_code = self.proc.wait()
                lf.write(f"\n# exit {self.exit_code} at {now_iso()}\n")
        except Exception as e:  # noqa: BLE001
            self.error = str(e)
            self.exit_code = -1

    def _observe(self, line: str):
        line = line.strip()
        if not line.startswith("{"):
            return
        try:
            ev = json.loads(line)
        except Exception:  # noqa: BLE001
            return
        # Claude Code stream-json
        if ev.get("type") == "assistant":
            for c in (ev.get("message") or {}).get("content", []) or []:
                if c.get("type") == "tool_use":
                    cmd = str((c.get("input") or {}).get("command", ""))
                    self.phase = "testing" if any(k in cmd for k in ("test", "pytest", "vitest", "lint", "tsc")) else "implementing"
        elif ev.get("type") == "result":
            self.result_text = str(ev.get("result") or "")[:4000]
        # Gemini CLI stream-json
        elif ev.get("type") == "tool_use":
            cmd = str((ev.get("input") or ev.get("args") or {}).get("command", ""))
            self.phase = "testing" if any(k in cmd for k in ("test", "pytest", "vitest", "lint", "tsc")) else "implementing"
        elif ev.get("type") == "message" and ev.get("role") == "assistant" and ev.get("content"):
            self.result_text = str(ev.get("content"))[:4000]
        # Codex exec --json
        elif ev.get("type") in ("item.completed", "item.started"):
            item = ev.get("item") or {}
            if item.get("type") == "command_execution":
                cmd = str(item.get("command", ""))
                self.phase = "testing" if any(k in cmd for k in ("test", "pytest", "vitest", "lint", "tsc")) else "implementing"
            elif item.get("type") == "agent_message" and ev.get("type") == "item.completed":
                self.result_text = str(item.get("text") or "")[:4000]

    def alive(self) -> bool:
        return self.thread.is_alive()

    def timed_out(self) -> bool:
        return (time.time() - self.started) > self.timeout

    def kill(self):
        self.cancelled = True
        if self.proc and self.proc.poll() is None:
            try:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/T", "/F", "/PID", str(self.proc.pid)], capture_output=True)
                else:
                    self.proc.terminate()
            except Exception:  # noqa: BLE001
                pass


def build_prompt(task: dict, project_dir: Path) -> str:
    return (
        "[바이브코딩인력사무소 작업 지시]\n"
        f"프로젝트: {task.get('project_id')}\n"
        f"작업 ID: {task.get('task_id')} (rev {task.get('revision')})\n"
        f"제목: {task.get('title')}\n"
        f"목적: {task.get('goal') or '(없음)'}\n"
        f"완료 조건: {task.get('done_criteria') or '(없음)'}\n\n"
        "규칙:\n"
        f"- 작업 폴더는 {project_dir} 이며, 이 폴더 안의 파일만 읽고 수정한다.\n"
        "- git push, 배포, 외부 전송, 비밀정보 출력은 하지 않는다. 커밋도 하지 않는다 (사람이 검토 후 처리).\n"
        "- 완료 조건을 만족했는지 스스로 판단하고, 마지막에 '변경한 파일', '검사 결과', '완료 조건 충족 여부', '남은 일'을 한국어로 요약한다.\n"
        "- 요약은 사실만 적는다. 하지 않은 검사를 했다고 쓰지 않는다.\n"
    )


_HELP_CACHE: dict = {}


def _gemini_supports(tool_path: str, token: str) -> bool:
    if tool_path not in _HELP_CACHE:
        try:
            r = subprocess.run([tool_path, "--help"], capture_output=True, timeout=30)
            _HELP_CACHE[tool_path] = (r.stdout + r.stderr).decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            _HELP_CACHE[tool_path] = ""
    return token in _HELP_CACHE[tool_path]


def build_command(tool_key: str, tool_path: str) -> list:
    if tool_key == "claude":
        allowed = "Read,Edit,Write,MultiEdit,Grep,Glob,LS,Bash(npm test*),Bash(npm run*),Bash(npx vitest*),Bash(npx tsc*),Bash(python -m pytest*),Bash(git status*),Bash(git diff*),Bash(git log*)"
        return [tool_path, "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--allowedTools", allowed]
    if tool_key == "codex":
        return [tool_path, "exec", "--json", "--sandbox", "workspace-write", "-"]
    if tool_key == "gemini":
        # 프롬프트는 stdin 으로 전달. 파일 수정은 자동 승인, 셸 명령은 비대화형이라 거부됨.
        fmt = "stream-json" if _gemini_supports(tool_path, "stream-json") else "json"
        mode = ["--approval-mode", "auto_edit"] if _gemini_supports(tool_path, "--approval-mode") else []
        return [tool_path, "--output-format", fmt, *mode]
    raise ValueError(tool_key)


# ---------------------------------------------------------------- 메인 루프
class Runner:
    def __init__(self):
        self.cfg = load_config()
        self.tools = detect_tools(self.cfg)
        for k, t in self.tools.items():
            log(f"도구 {k}: {t['status']} {t['version'] or ''} {t['path'] or ''}")
        RUNS_DIR.mkdir(parents=True, exist_ok=True)
        PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
        self.ledger = Ledger()
        self.active = None  # RunProcess
        self.active_run_id = None
        self.active_task_id = None
        self.active_member_id = None
        self.active_tool_key = None
        self.last_confirm_write = 0.0

    # ----- 등록·heartbeat
    def register_and_heartbeat(self):
        cfg, tools = self.cfg, self.tools
        now = now_iso()

        def fn(ws: dict) -> bool:
            devices = ws.setdefault("devices", [])
            dev = next((d for d in devices if d.get("device_id") == cfg["device_id"]), None)
            tool_rows = [{"tool": k, "status": ("test_passed" if t.get("tested") else t["status"])} for k, t in tools.items()]
            if dev is None:
                dev = {"device_id": cfg["device_id"]}
                devices.append(dev)
            dev.update({"name": cfg["device_name"], "connection_state": "healthy", "last_heartbeat_at": now,
                        "max_concurrent_managed_runs": int(cfg["max_concurrent_managed_runs"]), "tools": tool_rows,
                        "runner_version": VERSION})
            members = ws.setdefault("members", [])
            ui = ws.setdefault("ui", {})
            bindings = ui.setdefault("seat_bindings", {})
            # 소유자가 지정한 외부 작업 팀원(직접 보고). 없을 때만 만들고, 기존 팀원은 건드리지 않는다.
            for ext in cfg.get("external_members", []):
                if not any(x.get("member_id") == ext["member_id"] for x in members):
                    members.append({"member_id": ext["member_id"], "display_name": ext["display_name"], "role_label": ext["role_label"],
                                    "execution_mode": "external", "tool_label": ext["tool_label"], "connection_state": "unknown",
                                    "last_heartbeat_at": None, "capabilities": {"request_cancel": False}})
                if ext.get("seat") and not bindings.get(ext["seat"]):
                    bindings[ext["seat"]] = ext["member_id"]
            for key, t in tools.items():
                spec = cfg["tools"][key]
                m = next((x for x in members if x.get("member_id") == spec["member_id"]), None)
                installed = t["status"] != "not_installed"
                if m is None:
                    if not installed:
                        continue
                    m = {"member_id": spec["member_id"], "display_name": spec["display_name"], "role_label": spec["role_label"]}
                    members.append(m)
                if not installed and m.get("execution_mode") == "external":
                    continue  # 도구가 없으면 외부 작업(직접 보고) 팀원 그대로 둔다
                m.update({"execution_mode": "managed" if installed else "unconfigured", "tool_label": spec["tool_label"],
                          "connection_state": "healthy" if installed else "unknown", "last_heartbeat_at": now if installed else None,
                          "capabilities": {"request_cancel": True}})
                seat = spec.get("seat")
                if seat and not bindings.get(seat) and installed:
                    bindings[seat] = spec["member_id"]
            return True

        self.ledger.mutate(fn)

    # ----- 실행 선택
    def pick_task(self, ws: dict):
        if self.active is not None:
            return None
        cfg = self.cfg
        my_members = {cfg["tools"][k]["member_id"]: k for k, t in self.tools.items() if t["status"] != "not_installed"}
        active_runs = [r for r in ws.get("runs", []) if r.get("status") in ACTIVE_RUN and r.get("device_id") == cfg["device_id"]]
        if len(active_runs) >= int(cfg["max_concurrent_managed_runs"]):
            return None
        candidates = [t for t in ws.get("tasks", []) if t.get("run_requested_at") and t.get("status") in ("ready", "needs_changes")
                      and t.get("assignee_member_id") in my_members
                      and not any(r.get("task_id") == t.get("task_id") and r.get("status") in ACTIVE_RUN for r in ws.get("runs", []))]
        if not candidates:
            return None
        candidates.sort(key=lambda t: t.get("run_requested_at") or "")
        t = candidates[0]
        return t, my_members[t["assignee_member_id"]]

    def project_dir(self, project_id: str, ws: dict | None = None) -> Path:
        """작업 폴더 결정: config.projects[ID 또는 이름] > C:\\CBAO\\projects\\<이름>. 없고 repo_reference 가 있으면 git clone."""
        proj = next((p for p in (ws or {}).get("projects", []) if p.get("project_id") == project_id), None) or {}
        name = str(proj.get("name") or project_id).strip()
        safe = "".join(ch for ch in name if ch.isalnum() or ch in "-_.")[:48] or project_id
        override = self.cfg.get("projects", {}).get(project_id) or self.cfg.get("projects", {}).get(name)
        p = Path(override) if override else PROJECTS_DIR / safe
        if not p.exists():
            repo = str(proj.get("repo_reference") or "").strip()
            if repo:
                url = repo if repo.startswith("http") else f"https://github.com/{repo}.git"
                git = which("git")
                if not git:
                    log("git 이 설치되어 있지 않아 저장소를 내려받을 수 없습니다. https://git-scm.com 에서 설치하세요. 빈 폴더로 진행합니다.")
                else:
                    log(f"저장소 내려받기: {url} → {p}")
                    p.parent.mkdir(parents=True, exist_ok=True)
                    r = subprocess.run([git, "clone", url, str(p)], capture_output=True, timeout=600)
                    if r.returncode != 0:
                        log("내려받기 실패: " + (r.stderr or r.stdout).decode("utf-8", errors="replace")[-400:])
            p.mkdir(parents=True, exist_ok=True)
        return p

    def start_run(self, task: dict, tool_key: str):
        cfg = self.cfg
        run_id = f"run-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        member_id = cfg["tools"][tool_key]["member_id"]
        now = now_iso()

        def fn(ws: dict) -> bool:
            t = next((x for x in ws.get("tasks", []) if x.get("task_id") == task["task_id"]), None)
            if not t or t.get("status") not in ("ready", "needs_changes") or not t.get("run_requested_at"):
                return False
            if any(r.get("task_id") == t["task_id"] and r.get("status") in ACTIVE_RUN for r in ws.get("runs", [])):
                return False
            ws.setdefault("runs", []).append({
                "run_id": run_id, "task_id": t["task_id"], "member_id": member_id, "device_id": cfg["device_id"],
                "status": "starting", "evidence_source": "runner_observed", "last_confirmed_at": now, "phase": "implementing",
                "started_at": now, "sequence": next_seq(ws), "cancel_requested_at": None, "cancel_delivery": "none",
                "tool": tool_key, "task_revision": t.get("revision"),
            })
            t["status"] = "active"
            t["updated_at"] = now
            t["run_requested_at"] = None
            return True

        ws = self.ledger.mutate(fn)
        if not any(r.get("run_id") == run_id for r in ws.get("runs", [])):
            log("실행 시작 취소 (작업 상태가 바뀜)")
            return
        pdir = self.project_dir(task["project_id"], ws)
        cmd = build_command(tool_key, self.tools[tool_key]["path"])
        rp = RunProcess(run_id, cmd, pdir, build_prompt(task, pdir), RUNS_DIR / f"{run_id}.log", int(cfg["run_timeout_minutes"]))
        rp.start()
        self.active, self.active_run_id, self.active_task_id, self.active_member_id, self.active_tool_key = rp, run_id, task["task_id"], member_id, tool_key
        log(f"실행 시작 {run_id}: {task['title']} ({tool_key}) in {pdir}")
        self.update_run(status="running")

    # ----- 실행 상태 기록
    def update_run(self, **fields):
        run_id = self.active_run_id

        def fn(ws: dict) -> bool:
            r = next((x for x in ws.get("runs", []) if x.get("run_id") == run_id), None)
            if not r:
                return False
            r.update(fields)
            r["last_confirmed_at"] = now_iso()
            return True

        self.ledger.mutate(fn)

    def check_active(self, ws: dict):
        rp = self.active
        if rp is None:
            return
        r = next((x for x in ws.get("runs", []) if x.get("run_id") == self.active_run_id), None)
        # 중지 요청 처리
        if r and r.get("cancel_requested_at") and r.get("cancel_delivery") in ("pending", "none") and rp.alive():
            log(f"중지 요청 수신 → 프로세스 종료 {self.active_run_id}")
            self.update_run(status="stopping", cancel_delivery="delivered")
            rp.kill()
            time.sleep(2)
        if rp.alive():
            if rp.timed_out():
                log("실행 시간 초과 → 종료")
                rp.kill()
                time.sleep(2)
            elif time.time() - self.last_confirm_write >= 5:
                self.update_run(status="running", phase=rp.phase)
                self.last_confirm_write = time.time()
            if rp.alive():
                return
        # 종료 처리
        self.finish_run(rp, r)

    def finish_run(self, rp: RunProcess, r: dict | None):
        run_id, task_id, member_id = self.active_run_id, self.active_task_id, self.active_member_id
        cancelled = rp.cancelled
        timed_out = rp.timed_out() and not cancelled
        ok = (rp.exit_code == 0) and not cancelled and not timed_out and not rp.error
        status = "cancelled" if cancelled else ("failed" if (timed_out or not ok) else "succeeded")
        log_hash = None
        try:
            log_hash = hashlib.sha256(rp.log_path.read_bytes()).hexdigest()
        except Exception:  # noqa: BLE001
            pass
        now = now_iso()
        summary = rp.result_text.strip() or ("(실행 결과 텍스트 없음)" if ok else f"exit={rp.exit_code} error={rp.error or ''} timeout={timed_out}")

        def fn(ws: dict) -> bool:
            run = next((x for x in ws.get("runs", []) if x.get("run_id") == run_id), None)
            task = next((x for x in ws.get("tasks", []) if x.get("task_id") == task_id), None)
            if not run:
                return False
            run.update({"status": status, "last_confirmed_at": now, "finished_at": now, "exit_code": rp.exit_code,
                        "cancel_delivery": "confirmed" if cancelled else run.get("cancel_delivery", "none")})
            seq = next_seq(ws)
            ws.setdefault("artifacts", []).append({
                "artifact_id": f"art-{run_id}-log", "task_id": task_id, "member_id": member_id,
                "title": f"실행 로그 {run_id}", "kind": "file", "reference": str(rp.log_path), "content_hash": log_hash, "submitted_at": now,
            })
            ws["artifacts"].append({
                "artifact_id": f"art-{run_id}-summary", "task_id": task_id, "member_id": member_id,
                "title": f"실행 요약 {run_id} ({'성공' if ok else status})", "kind": "note", "reference": summary[:4000], "content_hash": None, "submitted_at": now,
            })
            if task and task.get("status") not in ("done", "cancelled"):
                if ok:
                    task["status"] = "awaiting_owner"
                    ws.setdefault("approvals", []).append({
                        "approval_id": f"ap-{run_id}", "task_id": task_id, "project_id": task.get("project_id"), "member_id": member_id,
                        "kind": "result", "summary": f"실행 종료(성공): {task.get('title')} — 결과 검토 후 승인/보완/반려", "requested_at": now,
                        "decision": None, "decided_at": None, "sequence": seq + 1,
                    })
                elif cancelled:
                    task["status"] = "ready"
                else:
                    task["status"] = "blocked"
                task["updated_at"] = now
                task["revision"] = int(task.get("revision", 1)) + 1
            return True

        self.ledger.mutate(fn)
        if ok:
            self.tools[self.active_tool_key]["tested"] = True
        log(f"실행 종료 {run_id}: {status} (exit {rp.exit_code})")
        self.active = self.active_run_id = self.active_task_id = self.active_member_id = self.active_tool_key = None

    # ----- 종료 시 오프라인 표시
    def mark_offline(self):
        cfg = self.cfg

        def fn(ws: dict) -> bool:
            for d in ws.get("devices", []):
                if d.get("device_id") == cfg["device_id"]:
                    d["connection_state"] = "offline"
            for k in self.tools:
                mid = cfg["tools"][k]["member_id"]
                for m in ws.get("members", []):
                    if m.get("member_id") == mid:
                        m["connection_state"] = "offline"
            return True

        try:
            self.ledger.mutate(fn)
        except Exception:  # noqa: BLE001
            pass

    def loop(self):
        log(f"심부름꾼 v{VERSION} 시작. 폴더 {BASE}. Ctrl+C 로 종료.")
        try:
            while True:
                try:
                    self.register_and_heartbeat()
                    ws = self.ledger.read()
                    self.check_active(ws)
                    if self.active is None:
                        picked = self.pick_task(ws)
                        if picked:
                            self.start_run(*picked)
                except KeyboardInterrupt:
                    raise
                except Exception as e:  # noqa: BLE001
                    log(f"오류 (다음 주기에 재시도): {e}")
                time.sleep(int(self.cfg["poll_seconds"]))
        except KeyboardInterrupt:
            log("종료 중…")
            if self.active:
                self.active.kill()
            self.mark_offline()


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10 이상이 필요합니다.")
    Runner().loop()
