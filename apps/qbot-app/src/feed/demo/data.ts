/** Static proactive samples. Not a live feed. No paths, no private fields. */

export const DEMO_IDS = ["demo-info", "demo-english", "demo-study"] as const;

export type DemoId = (typeof DEMO_IDS)[number];

export type DemoAccount = {
  id: DemoId;
  name: string;
  kind: string;
  bio: string;
  stats: { value: string; label: string }[];
  section: string;
  sectionNote: string;
};

const HERO_CHARS = /^[0-9$€£¥%]+$/;

/** A hero is optional, at most 4 characters, and must already appear in the card text. */
export function heroIssue(hero: string | undefined, source: string): string | null {
  if (hero === undefined || hero.length === 0) return null;
  if (hero.length > 4) return "too long";
  if (!HERO_CHARS.test(hero)) return "bad characters";
  if (!source.includes(hero)) return "not in the card text";
  return null;
}

export const WAVEFORM = [0.845, 0.798, 0.834, 0.809, 0.705, 0.818, 0.759, 0.967, 0.939, 0.831, 0.88, 0.718, 0.989, 1, 0.848, 0.983, 0.729, 0.851, 1, 0.729, 0.794, 0.775, 0.779, 0.838, 0.989, 0.801, 0.651, 0.911, 0.961, 0.735, 0.886, 0.909, 0.843, 0.898, 0.892, 0.802, 0.921, 0.897, 0.524, 0.06, 0.06, 0.06, 0.06, 0.06, 0.779, 0.804, 0.72, 0.875, 0.84, 0.911, 0.822, 0.831, 0.961, 0.9, 0.921, 0.858, 0.911, 0.869, 0.809, 0.678, 0.929, 0.875, 0.807, 0.783];

export const INFO = {
  id: "demo-info" as const,
  name: "Info Bot",
  mast: "AI DAILY SIGNAL",
  date: "THU · 11.19",
  hero: "83",
  title: "Anthropic 定价 83 美元，周四 ANT 开盘",
  hook: "路透社称将于美国时间周四以代码 ANT 开盘。",
  chips: ["11-19 日报", "媒体转述"],
  points: [
    { n: "01", tag: "IPO", text: "定价 83 美元，称募资约 810 亿" },
    { n: "02", tag: "模型", text: "谷歌发布 Gemini 4 Neon" },
    { n: "03", tag: "模型", text: "GPT-6.2 评价继续分化" },
  ],
  immersiveTitle: "Anthropic 定价 83 美元，周四 ANT 开盘",
  accountLine: "Info Bot · 11-19 日报",
  signals: [
    { n: "01", tags: ["IPO", "媒体转述"], title: "Anthropic 以 83 美元定价，高于原 70–78 美元区间", body: "路透社称发行约 9.80 亿股、募资约 810 亿美元，称其为史上最大 IPO；周四在纳斯达克以 ANT 开盘。" },
    { n: "02", tags: ["模型"], title: "Google 推出 Gemini 4 Neon，Genie 4 对 Ultra 开放", body: "已在 Google AI Studio、API 及 Pro / Ultra 档可用；Genie 4 对符合条件的 Ultra 订阅开放试用。" },
    { n: "03", tags: ["模型"], title: "GPT-6.2 Sol / Astra 评价继续分化", body: "Codex 负责人称，早期测评账号拿到的是旧版本，上线前 3–4 天的改动未必重测。" },
  ],
  sourceLine: "Info Bot · 2026-11-19 日报 · 窗口 2026-11-18 08:12 至 2026-11-19 08:12（北京时间）· 来源：X 业界名单、IPO 采集、HF Daily Papers、GitHub Trending。以上为媒体转述，未见公司官方帖。",
  ask: "和我现在用的模型有什么关系？",
  answer: "样例回答，没有发给模型。这三条都是公开报道的转述，和你本机上的模型没有对应关系。",
  why: "你关注 AI 进展和投资。",
  thumbs: [
    { date: "11-19", title: "83 美元，周四 ANT 开盘", tag: "IPO", hero: "83" },
    { date: "11-18", title: "GPT-6.2 Sol 与 Astra 发布，测评两极分化", tag: "模型发布" },
    { date: "11-17", title: "Anthropic 上市前夜", tag: "IPO" },
    { date: "11-16", title: "Anthropic 上市周：11/18 定价", tag: "IPO" },
    { date: "11-15", title: "Anthropic 本周上市", tag: "IPO" },
    { date: "11-14", title: "Anthropic 下周四上市", tag: "IPO" },
    { date: "11-12", title: "Anthropic IPO 传数倍超额认购", tag: "IPO" },
    { date: "11-11", title: "Gemini 4 Carbon 发布", tag: "模型发布" },
    { date: "11-10", title: "Claude Fable 5.2 与 Mythos 5.2 发布", tag: "模型发布" },
  ],
};

export const ENGLISH = {
  id: "demo-english" as const,
  name: "English Bot",
  mast: "DAILY SPOKEN ENGLISH",
  date: "11.19",
  phrase: "get this over\nthe line",
  phraseLine: "get this over the line",
  meaning: "把快完成的事推过终点线",
  hook: "不是启动，是收尾。",
  example: "Let's get that over the line today, so marketing can schedule spend tonight.",
  highlight: "get that over the line",
  meaningLong: "把这件事收尾做完。不是从零开始，是把已经快完成的事真正落地。",
  dialogue: [
    "The bundle page is almost ready. Legal is still on one line of copy.",
    "Let's get that over the line today, so marketing can schedule spend tonight.",
  ],
  mix: [
    { phrase: "get the ball rolling", gloss: "启动" },
    { phrase: "get it over the line", gloss: "收尾", focus: true },
  ],
  practice: "落地页只差法务一句文案，经理问能否赶上周五上线。用 get this over the line 回答。",
  ask: "跟读短对话",
  answer: "样例，没有打开麦克风，也没有打分。",
  why: "你在练口语，这句开会常用。",
  phrases: [
    { date: "11-19", phrase: "get this over the line" },
    { date: "11-18", phrase: "hold off" },
    { date: "11-10", phrase: "what's your read" },
    { date: "11-09", phrase: "let me play that back" },
    { date: "11-08", phrase: "add some color" },
    { date: "11-07", phrase: "in the weeds" },
    { date: "11-12", phrase: "gut check" },
    { date: "11-11", phrase: "sanity check" },
    { date: "11-06", phrase: "land the plane" },
  ],
};

export const STUDY = {
  id: "demo-study" as const,
  name: "Study Bot",
  kicker: "AI Infra · 30 天精读",
  day: 3,
  total: 30,
  title: "一步 decode 约 2N，要和 prefill 分账",
  hook: "把「再写 256 token」写成可核对的账本。",
  formula: "F ≈ 2N",
  corner: "INFRA 待开",
  takeaways: [
    { n: "01", text: "一次乘加等于 2 FLOPs", note: "× + ＝ 2" },
    { n: "02", text: "一步 decode 约等于 2N", note: "8B → 约 16 GFLOPs / 步" },
    { n: "03", text: "prefill、decode 分开记账", note: "" },
  ],
  immersiveTitle: "F ≈ 2N：一步 decode 的运算账",
  accountLine: "Study Bot · AI Infra · Day 3",
  steps: ["乘加 = 2 FLOPs", "F ≈ 2N", "prefill vs decode"],
  note: "不是「80 亿次运算」：参数个数 ≠ 运算次数。每个参数一次乘加，计 2 FLOPs。",
  ask: "为什么 decode 要读整份权重？",
  answer: "样例回答，没有发给模型。一步 decode 仍要读整份权重，再加已经写下的 KV。",
  why: "停学约三周，Day 3 讲义已齐。",
  lessons: [
    { day: "DAY 03", kicker: "AI INFRA", title: "计算图与自回归账本", mark: "待开", filled: 3 },
    { day: "DAY 02", kicker: "AI INFRA", title: "MFR 估算与 70B 案例", mark: "完成", filled: 2 },
    { day: "DAY 01", kicker: "AI INFRA", title: "五问六层与一次请求", mark: "完成", filled: 1 },
    { day: "DAY 06", kicker: "AGENT · 复习", title: "Agent 框架就是管好消息列表", mark: "", filled: 0 },
    { day: "DAY 05", kicker: "AGENT · 复习", title: "五个模式贯穿整本书", mark: "", filled: 0 },
    { day: "DAY 04", kicker: "AGENT · 复习", title: "提示词拦不住，硬约束才安全", mark: "", filled: 0 },
    { day: "DAY 03", kicker: "AGENT · 复习", title: "通用工具探索，专用工具守底线", mark: "", filled: 0 },
    { day: "DAY 02", kicker: "AGENT · 复习", title: "同一模型，差距在 Harness", mark: "", filled: 0 },
    { day: "DAY 01", kicker: "AGENT · 复习", title: "Agent 在「想→做→看」中循环", mark: "", filled: 0 },
  ],
};

export const ACCOUNTS: Record<DemoId, DemoAccount> = {
  "demo-info": {
    id: "demo-info",
    name: "Info Bot",
    kind: "AI 日报",
    bio: "每天早上一份 AI 日报：模型、融资、IPO、论文，结论放最前面。",
    stats: [
      { value: "46 天", label: "连续出刊" },
      { value: "每天 1 张", label: "Feed 最多一条" },
      { value: "08:16", label: "今日出刊 · 北京" },
    ],
    section: "最近的日报",
    sectionNote: "示例卡片",
  },
  "demo-english": {
    id: "demo-english",
    name: "English Bot",
    kind: "每日口语",
    bio: "每天一句开会用得上的口语：课文加音频，约 3 分钟。",
    stats: [
      { value: "每天 1 句", label: "课文 + 音频" },
      { value: "3:15", label: "今日音频" },
      { value: "10-06", label: "开课" },
    ],
    section: "最近的口语",
    sectionNote: "示例卡片",
  },
  "demo-study": {
    id: "demo-study",
    name: "Study Bot",
    kind: "接着学",
    bio: "把一本书拆成每天一课，按进度接着学。当前：《深入理解 AI Infra》。",
    stats: [
      { value: "Day 3 / 30", label: "AI Infra" },
      { value: "Day 45", label: "Agent 已学完" },
      { value: "7 天", label: "停学才提醒一次" },
    ],
    section: "最近的课",
    sectionNote: "示例卡片",
  },
};

export function demoById(id: string): DemoId | null {
  return (DEMO_IDS as readonly string[]).includes(id) ? id as DemoId : null;
}

/** Feed, immersive, and account chrome for one sample. Gutters darken this color. */
export function demoSurface(id: DemoId): string {
  if (id === "demo-info") return "#F3EFE7";
  if (id === "demo-english") return "#D9774B";
  return "#0F0F11";
}

const infoSource = `${INFO.title}\n${INFO.hook}\n${INFO.points.map((point) => point.text).join("\n")}\n${INFO.signals.map((item) => `${item.title}\n${item.body}`).join("\n")}`;

export function assertDemoCopy(): void {
  const issue = heroIssue(INFO.hero, infoSource);
  if (issue) throw new Error(issue);
  const heroes = [INFO.hero];
  if (heroes.length > 1) throw new Error("one hero");
}
