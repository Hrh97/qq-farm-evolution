const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 回归护栏：过期 steal due 的退避分支必须把 due 指向"下次重试的未来时刻"，
// 而不是停留在过去的成熟时刻。否则 stealIsDue() 在整个退避窗口恒真，
// runUnifiedTick 每轮进 steal 分支并 return，好友帮助互动永远调度不到，
// 且偷菜按 100ms 地板超频（实测 107 次/60s）打满 friend 预算。
// 2026-11-25 实机案例：每日任务 200021「在1个好友农场互动」永久卡 2/3。

const workerSrc = fs.readFileSync(path.join(__dirname, '../src/core/worker.js'), 'utf8');

test('armStealWake overdue branch marks due at the future retry time, not the stale past due', () => {
  // 抓 armStealWake 的过期分支（含 stealOverdueBackoffMs 调用）到下一个 return 为止
  const overdueBranch = workerSrc.slice(
    workerSrc.indexOf('nextStealRunAt = now + stealOverdueBackoffMs'),
    workerSrc.indexOf('stealOverdueStrikes = 0;', workerSrc.indexOf('nextStealRunAt = now + stealOverdueBackoffMs')),
  );
  assert.ok(overdueBranch.length > 0, '找到过期退避分支');
  assert.match(overdueBranch, /markStealDueAt\(\s*nextStealRunAt\s*\)/,
    '过期分支必须把 due 标成 nextStealRunAt（未来）');
  assert.doesNotMatch(overdueBranch, /markStealDueAt\(\s*dueAt\s*\)/,
    '过期分支不得再把 due 标成 dueAt（过去），那会让 stealIsDue 恒真');
});

test('a future retry due keeps stealIsDue false through the backoff window', () => {
  const { markStealDueAt, stealIsDue, stealOverdueBackoffMs, getStealDueAt } = require('../src/utils/behavior');
  const now = Date.now();
  try {
    // 死锁态（修复前）：due 停在过去的成熟时刻 → stealIsDue 恒真
    const staleDueAt = now - 60000;
    markStealDueAt(staleDueAt);
    assert.equal(stealIsDue(now), true, '过去 due 在修复前会让 stealIsDue 恒真（死锁态）');

    // 修复后：过期分支把 due 重标为 nextStealRunAt（未来）
    const backoff = stealOverdueBackoffMs(3);
    const nextRunAt = now + backoff;
    markStealDueAt(nextRunAt);

    assert.equal(getStealDueAt(), nextRunAt);
    assert.equal(stealIsDue(now), false, '退避窗口内 stealIsDue 必须为 false，帮助互动才调度得到');
    assert.equal(stealIsDue(nextRunAt - 1), false, '退避窗口结束前一刻仍为 false');
    assert.equal(stealIsDue(nextRunAt), true, '退避到点后恢复 true，正常触发偷菜');
  } finally {
    markStealDueAt(0); // 清理模块级状态，避免污染同进程其他测试
  }
});
