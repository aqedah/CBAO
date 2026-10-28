# -*- coding: utf-8 -*-
"""가짜 Claude Code CLI — stream-json 흉내. 시험 전용. 프롬프트 내용에 따라 파일을 만들거나 검토 JSON 을 낸다."""
import json
import os
import re
import sys

prompt = sys.stdin.read()
args = sys.argv[1:]
log = open(os.environ.get("FAKE_CLAUDE_LOG", os.devnull), "a", encoding="utf-8")
log.write(json.dumps({"args": args, "prompt": prompt}, ensure_ascii=False) + "\n")


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n"); sys.stdout.flush()


sid = "sess-resume-1" if "--resume" in args else "sess-new-" + str(abs(hash(prompt)) % 10000)
emit({"type": "system", "subtype": "init", "session_id": sid})
allowed = args[args.index("--allowedTools") + 1] if "--allowedTools" in args else ""
can_write = "Edit" in allowed.split(",")

if "[검토 모드]" in prompt or "[읽기 전용 교차 검토" in prompt:
    m = re.search(r"review_id (rev-\w+) · 대상 ([0-9a-f]{40})", prompt)
    rid, sha = (m.group(1), m.group(2)) if m else ("?", "?")
    verdict = os.environ.get("FAKE_REVIEW_VERDICT", "changes_required")
    if os.environ.get("FAKE_REVIEW_BROKEN"):
        emit({"type": "result", "result": "문제 없음이라고 볼 수 없다. 하지만 JSON 은 안 씀."})
        sys.exit(0)
    findings = [] if verdict == "pass" else [{"id": "F1", "severity": "medium", "location": "hello.txt:1", "claim": "인사말에 이름이 없다",
                                            "evidence": "hello.txt 내용", "suggested_action": "'world' 를 '이츠학' 으로", "requires_human_judgment": False}]
    body = {"review_id": rid, "target_sha": os.environ.get("FAKE_REVIEW_SHA", sha), "verdict": verdict, "findings": findings,
            "checked": ["hello.txt 읽음"], "unverified": ["실행은 안 함"]}
    emit({"type": "result", "result": "검토했습니다. 문제 없음이라고 볼 수 없다.\n```json\n" + json.dumps(body, ensure_ascii=False) + "\n```"})
    sys.exit(0)

if "[검토 반영 요청" in prompt and can_write:
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Edit", "input": {"file_path": "hello.txt"}}]}})
    open("hello.txt", "w", encoding="utf-8").write("hello 이츠학\n")
    emit({"type": "result", "result": "F1 수정함: hello.txt 의 이름을 바꿨습니다.\n변경한 파일: hello.txt"})
    sys.exit(0)

if "ADD_FILE" in prompt and can_write:
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Write", "input": {"file_path": "hello.txt"}}]}})
    open("hello.txt", "w", encoding="utf-8").write("hello world\n")
    if "SECRET_TOO" in prompt:
        open(".env", "w").write("X=1\n")
    emit({"type": "result", "result": "hello.txt 를 만들었습니다.\n변경한 파일: hello.txt\n질문: 인사말 언어는 한국어로 할까요?"})
    sys.exit(0)

if "ADD_FILE" in prompt and not can_write:
    emit({"type": "result", "result": "논의 모드라 파일을 만들지 않았습니다. 실행 모드로 보내 주시면 hello.txt 를 만들겠습니다."})
    sys.exit(0)

emit({"type": "result", "result": "알겠습니다. (프롬프트 길이 %d)" % len(prompt)})
