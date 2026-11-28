// 回归：在线历史服务端证据兜底 + 互相佐证。
// 实时边沿优先；bot 不在岗时按 lastLoginAt + last_online 推算，并标记来源。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fb = require('../src/services/friend-online-history-fallback');

const now = 1_700_010_000_000; // 2023-11-14 左右
const loginSec = 1_700_000_000; // 秒级 epoch

test('offlineFromFriend 只认 last_online 来源的下线时刻', () => {
  assert.ok(fb.offlineFromFriend({ activeSource: 'last_online', activeAt: 1_700_000_600_000 }) > 0);
  assert.equal(fb.offlineFromFriend({ activeSource: 'at_home', activeAt: 1_700_000_600_000 }), 0, '在线来源不能当离线时刻');
  assert.equal(fb.offlineFromFriend({ activeSource: '', activeAt: 1_700_000_600_000 }), 0);
});

test('toMs 兼容秒/毫秒 epoch，忽略异常值', () => {
  assert.equal(fb.toMs(loginSec), loginSec * 1000);
  assert.equal(fb.toMs(loginSec * 1000), loginSec * 1000);
  assert.equal(fb.toMs(0), 0);
  assert.equal(fb.toMs('bad'), 0);
});

test('login + last_online 合成一段服务端兜底会话', () => {
  const friend = {
    gid: 123,
    lastLoginAt: loginSec * 1000,
    activeSource: 'last_online',
    activeAt: loginSec * 1000 + 108_000,
    online: false,
  };
  const h = fb.buildServerFallback(friend, now);
  assert.ok(h, '应合成一段');
  assert.equal(h.evidence, 'server_fallback');
  assert.equal(h.fallback, true);
  assert.equal(h.totalCount, 1);
  assert.equal(h.totalMs, 108_000);
  assert.equal(h.items[0].source, 'server_fallback');
  assert.equal(h.online, false);
});

test('无下线时刻但 online=true 合成仍在线会话', () => {
  const friend = { gid: 1, lastLoginAt: now - 60_000, activeSource: 'at_home', activeAt: now, online: true };
  const h = fb.buildServerFallback(friend, now);
  assert.equal(h.online, true);
  assert.equal(h.currentMs, 60_000);
  assert.equal(h.totalMs, 60_000);
});

test('merge 实时优先：有实时会话时保留实时并附服务端佐证', () => {
  const realtime = { 123: { items: [{ onAt: 1, offAt: 2, durationMs: 1 }], online: false, totalCount: 1, totalMs: 1 } };
  const friends = [{ gid: 123, lastLoginAt: loginSec * 1000, activeSource: 'last_online', activeAt: loginSec * 1000 + 5000 }];
  const out = fb.mergeWithServerEvidence(realtime, friends, now);
  assert.equal(out[123].evidence, 'realtime', '实时证据优先');
  assert.equal(out[123].totalMs, 1, '实时时长不被服务端覆盖');
  assert.ok(out[123].serverCorroboration, '附服务端佐证');
  assert.equal(out[123].serverCorroboration.serverLoginAt, loginSec * 1000);
});

test('merge 无实时会话用服务端兜底，并覆盖名单里有但历史表缺失的好友', () => {
  const realtime = { 123: { items: [], online: false, totalCount: 0, totalMs: 0 } };
  const friends = [
    { gid: 123, lastLoginAt: loginSec * 1000, activeSource: 'last_online', activeAt: loginSec * 1000 + 60_000, online: false },
    { gid: 456, lastLoginAt: loginSec * 1000, activeSource: 'last_online', activeAt: loginSec * 1000 + 30_000, online: false },
  ];
  const out = fb.mergeWithServerEvidence(realtime, friends, now);
  assert.equal(out[123].fallback, true, '空实时历史用兜底');
  assert.equal(out[123].totalMs, 60_000);
  assert.equal(out[456].fallback, true, '历史表缺失也补兜底');
  assert.equal(out[456].totalMs, 30_000);
});

test('接线：worker 的 getFriendOnlineHistory 使用兜底合成，前端展示兜底标记', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../src/core/worker.js'), 'utf8');
  assert.match(worker, /friend-online-history-fallback/, 'worker 应引入兜底模块');
  assert.match(worker, /mergeWithServerEvidence/, 'worker 应调用合成');
  const vue = fs.readFileSync(path.join(__dirname, '../../web/src/views/Friends.vue'), 'utf8');
  assert.match(vue, /server_fallback/, '前端应标记服务端推算会话');
  assert.match(vue, /fallback/, '前端应展示兜底提示');
});
