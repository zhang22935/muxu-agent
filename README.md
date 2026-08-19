# 苜蓿爆款 Agent 工作台 · AI Agent 实战 Demo

> 对应「AI Agent 实战题」**题2 每日热点→爆款** + **题5 爆款拆解→二创**
> **真·可用**版本：所有评分/拆解/生成都通过真实 LLM 完成，所有热点都从公开 API 真实抓取

---

## 在线 Demo

- **GitHub Pages**：<https://zhang22935.github.io/muxu-agent/>
- **仓库地址**：<https://github.com/zhang22935/muxu-agent>

打开即用，在「设置」中填入 DeepSeek API Key 即可跑完整工作流。

---

## 一句话总结

打开 `index.html` → 设置里填 DeepSeek Key → 一键跑两个 Agent，**0 假数据，0 字符串拼接，0 前端 mock**。

---

## 文件结构

```
agent-demo/
├── index.html                # UI 主体（单页 4 Tab + 2 Modal）
├── llm.js                    # DeepSeek 客户端（OpenAI 兼容，含流式/重试/tracing）
├── fetchers.js               # 多源真实抓取（头条/B站/百度/抖音）+ CORS 代理策略
├── agents.js                 # Agent 1 / Agent 2 业务逻辑（真正调用 LLM）
├── proxy-example.js          # 本地 CORS 代理（Node.js，30 秒可起）
├── proxy-cloudflare-worker.js # Cloudflare Worker 版公网代理（推荐）
├── manifest.json             # PWA 配置
└── README.md                 # 本文件
```

---

## 怎么用（30 秒上手）

### 1. 启动本地服务（任意一种方式）

```bash
# 方式 A：Python（最简单）
cd agent-demo
python -m http.server 8080

# 方式 B：Node.js
npx serve .
```

### 2. 打开 `http://localhost:8080/`

### 3. 第一次打开会弹出"设置"

**必填**：DeepSeek API Key
- 申请地址：<https://platform.deepseek.com>
- 国内直连，价格约 1 元/百万 tokens

**选填**：代理 URL
- 留空 → 尝试公共代理（不一定稳）
- 推荐 → 跑 `proxy-example.js` 自建

### 4. 跑 Agent

- Tab 「🟧 热点→爆款」→ 点「🚀 一键跑 Agent 1」
- Tab 「🟪 拆解→二创」→ 粘贴爆款文本 → 点「🚀 拆解 + 生成二创」

---

## 自建 CORS 代理（关键）

浏览器直连微博/头条/B站会被 CORS 拦。**最简方案**（30 秒）：

```bash
# 1. 装 Node.js（已装就跳过）
# 2. 跑代理
cd agent-demo
node proxy-example.js

# 3. 终端会显示 "代理已启动 http://localhost:8088"
# 4. 工作台设置 → 代理 URL 填：http://localhost:8088/?url=
```

代理会白名单：微博、头条、B站、百度、抖音、小红书、知乎。

### 部署到云端（推荐给 GitHub Pages 用户）

**Cloudflare Worker**（5 行代码就能跑）：

```javascript
// worker.js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('Missing ?url=', { status: 400 });
    const resp = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.baidu.com/' }
    });
    const body = await resp.text();
    return new Response(body, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': resp.headers.get('content-type') || 'text/plain' }
    });
  }
};
```

部署完填 `https://your-worker.workers.dev/?url=` 到工作台。

---

## 真实在哪

| 模块 | 之前（mock） | 现在（真） |
|---|---|---|
| 热点数据 | 写死 40 条假数据 | **4 路真实抓取** + 30 分钟缓存 |
| 评分公式 | 前端 if-else 拼字符串 | **DeepSeek 4 维真实评分** + JSON 模式 |
| 拆解 | 写死 5 段模板 | **DeepSeek 5 维真实拆解** + 找撬动机制 |
| 二创 | 模板套话 | **DeepSeek 真实生成 ≥3 条**，每条标"换的是什么" + 双算相似度 |
| 工作流 | 假装思考中 | **真实 LLM 请求**：耗时、token、模型名、思考内容全部可见 |
| API Key | 写死 | 用户自带，存 localStorage，不出网 |
| 持久化 | 简单 list | 内容资产库 + 发布追踪表 + 一键导出 Markdown |

---

## 部署到 GitHub Pages

```bash
# 1. 初始化 git（首次）
git init && git add . && git commit -m "init"

# 2. 推到 GitHub
# 在 GitHub 网页建一个 repo，名字叫 muxu-agent-demo
git remote add origin https://github.com/你的用户名/muxu-agent-demo.git
git branch -M main
git push -u origin main

# 3. 开 Pages
# GitHub repo → Settings → Pages → Source: main branch / root → Save
# 几分钟后访问：https://你的用户名.github.io/muxu-agent-demo/
```

> 注意：GitHub Pages 是纯静态站，**DeepSeek API 调用是 CORS 友好的直接从浏览器发**，不需要后端。
> 只有"抓多源热点"需要代理。可以填 Cloudflare Worker URL。

---

## 架构图

```
┌────────────────────────────────────────────────┐
│  浏览器（GitHub Pages 静态站）                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ index    │  │ llm.js   │  │ fetchers │      │
│  │ .html    │──│ (DeepSeek│──│ .js      │      │
│  │ (UI)     │  │  客户端)  │  │ (抓取)   │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│        │              │             │            │
│        ▼              ▼             ▼            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ agents.js│  │  local   │  │ CORS     │      │
│  │ (业务)   │  │  Storage │  │ Proxy    │      │
│  └──────────┘  └──────────┘  └────┬─────┘      │
└────────────────────────────────────┼────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
        ┌──────────┐         ┌──────────┐          ┌──────────┐
        │ DeepSeek │         │ 微博/头条 │          │ Cloudflare│
        │   API    │         │  /B站/百度 │          │  Worker   │
        └──────────┘         └──────────┘          └──────────┘
        （CORS OK）         （被 CORS 拦，         （用户自配）
                             走代理）
```

---

## 自检 Checklist

部署前请逐条过：

- [ ] 打开 `index.html`，设置填入 DeepSeek Key，弹出"LLM 已就绪"
- [ ] Tab 1 点"一键跑 Agent 1"，看到真实 LLM 输出（耗时/token），不是硬编码
- [ ] Tab 2 粘贴一段爆款文本，跑完后看到 5 维评分 + ≥3 条差异化二创
- [ ] 内容资产库能看到刚入库的脚本，导出 Markdown 是真文件
- [ ] 浏览器 DevTools → Network 看到发往 `api.deepseek.com` 的真实请求

---

## 评估要点

- **真实数据**：见 fetchers.js，4 路源 + CORS 策略 + 缓存兜底
- **真实 LLM**：见 llm.js 和 agents.js，每次评分/拆解/生成都打 `LLM.call`/`LLM.callJSON`
- **工作流可视化**：UI 上每个 step 都有"等待/进行中/完成"三态 + 真实耗时/token
- **可复用**：4 个模块解耦清晰，UI/数据/业务/持久化分开，换 LLM 或加源都很容易
- **可上线**：纯静态，GitHub Pages 一行 push 就发布
- **可审计**：trace 日志写 localStorage，token 用量、模型名、错误全部记录

---

## License

MIT。随便用，记得给苜蓿点个关注 🍳
