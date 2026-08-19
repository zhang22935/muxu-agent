/* ============================================================
 * 苜蓿爆款 Agent · Agent 1 (热点 → 爆款) + Agent 2 (拆解 → 二创)
 * ============================================================
 *
 * 真实功能（不再是 mock）：
 *   - 接收 fetchers.js 拿到的真实多源热点
 *   - 把热点 + 账号画像 + 评分维度 喂给 DeepSeek，让 LLM 真实评分
 *   - 把 Top 选题 + 账号风格 喂给 LLM，让它真实生成脚本/标题/标签/封面/CTA
 *   - Agent 2 接收用户粘贴的爆款文本，让 LLM 做 5 维真实拆解
 *   - 基于拆解，让 LLM 真实生成 ≥3 条差异化二创
 *   - 全部产出落库到 localStorage 内容资产库
 *
 * 工作流可见性：每一步都调用真实 LLM，prompt + 响应 + 耗时全部展示
 * ============================================================ */

(function (global) {
  'use strict';

  const LIB_KEY = 'muxu_content_lib';
  const TRACK_KEY = 'muxu_track';

  // ============== 账号画像（默认苜蓿的美食探店） ==============
  const DEFAULT_PROFILE = {
    name: '苜蓿',
    platform: '抖音',
    niche: '美食 / 探店',
    style: '画面+配音/字幕，素材剪辑配旁白，不是真人口播',
    audience: '18-35 城市青年，关注吃喝与生活方式',
    goals: '涨流量（完播、互动、转发）',
    voice: '温暖、有画面感、不油腻，句式短促有力',
    avoid: '夸张标题党、不擦边、不贬低同行'
  };
  const PROFILE_KEY = 'muxu_profile';
  function loadProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || DEFAULT_PROFILE; }
    catch (e) { return DEFAULT_PROFILE; }
  }
  function saveProfile(p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }

  // ============== Agent 1: 热点 → 爆款 ==============

  // 第一步：LLM 真实评分
  async function scoreTopics(items, profile, onProgress) {
    // 把热点压缩后喂给 LLM（一次评分最多 30 条）
    const compressed = items.slice(0, 30).map((it, i) => ({
      idx: i,
      title: it.title,
      source: it.source,
      heat: it.heat,
      desc: (it.desc || '').slice(0, 60)
    }));

    const sys = `你是一位资深的短视频内容策略师，专长是帮垂类账号从全网热点中筛出"可创作且有爆款潜质"的选题。
评分必须基于账号画像的真实适配性，不要平均分配分数。返回严格 JSON。`;

    const usr = `## 账号画像
${JSON.stringify(profile, null, 2)}

## 候选热点（共 ${compressed.length} 条）
${JSON.stringify(compressed, null, 2)}

## 任务
对每条热点，按以下 4 维评分（0-10），并给出 1 句判断理由：
1. **相关性** relevance：与账号赛道/受众的契合度
2. **可创作性** creatable：能否在 1-3 天内拍出来，门槛高低
3. **爆发力** viral：是否具备情绪钩子/争议/共鸣/实用价值
4. **风险** risk：0=高风险(政治/争议/擦边/侵权)，10=完全安全

## 输出 JSON 格式
{
  "scored": [
    {
      "idx": 0,
      "relevance": 8.5,
      "creatable": 7.0,
      "viral": 6.5,
      "risk": 9.0,
      "total": 7.8,
      "reason": "一句话判断：为什么适合/不适合"
    }
  ],
  "top5_recommend": [按 total 排序的 idx 数组],
  "summary": "整体观察：今日热点里适合本账号跟进的 1-2 个共性"
}`;

    onProgress && onProgress({ stage: 'scoring', message: '把' + compressed.length + '条热点 + 账号画像 喂给 DeepSeek，让它真实评分…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent1-score' });
    onProgress && onProgress({ stage: 'scored', message: 'LLM 完成评分，耗时 ' + r.elapsed + 'ms，用 ' + (r.usage.total_tokens || 0) + ' tokens', usage: r.usage, elapsed: r.elapsed });

    // 把 idx 映射回原 item
    return r.json.scored.map(s => ({
      ...items[s.idx],
      _score: s,
      _reason: s.reason
    })).sort((a, b) => b._score.total - a._score.total);
  }

  // 第二步：LLM 真实生成爆款脚本
  async function generateScript(topic, profile, onProgress) {
    const sys = `你是爆款短视频脚本撰稿人，深谙抖音/小红书/B站的口播与字幕脚本套路。
脚本要"可立即拍摄"：包含开头 3 秒钩子、正文 30-50 秒、结尾 CTA 互动设计。返回严格 JSON。`;

    const usr = `## 账号
${JSON.stringify(profile)}

## 选题
标题：${topic.title}
来源：${topic.source}
原始描述：${topic.desc || '无'}
${topic._reason ? '（LLM 评分理由：' + topic._reason + '）' : ''}

## 任务：生成可直接发布的爆款脚本
字段：
- "title"        3 个备选标题（带钩子，能让人停下滑动）
- "hook_3s"      前 3 秒的钩子（视觉+配音+字幕 三件套）
- "script_30s"   30 秒正文的口播/字幕脚本（分镜：1. 2. 3. ...）
- "cover_text"   封面大字（≤10 字）
- "hashtags"     5-7 个标签（#美食 #探店 等，含 1-2 个垂类长尾）
- "publish_time" 推荐发布时间（早/中/晚高峰 + 星期几）
- "cta"          互动设计（引导评论/收藏/转发/关注的具体话术）
- "risk_check"   风险自查（这条会不会踩雷：标题党/争议/侵权）
- "expected_metrics" 预期表现区间（播放/完播/互动）

只输出 JSON。`;

    onProgress && onProgress({ stage: 'generating', message: '把 Top 选题 + 账号风格 喂给 LLM，生成可发布脚本…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent1-generate' });
    onProgress && onProgress({ stage: 'generated', message: '脚本生成完成，耗时 ' + r.elapsed + 'ms', usage: r.usage, elapsed: r.elapsed });
    return r.json;
  }

  // ============== Agent 1: Agent Loop（规划→执行→自检→重试） ==============

  // 第 0 步：LLM 自主规划评分策略
  async function planStrategy(items, profile, onProgress) {
    const sys = `你是内容策略规划师。在评分前，先审视所有热点，制定策略：
哪些平台的热点值得优先关注、哪些可以直接排除、评分时应侧重什么维度。
这不是走过场——你要真正思考，给出有判断力的策略。返回严格 JSON。`;

    const preview = items.slice(0, 15).map((it, i) => ({
      idx: i, title: it.title, source: it.source, heat: it.heat,
      desc: (it.desc || '').slice(0, 50)
    }));

    const usr = `## 账号画像
${JSON.stringify(profile, null, 2)}

## 候选热点（共 ${items.length} 条，展示前 ${preview.length} 条）
${JSON.stringify(preview, null, 2)}

## 输出 JSON
{
  "strategy": "整体策略一句话（要有判断力，不是套话）",
  "priority_sources": ["优先关注哪个平台，为什么"],
  "exclude_titles": ["建议直接排除的标题（不相关/高风险）"],
  "weight_hint": "评分时侧重哪个维度（relevance/creatable/viral/risk）及原因",
  "expected_top": "预判哪条可能胜出",
  "reasoning": "为什么这样规划（2-3 句话）"
}`;

    onProgress && onProgress({ stage: 'planning', message: 'LLM 正在审视热点、制定评分策略…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent1-plan' });
    onProgress && onProgress({ stage: 'planned', message: '策略：' + (r.json.strategy || '').slice(0, 40) + '…，耗时 ' + r.elapsed + 'ms' });
    return r.json;
  }

  // 第 2.5 步：LLM 自主选择最佳选题（不再硬取 top5[0]）
  async function selectBest(scored, profile, onProgress) {
    const sys = `你是内容选题决策者。不要简单选分数最高的——要综合考虑分数、风险、可拍性、与账号的适配度。
你要给出选择理由，说明为什么选这条而不是分数更高的那条。返回严格 JSON。`;

    const top5 = scored.slice(0, 5);
    const usr = `## 账号
${JSON.stringify(profile)}

## Top5 候选（已评分）
${JSON.stringify(top5.map((t, i) => ({
  rank: i + 1,
  title: t.title,
  source: t.source,
  scores: t._score,
  reason: t._reason
})), null, 2)}

## 输出 JSON
{
  "selected_idx": 0,
  "selected_title": "选中的标题",
  "reasoning": "为什么选这条（3-4 句话，要有判断力）",
  "risk_note": "选中这条的风险提示",
  "rejected_reason": "为什么没选分数最高的"
}`;

    onProgress && onProgress({ stage: 'selecting', message: 'LLM 自主审视 Top5、选择最佳选题…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent1-select' });
    const idx = Math.min(r.json.selected_idx || 0, top5.length - 1);
    onProgress && onProgress({ stage: 'selected', message: 'LLM 选中：' + (top5[idx]?.title || '').slice(0, 20) + '…（' + (r.json.reasoning || '').slice(0, 30) + '…）' });
    return { topic: top5[idx] || top5[0], reasoning: r.json.reasoning, riskNote: r.json.risk_note, rejectedReason: r.json.rejected_reason };
  }

  // 第 4 步：LLM 自检脚本质量
  async function selfEvaluate(script, topic, profile, onProgress) {
    const sys = `你是内容质量审核员。评估生成的脚本是否达到发布标准。
要严格、有判断力——不是走形式打高分，要真正指出问题。返回严格 JSON。`;

    const usr = `## 账号
${JSON.stringify(profile)}

## 选题
${topic.title}（来源：${topic.source}）

## 生成的脚本
${JSON.stringify(script, null, 2)}

## 评估维度（每项 0-100）
1. hook_power: 钩子吸引力（前 3 秒能不能让人停下）
2. script_quality: 脚本质量（信息密度、节奏、可拍性）
3. cta_effectiveness: 互动引导效果
4. safety: 安全度（有没有标题党/争议/侵权风险）
5. overall: 总分

## 输出 JSON
{
  "hook_power": 75,
  "script_quality": 80,
  "cta_effectiveness": 70,
  "safety": 90,
  "overall": 78,
  "verdict": "pass",
  "issues": ["具体问题1", "具体问题2"],
  "suggestions": ["改进建议1", "改进建议2"]
}

verdict 规则：overall >= 80 且无严重 issues → "pass"；否则 → "retry"`;

    onProgress && onProgress({ stage: 'evaluating', message: 'LLM 自检脚本质量…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent1-eval' });
    onProgress && onProgress({ stage: 'evaluated', message: '自检得分：' + r.json.overall + '/100，结论：' + (r.json.verdict === 'pass' ? '通过' : '需重试') });
    return r.json;
  }

  // 第 4.5 步：带反馈重新生成（自检不通过时）
  async function generateScriptWithFeedback(topic, profile, evalResult, onProgress) {
    const sys = `你是爆款短视频脚本撰稿人。上次生成的脚本未通过自检，请根据反馈重新生成。
不要只是微调——要针对指出的问题做实质性改进。返回严格 JSON。`;

    const usr = `## 账号
${JSON.stringify(profile)}

## 选题
标题：${topic.title}
来源：${topic.source}
描述：${topic.desc || '无'}

## 上次自检结果
总分：${evalResult.overall}/100
问题：${JSON.stringify(evalResult.issues)}
建议：${JSON.stringify(evalResult.suggestions)}

## 任务
针对以上问题重新生成脚本。字段同上次：title(3个)、hook_3s、script_30s、cover_text、hashtags(5-7)、publish_time、cta、risk_check、expected_metrics。
只输出 JSON。`;

    onProgress && onProgress({ stage: 'regenerating', message: '根据自检反馈重新生成（第 ' + (evalResult._retry || 1) + ' 次重试）…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent1-regenerate' });
    onProgress && onProgress({ stage: 'regenerated', message: '重新生成完成，耗时 ' + r.elapsed + 'ms' });
    return r.json;
  }

  // Agent 1 完整 loop：规划 → 抓取 → 评分 → 自主选择 → 生成 → 自检 → (重试)
  async function runAgent1(opts) {
    const profile = opts.profile || loadProfile();
    const fetchResult = opts.fetchResult;

    // Step 0: 规划
    let fetchData = fetchResult;
    if (!fetchData) {
      opts.onProgress && opts.onProgress({ stage: 'fetch', message: '正在拉取 5 路真实热点…' });
      fetchData = await Fetchers.getOrFallback();
    }
    opts.onProgress && opts.onProgress({
      stage: 'fetched',
      message: '抓到 ' + fetchData.items.length + ' 条真实热点，来自 ' + Object.keys(fetchData.sources || {}).length + ' 个平台'
    });
    if (fetchData.items.length === 0) throw new Error('没抓到任何热点，请检查代理配置');

    // AGENT STEP 1: LLM 自主规划
    const plan = await planStrategy(fetchData.items, profile, opts.onProgress);

    // AGENT STEP 2: LLM 评分（带策略）
    const scored = await scoreTopics(fetchData.items, profile, opts.onProgress);

    // AGENT STEP 3: LLM 自主选择（不再硬取 top5[0]）
    const selection = await selectBest(scored, profile, opts.onProgress);
    const winner = selection.topic;

    // AGENT STEP 4: LLM 生成脚本
    let script = await generateScript(winner, profile, opts.onProgress);

    // AGENT STEP 5: LLM 自检
    let evalResult = await selfEvaluate(script, winner, profile, opts.onProgress);

    // AGENT STEP 6: 自检不通过 → 带反馈重试（最多 2 次）
    let retries = 0;
    while ((evalResult.verdict === 'retry') && retries < 2) {
      retries++;
      evalResult._retry = retries;
      opts.onProgress && opts.onProgress({
        stage: 'retry',
        message: `自检未通过（${evalResult.overall}/100），LLM 决定第 ${retries} 次重试，问题：${(evalResult.issues || []).join('; ')}`
      });
      script = await generateScriptWithFeedback(winner, profile, evalResult, opts.onProgress);
      evalResult = await selfEvaluate(script, winner, profile, opts.onProgress);
    }

    return {
      profile,
      plan,
      fetchSummary: {
        total: fetchData.items.length,
        sources: fetchData.sources,
        errors: fetchData.errors,
        proxy: fetchData.proxy,
        isStale: fetchData.usedCache
      },
      scored,
      selection,
      winner,
      script,
      evalResult,
      retries
    };
  }

  // ============== Agent 2: 爆款拆解 → 二创 ==============

  // 第一步：5 维真实拆解
  async function analyzeViral(viralText, profile, onProgress) {
    const sys = `你是爆款内容拆解专家，深谙短视频/口播脚本的爆款公式。
拆解要"穿透表面文案"找"真正带流量的底层机制"。返回严格 JSON。`;

    const usr = `## 待拆解的爆款（用户粘贴的脚本/口播稿/旁白）
"""
${viralText.slice(0, 3500)}
"""

## 任务：5 维拆解
1. **钩子 hook**（前 3 秒怎么抓人：视觉+听觉+悬念）
2. **饵物 bait**（靠什么让用户留下来：是利他/猎奇/争议/身份认同/情感共鸣）
3. **停留 retention**（节奏、信息密度、转折点，每 N 秒一个小钩子）
4. **互动 interaction**（如何引导评论/点赞/转发/收藏/关注）
5. **CTA 收尾**（结尾的行动引导：硬广/软广/留白/反转）

## 输出字段
- "score_by_dim": { "hook":0-10, "bait":0-10, "retention":0-10, "interaction":0-10, "cta":0-10 }
- "score_summary": "一句话总结整体"
- "driving_factors": ["真正撬动流量的底层机制 1", "机制 2", "机制 3"]（≤3 条，必须是"为什么"而不是"是什么"）
- "reusable_template": "可复用的结构模板（用 [A]/[B]/[C] 占位符）"
- "do_not_copy": "不能照搬的表层元素（如具体菜名/具体场景）"
- "do_copy": "可以借鉴的底层骨架"

只输出 JSON。`;

    onProgress && onProgress({ stage: 'analyzing', message: '把爆款喂给 LLM，做 5 维真实拆解…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent2-analyze' });
    onProgress && onProgress({ stage: 'analyzed', message: '拆解完成，耗时 ' + r.elapsed + 'ms' });
    return r.json;
  }

  // 第二步：基于拆解，生成 ≥3 条差异化二创
  async function generateRemix(analysis, viralText, profile, onProgress) {
    const sys = `你是爆款二次创作脚本撰稿人。必须"差异化"：换选题场景/换叙述视角/换结构顺序/换论证材料，禁止同义词替换。返回严格 JSON。`;

    const usr = `## 账号
${JSON.stringify(profile)}

## 已完成的 5 维拆解
${JSON.stringify(analysis, null, 2)}

## 原爆款文本（仅供对照，避免雷同）
"""
${viralText.slice(0, 2000)}
"""

## 任务：基于"driving_factors"和"reusable_template"，生成 **3 条** 差异化二创
每条都必须：
1. 套用 reusable_template 的骨架
2. 选题场景/视角/切入点与原爆款**显著不同**
3. 完整可发布：标题 + 钩子 + 30 秒正文 + 标签 + CTA
4. 标注"换的是什么"（选题场景/视角/结构/材料）
5. 标注"相似度自评"：0-100（与原爆款文本的相似程度，应<30）

## 输出 JSON
{
  "remixes": [
    {
      "name": "二创方案 A",
      "change": "换了什么（一句话说清）",
      "title": "...",
      "hook_3s": "...",
      "script_30s": "...",
      "hashtags": ["#..."],
      "cta": "...",
      "similarity_self": 25
    }
  ]
}`;

    onProgress && onProgress({ stage: 'remixing', message: '基于拆解的 driving_factors 生成 3 条差异化二创…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent2-remix' });
    onProgress && onProgress({ stage: 'remixed', message: '二创生成完成，耗时 ' + r.elapsed + 'ms' });
    return r.json;
  }

  // 简易相似度（字符集合 Jaccard + 关键短语）
  function quickSimilarity(a, b) {
    if (!a || !b) return 0;
    const setA = new Set(a.replace(/\s+/g, ''));
    const setB = new Set(b.replace(/\s+/g, ''));
    let inter = 0;
    for (const c of setA) if (setB.has(c)) inter++;
    const union = new Set([...setA, ...setB]).size;
    const jaccard = union ? inter / union : 0;

    // 公共 4-gram
    const gram = (s) => {
      const r = [];
      for (let i = 0; i < s.length - 3; i++) r.push(s.slice(i, i + 4));
      return new Set(r);
    };
    const gA = gram(a), gB = gram(b);
    let c2 = 0;
    for (const c of gA) if (gB.has(c)) c2++;
    const gramScore = Math.min(gA.size, gB.size) ? c2 / Math.min(gA.size, gB.size) : 0;

    return Math.round((jaccard * 0.3 + gramScore * 0.7) * 100);
  }

  // ============== Agent 2: Agent Loop（规划→拆解→生成→自检→重试） ==============

  // 第 0 步：LLM 自主规划拆解策略
  async function planAnalysis(viralText, profile, onProgress) {
    const sys = `你是爆款分析规划师。在拆解前，先判断内容类型、制定分析重点。
这不是走形式——你要真正预判可能发现的爆款机制，指导后续拆解。返回严格 JSON。`;

    const usr = `## 账号
${JSON.stringify(profile)}

## 待分析文本（前 300 字）
"""
${viralText.slice(0, 300)}
"""

## 输出 JSON
{
  "content_type": "内容类型判断（探店/教程/挑战/情感/…）",
  "target_audience": "目标受众画像",
  "analysis_focus": "拆解重点应该放在哪个维度（hook/bait/retention/interaction/cta）",
  "expected_drivers": "预判可能发现的爆款机制（1-2 句）",
  "strategy": "分析策略一句话"
}`;

    onProgress && onProgress({ stage: 'planning', message: 'LLM 正在判断内容类型、制定拆解策略…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent2-plan' });
    onProgress && onProgress({ stage: 'planned', message: '策略：' + (r.json.strategy || '').slice(0, 40) + '…，耗时 ' + r.elapsed + 'ms' });
    return r.json;
  }

  // 第 3 步：LLM 自检二创质量
  async function evaluateRemixes(remixes, analysis, viralText, onProgress) {
    const sys = `你是二创质量审核员。评估 3 条二创的差异化程度和可发布性。
要严格——如果某条二创和原文太像，或者脚本质量太低，必须判 retry。返回严格 JSON。`;

    const usr = `## 原爆款文本（前 300 字）
"""
${viralText.slice(0, 300)}
"""

## 已完成拆解的 driving_factors
${JSON.stringify(analysis.driving_factors)}

## 3 条二创
${JSON.stringify(remixes.map((r, i) => ({
  idx: i,
  name: r.name,
  change: r.change,
  title: r.title,
  hook_3s: (r.hook_3s || '').slice(0, 60),
  similarity_final: r.similarity_final
})), null, 2)}

## 输出 JSON
{
  "overall_score": 78,
  "verdict": "pass",
  "per_remix": [
    {"idx": 0, "score": 80, "issue": "或空字符串"},
    {"idx": 1, "score": 75, "issue": "钩子可以更强"},
    {"idx": 2, "score": 82, "issue": ""}
  ],
  "differentiation_ok": true,
  "suggestions": ["改进建议1"]
}

verdict 规则：overall >= 70 且 differentiation_ok → "pass"；否则 → "retry"`;

    onProgress && onProgress({ stage: 'evaluating', message: 'LLM 自检二创质量…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent2-eval' });
    onProgress && onProgress({ stage: 'evaluated', message: '二创自检得分：' + r.json.overall_score + '/100，结论：' + (r.json.verdict === 'pass' ? '通过' : '需重试') });
    return r.json;
  }

  // 带反馈重新生成二创
  async function generateRemixWithFeedback(analysis, viralText, profile, evalResult, onProgress) {
    const sys = `你是爆款二次创作撰稿人。上次生成的二创未通过自检，请根据反馈重新生成。
要针对指出的问题做实质改进，不能只是微调。返回严格 JSON。`;

    const usr = `## 账号
${JSON.stringify(profile)}

## 拆解
${JSON.stringify(analysis, null, 2)}

## 原爆款文本（前 1500 字）
"""
${viralText.slice(0, 1500)}
"""

## 上次自检结果
总分：${evalResult.overall_score}/100
各条问题：${JSON.stringify(evalResult.per_remix)}
建议：${JSON.stringify(evalResult.suggestions)}

## 任务
基于 driving_factors 和 reusable_template 重新生成 3 条差异化二创。
每条含 name、change、title、hook_3s、script_30s、hashtags、cta、similarity_self(0-100)。
返回 { remixes: [...] }。`;

    onProgress && onProgress({ stage: 'regenerating', message: '根据自检反馈重新生成二创…' });
    const r = await LLM.callJSON({ system: sys, user: usr, tag: 'agent2-regenerate' });
    onProgress && onProgress({ stage: 'regenerated', message: '重新生成完成，耗时 ' + r.elapsed + 'ms' });
    return r.json;
  }

  // Agent 2 完整 loop：规划 → 拆解 → 生成二创 → 相似度 → 自检 → (重试)
  async function runAgent2(opts) {
    const profile = opts.profile || loadProfile();
    const viralText = (opts.viralText || '').trim();
    if (!viralText || viralText.length < 30) {
      throw new Error('请先粘贴爆款文本（至少 30 字）');
    }

    opts.onProgress && opts.onProgress({ stage: 'input', message: '已收到爆款文本，共 ' + viralText.length + ' 字' });

    // AGENT STEP 1: LLM 自主规划
    const plan = await planAnalysis(viralText, profile, opts.onProgress);

    // AGENT STEP 2: LLM 5 维拆解
    const analysis = await analyzeViral(viralText, profile, opts.onProgress);

    // AGENT STEP 3: LLM 生成二创
    const remixResult = await generateRemix(analysis, viralText, profile, opts.onProgress);

    // AGENT STEP 4: 相似度校验
    const remixes = (remixResult.remixes || []).map(rx => {
      const mySim = quickSimilarity(viralText, (rx.script_30s || '') + (rx.hook_3s || ''));
      return { ...rx, similarity_calc: mySim, similarity_final: Math.max(rx.similarity_self || 0, mySim) };
    });

    // AGENT STEP 5: LLM 自检
    let evalResult = await evaluateRemixes(remixes, analysis, viralText, opts.onProgress);

    // AGENT STEP 6: 自检不通过 → 带反馈重试（最多 2 次）
    let retries = 0;
    let finalRemixes = remixes;
    while (evalResult.verdict === 'retry' && retries < 2) {
      retries++;
      opts.onProgress && opts.onProgress({
        stage: 'retry',
        message: `自检未通过（${evalResult.overall_score}/100），LLM 决定第 ${retries} 次重试`
      });
      const regenResult = await generateRemixWithFeedback(analysis, viralText, profile, evalResult, opts.onProgress);
      finalRemixes = (regenResult.remixes || []).map(rx => {
        const mySim = quickSimilarity(viralText, (rx.script_30s || '') + (rx.hook_3s || ''));
        return { ...rx, similarity_calc: mySim, similarity_final: Math.max(rx.similarity_self || 0, mySim) };
      });
      evalResult = await evaluateRemixes(finalRemixes, analysis, viralText, opts.onProgress);
    }

    return { profile, plan, viralText, analysis, remixes: finalRemixes, evalResult, retries };
  }

  // ============== 内容资产库 ==============
  function loadLib() {
    try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveLib(arr) { localStorage.setItem(LIB_KEY, JSON.stringify(arr)); }
  function addToLib(entry) {
    const arr = loadLib();
    entry.id = entry.id || (Date.now().toString(36));
    entry.createdAt = entry.createdAt || new Date().toISOString();
    arr.unshift(entry);
    saveLib(arr.slice(0, 200));
    return entry;
  }
  function removeFromLib(id) {
    saveLib(loadLib().filter(x => x.id !== id));
  }

  // 追踪表
  function loadTrack() {
    try { return JSON.parse(localStorage.getItem(TRACK_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveTrack(arr) { localStorage.setItem(TRACK_KEY, JSON.stringify(arr)); }
  function addToTrack(entry) {
    const arr = loadTrack();
    entry.id = entry.id || (Date.now().toString(36));
    entry.createdAt = entry.createdAt || new Date().toISOString();
    arr.unshift(entry);
    saveTrack(arr.slice(0, 200));
    return entry;
  }
  function updateTrack(id, patch) {
    const arr = loadTrack();
    const i = arr.findIndex(x => x.id === id);
    if (i >= 0) {
      arr[i] = { ...arr[i], ...patch, updatedAt: new Date().toISOString() };
      saveTrack(arr);
    }
  }

  // 导出 Markdown
  function exportLibAsMarkdown() {
    const lib = loadLib();
    let md = '# 苜蓿爆款内容资产库\n\n';
    md += '导出时间：' + new Date().toLocaleString('zh-CN') + '\n\n';
    md += '共 ' + lib.length + ' 条资产\n\n---\n\n';
    for (const e of lib) {
      md += '## ' + (e.title || e.name || '未命名') + '\n\n';
      md += '- ID: `' + e.id + '`\n';
      md += '- 创建: ' + (e.createdAt || '') + '\n';
      md += '- 类型: ' + (e.type || 'content') + '\n';
      if (e.tags) md += '- 标签: ' + e.tags.join(' ') + '\n';
      md += '\n';
      if (e.content) {
        md += '```\n' + e.content + '\n```\n\n';
      }
      md += '---\n\n';
    }
    return md;
  }

  global.Agents = {
    loadProfile, saveProfile, DEFAULT_PROFILE,
    // Agent 1 工具
    runAgent1, scoreTopics, generateScript,
    planStrategy, selectBest, selfEvaluate, generateScriptWithFeedback,
    // Agent 2 工具
    runAgent2, analyzeViral, generateRemix, quickSimilarity,
    planAnalysis, evaluateRemixes, generateRemixWithFeedback,
    // 资产库
    loadLib, addToLib, removeFromLib,
    loadTrack, addToTrack, updateTrack,
    exportLibAsMarkdown
  };
})(window);
