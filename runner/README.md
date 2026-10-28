# 심부름꾼(Runner) — 작업용 PC에 두는 프로그램

폴더 구성 (C:\CBAO):
- `serviceAccount.json` — Firebase 열쇠. **비밀.** 이 PC 밖으로 내보내지 않는다. (git 에 올리지 않음)
- `runner\install.bat` — 처음 한 번 더블클릭 (Python 패키지 설치)
- `runner\start.bat` — 켤 때마다 더블클릭. 창을 닫으면 꺼진다 (사무실에 '오프라인'으로 표시됨)
- `runner\config.json` — PC 이름, 동시 실행 수(기본 1), 작업 폴더 지정
- `projects\<프로젝트ID>\` — 작업 폴더. 없으면 자동 생성. 다른 폴더를 쓰려면 config.json 의 `projects` 에 `"CBSR": "C:\\\\경로"` 로 적는다
- `runs\*.log` — 실행 로그

동작: 10초마다 heartbeat → 설치된 claude/codex 를 관리형 팀원으로 등록 → 사무실에서 **실행 요청**한 작업을 한 번에 하나만 실행 → 끝나면 실행 로그·요약을 결과물로 남기고 **승인 요청**을 만든다. 완료 판정은 사람이 승인함에서 한다.

Python 3.10 이상 필요. Claude Code(`claude`)와 Codex(`codex`)는 이 PC에 설치·로그인되어 있어야 하며, 없으면 해당 팀원은 등록되지 않는다.
