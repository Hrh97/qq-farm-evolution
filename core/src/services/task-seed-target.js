/**
 * 「任务优先」策略的共享状态：把成长任务里"购买N个XX种子"解析成目标 seedId，
 * 供种植买种子时优先选中，直到任务进度满足后自动失效。
 *
 * 设计取舍：
 * - 只认描述里明确带"购买...种子"字样的任务，且能从本地植物配置反查到 seedId；
 * - 目标带 needCount（任务要求总数）；进度 >= needCount 即视为满足，自动让位收益策略；
 * - 纯内存状态，随 worker 生命周期；任务扫描每轮都会重新登记，无需持久化。
 */
const { getAllPlants } = require('../config/gameConfig');

// 每个 worker 进程只服务一个游戏账号，进程内单目标即可（天然账号隔离）。
const STATE_KEY = 'current';
const targets = new Map();

function accountKey(_accountId) {
  return STATE_KEY;
}

/** 从任务描述解析"购买/种植N个XX(种子)"里的作物名和数量 */
function parseBuySeedTask(desc) {
  const text = String(desc || '');
  // 形态："购买8个玉米种子"、"种植8个玉米"、"购买 16 个土豆种子"
  // "种子"后缀可有可无；结尾锚定避免把"种子"两字吞进作物名。
  const m = text.match(/(?:购买|种植)\s*(\d+)\s*个\s*([\u4e00-\u9fa5A-Za-z0-9]+?)\s*(?:种子)?\s*$/);
  if (!m) return null;
  const count = Number(m[1]);
  let cropName = String(m[2] || '').trim().replace(/种子$/, '');
  if (!Number.isFinite(count) || count <= 0 || !cropName) return null;
  return { count, cropName };
}

/** 用作物名在本地植物配置里反查 seedId（精确匹配优先，其次包含匹配） */
function findSeedIdByName(cropName) {
  const plants = getAllPlants() || [];
  const name = String(cropName || '').trim();
  let contains = 0;
  for (const p of plants) {
    const pname = String(p && p.name || '').trim();
    const seedId = Number(p && p.seed_id);
    if (!pname || !Number.isFinite(seedId) || seedId <= 0) continue;
    if (pname === name) return seedId;
    if (!contains && (pname.includes(name) || name.includes(pname))) contains = seedId;
  }
  return contains;
}

/**
 * 登记一个任务目标。只有解析成功且能反查到 seedId 才登记。
 * @returns {{seedId:number,name:string,needCount:number}|null}
 */
function registerTaskTarget({ desc, progress, totalProgress, taskId, accountId, isCompleted, isClaimed }) {
  const parsed = parseBuySeedTask(desc);
  if (!parsed) return null;
  const seedId = findSeedIdByName(parsed.cropName);
  if (!seedId) return null;

  const needCount = Number(totalProgress) > 0 ? Number(totalProgress) : parsed.count;
  const done = isCompleted === true || isClaimed === true
    || (Number(progress) > 0 && Number(progress) >= needCount);

  const key = accountKey(accountId);
  if (done) {
    // 任务已完成：若当前目标正是它，清除，让位收益策略
    const cur = targets.get(key);
    if (cur && cur.seedId === seedId) targets.delete(key);
    return null;
  }

  const target = { seedId, name: parsed.cropName, needCount, taskId, desc, progress };
  targets.set(key, target);
  return target;
}

/** 当前目标；任务已完成/进度满足时返回 null */
function getTaskSeedTarget(accountId) {
  return targets.get(accountKey(accountId)) || null;
}

/** 清除指定账号目标（供测试/任务消失时用） */
function clearTaskSeedTarget(accountId) {
  targets.delete(accountKey(accountId));
}

module.exports = {
  parseBuySeedTask,
  findSeedIdByName,
  registerTaskTarget,
  getTaskSeedTarget,
  clearTaskSeedTarget,
};
