#!/usr/bin/env node
/**
 * 隔离受控的假生成程序（GN-R1 R4 专用）
 * 零网络、零凭证读取、绝不回退真实 Claude 账号。
 * 支持并发追踪、状态记录、受控延迟与反向试探故障注入。
 */
const fs = require('fs');
const path = require('path');

const pid = process.pid;
const stateDir = process.env.NIMBALYST_SKILL_ENGINE_STATE_DIR;
const delayMs = parseInt(process.env.NIMBALYST_SKILL_ENGINE_DELAY_MS || '2500', 10);
const failAll = process.env.NIMBALYST_SKILL_ENGINE_FAIL_ALL === '1';
const customOutput = process.env.NIMBALYST_SKILL_ENGINE_CUSTOM_OUTPUT;

const args = process.argv.slice(2);
const rawPrompt = args[args.indexOf('-p') + 1] || '';
const description = rawPrompt.split('<skill_raw_description>\n')[1]?.split('\n</skill_raw_description>')[0] || '';
const startTime = Date.now();
const identity = { pid, startTime, description };
let finished = false;

function record(event, extra = {}) {
  if (!stateDir || !fs.existsSync(stateDir)) return;
  const at = Date.now();
  fs.appendFileSync(path.join(stateDir, 'events.log'), `${event} ${pid} ${at}\n`);
  fs.appendFileSync(path.join(stateDir, 'process-events.jsonl'), JSON.stringify({ event, at, ...identity, ...extra }) + '\n');
}
if (stateDir && fs.existsSync(stateDir)) {
  fs.writeFileSync(path.join(stateDir, `running-${pid}.json`), JSON.stringify(identity));
}
record('START', { args, hasApiKey: 'ANTHROPIC_API_KEY' in process.env });

function finish(event, exitCode, stdout = '') {
  if (finished) return;
  finished = true;
  record(event, { endTime: Date.now(), exitCode, stdout });
  if (stateDir) fs.rmSync(path.join(stateDir, `running-${pid}.json`), { force: true });
  process.stdout.write(stdout, () => process.exit(exitCode));
}
process.on('SIGTERM', () => finish('KILLED', 143));
process.on('SIGINT', () => finish('KILLED', 130));

let output = customOutput || '分析并处理项目技能说明';
if (rawPrompt.includes('dependencies')) {
  output = '检查与分析项目依赖关系';
} else if (rawPrompt.includes('security')) {
  output = '审计安全规则并保护改动';
} else if (rawPrompt.includes('architecture')) {
  output = '审查代码库架构与排版';
} else if (rawPrompt.includes('exercises')) {
  output = '脚手架生成练习题与测试';
} else if (rawPrompt.includes('development') || rawPrompt.includes('TDD')) {
  output = '测试驱动开发与性能基准';
} else if (rawPrompt.includes('knowledge') || rawPrompt.includes('handoff')) {
  output = '同步知识库并导出交接文档';
} else if (rawPrompt.includes('release') || rawPrompt.includes('deploy')) {
  output = '执行发版部署并监控健康';
} else if (rawPrompt.includes('PDF')) {
  output = '将文档转换为高质量PDF';
} else if (rawPrompt.includes('Chrome')) {
  output = '连接或启动Chrome协同操控';
}

function complete() {
  if (failAll) {
    process.stderr.write('Simulated engine failure for test probe\n');
    finish('FAIL', 1);
    return;
  }
  finish('END', 0, JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: output }) + '\n');
}

// 仅受控负载夹具等待主链释放；有界看门狗早于正式 15 秒超时，绝不无限延长。
// delay=0 保留反向 B：真实进程立即退出，留下的旧标记不能冒充在飞负载。
if (stateDir && description.includes('GN-R4-LOAD') && delayMs !== 0) {
  setInterval(() => {
    if (fs.existsSync(path.join(stateDir, `release-${pid}`))) complete();
  }, 20);
  setTimeout(() => finish('HOLD_TIMEOUT', 1), 14000);
} else {
  setTimeout(complete, delayMs);
}
