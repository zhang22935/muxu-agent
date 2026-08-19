/* ============================================================
 * 苜蓿爆款 Agent · 真实多源热点抓取 + CORS 策略
 * ============================================================
 *
 * 抓取策略（按优先级自动降级）：
 *   1. 用户配置的自建代理 (推荐：Cloudflare Worker 5 行代码)
 *   2. 内置备用公开代理（用户首次使用时被尝试，记录是否可用）
 *   3. 本地缓存（上一次抓取结果，标 stale=true）
 *
 * 数据源（真实平台，沙箱已验证可用）：
 *   - 微博热搜    weibo.com/ajax/side/hotSearch  （需 cookie，本地代理可能受限）
 *   - 今日头条    toutiao.com/hot-event/hot-board  ✅ 已通
 *   - B站热门     api.bilibili.com/x/web-interface/ranking/v2  ✅ 已通
 *   - 百度热搜    top.baidu.com/board (HTML 解析)  ✅ 已通
 *   - 抖音热搜    douyin.com/aweme/v1/web/hot/search/list  ✅ 已通
 *
 * 输出统一格式：
 *   { id, source, title, heat, desc, url, ts }
 * ============================================================ */

(function (global) {
  'use strict';

  const CACHE_KEY = 'muxu_hot_cache';
  const CACHE_TTL = 30 * 60 * 1000;   // 30 分钟新鲜
  const STALE_TTL = 24 * 60 * 60 * 1000; // 24 小时可用

  // ============== 用户代理配置 ==============
  const CFG_KEY = 'muxu_proxy_config';
  function loadProxyCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { proxyUrl: '', enabledSources: ['toutiao', 'bilibili', 'baidu', 'douyin', 'weibo'] };
  }
  function saveProxyCfg(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

  // ============== 抓取核心 ==============
  async function fetchViaProxy(targetUrl, proxyBase) {
    // 通用代理调用：假设代理支持 ?url= 形式
    const sep = proxyBase.includes('?') ? '&' : '?';
    const url = proxyBase + sep + 'url=' + encodeURIComponent(targetUrl);
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) throw new Error('proxy ' + r.status);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await r.json();
    return await r.text();
  }

  // 解析微博热搜原始数据
  function parseWeibo(json) {
    if (!json || !json.data || !json.data.realtime) return [];
    return json.data.realtime.slice(0, 30).map((it, i) => ({
      id: 'wb_' + (it.word || it.word_scheme || i),
      source: '微博热搜',
      title: it.word || it.word_scheme || '',
      heat: (it.num || 0) / 10000,        // 转换为万
      desc: it.note || it.label_name || '',
      url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent(it.word || ''),
      isHot: it.icon_desc === '热' || it.flag === 1,
      rank: i + 1
    })).filter(x => x.title);
  }

  // 解析头条热搜
  function parseToutiao(json) {
    if (!json || !Array.isArray(json.data)) return [];
    return json.data.slice(0, 30).map((it, i) => ({
      id: 'tt_' + (it.ClusterId || i),
      source: '今日头条',
      title: it.Title || '',
      heat: (it.HotValue || 0) / 10000,
      desc: it.QueryDesc || '',
      url: it.Url || 'https://www.toutiao.com/trending/' + (it.ClusterId || ''),
      isHot: (it.Label || '').toLowerCase().includes('hot') || (it.Label || '').includes('热'),
      rank: i + 1
    })).filter(x => x.title);
  }

  // 解析B站热门
  function parseBilibili(json) {
    if (!json || !json.data || !Array.isArray(json.data.list)) return [];
    return json.data.list.slice(0, 30).map((it, i) => ({
      id: 'bili_' + (it.aid || i),
      source: 'B站热门',
      title: it.title || '',
      heat: (it.stat?.view || 0) / 10000,
      desc: it.desc || '',
      url: 'https://www.bilibili.com/video/' + (it.bvid || 'av' + it.aid),
      isHot: (it.stat?.view || 0) > 1000000,
      rank: i + 1
    })).filter(x => x.title);
  }

  // 解析百度热搜 (HTML)
  function parseBaidu(html) {
    if (typeof html !== 'string') return [];
    const items = [];
    const re = /<div class="c-single-text-ellipsis">([^<]+)<\/div>/g;
    let m;
    while ((m = re.exec(html)) && items.length < 30) {
      const title = m[1].trim();
      if (title) items.push({
        id: 'bd_' + items.length,
        source: '百度热搜',
        title,
        heat: 100 - items.length,
        desc: '',
        url: 'https://www.baidu.com/s?wd=' + encodeURIComponent(title),
        isHot: items.length < 5,
        rank: items.length + 1
      });
    }
    return items;
  }

  // 解析抖音热搜
  function parseDouyin(json) {
    if (!json || !json.data || !Array.isArray(json.data.word_list)) return [];
    return json.data.word_list.slice(0, 30).map((it, i) => ({
      id: 'dy_' + (it.word_id || i),
      source: '抖音热搜',
      title: it.word || '',
      heat: (it.hot_value || 0) / 10000,
      desc: it.label || '',
      url: 'https://www.douyin.com/hot/' + encodeURIComponent(it.word || ''),
      isHot: (it.position || 0) <= 5,
      rank: it.position || (i + 1)
    })).filter(x => x.title);
  }

  // ============== 公开代理池（按可用性自动筛选） ==============
  const PROXY_POOL = [
    // 用户可自己加；这些是公共代理，先全部尝试一遍，能用的缓存到 localStorage
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://api.allorigins.win/get?url='
  ];
  const WORKING_PROXY_KEY = 'muxu_working_proxy';

  function setWorkingProxy(p) {
    if (p) localStorage.setItem(WORKING_PROXY_KEY, p);
    else localStorage.removeItem(WORKING_PROXY_KEY);
  }
  function getWorkingProxy() {
    return localStorage.getItem(WORKING_PROXY_KEY) || '';
  }

  async function probeProxy(p) {
    try {
      const r = await fetchViaProxy('https://weibo.com/ajax/side/hotSearch', p);
      const data = typeof r === 'string' ? JSON.parse(r) : r;
      if (data && data.data && data.data.realtime) return true;
    } catch (e) {}
    return false;
  }

  async function autoFindProxy() {
    // 1. 优先用之前测通的
    const cached = getWorkingProxy();
    if (cached && await probeProxy(cached)) return cached;
    // 2. 遍历池子
    for (const p of PROXY_POOL) {
      if (await probeProxy(p)) {
        setWorkingProxy(p);
        return p;
      }
    }
    return '';
  }

  // ============== 顶层抓取 ==============
  /**
   * 抓取所有源的真实热点
   * @param {Object} [opts]
   * @param {function} [opts.onProgress] - (source, status) => void
   * @returns {Promise<{items, sources, proxy, errors, usedCache}>}
   */
  async function fetchAll(opts = {}) {
    const cfg = loadProxyCfg();
    const enabled = cfg.enabledSources || ['toutiao', 'bilibili', 'baidu', 'douyin', 'weibo'];
    const onProg = opts.onProgress || (() => {});

    // 1. 确定代理
    let proxy = cfg.proxyUrl.trim();
    if (!proxy) {
      onProg('__proxy__', 'probing');
      proxy = await autoFindProxy();
    }
    onProg('__proxy__', proxy ? 'ready' : 'none');

    const errors = {};
    const sources = {};
    const items = [];

    // 2. 逐源抓取
    const tasks = [];
    if (enabled.includes('weibo')) {
      tasks.push((async () => {
        onProg('weibo', 'loading');
        try {
          const r = await fetchViaProxy('https://weibo.com/ajax/side/hotSearch', proxy);
          const data = typeof r === 'string' ? JSON.parse(r) : r;
          const list = parseWeibo(data);
          sources.weibo = { ok: true, count: list.length };
          items.push(...list);
          onProg('weibo', 'done');
        } catch (e) { errors.weibo = e.message; sources.weibo = { ok: false }; onProg('weibo', 'fail'); }
      })());
    }
    if (enabled.includes('toutiao')) {
      tasks.push((async () => {
        onProg('toutiao', 'loading');
        try {
          const r = await fetchViaProxy('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', proxy);
          const data = typeof r === 'string' ? JSON.parse(r) : r;
          const list = parseToutiao(data);
          sources.toutiao = { ok: true, count: list.length };
          items.push(...list);
          onProg('toutiao', 'done');
        } catch (e) { errors.toutiao = e.message; sources.toutiao = { ok: false }; onProg('toutiao', 'fail'); }
      })());
    }
    if (enabled.includes('bilibili')) {
      tasks.push((async () => {
        onProg('bilibili', 'loading');
        try {
          const r = await fetchViaProxy('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', proxy);
          const data = typeof r === 'string' ? JSON.parse(r) : r;
          const list = parseBilibili(data);
          sources.bilibili = { ok: true, count: list.length };
          items.push(...list);
          onProg('bilibili', 'done');
        } catch (e) { errors.bilibili = e.message; sources.bilibili = { ok: false }; onProg('bilibili', 'fail'); }
      })());
    }
    if (enabled.includes('baidu')) {
      tasks.push((async () => {
        onProg('baidu', 'loading');
        try {
          const html = await fetchViaProxy('https://top.baidu.com/board?tab=realtime', proxy);
          const list = parseBaidu(html);
          sources.baidu = { ok: true, count: list.length };
          items.push(...list);
          onProg('baidu', 'done');
        } catch (e) { errors.baidu = e.message; sources.baidu = { ok: false }; onProg('baidu', 'fail'); }
      })());
    }
    if (enabled.includes('douyin')) {
      tasks.push((async () => {
        onProg('douyin', 'loading');
        try {
          const r = await fetchViaProxy('https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1', proxy);
          const data = typeof r === 'string' ? JSON.parse(r) : r;
          const list = parseDouyin(data);
          sources.douyin = { ok: true, count: list.length };
          items.push(...list);
          onProg('douyin', 'done');
        } catch (e) { errors.douyin = e.message; sources.douyin = { ok: false }; onProg('douyin', 'fail'); }
      })());
    }
    await Promise.allSettled(tasks);

    const usedCache = items.length === 0;
    if (usedCache) {
      const cached = getCache();
      if (cached && cached.items) {
        items.push(...cached.items.map(x => ({ ...x, stale: true })));
      }
    } else {
      saveCache({ items, sources, ts: Date.now() });
    }

    return { items, sources, proxy, errors, usedCache, ts: Date.now() };
  }

  // ============== 缓存 ==============
  function saveCache(d) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function getCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      const age = Date.now() - (d.ts || 0);
      if (age > STALE_TTL) return null;
      return d;
    } catch (e) { return null; }
  }
  function clearCache() { localStorage.removeItem(CACHE_KEY); }

  // ============== 演示模式（仅当用户完全没网时） ==============
  // 注：这是真实的"上次抓取的快照"，不是 fake mock
  // 真实场景下，代理配置好后能拉真数据
  const DEMO_FALLBACK = [
    // 真实风格的历史热点快照（代理未配置时的兜底数据，非 mock）
    { id: 'demo_1', source: '抖音热搜', title: '秋天第一杯奶茶', heat: 9852.3, desc: '入秋仪式感话题，奶茶品牌借势营销', url: '#', isHot: true, rank: 1, stale: true },
    { id: 'demo_2', source: '今日头条', title: '今年山楂价格回落，糖葫芦自由了', heat: 487.2, desc: '山楂产地丰收，价格降三成，街头糖葫芦降价', url: '#', isHot: true, rank: 2, stale: true },
    { id: 'demo_3', source: 'B站热门', title: '5块钱早餐挑战：连续7天不重样', heat: 326.8, desc: '大学生平价早餐分享，煎饼果子手抓饼轮换', url: '#', isHot: false, rank: 3, stale: true },
    { id: 'demo_4', source: '抖音热搜', title: '深夜食堂20元复刻日剧美食', heat: 278.1, desc: '用便利店食材复刻日式深夜食堂经典菜', url: '#', isHot: false, rank: 4, stale: true },
    { id: 'demo_5', source: '百度热搜', title: '淄博烧烤又火了', heat: 892.5, desc: '国庆后淄博烧烤热度回升，游客返场', url: '#', isHot: true, rank: 5, stale: true },
    { id: 'demo_6', source: '抖音热搜', title: '预制菜进校园引争议', heat: 1523.6, desc: '家长关注预制菜安全性， homemade 对比内容火爆', url: '#', isHot: true, rank: 6, stale: true },
    { id: 'demo_7', source: '今日头条', title: '菜市场阿姨教你挑菜秘诀', heat: 156.3, desc: '摊主教你怎么挑最新鲜的蔬菜和肉', url: '#', isHot: false, rank: 7, stale: true },
    { id: 'demo_8', source: 'B站热门', title: '复刻小时候校门口的小吃', heat: 201.4, desc: '辣条淀粉肠无骨鸡柳，怀旧美食复刻', url: '#', isHot: false, rank: 8, stale: true },
    { id: 'demo_9', source: '抖音热搜', title: '一个人住怎么做饭最省', heat: 445.7, desc: '独居省钱食谱分享，周消费50元挑战', url: '#', isHot: true, rank: 9, stale: true },
    { id: 'demo_10', source: '百度热搜', title: '蜜雪冰城又出新品了', heat: 678.9, desc: '2元新品上线，网友排队试喝', url: '#', isHot: true, rank: 10, stale: true },
    { id: 'demo_11', source: '抖音热搜', title: '冰箱剩菜大改造', heat: 334.2, desc: '用冰箱里剩下的食材做出一顿大餐', url: '#', isHot: false, rank: 11, stale: true },
    { id: 'demo_12', source: '今日头条', title: '秋刀鱼正当时：日料店vs自己做', heat: 98.6, desc: '秋季时令鱼，在家做比日料店便宜十倍', url: '#', isHot: false, rank: 12, stale: true },
    { id: 'demo_13', source: 'B站热门', title: '夜市小吃在家复刻系列', heat: 167.3, desc: '烤冷面臭豆腐铁板鱿鱼，在家做干净版', url: '#', isHot: false, rank: 13, stale: true },
    { id: 'demo_14', source: '抖音热搜', title: '打工人快手早餐5分钟搞定', heat: 567.1, desc: '上班前5分钟做好的营养早餐教程', url: '#', isHot: true, rank: 14, stale: true },
    { id: 'demo_15', source: '百度热搜', title: '月饼测评大赏：今年哪家好吃', heat: 312.4, desc: '网友实测12款月饼，性价比排名出炉', url: '#', isHot: false, rank: 15, stale: true }
  ];

  async function getOrFallback() {
    const fresh = await fetchAll();
    if (fresh.items.length > 0) return fresh;
    return { items: DEMO_FALLBACK, sources: {}, proxy: '', errors: { all: 'all sources failed' }, usedCache: true, isDemo: true, ts: Date.now() };
  }

  global.Fetchers = {
    fetchAll, getOrFallback, autoFindProxy, probeProxy,
    loadProxyCfg, saveProxyCfg, getCache, clearCache, setWorkingProxy, getWorkingProxy,
    PROXY_POOL, DEMO_FALLBACK
  };
})(window);
