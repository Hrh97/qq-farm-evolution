'use strict';
// 预期业务错误不触发异常降速：图鉴领取(ClaimAllRewardsV2)与逐块施肥(Fertilize)
// 是"无可领/肥料用尽即业务拒绝"的高频收尾链路。这些业务错误必须打
// breakerExemptBusinessError，避免累计进 request-governor 的 15 分钟失败窗口
// 把整号普通巡查降速；网络超时/断线不带豁免标记，仍照常计入。
// 本文件锁定三件事：
// 1) 四个发包点对目标方法都传了 breakerExemptBusinessError: true；
// 2) network.js 的豁免链路仍在（仅业务错误豁免，不是所有失败豁免）；
// 3) request-governor 仍按 breakerExempt 标记排除失败计数。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (...parts) => fs.readFileSync(path.join(__dirname, '..', 'src', ...parts), 'utf8');

// 提取每个 sendMsgAsync 调用的参数文本（目标调用块内无嵌套圆括号）
function calls(text) {
  return [...text.matchAll(/sendMsgAsync\(([^)]*)\)/g)].map((m) => m[1]);
}

function assertMethodExempt(file, relPath, method) {
  const matches = calls(file).filter((args) => args.includes(`'${method}'`));
  assert.ok(matches.length > 0, `${relPath} 应至少有一处 ${method} 发包调用`);
  for (const args of matches) {
    assert.match(
      args,
      /breakerExemptBusinessError:\s*true/,
      `${relPath} 的 ${method} 发包必须标记 breakerExemptBusinessError: true（预期业务错误不计入异常降速）`,
    );
  }
}

test('图鉴领取与逐块施肥的业务拒绝不计入异常降速', () => {
  assertMethodExempt(src('services', 'task.js'), 'services/task.js', 'ClaimAllRewardsV2');
  assertMethodExempt(src('services', 'illustrated.js'), 'services/illustrated.js', 'ClaimAllRewardsV2');
  assertMethodExempt(src('services', 'farm-api.js'), 'services/farm-api.js', 'Fertilize');
  assertMethodExempt(src('services', 'farm-fertilizer.js'), 'services/farm-fertilizer.js', 'Fertilize');
});

test('network.js 仅对业务错误应用豁免标记', () => {
  const network = src('utils', 'network.js');
  assert.match(
    network,
    /breakerExempt\s*=\s*options\.breakerExemptBusinessError\s*===\s*true\s*&&\s*err\.isServerBusinessError\s*===\s*true/,
    '豁免必须同时要求调用方标记且确为服务器业务错误，网络超时/断线仍计入失败',
  );
});

test('request-governor 仍按 breakerExempt 排除失败计数', () => {
  const governor = src('services', 'request-governor.js');
  assert.match(
    governor,
    /options\.breakerExempt\s*!==\s*true/,
    'request-governor 仍须在 breakerExempt 时跳过 errEvents 入窗',
  );
});
