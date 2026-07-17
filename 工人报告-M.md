# 工人报告 M：派发自动建卡与状态联动

## 结论

- 【已验证】FB-014、派发自动建卡、卡片↔会话双向关联、六态联动、打断原因记录、失败容错均已在白名单内实现；真实 SQLite 持久化与真实 `SessionStateManager` 的 `interrupt → end` 事件序列均有回归测试。
- 【已验证】最终相关测试 6 文件 33 项全绿；MetaAgentService 回归 9 文件 47 项全绿；runtime / electron 两包类型检查均退出 0。
- 【已验证｜白名单外缺口】`work-order.yaml` 已新增且解析测试通过，但 `ModelLoader.ts` 仍以硬编码数组注册内置类型，不读取 `models/builtins/*.yaml`。该文件不在白名单，故未越界修改。
- 【推断】在补充 `ModelLoader.ts` 注册或恢复 YAML 自动装载前，卡片能真实落库、关联和联动，但 `work-order` 不能被全局类型注册表当作内置类型发现。因此本报告不虚报“整单产品闭环完成”；需主审扩白名单或另单处理该注册缺口。

## 任务点与关键改动

### 0. FB-014

- 【已验证】`MetaAgentService.ts:233-274` 在调用 `stopSession` 前记录真实活动子会话的打断意图；`MetaAgentService.ts:1114-1119` 收到 `interrupted` 后保持终态，并丢弃同一回合随后到达的伪 `completed`；`MetaAgentService.ts:350-365` 在新回合开始时清除标记。
- 【已验证】正常完成仍走 `completed`；四类事件原有隐藏通道未改变。证据：`MetaAgentService.childEventOrigin.test.ts:96-140`、`:142-175`。
- 【已验证】真实事件顺序测试位于 `MetaAgentService.workOrderPersistence.test.ts:406-439`：实际调用 `SessionStateManager.startSession → interruptSession → endSession`，最终 Head 只收到一次 `session:interrupted`，卡片保持 `interrupted`。

### 1. 新增 `work-order` YAML

- 【已验证】`packages/runtime/src/plugins/TrackerPlugin/models/builtins/work-order.yaml:1-77` 定义 `childSessionId`、`taskSummary`、`dispatchedAt`、可选 `interruptionReason`，以及首批六态 `dispatched / running / waiting / interrupted / completed / failed`。
- 【已验证】`MetaAgentService.workOrderSchema.test.ts:6-31` 通过真实 YAML 解析器校验字段、同步策略和精确状态顺序。

### 2. 派发即建卡

- 【已验证】`MetaAgentService.ts:726-733` 在子会话成功创建后、初始提示词入队前建卡，并将失败隔离为日志，不阻断派发。
- 【已验证】`MetaAgentService.ts:1585-1633` 写入 `work-order`、截断标题/提示词摘要、子会话 ID、派发时间及稳定 `source_ref`，随后调用既有 `createBidirectionalLink`。
- 【已验证】既有双向关联函数已导出，无需改动 `trackerToolHandlers.ts`；其双向写入位于 `trackerToolHandlers.ts:214-270`。
- 【已验证】真实存储断言位于 `MetaAgentService.workOrderPersistence.test.ts:147-188`：卡片含 `linkedSessions`，子会话 metadata 含 `linkedTrackerItemIds`；`:190-219` 验证建卡失败时子会话仍存在。

### 3. 状态联动

- 【已验证】`MetaAgentService.ts:1131-1146` 映射四类终态并隔离卡片存储失败，保证既有 Head 通知不被卡片故障截断；`:1635-1675` 按 `source_ref` 更新真实卡片，找不到卡时直接返回。
- 【已验证】Head 主动打断在 `MetaAgentService.ts:265-273` 写入 `Interrupted by Head Agent`；一般打断事件写入 `Session interrupted`。
- 【已验证】状态、原因、缺卡静默、晚到 `completed`、`running` 状态分别由 `MetaAgentService.workOrderPersistence.test.ts:221-320`、`:381-439` 覆盖。
- 【已验证】追加回归 `MetaAgentService.childEventOrigin.test.ts:177-217` 证明卡片状态库报错时，Head 仍收到原事件。

### 4. 回归

- 【已验证】plan-exit 建卡保持 `plan / in-review`：`MetaAgentService.workOrderPersistence.test.ts:322-360`。
- 【已验证】普通独立会话不生成 `work-order`、不通知 Head：`MetaAgentService.workOrderPersistence.test.ts:362-379`。
- 【已验证】相关测试及全部 `MetaAgentService*.test.ts` 均通过；未运行整个 monorepo 的全量测试，验证边界如实限定为本施工单相关服务回归和两包类型检查。

## FB-014 定因

- 【已验证】`AIService.ts:336-349`：取消成功后调用 `SessionStateManager.interruptSession`。
- 【已验证】`SessionStateManager.ts:247-262`：`interruptSession` 删除活动态并发布 `session:interrupted`。
- 【已验证】`MessageStreamingHandler.ts:2503-2504`：被 abort 的流仍可能进入完成收尾并调用 `endSession`。
- 【已验证】`SessionStateManager.ts:202-219`：此时活动态已被删除，`endSession` 的无活动态分支仍发布 `session:completed`。
- 【已验证】原 `MetaAgentService` 对两次事件均转发，所以 Head 先后看到 interrupted / completed，日志最终表现为 completed。修复点选择 Head 事件分类边界：保留真实 interrupted 终态并过滤同回合晚到 completed；未改 AIService、MessageStreamingHandler 或 runtime。

## 先红后绿

以下均为实现前或对应修正前先运行失败测试，再写生产代码。

| 测试点 | RED 原样关键输出 | GREEN |
|---|---|---|
| FB-014 | `expected "spy" to be called 1 times, but got 2 times`；`Tests 1 failed \| 4 passed`；退出码 1 | 单文件 5/5，后续最终集通过 |
| YAML | `ENOENT ... models/builtins/work-order.yaml`；`Tests 1 failed`；退出码 1 | schema 1/1 |
| 真实建卡 | `expected [] to have a length of 1 but got +0`；退出码 1 | 真实卡片与双向关联通过 |
| 建卡容错 | `Error: tracker storage unavailable`；`Tests 1 failed \| 1 skipped`；退出码 1 | 2/2 |
| 四态联动 | 4 项均为 `expected 'dispatched' to be ...`；`Tests 4 failed \| 2 skipped`；退出码 1 | 4/4 |
| 卡片故障不截断 Head 事件 | `handleChildSessionEvent failed ... tracker status unavailable`；`Tests 1 failed \| 5 passed`；退出码 1 | 6/6 |

首次从仓库根目录启动 Vitest 还遇到 `No test files found` 与 better-sqlite3 原生组件缺失；该次属于环境阻塞，不计作行为 RED。按施工单执行 `npm rebuild better-sqlite3` 与 extension-sdk build 后，在 electron 包目录取得上述行为 RED/GREEN。

环境前置原样输出：

```text
rebuilt dependencies successfully
EXIT_CODE=0

> @nimbalyst/extension-sdk@0.2.0 build
> node -e "fs.rmSync('dist',{recursive:true,force:true})" && tsc

EXIT_CODE=0
```

## 白名单与白名单外问题

- 【已验证】功能提交仅改 6 个白名单文件；追加修复仅改 2 个白名单文件。未改 extension-sdk、迁移、渲染层、prompt.ts；未推送、未合并、未碰 main。
- 【已验证】`AIService.ts`、`MessageStreamingHandler.ts` 无需修改；`createBidirectionalLink` 已是导出函数，`trackerToolHandlers.ts` 也无需修改。
- 【已验证｜白名单外】内置类型装载仍为硬编码：`ModelLoader.ts:8-9`；`loadBuiltinTrackers` 只遍历该数组：`ModelLoader.ts:382-392`。检索原样输出：

```text
packages/electron/src/main/services/TrackerSchemaService.ts:20:  loadBuiltinTrackers,
packages/electron/src/main/services/TrackerSchemaService.ts:60:    loadBuiltinTrackers();
packages/runtime/src/plugins/TrackerPlugin/models/ModelLoader.ts:9:const builtinTrackers: TrackerDataModel[] = [
packages/runtime/src/plugins/TrackerPlugin/models/ModelLoader.ts:382:export function loadBuiltinTrackers(): void {
packages/runtime/src/plugins/TrackerPlugin/models/ModelLoader.ts:427:    loadBuiltinTrackers();
packages/runtime/src/plugins/TrackerPlugin/models/builtins/work-order.yaml:1:type: work-order
```

- 【已验证｜既有警告】非静默测试会出现 Jotai `atomFamily` deprecation；真实 FB-014 测试还会出现 `endSession called for session not in activeSessions`，后者正是被复现的失败机理。两者均未导致测试失败，未越界处理。

## Git

分支：`feat/fb004-dispatch-tracker`

报告生成前执行 `git log --oneline main..HEAD` 的原样输出：

```text
77298edf1 fix: preserve child events on tracker failure
807a93fa5 feat: track dispatched child work orders
```

说明：本报告文件随后单独提交；提交哈希由报告内容决定，无法在报告自身提交前自指写入最终哈希。

## 验证原样输出

### 关 1：runtime 类型检查

命令：`npm run typecheck --workspace packages/runtime`

```text
> @nimbalyst/runtime@0.1.0 typecheck
> tsc --noEmit

EXIT_CODE=0
```

### 关 2：electron 类型检查

命令：`npm run typecheck --workspace packages/electron`

```text
> @nimbalyst/electron@0.65.4 typecheck
> tsc --noEmit

EXIT_CODE=0
```

### 关 3：MetaAgentService 全量回归

命令：`npx vitest run src/main/services/__tests__/MetaAgentService*.test.ts --silent`

```text
 RUN  v3.2.4 /Users/lukezhang/Desktop/Agent运行面板/.worktrees/worker-M/packages/electron

 ✓ src/main/services/__tests__/MetaAgentService.interruptSession.test.ts (6 tests) 6ms
 ✓ src/main/services/__tests__/MetaAgentService.childEventOrigin.test.ts (6 tests) 10ms
 ✓ src/main/services/__tests__/MetaAgentService.workOrderSchema.test.ts (1 test) 5ms
 ✓ src/main/services/__tests__/MetaAgentService.fullResponse.test.ts (3 tests) 5ms
 ✓ src/main/services/__tests__/MetaAgentService.workstreamSync.test.ts (3 tests) 6ms
 ✓ src/main/services/__tests__/MetaAgentService.cliPortWiring.test.ts (1 test) 3ms
 ✓ src/main/services/__tests__/MetaAgentService.parentPromotion.test.ts (1 test) 11ms
 ✓ src/main/services/__tests__/MetaAgentService.providerInheritance.test.ts (13 tests) 27ms
 ✓ src/main/services/__tests__/MetaAgentService.workOrderPersistence.test.ts (13 tests) 651ms

 Test Files  9 passed (9)
      Tests  47 passed (47)
   Start at  12:00:23
   Duration  7.01s (transform 4.26s, setup 612ms, collect 23.20s, tests 724ms, environment 2ms, prepare 1.35s)

EXIT_CODE=0
```

### 相关测试文件复核

命令：`npx vitest run src/main/services/__tests__/MetaAgentService.childEventOrigin.test.ts src/main/services/__tests__/MetaAgentService.interruptSession.test.ts src/main/services/__tests__/MetaAgentService.workOrderPersistence.test.ts src/main/services/__tests__/MetaAgentService.workOrderSchema.test.ts src/main/services/ai/__tests__/AIService.stopSession.test.ts src/main/services/ai/__tests__/childSessionEventChannel.test.ts --silent`

```text
 RUN  v3.2.4 /Users/lukezhang/Desktop/Agent运行面板/.worktrees/worker-M/packages/electron

 ✓ src/main/services/__tests__/MetaAgentService.childEventOrigin.test.ts (6 tests) 5ms
 ✓ src/main/services/__tests__/MetaAgentService.interruptSession.test.ts (6 tests) 7ms
 ✓ src/main/services/__tests__/MetaAgentService.workOrderSchema.test.ts (1 test) 9ms
 ✓ src/main/services/ai/__tests__/childSessionEventChannel.test.ts (6 tests) 208ms
 ✓ src/main/services/ai/__tests__/AIService.stopSession.test.ts (1 test) 742ms
   ✓ AIService.stopSession > interrupts the active turn, pauses queued work, and returns the persisted result  741ms
 ✓ src/main/services/__tests__/MetaAgentService.workOrderPersistence.test.ts (13 tests) 383ms

 Test Files  6 passed (6)
      Tests  33 passed (33)
   Start at  12:01:06
   Duration  5.29s (transform 4.42s, setup 194ms, collect 9.25s, tests 1.35s, environment 1ms, prepare 542ms)

EXIT_CODE=0
```
