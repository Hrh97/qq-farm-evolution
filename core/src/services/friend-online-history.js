/**
 * 好友在线会话历史（零依赖纯数据）。
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
 * 纯数据、无 fs / 无 RPC，便于零依赖单测；持久化由调用方 capsule 托管。
 */

const MAX_SESSIONS_PER_GID = 30;

/** gid -> { curOnAt, items: [{ onAt, offAt, durationMs, source }], dayKey, dayCount, dayMs } */
const sessions = new Map();

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

/** 上线边沿：开启新会话。已在会话中返回 false（多源同拍去重）。 */
function noteOnline(gid, at, source = 'presence') {
  const s = ensure(gid);
  if (!s) return false;
  const ts = Number(at) > 0 ? Number(at) : Date.now();
  rollDay(s, ts);
  if (s.curOnAt > 0) return false; // 已在会话中，忽略重复上线信号
  s.curOnAt = ts;
  s.curSource = String(source || 'presence');
  s.dayCount += 1;
  return true;
}

/** 下线边沿：闭合当前会话并计时。无在途会话返回 false。 */
function noteOffline(gid, at, source = 'presence') {
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
  return true;
}

/** 单好友历史快照。now 用于计算仍在线会话的当前时长。 */
function getHistory(gid, now = Date.now()) {
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
  const out = {};
  for (const g of Array.isArray(gids) ? gids : []) {
    const id = toNum(g);
    if (id) out[id] = getHistory(id, now);
  }
  return out;
}

function resetForTest() {
  sessions.clear();
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
};

// 随业务状态快照持久化（与 friend-activity.js 同机制）
if (globalThis.process?.env?.FARM_SESSION_BUSINESS === '1') {
  const { registerDataState, restoreContainer } = require('./business-state');
  registerDataState('services/friend-online-history.js', capsule, value => {
    sessions.clear();
    restoreContainer(sessions, value.sessions);
  }, {});
}
