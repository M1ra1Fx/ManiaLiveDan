// ManiaLiveDan — 全局配置。
// 想改窗口长度/刷新步进，直接改这里即可（单位毫秒）。
// tosu 的 ingame overlay 用 `tosu://server/...` 自定义协议加载页面，
// 此时 location.host 是 "server"，不能拿它当 tosu 服务地址。
// 浏览器 / OBS 源（http://localhost:24050/...）仍用同源 host。
const RAW_HOST = (typeof location !== "undefined" && location.host) ? location.host : "";
const IS_TOSU_SCHEME = typeof location !== "undefined"
    && (location.protocol === "tosu:" || RAW_HOST === "server");
const PAGE_HOST = (RAW_HOST && !IS_TOSU_SCHEME) ? RAW_HOST : "localhost:24050";
const SECURE = typeof location !== "undefined" && location.protocol === "https:";

export const APP = {
    // tosu 服务地址：页面本身由 tosu 托管，用同源 host 最稳。
    host: PAGE_HOST,
    httpOrigin: `${SECURE ? "https" : "http"}://${PAGE_HOST}`,
    wsOrigin: `${SECURE ? "wss" : "ws"}://${PAGE_HOST}`,
    wsPath: "/websocket/v2",

    // 当前段位显示窗口（单位 ms）：默认 [当前−2s, 当前+1s]。
    // 只用于「分段计算失败」时的兜底路径（computeSectionAt）。
    // 注意这条兜底路径的窗口含 1s 未来，本身就会让显示偏早；正常走分段时用不到。
    windowMs: 3000,
    futureMs: 1000,
    // 播放位置补偿（ms）：正数 = 把“当前时间”往后推（显示更提前），负数 = 延后。
    // 只影响显示时机，不改谱面分析/取样窗口。
    //
    // 历史：这里曾经是 -750，用来压掉「显示偏早半秒到一秒」。
    // 那个偏早的根因是难度曲线用了居中窗口（t±1s），把未来 1 秒的音符算进了当前难度
    // —— 现在曲线改成只往回看（segmentCurveLookaheadMs=0），根因已经消掉，
    // 所以这里回到 0。如果仍有轻微偏差再微调，不要一上来就填几百毫秒。
    timeOffsetMs: 0,
    // 时间轴/查找精度。
    stepMs: 1000,

    // 背景预计算：每个 tick 最多算多久（ms）与间隔（ms），避免卡主线程。
    prefillBudgetMs: 6,
    prefillDelayMs: 16,
    // 预计算期间时间轴画布的重绘节流（ms）。
    timelinePaintIntervalMs: 180,

    // LN 段位显示门槛：低于 LN 表下限（约 4.83 星）不显示，避免一直 "< LN 5"。
    showLnMinStar: 4.84,

    // 谱面文件抓取重试。
    fetchRetries: 6,
    fetchRetryDelayMs: 120,

    // 超过这么久没收到 tosu 消息，就停止外推播放位置（防止断流时游标一直滑）。
    staleMs: 3500,
    // 连续多少条没有谱面身份才真正清空（防 partial 包抖动）。
    missingIdentityLimit: 3,

    // true = 不显示 "Intro 1/2/3" 段位（低于 Reform 1 的段落显示 "—"）；
    // false = 保留 Intro 1-3。
    hideIntro: true,
    // true = 只在游戏进行中显示（选歌/结算/菜单隐藏）；false = 任何时候都显示。
    // 也可以在 tosu 面板的计数器设置里改（settings.json 会覆盖这里）。
    showOnlyInGame: true,
    // true = 选歌界面也显示（显示整图难度）；false = 选歌时也隐藏。
    showInSongSelect: true,
    // 本计数器在 static 下的路径（tosu 面板改设置时用于读取自己的设置）。
    counterPath: "/ManiaLiveDan.by.MiraiFx/",
    // true = 在徽章右上角额外显示 -- / - / + / ++ 角标（徽章图本身已随分档变化）。
    showTierMark: false,
    // 界面语言："en"（默认）/ "zh"。也可以在 tosu 面板的计数器设置里改
    // （settings.json 的 language 会覆盖这里）。
    language: "en",
    // true = 使用扩展段位表（4K/7K 的高难扩展区间）。
    extendedRange: false,

    // ---- 整图算法（面板下拉的默认值；三个键数各自独立）----
    // 可用范围：4K = Sunny/Daniel/Azusa/Roxy/Mixed/Companella
    //           6K/7K = Sunny/Daniel/Mixed（Azusa/Roxy 源码里只支持 4K）
    defaultAlgorithm: "Mixed",
    estimatorTimeoutMs: 60000,
    etternaVersion: "0.72.3",
    companellaEtternaVersion: "0.74.0",

    // 光环旋转基准：**线速度**（px/秒，难度系数 = 1 时）。
    // 不要改回"一圈几秒"：周期写死的话，窗口一拖大、周长变长，线速度就跟着变快。
    // 现在周期 = 周长 / (基准线速度 × 难度系数)，窗口怎么拖都是同一条速度。
    glowBaseSpeed: 114,

    // 米段在环上占的周长权重（LN 恒为 1）。
    // 2 = 米段弧长是"同段位数字的 LN"的两倍：Alpha(11)+LN7 → 22:7（22/29 与 7/29）。
    // 改回 1 就是原来的纯段位数字比（11:7 → 11/18 与 7/18）。
    glowRcShareWeight: 2,

    // ---- 自动切段（“现在这段”） ----
    // 优先用 Sunny 的逐 note 难度曲线找边界（250ms 精度，不再被小节卡住）；
    // 曲线不可用时回退到“小节网格 + 相似段合并”。
    segmentationEnabled: true,
    // 难度曲线的取样窗口（ms）：只往回看，反映“我正在打的这一段”。
    // 调大 = 更平滑、对短促起伏不敏感；调小 = 更贴瞬时手感但容易碎。
    segmentCurveWindowMs: 1200,
    // 曲线额外往后看多少（ms）。默认 0 = 完全不看未来音符（推荐）。
    // 不要轻易调大：一往后看，难度就会在真正变之前提前变化。
    segmentCurveLookaheadMs: 0,
    // 回退路径的参数：相邻小节星数差 ≤ 这个值就合并
    // LN 占比差超过这个值就不合并（0.35 = 35 个百分点）。用户举的例子是 0%→40%，
    // 所以阈值必须小于 0.40；再小会把 LN 占比正常波动的段落切碎（实测 0.25 时段数 +25%）。
    // 密度相近但 LN 占比差别大的两段必须分开，否则前半段没 LN 也会被标成高 LN。
    segmentMergeLnDelta: 0.35,

    segmentMergeDelta: 0.35,
    // 段太短就并进相邻段（ms）；graph 路径也用它作为最短段长
    segmentMinMs: 4000,
    // 单段最长（ms），超过就不再合并（仅回退路径）
    segmentMaxMs: 32000,

    // 0.4.0 起算法全部在本地（js/lib/estimator），不再读 ManiaMapAnalyser 目录，
    // 所以原来的 mmaAlign / mmaBaseUrl / mmaTimeoutMs 等配置已移除。

    // ---- 光晕 ----
    // 底光那一层相对主灯的宽度倍数。1 = 不要底光；2.7 = 有明显的霓虹厚度。
    // 霓虹三层：灯芯(1x) / 紧光 / 远光，相对灯芯宽度的倍数。
    glowTightScale: 2.4,
    glowHaloScale: 3.4,

    // ---- 分段（当前段位）用哪个算法 ----
    // "sunny"（默认）：Sunny 逐段计算。它是唯一有局部信息的算法 ——
    //     实测 corr(分段星数, 音符/秒) = 0.92。
    // "mixed"：每段切片后跑 MMA 的 Mixed 管线。实测不可用，仅供验证：
    //     corr(分段值, 音符数) = 0.88、corr(, 段时长) = 0.74，36% 的段直接卡在
    //     Companella 的输出下限；同一位置把窗口从 5s 拉到 160s，数值从 3.7 单调
    //     爬到 14.4（=整图值），跟切片位置几乎无关。也就是说它量的是长度不是难度。
    //     证据脚本：tests/mma_segment_probe.mjs、tests/mma_window_sweep.mjs
    segmentEstimator: "sunny",
};
