/**
 * 钉钉群机器人「加签」直推。
 * pushoo 内置 dingtalk 渠道只支持关键词安全设置；加签模式需要本地用
 * HMAC-SHA256(secret, timestamp + "\n" + secret) 计算签名并拼进 URL，
 * 因此这里独立实现，复用现有 channel 分发（channel = dingtalk_sign）。
 */
const crypto = require('node:crypto');

const DINGTALK_WEBHOOK_RE = /^https:\/\/oapi\.dingtalk\.com\/robot\/send\?access_token=/;

function assertText(name, value) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} 不能为空`);
  return text;
}

/** 生成钉钉加签签名（已 encodeURIComponent，可直接拼 URL） */
function generateDingTalkSign(secret, timestamp) {
  const key = assertText('加签密钥', secret);
  const ts = String(timestamp || '').trim();
  if (!ts) throw new Error('时间戳不能为空');
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(`${ts}\n${key}`);
  return encodeURIComponent(hmac.digest('base64'));
}

/** 构造带签名的完整请求 */
function buildDingTalkSignedRequest({ webhook, secret, timestamp = Date.now(), title = '', content = '' }) {
  const url = assertText('钉钉 Webhook', webhook);
  if (!DINGTALK_WEBHOOK_RE.test(url)) {
    throw new Error('钉钉 Webhook 格式不正确，应以 https://oapi.dingtalk.com/robot/send?access_token= 开头');
  }
  const ts = String(timestamp);
  const sign = generateDingTalkSign(secret, ts);
  const separator = url.includes('?') ? '&' : '?';
  const fullUrl = `${url}${separator}timestamp=${ts}&sign=${sign}`;
  const text = [String(title || '').trim(), String(content || '').trim()].filter(Boolean).join('\n');
  if (!text) throw new Error('推送内容不能为空');
  return {
    url: fullUrl,
    body: { msgtype: 'text', text: { content: text.slice(0, 20000) } },
  };
}

/** 发送一条加签钉钉文本消息 */
async function sendDingTalkSigned({ webhook, secret, title, content }) {
  const { url, body } = buildDingTalkSignedRequest({ webhook, secret, title, content });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (data.errcode !== undefined && Number(data.errcode) !== 0) {
    return {
      ok: false,
      code: String(data.errcode),
      msg: String(data.errmsg || '钉钉返回错误'),
      raw: data,
    };
  }
  if (!res.ok) {
    return { ok: false, code: String(res.status), msg: `钉钉 HTTP ${res.status}`, raw: data };
  }
  return { ok: true, code: 'ok', msg: '发送成功', raw: data };
}

module.exports = {
  generateDingTalkSign,
  buildDingTalkSignedRequest,
  sendDingTalkSigned,
  DINGTALK_WEBHOOK_RE,
};
