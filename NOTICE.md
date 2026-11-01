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

## Image assets

The dan badges under `assets/dan/{4k,6k,7k}/` (numbers, Greek letters, named tiers and their
low / mid-low / mid-high / high variants) come from **mania-tracker.com** and are used here only to
display dan; confirm the asset source and licensing yourself before redistributing.
