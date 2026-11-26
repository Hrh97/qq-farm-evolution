// 化肥道具「每小时提供的容器时长」映射表（零依赖纯数据，供仓库自动填充与测试复用）。
//
// 命名规则：道具名里的「(N小时)」就是它注入容器的小时数。
// 普通化肥 80001~80004 = 1/4/8/12 小时；有机化肥 80011~80014 = 1/4/8/12 小时。
// 79873/80514/80132 是历史活动道具 ID，保留兼容旧存档。
//
// 背景：早期版本只有 79873/80514/80003/80132 四项，背包里常见的
// 80001(1h)/80002(4h)/80004(12h) 未登记，会走 interactionType fallback 被当成 1 小时，
// 导致容器快满时把 12 小时道具按 1 小时计算、一次塞入过多而溢出浪费。
// 这里补齐真实时长，让 autoOpenFertilizerGiftPacks 按 maxNeeded / perItemHours 精确限量。

const NORMAL_FERTILIZER_ITEM_HOURS = new Map([
  [79873, 1],   // 历史活动道具
  [80514, 4],   // 历史活动道具
  [80003, 8],
  [80132, 12],  // 历史活动道具
  [80001, 1],   // 化肥(1小时)
  [80002, 4],   // 化肥(4小时)
  [80004, 12],  // 化肥(12小时)
]);

const ORGANIC_FERTILIZER_ITEM_HOURS = new Map([
  [80011, 1],   // 有机化肥(1小时)
  [80012, 4],   // 有机化肥(4小时)
  [80013, 8],   // 有机化肥(8小时)
  [80014, 12],  // 有机化肥(12小时)
]);

/** 按物品 ID 取该道具注入容器的小时数；未登记返回 0（由调用方 fallback 处理）。 */
function getFertilizerItemHours(itemId, organic = false) {
  const id = Number(itemId) || 0;
  const table = organic ? ORGANIC_FERTILIZER_ITEM_HOURS : NORMAL_FERTILIZER_ITEM_HOURS;
  return table.get(id) || 0;
}

module.exports = {
  NORMAL_FERTILIZER_ITEM_HOURS,
  ORGANIC_FERTILIZER_ITEM_HOURS,
  getFertilizerItemHours,
};
