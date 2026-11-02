# NOTICE / Third-party code and licenses

This plugin, `ManiaLiveDan` (by MiraiFx), is released under the **MIT License**:

```
MIT License

Copyright (c) 2026 MiraiFx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled third-party algorithm code

The following files are copied from **ManiaMapAnalyser**
(https://github.com/LeoBlackMT/osumania_map_analyser),
Copyright (c) 2026 Leo_Black, MIT License (full text above):

- `js/lib/rework/sunnyAlgorithm.js`
- `js/lib/rework/sunnyWindowAlgorithm.js`
- `js/lib/rework/reworkMathCore.js`
- `js/lib/parser/osuFileParser.js`
- `js/lib/parser/noteColumn.js`
- `js/lib/parser/osuTimeSlice.js`
- `js/lib/estimator/reworkEstimatorUtils.js`
- `js/lib/estimator/intervals/*.js`

The Sunny Rework algorithm originates from:
**Star-Rating-Rebirth** by sunnyxxy — https://github.com/sunnyxxy/Star-Rating-Rebirth

### Modifications relative to upstream (two only, both backward compatible)

1. `calculate()` in `sunnyAlgorithm.js`:
   - adds `options.lengthFactorOverride`: when > 0 it replaces the
     `totalNotes/(totalNotes+60)` length penalty;
   - adds `options.withMeta === true`, which returns `{ star, lnRatio, columnCount, totalNotes }`.
2. `calculateLN()` in `sunnyWindowAlgorithm.js`:
   - likewise supports `lengthFactorOverride`; the returned object gains `totalNotes`.

On the default call path (without the new options) the output is bit-identical to upstream
(Node-side comparison diff = 0).

## Bundled third-party algorithm code (added in 0.4.0, all MIT)

Starting with 0.4.0 the plugin no longer imports ManiaMapAnalyser at runtime; its algorithms are
copied wholesale into `js/lib/`, so the following files **ship with this plugin** and remain
copyrighted by their original author, Leo_Black:

- `js/lib/estimator/`: `sunnyEstimator.js`, `sunnyWindowEstimator.js`,
  `danielEstimator.js`, `azusaEstimator.js`, `roxyEstimator.js`,
  `roxyMetaModel.generated.js`, `mixedEstimator.js`, `companellaEstimator.js`,
  `rcDifficultyFormat.js`, `reworkEstimatorUtils.js`, `intervals/*.js`
- `js/lib/rework/danielAlgorithm.js`
- `js/lib/ett/` (Etterna MinaCalc, used for MSD and the skill values behind vibro detection)
- `js/lib/interlude/`
- `js/lib/patterns/`
- `js/lib/pipeline/runAnalysisPipeline.js`
- `js/lib/estimator/companella/` (`dan_model.onnx` + ONNX Runtime Web, roughly 13 MB)

## Bundled third-party algorithm code: Prism (added in 0.5.0, MIT)

**Prism** — https://github.com/aleju03/mania-hub/tree/HEAD/algorithms/prism
Part of **mania-hub**, Copyright (c) 2026 **aleju03**, MIT License.

Per the MIT terms ("The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software"), the full upstream notice is reproduced here:

```
MIT License

Copyright (c) 2026 aleju03

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### What we ship, and what we do not

- We ship **`prism.wasm`**, a WebAssembly build compiled in this repository from the upstream Rust
  source at algorithm version **0.25**. The algorithm itself is **unmodified** — not a single line
  of scoring logic was changed.
- We **do not** republish, vendor, or distribute the upstream Rust crates themselves, and we do not
  publish anything to crates.io. The upstream workspace declares `publish = false`; we respect that
  by keeping the Rust sources out of this distribution and shipping only the compiled artifact.
- The only code we added is a dependency-free C-ABI shim (`js/lib/estimator/prism/wasm-exit/`),
  which merely exposes the upstream `prism` crate's public functions to JavaScript. That shim is
  MIT, by MiraiFx.

### No affiliation, and no accuracy claim

This plugin is **not affiliated with, endorsed by, sponsored by, or approved by** mania-tracker,
mania-hub, aleju03, ppy Pty Ltd, or the osu! team.

Prism is an experimental community algorithm. mania-tracker's own Terms of Service state that its
generated surfaces, **dan estimates included, "may be delayed, incomplete, unavailable, or
incorrect"**. The dan this plugin derives from Prism carries that same caveat, applies no accuracy
guarantee, and is **not** presented as more correct than the Sunny-based dan. See
`js/lib/estimator/prism/BENCHMARK.md` for the measured limitations.

Prism is used only when the user explicitly selects the `Prism` algorithm for 6K / 7K in the tosu
panel. The default algorithm is `Mixed` (Sunny scale), for which Prism is not loaded at all.

### No network access to their servers

This plugin makes **no runtime requests** to mania-tracker or mania-hub. All scoring is local, in
the bundled wasm. mania-tracker's ToS asks users not to overload its public endpoints; this plugin
never contacts them.

## Image assets

The dan badges under `assets/dan/{4k,6k,7k}/` (numbers, Greek letters, named tiers and their
low / mid-low / mid-high / high variants) were supplied by the project author. They are used here
only to display dan. Verify the asset licensing yourself before redistributing them.

---

## 第三方代码与许可（中文摘要）

> 本节只是上面英文部分的**中文摘要**，供中文使用者快速了解。
> **以英文原文为准** —— 许可证正文不翻译。

本插件 `ManiaLiveDan`（作者 MiraiFx）以 **MIT** 发布，完整条款见上方英文部分。

**内置的第三方算法代码**（均为 MIT，版权归原作者）：

| 来源 | 用到的文件 | 作者 |
| --- | --- | --- |
| **ManiaMapAnalyser** | `js/lib/estimator/`、`js/lib/rework/`、`js/lib/parser/` 等 | Leo_Black |
| **Star-Rating-Rebirth**（Sunny Rework 原始算法） | 由 ManiaMapAnalyser 内置 | sunnyxxy |
| **Etterna**（MinaCalc，用于 MSD 与 vibro 判定） | `js/lib/ett/` | Etterna 团队 |
| **Prism**（0.5.0 起，6K/7K 可选算法） | `js/lib/estimator/prism/prism.wasm` | aleju03 |
| **ONNX Runtime Web** | `js/lib/estimator/companella/ort/` | Microsoft |

**对上游的改动**：只有 `calculate()` 与 `calculateLN()` 各加了两个可选参数
（`lengthFactorOverride`、`withMeta`）。**不传这些参数时，输出与上游逐位一致。**

**Prism 特别说明**：

- Prism 的 Rust 源码（`algorithms/prism`，**MIT**，版权 (c) 2026 **aleju03**，算法版本 v0.25）
  被**原样编译成 wasm，算法一行未改**。完整 MIT 原文见上方英文部分。
- 我们**只分发编译产物 `prism.wasm`**，不分发、也不再发布上游的 Rust crate，
  不上传 crates.io。上游 `Cargo.toml` 声明了 `publish = false`，我们遵守这一点。
- 我们额外加的只有一层 C-ABI 出口（`js/lib/estimator/prism/wasm-exit/`），它只把上游
  `prism` crate 的公开函数暴露给 JS，本身也是 MIT。
- **无隶属关系**：本插件与 mania-tracker / mania-hub / aleju03 / ppy Pty Ltd / osu! 官方
  **没有任何隶属、授权、赞助或认可关系**。
- **不声称更准确**：mania-tracker 自己的服务条款写明，它生成的界面（**包括段位估计**）
  「may be delayed, incomplete, unavailable, or **incorrect**」。本插件从 Prism 得出的段位
  同样带着这个前提，**不提供任何准确性保证**，也**不声称比 Sunny 口径更准**。
- **不访问他们的服务器**：本插件运行时**不会请求** mania-tracker 或 mania-hub 的任何接口，
  所有计算都在本地 wasm 里完成。他们的服务条款要求不要给公共接口造成负载，本插件从不接触。

**图片素材**：`assets/dan/{4k,6k,7k}/` 下的段位徽章由项目作者提供，本插件只用于显示段位。
再分发前请自行确认素材授权。

