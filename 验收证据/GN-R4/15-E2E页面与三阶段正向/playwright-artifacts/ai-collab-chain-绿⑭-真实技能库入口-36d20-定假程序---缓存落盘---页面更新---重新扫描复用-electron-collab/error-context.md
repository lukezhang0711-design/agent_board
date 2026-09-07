# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai/collab-chain.spec.ts >> 绿⑭: 真实技能库入口 -> 可见项 -> 未替换页面通信 -> 指定假程序 -> 缓存落盘 -> 页面更新 -> 重新扫描复用
- Location: e2e/ai/collab-chain.spec.ts:1417:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('[data-testid="skill-card-e2e-live-skill-mtrbosl6"]')
Expected substring: "检查与分析项目依赖关系"
Received string:    "e2e-live-skill-mtrbosl6启用Claude ✓Codex ✗Gemini ✗[未翻译] Inspect and manage project dependencies and modules.约 15 token (估算)展开说明项目 · 项目·未加入包"
Timeout: 20000ms

Call log:
  - Expect "toContainText" with timeout 20000ms
  - waiting for locator('[data-testid="skill-card-e2e-live-skill-mtrbosl6"]')
    23 × locator resolved to <div data-testid="skill-card-e2e-live-skill-mtrbosl6" class="flex flex-col justify-between gap-3 rounded-ui-lg border p-3 transition-all duration-150 bg-[var(--nim-bg)] border-[var(--nim-border)] hover:border-[var(--nim-border-strong)] shadow-xs">…</div>
       - unexpected value "e2e-live-skill-mtrbosl6启用Claude ✓Codex ✗Gemini ✗[未翻译] Inspect and manage project dependencies and modules.约 15 token (估算)展开说明项目 · 项目·未加入包"

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation "Open projects" [ref=e4]:
    - button "Switch to project nimbalyst-test-WKIOXd" [ref=e6] [cursor=pointer]: NT
    - button "Add project to rail" [ref=e8] [cursor=pointer]: +
  - generic [ref=e9]:
    - button "Files (⌘E)" [ref=e11] [cursor=pointer]:
      - generic [ref=e12]: account_tree
    - button "code" [ref=e14] [cursor=pointer]:
      - generic [ref=e15]: code
    - button "Tracker · 工作区全部事项 (⌘T)" [ref=e17] [cursor=pointer]:
      - generic [ref=e18]: assignment
    - 'button "Terminal (Ctrl+`)" [ref=e22] [cursor=pointer]':
      - generic [ref=e23]: terminal
    - generic [ref=e24]:
      - generic [ref=e25]:
        - button "AI 用量" [ref=e28] [cursor=pointer]:
          - generic [ref=e29]: speed
        - button "No active background tasks" [ref=e31] [cursor=pointer]:
          - generic [ref=e32]: check_circle
        - button "Allow Edits mode" [ref=e35] [cursor=pointer]:
          - generic [ref=e36]: shield
        - button "技能库" [ref=e38] [cursor=pointer]:
          - generic [ref=e39]: school
      - generic [ref=e41]:
        - button "Change theme" [ref=e44] [cursor=pointer]:
          - generic [ref=e45]: palette
        - button "Send Feedback" [ref=e46] [cursor=pointer]:
          - generic [ref=e47]: feedback
        - button "User menu" [ref=e49] [cursor=pointer]:
          - generic [ref=e50]: person
  - generic [ref=e55]:
    - banner [ref=e56]:
      - heading "Settings" [level=1] [ref=e57]
      - generic [ref=e58]:
        - generic [ref=e59]:
          - button "User" [ref=e60] [cursor=pointer]
          - button "Project" [ref=e61] [cursor=pointer]
        - generic [ref=e62]: These settings apply to all projects
    - generic [ref=e63]:
      - generic [ref=e65]:
        - generic [ref=e66]:
          - generic [ref=e67]: Application
          - generic [ref=e68] [cursor=pointer]:
            - generic [ref=e70]: account_circle
            - generic [ref=e71]: Account & Sync
          - generic [ref=e72] [cursor=pointer]:
            - generic [ref=e74]: link
            - generic [ref=e75]: Shared Links
          - generic [ref=e76] [cursor=pointer]:
            - generic [ref=e78]: notifications
            - generic [ref=e79]: Notifications
          - generic [ref=e80] [cursor=pointer]:
            - generic [ref=e82]: palette
            - generic [ref=e83]: Themes
          - generic [ref=e84] [cursor=pointer]:
            - generic [ref=e86]: settings
            - generic [ref=e87]: Advanced
          - generic [ref=e88] [cursor=pointer]:
            - generic [ref=e90]: database
            - generic [ref=e91]: Database
            - generic "Alpha feature" [ref=e92]: alpha
          - generic [ref=e93] [cursor=pointer]:
            - generic [ref=e95]: mic
            - generic [ref=e96]: Voice Mode
            - generic "Alpha feature" [ref=e97]: alpha
          - generic [ref=e98] [cursor=pointer]:
            - generic [ref=e100]: science
            - generic [ref=e101]: Agent Features
            - generic "Alpha feature" [ref=e102]: alpha
          - generic [ref=e103] [cursor=pointer]:
            - generic [ref=e105]: school
            - generic [ref=e106]: 技能库
        - generic [ref=e107]:
          - generic [ref=e108]:
            - text: Agent Providers
            - generic [ref=e110]: info
          - generic [ref=e111] [cursor=pointer]:
            - generic [ref=e113]: health_and_safety
            - generic [ref=e114]: 通道体检
          - generic [ref=e115] [cursor=pointer]:
            - img [ref=e117]
            - generic [ref=e119]: Claude Agent
          - generic [ref=e120] [cursor=pointer]:
            - img [ref=e122]
            - generic [ref=e124]: OpenAI Codex
          - generic [ref=e125] [cursor=pointer]:
            - img [ref=e127]
            - generic [ref=e129]: OpenCode
            - generic "Alpha feature" [ref=e130]: alpha
          - generic [ref=e131] [cursor=pointer]:
            - generic [ref=e133]: terminal
            - generic [ref=e134]: GitHub Copilot
            - generic "Alpha feature" [ref=e135]: alpha
          - generic [ref=e136] [cursor=pointer]:
            - img [ref=e138]
            - generic [ref=e140]: Gemini
            - generic "Alpha feature" [ref=e141]: alpha
        - generic [ref=e142]:
          - generic [ref=e143]:
            - text: Chat Providers
            - generic [ref=e145]: info
          - generic [ref=e146] [cursor=pointer]:
            - img [ref=e148]
            - generic [ref=e150]: Claude Chat
          - generic [ref=e151] [cursor=pointer]:
            - img [ref=e153]
            - generic [ref=e155]: OpenAI
          - generic [ref=e156] [cursor=pointer]:
            - img [ref=e158]
            - generic [ref=e161]: LM Studio
          - generic [ref=e162] [cursor=pointer]:
            - img [ref=e164]
            - generic [ref=e166]: Gemini
            - generic "Alpha feature" [ref=e167]: alpha
        - generic [ref=e168]:
          - generic [ref=e169]: GitHub
          - generic [ref=e170] [cursor=pointer]:
            - generic [ref=e172]: merge
            - generic [ref=e173]: GitHub Account
        - generic [ref=e174]:
          - generic [ref=e175]: Extensions
          - generic [ref=e176] [cursor=pointer]:
            - generic [ref=e178]: storefront
            - generic [ref=e179]: Marketplace
          - generic [ref=e180] [cursor=pointer]:
            - generic [ref=e182]: extension
            - generic [ref=e183]: Installed
          - generic [ref=e184] [cursor=pointer]:
            - generic [ref=e186]: shield_lock
            - generic [ref=e187]: Privileged Capabilities
          - generic [ref=e188] [cursor=pointer]:
            - generic [ref=e190]: widgets
            - generic [ref=e191]: Claude Plugins
          - generic [ref=e192] [cursor=pointer]:
            - generic [ref=e194]: dns
            - generic [ref=e195]: MCP Servers
      - main [ref=e196]:
        - generic [ref=e198]:
          - generic [ref=e199]:
            - generic [ref=e200]:
              - generic [ref=e202]: extension
              - generic [ref=e203]:
                - heading "技能库" [level=2] [ref=e204]
                - generic [ref=e205]: "149"
              - generic [ref=e206]: 约 1.4 万 token
            - button "add 新建技能包" [ref=e208] [cursor=pointer]:
              - generic [ref=e209]: add
              - generic [ref=e210]: 新建技能包
          - generic [ref=e211]:
            - generic [ref=e212]:
              - generic [ref=e213]: warning
              - generic [ref=e214]: 扫描发现异常：
            - generic [ref=e215]: "codex skills list 跑不通: error: unexpected argument 'list' found Usage: codex [OPTIONS] [PROMPT] codex [OPTIONS] <COMMAND> [ARGS] For more information, try '--help'."
            - generic [ref=e216]: "codex skills list 跑不通: error: unexpected argument 'list' found Usage: codex [OPTIONS] [PROMPT] codex [OPTIONS] <COMMAND> [ARGS] For more information, try '--help'."
          - generic [ref=e217]:
            - generic [ref=e218]: info
            - generic [ref=e219]: Codex：技能管控只能会话级禁用、无逐次审批。
          - generic [ref=e221]:
            - generic [ref=e222]: 暂无技能包
            - generic [ref=e223]: 选中几个技能，存成一个包
            - button "+ 新建" [ref=e225] [cursor=pointer]
          - generic [ref=e226]:
            - generic [ref=e227]:
              - generic: search
              - textbox "搜索技能名称或说明..." [active] [ref=e228]: e2e-live-skill-mtrbosl6
              - button "清空" [ref=e229] [cursor=pointer]
            - generic [ref=e230]:
              - generic [ref=e231]: 找到 1 个技能
              - button "把这 1 个存成技能包" [ref=e232] [cursor=pointer]
          - generic [ref=e234]:
            - generic [ref=e235]:
              - generic [ref=e236]:
                - generic [ref=e237]: 工具环境
                - generic [ref=e238]: "1"
              - generic [ref=e239]: 约 15 token
            - generic [ref=e241]:
              - generic [ref=e242]:
                - generic [ref=e243]:
                  - generic [ref=e244]: e2e-live-skill-mtrbosl6
                  - generic [ref=e245] [cursor=pointer]:
                    - text: 启用
                    - checkbox "启用" [checked] [ref=e246]
                - generic [ref=e247]:
                  - generic [ref=e248]: Claude ✓
                  - generic [ref=e249]: Codex ✗
                  - generic [ref=e250]: Gemini ✗
                - generic [ref=e252]: "[未翻译] Inspect and manage project dependencies and modules."
              - generic [ref=e253]:
                - generic [ref=e254]:
                  - generic [ref=e255]: 约 15 token (估算)
                  - button "展开说明" [ref=e256] [cursor=pointer]
                - generic [ref=e257]:
                  - generic [ref=e258]: 项目 · 项目
                  - generic [ref=e259]: ·
                  - generic [ref=e260]: 未加入包
```

# Test source

```ts
  1371 |     risks: 'The original tool call is deliberately aborted before approval.',
  1372 |   }, abortController.signal);
  1373 |   abortController.abort();
  1374 |   expect(abortController.signal.aborted).toBe(true);
  1375 |   const abortedToolCall = codexRevision.completion.then(() => 'completed', () => 'aborted');
  1376 | 
  1377 |   const codexRevisionCompositeId = `nimtc|${codexRevision.requestId}|1784297999209|21432`;
  1378 |   await resetRendererEvents(page);
  1379 |   await expect(
  1380 |     invokeElectron<{ success: boolean }>(
  1381 |       page,
  1382 |       'ai:exitPlanModeConfirmResponse',
  1383 |       codexRevisionCompositeId,
  1384 |       codexVariantHead,
  1385 |       { approved: true },
  1386 |     ),
  1387 |   ).resolves.toMatchObject({ success: true });
  1388 |   await assertApprovalLifecycle(codexVariantHead, codexRevision.requestId, {
  1389 |     decision: 'approved',
  1390 |     method: 'revive',
  1391 |   });
  1392 |   expect(['aborted', 'completed']).toContain(await abortedToolCall);
  1393 |   const codexRevivedState = await getPlanApprovalState(codexVariantHead, codexRevisionCompositeId);
  1394 |   expect(codexRevivedState).toMatchObject({
  1395 |     requestId: codexRevision.requestId,
  1396 |     status: 'closed',
  1397 |     decision: 'approved',
  1398 |     deliveryMethod: 'revive',
  1399 |   });
  1400 |   await scriptedProvider.waitForPrompt(`[Plan approval response]`);
  1401 |   await expect.poll(async () => {
  1402 |     const rows = await queryDb<{ content: unknown }>(
  1403 |       page,
  1404 |       `SELECT content
  1405 |          FROM ai_agent_messages
  1406 |         WHERE session_id = $1 AND content = $2`,
  1407 |       [codexVariantHead, SCRIPTED_REVIVE_SUMMARY],
  1408 |     );
  1409 |     return rows.length;
  1410 |   }, { timeout: 15_000 }).toBeGreaterThan(0);
  1411 |   await expect.poll(
  1412 |     async () => (await getRendererEvents(page, codexVariantHead)).length,
  1413 |     { timeout: 10_000 },
  1414 |   ).toBeGreaterThan(0);
  1415 | });
  1416 | 
  1417 | test('绿⑭: 真实技能库入口 -> 可见项 -> 未替换页面通信 -> 指定假程序 -> 缓存落盘 -> 页面更新 -> 重新扫描复用', async () => {
  1418 |   const skillName = `e2e-live-skill-${Date.now().toString(36)}`;
  1419 |   // 1. 创建本地工作区技能文件
  1420 |   const e2eSkillDir = path.join(workspacePath, '.claude', 'skills', skillName);
  1421 |   await fs.mkdir(e2eSkillDir, { recursive: true });
  1422 |   await fs.writeFile(
  1423 |     path.join(e2eSkillDir, 'SKILL.md'),
  1424 |     `---
  1425 | name: ${skillName}
  1426 | description: Inspect and manage project dependencies and modules.
  1427 | ---
  1428 | # Live E2E Skill Content Initial
  1429 | `,
  1430 |     'utf8',
  1431 |   );
  1432 | 
  1433 |   const scanned = await invokeElectron<{ skills: SkillInput[] }>(page, 'dispatch-skills:list', workspacePath);
  1434 |   const initialSkill = scanned.skills.find(skill => skill.name === skillName)!;
  1435 |   expect(initialSkill).toBeDefined();
  1436 |   expect((await engineEvents()).filter(event => event.event === 'START' && event.description === initialSkill.description)).toHaveLength(0);
  1437 |   const versions = [initialSkill];
  1438 |   async function verifyPageCache(label: string, skill: SkillInput, summaryZh: string, expectedStarts: number) {
  1439 |     const hash = skillHash(skill);
  1440 |     await expect.poll(async () => {
  1441 |       const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  1442 |       return cache.entries[hash];
  1443 |     }, { timeout: 10_000 }).toMatchObject({ hash, name: skillName, description: skill.description, summaryZh, enrichmentFailed: false });
  1444 |     const starts = (await engineEvents()).filter(event => event.event === 'START' && versions.some(version => version.description === event.description));
  1445 |     const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  1446 |     lifecycleEvidence.pageChecks.push({ label, skill, hash, expectedStarts, actualStarts: starts.length, starts, cacheEntry: cache.entries[hash] });
  1447 |     await saveLifecycle();
  1448 |     expect(starts).toHaveLength(expectedStarts);
  1449 |   }
  1450 | 
  1451 |   // 2. 点击左侧导航栏的技能库图标直接进入技能库设置页
  1452 |   const skillLibraryButton = page.locator('[data-testid="gutter-skill-library-button"]');
  1453 |   await expect(skillLibraryButton).toBeVisible({ timeout: 10_000 });
  1454 |   await skillLibraryButton.click();
  1455 | 
  1456 |   const skillPanel = page.locator('.skill-library-panel');
  1457 |   await expect(skillPanel).toBeVisible({ timeout: 10_000 });
  1458 | 
  1459 |   // 3. 搜索技能名称使其卡片在视口中可见并展开
  1460 |   const searchInput = page.getByPlaceholder('搜索技能名称或说明...');
  1461 |   await expect(searchInput).toBeVisible({ timeout: 10_000 });
  1462 |   await searchInput.fill(skillName);
  1463 | 
  1464 |   const card = page.locator(`[data-testid="skill-card-${skillName}"]`);
  1465 |   await expect(card).toBeVisible({ timeout: 10_000 });
  1466 | 
  1467 |   await expect(card).toContainText(initialSkill.description);
  1468 |   await expect(searchInput).toBeEnabled();
  1469 | 
  1470 |   // 4. 真实页面通信调用假引擎生成中文说明，等待落盘并在页面上更新
> 1471 |   await expect(card).toContainText('检查与分析项目依赖关系', { timeout: 20_000 });
       |                      ^ Error: expect(locator).toContainText(expected) failed
  1472 |   await expect(card).not.toContainText('[未翻译]');
  1473 | 
  1474 |   // 5. 通过 Electron 测试对象取得隔离 userData，按 name + hash 核缓存。
  1475 |   await verifyPageCache('首次生成', initialSkill, '检查与分析项目依赖关系', 1);
  1476 | 
  1477 |   // 6. 实际离开页面再重新打开技能库（验证成功缓存直接复用，不重复生成）
  1478 |   await switchToAgentMode(page);
  1479 |   await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode)).toBeVisible({ timeout: 10_000 });
  1480 | 
  1481 |   await skillLibraryButton.click();
  1482 |   await expect(skillPanel).toBeVisible({ timeout: 10_000 });
  1483 |   await searchInput.fill(skillName);
  1484 |   await expect(card).toBeVisible({ timeout: 10_000 });
  1485 |   await expect(card).toContainText('检查与分析项目依赖关系');
  1486 |   await expect(card).not.toContainText('[未翻译]');
  1487 | 
  1488 |   await page.waitForTimeout(1000);
  1489 |   await verifyPageCache('离开重开', initialSkill, '检查与分析项目依赖关系', 1);
  1490 | 
  1491 |   // 7. 同名正文更新：离开页面后更新 SKILL.md 的内容（正文和描述变化）
  1492 |   await switchToAgentMode(page);
  1493 |   await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode)).toBeVisible({ timeout: 10_000 });
  1494 | 
  1495 |   await fs.writeFile(
  1496 |     path.join(e2eSkillDir, 'SKILL.md'),
  1497 |     `---
  1498 | name: ${skillName}
  1499 | description: Audit security rules and protect file changes.
  1500 | ---
  1501 | # Live E2E Skill Content Updated: Audit security rules and protect file changes
  1502 | `,
  1503 |     'utf8',
  1504 |   );
  1505 | 
  1506 |   const rescanned = await invokeElectron<{ skills: SkillInput[] }>(page, 'dispatch-skills:list', workspacePath);
  1507 |   const updatedSkill = rescanned.skills.find(skill => skill.name === skillName)!;
  1508 |   expect(updatedSkill).toBeDefined();
  1509 |   expect(skillHash(updatedSkill)).not.toBe(skillHash(initialSkill));
  1510 |   versions.push(updatedSkill);
  1511 | 
  1512 |   // 8. 重新打开技能库，验证同名新内容触发重新生成并更新页面与磁盘缓存
  1513 |   await skillLibraryButton.click();
  1514 |   await expect(skillPanel).toBeVisible({ timeout: 10_000 });
  1515 |   await searchInput.fill(skillName);
  1516 |   await expect(card).toBeVisible({ timeout: 10_000 });
  1517 | 
  1518 |   // 等待新内容生成完成并在页面更新显示
  1519 |   await expect(card).toContainText('审计安全规则并保护改动', { timeout: 20_000 });
  1520 |   await expect(card).not.toContainText('[未翻译]');
  1521 | 
  1522 |   await verifyPageCache('同名内容更新', updatedSkill, '审计安全规则并保护改动', 2);
  1523 |   const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  1524 |   expect(cache.entries[skillHash(initialSkill)]).toMatchObject({ name: skillName, summaryZh: '检查与分析项目依赖关系', enrichmentFailed: false });
  1525 | 
  1526 |   // 9. 返回 Agent 模式保证后续测试隔离
  1527 |   await switchToAgentMode(page);
  1528 |   await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode)).toBeVisible({ timeout: 10_000 });
  1529 | });
  1530 | 
  1531 | test('绿⑮: 技能生成占满允许并发时仍能跑通 collab-chain 协作链路（3 并发技能生成负载）', async () => {
  1532 |   // 1. 设置页面可见性为 true，使得按需生成接受请求
  1533 |   await invokeElectron(page, 'dispatch-skills:set-page-visibility', true);
  1534 |   const runTag = Date.now().toString(36);
  1535 | 
  1536 |   // 阶段 1：方案渲染与批准阶段的 3 并发技能生成负载
  1537 |   const loadSkills = [
  1538 |     {
  1539 |       name: `r4-skill-1-${runTag}`,
  1540 |       description: 'Inspect project dependencies and analyze modules.',
  1541 |     },
  1542 |     {
  1543 |       name: `r4-skill-2-${runTag}`,
  1544 |       description: 'Audit security rules and protect file changes.',
  1545 |     },
  1546 |     {
  1547 |       name: `r4-skill-3-${runTag}`,
  1548 |       description: 'Review codebase architecture and visual layout.',
  1549 |     },
  1550 |   ].map(skill => ({ ...skill, description: `${skill.description}\nGN-R4-LOAD ${skill.name}` }));
  1551 | 
  1552 |   const skillGenerationPromises = loadSkills.map((s) =>
  1553 |     invokeElectron<{ success: boolean; summaryZh?: string; enrichmentFailed?: boolean }>(
  1554 |       page,
  1555 |       'dispatch-skills:generate-summary',
  1556 |       s,
  1557 |     ),
  1558 |   );
  1559 | 
  1560 |   // 必须先等实际在跑且真实存活的假生成进程数确实达到 3，验证真实在飞并发负载已形成
  1561 |   await expect.poll(async () => countRunningEngineProcesses(), { timeout: 10_000 }).toBe(3);
  1562 |   const phase1LiveProcs = await getLiveEngineProcessInfo();
  1563 |   const phase1 = await capturePhase(1, loadSkills, phase1LiveProcs);
  1564 |   await assertNodeLoad(phase1, 'start');
  1565 | 
  1566 |   // 3. 在 3 并发技能生成负载持续期间，完整跑通协作主链核心环节：
  1567 |   //    创建总指挥 Session -> 建立 MCP Client -> 提交协作方案 -> 等待方案卡片展示 -> 点击批准 -> 验证审批生命周期与数据库持久化
  1568 |   const loadHeadSessionId = await createMetaAgentSession('Concurrent skill load Head');
  1569 |   const client = await createMetaAgentClient(loadHeadSessionId);
  1570 |   const submittedRequestIds = new Set<string>();
  1571 | 
```