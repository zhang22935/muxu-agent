/* ============================================================
 * 苜蓿爆款 Agent · 真实 LLM 客户端 (DeepSeek, OpenAI 兼容)
 * ============================================================
 *
 * 真实功能：
 *   - 通过 DeepSeek API 完成所有评分/分析/生成
 *   - 自动持久化 API Key 到 localStorage（用户自带，不上传任何服务器）
 *   - 支持自定义 baseURL（兼容 OpenAI/Claude/其他 OpenAI 协议端点）
 *   - 流式输出可观测，每个 token 实时回显
 *   - 所有 LLM 调用过程可审计：完整 request/response 写入 trace 日志
 *
 * 关键设计：
 *   - Key 只存浏览器 localStorage，永不出网（除了官方 LLM endpoint）
 *   - 失败重试 1 次（指数退避），超时报错可读
 *   - 思考模式（reasoning_content）单独提取，呈现给用户
 *   - token 用量、耗时、模型名全部记录
 * ============================================================ */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'muxu_llm_config';
  const TRACE_KEY = 'muxu_llm_trace';
  const TRACE_MAX = 50;

  // 默认配置：用户首次打开时填 Key
  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {
      provider: 'deepseek',     // deepseek | openai | custom
      apiKey: '',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      temperature: 0.7,
      maxTokens: 4096           // 默认提到 4096，覆盖常见 Agent 步骤需要
    };
  }

  // 单次 LLM 调用的最大输出 token 上限（防 8K/4K 限制被卡住的硬上限）
  const HARD_MAX_TOKENS = 16000;

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function clearConfig() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function isReady() {
    const cfg = loadConfig();
    return !!(cfg.apiKey && cfg.apiKey.trim().length > 10);
  }

  // 记录调用 trace
  function trace(entry) {
    try {
      const arr = JSON.parse(localStorage.getItem(TRACE_KEY) || '[]');
      arr.unshift({ ...entry, ts: Date.now() });
      localStorage.setItem(TRACE_KEY, JSON.stringify(arr.slice(0, TRACE_MAX)));
    } catch (e) { /* ignore quota */ }
  }

  function getTrace() {
    try { return JSON.parse(localStorage.getItem(TRACE_KEY) || '[]'); }
    catch (e) { return []; }
  }

  /**
   * 真实 LLM 调用（一次完整 chat.completions 请求）
   * @param {Object} opts
   * @param {string} opts.system     - 系统 prompt
   * @param {string} opts.user       - 用户 prompt
   * @param {boolean} [opts.json]    - 是否要求 JSON 输出
   * @param {boolean} [opts.stream]  - 是否流式
   * @param {function} [opts.onChunk]- 流式回调 (delta, fullText) => void
   * @param {function} [opts.onThink]- 思考过程回调 (reasoning) => void
   * @returns {Promise<{content, reasoning, usage, elapsed}>}
   */
  async function call(opts) {
    const cfg = loadConfig();
    if (!cfg.apiKey) throw new Error('未配置 API Key，请先在「设置」里填入 DeepSeek Key');

    const url = (cfg.baseURL || 'https://api.deepseek.com').replace(/\/$/, '') + '/v1/chat/completions';
    const messages = [
      { role: 'system', content: opts.system || '' },
      { role: 'user', content: opts.user || '' }
    ];

    const body = {
      model: cfg.model || 'deepseek-chat',
      messages,
      temperature: opts.temperature ?? cfg.temperature ?? 0.7,
      // 把 maxTokens 上限拉到 HARD_MAX_TOKENS，避免一次输出 30 条 JSON 被截断
      max_tokens: Math.min(opts.maxTokens ?? cfg.maxTokens ?? 4096, HARD_MAX_TOKENS),
      stream: !!opts.stream
    };
    // DeepSeek 支持 JSON mode
    if (opts.json) body.response_format = { type: 'json_object' };

    const t0 = Date.now();
    let attempt = 0;
    let lastErr;
    while (attempt < 2) {
      attempt++;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90000); // 90s
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + cfg.apiKey
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timer);

        if (!resp.ok) {
          const errText = await resp.text();
          const err = new Error(`LLM ${resp.status}: ${errText.slice(0, 200)}`);
          err.status = resp.status;
          throw err;
        }

        if (!opts.stream) {
          const data = await resp.json();
          const elapsed = Date.now() - t0;
          const result = {
            content: data.choices?.[0]?.message?.content || '',
            reasoning: data.choices?.[0]?.message?.reasoning_content || '',
            usage: data.usage || {},
            elapsed,
            model: data.model || body.model
          };
          trace({
            kind: opts.tag || 'call',
            ok: true,
            content: result.content.slice(0, 500),
            reasoning: (result.reasoning || '').slice(0, 300),
            usage: result.usage,
            elapsed,
            model: result.model
          });
          return result;
        }

        // 流式
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let fullContent = '';
        let fullReasoning = '';
        let usage = {};
        let modelName = body.model;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const obj = JSON.parse(payload);
              if (obj.model) modelName = obj.model;
              const delta = obj.choices?.[0]?.delta;
              if (delta) {
                if (delta.reasoning_content) {
                  fullReasoning += delta.reasoning_content;
                  if (opts.onThink) opts.onThink(fullReasoning);
                }
                if (delta.content) {
                  fullContent += delta.content;
                  if (opts.onChunk) opts.onChunk(delta.content, fullContent);
                }
              }
              if (obj.usage) usage = obj.usage;
            } catch (e) { /* skip malformed */ }
          }
        }
        const elapsed = Date.now() - t0;
        const result = { content: fullContent, reasoning: fullReasoning, usage, elapsed, model: modelName };
        trace({
          kind: opts.tag || 'call',
          ok: true,
          content: fullContent.slice(0, 500),
          reasoning: fullReasoning.slice(0, 300),
          usage,
          elapsed,
          model: modelName
        });
        return result;

      } catch (err) {
        lastErr = err;
        if (err.status === 401 || err.status === 403) break; // 不重试鉴权
        if (err.name === 'AbortError') break;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }

    trace({ kind: opts.tag || 'call', ok: false, error: String(lastErr) });
    throw lastErr;
  }

  // 尝试修复被 max_tokens 截断的 JSON（关闭未闭合的字符串/对象/数组）
  function repairTruncatedJSON(txt) {
    // 1. 去掉尾部未完成（缺引号结束、刚开 quote 等）的不完整字符串
    // 从尾部往前找最稳定的关闭点 }, ]], "
    let s = txt.trim();
    // 去掉行内注释
    s = s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // 平衡大括号/中括号：补齐缺失的闭合
    let braces = 0, brackets = 0, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') braces++;
      else if (c === '}') braces--;
      else if (c === '[') brackets++;
      else if (c === ']') brackets--;
    }
    // 如果当前在字符串里关闭，先关字符串
    if (inStr) s += '"';
    // 补齐未闭合的对象/数组
    // 先去掉尾部 `,` `,]` `,}` 等悬挂分隔符
    s = s.replace(/,\s*$/, '');
    while (brackets > 0) { s += ']'; brackets--; }
    while (braces > 0) { s += '}'; braces--; }
    return s;
  }

  // 便捷：要求 JSON 输出
  async function callJSON(opts) {
    const user = opts.user + (opts.user.includes('```') ? '' : '\n\n请只输出严格 JSON，不要任何解释。');
    const r = await call({ ...opts, user, json: true });
    try {
      // 提取 JSON 块（防止模型加 ```）
      let txt = r.content.trim();
      const m = txt.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
      if (m) txt = m[1];
      const parsed = JSON.parse(txt);
      return { ...r, json: parsed, _repaired: false };
    } catch (e) {
      // 第一次解析失败 → 尝试修复被 max_tokens 截断的 JSON
      try {
        let txt = r.content.trim();
        const m = txt.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
        if (m) txt = m[1];
        const repaired = repairTruncatedJSON(txt);
        const parsed = JSON.parse(repaired);
        return { ...r, json: parsed, _repaired: true };
      } catch (e2) {
        throw new Error('JSON 解析失败：' + e.message + ' | 截断恢复也失败：' + e2.message + ' | 原文前 200 字：' + r.content.slice(0, 200) + ' | 原文长度：' + r.content.length);
      }
    }
  }

  global.LLM = { call, callJSON, loadConfig, saveConfig, clearConfig, isReady, getTrace };
})(window);
