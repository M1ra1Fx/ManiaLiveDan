# NOTICE / 第三方代码与许可

本插件 `ManiaLiveDan`（作者 MiraiFx）以 **MIT License** 发布：

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

## 内置的第三方算法代码

以下文件复制自 **ManiaMapAnalyser**（https://github.com/LeoBlackMT/osumania_map_analyser），
Copyright (c) 2026 Leo_Black，MIT License（全文同上）：

- `js/lib/rework/sunnyAlgorithm.js`
- `js/lib/rework/sunnyWindowAlgorithm.js`
- `js/lib/rework/reworkMathCore.js`
- `js/lib/parser/osuFileParser.js`
- `js/lib/parser/noteColumn.js`
- `js/lib/parser/osuTimeSlice.js`
- `js/lib/estimator/reworkEstimatorUtils.js`
- `js/lib/estimator/intervals/*.js`

其中 Sunny Rework 算法原始出处：
**Star-Rating-Rebirth** by sunnyxxy — https://github.com/sunnyxxy/Star-Rating-Rebirth

### 相对上游的修改（仅两处，均为向后兼容）

1. `sunnyAlgorithm.js` 的 `calculate()`：
   - 新增 `options.lengthFactorOverride`：>0 时替换 `totalNotes/(totalNotes+60)` 长度惩罚；
   - 新增 `options.withMeta === true` 时返回 `{ star, lnRatio, columnCount, totalNotes }`。
2. `sunnyWindowAlgorithm.js` 的 `calculateLN()`：
   - 同样支持 `lengthFactorOverride`；返回对象新增 `totalNotes`。

默认调用路径（不传新 options）的输出与上游实现逐位一致（Node 侧对拍 diff = 0）。

## 内置的第三方算法代码（0.4.0 新增，均为 MIT）

0.4.0 起不再在运行时 import ManiaMapAnalyser，而是把它的算法整包搬进
`js/lib/`，因此下面这些文件**随本插件分发**，版权归原作者 Leo_Black：

- `js/lib/estimator/`：`sunnyEstimator.js`、`sunnyWindowEstimator.js`、
  `danielEstimator.js`、`azusaEstimator.js`、`roxyEstimator.js`、
  `roxyMetaModel.generated.js`、`mixedEstimator.js`、`companellaEstimator.js`、
  `rcDifficultyFormat.js`、`reworkEstimatorUtils.js`、`intervals/*.js`
- `js/lib/rework/danielAlgorithm.js`
- `js/lib/ett/`（Etterna MinaCalc，用于 MSD 与 vibro 相关技能值）
- `js/lib/interlude/`
- `js/lib/patterns/`
- `js/lib/pipeline/runAnalysisPipeline.js`
- `js/lib/estimator/companella/`（`dan_model.onnx` + ONNX Runtime Web，约 13 MB）

## 图片素材

`assets/dan/{4k,6k,7k}/` 下的段位徽章（数字、希腊字母、具名档及各自的
low / mid-low / mid-high / high 变体）取自 **mania-tracker.com**，
仅用于本插件的段位展示；如需再分发请自行确认素材来源与授权。
