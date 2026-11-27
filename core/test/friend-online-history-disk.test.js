// 回归：在线历史必须原子落盘 + 冷启动读回（账号掉线 worker 退出后不丢）。
// 用独立临时目录作为 FARM_DATA_DIR，避免污染真实数据；结束后恢复环境。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const origDir = process.env.FARM_DATA_DIR;
const origAccount = process.env.FARM_ACCOUNT_ID;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'friend-online-history-disk-'));
process.env.FARM_DATA_DIR = tmp;
process.env.FARM_ACCOUNT_ID = 'disktest-account';

// 清 require 缓存，确保模块在临时目录下首次加载
const modulePath = require.resolve('../src/services/friend-online-history');
delete require.cache[modulePath];
const hist = require(modulePath);

test.after(() => {
  if (origDir === undefined) delete process.env.FARM_DATA_DIR; else process.env.FARM_DATA_DIR = origDir;
  if (origAccount === undefined) delete process.env.FARM_ACCOUNT_ID; else process.env.FARM_ACCOUNT_ID = origAccount;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('上线/下线边沿原子落盘到按账号隔离的文件', () => {
  hist.resetForTest();
  const file = hist._disk.diskFilePath('disktest-account');
  assert.ok(file && file.includes('friend-online-history'), '落盘路径应在 friend-online-history 子目录');
  const t0 = 1_700_000_000_000;
  hist.noteOnline(555, t0, 'presence_online');
  hist.noteOffline(555, t0 + 60_000, 'last_online');
  assert.ok(fs.existsSync(file), '文件应存在');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.version, 1);
  const row = raw.sessions.find(s => s.gid === 555);
  assert.ok(row, '应含该 gid');
  assert.equal(row.state.items.length, 1);
  assert.equal(row.state.items[0].durationMs, 60_000);
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'tmp 文件应已被 rename 消掉');
});

test('冷启动（内存清空）能从磁盘读回会话', () => {
  // 模拟 worker 重启：清内存与磁盘加载标记，保留磁盘文件；
  // getHistory 会触发 ensureDiskLoaded 从磁盘读回。
  hist.resetForTest();
  const h = hist.getHistoryFor([555], 1_700_000_100_000);
  assert.equal(h[555].totalCount, 1, '读回磁盘后应有 1 段');
  assert.equal(h[555].totalMs, 60_000);
  assert.equal(h[555].items[0].source, 'presence_online');
});

test('落盘文件损坏时安全降级为空，不抛异常', () => {
  const file = hist._disk.diskFilePath('disktest-account');
  fs.writeFileSync(file, '{ broken json');
  hist.resetForTest();
  const h = hist.getHistoryFor([555], 1_700_000_200_000);
  assert.equal(h[555].totalCount, 0);
});
