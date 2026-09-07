# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai/collab-chain.spec.ts >> 绿⑮: 技能生成占满允许并发时仍能跑通 collab-chain 协作链路（3 并发技能生成负载）
- Location: e2e/ai/collab-chain.spec.ts:1537:5

# Error details

```
Error: phase 3 start: all three captured PIDs must be alive at the main-chain node

expect(received).toHaveLength(expected)

Expected length: 3
Received length: 0
Received array:  []
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation "Open projects" [ref=e4]:
    - button "Switch to project nimbalyst-test-R2QwRz" [ref=e6] [cursor=pointer]: NT
    - button "Add project to rail" [ref=e8] [cursor=pointer]: +
  - generic [ref=e9]:
    - button "Files (⌘E)" [ref=e11] [cursor=pointer]:
      - generic [ref=e12]: account_tree
    - button "code" [pressed] [ref=e14] [cursor=pointer]:
      - generic [ref=e15]: code
    - button "Tracker · 工作区全部事项 (⌘T)" [ref=e17] [cursor=pointer]:
      - generic [ref=e18]: assignment
    - 'button "Terminal (Ctrl+`)" [ref=e22] [cursor=pointer]':
      - generic [ref=e23]: terminal
    - generic [ref=e24]:
      - generic [ref=e25]:
        - button "AI 用量" [ref=e28] [cursor=pointer]:
          - generic [ref=e29]: speed
        - button "1 background task running" [ref=e31] [cursor=pointer]:
          - generic [ref=e32]: progress_activity
          - generic [ref=e33]: "1"
        - button "Allow Edits mode" [ref=e36] [cursor=pointer]:
          - generic [ref=e37]: shield
        - button "技能库" [ref=e39] [cursor=pointer]:
          - generic [ref=e40]: school
      - generic [ref=e42]:
        - button "Change theme" [ref=e45] [cursor=pointer]:
          - generic [ref=e46]: palette
        - button "Send Feedback" [ref=e47] [cursor=pointer]:
          - generic [ref=e48]: feedback
        - button "User menu" [ref=e50] [cursor=pointer]:
          - generic [ref=e51]: person
  - generic [ref=e57]:
    - generic [ref=e59]:
      - generic [ref=e61]:
        - generic [ref=e62]:
          - heading "nimbalyst-test-R2QwRz" [level=3] [ref=e64]
          - generic [ref=e65]:
            - button "Switch to kanban view (本次派发相关)" [ref=e66] [cursor=pointer]:
              - img [ref=e67]
              - text: Kanban
            - button "Search sessions" [ref=e71] [cursor=pointer]:
              - img [ref=e72]
            - button "Create new session, worktree, or terminal" [ref=e76] [cursor=pointer]:
              - img [ref=e77]
        - generic "/var/folders/st/r866ph290_35q34xmk31xmzm0000gn/T/nimbalyst-test-R2QwRz" [ref=e79]
      - generic [ref=e80]: Agent Sessions
      - textbox "Search sessions or filter by tag" [ref=e82]:
        - /placeholder: "Search or type # to filter by tag..."
      - generic [ref=e83]:
        - button "Show archived sessions" [ref=e84] [cursor=pointer]:
          - img [ref=e85]
        - generic "3 non-archived sessions in this workspace (matches the iOS project list count)" [ref=e87]: 3 sessions
        - button "Sort sessions" [ref=e89] [cursor=pointer]:
          - img [ref=e90]
      - generic [ref=e95]:
        - button "Meta Agent group, expanded" [expanded] [ref=e98] [cursor=pointer]:
          - generic [ref=e99]: chevron_right
          - generic [ref=e100]: Meta Agent
          - generic [ref=e101]: "1"
        - generic [ref=e103]:
          - button "Collapse hub Concurrent skill load Head 1 Just now progress_activity" [expanded] [ref=e104] [cursor=pointer]:
            - button "Collapse" [ref=e105]:
              - generic [ref=e106]: chevron_right
            - generic [ref=e108]: hub
            - generic [ref=e109]: Concurrent skill load Head
            - generic [ref=e110]: "1"
            - generic [ref=e111]: Just now
            - generic "Processing" [ref=e113]:
              - generic [ref=e114]: progress_activity
          - button "Load verification subtask" [ref=e116] [cursor=pointer]:
            - img [ref=e118]
            - generic [ref=e121]: Load verification subtask
            - generic [ref=e122]: Just now
            - generic "Unread response" [ref=e124]:
              - generic [ref=e125]: circle
        - button "Today group, expanded" [expanded] [ref=e128] [cursor=pointer]:
          - generic [ref=e129]: chevron_right
          - generic [ref=e130]: Today
          - generic [ref=e131]: "1"
        - 'button "Session: New Session, updated Just now" [ref=e133] [cursor=pointer]':
          - img [ref=e135]
          - generic [ref=e137]:
            - generic "New Session" [ref=e138]
            - generic [ref=e139]:
              - generic "2026年9月7日 GMT+8 下午10:29" [ref=e140]: Just now
              - generic [ref=e141]: default
    - separator "Resize session history panel" [ref=e142]
    - generic [ref=e144]:
      - generic [ref=e145]:
        - generic [ref=e147]:
          - generic [ref=e148]:
            - generic [ref=e150]: hub
            - heading "总指挥" [level=2] [ref=e152]
            - generic [ref=e153]: nimbalyst-test-R2QwRz · 0 个在跑 · 0 个等你确认
          - generic [ref=e155]:
            - generic "0 agents working (共 1 个工单)" [ref=e156]:
              - generic [ref=e159]: smart_toy
              - generic [ref=e160]: 0 agents working
            - button "全部停下" [disabled] [ref=e161]
        - generic [ref=e162]:
          - generic [ref=e165]:
            - generic [ref=e167]:
              - generic [ref=e171]:
                - generic [ref=e175]:
                  - generic [ref=e177]:
                    - generic [ref=e178]:
                      - generic [ref=e179]:
                        - generic [ref=e180]: 方案审批
                        - generic "META AGENT" [ref=e181]
                      - generic [ref=e182]: Concurrent skill load verification plan
                    - generic [ref=e183]: 方案已批准
                  - generic [ref=e184]:
                    - list [ref=e185]:
                      - listitem [ref=e186]: Verify IPC message passing under load
                      - listitem [ref=e187]: Verify database write and retrieval integrity
                    - generic [ref=e188]: 1 个工单
                    - generic [ref=e189]:
                      - generic [ref=e190]: 总体风险
                      - generic [ref=e191]: Background skill generation must never lock up SQLite database or IPC message loop.
                - generic [ref=e198]: Thinking...
              - button "arrow_downward" [ref=e200] [cursor=pointer]:
                - generic [ref=e201]: arrow_downward
            - generic:
              - button "Set phase" [ref=e202] [cursor=pointer]:
                - generic [ref=e203]: view_kanban
                - generic [ref=e204]: Phase
              - button "Prompts Menu" [ref=e205] [cursor=pointer]
          - status [ref=e207]:
            - generic [ref=e208]: Stop & clear queue stops the session and clears queued messages
            - button "Stop & clear queue" [ref=e209] [cursor=pointer]
          - generic [ref=e210]:
            - generic "Drag to resize prompt box" [ref=e211]
            - generic [ref=e212]:
              - 'button "Current model: scripted-collaboration-model" [ref=e215] [cursor=pointer]':
                - generic [ref=e216]: scripted-collaboration-model
                - generic [ref=e217]: expand_more
              - button "Actions (0)" [ref=e219] [cursor=pointer]:
                - generic [ref=e220]: bolt
                - generic [ref=e221]: Actions
                - generic [ref=e222]: expand_more
              - group "Token usage data not available yet" [ref=e223]:
                - generic [ref=e224]: "--"
            - generic [ref=e225]:
              - textbox "Type your message... (Enter to send, Shift+Enter for new line, @ for files, @@ for sessions, / for commands)" [ref=e226]
              - button "Stop and keep queued messages" [ref=e227] [cursor=pointer]:
                - img [ref=e228]
      - button "打开交付文件架" [ref=e230] [cursor=pointer]:
        - button "打开交付文件架" [ref=e231]:
          - generic [ref=e232]: folder_open
          - generic [ref=e233]: "0"
```

# Test source

```ts
  68  |   sessionId: string;
  69  |   status?: 'queued';
  70  |   queued?: boolean;
  71  |   queueId?: string;
  72  | };
  73  | 
  74  | type SpawnedSession = {
  75  |   sessionId: string;
  76  |   status: string;
  77  | };
  78  | 
  79  | type SessionListEntry = {
  80  |   id: string;
  81  |   title: string;
  82  |   provider: string;
  83  |   model?: string;
  84  |   sessionType?: string;
  85  |   agentRole?: string;
  86  |   createdBySessionId?: string | null;
  87  |   createdAt: number;
  88  |   updatedAt: number;
  89  |   messageCount?: number;
  90  |   isArchived?: boolean;
  91  |   isPinned?: boolean;
  92  |   parentSessionId?: string | null;
  93  |   worktreeId?: string | null;
  94  |   childCount?: number;
  95  | };
  96  | 
  97  | let electronApp: ElectronApplication;
  98  | let page: Page;
  99  | let workspacePath: string;
  100 | let scriptedProvider: ScriptedCollaborationProvider;
  101 | let originalAlphaFeatures: Record<string, boolean> | null = null;
  102 | let engineStateDir: string;
  103 | let evidenceDir: string;
  104 | let cachePath: string;
  105 | let testBodyStartedAt: number;
  106 | type SkillInput = { name: string; description: string; content?: string };
  107 | type EngineProcess = { pid: number; startTime: number; description: string };
  108 | type LoadPhase = {
  109 |   phase: number;
  110 |   node: string;
  111 |   capturedAt: number;
  112 |   skills: Array<SkillInput & { hash: string }>;
  113 |   liveProcesses: EngineProcess[];
  114 |   boundaries: Array<{ boundary: 'start' | 'complete'; at: number; pids: Array<{ pid: number; alive: boolean }> }>;
  115 |   endedBeforeNodeAt?: number;
  116 |   ends?: unknown[];
  117 | };
  118 | const lifecycleEvidence = { phases: [] as LoadPhase[], pageChecks: [] as unknown[] };
  119 | 
  120 | function skillHash(skill: SkillInput): string {
  121 |   return createHash('sha256').update(JSON.stringify([
  122 |     skill.name.trim(), skill.description.trim(), (skill.content ?? '').trim(),
  123 |   ])).digest('hex');
  124 | }
  125 | 
  126 | function isAlive(pid: number): boolean {
  127 |   try { process.kill(pid, 0); return true; } catch { return false; }
  128 | }
  129 | 
  130 | async function engineEvents(): Promise<Array<EngineProcess & { event: string; at: number; endTime?: number }>> {
  131 |   const raw = await fs.readFile(path.join(engineStateDir, 'process-events.jsonl'), 'utf8').catch(() => '');
  132 |   return raw.trim() ? raw.trim().split('\n').map(line => JSON.parse(line)) : [];
  133 | }
  134 | 
  135 | async function saveLifecycle(): Promise<void> {
  136 |   await fs.writeFile(path.join(evidenceDir, 'collab-load-lifecycle.json'), JSON.stringify(lifecycleEvidence, null, 2));
  137 | }
  138 | 
  139 | async function capturePhase(phaseNumber: number, skills: SkillInput[], liveProcesses: EngineProcess[]): Promise<LoadPhase> {
  140 |   const phase: LoadPhase = { phase: phaseNumber, node: ['plan_approval', 'child_execution', 'final_summary'][phaseNumber - 1], capturedAt: Date.now(), skills: skills.map(skill => ({ ...skill, hash: skillHash(skill) })), liveProcesses, boundaries: [] };
  141 |   lifecycleEvidence.phases.push(phase);
  142 |   await saveLifecycle();
  143 |   expect(liveProcesses).toHaveLength(3);
  144 |   expect(new Set(liveProcesses.map(proc => proc.pid)).size).toBe(3);
  145 |   expect(liveProcesses.map(proc => proc.description).sort()).toEqual(skills.map(skill => skill.description).sort());
  146 |   return phase;
  147 | }
  148 | 
  149 | async function releasePhase(phase: LoadPhase): Promise<void> {
  150 |   await Promise.all(phase.liveProcesses.map(proc => fs.writeFile(path.join(engineStateDir, `release-${proc.pid}`), 'release')));
  151 | }
  152 | 
  153 | async function assertNodeLoad(phase: LoadPhase, boundary: 'start' | 'complete'): Promise<void> {
  154 |   if (boundary === 'start' && process.env.NIMBALYST_TEST_LOAD_ENDED_BEFORE_NODE === String(phase.phase)) {
  155 |     // 反向 D：确实达到 3 个存活，释放并等待全部退出后，才尝试节点。
  156 |     expect(phase.liveProcesses.filter(proc => isAlive(proc.pid))).toHaveLength(3);
  157 |     await releasePhase(phase);
  158 |     await new Promise(resolve => setTimeout(resolve, 3200));
  159 |     expect(phase.liveProcesses.filter(proc => isAlive(proc.pid))).toHaveLength(0);
  160 |     expect(await countRunningEngineProcesses()).toBe(0);
  161 |     phase.endedBeforeNodeAt = Date.now();
  162 |     console.log('CHIEF_LOAD_ENDED', JSON.stringify({ phase: phase.phase, aliveBeforeMainNode: 0, at: phase.endedBeforeNodeAt }));
  163 |   }
  164 |   const snapshot = { boundary, at: Date.now(), pids: phase.liveProcesses.map(proc => ({ pid: proc.pid, alive: isAlive(proc.pid) })) };
  165 |   phase.boundaries.push(snapshot);
  166 |   await saveLifecycle(); // 断言失败也保留本次节点和 PID 状态
  167 |   console.log('GN_R4_NODE_LOAD', JSON.stringify({ phase: phase.phase, ...snapshot }));
> 168 |   expect(snapshot.pids.filter(proc => proc.alive), `phase ${phase.phase} ${boundary}: all three captured PIDs must be alive at the main-chain node`).toHaveLength(3);
      |                                                                                                                                                      ^ Error: phase 3 start: all three captured PIDs must be alive at the main-chain node
  169 | }
  170 | 
  171 | async function assertPhaseLifetime(phase: LoadPhase): Promise<void> {
  172 |   const events = await engineEvents();
  173 |   phase.ends = events.filter(event => event.event !== 'START' && phase.liveProcesses.some(proc => proc.pid === event.pid));
  174 |   await saveLifecycle();
  175 |   expect(phase.boundaries.map(node => node.boundary)).toEqual(['start', 'complete']);
  176 |   for (const proc of phase.liveProcesses) {
  177 |     const start = events.filter(event => event.event === 'START' && event.pid === proc.pid);
  178 |     const end = events.filter(event => event.event === 'END' && event.pid === proc.pid);
  179 |     expect(start).toHaveLength(1);
  180 |     expect(end).toHaveLength(1);
  181 |     expect(start[0].description).toBe(proc.description);
  182 |     expect(start[0].at).toBeLessThanOrEqual(phase.boundaries[0].at);
  183 |     expect(end[0].endTime).toBeGreaterThanOrEqual(phase.boundaries[1].at);
  184 |     await expect.poll(() => isAlive(proc.pid), { timeout: 3000 }).toBe(false);
  185 |   }
  186 | }
  187 | 
  188 | const mcpClients: MetaAgentMcpClient[] = [];
  189 | const PLAN_APPROVAL_SCREENSHOT_DIR = path.resolve(
  190 |   __dirname,
  191 |   '../../../../e2e_test_output/plan-approval-layout',
  192 | );
  193 | 
  194 | async function countRunningEngineProcesses(): Promise<number> {
  195 |   try {
  196 |     const files = await fs.readdir(engineStateDir);
  197 |     let aliveCount = 0;
  198 |     for (const f of files) {
  199 |       if (f.startsWith('running-') && f.endsWith('.json')) {
  200 |         try {
  201 |           const content = await fs.readFile(path.join(engineStateDir, f), 'utf8');
  202 |           const data = JSON.parse(content);
  203 |           if (data && typeof data.pid === 'number') {
  204 |             process.kill(data.pid, 0);
  205 |             aliveCount++;
  206 |           }
  207 |         } catch {
  208 |           // Process exited or invalid file
  209 |         }
  210 |       }
  211 |     }
  212 |     return aliveCount;
  213 |   } catch {
  214 |     return 0;
  215 |   }
  216 | }
  217 | 
  218 | async function getLiveEngineProcessInfo(): Promise<EngineProcess[]> {
  219 |   try {
  220 |     const files = await fs.readdir(engineStateDir);
  221 |     const list: EngineProcess[] = [];
  222 |     for (const f of files) {
  223 |       if (f.startsWith('running-') && f.endsWith('.json')) {
  224 |         try {
  225 |           const content = await fs.readFile(path.join(engineStateDir, f), 'utf8');
  226 |           const data = JSON.parse(content);
  227 |           if (data && typeof data.pid === 'number') {
  228 |             process.kill(data.pid, 0);
  229 |             list.push({ pid: data.pid, startTime: data.startTime ?? 0, description: data.description });
  230 |           }
  231 |         } catch {}
  232 |       }
  233 |     }
  234 |     return list;
  235 |   } catch {
  236 |     return [];
  237 |   }
  238 | }
  239 | 
  240 | async function invokeElectron<T>(targetPage: Page, channel: string, ...args: unknown[]): Promise<T> {
  241 |   return await targetPage.evaluate(
  242 |     async ({ invokeChannel, invokeArgs }) => {
  243 |       return await (window as any).electronAPI.invoke(invokeChannel, ...invokeArgs);
  244 |     },
  245 |     { invokeChannel: channel, invokeArgs: args },
  246 |   );
  247 | }
  248 | 
  249 | async function queryDb<T>(targetPage: Page, sql: string, params: unknown[] = []): Promise<T[]> {
  250 |   const result = await invokeElectron<{ rows?: T[]; error?: string }>(targetPage, 'test:query-db', sql, params);
  251 |   if (result.error) {
  252 |     throw new Error(`Read-only E2E database query failed: ${result.error}`);
  253 |   }
  254 |   return result.rows ?? [];
  255 | }
  256 | 
  257 | function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  258 |   if (value && typeof value === 'object' && !Array.isArray(value)) {
  259 |     return value as Record<string, unknown>;
  260 |   }
  261 |   if (typeof value !== 'string') {
  262 |     return null;
  263 |   }
  264 |   try {
  265 |     const parsed = JSON.parse(value) as unknown;
  266 |     return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
  267 |       ? parsed as Record<string, unknown>
  268 |       : null;
```