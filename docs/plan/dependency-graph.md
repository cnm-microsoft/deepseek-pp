## Task Dependency Graph

```mermaid
graph TD
  subgraph P1 ["Phase 1: Automation Foundation"]
    T1_1["T1.1 Domain contracts"]
    T1_2["T1.2 Persistence store"]
    T1_3["T1.3 Schedule parser"]
    T1_1 --> T1_2
    T1_1 --> T1_3
  end

  subgraph P2 ["Phase 2: Scheduler and Execution Bridge"]
    T2_1["T2.1 Background scheduler"]
    T2_2["T2.2 Bridge protocol"]
    T2_3["T2.3 Main-world runner"]
    T2_4["T2.4 History reconciliation"]
    T1_2 --> T2_1
    T1_3 --> T2_1
    T1_1 --> T2_2
    T2_2 --> T2_3
    T2_3 --> T2_4
  end

  subgraph P3 ["Phase 3: Side Panel Automation UI"]
    T3_1["T3.1 Automation tab/list"]
    T3_2["T3.2 Editor form"]
    T3_3["T3.3 Run controls/history"]
    T1_2 --> T3_1
    T3_1 --> T3_2
    T1_3 --> T3_2
    T2_1 --> T3_3
    T2_2 --> T3_3
    T3_1 --> T3_3
  end

  subgraph P4 ["Phase 4: Reliability and Compatibility"]
    T4_1["T4.1 Tab orchestration"]
    T4_2["T4.2 Retry/timeout policy"]
    T4_3["T4.3 Injection compatibility"]
    T2_1 --> T4_1
    T2_2 --> T4_1
    T2_1 --> T4_2
    T2_3 --> T4_2
    T2_3 --> T4_3
  end

  subgraph P5 ["Phase 5: Verification and Documentation"]
    T5_1["T5.1 Compile/check coverage"]
    T5_2["T5.2 Live verification"]
    T5_3["T5.3 README/operator notes"]
    T1_3 --> T5_1
    T2_1 --> T5_1
    T2_3 --> T5_2
    T3_3 --> T5_2
    T4_1 --> T5_2
    T5_2 --> T5_3
  end
```

### Parallel Execution Notes

- Phase 1 has two lanes after domain contracts: persistence and schedule parsing.
- Phase 2 has a high-conflict bridge/runner lane; avoid concurrent edits to `fetch-hook.ts`, `content.ts`, and `main-world.content.ts`.
- Phase 3 UI work can begin after the store API exists and can use mocked runner responses until Phase 2 is complete.
- Phase 4 should be integrated after the main happy path works.
- Phase 5 verification depends on real DeepSeek page behavior and should not be treated as purely unit-testable.
