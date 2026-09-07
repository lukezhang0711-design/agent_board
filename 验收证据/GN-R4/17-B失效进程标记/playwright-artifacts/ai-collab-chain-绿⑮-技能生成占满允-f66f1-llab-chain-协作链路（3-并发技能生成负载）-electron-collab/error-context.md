# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai/collab-chain.spec.ts >> 绿⑮: 技能生成占满允许并发时仍能跑通 collab-chain 协作链路（3 并发技能生成负载）
- Location: e2e/ai/collab-chain.spec.ts:1537:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 3
Received: 0

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation "Open projects" [ref=e4]:
    - button "Switch to project nimbalyst-test-b5PVit" [ref=e6] [cursor=pointer]: NT
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
  - generic [ref=e56]:
    - generic [ref=e58]:
      - generic [ref=e60]:
        - generic [ref=e61]:
          - heading "nimbalyst-test-b5PVit" [level=3] [ref=e63]
          - generic [ref=e64]:
            - button "Switch to kanban view (本次派发相关)" [ref=e65] [cursor=pointer]:
              - img [ref=e66]
              - text: Kanban
            - button "Search sessions" [ref=e70] [cursor=pointer]:
              - img [ref=e71]
            - button "Create new session, worktree, or terminal" [ref=e75] [cursor=pointer]:
              - img [ref=e76]
        - generic "/var/folders/st/r866ph290_35q34xmk31xmzm0000gn/T/nimbalyst-test-b5PVit" [ref=e78]
      - generic [ref=e79]: Agent Sessions
      - textbox "Search sessions or filter by tag" [ref=e81]:
        - /placeholder: "Search or type # to filter by tag..."
      - generic [ref=e82]:
        - button "Show archived sessions" [ref=e83] [cursor=pointer]:
          - img [ref=e84]
        - generic "1 non-archived session in this workspace (matches the iOS project list count)" [ref=e86]: 1 session
        - button "Sort sessions" [ref=e88] [cursor=pointer]:
          - img [ref=e89]
      - generic [ref=e94]:
        - button "Today group, expanded" [expanded] [ref=e97] [cursor=pointer]:
          - generic [ref=e98]: chevron_right
          - generic [ref=e99]: Today
          - generic [ref=e100]: "1"
        - 'button "Session: New Session, updated Just now" [ref=e102] [cursor=pointer]':
          - img [ref=e104]
          - generic [ref=e106]:
            - generic "New Session" [ref=e107]
            - generic [ref=e108]:
              - generic "2026年9月7日 GMT+8 下午10:26" [ref=e109]: Just now
              - generic [ref=e110]: default
    - separator "Resize session history panel" [ref=e111]
    - generic [ref=e113]:
      - generic [ref=e114]:
        - generic [ref=e116]:
          - img [ref=e118]
          - generic:
            - heading "New Session" [level=2] [ref=e120] [cursor=pointer]
            - button "add" [ref=e121] [cursor=pointer]:
              - generic [ref=e122]: add
          - generic [ref=e123]:
            - button "Maximize editor" [disabled] [ref=e124]:
              - generic [ref=e125]: Files
              - img [ref=e126]
            - button "Split view" [disabled] [ref=e128]:
              - img [ref=e129]
            - button "Maximize transcript" [ref=e131] [cursor=pointer]:
              - img [ref=e132]
              - generic [ref=e134]: Agent
          - button "archive Archive Session" [ref=e135] [cursor=pointer]:
            - generic [ref=e136]: archive
            - generic [ref=e137]: Archive Session
          - button "dock_to_right" [ref=e138] [cursor=pointer]:
            - generic [ref=e139]: dock_to_right
        - generic [ref=e142]:
          - generic [ref=e143]:
            - button "New Session" [ref=e145] [cursor=pointer]:
              - img [ref=e146]
              - generic [ref=e148]: New Session
            - button "add" [ref=e149] [cursor=pointer]:
              - generic [ref=e150]: add
          - generic [ref=e153]:
            - generic [ref=e156]:
              - generic [ref=e158]:
                - generic [ref=e162]:
                  - generic [ref=e163]: "Try a command:"
                  - generic [ref=e164]:
                    - button "/ planning:launch-new-session" [ref=e166] [cursor=pointer]:
                      - generic [ref=e167]: /
                      - generic [ref=e168]: planning:launch-new-session
                    - button "/ planning:implement" [ref=e170] [cursor=pointer]:
                      - generic [ref=e171]: /
                      - generic [ref=e172]: planning:implement
                    - button "/ feedback:bug-report" [ref=e174] [cursor=pointer]:
                      - generic [ref=e175]: /
                      - generic [ref=e176]: feedback:bug-report
                    - button "+8" [ref=e177] [cursor=pointer]:
                      - generic [ref=e178]: "+8"
                - button "arrow_downward" [ref=e180] [cursor=pointer]:
                  - generic [ref=e181]: arrow_downward
              - generic:
                - button "Set phase" [ref=e182] [cursor=pointer]:
                  - generic [ref=e183]: view_kanban
                  - generic [ref=e184]: Phase
                - button "Prompts Menu" [ref=e185] [cursor=pointer]
            - generic [ref=e187]:
              - generic "Drag to resize prompt box" [ref=e188]
              - generic [ref=e189]:
                - 'button "Agent mode: Full tool access (click to switch to plan mode)" [ref=e190] [cursor=pointer]': Agent
                - 'button "Current model: Default (recommended)" [ref=e193] [cursor=pointer]':
                  - generic [ref=e194]: Default (recommended)
                  - generic [ref=e195]: expand_more
                - 'button "Effort level: Low" [ref=e197] [cursor=pointer]':
                  - generic [ref=e198]: psychology
                  - generic [ref=e199]: Low
                  - generic [ref=e200]: expand_more
                - button "Actions (0)" [ref=e202] [cursor=pointer]:
                  - generic [ref=e203]: bolt
                  - generic [ref=e204]: Actions
                  - generic [ref=e205]: expand_more
                - group "Token usage data not available yet" [ref=e206]:
                  - generic [ref=e207]: "--"
              - generic [ref=e208]:
                - textbox "Type your message... (Enter to send, Shift+Enter for new line, @ for files, @@ for sessions, / for commands)" [active] [ref=e209]
                - button "Send message" [disabled] [ref=e210]:
                  - img [ref=e211]
      - generic [ref=e214]:
        - generic [ref=e215]:
          - button "description All Session Edits expand_more in this Session" [ref=e217] [cursor=pointer]:
            - generic [ref=e218]:
              - generic [ref=e219]: description
              - generic [ref=e220]: All Session Edits
              - generic [ref=e221]: expand_more
            - generic [ref=e222]: in this Session
          - generic [ref=e223]:
            - button "unfold_more" [ref=e224] [cursor=pointer]:
              - generic [ref=e225]: unfold_more
            - button "unfold_less" [ref=e226] [cursor=pointer]:
              - generic [ref=e227]: unfold_less
        - generic [ref=e232]:
          - generic [ref=e233]: No files edited in this session
          - button "Show all uncommitted files (3095)" [ref=e234] [cursor=pointer]
        - generic [ref=e235]:
          - generic [ref=e237] [cursor=pointer]:
            - generic [ref=e238]: expand_more
            - generic [ref=e239]: account_tree
            - generic [ref=e240]: main
          - generic [ref=e241]:
            - generic [ref=e242]:
              - generic [ref=e243]:
                - generic [ref=e244]: Commit
                - generic [ref=e245]:
                  - button "Manual commit message" [ref=e246] [cursor=pointer]: Manual
                  - button "AI-assisted commit" [ref=e247] [cursor=pointer]: Smart
              - generic [ref=e248]:
                - paragraph [ref=e249]: Let AI analyze your changes and propose a commit message.
                - button "auto_awesome Commit with AI" [ref=e250] [cursor=pointer]:
                  - generic [ref=e251]: auto_awesome
                  - text: Commit with AI
            - button "Show Recent Commits" [ref=e253] [cursor=pointer]
```

# Test source

```ts
  1467 |   await expect(card).toBeInViewport();
  1468 | 
  1469 |   await expect(card).toContainText(initialSkill.description);
  1470 |   await expect(searchInput).toBeEnabled();
  1471 | 
  1472 |   // 4. 真实页面通信调用假引擎生成中文说明，等待落盘并在页面上更新
  1473 |   await expect(card).toContainText('检查与分析项目依赖关系', { timeout: 20_000 });
  1474 |   await expect(card).not.toContainText('[未翻译]');
  1475 | 
  1476 |   // 5. 通过 Electron 测试对象取得隔离 userData，按 name + hash 核缓存。
  1477 |   await verifyPageCache('首次生成', initialSkill, '检查与分析项目依赖关系', 1);
  1478 | 
  1479 |   // 6. 实际离开页面再重新打开技能库（验证成功缓存直接复用，不重复生成）
  1480 |   await switchToAgentMode(page);
  1481 |   await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode)).toBeVisible({ timeout: 10_000 });
  1482 | 
  1483 |   await skillLibraryButton.click();
  1484 |   await expect(skillPanel).toBeVisible({ timeout: 10_000 });
  1485 |   await searchInput.fill(skillName);
  1486 |   await expect(card).toBeVisible({ timeout: 10_000 });
  1487 |   await card.scrollIntoViewIfNeeded();
  1488 |   await expect(card).toBeInViewport();
  1489 |   await expect(card).toContainText('检查与分析项目依赖关系');
  1490 |   await expect(card).not.toContainText('[未翻译]');
  1491 | 
  1492 |   await page.waitForTimeout(1000);
  1493 |   await verifyPageCache('离开重开', initialSkill, '检查与分析项目依赖关系', 1);
  1494 | 
  1495 |   // 7. 同名正文更新：离开页面后更新 SKILL.md 的内容（正文和描述变化）
  1496 |   await switchToAgentMode(page);
  1497 |   await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode)).toBeVisible({ timeout: 10_000 });
  1498 | 
  1499 |   await fs.writeFile(
  1500 |     path.join(e2eSkillDir, 'SKILL.md'),
  1501 |     `---
  1502 | name: ${skillName}
  1503 | description: Audit security rules and protect file changes.
  1504 | ---
  1505 | # Live E2E Skill Content Updated: Audit security rules and protect file changes
  1506 | `,
  1507 |     'utf8',
  1508 |   );
  1509 | 
  1510 |   const rescanned = await invokeElectron<{ skills: SkillInput[] }>(page, 'dispatch-skills:list', workspacePath);
  1511 |   const updatedSkill = rescanned.skills.find(skill => skill.name === skillName)!;
  1512 |   expect(updatedSkill).toBeDefined();
  1513 |   expect(skillHash(updatedSkill)).not.toBe(skillHash(initialSkill));
  1514 |   versions.push(updatedSkill);
  1515 | 
  1516 |   // 8. 重新打开技能库，验证同名新内容触发重新生成并更新页面与磁盘缓存
  1517 |   await skillLibraryButton.click();
  1518 |   await expect(skillPanel).toBeVisible({ timeout: 10_000 });
  1519 |   await searchInput.fill(skillName);
  1520 |   await expect(card).toBeVisible({ timeout: 10_000 });
  1521 |   await card.scrollIntoViewIfNeeded();
  1522 |   await expect(card).toBeInViewport();
  1523 | 
  1524 |   // 等待新内容生成完成并在页面更新显示
  1525 |   await expect(card).toContainText('审计安全规则并保护改动', { timeout: 20_000 });
  1526 |   await expect(card).not.toContainText('[未翻译]');
  1527 | 
  1528 |   await verifyPageCache('同名内容更新', updatedSkill, '审计安全规则并保护改动', 2);
  1529 |   const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  1530 |   expect(cache.entries[skillHash(initialSkill)]).toMatchObject({ name: skillName, summaryZh: '检查与分析项目依赖关系', enrichmentFailed: false });
  1531 | 
  1532 |   // 9. 返回 Agent 模式保证后续测试隔离
  1533 |   await switchToAgentMode(page);
  1534 |   await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode)).toBeVisible({ timeout: 10_000 });
  1535 | });
  1536 | 
  1537 | test('绿⑮: 技能生成占满允许并发时仍能跑通 collab-chain 协作链路（3 并发技能生成负载）', async () => {
  1538 |   // 1. 设置页面可见性为 true，使得按需生成接受请求
  1539 |   await invokeElectron(page, 'dispatch-skills:set-page-visibility', true);
  1540 |   const runTag = Date.now().toString(36);
  1541 | 
  1542 |   // 阶段 1：方案渲染与批准阶段的 3 并发技能生成负载
  1543 |   const loadSkills = [
  1544 |     {
  1545 |       name: `r4-skill-1-${runTag}`,
  1546 |       description: 'Inspect project dependencies and analyze modules.',
  1547 |     },
  1548 |     {
  1549 |       name: `r4-skill-2-${runTag}`,
  1550 |       description: 'Audit security rules and protect file changes.',
  1551 |     },
  1552 |     {
  1553 |       name: `r4-skill-3-${runTag}`,
  1554 |       description: 'Review codebase architecture and visual layout.',
  1555 |     },
  1556 |   ].map(skill => ({ ...skill, description: `${skill.description}\nGN-R4-LOAD ${skill.name}` }));
  1557 | 
  1558 |   const skillGenerationPromises = loadSkills.map((s) =>
  1559 |     invokeElectron<{ success: boolean; summaryZh?: string; enrichmentFailed?: boolean }>(
  1560 |       page,
  1561 |       'dispatch-skills:generate-summary',
  1562 |       s,
  1563 |     ),
  1564 |   );
  1565 | 
  1566 |   // 必须先等实际在跑且真实存活的假生成进程数确实达到 3，验证真实在飞并发负载已形成
> 1567 |   await expect.poll(async () => countRunningEngineProcesses(), { timeout: 10_000 }).toBe(3);
       |   ^ Error: expect(received).toBe(expected) // Object.is equality
  1568 |   const phase1LiveProcs = await getLiveEngineProcessInfo();
  1569 |   const phase1 = await capturePhase(1, loadSkills, phase1LiveProcs);
  1570 |   await assertNodeLoad(phase1, 'start');
  1571 | 
  1572 |   // 3. 在 3 并发技能生成负载持续期间，完整跑通协作主链核心环节：
  1573 |   //    创建总指挥 Session -> 建立 MCP Client -> 提交协作方案 -> 等待方案卡片展示 -> 点击批准 -> 验证审批生命周期与数据库持久化
  1574 |   const loadHeadSessionId = await createMetaAgentSession('Concurrent skill load Head');
  1575 |   const client = await createMetaAgentClient(loadHeadSessionId);
  1576 |   const submittedRequestIds = new Set<string>();
  1577 | 
  1578 |   const plan = await startPlanSubmission(client, loadHeadSessionId, submittedRequestIds, {
  1579 |     title: 'Concurrent skill load verification plan',
  1580 |     planItems: ['Verify IPC message passing under load', 'Verify database write and retrieval integrity'],
  1581 |     workOrderCount: 1,
  1582 |     risks: 'Background skill generation must never lock up SQLite database or IPC message loop.',
  1583 |   });
  1584 | 
  1585 |   const card = await waitForPendingApprovalCard(loadHeadSessionId);
  1586 |   await expect(card).toContainText('Concurrent skill load verification plan');
  1587 | 
  1588 |   await resetRendererEvents(page);
  1589 |   if (process.env.NIMBALYST_TEST_REJECT_PLAN === '1') {
  1590 |     await card.getByTestId('plan-approval-request-changes').click();
  1591 |     await card.getByTestId('plan-approval-feedback-input').fill('Reverse test probe: intentionally reject plan');
  1592 |     await card.getByTestId('plan-approval-submit-changes').click();
  1593 |   } else {
  1594 |     await card.getByTestId('plan-approval-approve').click();
  1595 |   }
  1596 | 
  1597 |   const planResult = parseMcpToolResult<{ approved: boolean; deliveryMethod: string }>(await plan.completion);
  1598 |   expect(planResult).toMatchObject({
  1599 |     approved: true,
  1600 |     deliveryMethod: 'direct',
  1601 |   });
  1602 | 
  1603 |   await assertApprovalLifecycle(loadHeadSessionId, plan.requestId, {
  1604 |     decision: 'approved',
  1605 |     method: 'direct',
  1606 |   });
  1607 | 
  1608 |   await assertNodeLoad(phase1, 'complete');
  1609 |   await releasePhase(phase1);
  1610 | 
  1611 |   // 4. 等待 3 个并发生成请求完成，验证无崩溃、无未捕获异常、正常返回
  1612 |   const results = await Promise.all(skillGenerationPromises);
  1613 |   expect(results).toHaveLength(3);
  1614 |   for (const res of results) {
  1615 |     expect(res).toBeDefined();
  1616 |     expect(res.success).toBe(true);
  1617 |     expect(res.enrichmentFailed).toBe(false);
  1618 |     expect(res.summaryZh).toBeTruthy();
  1619 |   }
  1620 | 
  1621 |   await assertPhaseLifetime(phase1);
  1622 | 
  1623 |   // 验证渲染层收到审批事件
  1624 |   await expect.poll(
  1625 |     async () => (await getRendererEvents(page, loadHeadSessionId)).length,
  1626 |     { timeout: 10_000 },
  1627 |   ).toBeGreaterThan(0);
  1628 | 
  1629 |   // 阶段 2：派工与子任务运行阶段的 3 并发技能生成负载
  1630 |   const phase2Skills = [
  1631 |     {
  1632 |       name: `r4-skill-4-${runTag}`,
  1633 |       description: 'Scaffold exercises and test suites for module.',
  1634 |     },
  1635 |     {
  1636 |       name: `r4-skill-5-${runTag}`,
  1637 |       description: 'Run test driven development and benchmark performance.',
  1638 |     },
  1639 |     {
  1640 |       name: `r4-skill-6-${runTag}`,
  1641 |       description: 'Sync knowledge graph and generate handoff document.',
  1642 |     },
  1643 |   ].map(skill => ({ ...skill, description: `${skill.description}\nGN-R4-LOAD ${skill.name}` }));
  1644 | 
  1645 |   const skillGenPromisesPhase2 = phase2Skills.map((s) =>
  1646 |     invokeElectron<{ success: boolean; summaryZh?: string; enrichmentFailed?: boolean }>(
  1647 |       page,
  1648 |       'dispatch-skills:generate-summary',
  1649 |       s,
  1650 |     ),
  1651 |   );
  1652 | 
  1653 |   // 等待第 2 阶段在跑数达到 3
  1654 |   await expect.poll(async () => countRunningEngineProcesses(), { timeout: 10_000 }).toBe(3);
  1655 |   const phase2LiveProcs = await getLiveEngineProcessInfo();
  1656 |   const phase2 = await capturePhase(2, phase2Skills, phase2LiveProcs);
  1657 |   await assertNodeLoad(phase2, 'start');
  1658 | 
  1659 |   // 在并发负载下派发子任务工单并等待完成
  1660 |   const child = await createImplementationChild(
  1661 |     client,
  1662 |     plan.planId,
  1663 |     'Load verification subtask',
  1664 |     'Execute subtask under background skill generation load.',
  1665 |   );
  1666 |   const childTurn = sendRealProviderTurn(child.sessionId, '[scripted:hold=r4-child] Execute subtask.');
  1667 |   await scriptedProvider.waitForPrompt('scripted:hold=r4-child');
```