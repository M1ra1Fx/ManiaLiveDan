# Prism 算法（6K / 7K / 8K）· 测试版

ManiaLiveDan 支持把 **6K / 7K** 的整图难度交给 [Prism](https://mania-tracker.com/news/prism) 计算。
在 tosu 设置面板里，把「6K Algorithm」「7K Algorithm」从 `Sunny` 改成 `Prism` 即可。
默认仍然是 `Mixed`（= Sunny 口径），**不改设置就完全等同旧行为**。

---

## 1. Prism 是什么

`mania-tracker.com` 作者（aleju03）为 6K / 7K / 8K 编的难度计算器，用来取代 MinaCalc。

MinaCalc 是为 4K 写的，套到 7K 上会犯三类错：

| 问题 | 例子（官方公告数据） |
|---|---|
| 把轮指（jumptrill）当高速流 | `[7K] Jumptrill ~>`：MinaCalc 43.5 → Prism **18.0** |
| 变速图爆涨 | 同一张 1.3x：MinaCalc 56.1 → Prism **30.0** |
| 完全不认识 LN | `[7K] Challenge`（重 LN）：MinaCalc 4.9 → Prism **18.5** |
| 没有 Technical / Bracket | — |

Prism 的 skillset：Chordstream / Bracket / Jack / Technical / Delay / LN。

**源码**：[aleju03/mania-hub `algorithms/prism`](https://github.com/aleju03/mania-hub/tree/HEAD/algorithms/prism)（Rust，**MIT**，v0.25）

---

## 2. 本项目怎么接的

**没有改 Prism 的任何算法逻辑。** 做法是把它原样编成 wasm。

```
js/lib/estimator/prism/
├── prism.wasm        # 由上游 Rust 编出（276 KB）
├── index.js          # 加载 wasm + 对外的 prismDifficulty()
├── calibration.js    # Prism 分 → 段位表刻度 的换算
└── BENCHMARK.md      # 本文件
```

出口层是手写的纯 C-ABI（不依赖 wasm-bindgen，规避 crates.io 网络问题），
代码见 `prism-wasm/src/lib.rs`（附在 `_prism-upstream/` 或按第 6 节重建）。

### 数据流

```
.osu 文本
   ↓
Prism wasm ──→ Overall 分（百分制，实测 14.8 ~ 49.4）
   ↓
calibration.js ──→ 换算到段位表刻度（Sunny 星数口径，3.5 ~ 10.5）
   ↓
DAN_INDEX 查表（原封不动）
   ↓
段位名
```

**段位表一行没改。** 只换了「星数怎么算出来」这一步。

---

## 3. 为什么需要换算（重要）

段位表的区间是按 **Sunny 星数** 刻的：

```
7K RC 表：3.5085 ~ 10.544      （75 档）
7K LN 表：4.836  ~ 10.666
6K RC 表：3.430  ~ 9.246
```

而 Prism 输出 **14.8 ~ 49.4**（百分制）。直接丢进表里 → 每张图都是 `> Regular Stellium high`。

所以需要把 Prism 分换算到 Sunny 星数刻度。

**换算系数怎么来的**：拿一批 6K/7K 谱，同一张图同时算 Sunny 星数和 Prism 分，
得到 `(Prism分, Sunny星数)` 配对，再做最小二乘。见 `calibration.js`：

- 7K：`Sunny = 0.16383 × Prism + 2.7524`（9 张样本，SSE 1.12）

---

## 4. ⚠️ 已知局限（测试版，必须看）

### 4.1 标定样本严重不足

**只有 9 张 7K 样本 + 2 张 6K 样本，而 7K 段位表有 75 档。**

用 9 个点撑 75 档，精度必然不够。实测结果：

| | |
|---|---|
| 与 Sunny 段位不同的谱 | **9 / 11** |
| 最大偏差 | 3 档（`963008`：Regular 6 low → Regular 3 high） |

### 4.2 Prism 和 Sunny 排序并非完全一致

用 11 张谱做 Kendall tau 检验：

```
Kendall tau ≈ 0.745    （1.0 = 完全同序）
55 对配对中，7 对方向相反（87% 一致）
```

也就是说，有约 13% 的谱，**Prism 和 Sunny 对"哪张更难"的判断相反**。
这不是 bug —— 那正是 Prism 认为 Sunny 判错的地方。但它意味着：
**不存在一条完美的换算曲线**能让两边段位完全对上。

### 4.3 所以

Prism 目前定位是**可选算法 / 实验特性**。段位可能与 Sunny 相差 1~3 档。
如果你要稳定、和现有社区认知一致的段位，**用 `Sunny` / `Mixed`**。

---

## 5. 保真度验证（与官方公告对表）

公告里硬编码了 12 张标尺图。用它验证 wasm 移植的保真度：

| 指标 | 结果 |
|---|---|
| Overall 误差 ≤ 0.03 | **10 / 12** |
| 我的测试参数写错的 | 1（`2500143` 谱面本身已是 1.3x 版，rate 应传 1.0；传 1.0 时得 29.99 vs 官方 30.0 ✓） |
| 孤立偏差 | 1（`5074941` 的 LN：本 wasm 47.27，官方 47.8，差 0.53） |

**结论：wasm 移植是保真的，算法没算错。** 精度问题出在标定环节（第 4 节），不在移植。

`5074941` 的 LN 偏差来源未查明（OD 扫描无整数解命中，非 OD 问题）。

---

## 6. 如何重建 wasm

需要 Rust 工具链 + wasm32 目标：

```bash
rustup target add wasm32-unknown-unknown
# 上游源码放在本地后，加上 prism-wasm 出口 crate
cargo build --release --target wasm32-unknown-unknown -p prism-wasm
# 产物 → target/wasm32-unknown-unknown/release/prism_wasm.wasm
# 复制为 js/lib/estimator/prism/prism.wasm
```

上游零外部依赖（全部 path 依赖），编译不需要联网拉 crate。

---

## 7. 如何补样本 / 重新拟合（后续优化）

1. 批量拉 6K/7K 谱面（`https://osu.ppy.sh/osu/<beatmapId>`）
2. 逐张算 Sunny 星数（`calculate()`）和 Prism 分（`prism.analyze()`）
3. 拟合 → 更新 `calibration.js` 里的 `PRISM_TO_STAR`
4. 重跑验证：看与 Sunny 段位的偏差分布

样本量建议 ≥ 200 张，且覆盖 1 段 ~ Stellium 全区间。

**注意**：即使样本足够，4.2 节说明的排序分歧仍然存在 —— 那是两个算法的本质差异，不是标定能消除的。
真要做到「段位完全按 Prism 的口径」，需要用社区公认的段位谱做标定基准，而不是拿 Sunny 当基准。

---

## 8. 许可

Prism 上游是 **MIT**（见 `algorithms/prism/Cargo.toml` 的 `license.workspace = "MIT"`）。
本项目的 wasm 产物与出口层遵循同样的 MIT 条款。
