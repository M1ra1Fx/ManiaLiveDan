# Prism algorithm (6K / 7K / 8K) · Beta

**English** · [中文 ↓](#中文)

ManiaLiveDan can hand the whole-map difficulty of **6K / 7K** to
[Prism](https://mania-tracker.com/news/prism). In the tosu panel, set
**6K Algorithm** / **7K Algorithm** to `Prism`. The default is `Mixed` (Sunny scale), so
**leaving the setting alone behaves exactly as before**.

---

## 1. What Prism is

A difficulty calculator written by aleju03 (the author of `mania-tracker.com`) for 6K / 7K / 8K, to
replace MinaCalc on those keymodes.

MinaCalc was written for 4K, and on 7K it gets three things wrong:

| Problem | Example (official announcement data) |
|---|---|
| Reads jumptrills as fast streams | `[7K] Jumptrill ~>`: MinaCalc 43.5 → Prism **18.0** |
| Rate-shifted charts explode | Same chart at 1.3x: 56.1 → **30.0** |
| No idea what LN is | `[7K] Challenge`: 4.9 → **18.5** |

**Source**: [aleju03/mania-hub `algorithms/prism`](https://github.com/aleju03/mania-hub/tree/HEAD/algorithms/prism)
(Rust, **MIT**, v0.25).

> ⚠️ These numbers are quoted **from the upstream announcement**. This plugin does not claim that
> Prism is more accurate than Sunny — only that it measures a different thing.

---

## 2. How a Prism score is actually computed

Before looking at the conversion you have to know what the score even measures.

```
each note row
   ↓ weighted by "how much it tires your fingers"
units (workload)    jack 2.857 / bracket 0.5 / chord 0.0097 / speed is an exponent of 0.098
   ↓
demand per 500 ms section  = max(left hand, right hand) + 0.2083 × min(left, right)
   ↓ bottleneck hand only
strain = binary-searched so that, at a 96.5% score goal, (demand/strain)^4.114 sums to the goal
   ↓ 4th power → hard sections dominate
final score = log-interpolated through the SCALE table (2.1 ~ 40.6)
```

**Key insight: Prism measures *finger workload*, not note density and not speed.** That is the root
of its disagreement with Sunny.

---

## 3. Converting to a dan (the core part)

### 3.1 Why it converts directly: an exact `rating → strain` inverse

Upstream `prism_rating_of_strain()` (`crates/prism/src/lib.rs`) performs a
**log-domain linear interpolation** through the SCALE table, so it is strictly monotonic:

```
log(rating) = log(y0) + k · (log(strain) − log(x0))
```

Inverting:

```
strain = exp( log(x0) + (log(rating) − log(y0)) / k )
```

**This is an exact inverse, not a fit.** Verified with a round trip
`strain → rating → strain` to a 1e-15 error (machine precision).

### 3.2 strain already sits on the dan-table scale

Across 11 official benchmark charts, the ratio `strain / Sunny star rating` has a **mean of exactly
1.00** (range 0.73–1.55).

A mean of 1.00 means **strain is a star-rating-scale quantity**, so it can be fed straight into the
existing dan tables.

The ratio swings from 0.73 to 1.55 — that is the two algorithms' disagreement itself (Prism rates
jumptrill charts easier and LN-heavy charts harder), not noise.

**So this conversion path has zero free parameters**: no fitting, no calibration samples, no tuned
coefficients.

### 3.3 RC and LN must take separate paths

Prism's `Overall` uses the **press model** and barely perceives holds. Measured:

| Chart | Overall | LN score | hold ratio |
|---|---|---|---|
| Avril 14th | 18.5 | **27.1** | 100% |
| Sea of Stars | 49.4 | 47.3 | 37% |
| Exterminate | 38.3 | 36.9 | 99% |

LN-heavy charts score clearly lower on `Overall` than on the LN number, and the announcement lists
LN as its own column. So:

| Item | Data source | Conversion |
|---|---|---|
| **RC dan** | Overall score, `SCALE_7K` / `SCALE_6K` | exact `rating → strain` inverse (no parameters) |
| **LN dan** | LN score, `LN_SCALE_7K` / `LN_SCALE_6K` | linear regression (see below) |

### 3.4 Why LN cannot use the same inverse

`LN_SCALE_7K` starts at strain **2.079** (press starts at 0.9903); the LN model's internal
distribution is a different scale.

On 5 hold-heavy charts, the directly inverted strain divided by the Sunny LN star rating had a
**mean of 1.633 and a spread of 1.74x** — systematically high and unstable, so no single coefficient
fixes it.

LN therefore uses a direct regression on 5 samples:

```
SunnyLN star = 0.22349 × PrismLN score + 0.3295
samples: 2617975 (99%) 2672368 (97%) 963008 (100%) 1527715 (40%) 5074941 (37%)
max residual 1.07 stars, 4 of 5 below 0.5
```

### 3.5 The LN gate

Only genuine LN charts get an LN dan. The threshold is the upstream one:

> A chart gets an LN number when at least **37.5%** of its notes are holds on 7K
> (**45%** on 6K and 8K)

Below the threshold `lnStar = 0` and the upper layer treats the chart as having no LN dan — the same
behaviour as Sunny.

> Tolerance of 0.002: the official 37.5% is a rounded figure. Sea of Stars is
> 3540/9448 = 0.37468 and must count as an LN chart.

---

## 4. Measured results

The 11 official benchmark charts, Prism vs Sunny:

| Chart | Keys | Prism RC dan | Sunny RC dan | Prism LN dan | Sunny LN dan |
|---|---|---|---|---|---|
| 2617975 Exterminate | 7 | > Stellium high | Azimuth low | LN Gamma mid/low | LN Azimuth mid/low |
| 2672368 Stellar | 7 | Regular 10 low | Regular 8 mid/low | LN 7 high | LN 8 mid/high |
| 963008 Avril 14th | 7 | Regular 1 mid/high | Regular 6 low | LN 6 low | LN 6 mid/low |
| 2500146 Jumptrill | 7 | Regular 1 mid | Regular 2 high | < LN 3 low | – |
| 5247287 CNM | 7 | Regular 6 low | Regular 6 low | < LN 3 low | – |
| 1344338 3/4 time | 7 | Regular 0 mid | Regular 2 high | < LN 3 low | – |
| 5093305 JT | 7 | Regular 2 mid/low | Regular 5 low | < LN 3 low | < LN 3 low |
| 1527715 Cinnamon | 6 | Regular 8 mid/high | Regular 6 mid/high | < LN 0 low | LN 6 mid/high |
| 1538156 ABS STREAM | 6 | Regular 2 low | Regular 5 mid | < LN 0 low | LN 1 mid/low |
| 5863316 Lemon Tree | 7 | Regular 3 mid/low | Regular 4 high | < LN 3 low | < LN 3 low |
| 5074941 Sea of Stars | 7 | > Stellium high | > Stellium high | > LN Stellium high | > LN Stellium high |

**Prism's characteristic corrections show up on RC**: jumptrill / 3-4 time / pure-JT charts drop
several tiers (`1344338` 2 high → 0 mid), dense charts rise (`2672368` 8 → 10), and ordinary
mid-range charts agree with Sunny (`5247287` is identical).

---

## 5. Known limitations

### 5.1 Sample size

- **RC**: the conversion itself has no parameters, but the comparability of strain with Sunny stars
  was only verified on 11 charts.
- **LN**: the regression has only 5 samples; `1527715` residual is 1.07 stars (about 2 tiers).
- **6K**: only 2 samples; the LN regression reuses the 7K coefficients.

### 5.2 The LN gate misses some charts

`1527715` (6K, 40% holds) does not qualify as an LN chart under the official 45% threshold, yet
Sunny gives it `LN 6 mid/high`. That is the result of following the official definition strictly —
relax it via `PRISM_LN_HOLD_RATIO_FLOOR` if you prefer.

### 5.3 High tiers exceed the table

strain can exceed the dan table's ceiling (the 7K table tops out at 10.544), showing as
`> Regular Stellium high`. That is a limitation of the table, not an error in the algorithm.

### 5.4 Positioning

Prism remains an **optional / experimental** feature and carries **no accuracy guarantee**.
mania-tracker's own Terms of Service state that its dan estimates "may be delayed, incomplete,
unavailable, or incorrect". Use `Sunny` / `Mixed` if you want stable, community-consistent dan.

---

## 6. Fidelity check against the official announcement

Validated against the 12 benchmark charts hard-coded in the announcement:

| Metric | Result |
|---|---|
| Overall error ≤ 0.03 | **10 / 12** |
| Test-parameter mistake | 1 (`2500143` is itself a 1.3x upload; at rate 1.0 it yields 29.99 vs official 30.0 ✓) |
| Isolated deviation | 1 (`5074941` LN: this wasm 47.27 vs official 47.8) |

**The wasm port is faithful; the algorithm is not miscomputed.** Accuracy concerns live in the
conversion layer, not the port.

---

## 7. Rebuilding the wasm

Requires a Rust toolchain plus the wasm32 target:

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown -p prism-wasm
# artifact → target/wasm32-unknown-unknown/release/prism_wasm.wasm
# copy to js/lib/estimator/prism/prism.wasm
```

The exit shim source is in `wasm-exit/`. Upstream has zero external dependencies (all path deps), so
the build needs no network.

---

## 8. Possible future work

1. **More LN samples**: currently only 5, clustered at the high end. Refit once 6K/8K samples exist.
2. **Further verify strain comparability**: confirm "strain ≈ star rating" holds on 6K / 8K too.
3. **RC strain ceiling**: if Prism's high-end strain genuinely exceeds the table, consider extending
   the dan table instead of showing `> Stellium high`.

---

## 9. License

Prism upstream is **MIT** (`algorithms/prism/Cargo.toml`, `license.workspace = "MIT"`,
Copyright (c) 2026 aleju03). This project ships only the compiled `prism.wasm`; the upstream Rust
crates are not redistributed. See `NOTICE.md` for the full notice.

---

<a id="中文"></a>

# 中文

ManiaLiveDan 支持把 **6K / 7K** 的整图难度交给 [Prism](https://mania-tracker.com/news/prism) 计算。
在 tosu 设置面板里，把「6K Algorithm」「7K Algorithm」改成 `Prism` 即可。
默认是 `Mixed`（Sunny 口径），**不改设置就完全等同旧行为**。

---

## 1. Prism 是什么

`mania-tracker.com` 作者（aleju03）为 6K / 7K / 8K 编的难度计算器，用来取代 MinaCalc。

MinaCalc 是为 4K 写的，套到 7K 上有三类典型偏差：

| 问题 | 例子（官方公告数据） |
|---|---|
| 把轮指（jumptrill）当高速流 | `[7K] Jumptrill ~>`：MinaCalc 43.5 → Prism **18.0** |
| 变速图爆涨 | 同一张 1.3x：56.1 → **30.0** |
| 没有 LN 维度 | `[7K] Challenge`：4.9 → **18.5** |

**源码**：[aleju03/mania-hub `algorithms/prism`](https://github.com/aleju03/mania-hub/tree/HEAD/algorithms/prism)（Rust，**MIT**，v0.25）

> ⚠️ 这些数字是**引用上游公告**的。本插件**不声称** Prism 比 Sunny 更准，只说它衡量的是另一个东西。

---

## 2. Prism 分是怎么算出来的

理解换算之前，必须先知道 Prism 分量的是什么。

```
每一行音符
   ↓ 按「费手程度」加权
units（工作量）    jack 2.857 / bracket 0.5 / chord 0.0097 / speed 是指数 0.098
   ↓
每 500ms 一段的 demand ＝ max(左手, 右手) + 0.2083 × min(左手, 右手)
   ↓ 只看瓶颈手
strain ＝ 在 96.5% 成绩目标下二分求解，(demand/strain)^4.114 加权
   ↓ 4 次方 → 难段权重极大
最终分 ＝ 查 SCALE 表做对数插值（2.1 ~ 40.6）
```

**关键：Prism 量的是「手指负担」，不是「音符密度」，也不是「速度」。** 这就是它和 Sunny 根本分歧的来源。

---

## 3. 换算成段位（核心）

### 3.1 为什么能直接换算：rating → strain 精确反解

上游 `prism_rating_of_strain()`（`crates/prism/src/lib.rs`）在 SCALE 表上做的是**对数域线性插值**，
因此严格单调：

```
log(rating) = log(y0) + k · (log(strain) − log(x0))
```

反解：

```
strain = exp( log(x0) + (log(rating) − log(y0)) / k )
```

**这是精确逆运算，不是拟合。** 验证：strain → rating → strain 往返误差 1e-15（机器精度）。

### 3.2 strain 和段位表同一刻度

实测 11 张官方标尺图，`strain / Sunny 星数` 的**比值均值为 1.00**（范围 0.73~1.55）。

均值恰好 1.00 说明：**strain 就是星级尺度**，可以直接喂现有段位表。

比值会从 0.73 波动到 1.55 —— 那正是两个算法的分歧本身（Prism 认为轮指图更简单、重 LN 图更难），
不是噪声。

**所以这条换算路径上零自由参数**：不拟合、不用标定样本、不调系数。

### 3.3 RC 和 LN 必须分开

Prism 的 `Overall` 走 **press 模型**，几乎不感知长条。实测：

| 图 | Overall | LN 分 | 长条占比 |
|---|---|---|---|
| Avril 14th | 18.5 | **27.1** | 100% |
| Sea of Stars | 49.4 | 47.3 | 37% |
| Exterminate | 38.3 | 36.9 | 99% |

纯 LN 图的 Overall 明显低于 LN 分，公告也把 LN 单列一栏。所以：

| 项目 | 数据源 | 换算方式 |
|---|---|---|
| **RC 段位** | Overall 分，`SCALE_7K` / `SCALE_6K` | rating → strain 精确反解（无参数） |
| **LN 段位** | LN 分，`LN_SCALE_7K` / `LN_SCALE_6K` | 线性回归（见下） |

### 3.4 LN 为什么不能同样反解

`LN_SCALE_7K` 的 strain 起点是 **2.079**（press 是 0.9903），LN 模型的内部分布不在同一刻度。

实测 5 张重 LN 图，直接反解出的 strain 与 Sunny LN 星数比值：**均值 1.633，跨度 1.74x** ——
系统性偏高且不稳定，乘系数修不掉。

所以 LN 用 5 张样本直接回归：

```
SunnyLN星 = 0.22349 × PrismLN分 + 0.3295
样本：2617975(99%) 2672368(97%) 963008(100%) 1527715(40%) 5074941(37%)
最大残差 1.07 星，其中 4 张 < 0.5 星
```

### 3.5 LN 门槛

只有真正的 LN 图才有 LN 段位。门槛按官方定义：

> A chart gets an LN number when at least **37.5%** of its notes are holds on 7K
> (**45%** on 6K and 8K)

低于门槛时 `lnStar = 0`，上层按「没有 LN 段位」处理 —— 与 Sunny 的行为一致。

> 边界容差 0.002：官方 37.5% 是四舍五入值，实测 Sea of Stars 是 3540/9448 = 0.37468，
> 必须算作 LN 图。

---

## 4. 实测效果

11 张官方标尺图，Prism vs Sunny：

| 谱面 | 键 | Prism RC 段位 | Sunny RC 段位 | Prism LN 段位 | Sunny LN 段位 |
|---|---|---|---|---|---|
| 2617975 Exterminate | 7 | > Stellium high | Azimuth low | LN Gamma mid/low | LN Azimuth mid/low |
| 2672368 Stellar | 7 | Regular 10 low | Regular 8 mid/low | LN 7 high | LN 8 mid/high |
| 963008 Avril 14th | 7 | Regular 1 mid/high | Regular 6 low | LN 6 low | LN 6 mid/low |
| 2500146 Jumptrill | 7 | Regular 1 mid | Regular 2 high | < LN 3 low | – |
| 5247287 CNM | 7 | Regular 6 low | Regular 6 low | < LN 3 low | – |
| 1344338 3/4 拍 | 7 | Regular 0 mid | Regular 2 high | < LN 3 low | – |
| 5093305 JT | 7 | Regular 2 mid/low | Regular 5 low | < LN 3 low | < LN 3 low |
| 1527715 Cinnamon | 6 | Regular 8 mid/high | Regular 6 mid/high | < LN 0 low | LN 6 mid/high |
| 1538156 ABS STREAM | 6 | Regular 2 low | Regular 5 mid | < LN 0 low | LN 1 mid/low |
| 5863316 Lemon Tree | 7 | Regular 3 mid/low | Regular 4 high | < LN 3 low | < LN 3 low |
| 5074941 Sea of Stars | 7 | > Stellium high | > Stellium high | > LN Stellium high | > LN Stellium high |

**RC 上能看到 Prism 的特征判断**：轮指 / 3-4 拍 / 纯 JT 图大幅降段（`1344338` 2 high → 0 mid），
密集图提段（`2672368` 8 → 10），中间段位的普通图与 Sunny 一致（`5247287` 完全一致）。

---

## 5. 已知局限

### 5.1 样本规模

- **RC**：换算本身无参数，但 strain 与 Sunny 星数的可比性只验证了 11 张图。
- **LN**：回归仅 5 张样本，`1527715` 残差 1.07 星（约 2 档）。
- **6K**：只有 2 张样本，LN 回归沿用 7K 系数。

### 5.2 LN 门槛会漏掉一些图

`1527715`（6K，40% 长条）按官方 45% 门槛不算 LN 图，但 Sunny 给了 `LN 6 mid/high`。
这是严格照官方定义的结果 —— 想放宽就改 `PRISM_LN_HOLD_RATIO_FLOOR`。

### 5.3 高段超出表范围

strain 可以超过段位表上界（7K 表上限 10.544），表现为 `> Regular Stellium high`。
这是表的问题，不是算法的错。

### 5.4 定位

Prism 仍是**可选 / 实验特性**，**不提供任何准确性保证**。mania-tracker 自己的服务条款写明，
它的段位估计「may be delayed, incomplete, unavailable, or incorrect」。要稳定、与社区认知
一致的段位，用 `Sunny` / `Mixed`。

---

## 6. 保真度验证（与官方公告对表）

用公告硬编码的 12 张标尺图验证 wasm 移植：

| 指标 | 结果 |
|---|---|
| Overall 误差 ≤ 0.03 | **10 / 12** |
| 测试参数写错 | 1（`2500143` 谱面本身已是 1.3x 版；rate 传 1.0 时得 29.99 vs 官方 30.0 ✓） |
| 孤立偏差 | 1（`5074941` 的 LN：本 wasm 47.27，官方 47.8） |

**结论：wasm 移植保真，算法没算错。** 精度问题只在换算层，不在移植层。

---

## 7. 如何重建 wasm

需要 Rust 工具链 + wasm32 目标：

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown -p prism-wasm
# 产物 → target/wasm32-unknown-unknown/release/prism_wasm.wasm
# 复制为 js/lib/estimator/prism/prism.wasm
```

出口层源码见 `wasm-exit/`。上游零外部依赖（全 path 依赖），编译不联网。

---

## 8. 后续可改进

1. **补 LN 样本**：现在只有 5 张，且集中在高段。补 6K/8K 样本后可重拟合回归系数。
2. **继续验证 strain 可比性**：确认「strain ≈ 星级」在 6K / 8K 上也成立。
3. **RC 的 strain 上界**：如果 Prism 高段 strain 确实超表，考虑扩展段位表，
   而不是显示 `> Stellium high`。

---

## 9. 许可

Prism 上游是 **MIT**（`algorithms/prism/Cargo.toml`，`license.workspace = "MIT"`，
版权 (c) 2026 aleju03）。本项目只分发编译产物 `prism.wasm`，不再分发上游 Rust crate。
完整声明见 `NOTICE.md`。
