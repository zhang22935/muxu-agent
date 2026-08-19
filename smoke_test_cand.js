// Smoke test for candidate pool + feedback — wrapped in async main
const fs = require('fs');
const vm = require('vm');

async function main() {
  // localStorage shim
  const _ls = {};
  const localStorage = {
    getItem: k => _ls[k] === undefined ? null : _ls[k],
    setItem: (k, v) => { _ls[k] = String(v); },
    removeItem: k => { delete _ls[k]; },
    clear: () => { for (const k of Object.keys(_ls)) delete _ls[k]; }
  };

  // window + Agents shim
  const window = global;
  const agentsShim = {};

  // Load agents.js into sandbox (browser IIFE — pass `window` as `global`)
  const src = fs.readFileSync('C:/Users/ThinkPad/WorkBuddy/2026-08-19-14-59-34/agent-demo/agents.js', 'utf8');
  const fetchersStub = {
    loadProxyCfg: () => ({}),
    getOrFallback: async () => ({ items: [], sources: {}, errors: {}, proxy: null, usedCache: false }),
    fetchAll: async () => ({ items: [], sources: {}, errors: {}, proxy: null, usedCache: false })
  };
  const llmStub = {
    callJSON: async () => { throw new Error('LLM not mocked in this test'); },
    call: async () => { throw new Error('LLM not mocked'); },
    loadConfig: () => ({}),
    saveConfig: () => {},
    isReady: () => true,
    getTrace: () => []
  };
  // Bootstrap with all browser globals on the vm context
  const ctxObj = {
    localStorage,
    window: null, // set below (self ref)
    console,
    Fetchers: fetchersStub,
    LLM: llmStub,
    globalThis
  };
  ctxObj.window = ctxObj; // window === self
  // Also accept 'global' as same
  vm.createContext(ctxObj);
  try {
    vm.runInContext(src, ctxObj);
  } catch (e) {
    console.log('LOAD ERROR:', e.message);
    console.log(e.stack);
    process.exit(1);
  }
  // Pull Agents off the sandbox
  const AgentsM = ctxObj.Agents;
  if (!AgentsM) {
    console.log('Agents undefined. ctxObj keys:', Object.keys(ctxObj));
    process.exit(1);
  }

  function assert(cond, msg) {
    if (cond) console.log('PASS ' + msg);
    else { console.log('FAIL ' + msg); process.exit(1); }
  }

  // === Test 1: empty pool ===
  localStorage.clear();
  let cands = AgentsM.loadCandidates();
  assert(cands.length === 0, 'initial pool empty');
  let fb = AgentsM.getFeedbackSummary();
  assert(fb.available === false, 'feedback unavailable when no decisions');

  // === Test 2: bulk add 5 candidates ===
  const entries = [
    { title: '秋天第一杯奶茶', source: 'weibo', heat: 50, scores: { relevance: 9, creatable: 8, viral: 7, risk: 9, total: 8.2 }, reason: '时令', summary: '秋天奶茶热点', angle: '现场试喝', en_pitch: 'Best milk tea this autumn' },
    { title: '柳州螺蛳粉探店', source: 'douyin', heat: 30, scores: { relevance: 8, creatable: 7, viral: 6, risk: 8, total: 7.5 }, summary: '螺蛳粉', angle: '试吃', en_pitch: 'Try Luosifen' },
    { title: '深夜烧烤摊', source: 'bilibili', heat: 80, scores: { relevance: 7, creatable: 5, viral: 9, risk: 7, total: 7.0 }, summary: '夜宵', angle: '人烟火气', en_pitch: 'Late-night bbq vibes' },
    { title: '公司加班便当', source: 'toutiao', heat: 15, scores: { relevance: 6, creatable: 9, viral: 3, risk: 9, total: 5.5 }, summary: '便当', angle: '实用', en_pitch: 'Office lunch ideas' },
    { title: '争议话题', source: 'weibo', heat: 200, scores: { relevance: 2, creatable: 3, viral: 10, risk: 3, total: 4.5 }, summary: '争议', angle: '蹭热点', en_pitch: 'Controversial hot topic' }
  ];
  const pushed = AgentsM.bulkAddCandidates(entries);
  assert(pushed === 5, 'bulkAddCandidates pushes 5');
  cands = AgentsM.loadCandidates();
  assert(cands.length === 5, 'loadCandidates returns 5');
  assert(cands[0].status === 'pending', 'default status is pending');
  assert(!!cands[0].createdAt, 'each has createdAt');
  assert(cands[0].id && cands[0].id.startsWith('cand_'), 'id prefix cand_');

  // === Test 3: decide adopt / reject ===
  const id1 = cands[1].id;
  const id2 = cands[4].id;
  AgentsM.decideCandidate(id1, 'adopted', '账号定位符合');
  AgentsM.decideCandidate(id2, 'rejected', '争议太大');

  const reloaded = AgentsM.loadCandidates();
  const adopted1 = reloaded.find(x => x.id === id1);
  const rejected1 = reloaded.find(x => x.id === id2);
  assert(adopted1.status === 'adopted', 'adopted tagged');
  assert(adopted1.decisionReason === '账号定位符合', 'decisionReason recorded');
  assert(adopted1.history.length === 1, 'history length 1');
  assert(rejected1.status === 'rejected', 'rejected tagged');

  // === Test 4: feedback summary ===
  fb = AgentsM.getFeedbackSummary();
  assert(fb.available === true, 'feedback now available');
  assert(fb.total === 2, 'feedback total=2');
  assert(fb.adopted === 1 && fb.rejected === 1, 'adopted=1, rejected=1');
  assert(fb.acceptRate === 50, 'acceptRate 50%');
  assert(fb.message.includes('weibo'), 'message includes source breakdown');
  console.log('\n--- feedback preview ---');
  console.log(fb.message);

  // === Test 5: more decisions ===
  AgentsM.decideCandidate(cands[0].id, 'adopted', '非常合适');
  AgentsM.decideCandidate(cands[2].id, 'rejected', '夜间拍摄难');
  AgentsM.decideCandidate(cands[3].id, 'adopted', '实用');

  fb = AgentsM.getFeedbackSummary();
  assert(fb.adopted === 3 && fb.rejected === 2, '3 adopted, 2 rejected');
  assert(fb.sourcesSorted && fb.sourcesSorted.length >= 3, 'sourcesSorted has multiple');

  // === Test 6: clear pending ===
  AgentsM.clearCandidates('pending');
  const after = AgentsM.loadCandidates();
  assert(after.every(c => c.status !== 'pending'), 'no pending after clear');
  assert(after.length > 0, 'decision records kept');

  // === Test 7: delete one ===
  const someId = after[0].id;
  AgentsM.deleteCandidate(someId);
  const after2 = AgentsM.loadCandidates();
  assert(!after2.find(c => c.id === someId), 'deleteCandidate works');

  // === Test 8: Markdown export ===
  const md = AgentsM.exportCandidatesAsMarkdown('adopted');
  assert(md.includes('# 待审核内容池'), 'md has title');
  assert(md.includes('事件摘要'), 'md has field');

  // === Test 9: feedback injection into planStrategy (mock LLM) ===
  console.log('\n--- testing planStrategy feedback injection ---');
  const ctxObj2 = {
    localStorage,
    window: null,
    console,
    Fetchers: fetchersStub,
    LLM: {
      _lastUserPrompt: '',
      callJSON: async (opts) => {
        ctxObj2.LLM._lastUserPrompt = opts.user;
        return { json: { strategy: 'mock', priority_sources: [], exclude_titles: [], weight_hint: 'mock', expected_top: '', reasoning: '' }, usage: { total_tokens: 100 }, elapsed: 100 };
      }
    }
  };
  ctxObj2.window = ctxObj2;
  vm.createContext(ctxObj2);
  vm.runInContext(src, ctxObj2);
  await ctxObj2.Agents.planStrategy(
    [{ title: 'A', source: 'weibo', heat: 10 }, { title: 'B', source: 'douyin', heat: 5 }],
    { name: 'test' },
    null
  );
  const lastPrompt = ctxObj2.LLM._lastUserPrompt;
  assert(lastPrompt.includes('历史决策反馈'), 'planStrategy injects history feedback');
  assert(lastPrompt.includes('各源采纳率'), 'planStrategy injects source breakdown');
  console.log('\nPLAN PROMPT LAST 500 chars:');
  console.log(lastPrompt.slice(-500));
  console.log('\nAll smoke tests passed');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
