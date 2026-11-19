/** Six lessons copied from the web feed in apps/drive-web/template.html. */

export type TitlePart = { text: string; amber?: boolean; mono?: boolean };

export type LessonPoint = { title: string; body: string; mark: string };

export type LessonAsk = { q: string; a: string };

export type LessonKind = "cover" | "video" | "carousel" | "gates" | "patterns" | "code";

export type Lesson = {
  id: string;
  day: number;
  kind: LessonKind;
  kicker: string;
  title: TitlePart[];
  sub?: string;
  chip: string;
  author: string;
  desc: string;
  tags: string;
  sheetTitle: string;
  meta: string;
  points: LessonPoint[];
  videoTitle: string;
  asks: LessonAsk[];
  quiz: LessonAsk;
  chips?: string[];
  floatTitle?: string;
  floatSub?: string;
};

export function dayLabel(day: number): string {
  return `DAY ${String(day).padStart(2, "0")} / 30`;
}

export const LOOP_NODE_4 = "追加进上下文";

export const CAROUSEL_PAGE_TWO_POINT: LessonPoint = {
  title: "付款要单独的工具",
  body: "金额、校验、审批固定下来。有 bash 和 Python 也不够。",
  mark: "要点",
};

export const PATTERN_CARDS: { n: string; title: string; body: string; wide?: boolean }[] = [
  { n: "01", title: "提议者-审核者", body: "Agent 写，人或另一个模型审" },
  { n: "02", title: "渐进式披露", body: "需要时再展开更多" },
  { n: "03", title: "只增不改", body: "记录只追加，不覆盖" },
  { n: "04", title: "边界集 + 保留集", body: "修好目标，不改坏旧的" },
  { n: "05", title: "最小 diff + 可回滚", body: "只改一行，出错就撤回", wide: true },
];

export const LESSONS: Lesson[] = [
  {
    id: "day-01",
    day: 1,
    kind: "cover",
    kicker: "AI Agent · 30天精读",
    title: [
      { text: "Agent", mono: true },
      { text: " 在\n「想→做→看」\n中循环" },
    ],
    sub: "大脑是 LLM，眼睛是上下文，手脚是工具",
    chip: "精读《深入理解 AI Agent》· 引言及 1.1",
    author: "@Study Bot · AI Agent 每日一课",
    desc: "今天搞懂 3 件事：大脑、眼睛、手脚各是什么",
    tags: "#AIAgent #ReAct",
    sheetTitle: "Agent = LLM + 上下文 + 工具",
    meta: "精读《深入理解 AI Agent》· 引言及 1.1 · 讲义约 8 分钟 · 视频 3:20 · 时长示意",
    points: [
      { title: "大脑是 LLM", body: "想：模型思考，决定下一步做什么", mark: "2 分钟" },
      { title: "眼睛是上下文", body: "固定前缀 + 不断增长的执行轨迹", mark: "3 分钟" },
      { title: "手脚是工具", body: "最大杠杆：扩大它看到的和能做的", mark: "3 分钟" },
    ],
    videoTitle: "动画：一次 想→做→看 循环",
    asks: [
      { q: "拿掉「工具返回结果」会怎样？", a: "看不到做了什么、做成没有，只能盲目重复。" },
      { q: "上下文由哪几段组成？", a: "固定前缀（系统提示和工具定义）加上不断增长的执行轨迹。" },
    ],
    quiz: { q: "从上下文里拿掉「工具返回结果」，Agent 会怎样？", a: "看不到做了什么、做成没有，只能盲目重复。" },
  },
  {
    id: "day-02",
    day: 2,
    kind: "video",
    kicker: "HARNESS · TERMINAL BENCH",
    title: [{ text: "同一模型，差距在 Harness" }],
    chip: "",
    author: "@Study Bot · AI Agent 每日一课",
    desc: "同一个模型，只改 Harness 就能差近 14 分",
    tags: "#AIAgent #Harness",
    sheetTitle: "Model 与 Harness 的分界",
    meta: "1.x Harness · 小节号待核 · 讲义约 8 分钟 · 视频 3:20 · 时长示意",
    points: [
      { title: "Agent = 模型 + Harness", body: "边界以内、模型以外、不含环境", mark: "要点" },
      { title: "Harness 五件套", body: "上下文管理、工具接口、约束、验证、纠正", mark: "要点" },
      { title: "一层层变大", body: "提示工程 ⊂ 上下文工程 ⊂ Harness 工程 ⊂ Loop 工程 ⊂ Graph 工程", mark: "要点" },
    ],
    videoTitle: "同一模型，只改 Harness",
    floatTitle: "Model 与 Harness 的分界",
    floatSub: "3 个要点 · 8 分钟 · 3:20",
    chips: ["上下文管理", "工具接口", "约束", "验证", "纠正"],
    asks: [
      { q: "浏览器算不算 Harness？", a: "不算，属于环境；云端权限检查服务反而算。" },
      { q: "五件套是哪五件？", a: "上下文管理、工具接口、约束、验证、纠正。" },
    ],
    quiz: { q: "用户的浏览器算不算 Harness？", a: "不算，属于环境；云端权限检查服务反而算。" },
  },
  {
    id: "day-03",
    day: 3,
    kind: "carousel",
    kicker: "",
    title: [{ text: "通用工具探索，专用工具守底线" }],
    chip: "完整讲义 + 3 分钟视频",
    author: "@Study Bot · AI Agent 每日一课",
    desc: "已有 bash 和 Python，还要单独写「付款」工具吗？",
    tags: "#AIAgent #工具",
    sheetTitle: "工具五分类与「模型即 Agent」",
    meta: "第 1 章 · 工具分类与模型即 Agent · 小节号待核 · 时长示意",
    points: [
      { title: "五类工具", body: "感知、执行、协作、事件触发、用户沟通", mark: "要点" },
      { title: "「模型即 Agent」", body: "调哪个工具的决策搬进参数，工具仍在 Harness 执行", mark: "要点" },
      { title: "三条学习路径", body: "上下文临时适应、更新外部文档和程序、更新模型参数", mark: "要点" },
    ],
    videoTitle: "通用工具和专用工具",
    asks: [
      { q: "还要单独写「付款」工具吗？", a: "要。金额、校验、审批固定下来。" },
      { q: "五类工具是什么？", a: "感知、执行、协作、事件触发、用户沟通。" },
    ],
    quiz: { q: "有 bash 和 Python 了，还要单独写「付款」工具吗？", a: "要，金额、校验、审批固定下来。" },
  },
  {
    id: "day-04",
    day: 4,
    kind: "gates",
    kicker: "AI Agent · 30天精读",
    title: [
      { text: "提示词拦不住，\n" },
      { text: "硬约束", amber: true },
      { text: "才安全" },
    ],
    sub: "只在系统提示里写「不许全额退款」，够吗？",
    chip: "精读《深入理解 AI Agent》· 编排与护栏",
    author: "@Study Bot · AI Agent 每日一课",
    desc: "提示词只能降概率，要在执行层、数据层硬拦",
    tags: "#AIAgent #护栏",
    sheetTitle: "编排方式与三层护栏",
    meta: "第 1 章 · 编排与护栏 · 时长示意",
    points: [
      { title: "三种编排", body: "单次调用、固定工作流、自主 Agent，可混用", mark: "要点" },
      { title: "三层护栏", body: "上下文层、执行层、数据层，越往后越难绕过", mark: "要点" },
      { title: "拉人进来", body: "连续失败超阈值，或高风险操作", mark: "要点" },
    ],
    videoTitle: "三道闸门：全额退款停在哪一层",
    asks: [
      { q: "只写「不许全额退款」够吗？", a: "不够，要在执行层或数据层硬拦，比如退款工具设上限。" },
      { q: "哪一层最难绕过？", a: "数据层。越往后越难绕过。" },
    ],
    quiz: { q: "只在系统提示写「不许全额退款」够吗？", a: "不够，要在执行层或数据层硬拦，比如退款工具设上限。" },
  },
  {
    id: "day-05",
    day: 5,
    kind: "patterns",
    kicker: "AI Agent · 30天精读",
    title: [
      { text: "五个模式", amber: true },
      { text: "\n贯穿整本书" },
    ],
    chip: "精读《深入理解 AI Agent》· 第 1 章",
    author: "@Study Bot · AI Agent 每日一课",
    desc: "拆任何 Agent 产品，先问这三件事",
    tags: "#AIAgent #设计模式",
    sheetTitle: "五个贯穿全书的设计模式",
    meta: "第 1 章 · 设计模式小结与思考题 · 时长示意",
    points: [
      { title: "提议者-审核者", body: "Agent 写，人或另一模型审", mark: "要点" },
      { title: "渐进式披露，只增不改", body: "需要时再展开；记录只追加，不覆盖", mark: "要点" },
      { title: "边界、保留、最小 diff", body: "修好目标且不改坏旧的；只改一行，出错就撤回", mark: "要点" },
    ],
    videoTitle: "五个模式怎么落在产品上",
    asks: [
      { q: "为什么要边界集和保留集？", a: "边界集验证修好目标问题，保留集防止改坏原来好的；只有边界集易过拟合。" },
      { q: "拆产品先问什么？", a: "看到什么、能做什么、怎么验证。" },
    ],
    quiz: { q: "为什么同时要边界集和保留集？", a: "边界集验证修好目标问题，保留集防止改坏原来好的；只有边界集易过拟合。" },
  },
  {
    id: "day-06",
    day: 6,
    kind: "code",
    kicker: "AI Agent · 30天精读",
    title: [
      { text: "Agent 框架\n就是管好\n" },
      { text: "消息列表", amber: true },
    ],
    chip: "精读《深入理解 AI Agent》· 2.1",
    author: "@Study Bot · AI Agent 每日一课",
    desc: "第 30 步时，第 1 步的信息为什么还在？",
    tags: "#AIAgent #上下文",
    sheetTitle: "上下文决定能力上限",
    meta: "2.1 · 实验 2-1 · 时长示意",
    points: [
      { title: "模型不记得上一步", body: "每轮重发整个上下文", mark: "要点" },
      { title: "工具结果要配对", body: "靠 tool_call_id 与请求配对，模型消息原样回传", mark: "要点" },
      { title: "当成天才新员工", body: "看不到的文档就等于不存在", mark: "要点" },
    ],
    videoTitle: "消息列表怎么一圈圈变长",
    asks: [
      { q: "第 30 步时第 1 步为什么还在？", a: "每轮都重发完整消息列表；代价是上下文变长、成本延迟上涨，引出 KV 缓存。" },
      { q: "工具结果怎么对上请求？", a: "靠 tool_call_id 配对，模型消息原样回传。" },
    ],
    quiz: { q: "第 30 步时第 1 步的信息为什么还在？", a: "每轮都重发完整消息列表；代价是上下文变长、成本延迟上涨，引出 KV 缓存。" },
  },
];

export const LESSON_IDS = LESSONS.map((lesson) => lesson.id);

export function lessonById(id: string): Lesson {
  return LESSONS.find((lesson) => lesson.id === id) ?? LESSONS[0];
}
