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

// 1. 记录启动状态
if (stateDir && fs.existsSync(stateDir)) {
  const pidFile = path.join(stateDir, `running-${pid}.json`);
  fs.writeFileSync(pidFile, JSON.stringify({ pid, startTime: Date.now() }), 'utf8');
  const logFile = path.join(stateDir, 'events.log');
  fs.appendFileSync(logFile, `START ${pid} ${Date.now()}\n`, 'utf8');
}

function cleanupState(status) {
  if (stateDir && fs.existsSync(stateDir)) {
    const pidFile = path.join(stateDir, `running-${pid}.json`);
    try {
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch {}
    const logFile = path.join(stateDir, 'events.log');
    try {
      fs.appendFileSync(logFile, `${status} ${pid} ${Date.now()}\n`, 'utf8');
    } catch {}
  }
}

process.on('SIGTERM', () => {
  cleanupState('KILLED');
  process.exit(143);
});

process.on('SIGINT', () => {
  cleanupState('KILLED');
  process.exit(130);
});

// 解析输入参数
const args = process.argv.slice(2);
let rawPrompt = '';
const pIdx = args.indexOf('-p');
if (pIdx !== -1 && args[pIdx + 1]) {
  rawPrompt = args[pIdx + 1];
}

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

setTimeout(() => {
  if (failAll) {
    cleanupState('FAIL');
    process.stderr.write('Simulated engine failure for test probe\n');
    process.exit(1);
  }
  cleanupState('END');
  const payload = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: output,
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exit(0);
}, delayMs);
