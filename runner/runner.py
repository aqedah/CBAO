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
VERSION = "0.5.0"


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

    # ----- 대화방 (workspaces/{uid}/threads/{id})
    def queued_threads(self) -> list:
        col = self.ref.collection("threads")
        try:
            docs = list(col.where("status", "==", "queued").limit(10).stream())
        except Exception:  # noqa: BLE001 — 색인 문제 등
            docs = [d for d in col.limit(100).stream() if (d.to_dict() or {}).get("status") == "queued"]
        out = [d.to_dict() for d in docs]
        out.sort(key=lambda t: ((t.get("pending") or {}).get("requested_at") or ""))
        return out

    def thread_read(self, thread_id: str) -> dict:
        return self.ref.collection("threads").document(thread_id).get().to_dict() or {}

    def thread_mutate(self, thread_id: str, fn):
        ref = self.ref.collection("threads").document(thread_id)
        tx = self.db.transaction()
        fs = self.fs

        @fs.transactional
        def run(transaction):
            snap = ref.get(transaction=transaction)
            t = snap.to_dict() or {}
            if fn(t):
                t["updated_at"] = now_iso()
                transaction.set(ref, t)
            return t

        return run(tx)


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
        self.session_id = None
        self.progress: list = []
        self.thread = threading.Thread(target=self._run, daemon=True)

    def note(self, text: str):
        text = text.strip()
        if text and (not self.progress or self.progress[-1] != text):
            self.progress.append(text[:200])
            if len(self.progress) > 60:
                self.progress = self.progress[-60:]

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
        if ev.get("session_id") and not self.session_id:
            self.session_id = str(ev.get("session_id"))
        # Claude Code stream-json
        if ev.get("type") == "assistant":
            for c in (ev.get("message") or {}).get("content", []) or []:
                if c.get("type") == "tool_use":
                    inp = c.get("input") or {}
                    cmd = str(inp.get("command", ""))
                    self.phase = "testing" if any(k in cmd for k in ("test", "pytest", "vitest", "lint", "tsc")) else "implementing"
                    name = c.get("name", "")
                    target = inp.get("file_path") or inp.get("path") or inp.get("pattern") or cmd
                    self.note(f"{name}: {str(target)[:120]}")
                elif c.get("type") == "text" and c.get("text"):
                    self.note("💬 " + str(c.get("text"))[:160])
        elif ev.get("type") == "result":
            self.result_text = str(ev.get("result") or "")[:4000]
        # Gemini CLI stream-json
        elif ev.get("type") == "tool_use":
            inp = ev.get("input") or ev.get("args") or {}
            cmd = str(inp.get("command", ""))
            self.phase = "testing" if any(k in cmd for k in ("test", "pytest", "vitest", "lint", "tsc")) else "implementing"
            self.note(f"{ev.get('name', 'tool')}: {str(inp.get('file_path') or inp.get('path') or cmd)[:120]}")
        elif ev.get("type") == "message" and ev.get("role") == "assistant" and ev.get("content"):
            self.result_text = str(ev.get("content"))[:4000]
        # Codex exec --json
        elif ev.get("type") == "thread.started" and ev.get("thread_id"):
            self.session_id = str(ev.get("thread_id"))
        elif ev.get("type") in ("item.completed", "item.started"):
            item = ev.get("item") or {}
            if item.get("type") == "command_execution":
                cmd = str(item.get("command", ""))
                self.phase = "testing" if any(k in cmd for k in ("test", "pytest", "vitest", "lint", "tsc")) else "implementing"
                self.note("명령: " + cmd[:120])
            elif item.get("type") in ("file_change", "patch") and ev.get("type") == "item.completed":
                self.note("파일 변경")
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


def build_command(tool_key: str, tool_path: str, read_only: bool = False, resume: str | None = None) -> list:
    if tool_key == "claude":
        allowed = ("Read,Grep,Glob,LS,Bash(git status*),Bash(git diff*),Bash(git log*)" if read_only else
                   "Read,Edit,Write,MultiEdit,Grep,Glob,LS,Bash(npm test*),Bash(npm run*),Bash(npx vitest*),Bash(npx tsc*),Bash(python -m pytest*),Bash(git status*),Bash(git diff*),Bash(git log*)")
        cmd = [tool_path, "-p", "--output-format", "stream-json", "--verbose", "--allowedTools", allowed]
        if not read_only:
            cmd += ["--permission-mode", "acceptEdits"]
        if resume:
            cmd += ["--resume", resume]
        return cmd
    if tool_key == "codex":
        base = [tool_path, "exec"]
        if resume:
            base += ["resume", resume]
        return base + ["--json", "--sandbox", "read-only" if read_only else "workspace-write", "-"]
    if tool_key == "gemini":
        # 프롬프트는 stdin 으로 전달. 파일 수정은 자동 승인, 셸 명령은 비대화형이라 거부됨.
        fmt = "stream-json" if _gemini_supports(tool_path, "stream-json") else "json"
        mode = ["--approval-mode", "auto_edit"] if (not read_only and _gemini_supports(tool_path, "--approval-mode")) else []
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
        self.chat = None  # 진행 중인 대화 턴 {thread_id, turn, rp, run_id, tool_key, member_id, mode, last_relay}

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
                    else:
                        self._git_setup(p)
            p.mkdir(parents=True, exist_ok=True)
        self._git_refresh(p)
        return p

    @staticmethod
    def _git(cwd: Path, *args, timeout=120):
        git = which("git")
        if not git:
            return 127, "git not installed"
        r = subprocess.run([git, *args], cwd=str(cwd), capture_output=True, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).decode("utf-8", errors="replace").strip()

    def _git_setup(self, p: Path):
        # 윈도우 CRLF 를 저장소에는 LF 로, 커밋 작성자는 Runner 로 (push 권한은 PC 의 GitHub 로그인에 따른다)
        self._git(p, "config", "core.autocrlf", "true")
        self._git(p, "config", "user.name", "CBAO Runner")
        self._git(p, "config", "user.email", "cbao-runner@users.noreply.github.com")

    def _git_refresh(self, p: Path):
        """실행 전 main 을 최신으로. 올리지 않은 변경이 있으면 건드리지 않는다."""
        if not (p / ".git").exists():
            return
        code, out = self._git(p, "status", "--porcelain")
        if code != 0 or out:
            return  # 아직 올리지 않은 변경이 남아 있음 → 그대로 둔다
        code, branch = self._git(p, "rev-parse", "--abbrev-ref", "HEAD")
        if code == 0 and branch not in ("main", "master"):
            self._git(p, "checkout", "main")
        self._git(p, "pull", "--ff-only", timeout=300)

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

    # ----- 채팅 모드: 대화방 턴 실행
    MAX_TRANSCRIPT = 12

    def _member_tool(self, member_id: str):
        for key, spec in self.cfg["tools"].items():
            if spec["member_id"] == member_id and self.tools.get(key, {}).get("status") != "not_installed":
                return key
        return None

    def _thread_msg(self, t: dict, role: str, kind: str, text: str, member_id=None, run_id=None, replace_last_progress=False):
        msgs = t.setdefault("messages", [])
        if replace_last_progress and msgs and msgs[-1].get("kind") == "progress" and msgs[-1].get("run_id") == run_id:
            msgs[-1]["text"] = text[:4000]
            msgs[-1]["at"] = now_iso()
            return
        msgs.append({"message_id": f"msg-{uuid.uuid4().hex[:12]}", "role": role, "member_id": member_id, "kind": kind,
                     "text": text[:8000], "at": now_iso(), "run_id": run_id})
        if len(msgs) > 300:
            del msgs[:len(msgs) - 300]

    def _transcript(self, t: dict, limit: int) -> str:
        lines = []
        for m in [m for m in t.get("messages", []) if m.get("kind") in ("chat", "result", "review")][-limit:]:
            who = "소유자" if m.get("role") == "owner" else (m.get("member_id") or "사무실")
            lines.append(f"[{who}] {str(m.get('text', ''))[:1500]}")
        return "\n".join(lines)

    def _git_diff_text(self, pdir: Path, limit=30000) -> str:
        if not (pdir / ".git").exists():
            return "(git 저장소 아님)"
        self._git(pdir, "add", "-N", ".")
        code, stat = self._git(pdir, "diff", "--stat")
        code2, diff = self._git(pdir, "diff")
        text = (stat or "") + "\n\n" + (diff or "")
        return text[:limit] + ("\n…(이하 생략)" if len(text) > limit else "")

    def check_chat(self, ws: dict):
        """진행 중 턴 중계·종료, 없으면 큐에서 하나 시작 (작업 카드 실행과 합쳐 PC당 1개)."""
        if self.chat:
            self._chat_tick(ws)
            return
        if self.active is not None:
            return
        for t in self.ledger.queued_threads():
            pend = t.get("pending") or {}
            member = pend.get("member_id") or t.get("member_id")
            if pend.get("mode") == "publish":
                self._chat_publish(t)
                return
            tool_key = self._member_tool(member)
            if not tool_key:
                self.ledger.thread_mutate(t["thread_id"], lambda th: (self._thread_msg(th, "system", "error", f"{member} 는 이 PC 에 연결된 도구가 아닙니다."), th.update({"status": "idle", "pending": None}), True)[-1])
                continue
            self._chat_start(t, tool_key, member, pend)
            return

    def _chat_start(self, t: dict, tool_key: str, member_id: str, pend: dict):
        thread_id = t["thread_id"]
        mode = pend.get("mode", "chat")
        ws = self.ledger.read()
        pdir = self.project_dir(t["project_id"], ws)
        run_id = f"run-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        now = now_iso()
        # 장부: run + task 상태
        def wfn(w: dict) -> bool:
            w.setdefault("runs", []).append({
                "run_id": run_id, "task_id": thread_id, "member_id": member_id, "device_id": self.cfg["device_id"],
                "status": "running", "evidence_source": "runner_observed", "last_confirmed_at": now,
                "phase": "reviewing" if mode == "review" else "implementing", "started_at": now, "sequence": next_seq(w),
                "cancel_requested_at": None, "cancel_delivery": "none", "tool": tool_key, "chat": True,
            })
            for task in w.get("tasks", []):
                if task.get("task_id") == thread_id:
                    task["status"] = "active"; task["assignee_member_id"] = member_id; task["updated_at"] = now
            return True
        self.ledger.mutate(wfn)
        # 프롬프트
        owner_text = ""
        if pend.get("message_id"):
            m = next((x for x in t.get("messages", []) if x.get("message_id") == pend["message_id"]), None)
            owner_text = str(m.get("text", "")) if m else ""
        sessions = t.get("sessions") or {}
        resume = sessions.get(tool_key) if tool_key in ("claude", "codex") and mode != "review" else None
        header = (f"[바이브코딩인력사무소 · 프로젝트 {t.get('project_id')} · 대화방 {thread_id}]\n"
                  f"작업 폴더: {pdir}. 이 폴더 안의 파일만 읽고 수정한다. git push·커밋·배포·외부 전송·비밀정보 출력 금지.\n"
                  "답은 한국어로, 사실만. 끝에 '변경한 파일 / 검사 결과 / 남은 일'을 짧게 요약한다.\n")
        if mode == "review":
            prompt = (header + "\n[읽기 전용 교차 검토] 아래는 동료 AI 가 만든 변경(diff)과 대화 내용이다. 파일을 수정하지 말고, "
                      "버그·누락·위험·개선점을 중요도 순으로 한국어로 보고하라. 문제가 없으면 '문제 없음'이라고 명시하라.\n\n"
                      f"[대화]\n{self._transcript(t, self.MAX_TRANSCRIPT)}\n\n[변경 내용]\n{self._git_diff_text(pdir)}\n")
        elif resume:
            prompt = owner_text or "(지시 없음)"
        else:
            prior = self._transcript(t, self.MAX_TRANSCRIPT)
            prompt = header + (f"\n[지금까지의 대화]\n{prior}\n" if prior else "") + f"\n[새 지시]\n{owner_text or '(지시 없음)'}\n"
        cmd = build_command(tool_key, self.tools[tool_key]["path"], read_only=(mode == "review"), resume=resume)
        rp = RunProcess(run_id, cmd, pdir, prompt, RUNS_DIR / f"{run_id}.log", int(self.cfg["run_timeout_minutes"]))
        rp.start()
        self.chat = {"thread_id": thread_id, "turn": pend, "rp": rp, "run_id": run_id, "tool_key": tool_key, "member_id": member_id, "mode": mode, "last_relay": 0.0, "resume_used": bool(resume)}
        self.ledger.thread_mutate(thread_id, lambda th: (th.update({"status": "running"}), self._thread_msg(th, "member", "progress", "시작…", member_id, run_id), True)[-1])
        log(f"대화 턴 시작 {thread_id} ({tool_key}, {mode}{', resume' if resume else ''})")

    def _chat_tick(self, ws: dict):
        c = self.chat; rp = c["rp"]
        run = next((r for r in ws.get("runs", []) if r.get("run_id") == c["run_id"]), None)
        if run and run.get("cancel_requested_at") and run.get("cancel_delivery") in ("pending", "none") and rp.alive():
            self._set_run(c["run_id"], status="stopping", cancel_delivery="delivered"); rp.kill(); time.sleep(2)
        if rp.alive():
            if rp.timed_out():
                rp.kill(); time.sleep(2)
            elif time.time() - c["last_relay"] >= 5:
                c["last_relay"] = time.time()
                self._set_run(c["run_id"], status="running", phase=rp.phase)
                if rp.progress:
                    text = "\n".join(rp.progress[-12:])
                    self.ledger.thread_mutate(c["thread_id"], lambda th: (self._thread_msg(th, "member", "progress", text, c["member_id"], c["run_id"], replace_last_progress=True), True)[-1])
            if rp.alive():
                return
        self._chat_finish()

    def _set_run(self, run_id: str, **fields):
        def fn(w: dict) -> bool:
            r = next((x for x in w.get("runs", []) if x.get("run_id") == run_id), None)
            if not r:
                return False
            r.update(fields); r["last_confirmed_at"] = now_iso(); return True
        self.ledger.mutate(fn)

    def _chat_finish(self):
        c = self.chat; rp = c["rp"]
        cancelled = rp.cancelled; timed_out = rp.timed_out() and not cancelled
        ok = (rp.exit_code == 0) and not cancelled and not timed_out and not rp.error
        status = "cancelled" if cancelled else ("failed" if not ok else "succeeded")
        now = now_iso()
        result = rp.result_text.strip()
        if not ok and not result:
            result = f"실행이 정상 종료되지 않았습니다 (exit={rp.exit_code}{', 시간 초과' if timed_out else ''}{', 중지됨' if cancelled else ''}). 로그: {rp.log_path}"
            if c.get("resume_used"):
                result += "\n(이전 대화 이어가기에 실패했을 수 있습니다. 다시 보내면 새 대화로 시작합니다.)"
        mode, member_id, thread_id = c["mode"], c["member_id"], c["thread_id"]

        def wfn(w: dict) -> bool:
            r = next((x for x in w.get("runs", []) if x.get("run_id") == c["run_id"]), None)
            if r:
                r.update({"status": status, "last_confirmed_at": now, "finished_at": now, "exit_code": rp.exit_code,
                          "cancel_delivery": "confirmed" if cancelled else r.get("cancel_delivery", "none")})
            for task in w.get("tasks", []):
                if task.get("task_id") == thread_id and task.get("status") not in ("done", "cancelled"):
                    task["status"] = "review" if ok else "blocked"; task["updated_at"] = now
            w.setdefault("artifacts", []).append({"artifact_id": f"art-{c['run_id']}-log", "task_id": thread_id, "member_id": member_id,
                                                  "title": f"실행 로그 {c['run_id']}", "kind": "file", "reference": str(rp.log_path), "content_hash": None, "submitted_at": now})
            return True
        self.ledger.mutate(wfn)

        def tfn(t: dict) -> bool:
            # 진행 메시지 정리 후 결과 추가
            msgs = t.get("messages", [])
            if msgs and msgs[-1].get("kind") == "progress" and msgs[-1].get("run_id") == c["run_id"]:
                msgs[-1]["text"] = "\n".join(rp.progress[-20:]) or "(진행 기록 없음)"
            self._thread_msg(t, "member", "review" if mode == "review" else ("result" if ok else "error"), result or "(응답 없음)", member_id, c["run_id"])
            if rp.session_id and (not c.get("resume_used") or ok) and mode != "review":
                t.setdefault("sessions", {})[c["tool_key"]] = rp.session_id
            if not ok and c.get("resume_used"):
                t.setdefault("sessions", {}).pop(c["tool_key"], None)
            t["status"] = "idle"; t["pending"] = None
            # 자동 교차 검토 1회 + 수정 1회 (무한 토론 방지)
            reviewer = t.get("auto_review_member_id")
            if ok and mode == "chat" and reviewer and reviewer != member_id and not t.get("auto_review_done"):
                t["auto_review_done"] = True
                t["pending"] = {"turn_id": f"turn-{uuid.uuid4().hex[:10]}", "member_id": reviewer, "mode": "review", "message_id": None, "requested_at": now}
                t["status"] = "queued"
                self._thread_msg(t, "system", "chat", f"자동 검토 요청 → {reviewer} (읽기 전용, 1회)")
            elif ok and mode == "review" and reviewer and not t.get("auto_fix_done") and t.get("auto_review_done") and "문제 없음" not in result:
                t["auto_fix_done"] = True
                mid = f"msg-{uuid.uuid4().hex[:12]}"
                t.setdefault("messages", []).append({"message_id": mid, "role": "system", "member_id": None, "kind": "chat", "at": now,
                                                     "text": "검토 의견 중 타당한 지적을 반영해 수정하라. 동의하지 않는 지적은 이유를 적고 넘어가라. (자동 수정 1회)"})
                t["pending"] = {"turn_id": f"turn-{uuid.uuid4().hex[:10]}", "member_id": t.get("member_id"), "mode": "chat", "message_id": mid, "requested_at": now}
                t["status"] = "queued"
            return True
        self.ledger.thread_mutate(thread_id, tfn)
        if ok:
            self.tools[c["tool_key"]]["tested"] = True
        log(f"대화 턴 종료 {thread_id}: {status}")
        self.chat = None

    def _chat_publish(self, t: dict):
        """소유자 '반영' → main 에 커밋·푸시. AI 호출 없음."""
        thread_id = t["thread_id"]; now = now_iso()
        ws = self.ledger.read()
        proj = next((p for p in ws.get("projects", []) if p.get("project_id") == t.get("project_id")), None) or {}
        pdir = self.project_dir(t["project_id"], ws)
        res = {"status": "failed", "message": "", "at": now, "commit": None}
        if not which("git") or not (pdir / ".git").exists():
            res["message"] = "git 저장소가 아니거나 git 이 없습니다."
        else:
            code, out = self._git(pdir, "status", "--porcelain")
            if code == 0 and not out:
                res.update({"status": "nothing", "message": "바뀐 파일이 없습니다."})
            else:
                title = str(t.get("title") or "변경")[:60]
                steps = (("add", "-A"), ("commit", "-m", f"{title} (CBAO 대화 {thread_id}, 소유자 반영)"))
                ok = True
                for args in steps:
                    code, out = self._git(pdir, *args)
                    if code != 0:
                        res["message"] = f"git {args[0]} 실패: {out[-300:]}"; ok = False; break
                if ok:
                    code, out = self._git(pdir, "pull", "--rebase", "origin", "main", timeout=300)
                    if code != 0:
                        self._git(pdir, "rebase", "--abort")
                        res["message"] = f"원격 변경과 충돌: {out[-300:]}"; ok = False
                if ok:
                    code, out = self._git(pdir, "push", "origin", "HEAD:main", timeout=600)
                    if code != 0:
                        res["message"] = f"push 실패 (GitHub 로그인 확인): {out[-300:]}"
                    else:
                        _, sha = self._git(pdir, "rev-parse", "HEAD")
                        res.update({"status": "pushed", "message": f"{proj.get('repo_reference') or ''} main 에 반영했습니다.", "commit": sha})
        def tfn(th: dict) -> bool:
            th["last_publish"] = res
            if res["status"] == "pushed":
                th["publish_count"] = int(th.get("publish_count", 0)) + 1
            self._thread_msg(th, "system", "publish" if res["status"] != "failed" else "error", res["message"])
            th["status"] = "idle"; th["pending"] = None
            return True
        self.ledger.thread_mutate(thread_id, tfn)
        if res["status"] == "pushed":
            def wfn(w: dict) -> bool:
                for task in w.get("tasks", []):
                    if task.get("task_id") == thread_id:
                        task["status"] = "done"; task["updated_at"] = now; task["revision"] = int(task.get("revision", 1)) + 1
                w.setdefault("artifacts", []).append({"artifact_id": f"art-pub-{res['commit'][:7]}", "task_id": thread_id, "member_id": t.get("member_id"),
                                                      "title": f"main 반영 커밋 {res['commit'][:7]}", "kind": "link", "reference": f"https://github.com/{proj.get('repo_reference')}/commit/{res['commit']}" if proj.get("repo_reference") and not str(proj.get("repo_reference")).startswith("http") else str(res["commit"]), "content_hash": res["commit"], "submitted_at": now})
                return True
            self.ledger.mutate(wfn)
        log(f"반영 {thread_id}: {res['status']} {res['message']}")

    # ----- GitHub 에 올리기 (소유자 요청 시에만, 검토용 브랜치)
    def handle_publish(self, ws: dict):
        for t in ws.get("tasks", []):
            if not t.get("publish_requested_at") or (t.get("publish") or {}).get("status") != "pending":
                continue
            if t.get("status") != "done":
                continue
            pub_result = self._publish(t, ws)
            tid = t["task_id"]

            def fn(w: dict, result=pub_result, tid=tid) -> bool:
                task = next((x for x in w.get("tasks", []) if x.get("task_id") == tid), None)
                if not task:
                    return False
                task["publish"] = result
                return True

            self.ledger.mutate(fn)
            log(f"올리기 {tid}: {pub_result['status']} {pub_result['message']}")

    def _publish(self, task: dict, ws: dict) -> dict:
        now = now_iso()
        proj = next((p for p in ws.get("projects", []) if p.get("project_id") == task.get("project_id")), None) or {}
        repo = str(proj.get("repo_reference") or "").strip()
        pdir = self.project_dir(task["project_id"], ws)
        if not which("git"):
            return {"status": "failed", "branch": None, "compare_url": None, "message": "git 이 설치되어 있지 않습니다.", "at": now}
        if not (pdir / ".git").exists():
            return {"status": "failed", "branch": None, "compare_url": None, "message": f"{pdir} 는 git 저장소가 아닙니다.", "at": now}
        safe_id = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in task["task_id"]).lower()
        branch = f"cbao/{safe_id}"
        code, out = self._git(pdir, "status", "--porcelain")
        if code != 0:
            return {"status": "failed", "branch": None, "compare_url": None, "message": out[-300:], "at": now}
        if not out:
            return {"status": "nothing_to_publish", "branch": None, "compare_url": None, "message": "변경된 파일이 없습니다.", "at": now}
        for args in (("checkout", "-B", branch), ("add", "-A"), ("commit", "-m", f"{task.get('title')} (CBAO {task['task_id']}, 소유자 승인)")):
            code, out = self._git(pdir, *args)
            if code != 0:
                return {"status": "failed", "branch": branch, "compare_url": None, "message": f"git {args[0]} 실패: {out[-300:]}", "at": now}
        code, out = self._git(pdir, "push", "-u", "origin", branch, timeout=600)
        if code != 0:
            return {"status": "failed", "branch": branch, "compare_url": None, "message": f"push 실패 (GitHub 로그인 필요할 수 있음): {out[-300:]}", "at": now}
        # 다음 작업을 위해 main 으로 복귀 (브랜치는 원격에 보존)
        self._git(pdir, "checkout", "main")
        compare = None
        m = repo if not repo.startswith("http") else repo.replace("https://github.com/", "").removesuffix(".git")
        if m and "/" in m:
            compare = f"https://github.com/{m}/compare/main...{branch}?expand=1"
        return {"status": "pushed", "branch": branch, "compare_url": compare, "message": "검토용 브랜치에 올렸습니다. GitHub 에서 합치기(PR)를 만드세요.", "at": now}

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
                    self.handle_publish(ws)
                    self.check_chat(ws)
                    if self.active is None and self.chat is None:
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
            if self.chat:
                self.chat["rp"].kill()
                try:
                    self.ledger.thread_mutate(self.chat["thread_id"], lambda th: (th.update({"status": "idle", "pending": None}), self._thread_msg(th, "system", "error", "심부름꾼이 종료되어 턴이 중단되었습니다. 다시 보내 주세요."), True)[-1])
                except Exception:  # noqa: BLE001
                    pass
            self.mark_offline()


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10 이상이 필요합니다.")
    Runner().loop()
