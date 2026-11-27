// 回归：重点监控好友在线会话历史 —— 上线/下线边沿→会话记录→时长计算。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const hist = require('../src/services/friend-online-history');

test('上线→下线生成一段会话，时长正确', () => {
  hist.resetForTest();
  const t0 = 1_700_000_000_000;
  assert.equal(hist.noteOnline(123, t0, 'presence_online'), true);
  assert.equal(hist.noteOnline(123, t0 + 100, 'at_home'), false, '已在会话中的重复上线应被忽略');
  assert.equal(hist.noteOffline(123, t0 + 90_000, 'last_online'), true);
  const h = hist.getHistory(123, t0 + 90_000);
  assert.equal(h.online, false);
  assert.equal(h.items.length, 1);
  assert.equal(h.items[0].onAt, t0);
  assert.equal(h.items[0].offAt, t0 + 90_000);
  assert.equal(h.items[0].durationMs, 90_000);
  assert.equal(h.totalCount, 1);
  assert.equal(h.totalMs, 90_000);
});

test('仍在线会话用 now 计算当前时长', () => {
  hist.resetForTest();
  const t0 = 1_700_000_000_000;
  hist.noteOnline(456, t0, 'at_home');
  const h = hist.getHistory(456, t0 + 30_000);
  assert.equal(h.online, true);
  assert.equal(h.since, t0);
  assert.equal(h.currentMs, 30_000);
  assert.equal(h.totalCount, 1);
  assert.equal(h.totalMs, 30_000);
});

test('无在途会话的下线边沿被忽略', () => {
  hist.resetForTest();
  assert.equal(hist.noteOffline(789, 1_700_000_000_000), false);
  assert.equal(hist.getHistory(789).items.length, 0);
});

test('每段会话独立，最近在上；今日计数累加', () => {
  hist.resetForTest();
  const t0 = 1_700_000_000_000;
  hist.noteOnline(1, t0); hist.noteOffline(1, t0 + 10_000);
  hist.noteOnline(1, t0 + 20_000); hist.noteOffline(1, t0 + 35_000);
  const h = hist.getHistory(1, t0 + 40_000);
  assert.equal(h.items.length, 2);
  assert.equal(h.items[0].onAt, t0 + 20_000, '最近一段排在最前');
  assert.equal(h.todayCount, 2);
  assert.equal(h.todayMs, 25_000);
});

test('批量查询与 per-gid 隔离', () => {
  hist.resetForTest();
  const t0 = 1_700_000_000_000;
  hist.noteOnline(11, t0); hist.noteOffline(11, t0 + 5_000);
  hist.noteOnline(22, t0); hist.noteOffline(22, t0 + 7_000);
  const all = hist.getHistoryFor([11, 22, 33], t0 + 10_000);
  assert.equal(all[11].totalMs, 5_000);
  assert.equal(all[22].totalMs, 7_000);
  assert.equal(all[33].totalCount, 0);
});

test('接线：边沿检测在 notePresenceFromBatch / noteAtHomeEdge 调用历史模块', () => {
  const fa = fs.readFileSync(path.join(__dirname, '../src/services/friend-activity.js'), 'utf8');
  assert.match(fa, /friend-online-history/, 'friend-activity 应引入在线历史模块');
  assert.match(fa, /noteOnline/, '上线边沿应写历史');
  assert.match(fa, /noteOffline/, '下线边沿应写历史');
});

test('接线：worker 暴露 getFriendOnlineHistory RPC', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../src/core/worker.js'), 'utf8');
  assert.match(worker, /case 'getFriendOnlineHistory'/, 'worker RPC switch 应有该 case');
});

test('接线：controller 暴露 /api/friend-online-history 端点', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/controllers/admin-friend-routes.js'), 'utf8');
  assert.match(routes, /\/api\/friend-online-history/, 'controller 应注册历史端点');
});
