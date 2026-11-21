const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  generateDingTalkSign,
  buildDingTalkSignedRequest,
  DINGTALK_WEBHOOK_RE,
} = require('../src/services/dingtalk-sign');

// 测试夹具：随机占位密钥/Webhook，非真实凭据
const SECRET = 'SEC' + 'a'.repeat(63);
const WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=' + 'b'.repeat(64);

test('加签结果稳定且 URL 安全', () => {
  const a = generateDingTalkSign(SECRET, '1700000000000');
  assert.equal(a, generateDingTalkSign(SECRET, '1700000000000'));
  assert.ok(!/[+/]/.test(a), 'base64 的 + / 必须已被 encodeURIComponent 转义');
  assert.notEqual(generateDingTalkSign(SECRET, '1700000000001'), a, '不同时间戳签名应不同');
});

test('签名算法 = HMAC-SHA256(secret, timestamp + 换行 + secret)', () => {
  const ts = '1700000000000';
  const expected = encodeURIComponent(
    crypto.createHmac('sha256', SECRET).update(`${ts}\n${SECRET}`).digest('base64'),
  );
  assert.equal(generateDingTalkSign(SECRET, ts), expected);
});

test('构造的请求 URL 带 timestamp/sign，body 是 text 消息', () => {
  const { url, body } = buildDingTalkSignedRequest({
    webhook: WEBHOOK,
    secret: SECRET,
    timestamp: '1700000000000',
    title: '账号下线提醒',
    content: 'Cyanh. 账号下线',
  });
  assert.ok(DINGTALK_WEBHOOK_RE.test(url));
  assert.ok(url.includes('&timestamp=1700000000000&sign='));
  assert.equal(body.msgtype, 'text');
  assert.ok(body.text.content.includes('账号下线提醒'));
  assert.ok(body.text.content.includes('Cyanh.'));
});

test('缺少密钥或非法 Webhook 抛错', () => {
  assert.throws(
    () => buildDingTalkSignedRequest({ webhook: WEBHOOK, secret: '', timestamp: '1' }),
    /加签密钥/,
  );
  assert.throws(
    () => buildDingTalkSignedRequest({ webhook: 'https://example.com/hook', secret: SECRET, timestamp: '1' }),
    /格式不正确/,
  );
});

test('push.js 已将 dingtalk_sign 渠道接入加签直推', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../src/services/push.js'), 'utf8');
  assert.ok(src.includes("channel === 'dingtalk_sign'"));
  assert.ok(src.includes('sendDingTalkSigned'));
});

test('store.js 的 PUSHOO_CHANNELS 白名单包含 dingtalk_sign（否则保存时被重置成 smtp）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../src/models/store.js'), 'utf8');
  assert.match(src, /PUSHOO_CHANNELS[\s\S]*?['"]dingtalk_sign['"]/);
});
