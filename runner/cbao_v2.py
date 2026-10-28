# -*- coding: utf-8 -*-
"""
V2 보조 모듈 — 대화 중심 업무실에서 Runner 가 쓰는 순수 함수·git 도우미.
runner.py 가 import 한다. Firestore 를 직접 만지지 않는다 (runner.py 의 Ledger 가 한다).

여기 있는 것
  POLICY          : 도구별 허용 명령 — 정책 화면 문구와 실제 --allowedTools 를 같은 데이터에서 만든다
  Worktree        : 대화방(thread)마다 분리된 작업 폴더(git worktree)와 가지 office/<thread_id>
  checkpoint      : 바뀐 파일을 '명시 목록'으로 커밋 (git add -A 금지), base/candidate SHA 기록
  parse_review    : 검토 결과 JSON 계약 파싱 — 문자열 검색("문제 없음") 으로 판정하지 않는다
  context_capsule : 세션 밖에서 생긴 일(체크포인트·검토·소유자 결정)을 다음 턴 입력에 넣는 묶음
  parse_roadmap   : 기존 Markdown 로드맵을 읽기 전용으로 구조화 (못 읽으면 원문 유지)
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
from pathlib import Path
from typing import Callable

POLICY_REVISION = 3

# 실제 강제 범위. 문구만 바꾸면 안 되고, 이 표가 바뀌면 revision 을 올린다.
_GIT_RO = ["status", "diff", "log", "show", "ls-tree", "ls-files", "branch", "blame", "grep", "rev-parse", "remote -v", "fetch"]
_SHELL_RO = ["ls", "dir", "cat", "head", "tail", "wc", "find", "type"]
POLICY = {
    "revision": POLICY_REVISION,
    "tools": {
        "claude": {
            "discuss": ["Read", "Grep", "Glob", "LS"] + [f"Bash(git {c}*)" for c in _GIT_RO] + [f"Bash({c} *)" for c in _SHELL_RO],
            "exec": ["Read", "Edit", "Write", "MultiEdit", "Grep", "Glob", "LS",
                     "Bash(npm test*)", "Bash(npm run*)", "Bash(npm ci*)", "Bash(npm install*)", "Bash(npx *)", "Bash(node *)",
                     "Bash(python *)", "Bash(python3 *)", "Bash(py *)", "Bash(pip install*)", "Bash(pytest*)"]
                    + [f"Bash(git {c}*)" for c in _GIT_RO] + [f"Bash({c} *)" for c in _SHELL_RO]
                    + ["Bash(git stash*)", "Bash(git checkout -- *)", "Bash(git restore *)"],
            "enforced_by": "claude --allowedTools (허용 목록 밖 도구는 비대화형이라 거부됨)",
            "capabilities": {"conversation": "supported", "read_only": "supported", "scoped_write": "supported",
                             "stream_text": "supported", "steer_active_turn": "unsupported", "interrupt": "supported",
                             "resume_session": "supported", "structured_review": "supported", "accept_attachments": "unverified"},
        },
        "codex": {
            "discuss": ["--sandbox read-only"], "exec": ["--sandbox workspace-write"],
            "enforced_by": "codex exec --sandbox (OS 샌드박스)",
            "capabilities": {"conversation": "supported", "read_only": "supported", "scoped_write": "supported",
                             "stream_text": "supported", "steer_active_turn": "unsupported", "interrupt": "supported",
                             "resume_session": "supported", "structured_review": "supported", "accept_attachments": "unverified"},
        },
        "gemini": {
            "discuss": ["(프롬프트로만 요청 — 강제 안 됨)"], "exec": ["--approval-mode auto_edit (파일 수정만, 셸 명령은 거부)"],
            "enforced_by": "gemini --approval-mode (논의 모드 읽기 전용은 미검증)",
            "capabilities": {"conversation": "supported", "read_only": "unverified", "scoped_write": "supported",
                             "stream_text": "unverified", "steer_active_turn": "unsupported", "interrupt": "supported",
                             "resume_session": "unsupported", "structured_review": "unverified", "accept_attachments": "unverified"},
        },
    },
    "rules": [
        "AI 는 커밋·push·가지 바꾸기·배포·외부 전송·비밀값 출력을 하지 않는다. 체크포인트(커밋)는 Runner 가 명시 파일 목록으로만 만든다.",
        "대화방마다 분리된 작업 폴더(git worktree)와 가지 office/<대화방ID> 를 쓴다. 다른 대화의 변경을 함께 담지 않는다.",
        "검토는 고정 버전(SHA)의 읽기 전용 사본에서 한다. 검토 뒤 코드가 바뀌면 그 검토는 '이전 버전 검토'로 표시된다.",
        "검토 판정은 JSON 계약(verdict·findings·target_sha)으로만 인정한다. JSON 이 없거나 SHA 가 다르면 error 로 본다 (통과 아님).",
        "자동 보완은 검토 1회 → 수정 1회 → 재검토 1회 → 수정 1회 (최대 2회) 까지만. 넘으면 사람 판단으로 올린다.",
        "반영(작업 가지에 합치기·빌드·배포)은 소유자가 누를 때만. 체크포인트 저장·원격 공유·반영·배포 확인은 서로 다른 상태다.",
        "PC당 쓰기 실행 1개. 같은 폴더에서 터미널 Claude 세션이 살아 있으면 쓰기 턴을 시작하지 않는다(논의만).",
        "일반 ChatGPT/Gemini/NotebookLM 웹을 관찰·복제하지 않는다. GPT 는 API 어댑터가 연결되기 전까지 '외부 작업(수동 보고)'이다.",
    ],
    "protected_paths": ["serviceAccount.json", ".env", "*.pem", "*.key", "firestore.rules", "**/secrets/**"],
}

MAX_FIX_ROUNDS = 2
WORKTREE_BRANCH_PREFIX = "office/"
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def claude_allowed(mode: str) -> str:
    key = "discuss" if mode in ("discuss", "review") else "exec"
    return ",".join(POLICY["tools"]["claude"][key])


def is_protected(path: str) -> bool:
    p = path.replace("\\", "/")
    name = p.rsplit("/", 1)[-1]
    for pat in POLICY["protected_paths"]:
        if pat.startswith("**/") and pat.endswith("/**"):
            if f"/{pat[3:-3]}/" in f"/{p}/":
                return True
        elif pat.startswith("*."):
            if name.endswith(pat[1:]):
                return True
        elif name == pat or p == pat:
            return True
    return False


# ---------------------------------------------------------------- git / worktree
GitFn = Callable[..., tuple[int, str]]


def _porcelain_paths(out: str) -> list[str]:
    paths = []
    for line in out.splitlines():
        if not line.strip():
            continue
        # 앞 공백이 잘린 줄도 처리 ("M a.txt", "?? b", "RM a -> b")
        p = re.sub(r"^[ MADRCU?!]{1,2}\s+", "", line.rstrip("\n").lstrip() if not line.startswith(" ") else line[3:])
        if " -> " in p:
            p = p.split(" -> ", 1)[1]
        paths.append(p.strip().strip('"'))
    return paths


class Worktree:
    """대화방 전용 작업 폴더. 프로젝트 본 폴더(project clone)에서 worktree 를 하나 떼어낸다."""

    def __init__(self, git: GitFn, project_dir: Path, worktrees_root: Path, thread_id: str, work_branch: str):
        self.git = git
        self.project_dir = project_dir
        self.thread_id = thread_id
        self.work_branch = work_branch or "main"
        self.branch = WORKTREE_BRANCH_PREFIX + thread_id
        safe = "".join(ch for ch in thread_id if ch.isalnum() or ch in "-_")[:60]
        self.path = worktrees_root / safe

    def ensure(self) -> tuple[bool, str]:
        """worktree 가 없으면 만든다. (ok, note). 이미 있으면 그대로 (pull/reset 하지 않는다 — SYNC-03)."""
        if not (self.project_dir / ".git").exists():
            return False, "프로젝트 폴더가 git 저장소가 아니라 대화방 작업 폴더를 만들 수 없습니다."
        if (self.path / ".git").exists():
            return True, ""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # 가지가 이미 원격/로컬에 있으면 그걸 쓰고, 없으면 작업 가지에서 새로 만든다
        code, _ = self.git(self.project_dir, "rev-parse", "--verify", "--quiet", self.branch)
        if code == 0:
            code, out = self.git(self.project_dir, "worktree", "add", str(self.path), self.branch)
        else:
            self.git(self.project_dir, "fetch", "origin", self.work_branch, timeout=300)
            code, out = self.git(self.project_dir, "worktree", "add", "-b", self.branch, str(self.path), self.work_branch)
            if code != 0:
                code, out = self.git(self.project_dir, "worktree", "add", "-b", self.branch, str(self.path), f"origin/{self.work_branch}")
        if code != 0:
            return False, f"작업 폴더 생성 실패: {out[-300:]}"
        self.git(self.path, "config", "core.autocrlf", "true")
        return True, f"대화방 작업 폴더를 만들었습니다: {self.path} (가지 {self.branch}, 바탕 {self.work_branch})"

    def head(self) -> str | None:
        code, out = self.git(self.path, "rev-parse", "HEAD")
        return out.strip() if code == 0 and _SHA_RE.match(out.strip()) else None

    def current_branch(self) -> str:
        code, out = self.git(self.path, "rev-parse", "--abbrev-ref", "HEAD")
        return out.strip() if code == 0 else "?"

    def dirty_paths(self) -> list[str]:
        """커밋 안 된 변경 파일 (보호 파일은 체크포인트 대상이 아니므로 제외)."""
        code, out = self.git(self.path, "status", "--porcelain", "--untracked-files=all")
        return [p for p in _porcelain_paths(out) if not is_protected(p)] if code == 0 else []

    def changed_between(self, old: str, new: str) -> list[str]:
        code, out = self.git(self.path, "diff", "--name-only", old, new)
        return [l.strip() for l in out.splitlines() if l.strip()] if code == 0 else []

    def checkpoint(self, paths: list[str], message: str) -> tuple[str | None, str, list[str]]:
        """명시 파일 목록만 커밋한다. (sha, note, 제외된 보호 파일). 아무것도 없으면 (None, ...)."""
        allowed = [p for p in paths if not is_protected(p)]
        skipped = [p for p in paths if is_protected(p)]
        if not allowed:
            return None, "저장할 변경이 없습니다." + (f" (보호 파일 제외: {', '.join(skipped)})" if skipped else ""), skipped
        code, out = self.git(self.path, "add", "--", *allowed)
        if code != 0:
            return None, f"git add 실패: {out[-300:]}", skipped
        code, out = self.git(self.path, "commit", "-m", message, "--", *allowed)
        if code != 0:
            return None, f"git commit 실패: {out[-300:]}", skipped
        sha = self.head()
        return sha, "체크포인트를 저장했습니다.", skipped

    def push(self) -> tuple[bool, str]:
        code, out = self.git(self.path, "push", "-u", "origin", f"{self.branch}:{self.branch}", timeout=600)
        return code == 0, out[-300:]

    def remote_state(self) -> str:
        """unknown | synced | ahead | behind | diverged | local_only — fetch 실패면 unknown (최신이라고 하지 않는다)."""
        code, _ = self.git(self.path, "fetch", "origin", self.branch, timeout=120)
        if code != 0:
            # 원격에 가지가 없을 수도 있다
            code2, out2 = self.git(self.path, "ls-remote", "--heads", "origin", self.branch, timeout=60)
            if code2 == 0 and not out2.strip():
                return "local_only"
            return "unknown"
        code, out = self.git(self.path, "rev-list", "--left-right", "--count", f"HEAD...origin/{self.branch}")
        if code != 0:
            return "unknown"
        try:
            ahead, behind = (int(x) for x in out.split())
        except ValueError:
            return "unknown"
        if ahead == 0 and behind == 0:
            return "synced"
        if behind == 0:
            return "ahead"
        if ahead == 0:
            return "behind"
        return "diverged"

    def review_copy(self, sha: str, root: Path) -> tuple[Path | None, str]:
        """고정 버전의 읽기 전용 사본(detached worktree). 검토 중 후보가 바뀌어도 검토 대상은 그대로다 (REVIEW-03)."""
        if not _SHA_RE.match(sha or ""):
            return None, "검토 대상 SHA 가 올바르지 않습니다."
        p = root / f"review-{sha[:12]}"
        if (p / ".git").exists():
            return p, ""
        p.parent.mkdir(parents=True, exist_ok=True)
        code, out = self.git(self.project_dir, "worktree", "add", "--detach", str(p), sha)
        if code != 0:
            return None, f"검토 사본 생성 실패: {out[-300:]}"
        return p, ""

    def drop_review_copy(self, p: Path):
        self.git(self.project_dir, "worktree", "remove", "--force", str(p))
        self.git(self.project_dir, "worktree", "prune")


# ---------------------------------------------------------------- 검토 계약
VERDICTS = ("pass", "changes_required", "needs_human", "blocked", "error")
_FENCE_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.S)


def review_instructions(target_sha: str, review_id: str) -> str:
    return (
        "\n[판정 형식 — 반드시 지킬 것] 보고 맨 끝에 아래 모양의 JSON 을 ```json 코드 블록 하나로 쓴다. 이 블록이 없으면 검토는 '오류'로 처리되어 통과로 치지 않는다.\n"
        "```json\n"
        f'{{"review_id": "{review_id}", "target_sha": "{target_sha}", "verdict": "pass|changes_required|needs_human|blocked",\n'
        ' "findings": [{"id": "F1", "severity": "high|medium|low", "location": "파일:줄 또는 위치", "claim": "무엇이 문제인가",\n'
        '               "evidence": "근거", "suggested_action": "어떻게 고칠지", "requires_human_judgment": false}],\n'
        ' "checked": ["실제로 확인한 것"], "unverified": ["확인 못 한 것"]}\n'
        "```\n"
        "verdict 규칙: 고칠 수 있는 지적이 하나라도 있으면 changes_required. 사람(소유자)의 선택·해석이 필요하면 needs_human. "
        "자료·환경이 부족해 검토 못 하면 blocked. 정해진 범위에서 문제가 없을 때만 pass (unverified 는 그대로 적는다).\n"
    )


def parse_review(text: str, expect_sha: str | None, expect_review_id: str | None) -> dict:
    """결과 텍스트에서 마지막 ```json 블록을 읽는다. 없거나 어긋나면 verdict='error' (REVIEW-02, REVIEW-05)."""
    blocks = _FENCE_RE.findall(text or "")
    if not blocks:
        return {"verdict": "error", "findings": [], "checked": [], "unverified": [], "error": "판정 JSON 블록이 없습니다."}
    try:
        data = json.loads(blocks[-1])
    except Exception as e:  # noqa: BLE001
        return {"verdict": "error", "findings": [], "checked": [], "unverified": [], "error": f"판정 JSON 파싱 실패: {e}"}
    verdict = str(data.get("verdict", "")).strip()
    if verdict not in VERDICTS or verdict == "error":
        return {"verdict": "error", "findings": [], "checked": [], "unverified": [], "error": f"verdict 값이 올바르지 않습니다: {verdict!r}"}
    sha = str(data.get("target_sha") or "").strip()
    if expect_sha and sha != expect_sha:
        return {"verdict": "error", "findings": [], "checked": [], "unverified": [], "error": f"검토 대상 SHA 불일치 (기대 {expect_sha[:10]}, 보고 {sha[:10] or '없음'})"}
    if expect_review_id and str(data.get("review_id") or "") != expect_review_id:
        return {"verdict": "error", "findings": [], "checked": [], "unverified": [], "error": "review_id 불일치"}
    findings = []
    for i, f in enumerate(data.get("findings") or []):
        if not isinstance(f, dict):
            continue
        findings.append({
            "id": str(f.get("id") or f"F{i + 1}")[:20], "severity": str(f.get("severity") or "medium")[:10],
            "location": str(f.get("location") or "")[:200], "claim": str(f.get("claim") or "")[:1000],
            "evidence": str(f.get("evidence") or "")[:1000], "suggested_action": str(f.get("suggested_action") or "")[:1000],
            "requires_human_judgment": bool(f.get("requires_human_judgment", False)), "status": "open",
        })
    # 사람 판단이 필요한 지적이 있으면 pass 일 수 없다
    if verdict == "pass" and any(f["requires_human_judgment"] for f in findings):
        verdict = "needs_human"
    if verdict == "pass" and findings:
        verdict = "changes_required"
    return {"verdict": verdict, "findings": findings,
            "checked": [str(x)[:300] for x in (data.get("checked") or [])][:30],
            "unverified": [str(x)[:300] for x in (data.get("unverified") or [])][:30], "error": None}


# ---------------------------------------------------------------- 맥락 묶음
def context_capsule(thread: dict, since_version: int, project: dict | None = None) -> str:
    """세션 밖에서 생긴 일을 사람이 읽을 수 있는 묶음으로. since_version 이후 항목만 (전달 커서)."""
    ctx = thread.get("context") or {}
    version = int(ctx.get("version", 0))
    lines = [f"[사무실 맥락 묶음 · 대화방 {thread.get('thread_id')} · 맥락 버전 {version}]"]
    if project:
        lines.append(f"프로젝트: {project.get('name') or project.get('project_id')} · 저장소 {project.get('repo_reference') or '없음'}")
    sync = thread.get("sync") or {}
    if sync.get("head_sha"):
        lines.append(f"현재 코드 버전: 가지 {sync.get('branch')} · {sync['head_sha'][:10]}" + (" · 커밋 안 된 변경 있음" if sync.get("dirty_paths") else ""))
    goal = ctx.get("current_goal")
    if goal:
        lines.append(f"현재 목표: {goal}")
    dec = [d for d in ctx.get("decisions", []) if int(d.get("version", 0)) > since_version]
    if dec:
        lines.append("이 세션 밖에서 확정된 결정·사건:")
        lines += [f"  - ({d.get('kind', '결정')}) {d.get('text')}" for d in dec]
    cps = [c for c in thread.get("checkpoints", []) if int(c.get("context_version", 0)) > since_version]
    if cps:
        lines.append("새 체크포인트:")
        lines += [f"  - {c['checkpoint_id']} {c.get('candidate_sha', '')[:10]} ({c.get('origin')}) 파일: {', '.join(c.get('changed_paths', [])[:8])}" for c in cps]
    revs = [r for r in thread.get("reviews", []) if int(r.get("context_version", 0)) > since_version]
    for r in revs:
        lines.append(f"검토 {r['review_id']} ({r.get('reviewer_id')}, 대상 {str(r.get('target_sha', ''))[:10]}) 판정: {r.get('verdict')}")
        for f in r.get("findings", []):
            lines.append(f"  - [{f.get('id')} · {f.get('severity')}] {f.get('location')}: {f.get('claim')} → {f.get('suggested_action')}")
    oq = ctx.get("open_questions") or []
    if oq:
        lines.append("미결 질문: " + " / ".join(str(q) for q in oq[:5]))
    if len(lines) == 1 and not goal:
        lines.append("(전달할 새 맥락 없음)")
    return "\n".join(lines)


def bump_context(thread: dict, kind: str, text: str) -> int:
    ctx = thread.setdefault("context", {"version": 0, "decisions": [], "open_questions": [], "delivered": {}})
    ctx["version"] = int(ctx.get("version", 0)) + 1
    ctx.setdefault("decisions", []).append({"version": ctx["version"], "kind": kind, "text": text[:500]})
    if len(ctx["decisions"]) > 40:
        del ctx["decisions"][:len(ctx["decisions"]) - 40]
    return ctx["version"]


# ---------------------------------------------------------------- 로드맵 (읽기 전용)
def parse_roadmap(text: str, path: str, blob_sha: str | None) -> dict:
    """Markdown 제목 → 단계, 목록 → 항목. 구조를 못 읽으면 parse_status='raw_only' 로 원문만 둔다 (ROADMAP-02)."""
    sections: list[dict] = []
    cur = None
    for raw in (text or "").splitlines():
        line = raw.rstrip()
        m = re.match(r"^(#{1,4})\s+(.+)$", line)
        if m:
            cur = {"title": m.group(2).strip()[:200], "level": len(m.group(1)), "items": []}
            sections.append(cur)
            continue
        m = re.match(r"^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+)$", line)
        if m and cur is not None:
            mark = m.group(1)
            status = "done" if mark and mark.lower() == "x" else ("todo" if mark else "listed")
            cur["items"].append({"text": m.group(2).strip()[:300], "status": status})
    n_items = sum(len(s["items"]) for s in sections)
    ok = bool(sections) and n_items > 0
    for s in sections:
        s["items"] = s["items"][:60]
    return {
        "path": path, "blob_sha": blob_sha, "parse_status": "parsed" if ok else "raw_only",
        "sections": sections[:40] if ok else [],
        "raw_head": (text or "")[:6000],
        "item_count": n_items, "done_count": sum(1 for s in sections for i in s["items"] if i["status"] == "done"),
        "content_hash": hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16],
    }


def split_build_command(cmd: str) -> list[str]:
    return shlex.split(cmd, posix=(os.name != "nt"))
