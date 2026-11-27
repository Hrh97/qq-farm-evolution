/**
 * 好友在线会话历史（零外部依赖，仅用 node 内置模块）。
 *
 * 背景：friend-activity.js 已能精确判定好友上线/下线边沿
 * （notePresenceFromBatch 的 last_online 消失/出现、noteAtHomeEdge 的 at_home 上升沿），
 * 但这些边沿只用于日志与调度唤醒，不留会话记录。本模块把它们落成
 * 「上线时刻 / 下线时刻 / 在线时长」的会话列表，供重点监控面板展示。
 *
 * 只认真实边沿，不做轮询推断：
 *  - noteOnline  上线：开启一段会话（已在会话中则忽略，天然去重多源同拍）
 *  - noteOffline 下线：闭合当前会话并计时（无在途会话则忽略）
 *
 * 持久化（2026-11-27）：内存态之外，每次边沿写入原子落盘到
 * <运行数据目录>/friend-online-history/<accountId 哈希>.json，worker 冷启动读回，
 * 解决「账号掉线→worker 进程退出→在线历史丢失」。按账号哈希隔离、tmp+rename 原子写。
 * 无 FARM_ACCOUNT_ID 时不落盘（保持纯数据/单测零 IO）。
 * 会话热替换快照（capsule）仍由 business-state 托管，与文件互不影响。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_SESSIONS_PER_GID = 30;
const DISK_VERSION = 1;

/** gid -> { curOnAt, items: [{ onAt, offAt, durationMs, source }], dayKey, dayCount, dayMs } */
const sessions = new Map();

// 已从磁盘加载过的 accountId（worker 一进程一账号；切换账号时重载）。
let diskLoadedAccount = null;

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function dayKey(ts) {
  try {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch { return ''; }
}

function ensure(gid) {
  const id = toNum(gid);
  if (!id) return null;
  let s = sessions.get(id);
  if (!s) {
    s = { curOnAt: 0, curSource: '', items: [], dayKey: '', dayCount: 0, dayMs: 0 };
    sessions.set(id, s);
  }
  return s;
}

function rollDay(s, at) {
  const key = dayKey(at);
  if (s.dayKey !== key) {
    s.dayKey = key;
    s.dayCount = 0;
    s.dayMs = 0;
  }
}

// ---------- 本地文件持久化 ----------

function getDataDir() {
  return require('../config/runtime-paths').getDataDir();
}

/** 账号文件名用稳定哈希：避免目录穿越 / 账号名碰撞；只含 gid 与时长，无凭据。 */
function diskFilePath(accountId) {
  const id = String(accountId || '');
  if (!id) return null;
  const hash = crypto.createHash('sha256').update(id).digest('hex').slice(0, 24);
  return path.join(getDataDir(), 'friend-online-history', `${hash}.json`);
}

/** 读回校验：只接受本模块写出的固定结构；损坏/旧版/异常值当无记录。 */
function loadFromDisk(accountId) {
  const file = diskFilePath(accountId);
  if (!file) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || raw.version !== DISK_VERSION || !Array.isArray(raw.sessions)) return null;
    const out = new Map();
    for (const entry of raw.sessions) {
      const gid = toNum(entry && entry.gid);
      const s = entry && entry.state;
      if (!gid || !s || !Array.isArray(s.items)) continue;
      const items = s.items
        .filter(it => it && Number(it.onAt) > 0 && Number(it.offAt) >= Number(it.onAt))
        .slice(-MAX_SESSIONS_PER_GID)
        .map(it => ({
          onAt: Number(it.onAt),
          offAt: Number(it.offAt),
          durationMs: Number(it.durationMs) > 0 ? Number(it.durationMs) : Number(it.offAt) - Number(it.onAt),
          source: String(it.source || ''),
        }));
      out.set(gid, {
        curOnAt: Number(s.curOnAt) > 0 ? Number(s.curOnAt) : 0,
        curSource: typeof s.curSource === 'string' ? s.curSource : '',
        items,
        dayKey: typeof s.dayKey === 'string' ? s.dayKey : '',
        dayCount: Number(s.dayCount) > 0 ? Number(s.dayCount) : 0,
        dayMs: Number(s.dayMs) > 0 ? Number(s.dayMs) : 0,
      });
    }
    return out;
  } catch { return null; }
}

function persistToDisk(accountId) {
  const file = diskFilePath(accountId);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const rows = [];
    for (const [gid, s] of sessions) {
      rows.push({ gid, state: {
        curOnAt: s.curOnAt,
        curSource: s.curSource,
        items: s.items.slice(-MAX_SESSIONS_PER_GID),
        dayKey: s.dayKey,
        dayCount: s.dayCount,
        dayMs: s.dayMs,
      } });
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: DISK_VERSION, savedAt: Date.now(), sessions: rows }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    // 落盘失败不影响内存态与业务；只记日志
    try { require('../utils/logger').warn('好友', `在线历史落盘失败: ${err.message}`); } catch { /* ignore */ }
  }
}

/**
 * 冷启动读回：每个 accountId 只做一次；仅当内存为空时整体载入。
 * 若 business-state 的 restore 已恢复出会话（热替换），则以内存快照为准、不覆盖。
 */
function ensureDiskLoaded() {
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  if (!accountId || diskLoadedAccount === accountId) return;
  diskLoadedAccount = accountId;
  if (sessions.size > 0) return;
  const disk = loadFromDisk(accountId);
  if (disk && disk.size) {
    for (const [gid, s] of disk) sessions.set(gid, s);
  }
}

// ---------- 边沿写入 ----------

/** 上线边沿：开启新会话。已在会话中返回 false（多源同拍去重）。 */
function noteOnline(gid, at, source = 'presence') {
  ensureDiskLoaded();
  const s = ensure(gid);
  if (!s) return false;
  const ts = Number(at) > 0 ? Number(at) : Date.now();
  rollDay(s, ts);
  if (s.curOnAt > 0) return false; // 已在会话中，忽略重复上线信号
  s.curOnAt = ts;
  s.curSource = String(source || 'presence');
  s.dayCount += 1;
  persistToDisk(process.env.FARM_ACCOUNT_ID || '');
  return true;
}

/** 下线边沿：闭合当前会话并计时。无在途会话返回 false。 */
function noteOffline(gid, at, source = 'presence') {
  ensureDiskLoaded();
  const s = ensure(gid);
  if (!s || s.curOnAt <= 0) return false;
  const ts = Number(at) > 0 ? Number(at) : Date.now();
  rollDay(s, ts);
  const offAt = Math.max(ts, s.curOnAt);
  const durationMs = offAt - s.curOnAt;
  s.items.push({ onAt: s.curOnAt, offAt, durationMs, source: s.curSource || source });
  s.dayMs += durationMs;
  if (s.items.length > MAX_SESSIONS_PER_GID) s.items.shift();
  s.curOnAt = 0;
  s.curSource = '';
  persistToDisk(process.env.FARM_ACCOUNT_ID || '');
  return true;
}

/** 单好友历史快照。now 用于计算仍在线会话的当前时长。 */
function getHistory(gid, now = Date.now()) {
  ensureDiskLoaded();
  const id = toNum(gid);
  const s = sessions.get(id);
  if (!s) return { items: [], online: false, currentMs: 0, todayCount: 0, todayMs: 0, totalCount: 0, totalMs: 0 };
  rollDay(s, now);
  const currentMs = s.curOnAt > 0 ? Math.max(0, now - s.curOnAt) : 0;
  const totalMs = s.items.reduce((sum, it) => sum + (it.durationMs || 0), 0) + currentMs;
  return {
    items: s.items.slice().reverse(), // 最近在上
    online: s.curOnAt > 0,
    since: s.curOnAt || 0,
    currentMs,
    todayCount: s.dayCount,
    todayMs: s.dayMs + (s.curOnAt > 0 ? currentMs : 0),
    totalCount: s.items.length + (s.curOnAt > 0 ? 1 : 0),
    totalMs,
  };
}

/** 批量：gid -> 历史快照。 */
function getHistoryFor(gids, now = Date.now()) {
  ensureDiskLoaded();
  const out = {};
  for (const g of Array.isArray(gids) ? gids : []) {
    const id = toNum(g);
    if (id) out[id] = getHistory(id, now);
  }
  return out;
}

function resetForTest() {
  sessions.clear();
  diskLoadedAccount = null;
}

/** 持久化胶囊（固定 keys，Map 容器交给 restoreContainer 恢复，对齐 friend-activity.js）。 */
function capsule() {
  return { sessions };
}

function restore(value) {
  sessions.clear();
  if (!value || typeof value !== 'object' || !value.sessions) return;
  const { restoreContainer } = require('./business-state');
  restoreContainer(sessions, value.sessions);
}

module.exports = {
  MAX_SESSIONS_PER_GID,
  noteOnline,
  noteOffline,
  getHistory,
  getHistoryFor,
  resetForTest,
  capsule,
  restore,
  // 供持久化测试使用；生产不调用
  _disk: { diskFilePath, loadFromDisk, persistToDisk, ensureDiskLoaded },
};

// 随业务状态快照持久化（与 friend-activity.js 同机制）
if (globalThis.process?.env?.FARM_SESSION_BUSINESS === '1') {
  const { registerDataState, restoreContainer } = require('./business-state');
  registerDataState('services/friend-online-history.js', capsule, value => {
    sessions.clear();
    restoreContainer(sessions, value.sessions);
  }, {});
}
