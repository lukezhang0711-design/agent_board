# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai/collab-chain.spec.ts >> 绿⑮: 技能生成占满允许并发时仍能跑通 collab-chain 协作链路（3 并发技能生成负载）
- Location: e2e/ai/collab-chain.spec.ts:1537:5

# Error details

```
Error: expect(received).toMatchObject(expected)

- Expected  - 1
+ Received  + 1

  Object {
-   "approved": true,
+   "approved": false,
    "deliveryMethod": "direct",
  }
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation "Open projects" [ref=e4]:
    - button "Switch to project nimbalyst-test-zKi9Wg" [ref=e6] [cursor=pointer]: NT
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
          - heading "nimbalyst-test-zKi9Wg" [level=3] [ref=e63]
          - generic [ref=e64]:
            - button "Switch to kanban view (本次派发相关)" [ref=e65] [cursor=pointer]:
              - img [ref=e66]
              - text: Kanban
            - button "Search sessions" [ref=e70] [cursor=pointer]:
              - img [ref=e71]
            - button "Create new session, worktree, or terminal" [ref=e75] [cursor=pointer]:
              - img [ref=e76]
        - generic "/var/folders/st/r866ph290_35q34xmk31xmzm0000gn/T/nimbalyst-test-zKi9Wg" [ref=e78]
      - generic [ref=e79]: Agent Sessions
      - textbox "Search sessions or filter by tag" [ref=e81]:
        - /placeholder: "Search or type # to filter by tag..."
      - generic [ref=e82]:
        - button "Show archived sessions" [ref=e83] [cursor=pointer]:
          - img [ref=e84]
        - generic "2 non-archived sessions in this workspace (matches the iOS project list count)" [ref=e86]: 2 sessions
        - button "Sort sessions" [ref=e88] [cursor=pointer]:
          - img [ref=e89]
      - generic [ref=e94]:
        - button "Meta Agent group, expanded" [expanded] [ref=e97] [cursor=pointer]:
          - generic [ref=e98]: chevron_right
          - generic [ref=e99]: Meta Agent
          - generic [ref=e100]: "1"
        - button "Collapse hub Concurrent skill load Head Just now" [expanded] [ref=e103] [cursor=pointer]:
          - button "Collapse" [ref=e104]:
            - generic [ref=e105]: chevron_right
          - generic [ref=e107]: hub
          - generic [ref=e108]: Concurrent skill load Head
          - generic [ref=e109]: Just now
        - button "Today group, expanded" [expanded] [ref=e112] [cursor=pointer]:
          - generic [ref=e113]: chevron_right
          - generic [ref=e114]: Today
          - generic [ref=e115]: "1"
        - 'button "Session: New Session, updated Just now" [ref=e117] [cursor=pointer]':
          - img [ref=e119]
          - generic [ref=e121]:
            - generic "New Session" [ref=e122]
            - generic [ref=e123]:
              - generic "2026年9月7日 GMT+8 下午10:27" [ref=e124]: Just now
              - generic [ref=e125]: default
    - separator "Resize session history panel" [ref=e126]
    - generic [ref=e128]:
      - generic [ref=e129]:
        - generic [ref=e131]:
          - generic [ref=e132]:
            - generic [ref=e134]: hub
            - heading "总指挥" [level=2] [ref=e136]
            - generic [ref=e137]: nimbalyst-test-zKi9Wg · 0 个在跑 · 0 个等你确认
          - generic [ref=e139]:
            - generic "0 agents working (共 0 个工单)" [ref=e140]:
              - generic [ref=e143]: smart_toy
              - generic [ref=e144]: 0 agents working
            - button "全部停下" [disabled] [ref=e145]
        - generic [ref=e146]:
          - generic [ref=e149]:
            - generic [ref=e151]:
              - generic [ref=e159]:
                - generic [ref=e161]:
                  - generic [ref=e162]:
                    - generic [ref=e163]:
                      - generic [ref=e164]: 方案审批
                      - generic "META AGENT" [ref=e165]
                    - generic [ref=e166]: Concurrent skill load verification plan
                  - generic [ref=e167]: 需要修订
                - generic [ref=e168]:
                  - list [ref=e169]:
                    - listitem [ref=e170]: Verify IPC message passing under load
                    - listitem [ref=e171]: Verify database write and retrieval integrity
                  - generic [ref=e172]: 1 个工单
                  - generic [ref=e173]:
                    - generic [ref=e174]: 总体风险
                    - generic [ref=e175]: Background skill generation must never lock up SQLite database or IPC message loop.
                  - generic [ref=e176]: 打回已记录。Head 正在准备修订…
              - button "arrow_downward" [ref=e178] [cursor=pointer]:
                - generic [ref=e179]: arrow_downward
            - generic:
              - button "Set phase" [ref=e180] [cursor=pointer]:
                - generic [ref=e181]: view_kanban
                - generic [ref=e182]: Phase
              - button "Prompts Menu" [ref=e183] [cursor=pointer]
          - generic [ref=e185]:
            - generic "Drag to resize prompt box" [ref=e186]
            - generic [ref=e187]:
              - 'button "Current model: scripted-collaboration-model" [ref=e190] [cursor=pointer]':
                - generic [ref=e191]: scripted-collaboration-model
                - generic [ref=e192]: expand_more
              - button "Actions (0)" [ref=e194] [cursor=pointer]:
                - generic [ref=e195]: bolt
                - generic [ref=e196]: Actions
                - generic [ref=e197]: expand_more
              - group "Token usage data not available yet" [ref=e198]:
                - generic [ref=e199]: "--"
            - generic [ref=e200]:
              - textbox "Type your message... (Enter to send, Shift+Enter for new line, @ for files, @@ for sessions, / for commands)" [ref=e201]
              - button "Send message" [disabled] [ref=e202]:
                - img [ref=e203]
      - button "打开交付文件架" [ref=e205] [cursor=pointer]:
        - button "打开交付文件架" [ref=e206]:
          - generic [ref=e207]: folder_open
          - generic [ref=e208]: "0"
```

# Test source

```ts
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
  1567 |   await expect.poll(async () => countRunningEngineProcesses(), { timeout: 10_000 }).toBe(3);
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
> 1598 |   expect(planResult).toMatchObject({
       |                      ^ Error: expect(received).toMatchObject(expected)
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
  1668 |   scriptedProvider.releaseHold('r4-child');
  1669 |   await expect(childTurn).resolves.toMatchObject({
  1670 |     content: 'Scripted provider completed the requested collaboration turn.',
  1671 |   });
  1672 |   await expect.poll(async () => getWorkOrderStatus(child.sessionId), { timeout: 15_000 }).toBe('completed');
  1673 | 
  1674 |   await assertNodeLoad(phase2, 'complete');
  1675 |   await releasePhase(phase2);
  1676 | 
  1677 |   const phase2Results = await Promise.all(skillGenPromisesPhase2);
  1678 |   expect(phase2Results).toHaveLength(3);
  1679 |   for (const res of phase2Results) {
  1680 |     expect(res.success).toBe(true);
  1681 |     expect(res.enrichmentFailed).toBe(false);
  1682 |   }
  1683 | 
  1684 |   await assertPhaseLifetime(phase2);
  1685 | 
  1686 |   // 阶段 3：交付与最终总结阶段的 3 并发技能生成负载
  1687 |   const phase3Skills = [
  1688 |     {
  1689 |       name: `r4-skill-7-${runTag}`,
  1690 |       description: 'Publish and land release version.',
  1691 |     },
  1692 |     {
  1693 |       name: `r4-skill-8-${runTag}`,
  1694 |       description: 'Convert documentation to PDF.',
  1695 |     },
  1696 |     {
  1697 |       name: `r4-skill-9-${runTag}`,
  1698 |       description: 'Connect Chrome browser for UI test.',
```