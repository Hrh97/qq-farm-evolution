// 种子礼包识别（零依赖纯函数）。
// 这些是活动产出的"打开随机得种子"礼盒：面板显示 usable=false、本地 ItemInfo
// 未登记、interaction_type 为空，只能靠 ID 白名单识别。Use/BatchUse 接口实测
// 可用（uid 传 0 由服务端自查；count>1 一次可开多个）。
const SEED_GIFT_PACK_IDS = new Set([
  101620, // 南瓜种子礼包
  101621, // 荷风种子礼包
  101622, // 千星种子礼包
  101623, // 萌宠种子礼包
]);

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 从背包物品里挑出种子礼包，生成 BatchUse 负载。
 * @param {Array<{id:*, count:*}>} items 背包物品（getBagItems 结果）
 * @returns {Array<{id:number, count:number}>}
 */
function collectSeedGiftPayloads(items) {
  const map = new Map();
  for (const item of items || []) {
    const id = toNum(item && item.id);
    const count = Math.max(0, toNum(item && item.count));
    if (id <= 0 || count <= 0) continue;
    if (!SEED_GIFT_PACK_IDS.has(id)) continue;
    map.set(id, (map.get(id) || 0) + count);
  }
  return Array.from(map.entries()).map(([id, count]) => ({ id, count }));
}

module.exports = { SEED_GIFT_PACK_IDS, collectSeedGiftPayloads };
