## Milestones

| # | Milestone | Target Phase | Criteria | Status |
|:--|:--|:--|:--|:--|
| 1 | Phase 1: Automation Foundation | After Phase 1 | Automation contracts, storage, and schedule calculation are implemented and compile | Pending |
| 2 | Phase 2: Scheduler and Execution Bridge | After Phase 2 | Background can dispatch a run to a DeepSeek page and receive session/message state | Pending |
| 3 | Phase 3: Side Panel Automation UI | After Phase 3 | Users can create, edit, run, pause/resume, and inspect automation sessions | Pending |
| 4 | Phase 4: Reliability and Compatibility | After Phase 4 | Login/tab failures, missed runs, timeouts, and injection behavior are explicitly handled | Pending |
| 5 | Phase 5: Verification and Documentation | After Phase 5 | Type checks pass, live DeepSeek workflow is verified, and documentation is updated | Pending |

### Milestone Details

| Milestone | Deliverables |
|:--|:--|
| Phase 1: Automation Foundation | `core/automation` contracts and store; pure schedule parser; minimum interval validation |
| Phase 2: Scheduler and Execution Bridge | `chrome.alarms`; due-run scanner; bridge messages; main-world runner; history reconciliation |
| Phase 3: Side Panel Automation UI | Automation tab, list, editor, run controls, recent run history, session link |
| Phase 4: Reliability and Compatibility | Tab orchestration, login/unavailable detection, timeout/retry/missed-run policy, prompt injection policy |
| Phase 5: Verification and Documentation | Compile checks, live browser verification checklist, README/operator notes |
