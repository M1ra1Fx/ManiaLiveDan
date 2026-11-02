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

`js/lib/estimator/prism/prism.wasm` is compiled from **Prism**, part of
**mania-hub** by aleju03 — https://github.com/aleju03/mania-hub/tree/HEAD/algorithms/prism
(MIT License, full text above; algorithm version 0.25).

The Rust source is compiled to WebAssembly **unmodified** — not a single line of the algorithm was
changed. The only addition is a dependency-free C-ABI shim
(`js/lib/estimator/prism/wasm-exit/`), which merely exposes the upstream `prism` crate's public
functions to JavaScript. That shim is also MIT, by MiraiFx.

Prism is used only when the user explicitly selects the `Prism` algorithm for 6K / 7K in the tosu
panel. The default algorithm is `Mixed` (Sunny scale), for which Prism is not loaded.

## Image assets

The dan badges under `assets/dan/{4k,6k,7k}/` (numbers, Greek letters, named tiers and their
low / mid-low / mid-high / high variants) come from **mania-tracker.com** and are used here only to
display dan; confirm the asset source and licensing yourself before redistributing.

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

**Prism 特别说明**：本插件把 Prism 的 Rust 源码（`algorithms/prism`，MIT，v0.25）**原样编译成
wasm，算法一行未改**，只加了一层 C-ABI 出口（源码见 `js/lib/estimator/prism/wasm-exit/`）。

**图片素材**：`assets/dan/{4k,6k,7k}/` 下的段位徽章来自 **mania-tracker.com**，本插件只用于显示
段位。再分发前请自行确认素材来源与授权。

