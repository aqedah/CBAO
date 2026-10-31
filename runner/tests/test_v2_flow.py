# -*- coding: utf-8 -*-
"""
V2 수직 흐름 모의 시험 (리눅스/윈도우 공통, Firebase·실제 CLI 없이).
  대화(논의, 쓰기 없음) → 실행(파일 생성) → 체크포인트(office 가지, 명시 파일, 보호 파일 제외)
  → 앱(터미널)에서 커밋 → 오피스가 감지(app 체크포인트, 이전 검토 stale)
  → 고정 버전 검토(JSON 계약) → 자동 수정(findings 전달) → 재검토 → pass
  → 깨진 검토 JSON 은 error (통과 아님) → 반영(작업 가지에 merge·push, 빌드·배포 가지)
실행: python runner/tests/test_v2_flow.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
RUNNER_PY = HERE.parent / "runner.py"
FAKE = HERE / "fake_claude.py"


def load_runner(tmp: pathlib.Path):
    sys.argv = ["runner"]
    spec = importlib.util.spec_from_file_location("runner_mod", RUNNER_PY)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.BASE = tmp; m.RUNS_DIR = tmp / "runs"; m.PROJECTS_DIR = tmp / "projects"; m.WORKTREES_DIR = tmp / "worktrees"
    m.RUNS_DIR.mkdir(); m.PROJECTS_DIR.mkdir()
    return m


class FakeLedger:
    """runner.Ledger 와 같은 API 를 메모리로."""

    class _Ref:
        id = "uid-test"

    def __init__(self, ws: dict):
        self.ws = ws; self.threads: dict = {}; self.msgs: dict = {}; self.subdocs: dict = {}; self.ref = self._Ref()

    def mutate(self, fn):
        ws = json.loads(json.dumps(self.ws))
        if fn(ws):
            ws["revision"] = int(ws.get("revision", 0)) + 1; self.ws = ws
        return self.ws

    def read(self):
        return json.loads(json.dumps(self.ws))

    def queued_threads(self):
        return [json.loads(json.dumps(t)) for t in self.threads.values() if t.get("status") == "queued"]

    def thread_read(self, tid):
        return json.loads(json.dumps(self.threads.get(tid, {})))

    def thread_mutate(self, tid, fn):
        t = json.loads(json.dumps(self.threads.get(tid, {})))
        t.pop("_new_messages", None); t.pop("_patch_messages", None); t.pop("_set_docs", None)
        if fn(t):
            new = t.pop("_new_messages", []); patches = t.pop("_patch_messages", []); docs = t.pop("_set_docs", [])
            for sub, did, data in docs:
                self.subdocs.setdefault((tid, sub), {})[did] = data
            json.dumps(t)  # Firestore 처럼 직렬화 가능해야 한다
            self.threads[tid] = t
            box = self.msgs.setdefault(tid, {})
            for m in new:
                box[m["message_id"]] = m
            for mid, patch in patches:
                box.setdefault(mid, {}).update(patch)
        return t

    def thread_messages(self, tid, limit=60):
        out = sorted(self.msgs.get(tid, {}).values(), key=lambda m: m.get("seq", 0))
        return out[-limit:]

    def thread_message(self, tid, mid):
        return dict(self.msgs.get(tid, {}).get(mid, {}))

    def recent_threads(self, n=15):
        return [json.loads(json.dumps(t)) for t in self.threads.values()][:n]

    def migrate_threads(self):
        pass


def git(cwd, *args):
    r = subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def setup_repo(tmp: pathlib.Path) -> pathlib.Path:
    remote = tmp / "remote.git"; subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
    seed = tmp / "seed"; subprocess.run(["git", "clone", "-q", str(remote), str(seed)], check=True, capture_output=True)
    git(seed, "config", "user.email", "t@t"); git(seed, "config", "user.name", "t")
    (seed / "app").mkdir()
    (seed / "app" / "build_site.py").write_text("import os,shutil\nOUT='site'; shutil.rmtree(OUT,ignore_errors=True); os.makedirs(OUT)\n"
                                                 "open(OUT+'/index.html','w').write(open('../hello.txt').read() if os.path.exists('../hello.txt') else 'empty')\n")
    (seed / "README.md").write_text("# demo\n")
    (seed / "docs").mkdir(); (seed / "docs" / "ROADMAP.md").write_text("# 로드맵\n## 1단계\n- [x] 저장소 만들기\n- [ ] 인사말 파일\n## 2단계\n- [ ] 배포\n")
    git(seed, "add", "-A"); git(seed, "commit", "-qm", "seed"); git(seed, "branch", "-M", "source"); git(seed, "push", "-q", "origin", "source")
    git(seed, "checkout", "-q", "--orphan", "main"); git(seed, "rm", "-rfq", "--cached", "."); shutil.rmtree(seed / "app"); shutil.rmtree(seed / "docs"); (seed / "README.md").unlink()
    (seed / "index.html").write_text("empty"); git(seed, "add", "-A"); git(seed, "commit", "-qm", "build"); git(seed, "push", "-q", "origin", "main")
    return remote


def make_runner(m, tmp, remote):
    pdir = tmp / "projects" / "Demo"
    subprocess.run(["git", "clone", "-q", "-b", "source", str(remote), str(pdir)], check=True, capture_output=True)
    git(pdir, "config", "user.email", "r@r"); git(pdir, "config", "user.name", "runner")
    ws = {"revision": 1, "projects": [{"project_id": "p-demo", "name": "Demo", "repo_reference": "x/y", "work_branch": "source",
                                        "build_command": f"{sys.executable} app/build_site.py", "deploy_dir": "app/site", "deploy_branch": "main", "roadmap_path": "docs/ROADMAP.md"}],
          "members": [{"member_id": "m-claude"}, {"member_id": "m-codex"}], "tasks": [{"task_id": "chat-1", "status": "ready"}], "runs": [], "artifacts": [], "devices": []}
    r = m.Runner.__new__(m.Runner)
    r.cfg = {**m.DEFAULT_CONFIG, "projects": {}, "run_timeout_minutes": 2, "device_id": "pc-test"}
    r.cfg["tools"]["claude"]["command"] = sys.executable
    fake_cmd = [sys.executable, str(FAKE)]
    r.tools = {"claude": {"path": fake_cmd, "status": "installed", "version": "fake"}, "codex": {"path": None, "status": "not_installed", "version": None}, "gemini": {"path": None, "status": "not_installed", "version": None}}
    r.cfg["tools"]["codex"]["member_id"] = "m-codex"
    r.ledger = FakeLedger(ws); r.active = None; r.chat = None
    r.observer = type("Obs", (), {"sessions": {}})()
    # build_command 는 tool_path 가 문자열이라 가정 → 리스트도 받게 감싼다
    orig = m.build_command

    def bc(tool_key, tool_path, read_only=False, resume=None):
        cmd = orig(tool_key, "CLAUDE", read_only=read_only, resume=resume)
        return fake_cmd + cmd[1:]
    m.build_command = bc
    return r, pdir


def run_until_idle(r, tid, max_turns=12):
    for _ in range(max_turns):
        ws = r.ledger.read()
        r.check_chat(ws)
        while r.chat:
            time.sleep(0.2); r.check_chat(r.ledger.read())
        if r.ledger.thread_read(tid).get("status") == "idle":
            return
    raise AssertionError("대화방이 idle 로 끝나지 않음")


def send(r, tid, text, mode="chat", member="m-claude"):
    def fn(t):
        t["message_count"] = int(t.get("message_count", 0)) + 1
        mid = f"msg-owner-{t['message_count']}"
        t.setdefault("_new_messages", []).append({"message_id": mid, "seq": t["message_count"], "role": "owner", "member_id": None, "kind": "chat", "text": text, "at": "now"})
        t["pending"] = {"turn_id": "turn-x", "member_id": member, "mode": mode, "message_id": mid, "requested_at": "now"}
        t["status"] = "queued"
        return True
    r.ledger.thread_mutate(tid, fn)


def kinds(r, tid):
    return [(m["role"], m["kind"], m["text"][:70]) for m in r.ledger.thread_messages(tid, 200)]


def main():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="cbao-v2-"))
    os.environ["FAKE_CLAUDE_LOG"] = str(tmp / "fake.log")
    m = load_runner(tmp)
    remote = setup_repo(tmp)
    r, pdir = make_runner(m, tmp, remote)
    tid = "chat-1"
    r.ledger.threads[tid] = {"thread_id": tid, "project_id": "p-demo", "title": "인사말", "member_id": "m-claude", "status": "idle", "pending": None,
                             "schema_version": 2, "message_count": 0, "sessions": {}, "auto_review_member_id": None, "checkpoints": [], "reviews": [], "context": {"version": 0, "decisions": [], "delivered": {}}}
    results = []

    def check(name, cond, detail=""):
        results.append((name, bool(cond), detail)); print(("PASS" if cond else "FAIL"), name, detail)

    # CHAT-01 논의 모드: 파일 쓰기 없음
    send(r, tid, "ADD_FILE 를 하고 싶은데 어떻게 할까?", mode="discuss"); run_until_idle(r, tid)
    t = r.ledger.thread_read(tid)
    wt = pathlib.Path(t["sync"]["worktree"])
    check("CHAT-01 논의 모드는 파일을 쓰지 않는다", not (wt / "hello.txt").exists() and not t["checkpoints"])
    log1 = json.loads((tmp / "fake.log").read_text(encoding="utf-8").splitlines()[-1])
    check("CHAT-01 논의 모드 허용 도구에 Edit 없음", "Edit" not in log1["args"][log1["args"].index("--allowedTools") + 1].split(","))
    check("SYNC-09 대화방 전용 worktree·가지", t["sync"]["branch"] == "office/chat-1" and wt.exists() and wt != pdir, t["sync"]["branch"])

    # 실행 모드 → 체크포인트 (보호 파일 제외)
    send(r, tid, "ADD_FILE SECRET_TOO 지금 만들어 줘", mode="chat"); run_until_idle(r, tid)
    t = r.ledger.thread_read(tid)
    cp1 = t["checkpoints"][-1]
    check("SYNC-01 실행 뒤 체크포인트가 office 가지에 생기고 main/source 는 그대로", cp1["origin"] == "office" and cp1["changed_paths"] == ["hello.txt"] and git(pdir, "rev-parse", "source")[1] == git(pdir, "rev-parse", "origin/source")[1], str(cp1["changed_paths"]))
    d1 = r.ledger.subdocs.get((tid, "diffs"), {}).get(cp1["candidate_sha"]) or {}
    check("체크포인트마다 변경 내용(diff)이 별도 문서에 저장됨", "hello world" in d1.get("diff", "") and "hello.txt" in d1.get("stat", ""))
    check("보호 파일(.env)은 체크포인트에서 제외", ".env" not in git(wt, "show", "--name-only", "--format=", "HEAD")[1])
    check("세션 ID 저장(이어가기 근거)", t["sessions"].get("claude", "").startswith("sess-"))
    check("AI 질문이 질문 카드로 분리", any(k == "question" for _, k, _ in kinds(r, tid)))
    check("앱 이어가기 정보: worktree 경로·HEAD 제공", t["sync"]["head_sha"] == cp1["candidate_sha"] and t["sync"]["worktree"])

    # SYNC-03/04 앱(터미널)에서 수정 → 미커밋 감지 → 커밋 감지
    (wt / "hello.txt").write_text("hello world!!\n")
    r._last_sync = 0; r.sync_threads(r.ledger.read())
    t = r.ledger.thread_read(tid)
    check("SYNC-03 앱의 미커밋 변경을 dirty 로 표시, 덮어쓰지 않음", t["sync"]["dirty_paths"] == ["hello.txt"] and (wt / "hello.txt").read_text() == "hello world!!\n", str(t["sync"]))
    git(wt, "config", "user.email", "app@x"); git(wt, "config", "user.name", "app")
    git(wt, "add", "hello.txt"); git(wt, "commit", "-qm", "앱에서 수정")
    app_sha = git(wt, "rev-parse", "HEAD")[1]
    r._last_sync = 0; r.sync_threads(r.ledger.read())
    t = r.ledger.thread_read(tid)
    cp2 = t["checkpoints"][-1]
    check("SYNC-04 앱 커밋을 app 체크포인트로 감지", cp2["origin"] == "app" and cp2["candidate_sha"] == app_sha and cp2["changed_paths"] == ["hello.txt"])

    # 검토: 고정 버전 + JSON 계약 → changes_required → 자동 수정(findings 전달) → 재검토(pass)
    r.ledger.thread_mutate(tid, lambda th: (th.update({"auto_review_member_id": "m-claude-reviewer"}), True)[-1])
    r.cfg["tools"]["gemini"] = {"command": "x", "member_id": "m-claude-reviewer", "display_name": "R", "role_label": "r", "tool_label": "fake"}
    r.tools["gemini"] = {"path": "fake", "status": "installed", "version": "fake"}
    orig_bc = m.build_command
    m.build_command = lambda k, p, read_only=False, resume=None: orig_bc("claude", p, read_only=read_only, resume=resume)
    os.environ["FAKE_REVIEW_VERDICT"] = "changes_required"
    send(r, tid, "ADD_FILE 다시 (수정)", mode="chat")
    # 첫 턴: 실행 → 자동 검토 큐
    run_until_idle(r, tid, max_turns=1) if False else None
    # 단계별로 돌리며 상태 확인
    ws = r.ledger.read(); r.check_chat(ws)
    while r.chat: time.sleep(0.2); r.check_chat(r.ledger.read())
    t = r.ledger.thread_read(tid)
    check("실행 뒤 자동 검토가 고정 SHA 를 대상으로 큐에 들어감", t["status"] == "queued" and t["pending"] and t["pending"]["mode"] == "review" and t["pending"]["target_sha"] == t["checkpoints"][-1]["candidate_sha"], str(kinds(r, tid)[-4:]))
    target1 = t["pending"]["target_sha"]
    r.check_chat(r.ledger.read())
    while r.chat: time.sleep(0.2); r.check_chat(r.ledger.read())
    t = r.ledger.thread_read(tid)
    rev1 = t["reviews"][-1]
    check("REVIEW-02 '문제 없음' 문자열이 있어도 JSON verdict 로 판정", rev1["verdict"] == "changes_required" and rev1["findings"][0]["id"] == "F1")
    check("REVIEW-03 검토 사본은 고정 SHA (review 폴더가 정리됨)", rev1["target_sha"] == target1 and not list((tmp / "worktrees" / "_review").glob("review-*")) if (tmp / "worktrees" / "_review").exists() else True)
    check("자동 수정 턴이 큐에 들어감 (보완 1/2)", t["status"] == "queued" and t["pending"]["mode"] == "chat" and t["fix_rounds"] == 1)
    r.check_chat(r.ledger.read())
    while r.chat: time.sleep(0.2); r.check_chat(r.ledger.read())
    fix_prompt = json.loads((tmp / "fake.log").read_text(encoding="utf-8").splitlines()[-1])
    check("REVIEW-01 수정 턴 입력에 review_id·target_sha·findings 전문이 들어감", rev1["review_id"] in fix_prompt["prompt"] and target1 in fix_prompt["prompt"] and "인사말에 이름이 없다" in fix_prompt["prompt"] and "--resume" in fix_prompt["args"])
    check("세션 재개에 사무실 맥락 묶음(검토·체크포인트) 주입", "[사무실 맥락 묶음" in fix_prompt["prompt"])
    t = r.ledger.thread_read(tid)
    check("REVIEW-04 수정 뒤 새 체크포인트 → 이전 검토 stale → 재검토 큐", t["checkpoints"][-1]["candidate_sha"] != target1 and t["reviews"][-1]["stale"] is True and t["pending"]["mode"] == "review")
    os.environ["FAKE_REVIEW_VERDICT"] = "pass"
    r.check_chat(r.ledger.read())
    while r.chat: time.sleep(0.2); r.check_chat(r.ledger.read())
    t = r.ledger.thread_read(tid)
    check("재검토 pass → reviewed_checkpoint 지정, 자동 흐름 종료", t["reviews"][-1]["verdict"] == "pass" and t["reviewed_checkpoint_id"] == f"cp-{t['checkpoints'][-1]['candidate_sha'][:10]}" and t["status"] == "idle")

    # REVIEW-05 깨진 검토 JSON → error (통과 아님) → 소유자 판단
    os.environ["FAKE_REVIEW_BROKEN"] = "1"
    def q_review(th):
        th["pending"] = {"turn_id": "t", "member_id": "m-claude-reviewer", "mode": "review", "message_id": None, "requested_at": "now", "target_sha": th["sync"]["head_sha"], "review_id": "rev-broken"}
        th["status"] = "queued"; return True
    r.ledger.thread_mutate(tid, q_review)
    r.check_chat(r.ledger.read())
    while r.chat: time.sleep(0.2); r.check_chat(r.ledger.read())
    t = r.ledger.thread_read(tid)
    check("REVIEW-05 JSON 없는 검토는 error, 소유자 판단 요청", t["reviews"][-1]["verdict"] == "error" and t.get("needs_owner") and t["status"] == "idle")
    del os.environ["FAKE_REVIEW_BROKEN"]

    # SHA 불일치 검토 → error
    os.environ["FAKE_REVIEW_SHA"] = "0" * 40
    r.ledger.thread_mutate(tid, q_review)
    r.check_chat(r.ledger.read())
    while r.chat: time.sleep(0.2); r.check_chat(r.ledger.read())
    t = r.ledger.thread_read(tid)
    check("검토 JSON 의 target_sha 가 다르면 error", t["reviews"][-1]["verdict"] == "error" and "불일치" in (t["reviews"][-1].get("error") or ""))
    del os.environ["FAKE_REVIEW_SHA"]

    # 실행 중 받은 다음 요청 (CHAT-02): next_messages 가 실행 뒤 이어서 시작
    def q_next(th):
        th["message_count"] += 1
        th.setdefault("_new_messages", []).append({"message_id": "msg-next", "seq": th["message_count"], "role": "owner", "member_id": None, "kind": "chat", "text": "다음 요청", "at": "now"})
        th["next_messages"] = [{"message_id": "msg-next", "mode": "discuss"}]
        return True
    r.ledger.thread_mutate(tid, q_next)
    r.ledger.thread_mutate(tid, lambda th: (th.update({"auto_review_member_id": None}), True)[-1])
    send(r, tid, "그냥 질문", mode="discuss")
    r.check_chat(r.ledger.read())
    while r.chat: time.sleep(0.2); r.check_chat(r.ledger.read())
    t = r.ledger.thread_read(tid)
    check("CHAT-02 실행 중 적어 둔 다음 요청이 자동으로 이어서 큐에 들어감", t["status"] == "queued" and t["pending"]["message_id"] == "msg-next" and t["next_messages"] == [])
    run_until_idle(r, tid)

    # 원격 공유 (share) → remote_sync_status pushed
    r.ledger.thread_mutate(tid, lambda th: (th.update({"pending": {"turn_id": "t", "member_id": "m-claude", "mode": "share", "message_id": None, "requested_at": "now"}, "status": "queued"}), True)[-1])
    r.check_chat(r.ledger.read())
    t = r.ledger.thread_read(tid)
    check("SYNC-05 원격 공유 뒤에만 pushed 표시", all(c["remote_sync_status"] == "pushed" for c in t["checkpoints"]) and t["sync"]["remote"] == "synced" and git(pdir, "ls-remote", "--heads", "origin", "office/chat-1")[1] != "")

    # 반영: office 가지 → source 에 merge·push → 빌드 → main
    r.ledger.thread_mutate(tid, lambda th: (th.update({"pending": {"turn_id": "t", "member_id": "m-claude", "mode": "publish", "message_id": None, "requested_at": "now"}, "status": "queued"}), True)[-1])
    r.check_chat(r.ledger.read())
    t = r.ledger.thread_read(tid)
    main_index = subprocess.run(["git", "--git-dir", str(remote), "show", "main:index.html"], capture_output=True, text=True).stdout
    src_files = subprocess.run(["git", "--git-dir", str(remote), "ls-tree", "--name-only", "source"], capture_output=True, text=True).stdout.split()
    check("반영: source 에 합쳐 push, 빌드 결과만 main 에, 배포 완료는 별도(false)", t["last_publish"]["status"] == "pushed" and "hello 이츠학" in main_index and "hello.txt" in src_files and "app" in src_files and t["last_publish"]["deployed"] is False, t["last_publish"]["message"])
    check("반영 뒤 accepted_checkpoint 지정", t.get("accepted_checkpoint_id") == t.get("working_checkpoint_id"))

    # 로드맵 읽기 전용
    r._last_roadmap = 0; r.refresh_roadmaps(r.ledger.read())
    rm = r.ledger.read()["projects"][0].get("roadmap") or {}
    check("ROADMAP-01 Markdown 로드맵을 원문·순서·상태 보존해 읽음", rm.get("parse_status") == "parsed" and rm["item_count"] == 3 and rm["done_count"] == 1 and rm["sections"][1]["title"] == "1단계" and rm["blob_sha"])
    rm2 = m.v2.parse_roadmap("그냥 글. 구조 없음.", "x.md", "abc")
    check("ROADMAP-02 구조를 못 읽으면 raw_only 로 원문 유지", rm2["parse_status"] == "raw_only" and rm2["raw_head"].startswith("그냥 글") and rm2["sections"] == [])

    # 정책 데이터 = 실제 허용 목록
    check("정책 화면 데이터와 실제 --allowedTools 가 같은 출처", m.v2.claude_allowed("exec") == ",".join(m.v2.POLICY["tools"]["claude"]["exec"]))
    # 보호 경로
    check("보호 경로 판정", m.v2.is_protected("serviceAccount.json") and m.v2.is_protected("a/b/secrets/k.txt") and m.v2.is_protected("x.pem") and not m.v2.is_protected("src/app.ts"))

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} 통과", ("실패: " + ", ".join(failed)) if failed else "")
    (HERE.parent.parent / "docs" / "test-results").mkdir(parents=True, exist_ok=True)
    (HERE.parent.parent / "docs" / "test-results" / "runner-v2-flow.json").write_text(json.dumps({"ran_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "platform": sys.platform, "results": [{"name": n, "pass": ok, "detail": d} for n, ok, d in results]}, ensure_ascii=False, indent=1), encoding="utf-8")
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
