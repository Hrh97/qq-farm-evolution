const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SEED_GIFT_PACK_IDS, collectSeedGiftPayloads } = require('../src/services/seed-gift-packs');
const serviceFile = fs.readFileSync(path.resolve(__dirname, '../src/services/warehouse.js'), 'utf8');
const workerFile = fs.readFileSync(path.resolve(__dirname, '../src/core/worker.js'), 'utf8');
const storeFile = fs.readFileSync(path.resolve(__dirname, '../src/models/store.js'), 'utf8');
const observFile = fs.readFileSync(path.resolve(__dirname, '../src/services/automation-observability.js'), 'utf8');

test('collectSeedGiftPayloads picks only whitelisted packs and sums counts', () => {
  const bagItems = [
    { id: 101620, count: 3 },   // 南瓜礼包
    { id: 101621, count: 30 },  // 荷风礼包
    { id: 101621, count: 2 },   // 同 ID 再一份 -> 合并
    { id: 20066, count: 9 },    // 鲜姜种子 - 非礼包
    { id: 1001, count: 5000000 }, // 金币 - 非礼包
    { id: 999999, count: 5 },   // 未登记礼包 - 非白名单
    { id: 101620, count: 0 },   // 数量为 0 - 跳过
  ];
  const payloads = collectSeedGiftPayloads(bagItems);
  assert.deepEqual(payloads.sort((a, b) => a.id - b.id), [
    { id: 101620, count: 3 },
    { id: 101621, count: 32 },
  ]);
});

test('collectSeedGiftPayloads handles string ids/counts and empty bag', () => {
  assert.deepEqual(collectSeedGiftPayloads([
    { id: '101622', count: '7' },
    { id: '101623', count: '4' },
  ]).sort((a, b) => a.id - b.id), [
    { id: 101622, count: 7 },
    { id: 101623, count: 4 },
  ]);
  assert.deepEqual(collectSeedGiftPayloads([]), []);
  assert.deepEqual(collectSeedGiftPayloads(null), []);
});

test('seed gift pack id whitelist is exactly the four activity packs', () => {
  assert.deepEqual([...SEED_GIFT_PACK_IDS].sort((a, b) => a - b), [101620, 101621, 101622, 101623]);
});

test('wiring: warehouse uses batchUse + observability, store default off, worker calls under switch', () => {
  assert.match(serviceFile, /collectSeedGiftPayloads\(items\)/, 'warehouse 用识别模块挑礼包');
  assert.match(serviceFile, /batchUseItems\(\[\{ itemId: id, count, uid: 0 \}\]\)/, '用 BatchUse uid=0 开启');
  assert.match(serviceFile, /openSeedGiftPacksSilently/, '暴露静默别名');
  assert.match(observFile, /seed_gift_auto_open:\s*'种子礼包自动开启'/, '观测面板标签');
  assert.match(storeFile, /seed_gift_auto_open:\s*false/, 'store 默认值关闭');
  assert.match(workerFile, /openSeedGiftPacksSilently/, 'worker 导入静默开启函数');
  assert.match(workerFile, /if \(autoConfig\.seed_gift_auto_open\) await openSeedGiftPacksSilently\(\)/, 'farm tick 中按开关调用');
  assert.match(workerFile, /if \(getAutomation\(\)\.seed_gift_auto_open\)[\s\S]{0,140}openSeedGiftPacksSilently/, '启动时按开关调用');
});
