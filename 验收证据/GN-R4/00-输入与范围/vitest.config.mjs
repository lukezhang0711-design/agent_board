const base='/Users/lukezhang/Desktop/Agent运行面板';
export default {
  root:`${base}/.worktrees/worker-GN`,
  test:{environment:'node',include:[`${base}/诊断报告/GN-R3验收-2026-09-07/*.test.*`],maxWorkers:1,fileParallelism:false,testTimeout:22000},
  resolve:{alias:{
    vitest:`${base}/agent_board/node_modules/vitest/dist/index.js`,
    react:`${base}/agent_board/node_modules/react`,
    'react-dom':`${base}/agent_board/node_modules/react-dom`,
    '@testing-library/react':`${base}/agent_board/node_modules/@testing-library/react/dist/index.js`,
    '@nimbalyst/runtime':`${base}/.worktrees/worker-GN/packages/runtime/src/index.ts`,
  }},
};
