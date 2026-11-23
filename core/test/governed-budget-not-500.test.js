const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminRouteHelpers } = require('../src/controllers/admin-route-helpers');

function makeHelpers() {
  return createAdminRouteHelpers({
    store: { getAntiResaleConfig: () => ({ accountLimitEnabled: false }) },
    userStore: { getAllUsers: () => [] },
    logger: { warn() {}, error() {} },
    getProvider: () => ({}),
  });
}

// 捕获 sendProviderError 的响应，避免依赖真实 express res
function capture(err) {
  const out = { status: null, body: null };
  const res = {
    headersSent: false, writableEnded: false, destroyed: false,
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
  makeHelpers().sendProviderError(res, err);
  return out;
}

test('治理器预算拒绝（message 文案）返回 200 + ok:false，不是 500', () => {
  const err = new Error('请求被治理器拦截(budget_total): Bag');
  const out = capture(err);
  assert.equal(out.status, null, '不应调用 res.status(500)');
  assert.deepEqual(out.body, { ok: false, error: err.message });
});

test('结构化治理器标记（跨进程字段保留）同样 200', () => {
  const err = new Error('some wrapped message');
  err.isGovernedRejection = true;
  err.governedReason = 'budget_friend';
  const out = capture(err);
  assert.equal(out.status, null);
  assert.equal(out.body.ok, false);
});

test('非预算的治理器拒绝 / 普通错误仍走 500', () => {
  const governedOther = new Error('请求被治理器拦截(other_reason): Bag');
  assert.equal(capture(governedOther).status, 500);
  assert.equal(capture(new Error('真实内部错误 boom')).status, 500);
  // 文案格式不对（缺少方法名）不放宽
  assert.equal(capture(new Error('请求被治理器拦截(budget_total)')).status, 500);
});

test('原有预期错误（API Timeout / 账号未运行 / 面板未就绪）仍是 200', () => {
  for (const msg of ['API Timeout', '账号未运行', '账号未就绪（未登录或连接未打开），请稍后重试']) {
    const out = capture(new Error(msg));
    assert.equal(out.status, null, msg);
    assert.equal(out.body.ok, false);
  }
});
