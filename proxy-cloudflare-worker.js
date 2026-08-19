// 苜蓿爆款 Agent · Cloudflare Worker 版 CORS 代理
// 部署方法：登录 dash.cloudflare.com → Workers & Pages → Create → 粘贴本文件 → Deploy
// 部署完会得到一个 https://xxx.workers.dev 的公网 URL
// 填到工作台「设置 → 代理 URL」即可

const ALLOW = [
  'weibo.com', 'm.weibo.cn', 's.weibo.com',
  'toutiao.com', 'www.toutiao.com',
  'bilibili.com', 'api.bilibili.com', 'www.bilibili.com',
  'baidu.com', 'top.baidu.com',
  'douyin.com', 'www.douyin.com', 'iesdouyin.com',
  'xiaohongshu.com', 'www.xiaohongshu.com',
  'zhihu.com', 'www.zhihu.com',
  '36kr.com', 'www.36kr.com',
  'weibo.cn',
];

// 按 host 分发专用请求头
const HOST_HEADERS = {
  'weibo.com':       { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1', 'Referer': 'https://m.weibo.cn/', 'MWeibo-Pwa': '1' },
  'm.weibo.cn':      { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1', 'Referer': 'https://m.weibo.cn/', 'MWeibo-Pwa': '1' },
  's.weibo.com':     { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1', 'Referer': 'https://m.weibo.cn/', 'MWeibo-Pwa': '1' },
  'toutiao.com':     { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Referer': 'https://www.toutiao.com/' },
  'bilibili.com':    { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Referer': 'https://www.bilibili.com/' },
  'baidu.com':       { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Referer': 'https://www.baidu.com/' },
  'douyin.com':      { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Referer': 'https://www.douyin.com/' },
  'xiaohongshu.com': { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1', 'Referer': 'https://www.xiaohongshu.com/' },
  'zhihu.com':       { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Referer': 'https://www.zhihu.com/' },
  '36kr.com':        { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Referer': 'https://www.36kr.com/' },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function ok(res) {
  const headers = new Headers(res.headers);
  Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function deny(reason, status = 403) {
  return new Response(JSON.stringify({ error: reason }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

function pickHeaders(host) {
  for (const k of Object.keys(HOST_HEADERS)) {
    if (host === k || host.endsWith('.' + k)) return HOST_HEADERS[k];
  }
  return { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };
}

function isAllowed(host) {
  return ALLOW.some(d => host === d || host.endsWith('.' + d));
}

async function fetchUpstream(target) {
  let url = target;
  let res;
  // 跟随重定向（最多 5 次）
  for (let i = 0; i < 5; i++) {
    const u = new URL(url);
    const headers = pickHeaders(u.host);
    res = await fetch(u.toString(), { method: 'GET', headers, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) break;
      url = loc.startsWith('http') ? loc : new URL(loc, u).toString();
      continue;
    }
    break;
  }
  return res;
}

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET') return deny('method not allowed', 405);

    const u = new URL(req.url);
    // 1. 健康检查
    if (u.pathname === '/') {
      return new Response(JSON.stringify({
        ok: true,
        name: '苜蓿爆款代理',
        usage: 'GET /?url=https://weibo.com/ajax/side/hotSearch',
        whitelist: ALLOW
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (u.pathname === '/health') {
      return new Response('ok', { headers: CORS });
    }

    // 2. 代理目标
    const target = u.searchParams.get('url');
    if (!target) return deny('missing ?url=');
    let parsed;
    try { parsed = new URL(target); } catch (e) { return deny('invalid url'); }
    if (!isAllowed(parsed.host)) return deny('host not allowed: ' + parsed.host);

    try {
      const r = await fetchUpstream(target);
      return ok(r);
    } catch (e) {
      return deny('upstream error: ' + e.message, 502);
    }
  }
}
