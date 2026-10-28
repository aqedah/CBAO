# -*- coding: utf-8 -*-
"""
Claude Code 훅 수신기. Claude Code 가 세션 시작/지시 입력/도구 사용/종료 때 이 스크립트를 부르고
표준입력으로 JSON 을 넘긴다. 여기서는 그 사실을 C:\\CBAO\\observe\\events.jsonl 에 한 줄 덧붙일 뿐이다.
심부름꾼(runner.py)이 이 파일을 읽어 장부에 '관찰형 실행'으로 기록한다.
- 비밀값·대화 본문을 저장하지 않는다 (지시 첫 줄 120자만 제목용으로 남긴다).
- 실패해도 Claude Code 를 막지 않는다 (항상 exit 0).
"""
import json
import os
import sys
import time
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "observe" / "events.jsonl"


def main() -> int:
    try:
        raw = sys.stdin.read()
        ev = json.loads(raw) if raw.strip() else {}
    except Exception:  # noqa: BLE001
        ev = {}
    rec = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
        "event": ev.get("hook_event_name") or (sys.argv[1] if len(sys.argv) > 1 else "unknown"),
        "session_id": ev.get("session_id"),
        "cwd": ev.get("cwd"),
        "tool": ev.get("tool_name"),
        "target": None,
        "prompt": None,
        "cbao_run_id": os.environ.get("CBAO_RUN_ID"),  # 심부름꾼이 띄운 세션이면 값이 있다 → 중복 기록 방지
    }
    ti = ev.get("tool_input") or {}
    if isinstance(ti, dict):
        rec["target"] = str(ti.get("file_path") or ti.get("path") or ti.get("command") or ti.get("pattern") or "")[:160]
    if ev.get("prompt"):
        rec["prompt"] = str(ev.get("prompt")).strip().splitlines()[0][:120]
    try:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        with open(OUT, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:  # noqa: BLE001
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
