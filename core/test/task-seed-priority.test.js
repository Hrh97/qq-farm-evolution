const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseBuySeedTask,
  findSeedIdByName,
  registerTaskTarget,
  getTaskSeedTarget,
  clearTaskSeedTarget,
} = require('../src/services/task-seed-target');

test('解析"购买/种植N个XX(种子)"描述', () => {
  assert.deepEqual(parseBuySeedTask('购买8个玉米种子'), { count: 8, cropName: '玉米' });
  assert.deepEqual(parseBuySeedTask('购买 16 个土豆种子'), { count: 16, cropName: '土豆' });
  assert.deepEqual(parseBuySeedTask('种植8个玉米'), { count: 8, cropName: '玉米' });
  assert.deepEqual(parseBuySeedTask('种植8个玉米种子'), { count: 8, cropName: '玉米' });
  assert.equal(parseBuySeedTask('完成8次收获'), null);
  assert.equal(parseBuySeedTask('售卖果实获得金币'), null);
  assert.equal(parseBuySeedTask(''), null);
});

test('作物名反查 seedId（玉米 → 20004）', () => {
  const corn = findSeedIdByName('玉米');
  assert.equal(corn, 20004);
  assert.ok(findSeedIdByName('土豆') > 0);
  assert.equal(findSeedIdByName('不存在的作物XYZ'), 0);
});

test('登记任务目标 → 读取 → 完成后自动清除', () => {
  clearTaskSeedTarget();
  const target = registerTaskTarget({
    desc: '购买8个玉米种子', progress: 2, totalProgress: 8, taskId: 100035,
  });
  assert.ok(target);
  assert.equal(target.seedId, 20004);
  assert.equal(target.needCount, 8);
  assert.equal(getTaskSeedTarget().seedId, 20004);

  // 进度满了：清除目标
  registerTaskTarget({
    desc: '购买8个玉米种子', progress: 8, totalProgress: 8, taskId: 100035,
    isCompleted: true,
  });
  assert.equal(getTaskSeedTarget(), null);
});

test('非购买类任务不登记', () => {
  clearTaskSeedTarget();
  const r = registerTaskTarget({ desc: '完成8次收获', progress: 0, totalProgress: 8, taskId: 1 });
  assert.equal(r, null);
  assert.equal(getTaskSeedTarget(), null);
});

test('task.js 在任务扫描与推送里同步目标种子', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../src/services/task.js'), 'utf8');
  assert.ok(src.includes('syncTaskSeedTargets(taskInfo)'), 'checkAndClaimTasks 未同步');
  assert.ok(src.includes('syncTaskSeedTargets(payload)'), 'onTaskInfoNotify 未同步');
});

test('planting-service.js 买种子/种植优先任务目标', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../src/services/planting-service.js'), 'utf8');
  assert.ok(src.includes('getTaskSeedTarget(accountId)'), '未接任务目标');
  assert.ok((src.match(/任务优先/g) || []).length >= 2, '商店与背包两条路径都应任务优先');
});

test('task.js 有周期性兜底领奖重试（防止领奖RPC失败后任务永久卡住）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../src/services/task.js'), 'utf8');
  assert.ok(src.includes('setIntervalTask(\'task_claim_retry\''), '缺少兜底重试定时器');
});
