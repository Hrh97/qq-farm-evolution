// 回归：化肥道具时长映射必须覆盖背包常见 ID（80001/80002/80004），
// 否则容器快满时按 fallback 1h 计算会一次塞入过多、溢出浪费。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  NORMAL_FERTILIZER_ITEM_HOURS,
  ORGANIC_FERTILIZER_ITEM_HOURS,
  getFertilizerItemHours,
} = require('../src/config/fertilizer-item-hours');

test('普通化肥常见背包 ID 时长正确', () => {
  assert.equal(getFertilizerItemHours(80001), 1, '化肥(1小时) 应为 1h');
  assert.equal(getFertilizerItemHours(80002), 4, '化肥(4小时) 应为 4h');
  assert.equal(getFertilizerItemHours(80004), 12, '化肥(12小时) 应为 12h');
});

test('有机化肥 ID 时长正确', () => {
  for (const [id, hours] of [[80011, 1], [80012, 4], [80013, 8], [80014, 12]]) {
    assert.equal(getFertilizerItemHours(id, true), hours, `有机化肥 ${id} 应为 ${hours}h`);
  }
});

test('历史活动道具 ID 保留', () => {
  assert.equal(getFertilizerItemHours(79873), 1);
  assert.equal(getFertilizerItemHours(80514), 4);
  assert.equal(getFertilizerItemHours(80003), 8);
  assert.equal(getFertilizerItemHours(80132), 12);
});

test('映射表条目数（普通 7 / 有机 4）', () => {
  assert.equal(NORMAL_FERTILIZER_ITEM_HOURS.size, 7);
  assert.equal(ORGANIC_FERTILIZER_ITEM_HOURS.size, 4);
});

test('warehouse.js 已改用共享映射模块，且本地 Map 定义已移除', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/warehouse.js'), 'utf8');
  assert.match(src, /require\('\.\.\/config\/fertilizer-item-hours'\)/);
  // 旧的本地 new Map([...79873...]) 定义必须删掉，否则阴影掉修正后的映射
  assert.doesNotMatch(src, /\[79873,\s*1\]/);
});
