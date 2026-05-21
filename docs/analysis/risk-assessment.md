## Risk Assessment

### S.U.P.E.R Architecture Health Summary

| Principle | Status | Key Findings | Transformation Priority |
|:--|:--|:--|:--|
| **S** Single Purpose | Yellow/Red | `fetch-hook.ts` and `content.ts` already combine multiple responsibilities. Automation could make them harder to reason about if added inline. | High |
| **U** Unidirectional Flow | Yellow | Current flow is mostly directional, but page hook, content script, and background have bidirectional window/runtime messaging. | Medium |
| **P** Ports over Implementation | Yellow | TypeScript interfaces exist, but message protocols and DeepSeek SSE/history payloads are not formalized as contracts. | High |
| **E** Environment-Agnostic | Red | DeepSeek web integration depends on current page internals, endpoint paths, challenge headers, DOM shape, and Chrome MV3 APIs. | High |
| **R** Replaceable Parts | Yellow/Red | Interceptor and content script are high replacement-cost hotspots. Scheduler can be replaceable if isolated. | High |

**Overall Health**: 0/5 principles fully healthy for this transformation; refactoring needed before or during implementation.

### S.U.P.E.R Violation Hotspots

1. `core/interceptor/fetch-hook.ts`
   - Critical because it owns completion request mutation, SSE filtering, XHR interception, history cleanup, and IndexedDB cleanup.
   - Automation must not add scheduling/session-store concerns here.

2. `entrypoints/content.ts`
   - High because it owns local tool execution, rendering, restore, storage, and bridge messages.
   - Automation should add a narrow bridge only, with execution logic elsewhere.

3. `entrypoints/background.ts`
   - Medium/high because the message switch is centralized and will grow.
   - Automation CRUD/scheduling should delegate to `core/automation/*`.

4. `core/types.ts`
   - Medium because adding all automation contracts here could make the global type surface unwieldy.
   - Prefer grouped automation interfaces and narrow message action additions.

### Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:--|:--|:--|:--|:--|
| DeepSeek web challenge / proof-of-work blocks direct background fetch | Automations fail silently or get rejected | High | High | Execute completion from main-world DeepSeek page runner; do not rely on background-only fetch for MVP |
| `parent_message_id` extraction is incomplete | Scheduled runs may fork, fail, or lose context | High | High | Persist latest assistant/user message IDs from SSE and verify against `history_messages` after each run |
| MV3 service worker sleep delays alarms | Runs may be late | High | Medium | Use `chrome.alarms` as wake signal, scan due tasks on startup/alarm, track `nextRunAt` and missed-run policy |
| User not logged in / no DeepSeek tab available | Scheduled run cannot start | Medium | High | Open or focus `chat.deepseek.com`, detect login/input availability, mark run failed with clear reason |
| DOM or DeepSeek frontend changes | Runner breaks | Medium | High | Favor API runner in main world over DOM typing; keep DOM fallback/testing isolated |
| Too many/high-frequency automations | Rate limiting, browser load, account risk | Medium | Medium | Enforce minimum interval and serial per-automation run lock |
| Existing hooks intercept automation prompt unexpectedly | Prompt double-injected or transformed unexpectedly | Medium | Medium | Decide whether automation uses normal hook augmentation; tag automation requests if bypass is needed |
| Large run history in chrome storage | Storage quota pressure | Medium | Medium | Store compact summaries in chrome storage, optionally larger logs in Dexie |
| Side panel UX crowding | Hard to manage tasks | Medium | Low | Add dedicated Automation tab/page |

### High-Severity Risks

#### Direct completion calls may fail outside page context

The DeepSeek frontend bundle calls `/api/v0/chat/create_pow_challenge` and attaches challenge response headers before completion-like requests. A background-only `fetch('/api/v0/chat/completion')` implementation is likely brittle because it must reproduce session cookies, CSRF-like headers, challenge solving, SSE handling, and future frontend changes. The MVP should run inside `entrypoints/main-world.content.ts`, where the page already has the right context and the existing extension already hooks completion traffic.

#### Continuous session state depends on parent message IDs

Completion requests use:

```json
{
  "chat_session_id": "...",
  "parent_message_id": null,
  "model_type": "...",
  "prompt": "...",
  "ref_file_ids": [],
  "thinking_enabled": false,
  "search_enabled": false,
  "action": null,
  "preempt": false
}
```

For the first run in a new automation session, `parent_message_id` is null. For subsequent runs, the extension must persist the latest valid parent message ID after the assistant response completes. This should be confirmed from SSE payloads and reconciled with `/api/v0/chat/history_messages`.

#### Scheduler timing is best-effort

Chrome MV3 alarms are suitable for browser automation but not equivalent to a server cron daemon. The design should record intended run time, actual start/end time, and status, and should explicitly handle missed windows after browser sleep or restart.

### Technical Debt

- `fetch-hook.ts` is too large for safe feature growth.
- Message action types do not cover all current runtime messages.
- There is no runtime validation for persisted objects.
- There is no existing concept of background jobs, run locks, retry policy, or run history.
- Side panel has no route/state persistence; tabs are local React state only.

### Compatibility Concerns

- Manifest needs `alarms`; adding it changes extension permission surface.
- Automation execution tabs require `chat.deepseek.com` availability and active login.
- New automation stores must be versioned for future sync/export.
- Existing WebDAV sync currently covers memories/skills/presets only; automations should remain local in MVP unless explicitly expanded.
- Existing prompt augmentation will apply to automation messages unless a bypass/tag is designed.

### Recommended Implementation Boundary

Add the feature in slices:

1. `core/automation/types.ts`, `core/automation/store.ts`, `core/automation/schedule.ts`.
2. Background automation CRUD, alarm lifecycle, due-task scanner, run locking.
3. Content/main-world automation bridge with commands such as `AUTOMATION_RUN_REQUEST` and `AUTOMATION_RUN_RESULT`.
4. Main-world DeepSeek runner that can create/continue a chat session and return message IDs/status.
5. Side panel Automation tab with compact task and run controls.
6. Verification harness using the live DeepSeek page plus TypeScript compile.
