/* ============================================================================
 * app.js —— 语音交互助手（纯前端版）
 *
 * 和仓库里 Flask 版的区别只有一处：没有服务器。
 *   · 检索：knowledge_base.py 里的二元组切词 + BM25 风格 IDF，原样译成 JS，在浏览器里跑
 *   · 回答：不填 Key 时由本地检索命中的原文句子组装；填了 Key 才真的发给 DeepSeek
 *   · 朗读：浏览器 speechSynthesis（Edge 自带中文语音，Chrome 常常一个都没有）
 *
 * 为什么这么做：静态站点没有后端，而 API Key 绝不能写在前端供人白用。
 * 所以把「不填 Key 也能真查」做成默认路径，「填 Key 才用大模型」做成可选升级 ——
 * 页面上如实标注当前是哪一种，不含糊。
 * ========================================================================== */
'use strict';

/* ==========================================================================
 * 0. 常量 —— 与 knowledge_base.py 保持一致
 * ========================================================================== */

/** 停用词：出现在问题里但没有检索意义的词（照搬项目里的表） */
const KB_STOPWORDS = new Set(`
  的 了 和 与 及 或 是 在 有 为 对 把 被 从 到 上 下 中 内 外 之 其 该 这 那 这些 那些
  什么 怎么 怎样 如何 为何 为什么 哪些 哪个 多少 是否 能否 可否 可以 需要 应该 请问
  一个 一些 我们 你们 他们 它们 自己 以及 并且 但是 不过 因为 所以 如果 那么 就是
  请问 一下 帮我 告诉 知道 介绍 说明 解释 关于 方面 情况 时候 目前 现在 还是 或者
  么是 是什 请 你 我 他 她 它 们 吗 呢 吧 啊 呀 哦 嗯 之 于 并 而 则 就 都 也 很 更 最
  什 么 怎 样 哪 谁 几 个 些 来 去 好
`.trim().split(/\s+/));

const RE_CJK = /[\u4e00-\u9fff]+/g;
const RE_WORD = /[a-z][a-z0-9_.\-]{0,30}|\d+(?:\.\d+)?/g;

const KB_DEFAULT_TOP_K = 4;     // 默认取前 4 段
const KB_FALLBACK_COVERAGE = 0.35;
const MIN_COVERAGE = 0.3;       // 命中词占查询词低于这个比例 → 判定为「资料里没有」，不硬答
const MAX_MEMORY_TURNS = 10;    // 记忆窗口：最多带回 10 轮
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const LS_KEY = 'va_demo_api_key';

/* ==========================================================================
 * 1. 内置知识库
 * ==========================================================================
 * 前两篇是 deepseek-voice-assistant 仓库里真实存在的资料文件，内容原样搬来；
 * 第三篇是介绍这个项目本身的说明。都标注在列表里，访客可以自己传 .md 覆盖体验。
 */
const BUILTIN_DOCS = [
  {
    name: '员工手册.md',
    builtin: true,
    text: `# 员工手册

## 年假制度
入职满一年可享受 5 天带薪年假，满三年 10 天，满五年 15 天。
年假需提前三个工作日申请，由直属主管审批后生效。当年未休完的年假可以顺延到次年三月，逾期作废。

## 报销流程
先提交发票，再由部门主管审批，财务在 5 个工作日内打款到工资卡。
单笔金额超过 5000 元的支出需要额外提供部门负责人的书面确认。
差旅报销需要附上行程单与住宿发票，市内交通按实际发生额报销，上限为每天 200 元。

## 打卡时间
每天上午 9:00 上班，下午 18:00 下班，午休 12:00 到 13:30。
弹性打卡允许前后各浮动 30 分钟，但每日工作时长仍需满 8 小时。
忘记打卡可以在三个工作日内提交补卡申请，每月最多补卡三次。

## 请假与调休
事假按天扣发当日工资，病假需提供二级以上医院的证明。
加班可以选择折算调休或者领取加班费，由员工在次月五号前自行选择，逾期默认折算调休。

## 设备与安全
办公电脑由公司统一配发，离职时归还，个人数据请自行备份。
公司内部文档禁止上传到未授权的第三方网盘，涉及客户信息的文件需要加密后再传输。`
  },
  {
    name: '产品说明.txt',
    builtin: true,
    text: `产品说明

本项目名叫「语音交互助手」，是一个本地运行的语音 Agent。
它先听用户说一句话，用浏览器或本地语音识别把语音转成文字，然后交给大模型思考，最后用语音合成把答案读出来。
这个产品支持本地知识库检索：用户可以把 .md 和 .txt 文档放进知识库，模型会根据问题自己判断要不要去查这些资料。

使用方法：
第一步，配置 DEEPSEEK_API_KEY 环境变量。
第二步，双击 start.bat，脚本会自动创建虚拟环境、安装依赖并启动服务。
第三步，用 Chrome 或 Edge 打开 http://127.0.0.1:5000，麦克风才能正常工作。

常见问题：
如果听不到声音，请检查浏览器是否选择了中文语音；Edge 浏览器自带微软的中文语音，Chrome 通常需要联网加载。
如果麦克风无法使用，请确认页面是通过 127.0.0.1 或 https 访问的，普通 http 地址无法调用麦克风。
如果没有配置密钥，服务会启动但无法回答，接口会返回密钥未配置的错误。`
  },
  {
    name: 'agent-overview.md',
    builtin: true,
    text: `# 语音 Agent 的项目说明

## 它是什么
这是一个把「听、想、说」拆成三层的本地语音助手：listen 负责语音识别，think 负责模型决策与工具调用，speak 负责语音合成。
三层互相独立，任何一层都可以单独替换，也可以单独测试。

## Agent 体现在哪里
关键在于工具调用完全由模型自己决定。请求里带上 tool_choice 为 auto 以及一份工具说明，
模型会判断这个问题需不需要查资料：闲聊就直接回答，问事实才去调 search_knowledge_base。
决策过程会在回答下方以决策卡的形式展开，写明「调用工具几次」「命中了哪些片段」「来源是哪个文件」。

## 诚实性怎么保证
系统提示词要求它不许凭记忆编造；工具返回空结果时，提示词要求它必须如实回答「资料里没有提到」。
另外还有一层一致性校验：如果模型全程没有查资料却断言查不到，系统会替它补查一次再让它重新作答。
真实案例：问公司的股票代码是多少，模型一度直接答资料里没有提到，补查确认知识库里确实没有这部分内容后，
它才如实回答查不到 —— 这个「不确定就不编」的行为，正是这套校验想保住的。

## 检索是怎么做的
没有用任何分词库。连续汉字段切成相邻的二元组，比如「年假制度」切成「年假」「假制」「制度」。
然后用 BM25 风格的 IDF 给每个词加权，越罕见的词权重越高，再乘以词频的对数，最后对过长的片段施加长度惩罚。
如果关键词一个都没命中，会退一步用「有意义的单个汉字重合度」做一次宽松召回。

## 工程细节
两个真正联网的函数都支持注入替身，所以整条链路可以离线跑单元测试，一共 102 个用例。
密钥只从环境变量读取，仓库里不含任何真实凭据。`
  }
];

/* ==========================================================================
 * 2. 切词与分块 —— 对应 knowledge_base.py 的 tokenize / split_paragraphs
 * ========================================================================== */

/** 抹掉 markdown 记号与多余空白，让切词只看到正文 */
function cleanForSearch(text) {
  return String(text || '')
    .replace(/`{1,3}/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\*\*|__|\*|~~/g, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}>\s*/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[ \t\u3000]+/g, ' ')
    .trim();
}

/**
 * 把文本切成检索用的 token（含重复，用于统计词频）。
 * 连续汉字段切相邻二元组；单字汉字段保留该字；英文/数字整词小写。
 */
function tokenize(text) {
  const cleaned = cleanForSearch(text).toLowerCase();
  const tokens = [];

  (cleaned.match(RE_CJK) || []).forEach((seg) => {
    if (seg.length === 1) tokens.push(seg);
    else for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
  });
  (cleaned.match(RE_WORD) || []).forEach((w) => tokens.push(w));

  return tokens.filter((t) => t && !KB_STOPWORDS.has(t));
}

/** 按空行切段，markdown 标题单独成段（标题本身不拿来当答案，但参与索引） */
function splitParagraphs(text) {
  const norm = String(text || '').replace(/\r\n?/g, '\n');
  const pieces = [];
  let curTitle = '';
  let buf = [];

  /* 关键：把所在小节的标题拼到段落开头。
     否则「报销流程」这一段正文里根本没有「报销」二字，问「报销怎么走」就检索不到，
     而读者看到的却是「差旅报销」那种次要条款 —— 这是本地检索最容易犯的错。 */
  function flush() {
    if (!buf.length) return;
    const body = buf.join('\n');
    pieces.push(curTitle ? curTitle + '：' + body : body);
    buf = [];
  }

  norm.split('\n').forEach((line) => {
    const t = line.trim();
    if (!t) { flush(); return; }
    if (/^#{1,6}\s/.test(t)) {
      flush();
      curTitle = t.replace(/^#{1,6}\s*/, '');
      return;
    }
    buf.push(t);
  });
  flush();

  // 太长的段落再按字符上限切开，留一点重叠，避免答案被切断在半句
  const out = [];
  const CHUNK = 400, OVERLAP = 80;
  pieces.forEach((p) => {
    if (p.length <= CHUNK) { out.push(p); return; }
    for (let i = 0; i < p.length; i += CHUNK - OVERLAP) {
      out.push(p.slice(i, i + CHUNK));
      if (i + CHUNK >= p.length) break;
    }
  });
  return out.filter((p) => p.trim());
}

/* ==========================================================================
 * 3. 索引与检索 —— 对应 _idf / 打分函数 / search_knowledge_base
 * ========================================================================== */

/** BM25 风格 IDF：越罕见的词权重越高，夹一个 0.1 下界 */
function idf(df, total) {
  if (total <= 0) return 0.1;
  return Math.max(0.1, Math.log(1 + (total - df + 0.5) / (df + 0.5)));
}

/** 由当前文档集构建索引：chunks 带 tf、df 全局文档频率、total 片段总数 */
function buildIndex(docs) {
  const chunks = [];

  docs.forEach((doc) => {
    splitParagraphs(doc.text).forEach((p) => {
      const tokens = tokenize(p);
      if (!tokens.length) return;
      const tf = Object.create(null);
      tokens.forEach((t) => { tf[t] = (tf[t] || 0) + 1; });
      chunks.push({ text: p, src: doc.name, tokens, tf });
    });
  });

  const df = Object.create(null);
  chunks.forEach((c) => Object.keys(c.tf).forEach((t) => { df[t] = (df[t] || 0) + 1; }));

  return { chunks, df, total: chunks.length };
}

/**
 * 给单个片段打分。
 * @returns {{score:number, coverage:number}} 完全无法匹配时返回 {0,0}
 *
 * coverage 的分母用「查询的全部去重词」，而不是「知识库认识的词」。
 * 这一条改过：用 known 作分母时，「公司有食堂吗」和「年假几天」算出来都是 1.0，
 * 等于区分不出「真命中」和「只碰上一个常见词」，于是问到库里没有的东西也会硬答。
 */
function scoreChunk(queryTokens, chunk, df, total) {
  const unique = new Set(queryTokens.filter(Boolean));
  if (!unique.size) return { score: 0, coverage: 0 };

  const known = [...unique].filter((t) => t in df);
  if (!known.length) return { score: 0, coverage: 0 };   // 词表里一个都没有 → 必然查不到

  const hits = known.filter((t) => t in chunk.tf);
  if (!hits.length) return { score: 0, coverage: 0 };

  const coverage = hits.length / unique.size;
  const raw = hits.reduce((sum, t) => sum + idf(df[t] || 0, total) * (1 + Math.log(1 + chunk.tf[t])), 0);

  // 长度惩罚：片段越长越可能是「碰巧包含」，给一点阻尼
  const len = Math.max(1, chunk.tokens.length);
  const penalty = 1 / (1 + Math.max(0, (len - 60) / 240));

  return { score: raw * penalty, coverage };
}

/** 在索引里检索，返回按分数降序的前 limit 段 */
function searchKnowledge(index, query, limit = KB_DEFAULT_TOP_K) {
  const qTokens = tokenize(query);
  if (!qTokens.length || !index.total) return [];

  const scored = index.chunks.map((c) => {
    const s = scoreChunk(qTokens, c, index.df, index.total);
    return { chunk: c, score: s.score, coverage: s.coverage };
  }).filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score || b.coverage - a.coverage);
  return scored.slice(0, limit);
}

/* ==========================================================================
 * 4. 本地回答组装
 * ==========================================================================
 * 思路和 Flask 版的 localAnswer 一致：先判断是不是闲聊，是就直接答；
 * 不是就去检索，从命中的段落里挑和问题词重合最多的句子拼成回答。
 * 命中的词越多，措辞越肯定；勉强命中就说得保守 —— 不硬编。
 */

/** 判断一句话是不是纯标题（标题本身没有信息量，不该拿来当答案） */
function isHeading(s) {
  if (s.length < 6) return true;
  if (/^(\d+[.、]|[一二三四五六七八九十]+、|#)/.test(s)) return true;
  return /(员工手册|产品说明|项目说明|使用指南|项目背景|工程细节)$/.test(s);
}

const SMALL_TALK = [
  { keys: ['你好', '您好', 'hi', 'hello', '在吗'],
    reply: '你好，我是语音交互助手。你可以直接对着麦克风说话，也可以打字提问。问到知识库里的内容时，我会先去检索再回答。' },
  { keys: ['你是谁', '介绍', '能做什么', '会什么', '功能', '干嘛'],
    reply: '我是语音交互助手：先把你说的转成文字，再判断要不要查知识库，然后把答案读出来。' +
           '现在跑的是纯前端版本，检索在浏览器里真实运行；填了自己的 DeepSeek Key 之后才会交给大模型作答。' },
  { keys: ['怎么用', '如何使用', '使用方法'],
    reply: '点麦克风开始说，再点一下结束；也可以直接在输入框打字。想让我回答特定资料里的内容，把 .md 或 .txt 拖进「知识库」。' },
  { keys: ['谢谢', '感谢'],
    reply: '不客气。想再试一个的话，可以问「年假几天」「报销怎么走」「几点下班」。' }
];

/**
 * 本地生成回答。
 * @returns {{reply:string, trace:object}} trace 用来渲染决策卡
 */
function localAnswer(query) {
  const t0 = performance.now();
  const low = query.toLowerCase();

  // ① 闲聊：不查库直接答（这一步就是「模型判断不需要检索」的本地等价物）
  for (const st of SMALL_TALK) {
    if (st.keys.some((k) => low.indexOf(k) > -1)) {
      return {
        reply: st.reply,
        trace: { mode: 'local', used: false, hits: [], sources: [], ms: Math.round(performance.now() - t0) }
      };
    }
  }

  // ② 检索知识库
  const hits = searchKnowledge(index, query, KB_DEFAULT_TOP_K);
  const ms = Math.round(performance.now() - t0);

  /* 覆盖率门槛：命中的词占查询全部词的比例太低，说明只是「碰巧撞上一个常见词」。
     例子：「公司有食堂吗」只撞上「公司」（1/5 = 0.2），正确做法是承认资料里没有，
     而不是把「公司内部文档禁止上传…」端出来当答案。 */
  const best = hits[0];
  const tooWeak = !best || (best.coverage || 0) < MIN_COVERAGE;

  if (!hits.length || tooWeak) {
    return {
      reply: '资料里没有提到这个内容。你可以把相关的 .md / .txt 文件拖进「知识库」，我再试着回答。',
      trace: { mode: 'local', used: true, hits: [], sources: [], ms, coverage: best ? best.coverage : 0 }
    };
  }

  // ③ 从命中段落里挑句子：和问题共现的二元组越多，越可能是答案
  const qTokens = tokenize(query);
  const picked = [];

  /* 只信「最强的那一段」。
     教训：问「年假几天」时，讲分词的那篇文档里有一句拿「年假制度」举例，
     词面对上了但语义无关，拼进答案就成了答非所问。只取第一名，
     同类答案才不会被别的文档里「碰巧提到同一个词」的句子挤进来。 */
  const topHits = [hits[0]];

  topHits.forEach((h) => {
    const sents = h.chunk.text.split(/[。！？；\n]/).map((s) => s.trim()).filter((s) => s.length > 3);
    const cand = sents.map((s, idx) => {
      let c = 0;
      qTokens.forEach((t) => { if (s.indexOf(t) > -1) c++; });
      /* 带「」引号的句子是引用别人的原话，不是定义性内容。
         问「几点下班」时项目说明里那句「真实案例：问『我们几点下班』…」会靠词面重合胜出，
         减一分就能让真正的答案（打卡时间那段）排到前面。 */
      if (/[「『"]/.test(s)) c = Math.max(0, c - 1);
      return { s, c, idx };
    }).filter((x) => x.c >= 1 && !isHeading(x.s));

    /* 命中词多者优先；一样多时按原文顺序 ——
       段落的第一句通常就是这条规定的答案，而「短的优先」会挑出末尾那种补充条款
       （问「年假几天」被答成「当年未休完的年假可以顺延…」就是这么来的）。 */
    cand.sort((a, b) => b.c - a.c || a.idx - b.idx);
    const strong = cand.filter((x) => x.c >= 2).slice(0, 2).map((x) => x.s);
    if (strong.length) strong.forEach((s) => picked.push({ src: h.chunk.src, s }));
    else if (cand.length) picked.push({ src: h.chunk.src, s: cand[0].s });
  });

  const top = picked.slice(0, 2);   // 最多两句，读起来才像人话
  if (!top.length) {
    // 命中了段落，但挑不出像答案的句子 —— 直接把原文最相关那段给出来，不假装懂
    const first = hits[0];
    return {
      reply: '我查到了相关的一段资料，但它更像标题或条目，可能不是你要的答案：\n' +
             first.chunk.text.replace(/^#+\s*/, '').slice(0, 160),
      trace: { mode: 'local', used: true, hits, sources: [first.chunk.src], ms, coverage: first.coverage }
    };
  }

  const sources = [...new Set(top.map((p) => p.src))];
  /* 过了 MIN_COVERAGE 就说明不是「碰巧撞上一个常见词」，可以理直气壮地说「根据资料」。
     之前这里用的是 0.45，导致「年假几天」这种 0.33 的正常提问也被说成
     「资料里没有直接写」—— 答对了还先道歉，读起来很没底气。 */
  const strongHit = (hits[0].coverage || 0) >= MIN_COVERAGE;
  const head = strongHit ? '根据知识库里的资料：' : '资料里没有直接写，不过我找到了相关内容：';

  return {
    reply: head + top.map((p) => p.s).join('；') + '。',
    trace: { mode: 'local', used: true, hits, sources, ms, coverage: hits[0].coverage }
  };
}

/* ==========================================================================
 * 5. DeepSeek 调用（只在填了 Key 时走这条路）
 * ========================================================================== */

const TOOL_DEFS = [{
  type: 'function',
  function: {
    name: 'search_knowledge_base',
    description:
      '在用户上传的本地知识库（.md / .txt 文档）中做相关性检索。' +
      '【什么时候必须调用】当用户的问题涉及事实、定义、数字、流程、政策、规则时，必须先调用本工具，' +
      '不要凭自己的记忆回答。【返回什么】如果片段列表为空，说明知识库里没有这部分资料，' +
      '此时必须如实回答「资料里没有提到」，绝对不要编造。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词，尽量保留用户原话里的名词' }
      },
      required: ['query']
    }
  }
}];

/** 把检索结果整理成给模型看的观察文本 */
function hitsToObservation(hits) {
  if (!hits.length) return '检索结果：空。知识库里没有与问题相关的资料，请如实回答「资料里没有提到」。';
  const lines = hits.map((h, i) =>
    `[${i + 1}] 来源：${h.chunk.src}（相关度 ${h.score.toFixed(2)}）\n${h.chunk.text.slice(0, 300)}`);
  return `检索结果：命中 ${hits.length} 段。\n${lines.join('\n---\n')}`;
}

/**
 * 一轮真 Agent 对话：最多 3 轮决策，模型说要查就本地检索后把结果塞回去。
 * @returns {{reply:string, trace:object}}
 */
async function agentAnswer(query, key) {
  const t0 = performance.now();
  const messages = [
    { role: 'system', content:
      '你是一个中文语音助手。回答要口语化、简短，适合被朗读出来，不要用 markdown 列表。' +
      '当问题涉及事实、数字、流程、政策时，必须先调用 search_knowledge_base 检索资料，不要凭记忆回答。' +
      '如果检索结果为空，必须如实说资料里没有提到，绝对不要编造。' },
    { role: 'user', content: query }
  ];

  const trace = { mode: 'llm', rounds: [], used: false, hits: [], sources: [], ms: 0 };
  let reply = '';

  for (let step = 0; step < 3; step++) {
    const data = await callDeepSeek(key, messages);
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error('模型返回格式异常');

    messages.push(msg);

    // 模型决定调工具
    if (msg.tool_calls && msg.tool_calls.length) {
      trace.used = true;
      for (const tc of msg.tool_calls) {
        let q = query;
        try { q = JSON.parse(tc.function.arguments || '{}').query || query; } catch (_) { /* 用原问题兜底 */ }
        const hits = searchKnowledge(index, q, KB_DEFAULT_TOP_K);
        hits.forEach((h) => { if (!trace.hits.includes(h)) trace.hits.push(h); });
        trace.rounds.push({ step: step + 1, action: 'call_tool', tool: tc.function.name, query: q, hitCount: hits.length, hits });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: hitsToObservation(hits) });
      }
      continue;   // 带着观察结果再决策一次
    }

    // 模型直接给答案
    reply = (msg.content || '').trim();
    trace.rounds.push({ step: step + 1, action: 'final', preview: reply.slice(0, 40) });
    break;
  }

  if (!reply) reply = '这一轮没有得到有效回答，请再问一次。';
  trace.sources = [...new Set(trace.hits.map((h) => h.chunk.src))];
  trace.ms = Math.round(performance.now() - t0);
  return { reply, trace };
}

/** 真正发请求。浏览器直连 api.deepseek.com，Key 只在这个页面的请求头里出现 */
async function callDeepSeek(key, messages) {
  const resp = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      tools: TOOL_DEFS,
      tool_choice: 'auto',
      temperature: 1.0
    })
  });

  if (!resp.ok) {
    let detail = 'HTTP ' + resp.status;
    try {
      const j = await resp.json();
      detail = (j.error && j.error.message) || detail;
    } catch (_) { /* 保持状态码 */ }
    throw new Error('调用模型失败：' + detail);
  }
  return resp.json();
}

/* ==========================================================================
 * 6. 页面元素与状态
 * ========================================================================== */

const el = {
  modeTag: document.getElementById('modeTag'),
  modeText: document.getElementById('modeText'),
  keyBtn: document.getElementById('keyBtn'),
  modelPill: document.getElementById('modelPill'),
  agentPill: document.getElementById('agentPill'),
  voicePill: document.getElementById('voicePill'),
  memoryPill: document.getElementById('memoryPill'),
  alertBox: document.getElementById('alertBox'),
  chat: document.getElementById('chat'),
  empty: document.getElementById('emptyState'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  statusExtra: document.getElementById('statusExtra'),
  micBtn: document.getElementById('micBtn'),
  micLabel: document.getElementById('micLabel'),
  textInput: document.getElementById('textInput'),
  sendBtn: document.getElementById('sendBtn'),
  stopSpeakBtn: document.getElementById('stopSpeakBtn'),
  voiceSelect: document.getElementById('voiceSelect'),
  rateRange: document.getElementById('rateRange'),
  rateValue: document.getElementById('rateValue'),
  autoSpeak: document.getElementById('autoSpeak'),
  kbBtn: document.getElementById('kbBtn'),
  kbCount: document.getElementById('kbCount'),
  clearBtn: document.getElementById('clearBtn'),
  kbPanel: document.getElementById('kbPanel'),
  kbStats: document.getElementById('kbStats'),
  kbCloseBtn: document.getElementById('kbCloseBtn'),
  kbDrop: document.getElementById('kbDrop'),
  kbFile: document.getElementById('kbFile'),
  kbPickBtn: document.getElementById('kbPickBtn'),
  kbList: document.getElementById('kbList'),
  kbResetBtn: document.getElementById('kbResetBtn'),
  kbClearBtn: document.getElementById('kbClearBtn'),
  keyPanel: document.getElementById('keyPanel'),
  keyInput: document.getElementById('keyInput'),
  keySave: document.getElementById('keySave'),
  keyCancel: document.getElementById('keyCancel'),
  keyDelete: document.getElementById('keyDelete')
};

const state = {
  docs: BUILTIN_DOCS.map((d) => ({ ...d })),   // 当前知识库文档
  index: null,                                  // 由 docs 构建的索引
  apiKey: '',
  turns: 0,                                     // 已进行的对话轮数（用于「记忆 N/10 轮」）
  busy: false,
  recognizing: false,
  recognition: null,
  voices: [],
  zhVoices: []
};

let index = buildIndex(state.docs);   // 供 localAnswer / agentAnswer 直接引用

/* ==========================================================================
 * 7. 渲染
 * ========================================================================== */

function setStatus(kind, text, extra) {
  const map = { ready: '', listening: 'listening', thinking: 'thinking', speaking: 'speaking', error: 'error' };
  el.statusDot.className = 'status-dot' + (map[kind] ? ' ' + map[kind] : '');
  el.statusText.textContent = text;
  if (extra !== undefined) el.statusExtra.textContent = extra;
}

function setAlert(kind, html) {
  if (!html) { el.alertBox.hidden = true; return; }
  el.alertBox.className = 'alert ' + kind;
  el.alertBox.innerHTML = html;
  el.alertBox.hidden = false;
}

function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** 加一条消息气泡。role: 'user' | 'ai' */
function appendMessage(role, content, opts = {}) {
  if (el.empty) el.empty.hidden = true;

  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? '🙋' : '🤖';

  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (opts.isError ? ' error' : '');

  const body = document.createElement('span');
  body.className = 'bubble-body';
  if (opts.isTyping) body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  else body.textContent = content;

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = opts.meta || nowTime();

  bubble.appendChild(body);
  bubble.appendChild(meta);
  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  el.chat.appendChild(wrap);
  scrollToBottom();
  return bubble;
}

function updateBubble(bubble, content, meta) {
  const body = bubble.querySelector('.bubble-body');
  if (body) body.textContent = content;
  if (meta) bubble.querySelector('.meta').textContent = meta;
  scrollToBottom();
}

function scrollToBottom() {
  el.chat.scrollTop = el.chat.scrollHeight;
}

/**
 * 把某条消息滚到可视区顶部附近，而不是死滚到底。
 * 为什么：决策卡比气泡高得多，一味滚到底会把「问题 + 回答」顶出视野，
 * 访客只看到一张决策卡，反而不知道答的是什么。
 */
function scrollToMsg(msgEl, offset = 10) {
  if (!msgEl) return;
  const c = el.chat.getBoundingClientRect();
  const m = msgEl.getBoundingClientRect();
  el.chat.scrollTop += (m.top - c.top) - offset;
}

/**
 * 在回答下方画决策卡 —— 这一轮到底查没查、查了什么，摊开给人看。
 * 这是整个项目最想展示的东西，所以本地模式和大模型模式都要画。
 * DOM 结构严格对齐 style.css 里的 .trace-* 规则。
 */
function renderTrace(bubble, trace) {
  const wrap = bubble.parentElement;          // .msg
  wrap.classList.add('has-trace');

  const card = document.createElement('div');
  card.className = 'trace-card';

  // ---- 头部：标题 + 结论徽章 + 折叠按钮 ----
  const head = document.createElement('div');
  head.className = 'trace-head';

  const title = document.createElement('span');
  title.className = 'trace-title';
  title.textContent = '决策过程';

  const badge = document.createElement('span');
  const toolCount = trace.mode === 'llm'
    ? trace.rounds.filter((r) => r.action === 'call_tool').length
    : (trace.used ? 1 : 0);

  if (toolCount > 0) {
    badge.className = 'trace-badge is-used';
    badge.textContent = trace.mode === 'llm'
      ? `调用工具 ${toolCount} 次`
      : `检索知识库 · 命中 ${(trace.hits || []).length} 段`;
  } else if (trace.used) {
    badge.className = 'trace-badge is-warn';
    badge.textContent = '检索无结果';
  } else {
    badge.className = 'trace-badge is-skip';
    badge.textContent = '未调用工具，直接回答';
  }

  const toggle = document.createElement('button');
  toggle.className = 'trace-toggle';
  toggle.type = 'button';
  toggle.textContent = '收起';

  head.appendChild(title);
  head.appendChild(badge);
  head.appendChild(toggle);
  card.appendChild(head);

  // ---- 步骤列表 ----
  const list = document.createElement('ul');
  list.className = 'trace-list';

  /** 造一个步骤行 */
  function step(iconText, titleHtml, descHtml, cls) {
    const li = document.createElement('li');
    li.className = 'trace-step' + (cls ? ' ' + cls : '');
    const ic = document.createElement('span');
    ic.className = 'trace-icon';
    ic.textContent = iconText;
    const body = document.createElement('div');
    body.className = 'trace-body';
    const t = document.createElement('div');
    t.className = 'trace-step-title';
    t.innerHTML = titleHtml;
    body.appendChild(t);
    if (descHtml) {
      const d = document.createElement('div');
      d.className = 'trace-step-desc';
      d.innerHTML = descHtml;
      body.appendChild(d);
    }
    li.appendChild(ic);
    li.appendChild(body);
    return { li, body };
  }

  if (trace.mode === 'llm') {
    trace.rounds.forEach((r) => {
      if (r.action === 'call_tool') {
        const s = step('◆', `第 ${r.step} 轮 · 决定调用工具`,
          `模型选择 <code>${escapeHtml(r.tool)}</code>，检索词「${escapeHtml(r.query)}」`, 'is-decide wants-tool');
        list.appendChild(s.li);
      } else {
        const s = step('✓', `第 ${r.step} 轮 · 直接作答`, '模型判断无需再检索', 'is-decide');
        list.appendChild(s.li);
      }
    });
    // 命中片段单独一张
    const hits = trace.hits || [];
    const s2 = step(hits.length ? '🔍' : '!', '检索结果',
      hits.length ? `命中 ${hits.length} 段，来源：${trace.sources.join('、')}` : '空 —— 知识库里没有相关资料',
      hits.length ? 'is-hit' : 'is-miss');
    if (hits.length) s2.body.appendChild(hitPreview(hits));
    list.appendChild(s2.li);
  } else {
    // 本地模式：把「判断 → 检索 → 作答」三步都摊开
    const s1 = step('◆', '第 1 轮 · 判断要不要查',
      trace.used ? '判定为事实类问题 → 去检索知识库' : '判定为闲聊 → 不查资料，直接回答',
      'is-decide' + (trace.used ? ' wants-tool' : ''));
    list.appendChild(s1.li);

    if (trace.used) {
      const hits = trace.hits || [];
      const s2 = step(hits.length ? '🔍' : '!', '检索知识库',
        hits.length
          ? `命中 ${hits.length} 段 · 覆盖率 ${Math.round((trace.coverage || 0) * 100)}%`
          : '空 —— 知识库里没有相关内容，所以如实回答「资料里没有提到」',
        hits.length ? 'is-hit' : 'is-miss');
      if (hits.length) s2.body.appendChild(hitPreview(hits));
      list.appendChild(s2.li);
    }

    const s3 = step('💬', '作答',
      `${trace.ms > 0 ? trace.ms + ' ms · ' : ''}未经过大模型，答案由命中原文的句子组成`, '');
    list.appendChild(s3.li);
  }

  card.appendChild(list);
  wrap.appendChild(card);

  toggle.addEventListener('click', () => {
    const collapsed = card.classList.toggle('is-collapsed');
    toggle.textContent = collapsed ? '展开' : '收起';
  });
  // 这里不滚动 —— 由 handleAsk 统一滚到「用户那句提问」，保证问答同屏可见
}

/** 命中片段的原文预览列表 */
function hitPreview(hits) {
  const ul = document.createElement('ul');
  ul.className = 'trace-preview';
  hits.slice(0, 4).forEach((h) => {
    const src = h.chunk ? h.chunk.src : h.src;
    const score = typeof h.score === 'number' ? h.score.toFixed(2) : '';
    const text = (h.chunk ? h.chunk.text : '').replace(/\s+/g, ' ').slice(0, 88);

    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = src;
    const sc = document.createElement('span');
    sc.className = 'trace-score';
    sc.textContent = score;
    li.appendChild(b);
    li.appendChild(sc);
    li.appendChild(document.createTextNode(text + '…'));
    ul.appendChild(li);
  });
  return ul;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ==========================================================================
 * 8. 一次问答的主流程
 * ========================================================================== */

async function handleAsk(text) {
  const q = String(text || '').trim();
  if (!q || state.busy) return;

  state.busy = true;
  el.sendBtn.disabled = true;
  setAlert('', '');

  const userBubble = appendMessage('user', q, { meta: nowTime() });
  el.textInput.value = '';

  const bubble = appendMessage('ai', '', { isTyping: true, meta: '思考中…' });
  setStatus('thinking', '思考中…', state.apiKey ? '正在调用 deepseek-chat' : '正在检索本地知识库');

  try {
    const result = state.apiKey ? await agentAnswer(q, state.apiKey) : localAnswer(q);

    state.turns += 1;
    updateMemoryPill();

    // 本地检索通常不到 1 毫秒，显示「0 ms」反而像出错，改成说清命中了多少段
    const metaText = state.apiKey
      ? `${result.trace.ms} ms · ${DEEPSEEK_MODEL}`
      : `本地检索${result.trace.hits && result.trace.hits.length ? ' · 命中 ' + result.trace.hits.length + ' 段' : ''}`;

    updateBubble(bubble, result.reply, metaText);
    renderTrace(bubble, result.trace);

    // 滚到用户那句提问：让「问了什么 + 答了什么」同屏出现，决策卡接在下面
    scrollToMsg(userBubble.parentElement, 6);

    setStatus('ready', '已收到回答', '');

    if (el.autoSpeak.checked) speak(result.reply);
  } catch (err) {
    updateBubble(bubble, String(err.message || err), '出错');
    bubble.classList.add('error');
    setStatus('error', '出错了', '');
    // 大模型失败时自动退回本地检索，不让访客卡在这儿
    if (state.apiKey) {
      setAlert('warn', '调用大模型失败（' + escapeHtml(String(err.message || err)) +
        '）。已自动切回本地检索模式回答。');
      try {
        const r = localAnswer(q);
        const b2 = appendMessage('ai', r.reply, '本地检索兜底');
        renderTrace(b2, r.trace);
        setStatus('ready', '已用本地检索兜底', '');
      } catch (_) { /* 兜底也失败就算了 */ }
    }
  } finally {
    state.busy = false;
    el.sendBtn.disabled = false;
    el.textInput.focus();
  }
}

function updateMemoryPill() {
  const n = Math.min(state.turns, MAX_MEMORY_TURNS);
  el.memoryPill.textContent = `记忆：${n}/${MAX_MEMORY_TURNS} 轮`;
}

/* ==========================================================================
 * 9. 语音识别
 * ========================================================================== */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

function initRecognition() {
  if (!SR) return null;

  const rec = new SR();
  rec.lang = 'zh-CN';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    state.recognizing = true;
    el.micBtn.classList.add('recording');
    el.micLabel.textContent = '正在听…';
    setStatus('listening', '正在听…', '说完会自动结束');
  };

  rec.onresult = (ev) => {
    let interim = '', final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) setStatus('listening', '正在听…', interim);
    if (final) {
      setStatus('thinking', '识别完成', final);
      handleAsk(final);
    }
  };

  rec.onerror = (ev) => {
    state.recognizing = false;
    el.micBtn.classList.remove('recording');
    el.micLabel.textContent = '按住说话';
    const map = {
      'not-allowed': '麦克风权限被拒绝。点地址栏左边的锁图标，允许使用麦克风再试。',
      'no-speech': '没听到声音，再试一次。',
      'audio-capture': '找不到麦克风设备。',
      'network': '语音识别需要联网（浏览器的识别服务在云端）。',
      'service-not-allowed': '这个页面无法使用语音识别，请改用 https 或 127.0.0.1 访问。'
    };
    setStatus('error', '语音识别失败', '');
    setAlert('warn', map[ev.error] || ('语音识别出错：' + ev.error));
  };

  rec.onend = () => {
    state.recognizing = false;
    el.micBtn.classList.remove('recording');
    el.micLabel.textContent = '按住说话';
    if (el.statusText.textContent === '正在听…') setStatus('ready', '准备就绪', '');
  };

  return rec;
}

function toggleMic() {
  if (!state.recognition) {
    setAlert('warn', '当前浏览器不支持语音识别。请用 <b>Edge</b> 或 Chrome 打开本页；' +
                     '也可以直接在下面输入文字提问。');
    return;
  }
  if (state.recognizing) {
    try { state.recognition.stop(); } catch (_) { /* 忽略 */ }
  } else {
    try { state.recognition.start(); }
    catch (_) { /* 连续点击时可能已在启动中 */ }
  }
}

/* ==========================================================================
 * 10. 朗读
 * ========================================================================== */

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  state.voices = window.speechSynthesis.getVoices() || [];
  state.zhVoices = state.voices.filter((v) => /^zh/i.test(v.lang));

  el.voiceSelect.innerHTML = '';
  const list = state.zhVoices.length ? state.zhVoices : state.voices;
  list.forEach((v, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = v.name.replace(/\s*-\s*Chinese.*/i, '') + ' (' + v.lang + ')';
    el.voiceSelect.appendChild(o);
  });

  updateVoicePill();
}

function updateVoicePill() {
  if (!('speechSynthesis' in window)) {
    el.voicePill.textContent = '朗读：不支持';
    el.voicePill.classList.add('is-bad');
    return;
  }
  if (state.zhVoices.length) {
    el.voicePill.textContent = '朗读：中文语音 ' + state.zhVoices.length + ' 个';
    el.voicePill.classList.add('is-ok');
    el.voicePill.classList.remove('is-bad');
  } else if (state.voices.length) {
    el.voicePill.textContent = '朗读：无中文语音';
    el.voicePill.classList.add('is-warn');
  } else {
    // 还没加载完 / 真的没有
    el.voicePill.textContent = '朗读：未检测到语音';
    el.voicePill.classList.add('is-warn');
  }
}

function pickVoice() {
  const list = state.zhVoices.length ? state.zhVoices : state.voices;
  const idx = parseInt(el.voiceSelect.value, 10);
  return list[idx] || list[0] || null;
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;

  if (!state.zhVoices.length && !state.voices.length) {
    setAlert('info', '这个浏览器没有可用的语音包，读不出声音。' +
                     '<b>用 Edge 打开就有中文语音</b>（微软自带）；Chrome 通常需要联网加载语音。' +
                     '文字回答不受影响。');
    return;
  }

  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = parseFloat(el.rateRange.value) || 1;
  const v = pickVoice();
  if (v) u.voice = v;

  u.onstart = () => setStatus('speaking', '朗读中…', '');
  u.onend = () => setStatus('ready', '已收到回答', '');
  u.onerror = () => setStatus('ready', '朗读中断', '');

  window.speechSynthesis.speak(u);
}

/* ==========================================================================
 * 11. 知识库面板
 * ========================================================================== */

function rebuildIndex() {
  index = buildIndex(state.docs);
  el.kbCount.textContent = state.docs.length;
  el.agentPill.textContent = `知识库：${state.docs.length} 篇 / ${index.total} 段`;
  renderKbList();
}

function renderKbList() {
  el.kbList.innerHTML = '';

  if (!state.docs.length) {
    const li = document.createElement('li');
    li.className = 'kb-empty';
    li.textContent = '知识库是空的，先传一份 .md 或 .txt';
    el.kbList.appendChild(li);
  }

  state.docs.forEach((d) => {
    const li = document.createElement('li');
    li.className = 'kb-item';

    const main = document.createElement('div');
    main.className = 'kb-item-main';

    const name = document.createElement('span');
    name.className = 'kb-item-name';
    name.textContent = d.name;

    const meta = document.createElement('span');
    meta.className = 'kb-item-meta';
    meta.textContent = `${d.text.length} 字`;
    if (d.builtin) {
      const flag = document.createElement('span');
      flag.className = 'demo-flag';
      flag.textContent = '内置';
      meta.appendChild(flag);
    }

    main.appendChild(name);
    main.appendChild(meta);

    const del = document.createElement('button');
    del.className = 'link-btn danger';
    del.type = 'button';
    del.textContent = '移除';
    del.addEventListener('click', () => {
      state.docs = state.docs.filter((x) => x !== d);
      rebuildIndex();
    });

    li.appendChild(main);
    li.appendChild(del);
    el.kbList.appendChild(li);
  });

  el.kbStats.textContent = `${state.docs.length} 篇 · ${index.total} 段可检索`;
}

/** 读一个本地文件为文本 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('读取失败：' + file.name));
    fr.readAsText(file, 'utf-8');
  });
}

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  for (const f of files) {
    if (f.size > 2 * 1024 * 1024) {
      setAlert('warn', `${escapeHtml(f.name)} 超过 2MB，已跳过。`);
      continue;
    }
    if (!/\.(md|markdown|txt|text)$/i.test(f.name)) {
      setAlert('warn', `${escapeHtml(f.name)} 不是 .md / .txt，已跳过。`);
      continue;
    }
    try {
      const text = await readFileAsText(f);
      state.docs.push({ name: f.name, text, builtin: false });
    } catch (e) {
      setAlert('warn', escapeHtml(String(e.message || e)));
    }
  }

  rebuildIndex();
  setAlert('info', `已加入 ${files.length} 个文件，现在知识库有 ${state.docs.length} 篇、${index.total} 段可检索。`);
}

/* ==========================================================================
 * 12. Key 管理
 * ========================================================================== */

function loadKey() {
  try { state.apiKey = localStorage.getItem(LS_KEY) || ''; }
  catch (_) { state.apiKey = ''; }
  applyMode();
}

function applyMode() {
  if (state.apiKey) {
    el.modeTag.textContent = '大模型模式';
    el.modeTag.classList.add('is-live');
    el.modeText.innerHTML = '提问会真的发给 <b>deepseek-chat</b>，由模型自己决定要不要检索';
    el.keyBtn.textContent = '更换 / 清除 Key';
    el.modelPill.textContent = '模型：' + DEEPSEEK_MODEL;
    el.modelPill.classList.add('is-ok');
    el.modelPill.classList.remove('is-warn');
  } else {
    el.modeTag.textContent = '本地检索模式';
    el.modeTag.classList.remove('is-live');
    el.modeText.innerHTML = '回答由浏览器内的 BM25 检索命中的原文句子组装，<b>不经过大模型</b>';
    el.keyBtn.textContent = '填入 DeepSeek Key 升级为真模型';
    el.modelPill.textContent = '模型：本地检索（未配置 Key）';
    el.modelPill.classList.remove('is-ok');
    el.modelPill.classList.add('is-warn');
  }
}

function openKeyPanel() {
  el.keyInput.value = state.apiKey;
  el.keyPanel.classList.add('open');
  setTimeout(() => el.keyInput.focus(), 60);
}

function closeKeyPanel() {
  el.keyPanel.classList.remove('open');
}

/* ==========================================================================
 * 13. 事件绑定
 * ========================================================================== */

function bindEvents() {
  el.sendBtn.addEventListener('click', () => handleAsk(el.textInput.value));
  el.textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAsk(el.textInput.value);
  });

  el.micBtn.addEventListener('click', toggleMic);

  el.stopSpeakBtn.addEventListener('click', () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setStatus('ready', '已停止朗读', '');
  });

  el.rateRange.addEventListener('input', () => {
    el.rateValue.textContent = parseFloat(el.rateRange.value).toFixed(1);
  });

  el.voiceSelect.addEventListener('change', updateVoicePill);

  el.clearBtn.addEventListener('click', () => {
    el.chat.querySelectorAll('.msg').forEach((n) => n.remove());
    if (el.empty) el.empty.hidden = false;
    state.turns = 0;
    updateMemoryPill();
    setStatus('ready', '对话已清空', '');
  });

  // 知识库
  el.kbBtn.addEventListener('click', () => { el.kbPanel.hidden = false; renderKbList(); });
  el.kbCloseBtn.addEventListener('click', () => { el.kbPanel.hidden = true; });
  el.kbPickBtn.addEventListener('click', () => el.kbFile.click());
  el.kbFile.addEventListener('change', (e) => addFiles(e.target.files));

  ['dragenter', 'dragover'].forEach((t) => el.kbDrop.addEventListener(t, (e) => {
    e.preventDefault(); el.kbDrop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((t) => el.kbDrop.addEventListener(t, (e) => {
    e.preventDefault(); el.kbDrop.classList.remove('is-over');
  }));
  el.kbDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  el.kbResetBtn.addEventListener('click', () => {
    state.docs = BUILTIN_DOCS.map((d) => ({ ...d }));
    rebuildIndex();
    setAlert('info', '已恢复内置文档。');
  });

  el.kbClearBtn.addEventListener('click', () => {
    state.docs = [];
    rebuildIndex();
    setAlert('info', '知识库已清空。现在问什么都会回答「资料里没有提到」—— 这正是它不编造的表现。');
  });

  // Key
  el.keyBtn.addEventListener('click', openKeyPanel);
  el.keyCancel.addEventListener('click', closeKeyPanel);
  el.keyPanel.addEventListener('click', (e) => { if (e.target === el.keyPanel) closeKeyPanel(); });

  el.keySave.addEventListener('click', () => {
    const k = el.keyInput.value.trim();
    if (!k) { setAlert('warn', 'Key 是空的。直接关掉就是继续用本地检索模式。'); return; }
    if (!/^sk-/.test(k)) { setAlert('warn', 'DeepSeek 的 Key 一般以 sk- 开头，请确认没粘错。'); return; }
    try { localStorage.setItem(LS_KEY, k); } catch (_) { /* 隐私模式下会失败 */ }
    state.apiKey = k;
    applyMode();
    closeKeyPanel();
    setAlert('info', '已启用大模型模式。现在提问会真的发给 deepseek-chat，注意会产生费用。');
  });

  el.keyDelete.addEventListener('click', () => {
    try { localStorage.removeItem(LS_KEY); } catch (_) { /* 忽略 */ }
    state.apiKey = '';
    el.keyInput.value = '';
    applyMode();
    closeKeyPanel();
    setAlert('info', '已清除 Key，回到本地检索模式。');
  });
}

/* ==========================================================================
 * 14. 启动
 * ========================================================================== */

(function init() {
  state.recognition = initRecognition();

  rebuildIndex();
  updateMemoryPill();
  loadKey();
  bindEvents();

  // 语音列表可能是异步加载的（Chrome/Edge 都要等 voiceschanged）
  if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 400);     // 有些浏览器不触发事件，补一次
  } else {
    updateVoicePill();
  }

  if (!SR) {
    setAlert('info', '这个浏览器不支持语音识别，<b>用 Edge 打开就能说话</b>。' +
                     '文字提问现在就可以用。');
  } else if (location.protocol !== 'https:' && !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
    setAlert('info', '麦克风只能在 <b>https</b> 或 <b>127.0.0.1</b> 下使用，当前地址用不了语音。文字提问正常。');
  }

  setStatus('ready', '准备就绪', '');
  el.textInput.focus();
})();
