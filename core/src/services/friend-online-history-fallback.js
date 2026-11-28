/**
 * 好友在线历史「服务端证据兜底 + 互相佐证」（零依赖纯函数）。
 *
 * 背景：friend-online-history.js 只认 bot 巡查亲眼见到的在线/下线边沿。
 * 若好友的上线/下线恰好发生在 bot 不在岗时（账号掉线/重启），这段会话不会被记。
 * 服务端仍下发两个可用时间戳：
 *   - lastLoginAt：好友登录游戏的时刻（friend-land-analyzer normalizeLastLoginAt）
 *   - activeAt + activeSource='last_online'：好友离线时刻（BasicInfo.last_online）
 * 本模块在读历史时把这两个时间戳合成一段「服务端推算」会话：
 *   - 实时边沿存在 → 以实时为准，附 serverCorroboration 佐证（不覆盖、不重复）
 *   - 实时边沿缺失 → 用服务端证据兜底合成，标记 evidence='server_fallback'
 *
 * 纯读时合成：不写回实时历史、不落盘，避免污染权威边沿数据与本地文件。
 */

function toMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // 秒级 epoch (<1e12) 转毫秒；异常值忽略
  if (n < 1_000_000_000) return 0;
  return n < 100_000_000_000 ? n * 1000 : n;
}

function dayKey(ts, now) {
  try {
    const base = ts > 0 ? ts : now;
    const d = new Date(base);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch { return ''; }
}

function emptyHistory() {
  return { items: [], online: false, currentMs: 0, todayCount: 0, todayMs: 0, totalCount: 0, totalMs: 0 };
}

/** 服务端 last_online 证据是否可当「下线时刻」。 */
function offlineFromFriend(friend) {
  const src = String(friend && friend.activeSource || '');
  // 只认明确的下线来源，避免把 at_home/presence 等在线证据误当离线
  if (!/last_online|offline/i.test(src)) return 0;
  return toMs(friend && friend.activeAt);
}

/**
 * 用服务端证据给单个好友合成兜底历史。
 * 返回 null 表示没有可用证据（保持空历史）。
 */
function buildServerFallback(friend, now) {
  const loginAt = toMs(friend && friend.lastLoginAt);
  if (!loginAt || loginAt > now) return null;
  const offAtRaw = offlineFromFriend(friend);
  const offAt = offAtRaw > loginAt && offAtRaw <= now ? offAtRaw : 0;

  const items = [];
  if (offAt > 0) {
    items.push({ onAt: loginAt, offAt, durationMs: offAt - loginAt, source: 'server_fallback' });
  }
  const online = offAt === 0 && friend && friend.online === true;
  const currentMs = online ? Math.max(0, now - loginAt) : 0;
  const totalMs = items.reduce((sum, it) => sum + (it.durationMs || 0), 0) + currentMs;

  // 今日计数：按登录/下线所在自然日与 now 同一天才算今日
  const today = dayKey(0, now);
  const isToday = dayKey(loginAt, now) === today;
  const todayMs = isToday ? totalMs : 0;
  const todayCount = isToday ? items.length + (online ? 1 : 0) : 0;

  return {
    items: items.slice().reverse(),
    online,
    since: online ? loginAt : 0,
    currentMs,
    todayCount,
    todayMs,
    totalCount: items.length + (online ? 1 : 0),
    totalMs,
    evidence: 'server_fallback',
    fallback: true,
    serverLoginAt: loginAt,
    serverOfflineAt: offAt,
  };
}

/**
 * 把实时边沿历史与服务端证据合并：
 *  - 有实时会话 → 实时为准，附 serverCorroboration 佐证时间戳
 *  - 无实时会话 → 服务端兜底合成（标记 fallback）
 */
function mergeWithServerEvidence(historyMap, friends, now = Date.now()) {
  const out = {};
  const byGid = new Map();
  for (const f of Array.isArray(friends) ? friends : []) {
    const gid = Number(f && f.gid);
    if (Number.isFinite(gid) && gid > 0) byGid.set(gid, f);
  }
  const seen = new Set();
  for (const key of Object.keys(historyMap || {})) {
    const gid = Number(key);
    if (!Number.isFinite(gid) || gid <= 0) continue;
    seen.add(gid);
    const real = historyMap[key];
    const hasReal = !!real && ((Array.isArray(real.items) && real.items.length > 0) || real.online === true || Number(real.totalCount) > 0);
    const friend = byGid.get(gid);
    if (hasReal) {
      const corroboration = friend ? {
        serverLoginAt: toMs(friend.lastLoginAt) || 0,
        serverOfflineAt: offlineFromFriend(friend),
      } : null;
      out[gid] = { ...real, evidence: 'realtime', ...(corroboration ? { serverCorroboration: corroboration } : {}) };
    } else {
      const fallback = friend ? buildServerFallback(friend, now) : null;
      out[gid] = fallback || { ...(real || emptyHistory()), evidence: friend ? 'none' : 'realtime' };
    }
  }
  // 朋友名单里有、但历史表里完全没有的重点好友也补上兜底
  for (const [gid, friend] of byGid) {
    if (seen.has(gid)) continue;
    const fallback = buildServerFallback(friend, now);
    out[gid] = fallback || { ...emptyHistory(), evidence: 'none' };
  }
  return out;
}

module.exports = {
  toMs,
  offlineFromFriend,
  buildServerFallback,
  mergeWithServerEvidence,
};
