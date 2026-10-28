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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cbao_v2 as v2  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
RUNNER_DIR = BASE / "runner"
CONFIG_PATH = RUNNER_DIR / "config.json"
KEY_PATH = BASE / "serviceAccount.json"
RUNS_DIR = BASE / "runs"
PROJECTS_DIR = BASE / "projects"
WORKTREES_DIR = BASE / "worktrees"
ACTIVE_RUN = {"queued", "leased", "starting", "running", "waiting_input", "stopping"}
VERSION = "0.8.0"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log(msg: str) -> None:
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- 설정
DEFAULT_CONFIG = {
    "device_id": "pc-a",
    "device_name": "작업용 PC A",
    "workspace_uid": "",
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
    def __init__(self, cfg: dict | None = None):
        cfg = cfg or {}
        import firebase_admin
        from firebase_admin import credentials, firestore
        if not KEY_PATH.exists():
            raise SystemExit(f"열쇠 파일이 없습니다: {KEY_PATH}\nFirebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성 → 이 이름으로 저장하세요.")
        firebase_admin.initialize_app(credentials.Certificate(str(KEY_PATH)))
        self.fs = firestore
        self.db = firestore.client()
        want = str(cfg.get("workspace_uid") or "").strip()
        if want:
            self.ref = self.db.collection("workspaces").document(want)
            if not self.ref.get().exists:
                raise SystemExit(f"config.json 의 workspace_uid={want} 문서가 없습니다. 웹 사무실 → 설정 → 연결 에 보이는 UID 를 적으세요.")
        else:
            docs = list(self.db.collection("workspaces").limit(5).stream())
            if not docs:
                raise SystemExit("장부(workspaces)가 비어 있습니다. 먼저 웹 사무실에서 구글 로그인을 한 번 하세요.")
            if len(docs) > 1:
                raise SystemExit("workspace 문서가 여러 개입니다. config.json 에 workspace_uid 를 적어 어느 장부를 쓸지 고정하세요: " + ", ".join(d.id for d in docs))
            self.ref = docs[0].reference
            log(f"주의: config.json 에 workspace_uid 가 없어 유일한 장부 {docs[0].id} 를 씁니다. 고정하려면 workspace_uid 에 이 값을 적으세요.")
        log(f"장부 연결: workspaces/{self.ref.id}")

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
        """fn(t) -> bool. schema_version 2 면 fn 이 t['_new_messages'] / t['_patch_messages'] 에 모은 메시지를 같은 트랜잭션에서 하위 컬렉션에 쓴다."""
        ref = self.ref.collection("threads").document(thread_id)
        tx = self.db.transaction()
        fs = self.fs

        @fs.transactional
        def run(transaction):
            snap = ref.get(transaction=transaction)
            t = snap.to_dict() or {}
            t.pop("_new_messages", None); t.pop("_patch_messages", None)
            if fn(t):
                t["updated_at"] = now_iso()
                new = t.pop("_new_messages", []); patches = t.pop("_patch_messages", [])
                transaction.set(ref, t)
                for m in new:
                    transaction.set(ref.collection("messages").document(m["message_id"]), m)
                for mid, patch in patches:
                    transaction.set(ref.collection("messages").document(mid), patch, merge=True)
            return t

        return run(tx)

    def thread_messages(self, thread_id: str, limit: int = 60) -> list:
        col = self.ref.collection("threads").document(thread_id).collection("messages")
        try:
            docs = list(col.order_by("seq", direction=self.fs.Query.DESCENDING).limit(limit).stream())
        except Exception:  # noqa: BLE001
            docs = list(col.limit(limit * 2).stream())
        out = [d.to_dict() for d in docs]
        out.sort(key=lambda m: int(m.get("seq", 0)))
        return out

    def thread_message(self, thread_id: str, message_id: str) -> dict:
        return self.ref.collection("threads").document(thread_id).collection("messages").document(message_id).get().to_dict() or {}

    def recent_threads(self, n: int = 15) -> list:
        col = self.ref.collection("threads")
        try:
            docs = list(col.order_by("updated_at", direction=self.fs.Query.DESCENDING).limit(n).stream())
        except Exception:  # noqa: BLE001
            docs = list(col.limit(n).stream())
        return [d.to_dict() for d in docs]

    def migrate_threads(self):
        """schema 1(메시지 배열) → 2(하위 컬렉션). 원본 배열은 지우지 않는다. message_id 를 문서 ID 로 써서 다시 돌려도 중복이 없다 (OPS-01/02)."""
        n = 0
        for d in self.ref.collection("threads").limit(200).stream():
            t = d.to_dict() or {}
            if int(t.get("schema_version", 1)) >= 2 or t.get("status") != "idle":
                continue
            msgs = t.get("messages") or []
            batch = self.db.batch()
            for i, m in enumerate(msgs):
                mid = m.get("message_id") or f"msg-legacy-{hashlib.sha1(json.dumps(m, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]}"
                batch.set(d.reference.collection("messages").document(mid), {**m, "message_id": mid, "seq": i + 1})
            batch.set(d.reference, {"schema_version": 2, "message_count": len(msgs), "legacy_migrated_at": now_iso(), "legacy_message_count": len(msgs)}, merge=True)
            batch.commit()
            n += 1
        if n:
            log(f"대화방 {n}개의 메시지를 하위 컬렉션으로 옮겼습니다 (원본 배열은 보존).")


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
                env = dict(os.environ); env["CBAO_RUN_ID"] = self.run_id
                self.proc = subprocess.Popen(
                    self.cmd, cwd=str(self.cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace", bufsize=1, env=env,
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


def build_prompt(task: dict, project_dir: Path, branch_note: str = "작업 가지: main") -> str:
    return (
        "[바이브코딩인력사무소 작업 지시]\n"
        f"프로젝트: {task.get('project_id')}\n"
        f"작업 ID: {task.get('task_id')} (rev {task.get('revision')})\n"
        f"제목: {task.get('title')}\n"
        f"목적: {task.get('goal') or '(없음)'}\n"
        f"완료 조건: {task.get('done_criteria') or '(없음)'}\n\n"
        "규칙:\n"
        f"- 작업 폴더는 {project_dir} 이며, 이 폴더 안의 파일만 읽고 수정한다.\n"
        f"- {branch_note}\n"
        "- git push·commit·가지 바꾸기·배포·외부 전송·비밀정보 출력은 하지 않는다. 커밋과 올리기는 사무실에서 소유자가 '반영'을 누르면 Runner 가 한다.\n"
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
        allowed = v2.claude_allowed("discuss" if read_only else "exec")
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


# ---------------------------------------------------------------- 관찰형 연결 (Claude Code 훅)
OBSERVE_DIR = BASE / "observe"
EVENTS_PATH = OBSERVE_DIR / "events.jsonl"
HOOK_EVENTS = ("SessionStart", "UserPromptSubmit", "PreToolUse", "Stop", "SessionEnd")
OBSERVE_STALE_SEC = 15 * 60


def install_claude_hooks() -> str:
    """~/.claude/settings.json 에 훅을 등록한다(없을 때만). 다른 설정은 건드리지 않고 백업을 남긴다."""
    settings = Path.home() / ".claude" / "settings.json"
    hook_py = RUNNER_DIR / "hook.py"
    py = "py -3" if shutil.which("py") else "python"
    command = f'{py} "{hook_py}"'
    try:
        data = {}
        if settings.exists():
            data = json.loads(settings.read_text(encoding="utf-8") or "{}")
        hooks = data.setdefault("hooks", {})
        changed = False
        for ev in HOOK_EVENTS:
            entries = hooks.setdefault(ev, [])
            if any("hook.py" in json.dumps(e) for e in entries):
                continue
            entries.append({"hooks": [{"type": "command", "command": command, "timeout": 10}]})
            changed = True
        if changed:
            if settings.exists():
                shutil.copy2(settings, settings.with_suffix(".json.cbao-backup"))
            settings.parent.mkdir(parents=True, exist_ok=True)
            settings.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            return f"훅 등록: {settings}"
        return "훅 이미 등록됨"
    except Exception as e:  # noqa: BLE001
        return f"훅 등록 실패: {e}"


class Observer:
    """events.jsonl 을 꼬리 읽기해서 터미널에서 직접 실행한 Claude Code 세션을 장부에 '관찰형'으로 기록한다."""

    def __init__(self, runner):
        self.runner = runner
        self.pos = 0
        self.sessions: dict = {}  # session_id -> {cwd, title, started, last, phase, ended, run_id, task_id}
        OBSERVE_DIR.mkdir(parents=True, exist_ok=True)
        if EVENTS_PATH.exists():
            self.pos = EVENTS_PATH.stat().st_size  # 과거 기록은 무시하고 지금부터

    def tick(self):
        # 진행 중 세션은 매 주기 '살아 있음'을 갱신한다 (훅 이벤트가 뜸해도 30초 안에 끊김으로 보이지 않게, 최대 15분)
        live = [s for s in self.sessions.values() if not s["ended"]]
        if live and (time.time() - getattr(self, "_last_refresh", 0)) >= 20:
            self._last_refresh = time.time()
            self.runner.record_observed(live)
        new = []
        try:
            if EVENTS_PATH.exists():
                with open(EVENTS_PATH, "r", encoding="utf-8", errors="replace") as f:
                    f.seek(self.pos)
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                new.append(json.loads(line))
                            except Exception:  # noqa: BLE001
                                pass
                    self.pos = f.tell()
        except Exception:  # noqa: BLE001
            return
        changed = set()
        now = time.time()
        for ev in new:
            if ev.get("cbao_run_id") or not ev.get("session_id"):
                continue  # 심부름꾼이 띄운 세션은 이미 기록된다
            sid = ev["session_id"]
            s = self.sessions.setdefault(sid, {"cwd": ev.get("cwd") or "", "title": None, "started": now, "last": now, "phase": "implementing", "ended": False, "run_id": f"obs-{sid[:12]}", "task_id": f"obs-{sid[:12]}", "tools": 0})
            s["last"] = now
            kind = ev.get("event")
            if kind == "UserPromptSubmit":
                s["waiting"] = False; s["ended"] = False
                if ev.get("prompt") and not s["title"]:
                    s["title"] = ev["prompt"]
            if kind == "PreToolUse":
                s["waiting"] = False
                s["tools"] += 1
                target = str(ev.get("target") or "")
                s["phase"] = "testing" if any(k in target for k in ("test", "pytest", "vitest", "lint", "tsc")) else ("reviewing" if ev.get("tool") in ("Read", "Grep", "Glob") and s["tools"] < 4 else "implementing")
            if kind == "Stop":
                s["waiting"] = True  # 답을 마치고 사용자의 다음 입력을 기다리는 중
            if kind == "SessionEnd":
                s["ended"] = True
            changed.add(sid)
        # 오래 조용한 세션은 종료된 것으로 본다 (훅이 Stop 을 못 보낸 경우)
        for sid, s in self.sessions.items():
            if not s["ended"] and now - s["last"] > OBSERVE_STALE_SEC:
                s["ended"] = True; s["stale"] = True; changed.add(sid)
        if changed:
            self.runner.record_observed([self.sessions[sid] for sid in changed])
        for sid in [k for k, v in self.sessions.items() if v["ended"] and now - v["last"] > 3600]:
            del self.sessions[sid]


class Runner:
    def __init__(self):
        self.cfg = load_config()
        self.tools = detect_tools(self.cfg)
        for k, t in self.tools.items():
            log(f"도구 {k}: {t['status']} {t['version'] or ''} {t['path'] or ''}")
        RUNS_DIR.mkdir(parents=True, exist_ok=True)
        PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
        self.ledger = Ledger(self.cfg)
        self.ledger.migrate_threads()
        self.active = None  # RunProcess
        self.active_run_id = None
        self.active_task_id = None
        self.active_member_id = None
        self.active_tool_key = None
        self.last_confirm_write = 0.0
        self.chat = None  # 진행 중인 대화 턴 {thread_id, turn, rp, run_id, tool_key, member_id, mode, last_relay}
        if self.tools.get("claude", {}).get("status") != "not_installed":
            log(install_claude_hooks())
        self.observer = Observer(self)

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
                        "runner_version": VERSION, "workspace_uid": self.ledger.ref.id, "worktrees_root": str(WORKTREES_DIR),
                        "policy": {**v2.POLICY, "runner_version": VERSION, "reported_at": now,
                                   "tools": {k: {**v, "installed": tools.get(k, {}).get("status") != "not_installed"} for k, v in v2.POLICY["tools"].items()}}})
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

    @staticmethod
    def _proj(project_id: str, ws: dict | None) -> dict:
        return next((p for p in (ws or {}).get("projects", []) if p.get("project_id") == project_id), None) or {}

    @staticmethod
    def _flow(proj: dict) -> dict:
        """프로젝트 설정에서 가지·빌드·배포 흐름을 읽는다 (사무실 → 프로젝트 → 수정)."""
        work = str(proj.get("work_branch") or "main").strip() or "main"
        deploy = str(proj.get("deploy_branch") or "main").strip() or "main"
        ddir = str(proj.get("deploy_dir") or "").strip().strip("/\\")
        return {"work": work, "deploy": deploy, "build": str(proj.get("build_command") or "").strip(), "deploy_dir": ddir}

    def branch_note(self, project_id: str, ws: dict | None) -> str:
        f = self._flow(self._proj(project_id, ws))
        note = f"현재 작업 가지: {f['work']} (원본은 여기에 있다)."
        if f["deploy_dir"]:
            note += f" {f['deploy']} 가지는 빌드 결과물이며 반영 때 Runner 가 '{f['build']}' 를 돌려 {f['deploy_dir']}/ 를 {f['deploy']} 에 올린다. 빌드 결과물은 직접 고치지 않는다."
        return note

    def project_dir(self, project_id: str, ws: dict | None = None) -> Path:
        """작업 폴더 결정: config.projects[ID 또는 이름] > C:\\CBAO\\projects\\<이름>. 없고 repo_reference 가 있으면 git clone."""
        proj = self._proj(project_id, ws)
        name = str(proj.get("name") or project_id).strip()
        safe = "".join(ch for ch in name if ch.isalnum() or ch in "-_.")[:48] or project_id
        override = self.cfg.get("projects", {}).get(project_id) or self.cfg.get("projects", {}).get(name)
        p = Path(override) if override else PROJECTS_DIR / safe
        flow = self._flow(proj)
        if not p.exists():
            repo = str(proj.get("repo_reference") or "").strip()
            if repo:
                url = repo if repo.startswith("http") else f"https://github.com/{repo}.git"
                git = which("git")
                if not git:
                    log("git 이 설치되어 있지 않아 저장소를 내려받을 수 없습니다. https://git-scm.com 에서 설치하세요. 빈 폴더로 진행합니다.")
                else:
                    log(f"저장소 내려받기: {url} → {p} (가지 {flow['work']})")
                    p.parent.mkdir(parents=True, exist_ok=True)
                    r = subprocess.run([git, "clone", "--branch", flow["work"], url, str(p)], capture_output=True, timeout=600)
                    if r.returncode != 0:
                        log("내려받기 실패: " + (r.stderr or r.stdout).decode("utf-8", errors="replace")[-400:])
                    else:
                        self._git_setup(p)
            p.mkdir(parents=True, exist_ok=True)
        self._git_refresh(p, flow)
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

    @staticmethod
    def _status_spec(flow: dict) -> list:
        """빌드 결과 폴더는 '바뀐 파일'로 세지 않는다."""
        return [".", f":(exclude){flow['deploy_dir']}"] if flow.get("deploy_dir") and flow["deploy"] != flow["work"] else ["."]

    def _git_refresh(self, p: Path, flow: dict | None = None):
        """실행 전 작업 가지를 최신으로. 올리지 않은 변경이 있으면 건드리지 않는다."""
        flow = flow or self._flow({})
        if not (p / ".git").exists():
            return
        self.last_git_note = ""
        code, out = self._git(p, "status", "--porcelain", "--", *self._status_spec(flow))
        if code != 0:
            return
        code, branch = self._git(p, "rev-parse", "--abbrev-ref", "HEAD")
        if code == 0 and branch != flow["work"] and out:
            # 다른 가지에 올리지 않은 변경이 있다 → 보관(stash)하고 작업 가지로 간다. 버리지 않는다.
            code2, out2 = self._git(p, "stash", "push", "-u", "-m", f"CBAO: {branch} 가지의 올리지 않은 변경 ({now_iso()})")
            if code2 != 0:
                log(f"{branch} 의 변경을 보관하지 못해 가지를 바꾸지 않습니다: {out2[-200:]}")
                return
            self.last_git_note = (f"{branch} 가지에 올리지 않은 변경이 있어 'git stash' 로 보관하고 작업 가지 {flow['work']} 로 옮겼습니다. "
                                  f"(보관 내용: {out.splitlines()[0][:80]}{' 외' if len(out.splitlines()) > 1 else ''}) 필요하면 PC 에서 'git stash list' 로 볼 수 있습니다.")
            log(self.last_git_note)
            out = ""
        if out:
            return  # 작업 가지에 아직 올리지 않은 변경이 남아 있음 → 그대로 둔다 (pull 하지 않음)
        if code == 0 and branch != flow["work"]:
            self._git(p, "fetch", "origin", flow["work"], timeout=300)
            code, out = self._git(p, "checkout", flow["work"])
            if code != 0:
                code, out = self._git(p, "checkout", "-b", flow["work"], f"origin/{flow['work']}")
            if code != 0:
                log(f"가지 {flow['work']} 로 바꾸지 못했습니다: {out[-200:]}")
                return
            log(f"작업 가지 전환: {branch} → {flow['work']}")
        self._git(p, "pull", "--ff-only", "origin", flow["work"], timeout=300)

    def _build_and_deploy(self, pdir: Path, flow: dict, message: str) -> tuple[bool, str, str | None]:
        """빌드 명령을 돌리고, 배포 폴더 내용을 배포 가지에 올린다. (ok, 메시지, 배포 커밋)"""
        if not flow["deploy_dir"] or flow["deploy"] == flow["work"]:
            return True, "", None
        if flow["build"]:
            import shlex
            argv = shlex.split(flow["build"], posix=(os.name != "nt"))
            cwd = pdir
            # 스크립트 경로에 폴더가 있으면 그 폴더에서 돌린다 (python app/build_site.py → app 에서 python build_site.py)
            if len(argv) >= 2 and ("/" in argv[1] or "\\" in argv[1]) and (pdir / argv[1]).is_file():
                cwd = (pdir / argv[1]).parent; argv[1] = (pdir / argv[1]).name
            exe = which(argv[0]) or argv[0]
            try:
                r = subprocess.run([exe, *argv[1:]], cwd=str(cwd), capture_output=True, timeout=1200)
            except Exception as e:  # noqa: BLE001
                return False, f"빌드 실행 실패: {e}", None
            if r.returncode != 0:
                return False, f"빌드 실패 (exit {r.returncode}): {(r.stderr or r.stdout).decode('utf-8', errors='replace')[-400:]}", None
        src = pdir / flow["deploy_dir"]
        if not src.is_dir():
            return False, f"배포 폴더 {flow['deploy_dir']}/ 가 없습니다 (빌드 결과를 확인하세요).", None
        import shutil, tempfile
        wt = Path(tempfile.mkdtemp(prefix="cbao-deploy-", dir=str(BASE)))
        shutil.rmtree(wt, ignore_errors=True)
        try:
            self._git(pdir, "fetch", "origin", flow["deploy"], timeout=300)
            code, out = self._git(pdir, "worktree", "add", "--detach", str(wt), f"origin/{flow['deploy']}")
            if code != 0:
                return False, f"배포 가지 {flow['deploy']} 를 열지 못했습니다: {out[-300:]}", None
            for child in wt.iterdir():
                if child.name == ".git":
                    continue
                shutil.rmtree(child, ignore_errors=True) if child.is_dir() else child.unlink()
            for child in src.iterdir():
                shutil.copytree(child, wt / child.name) if child.is_dir() else shutil.copy2(child, wt / child.name)
            self._git(wt, "add", "-A")
            code, out = self._git(wt, "status", "--porcelain")
            if code == 0 and not out:
                return True, f"{flow['deploy']} 에는 바뀐 결과물이 없습니다.", None
            code, out = self._git(wt, "commit", "-m", message)
            if code != 0:
                return False, f"배포 커밋 실패: {out[-300:]}", None
            code, out = self._git(wt, "push", "origin", f"HEAD:{flow['deploy']}", timeout=600)
            if code != 0:
                return False, f"{flow['deploy']} push 실패: {out[-300:]}", None
            _, sha = self._git(wt, "rev-parse", "HEAD")
            return True, f"빌드 결과를 {flow['deploy']} 에 올렸습니다.", sha
        finally:
            self._git(pdir, "worktree", "remove", "--force", str(wt))
            shutil.rmtree(wt, ignore_errors=True)
            self._git(pdir, "worktree", "prune")

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
        rp = RunProcess(run_id, cmd, pdir, build_prompt(task, pdir, self.branch_note(task['project_id'], ws)), RUNS_DIR / f"{run_id}.log", int(cfg["run_timeout_minutes"]))
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

    # ----- 메시지 (schema_version 2: threads/{id}/messages 하위 컬렉션, 1: 배열)
    def _thread_msg(self, t: dict, role: str, kind: str, text: str, member_id=None, run_id=None, replace_last_progress=False, extra: dict | None = None):
        if int(t.get("schema_version", 1)) >= 2:
            if replace_last_progress and t.get("progress_message_id") and t.get("progress_run_id") == run_id:
                t.setdefault("_patch_messages", []).append((t["progress_message_id"], {"text": text[:12000], "at": now_iso()}))
                return
            t["message_count"] = int(t.get("message_count", 0)) + 1
            msg = {"message_id": f"msg-{uuid.uuid4().hex[:12]}", "seq": t["message_count"], "role": role, "member_id": member_id, "kind": kind,
                   "text": text[:40000], "at": now_iso(), "run_id": run_id, **(extra or {})}
            t.setdefault("_new_messages", []).append(msg)
            t["last_message"] = {"kind": kind, "role": role, "text": text[:160], "at": msg["at"]}
            if kind == "progress":
                t["progress_message_id"] = msg["message_id"]; t["progress_run_id"] = run_id
            return
        msgs = t.setdefault("messages", [])
        if replace_last_progress and msgs and msgs[-1].get("kind") == "progress" and msgs[-1].get("run_id") == run_id:
            msgs[-1]["text"] = text[:4000]
            msgs[-1]["at"] = now_iso()
            return
        msgs.append({"message_id": f"msg-{uuid.uuid4().hex[:12]}", "role": role, "member_id": member_id, "kind": kind,
                     "text": text[:8000], "at": now_iso(), "run_id": run_id, **(extra or {})})
        if len(msgs) > 300:
            del msgs[:len(msgs) - 300]

    def _transcript(self, t: dict, limit: int) -> str:
        msgs = self.ledger.thread_messages(t["thread_id"], limit * 3) if int(t.get("schema_version", 1)) >= 2 else t.get("messages", [])
        lines = []
        for m in [m for m in msgs if m.get("kind") in ("chat", "result", "review", "question")][-limit:]:
            who = "소유자" if m.get("role") == "owner" else (m.get("member_id") or "사무실")
            lines.append(f"[{who}] {str(m.get('text', ''))[:1500]}")
        return "\n".join(lines)

    def _git_diff_text(self, pdir: Path, base: str | None = None, limit=30000) -> str:
        if not (pdir / ".git").exists():
            return "(git 저장소 아님)"
        if base:
            code, stat = self._git(pdir, "diff", "--stat", base, "HEAD")
            code2, diff = self._git(pdir, "diff", base, "HEAD")
        else:
            self._git(pdir, "add", "-N", ".")
            code, stat = self._git(pdir, "diff", "--stat")
            code2, diff = self._git(pdir, "diff")
        text = (stat or "") + "\n\n" + (diff or "")
        return text[:limit] + ("\n…(이하 생략)" if len(text) > limit else "")

    # ----- 대화방 작업 폴더 (worktree)
    def _worktree(self, t: dict, ws: dict) -> v2.Worktree:
        proj = self._proj(t.get("project_id"), ws)
        flow = self._flow(proj)
        pdir = self.project_dir(t["project_id"], ws)
        return v2.Worktree(self._git, pdir, WORKTREES_DIR / (str(proj.get("name") or t["project_id"])[:40] or "p"), t["thread_id"], flow["work"])

    def _live_terminal_session(self, path: Path) -> bool:
        """같은 폴더에서 터미널 Claude 세션(훅 관찰)이 살아 있는가 — 살아 있으면 쓰기 턴을 시작하지 않는다 (SYNC-10)."""
        want = str(path).replace("\\", "/").rstrip("/").lower()
        for s in self.observer.sessions.values():
            if not s.get("ended") and str(s.get("cwd") or "").replace("\\", "/").rstrip("/").lower() == want:
                return True
        return False

    def _sync_state(self, wt: v2.Worktree, check_remote: bool) -> dict:
        return {"branch": wt.current_branch(), "head_sha": wt.head(), "dirty_paths": wt.dirty_paths()[:50],
                "checked_at": now_iso(), "remote": wt.remote_state() if check_remote else "unchecked", "worktree": str(wt.path)}

    def _add_checkpoint(self, t: dict, wt: v2.Worktree, base: str | None, sha: str, paths: list, origin: str, run_id=None, note: str = "") -> dict:
        cp = {"checkpoint_id": f"cp-{sha[:10]}", "branch": wt.branch, "base_sha": base, "candidate_sha": sha, "changed_paths": paths[:100],
              "origin": origin, "run_id": run_id, "at": now_iso(), "remote_sync_status": "local_only", "tests": None, "note": note[:300]}
        cps = t.setdefault("checkpoints", [])
        if not any(c.get("candidate_sha") == sha for c in cps):
            cps.append(cp)
            if len(cps) > 30:
                del cps[:len(cps) - 30]
        t["working_checkpoint_id"] = cp["checkpoint_id"]
        cp["context_version"] = v2.bump_context(t, "체크포인트", f"{origin} 에서 {sha[:10]} 저장 — {', '.join(paths[:6])}{' 외' if len(paths) > 6 else ''}")
        # 이전 검토는 다른 버전에 대한 것이 된다
        for r in t.get("reviews", []):
            if r.get("target_sha") != sha and not r.get("stale"):
                r["stale"] = True
        t["reviewed_checkpoint_id"] = None
        return cp

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
            mode = pend.get("mode", "chat")
            if mode in ("publish", "checkpoint", "share"):
                self._chat_git_action(t, mode)
                return
            tool_key = self._member_tool(member)
            if not tool_key:
                self.ledger.thread_mutate(t["thread_id"], lambda th: (self._thread_msg(th, "system", "error", f"{member} 는 이 PC 에 연결된 도구가 아닙니다. (GPT 는 API 어댑터가 없어 아직 대화 상대가 아닙니다)"), th.update({"status": "idle", "pending": None}), True)[-1])
                continue
            self._chat_start(t, tool_key, member, pend)
            return

    def _chat_start(self, t: dict, tool_key: str, member_id: str, pend: dict):
        thread_id = t["thread_id"]
        mode = pend.get("mode", "chat")            # discuss | chat(실행) | review
        ws = self.ledger.read()
        proj = self._proj(t.get("project_id"), ws)
        wt = self._worktree(t, ws)
        ok, note = wt.ensure()
        notes = [n for n in (getattr(self, "last_git_note", ""), note) if n]
        if not ok:
            # worktree 를 못 만들면 프로젝트 폴더에서 논의만 한다
            pdir = self.project_dir(t["project_id"], ws)
            if mode == "chat":
                self.ledger.thread_mutate(thread_id, lambda th: (self._thread_msg(th, "system", "error", note + " 논의 모드로만 쓸 수 있습니다."), th.update({"status": "idle", "pending": None}), True)[-1])
                return
            cwd = pdir; base_sha = None
        else:
            cwd = wt.path
            base_sha = wt.head()
        review_target = None; review_copy = None; review_id = None
        pre_dirty: list = []
        if ok and mode == "chat":
            if self._live_terminal_session(wt.path):
                self.ledger.thread_mutate(thread_id, lambda th: (self._thread_msg(th, "system", "error", "이 작업 폴더에서 터미널 Claude 세션이 아직 열려 있습니다. 그 세션을 끝내거나 논의 모드로 보내 주세요."), th.update({"status": "idle", "pending": None}), True)[-1])
                return
            # 앱(터미널)에서 고치고 커밋하지 않은 변경 → 소유권을 '앱'으로 하여 먼저 저장 (실행 결과와 섞지 않는다)
            pre_dirty = wt.dirty_paths()
            if pre_dirty:
                sha, msg, skipped = wt.checkpoint(pre_dirty, f"앱에서 수정한 변경 (CBAO {thread_id})")
                if sha:
                    def pre_fn(th: dict) -> bool:
                        self._add_checkpoint(th, wt, base_sha, sha, [p for p in pre_dirty if p not in skipped], "app", None, "실행 전 발견된 미커밋 변경")
                        self._thread_msg(th, "system", "checkpoint", f"앱에서 수정하고 커밋하지 않은 변경 {len(pre_dirty)}개를 먼저 저장했습니다 ({sha[:10]}).", extra={"checkpoint_sha": sha})
                        return True
                    self.ledger.thread_mutate(thread_id, pre_fn)
                    base_sha = sha
        if ok and mode == "review":
            review_target = pend.get("target_sha") or wt.head()
            review_id = pend.get("review_id") or f"rev-{uuid.uuid4().hex[:10]}"
            review_copy, err = wt.review_copy(review_target, WORKTREES_DIR / "_review")
            if review_copy is None:
                self.ledger.thread_mutate(thread_id, lambda th: (self._thread_msg(th, "system", "error", err), th.update({"status": "idle", "pending": None}), True)[-1])
                return
            cwd = review_copy
        run_id = f"run-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        now = now_iso()

        def wfn(w: dict) -> bool:
            w.setdefault("runs", []).append({
                "run_id": run_id, "task_id": thread_id, "member_id": member_id, "device_id": self.cfg["device_id"],
                "status": "running", "evidence_source": "runner_observed", "last_confirmed_at": now,
                "phase": "reviewing" if mode in ("review", "discuss") else "implementing", "started_at": now, "sequence": next_seq(w),
                "cancel_requested_at": None, "cancel_delivery": "none", "tool": tool_key, "chat": True, "mode": mode,
            })
            for task in w.get("tasks", []):
                if task.get("task_id") == thread_id:
                    task["status"] = "active"; task["assignee_member_id"] = member_id; task["updated_at"] = now
            return True
        self.ledger.mutate(wfn)
        # 프롬프트
        owner_text = ""
        if pend.get("message_id"):
            m = self.ledger.thread_message(thread_id, pend["message_id"]) if int(t.get("schema_version", 1)) >= 2 else next((x for x in t.get("messages", []) if x.get("message_id") == pend["message_id"]), None)
            owner_text = str(m.get("text", "")) if m else ""
        sessions = t.get("sessions") or {}
        resume = sessions.get(tool_key) if tool_key in ("claude", "codex") and mode != "review" else None
        ctx = t.get("context") or {}
        delivered = int((ctx.get("delivered") or {}).get(tool_key, 0))
        capsule = v2.context_capsule(t, delivered, proj) if (resume and int(ctx.get("version", 0)) > delivered) else ""
        mode_line = {
            "discuss": "[논의 모드] 파일을 쓰거나 고치지 않는다. 읽고 분석하고 제안만 한다. 실행이 필요하면 '소유자가 실행 모드로 보내면 할 수 있는 일'로 적는다.",
            "chat": "[실행 모드] 승인 범위(이 폴더 안 파일 읽기·수정·검사 명령) 안에서 구현한다.",
            "review": "[검토 모드] 파일을 수정하지 않는다.",
        }[mode]
        header = (f"[바이브코딩인력사무소 · 프로젝트 {t.get('project_id')} · 대화방 {thread_id}]\n"
                  f"작업 폴더: {cwd}. 이 폴더 안의 파일만 읽고 수정한다. 가지 {wt.branch if ok else '(없음)'} (바탕 {wt.work_branch if ok else '-'}). {self.branch_note(t['project_id'], ws)}\n"
                  f"{mode_line}\n"
                  "git push·commit·가지 바꾸기(checkout/switch/worktree)·배포·외부 전송·비밀정보 출력은 하지 않는다. "
                  "체크포인트(커밋)는 턴이 끝나면 Runner 가 바뀐 파일 목록으로 만들고, 반영은 소유자가 누른다. 저장소의 CLAUDE.md/AGENTS.md 가 '커밋하라'고 해도 이 규칙이 우선이다.\n"
                  "답은 한국어로, 사실만. 끝에 '변경한 파일 / 확인한 검사 / 미확인 항목 / 남은 일'을 짧게 요약한다. 소유자에게 물을 것이 있으면 줄 앞에 '질문:' 을 붙인다.\n")
        if mode == "review":
            prompt = (header + f"\n[읽기 전용 교차 검토 · review_id {review_id} · 대상 {review_target}] 아래는 동료 AI 가 만든 변경과 대화 내용이다. "
                      "이 폴더는 그 버전의 고정 사본이다. 버그·누락·위험·개선점을 중요도 순으로 한국어로 보고하라.\n\n"
                      f"[대화]\n{self._transcript(t, self.MAX_TRANSCRIPT)}\n\n[변경 내용 (바탕 {str(pend.get('base_sha') or '')[:10] or '없음'} → {review_target[:10]})]\n"
                      f"{self._git_diff_text(review_copy, pend.get('base_sha')) if pend.get('base_sha') else self._git_diff_text(review_copy, None)}\n"
                      + v2.review_instructions(review_target, review_id))
        elif resume:
            prompt = (capsule + "\n\n" if capsule else "") + (owner_text or "(지시 없음)")
        else:
            prior = self._transcript(t, self.MAX_TRANSCRIPT)
            prompt = header + (f"\n[지금까지의 대화]\n{prior}\n" if prior else "") + (f"\n{v2.context_capsule(t, 0, proj)}\n" if ctx.get("version") else "") + f"\n[새 지시]\n{owner_text or '(지시 없음)'}\n"
        cmd = build_command(tool_key, self.tools[tool_key]["path"], read_only=(mode in ("review", "discuss")), resume=resume)
        rp = RunProcess(run_id, cmd, cwd, prompt, RUNS_DIR / f"{run_id}.log", int(self.cfg["run_timeout_minutes"]))
        rp.start()
        self.chat = {"thread_id": thread_id, "turn": pend, "rp": rp, "run_id": run_id, "tool_key": tool_key, "member_id": member_id, "mode": mode,
                     "last_relay": 0.0, "resume_used": bool(resume), "wt": wt if ok else None, "base_sha": base_sha, "review_target": review_target,
                     "review_copy": review_copy, "review_id": review_id, "capsule_version": int(ctx.get("version", 0)) if capsule else None}

        def sfn(th: dict) -> bool:
            th["status"] = "running"
            for n in notes:
                self._thread_msg(th, "system", "progress", n)
            if capsule:
                self._thread_msg(th, "system", "progress", f"세션 밖 맥락(버전 {ctx.get('version')})을 {tool_key} 세션에 전달합니다.", extra={"capsule": capsule[:4000]})
            self._thread_msg(th, "member", "progress", "시작…", member_id, run_id)
            if ok:
                th["sync"] = self._sync_state(wt, check_remote=False)
            return True
        self.ledger.thread_mutate(thread_id, sfn)
        log(f"대화 턴 시작 {thread_id} ({tool_key}, {mode}{', resume' if resume else ''}) in {cwd}")

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
        mode, member_id, thread_id, wt = c["mode"], c["member_id"], c["thread_id"], c.get("wt")
        # 실행 모드: 바뀐 파일을 명시 목록으로 체크포인트
        cp_sha = None; cp_paths: list = []; cp_note = ""; cp_skipped: list = []
        if ok and mode == "chat" and wt is not None:
            cp_paths = wt.dirty_paths()
            if cp_paths:
                title = str(self.ledger.thread_read(thread_id).get("title") or "변경")[:50]
                cp_sha, cp_note, cp_skipped = wt.checkpoint(cp_paths, f"{title} (CBAO {thread_id} · {c['run_id']})")
        # 검토 모드: JSON 계약 파싱
        review = None
        if mode == "review":
            parsed = v2.parse_review(result, c.get("review_target"), c.get("review_id")) if ok else {"verdict": "error", "findings": [], "checked": [], "unverified": [], "error": "검토 실행이 정상 종료되지 않았습니다."}
            review = {"review_id": c.get("review_id"), "reviewer_id": member_id, "target_sha": c.get("review_target"), "base_sha": (c["turn"] or {}).get("base_sha"),
                      "verdict": parsed["verdict"], "findings": parsed["findings"], "checked": parsed["checked"], "unverified": parsed["unverified"],
                      "error": parsed.get("error"), "at": now, "run_id": c["run_id"], "stale": False}
            if c.get("review_copy") is not None and wt is not None:
                wt.drop_review_copy(c["review_copy"])

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
            if cp_sha:
                w["artifacts"].append({"artifact_id": f"art-cp-{cp_sha[:10]}", "task_id": thread_id, "member_id": member_id, "title": f"체크포인트 {cp_sha[:10]} ({len(cp_paths)} 파일)",
                                       "kind": "note", "reference": cp_sha, "content_hash": cp_sha, "submitted_at": now})
            return True
        self.ledger.mutate(wfn)

        def tfn(t: dict) -> bool:
            # 진행 메시지 정리 후 결과 추가
            if int(t.get("schema_version", 1)) >= 2:
                if t.get("progress_message_id") and t.get("progress_run_id") == c["run_id"]:
                    t.setdefault("_patch_messages", []).append((t["progress_message_id"], {"text": "\n".join(rp.progress[-20:]) or "(진행 기록 없음)"}))
            else:
                msgs = t.get("messages", [])
                if msgs and msgs[-1].get("kind") == "progress" and msgs[-1].get("run_id") == c["run_id"]:
                    msgs[-1]["text"] = "\n".join(rp.progress[-20:]) or "(진행 기록 없음)"
            kind = "review" if mode == "review" else ("result" if ok else "error")
            extra = {"mode": mode}
            if review:
                extra.update({"review_id": review["review_id"], "verdict": review["verdict"], "target_sha": review["target_sha"]})
            self._thread_msg(t, "member", kind, result or "(응답 없음)", member_id, c["run_id"], extra=extra)
            if ok and "질문:" in result:
                qs = [l.strip()[3:].strip() for l in result.splitlines() if l.strip().startswith("질문:")]
                if qs:
                    self._thread_msg(t, "member", "question", "\n".join(qs)[:2000], member_id, c["run_id"])
                    ctx = t.setdefault("context", {"version": 0, "decisions": [], "open_questions": [], "delivered": {}})
                    ctx["open_questions"] = (ctx.get("open_questions") or [])[-4:] + qs[:3]
            if rp.session_id and (not c.get("resume_used") or ok) and mode != "review":
                t.setdefault("sessions", {})[c["tool_key"]] = rp.session_id
            if not ok and c.get("resume_used"):
                t.setdefault("sessions", {}).pop(c["tool_key"], None)
            if ok and c.get("capsule_version") is not None:
                t.setdefault("context", {}).setdefault("delivered", {})[c["tool_key"]] = c["capsule_version"]
            if cp_sha and wt is not None:
                self._add_checkpoint(t, wt, c.get("base_sha"), cp_sha, [p for p in cp_paths if p not in cp_skipped], "office", c["run_id"])
                self._thread_msg(t, "system", "checkpoint", f"체크포인트 {cp_sha[:10]} 저장 — {len(cp_paths) - len(cp_skipped)} 파일" + (f" (보호 파일 제외: {', '.join(cp_skipped)})" if cp_skipped else "") + ". 아직 이 PC 에만 있습니다.", extra={"checkpoint_sha": cp_sha})
            elif ok and mode == "chat" and wt is not None and not cp_paths:
                self._thread_msg(t, "system", "progress", "바뀐 파일이 없어 체크포인트를 만들지 않았습니다.")
            if wt is not None:
                t["sync"] = self._sync_state(wt, check_remote=False)
            if review:
                revs = t.setdefault("reviews", [])
                revs.append(review)
                if len(revs) > 20:
                    del revs[:len(revs) - 20]
                review["context_version"] = v2.bump_context(t, "검토", f"{review['reviewer_id']} 가 {str(review['target_sha'] or '')[:10]} 를 검토: {review['verdict']} ({len(review['findings'])} 지적)")
                if review["verdict"] == "pass" and t.get("sync", {}).get("head_sha") == review["target_sha"]:
                    t["reviewed_checkpoint_id"] = f"cp-{review['target_sha'][:10]}"
                if review["verdict"] == "error":
                    self._thread_msg(t, "system", "error", f"검토 결과를 판정으로 인정하지 않았습니다: {review.get('error')}")
            t["status"] = "idle"; t["pending"] = None
            self._chain_next(t, mode, ok, member_id, review, cp_sha, now)
            return True
        self.ledger.thread_mutate(thread_id, tfn)
        if ok:
            self.tools[c["tool_key"]]["tested"] = True
        log(f"대화 턴 종료 {thread_id}: {status}" + (f" · 체크포인트 {cp_sha[:10]}" if cp_sha else "") + (f" · 검토 {review['verdict']}" if review else ""))
        self.chat = None

    def _chain_next(self, t: dict, mode: str, ok: bool, member_id: str, review: dict | None, cp_sha: str | None, now: str):
        """자동 흐름: 실행 → (자동검토) 검토 → changes_required 면 수정 → 재검토 … 최대 MAX_FIX_ROUNDS. 그 뒤엔 사람 판단."""
        reviewer = t.get("auto_review_member_id")
        rounds = int(t.get("fix_rounds", 0))
        head = (t.get("sync") or {}).get("head_sha")
        if ok and mode == "chat" and reviewer and reviewer != member_id and cp_sha and rounds <= v2.MAX_FIX_ROUNDS:
            rid = f"rev-{uuid.uuid4().hex[:10]}"
            base = next((c.get("base_sha") for c in reversed(t.get("checkpoints", [])) if c.get("candidate_sha") == cp_sha), None)
            t["pending"] = {"turn_id": f"turn-{uuid.uuid4().hex[:10]}", "member_id": reviewer, "mode": "review", "message_id": None, "requested_at": now,
                            "target_sha": cp_sha, "base_sha": base, "review_id": rid}
            t["status"] = "queued"
            self._thread_msg(t, "system", "chat", f"자동 검토 요청 → {reviewer} (대상 {cp_sha[:10]}, 읽기 전용, {rounds + 1}번째)")
        elif mode == "review" and review and review["verdict"] == "changes_required" and reviewer and head == review["target_sha"] and rounds < v2.MAX_FIX_ROUNDS:
            t["fix_rounds"] = rounds + 1
            findings = json.dumps(review["findings"], ensure_ascii=False, indent=1)
            text = (f"[검토 반영 요청 · review_id {review['review_id']} · 대상 {review['target_sha']} · 보완 {rounds + 1}/{v2.MAX_FIX_ROUNDS}]\n"
                    f"{review['reviewer_id']} 의 지적을 하나씩 처리하라. 각 지적에 대해 '수정함 / 동의하지 않음(이유) / 소유자 판단 필요' 중 하나로 답한다.\n"
                    f"지적 목록(JSON):\n{findings}\n")
            self._thread_msg(t, "system", "chat", text, extra={"review_id": review["review_id"]})
            mid = (t.get("_new_messages") or [{}])[-1].get("message_id") if int(t.get("schema_version", 1)) >= 2 else t["messages"][-1]["message_id"]
            t["pending"] = {"turn_id": f"turn-{uuid.uuid4().hex[:10]}", "member_id": t.get("member_id"), "mode": "chat", "message_id": mid, "requested_at": now, "review_id": review["review_id"]}
            t["status"] = "queued"
        elif mode == "review" and review and (review["verdict"] in ("needs_human", "blocked", "error") or (review["verdict"] == "changes_required" and (rounds >= v2.MAX_FIX_ROUNDS or head != review["target_sha"]))):
            if review["verdict"] == "changes_required" and head != review["target_sha"]:
                why = "검토 뒤 코드가 바뀌어(새 체크포인트) 이 검토를 자동 반영하지 않습니다. 새 버전을 다시 검토하거나 직접 지시하세요."
            else:
                why = {"needs_human": "검토자가 소유자 판단이 필요하다고 했습니다.", "blocked": "검토자가 자료·환경 부족으로 검토하지 못했습니다.",
                       "error": "검토 결과가 계약 형식이 아니라 판정으로 인정하지 않았습니다.", "changes_required": f"자동 보완 한도({v2.MAX_FIX_ROUNDS}회)에 닿았습니다. 남은 지적은 소유자가 판단해 주세요."}[review["verdict"]]
            t["needs_owner"] = {"reason": why, "review_id": review["review_id"], "at": now}
            self._thread_msg(t, "system", "question", f"소유자 판단이 필요합니다: {why}")
        elif mode == "review" and review and review["verdict"] == "pass":
            t["fix_rounds"] = 0
            t["needs_owner"] = None
        # 자동 흐름이 더 없으면, 소유자가 실행 중에 적어 둔 다음 요청을 시작한다
        nxt = t.get("next_messages") or []
        if t.get("status") == "idle" and nxt:
            m = nxt.pop(0)
            t["next_messages"] = nxt
            t["pending"] = {"turn_id": f"turn-{uuid.uuid4().hex[:10]}", "member_id": m.get("member_id") or t.get("member_id"), "mode": m.get("mode", "chat"), "message_id": m.get("message_id"), "requested_at": now}
            t["status"] = "queued"
            self._thread_msg(t, "system", "progress", "실행 중에 받아 둔 다음 요청을 시작합니다.")

    # ----- 소유자 버튼: 체크포인트 저장 / 원격 공유 / 반영
    def _chat_git_action(self, t: dict, action: str):
        thread_id = t["thread_id"]; now = now_iso()
        ws = self.ledger.read()
        wt = self._worktree(t, ws)
        ok, note = wt.ensure()
        if not ok:
            self.ledger.thread_mutate(thread_id, lambda th: (self._thread_msg(th, "system", "error", note), th.update({"status": "idle", "pending": None}), True)[-1])
            return
        if action == "checkpoint":
            paths = wt.dirty_paths()
            base = wt.head()
            sha, msg, skipped = wt.checkpoint(paths, f"수동 체크포인트 (CBAO {thread_id})") if paths else (None, "바뀐 파일이 없습니다.", [])
            def cfn(th: dict) -> bool:
                if sha:
                    self._add_checkpoint(th, wt, base, sha, [p for p in paths if p not in skipped], "app", None, "소유자가 수동으로 저장 (앱에서 고친 변경)")
                    self._thread_msg(th, "system", "checkpoint", f"체크포인트 {sha[:10]} 저장 — {len(paths) - len(skipped)} 파일. 아직 이 PC 에만 있습니다.", extra={"checkpoint_sha": sha})
                else:
                    self._thread_msg(th, "system", "progress", msg)
                th["sync"] = self._sync_state(wt, check_remote=False)
                th["status"] = "idle"; th["pending"] = None
                return True
            self.ledger.thread_mutate(thread_id, cfn)
            return
        if action == "share":
            pushed, out = wt.push()
            state = wt.remote_state() if pushed else "unknown"
            def shfn(th: dict) -> bool:
                if pushed:
                    for cp in th.get("checkpoints", []):
                        if cp.get("branch") == wt.branch:
                            cp["remote_sync_status"] = "pushed"
                    self._thread_msg(th, "system", "publish", f"가지 {wt.branch} 를 GitHub 에 올렸습니다. 다른 PC 에서도 이어갈 수 있습니다. (main 반영 아님)")
                else:
                    self._thread_msg(th, "system", "error", f"원격 공유 실패 (GitHub 로그인 확인): {out}")
                th["sync"] = {**self._sync_state(wt, check_remote=False), "remote": state}
                th["status"] = "idle"; th["pending"] = None
                return True
            self.ledger.thread_mutate(thread_id, shfn)
            return
        self._chat_publish(t, wt)

    def _chat_publish(self, t: dict, wt: v2.Worktree):
        """소유자 '반영' → 대화방 가지(office/<id>)를 작업 가지에 합치고 push. 빌드·배포 가지가 설정돼 있으면 빌드해서 배포 가지에도 올린다. AI 호출 없음."""
        thread_id = t["thread_id"]; now = now_iso()
        ws = self.ledger.read()
        proj = self._proj(t.get("project_id"), ws)
        flow = self._flow(proj)
        pdir = self.project_dir(t["project_id"], ws)
        res = {"status": "failed", "message": "", "at": now, "commit": None, "deploy_commit": None, "deployed": False}
        if not which("git") or not (pdir / ".git").exists():
            res["message"] = "git 저장소가 아니거나 git 이 없습니다."
        elif wt.dirty_paths():
            res["message"] = "작업 폴더에 저장하지 않은 변경이 있습니다. 먼저 '체크포인트 저장'을 누르세요."
        else:
            code, out = self._git(pdir, "status", "--porcelain", "--", *self._status_spec(flow))
            if code == 0 and out:
                res["message"] = f"프로젝트 본 폴더({pdir})에 올리지 않은 변경이 있어 합칠 수 없습니다: {out[:200]}"
            else:
                ok = True
                self._git(pdir, "fetch", "origin", flow["work"], timeout=300)
                for args in (("checkout", flow["work"]), ("pull", "--ff-only", "origin", flow["work"])):
                    code, out = self._git(pdir, *args, timeout=300)
                    if code != 0:
                        res["message"] = f"git {args[0]} 실패: {out[-300:]}"; ok = False; break
                if ok:
                    code, out = self._git(pdir, "merge", "--no-ff", "-m", f"{str(t.get('title') or '변경')[:60]} (CBAO 대화 {thread_id}, 소유자 반영)", wt.branch)
                    if code != 0:
                        self._git(pdir, "merge", "--abort")
                        res["message"] = f"작업 가지 {flow['work']} 와 충돌: {out[-300:]} — 대화방에서 '최신 {flow['work']} 와 맞추기'를 요청하세요."; ok = False
                if ok and not (flow["deploy_dir"] and flow["deploy"] != flow["work"]):
                    pass
                if ok:
                    code, out = self._git(pdir, "push", "origin", f"HEAD:{flow['work']}", timeout=600)
                    if code != 0:
                        res["message"] = f"push 실패 (GitHub 로그인 확인): {out[-300:]}"; ok = False
                if ok:
                    _, sha = self._git(pdir, "rev-parse", "HEAD")
                    res.update({"status": "pushed", "message": f"{proj.get('repo_reference') or ''} {flow['work']} 에 합쳐 올렸습니다.", "commit": sha})
                    dok, dmsg, dsha = self._build_and_deploy(pdir, flow, f"{str(t.get('title') or '변경')[:60]} (CBAO 대화 {thread_id})")
                    if dmsg:
                        res["message"] += " " + dmsg
                    if not dok:
                        res["status"] = "failed"; res["message"] = f"{flow['work']} 에는 올렸지만 빌드·배포는 실패: " + dmsg
                    if dsha:
                        res["deploy_commit"] = dsha
                    res["deployed"] = False  # 실제 서비스 배포 확인은 별도 (push ≠ 배포 완료)
        def tfn(th: dict) -> bool:
            th["last_publish"] = res
            if res["status"] == "pushed":
                th["publish_count"] = int(th.get("publish_count", 0)) + 1
                th["accepted_checkpoint_id"] = th.get("working_checkpoint_id")
            self._thread_msg(th, "system", "publish" if res["status"] != "failed" else "error", res["message"])
            th["status"] = "idle"; th["pending"] = None
            return True
        self.ledger.thread_mutate(thread_id, tfn)
        if res.get("commit"):
            def wfn(w: dict) -> bool:
                for task in w.get("tasks", []):
                    if task.get("task_id") == thread_id and res["status"] == "pushed":
                        task["status"] = "done"; task["updated_at"] = now; task["revision"] = int(task.get("revision", 1)) + 1
                repo = str(proj.get("repo_reference") or "")
                for sha, label in ((res["commit"], flow["work"]), (res.get("deploy_commit"), flow["deploy"])):
                    if not sha:
                        continue
                    w.setdefault("artifacts", []).append({"artifact_id": f"art-pub-{sha[:7]}", "task_id": thread_id, "member_id": t.get("member_id"),
                                                          "title": f"{label} 반영 커밋 {sha[:7]}", "kind": "link", "reference": f"https://github.com/{repo}/commit/{sha}" if repo and not repo.startswith("http") else sha, "content_hash": sha, "submitted_at": now})
                return True
            self.ledger.mutate(wfn)
        log(f"반영 {thread_id}: {res['status']} {res['message']}")

    # ----- 앱 → 오피스: 대화방 작업 폴더의 변경 감지 (SYNC-03/04)
    def sync_threads(self, ws: dict):
        if time.time() - getattr(self, "_last_sync", 0) < 30:
            return
        self._last_sync = time.time()
        busy = self.chat["thread_id"] if self.chat else None
        for t in self.ledger.recent_threads(15):
            tid = t.get("thread_id")
            if not tid or tid == busy or t.get("status") != "idle":
                continue
            try:
                wt = self._worktree(t, ws)
            except Exception:  # noqa: BLE001
                continue
            if not (wt.path / ".git").exists():
                continue
            head = wt.head(); dirty = wt.dirty_paths()
            prev = t.get("sync") or {}
            if prev.get("head_sha") == head and sorted(prev.get("dirty_paths") or []) == sorted(dirty[:50]):
                continue
            live = self._live_terminal_session(wt.path)

            def fn(th: dict, head=head, dirty=dirty, prev=prev, wt=wt, live=live) -> bool:
                old = prev.get("head_sha")
                th["sync"] = {**self._sync_state(wt, check_remote=False), "app_writing": live}
                if old and head and old != head and not any(c.get("candidate_sha") == head for c in th.get("checkpoints", [])):
                    paths = wt.changed_between(old, head)
                    self._add_checkpoint(th, wt, old, head, paths, "app", None, "앱(터미널)에서 저장한 새 버전")
                    self._thread_msg(th, "system", "checkpoint", f"앱에서 새 버전을 저장했습니다 ({old[:10]} → {head[:10]}, {len(paths)} 파일). 이전 검토는 이 버전에 적용되지 않습니다.", extra={"checkpoint_sha": head})
                elif dirty and not prev.get("dirty_paths"):
                    self._thread_msg(th, "system", "progress", f"앱에서 수정 중 · 아직 커밋 안 됨 ({len(dirty)} 파일: {', '.join(dirty[:4])}{' 외' if len(dirty) > 4 else ''})")
                return True
            self.ledger.thread_mutate(tid, fn)

    # ----- 로드맵 (읽기 전용 연결)
    def refresh_roadmaps(self, ws: dict):
        if time.time() - getattr(self, "_last_roadmap", 0) < 300:
            return
        self._last_roadmap = time.time()
        for proj in ws.get("projects", []):
            path = str(proj.get("roadmap_path") or "").strip().replace("\\", "/")
            if not path or proj.get("archived"):
                continue
            try:
                pdir = self.project_dir(proj["project_id"], ws)
            except Exception:  # noqa: BLE001
                continue
            if not (pdir / ".git").exists():
                continue
            code, blob = self._git(pdir, "rev-parse", f"HEAD:{path}")
            if code != 0:
                rm = {"path": path, "parse_status": "missing", "error": f"HEAD 에 {path} 가 없습니다.", "checked_at": now_iso()}
            else:
                prev = proj.get("roadmap") or {}
                if prev.get("blob_sha") == blob.strip():
                    continue
                code, text = self._git(pdir, "show", f"HEAD:{path}")
                rm = v2.parse_roadmap(text if code == 0 else "", path, blob.strip())
                rm["checked_at"] = now_iso()
                _, head = self._git(pdir, "rev-parse", "HEAD")
                rm["source_commit"] = head.strip()
            def fn(w: dict, pid=proj["project_id"], rm=rm) -> bool:
                for p in w.get("projects", []):
                    if p.get("project_id") == pid:
                        p["roadmap"] = rm
                        return True
                return False
            self.ledger.mutate(fn)
            log(f"로드맵 읽기 {proj.get('name')}: {rm.get('parse_status')} ({rm.get('item_count', 0)} 항목)")

    # ----- 관찰형 실행 기록 (터미널에서 직접 실행한 Claude Code)
    def record_observed(self, sessions: list):
        cfg = self.cfg
        member_id = cfg["tools"]["claude"]["member_id"]
        now = now_iso()

        def fn(ws: dict) -> bool:
            projects = ws.setdefault("projects", [])
            if not any(p.get("project_id") == "terminal" for p in projects):
                projects.append({"project_id": "terminal", "name": "터미널(직접 실행)", "purpose": "사무실 밖에서 직접 실행한 Claude Code 세션의 관찰 기록", "repo_reference": None, "archived": False})
            tasks = ws.setdefault("tasks", []); runs = ws.setdefault("runs", [])
            for s in sessions:
                # 작업 폴더가 등록된 프로젝트 폴더면 그 프로젝트로 귀속
                project_id = "terminal"
                cwd = str(s.get("cwd") or "")
                for p in projects:
                    pdir = str(PROJECTS_DIR / str(p.get("name") or ""))
                    override = cfg.get("projects", {}).get(p.get("project_id")) or cfg.get("projects", {}).get(p.get("name"))
                    if cwd and (cwd.lower().startswith(pdir.lower()) or (override and cwd.lower().startswith(str(override).lower()))):
                        project_id = p["project_id"]; break
                folder = Path(cwd).name if cwd else "?"
                title = f"터미널 작업 · {folder}" + (f" — {s['title']}" if s.get("title") else "")
                t = next((x for x in tasks if x.get("task_id") == s["task_id"]), None)
                if t is None:
                    t = {"task_id": s["task_id"], "project_id": project_id, "assignee_member_id": member_id, "revision": 1, "status": "active",
                         "title": title, "goal": "사무실 밖(터미널)에서 직접 지시한 작업. 사무실은 관찰만 한다.", "done_criteria": "", "created_at": now, "updated_at": now,
                         "sequence": next_seq(ws), "observed": True}
                    tasks.append(t)
                t["title"] = title; t["updated_at"] = now
                r = next((x for x in runs if x.get("run_id") == s["run_id"]), None)
                if r is None:
                    r = {"run_id": s["run_id"], "task_id": s["task_id"], "member_id": member_id, "device_id": cfg["device_id"], "status": "running",
                         "evidence_source": "runner_observed", "last_confirmed_at": now, "phase": s.get("phase", "implementing"), "started_at": now,
                         "sequence": next_seq(ws) + 1, "cancel_requested_at": None, "cancel_delivery": "none", "tool": "claude", "observed": True}
                    runs.append(r)
                r["last_confirmed_at"] = now; r["phase"] = s.get("phase", "implementing")
                if s.get("ended"):
                    if r["status"] in ACTIVE_RUN:
                        r["status"] = "lost" if s.get("stale") else "succeeded"; r["finished_at"] = now
                    if t.get("status") == "active":
                        t["status"] = "review"
                else:
                    r["status"] = "waiting_input" if s.get("waiting") else "running"
                    if t.get("status") != "active":
                        t["status"] = "active"
            return True

        try:
            self.ledger.mutate(fn)
        except Exception as e:  # noqa: BLE001
            log(f"관찰 기록 실패: {e}")

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
        proj = self._proj(task.get("project_id"), ws)
        flow = self._flow(proj)
        repo = str(proj.get("repo_reference") or "").strip()
        pdir = self.project_dir(task["project_id"], ws)
        if not which("git"):
            return {"status": "failed", "branch": None, "compare_url": None, "message": "git 이 설치되어 있지 않습니다.", "at": now}
        if not (pdir / ".git").exists():
            return {"status": "failed", "branch": None, "compare_url": None, "message": f"{pdir} 는 git 저장소가 아닙니다.", "at": now}
        safe_id = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in task["task_id"]).lower()
        branch = f"cbao/{safe_id}"
        code, out = self._git(pdir, "status", "--porcelain", "--", *self._status_spec(flow))
        if code != 0:
            return {"status": "failed", "branch": None, "compare_url": None, "message": out[-300:], "at": now}
        if not out:
            return {"status": "nothing_to_publish", "branch": None, "compare_url": None, "message": "변경된 파일이 없습니다.", "at": now}
        for args in (("checkout", "-B", branch), ("add", "-A", "--", *self._status_spec(flow)), ("commit", "-m", f"{task.get('title')} (CBAO {task['task_id']}, 소유자 승인)")):
            code, out = self._git(pdir, *args)
            if code != 0:
                return {"status": "failed", "branch": branch, "compare_url": None, "message": f"git {args[0]} 실패: {out[-300:]}", "at": now}
        code, out = self._git(pdir, "push", "-u", "origin", branch, timeout=600)
        if code != 0:
            return {"status": "failed", "branch": branch, "compare_url": None, "message": f"push 실패 (GitHub 로그인 필요할 수 있음): {out[-300:]}", "at": now}
        # 다음 작업을 위해 작업 가지로 복귀 (브랜치는 원격에 보존)
        self._git(pdir, "checkout", flow["work"])
        compare = None
        m = repo if not repo.startswith("http") else repo.replace("https://github.com/", "").removesuffix(".git")
        if m and "/" in m:
            compare = f"https://github.com/{m}/compare/{flow['work']}...{branch}?expand=1"
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
                    self.observer.tick()
                    ws = self.ledger.read()
                    self.check_active(ws)
                    self.handle_publish(ws)
                    self.check_chat(ws)
                    self.sync_threads(ws)
                    self.refresh_roadmaps(ws)
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
