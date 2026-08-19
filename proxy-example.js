/* ============================================================
 * 苜蓿爆款 Agent · 本地 CORS 代理（用户自配，30 秒跑起来）
 * ============================================================
 *
 * 用法（任选一种）：
 *
 * 方式 1：本地跑（推荐，1 分钟搞定）
 *   1) 安装 Node.js（https://nodejs.org）
 *   2) 把这个文件保存为 proxy.js
 *   3) 在 proxy.js 所在目录执行： node proxy.js
 *   4) 终端会显示 "代理已启动 http://localhost:8088"
 *   5) 打开工作台 → 设置 → "代理 URL" 填 http://localhost:8088/?url=
 *   6) 现在抓的是真数据：微博/头条/B站/百度
 *
 * 方式 2：部署到云（Vercel/Netlify/Cloudflare Workers）
 *   Cloudflare Worker 只需把这个 handler 改成 fetch 事件即可
 *   部署后填：https://your-worker.workers.dev/?url=
 *
 * 方式 3：用一个现成 Cloudflare Worker
 *   import { proxy } from 'https://your-cors-proxy.example.com/';
 * ============================================================ */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 8088;

// 允许的源（白名单，避免被滥用）
const ALLOWED = [
  'weibo.com', 'www.weibo.com', 's.weibo.com', 'weibo.cn', 'm.weibo.cn',
  'toutiao.com', 'www.toutiao.com',
  'bilibili.com', 'www.bilibili.com', 'api.bilibili.com',
  'baidu.com', 'www.baidu.com', 'top.baidu.com',
  'douyin.com', 'www.douyin.com', 'iesdouyin.com', 'www.iesdouyin.com',
  'xiaohongshu.com', 'www.xiaohongshu.com',
  'zhihu.com', 'www.zhihu.com',
  '36kr.com', 'gateway.36kr.com', '36kr.cn',
  'tophub.today', 'www.tophub.today'
];

function isAllowed(u) {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return ALLOWED.some(d => host === d || host.endsWith('.' + d));
  } catch (e) { return false; }
}

// 专用抓取头（按 host 分发，绕开平台 UA 检测）
const HOST_HEADERS = {
  'weibo.com': {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://m.weibo.cn/',
    'Accept': 'application/json, text/plain, */*',
    'MWeibo-Pwa': '1',
    'X-Requested-With': 'XMLHttpRequest'
  },
  'm.weibo.cn': {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://m.weibo.cn/',
    'Accept': 'application/json, text/plain, */*',
    'MWeibo-Pwa': '1',
    'X-Requested-With': 'XMLHttpRequest'
  },
  'toutiao.com': {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.toutiao.com/',
    'Accept': 'application/json, text/plain, */*'
  },
  'bilibili.com': {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
    'Accept': 'application/json, text/plain, */*'
  },
  'baidu.com': {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.baidu.com/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  },
  'douyin.com': {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.douyin.com/',
    'Accept': 'application/json, text/plain, */*',
    'Cookie': ''  // 抖音需要 cookie，但部分接口不要求
  }
};

function getHeadersFor(hostname) {
  // 精确匹配 → 后缀匹配 → 默认
  if (HOST_HEADERS[hostname]) return HOST_HEADERS[hostname];
  for (const k of Object.keys(HOST_HEADERS)) {
    if (hostname.endsWith('.' + k) || hostname.endsWith(k)) return HOST_HEADERS[k];
  }
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.baidu.com/'
  };
}

function fetchUpstream(targetUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const headers = getHeadersFor(url.hostname);

    const makeReq = (target) => {
      const u = new URL(target);
      const m = u.protocol === 'https:' ? https : http;
      const req = m.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { ...headers, Host: u.hostname },
        timeout: 15000
      }, (res) => {
        // 跟 302/301 一次
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = new URL(res.headers.location, target).toString();
          res.resume();
          makeReq(next);
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        }));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('upstream timeout')));
      req.end();
    };
    makeReq(targetUrl);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  const u = new URL(req.url, 'http://localhost');
  const target = u.searchParams.get('url');

  // 健康检查
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('苜蓿爆款 Agent 代理已启动\n用法：GET /?url=https://weibo.com/ajax/side/hotSearch\n');
  }

  if (!target) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Missing ?url= parameter\n');
  }

  if (!isAllowed(target)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Domain not allowed: ' + new URL(target).hostname + '\n允许列表：' + ALLOWED.join(', '));
  }

  try {
    const up = await fetchUpstream(target);
    res.writeHead(up.status, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': '*',
      'Content-Type': up.headers['content-type'] || 'application/octet-stream'
    });
    res.end(up.body);
  } catch (e) {
    res.writeHead(502, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('Upstream fetch failed: ' + e.message);
  }
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log('苜蓿爆款 Agent 代理已启动');
  console.log('监听端口: ' + PORT);
  console.log('健康检查: http://localhost:' + PORT + '/health');
  console.log('用法:     http://localhost:' + PORT + '/?url=<目标 URL>');
  console.log('========================================');
  console.log('允许的源: ' + ALLOWED.join(', '));
});
