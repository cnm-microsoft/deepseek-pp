## Module Inventory

| Module | Responsibility | Dependencies | Files | Lines | Complexity | S.U.P.E.R Score |
|:--|:--|:--|--:|--:|:--|:--|
| Extension manifest/config | WXT build and Chrome manifest permissions | WXT, React module | 2 | 133 | Low | S green, U green, P yellow, E yellow, R yellow |
| Background orchestration | Runtime message router, storage coordination, broadcasts | Core stores, Chrome runtime/tabs/sidePanel | 1 | 242 | Medium | S yellow, U green, P yellow, E yellow, R yellow |
| Main-world bridge | Installs page hooks and forwards page events to content script | Fetch hook, skill popup, page window messages | 1 | 79 | Medium | S green, U green, P yellow, E yellow, R yellow |
| Content script | DOM integration, tool execution, tool result rendering, restore | Chrome runtime/storage, core tool parser | 1 | 942 | High | S red, U yellow, P yellow, E yellow, R red |
| Interceptor | DeepSeek request augmentation, SSE filtering, history/IDB cleanup | Constants, memory injector, skill parser, SSE/tool parsers | 3 | 1106 | Critical | S red, U yellow, P yellow, E red, R red |
| Memory system | Memory DB, scoring, prompt injection | Dexie, constants/types | 3 | 251 | Medium | S green, U green, P yellow, E yellow, R yellow |
| Skill system | Built-in/custom skill registry and slash parser | Chrome storage, builtin data | 3 | 297 | Medium | S yellow, U green, P yellow, E yellow, R yellow |
| Preset/model/background stores | Lightweight config persistence | Chrome storage | 3 | 89 | Low | S green, U green, P yellow, E yellow, R yellow |
| Sync system | WebDAV config/client/merge | Fetch, Chrome permissions, core types | 3 | 122 | Medium | S green, U green, P green, E yellow, R green |
| Side panel UI | React management UI for memory/skill/preset/settings | Chrome runtime messages, components | 16 | 1837 | High | S yellow, U green, P yellow, E yellow, R yellow |
| Shared types/messaging/constants | Cross-module data contracts and endpoint constants | None / Chrome runtime | 3 | 288 | Medium | S yellow, U green, P yellow, E yellow, R yellow |

> S.U.P.E.R scoring uses green/yellow/red words to keep the files ASCII-friendly.

### Extension Manifest/Config

- **Path**: `wxt.config.ts`, `package.json`
- **Responsibility**: Define build, manifest metadata, permissions, and scripts.
- **Public API**: N/A.
- **Internal Dependencies**: None.
- **External Dependencies**: WXT, React, Dexie, Tailwind.
- **Complexity Rating**: Low.
- **Transformation Notes**: Automation requires `alarms`; direct background execution may also require careful host permission handling, but the preferred runner remains DeepSeek page-side.
- **S.U.P.E.R Assessment**:
  - **S**: Mostly single-purpose.
  - **U**: Configuration points outward only.
  - **P**: No schema for permissions or feature flags.
  - **E**: Hardcoded host permission for `chat.deepseek.com` is intentional.
  - **R**: Replacing scheduler strategy changes manifest permissions.

### Background Orchestration

- **Path**: `entrypoints/background.ts`
- **Responsibility**: Handle runtime messages, call stores, broadcast state to side panel and DeepSeek tabs.
- **Public API**: Message types such as `GET_MEMORIES`, `SAVE_SKILL`, `WEBDAV_SYNC`, `SAVE_BACKGROUND`.
- **Internal Dependencies**: Memory, skill, preset, model, background, sync stores.
- **External Dependencies**: Chrome `runtime`, `tabs`, `sidePanel`.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Natural home for automation CRUD, due-task scanning, alarm registration, active/pause state, and dispatch to execution tab.
- **S.U.P.E.R Assessment**:
  - **S**: Message router is broad and will grow; automation should move logic into `core/automation/*`.
  - **U**: Current flow is sidepanel/content -> background -> stores/tabs.
  - **P**: Message payloads are typed but not runtime-validated.
  - **E**: Depends on Chrome MV3 APIs by design.
  - **R**: Scheduler can be replaceable if background only depends on automation service functions.

### Main-World Bridge

- **Path**: `entrypoints/main-world.content.ts`
- **Responsibility**: Install hooks in the page main world and pass events to/from isolated content script.
- **Public API**: `window.postMessage` event protocol with `SYNC_STATE`, `TOOL_CALL`, `EXECUTE_TOOL_CALL`, `RESPONSE_COMPLETE`.
- **Internal Dependencies**: `core/interceptor/fetch-hook`, `core/ui/skill-popup`.
- **External Dependencies**: DeepSeek page globals, DOM, fetch/XHR.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Best place to add an automation runner bridge because it can call page-context APIs and preserve DeepSeek web challenge behavior.
- **S.U.P.E.R Assessment**:
  - **S**: Currently focused on bridge setup.
  - **U**: Events flow main-world -> content -> background.
  - **P**: Message protocol lacks explicit union types for automation commands.
  - **E**: DeepSeek-page-specific.
  - **R**: Runner should be separate from hook installation to avoid coupling.

### Content Script

- **Path**: `entrypoints/content.ts`
- **Responsibility**: Execute local tools, render tool result blocks, restore persisted tool blocks, sync UI/background state.
- **Public API**: Window message listener from main world; Chrome runtime listener for state/background updates.
- **Internal Dependencies**: Types, constants, tool parser.
- **External Dependencies**: DeepSeek DOM, Chrome runtime/storage.
- **Complexity Rating**: High.
- **Transformation Notes**: Automation needs a content bridge to receive background dispatch and talk to main-world runner; avoid placing scheduling or DeepSeek request assembly here.
- **S.U.P.E.R Assessment**:
  - **S**: Violates single purpose; tool execution, DOM rendering, persistence, cleanup, restore all live together.
  - **U**: Mostly one-way, but DOM restoration and storage can obscure flow.
  - **P**: Tool execution result shape exists; bridge messages are not centralized.
  - **E**: DeepSeek DOM selectors and Chrome storage are embedded.
  - **R**: Hard to replace rendering without touching execution flow.

### Interceptor

- **Path**: `core/interceptor/*`
- **Responsibility**: Modify DeepSeek completion requests, parse SSE responses, hide/restore tool calls in stream/history/IndexedDB.
- **Public API**: `installFetchHook`, `updateHookState`, parser helpers.
- **Internal Dependencies**: Constants, memory injector, skill parser, tool parser.
- **External Dependencies**: DeepSeek `/api/v0/chat/completion`, `/api/v0/chat/history_messages`, page `fetch`, `XMLHttpRequest`, IndexedDB.
- **Complexity Rating**: Critical.
- **Transformation Notes**: Automation should not bloat `fetch-hook.ts` further. Extract DeepSeek SSE/client helpers and an automation request runner with explicit contracts.
- **S.U.P.E.R Assessment**:
  - **S**: Major hotspot; one file handles request mutation, stream filtering, XHR wrapping, history cleanup, IDB cleanup.
  - **U**: Core logic depends on page/infrastructure details.
  - **P**: Some parser contracts exist, but no formal DeepSeek event schema.
  - **E**: Strongly environment-bound to current DeepSeek web internals.
  - **R**: Replacement cost is high; changes can affect memory, tools, history, and UI.

### Memory System

- **Path**: `core/memory/*`
- **Responsibility**: Store, select, score, touch, archive, and inject memories.
- **Public API**: Store CRUD, selector, injector.
- **Internal Dependencies**: Types/constants.
- **External Dependencies**: Dexie.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Automation prompts can use existing memory injection only if intentionally configured; MVP should default to existing global behavior through the same completion hook.
- **S.U.P.E.R Assessment**:
  - **S**: Split across store/selector/injector.
  - **U**: Store -> selector/injector flow is understandable.
  - **P**: TypeScript interfaces exist; no migrations for automation data yet.
  - **E**: IndexedDB dependency is explicit.
  - **R**: Could swap selector with limited impact.

### Skill System

- **Path**: `core/skill/*`
- **Responsibility**: Built-in skill definitions, custom skill persistence, slash command parser.
- **Public API**: `getAllSkills`, `saveSkill`, `parseSkillCommand`.
- **Internal Dependencies**: Types/constants.
- **External Dependencies**: Chrome storage.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Automations may reuse prompts containing slash skills because existing request modification already resolves skill commands.
- **S.U.P.E.R Assessment**:
  - **S**: Built-in data file is large but registry/parser are focused.
  - **U**: UI/background -> registry -> storage.
  - **P**: Skill interface is typed.
  - **E**: Chrome storage dependency is embedded.
  - **R**: Custom skill backend can be swapped with moderate changes.

### Side Panel UI

- **Path**: `entrypoints/sidepanel/*`
- **Responsibility**: User management UI.
- **Public API**: React components/pages, Chrome runtime messages.
- **Internal Dependencies**: Core types, constants.
- **External Dependencies**: React, Chrome runtime.
- **Complexity Rating**: High.
- **Transformation Notes**: Add an Automation tab/page rather than crowding Settings. Expected controls: run now, pause/resume, cron/RRULE, session link, run history, last/next run.
- **S.U.P.E.R Assessment**:
  - **S**: Pages mostly separated; Settings is large.
  - **U**: UI sends messages to background and listens for updates.
  - **P**: No shared runtime validation for message payloads.
  - **E**: Chrome runtime dependency is expected.
  - **R**: UI components are replaceable if automation API is clean.

### Shared Types/Messaging/Constants

- **Path**: `core/types.ts`, `core/messaging.ts`, `core/constants.ts`
- **Responsibility**: Cross-module types, message helper, endpoint/tool constants.
- **Public API**: Core interfaces and constants.
- **Internal Dependencies**: None.
- **External Dependencies**: Chrome runtime in messaging helper.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Add explicit automation types and message actions here, but avoid making `core/types.ts` a dumping ground.
- **S.U.P.E.R Assessment**:
  - **S**: Types file is becoming broad.
  - **U**: Constants/types are leaf dependencies.
  - **P**: Good TypeScript start; runtime validation absent.
  - **E**: Endpoint constants are hardcoded.
  - **R**: Splitting automation types later is low risk if imports are narrow.
