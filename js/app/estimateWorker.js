// 本地算法 worker：直接跑插件自带的 pipeline，不再 import ManiaMapAnalyser。
//
// 六个算法（Sunny / Daniel / Azusa / Roxy / Mixed / Companella）全部在 js/lib/estimator 里，
// Etterna（MSD）与 Interlude 也在本地，所以 Companella 能独立工作。
//
// 注意：Azusa / Roxy 源码里明确只支持 4K，6K/7K 选了它们会返回 Invalid，
// 由上层（modes + 设置项）保证不会给出这两个选项。
import { runAnalysisPipeline } from "../lib/pipeline/runAnalysisPipeline.js";
import { classifyCompanellaDifficulty } from "../lib/estimator/companellaEstimator.js";
import { applyCompanellaToMixedResult } from "../lib/estimator/mixedEstimator.js";
import { sliceOsuTextByTimeRange } from "../lib/parser/osuTimeSlice.js";

/** 跑一次完整管线（含 4K 的 Companella 二次估计），返回归一化字段。 */
async function runOne({ text, algorithm, options }) {
    const pipeline = await runAnalysisPipeline({
        rawText: text,
        estimatorAlgorithm: algorithm,
        options,
    });

    let estDiff = pipeline.rework?.estDiff || "";
    let numeric = pipeline.rework?.numericDifficulty ?? null;
    let companellaMerged = false;
    let usedAlgorithm = pipeline.actualEstimatorAlgorithm || algorithm;

    const columnCount = Number(pipeline.rework?.columnCount) || 0;
    const directCompanella = /^companella$/i.test(String(algorithm || ""));
    // Companella 只对 4K 有意义：它的 10 个输入是整图统计量，6K/7K 没有对应的 MSD 口径
    const needsCompanella = columnCount === 4
        && (directCompanella || Boolean(pipeline.rework?.mixedCompanellaPlan));

    if (needsCompanella) {
        try {
            const companella = await classifyCompanellaDifficulty({
                msdValues: pipeline.companellaEttResult?.values || pipeline.ettResult?.values,
                interludeStar: pipeline.interludeStar,
                sunnyStar: Number(pipeline.rework.star),
            });
            if (directCompanella) {
                estDiff = companella.estDiff;
                numeric = companella.numericDifficulty;
                usedAlgorithm = "Companella";
                companellaMerged = true;
            } else {
                const after = applyCompanellaToMixedResult({
                    estDiff,
                    numericDifficulty: numeric,
                    numericDifficultyHint: null,
                    mixedCompanellaPlan: pipeline.rework.mixedCompanellaPlan,
                }, companella);
                estDiff = after.estDiff;
                numeric = after.numericDifficulty;
                companellaMerged = true;
            }
        } catch (error) {
            // Companella 失败保留原值（与 MMA 行为一致）
        }
    }

    return {
        estDiff,
        numeric,
        algorithm: usedAlgorithm,
        companellaMerged,
        star: Number.isFinite(Number(pipeline.rework?.star)) ? Number(pipeline.rework.star) : null,
        sunnyWindowEstDiff: pipeline.sunnyWindow?.estDiff || "",
        columnCount,
        errors: pipeline.errors || [],
        ettError: pipeline.ettError || null,
    };
}

self.onmessage = async (event) => {
    const { id, text, algorithm, options, warmup, ranges } = event.data || {};

    if (warmup) {
        self.postMessage({ id, ok: true, warmup: true });
        return;
    }

    try {
        // ---- 分段模式（仅在 segmentEstimator="mixed" 时使用）----
        if (Array.isArray(ranges)) {
            const results = [];
            for (const range of ranges) {
                const from = Math.max(0, Number(range.from) || 0);
                const to = Math.max(from + 100, Number(range.to) || 0);
                const sliced = sliceOsuTextByTimeRange(text, from, to);
                if (!sliced || sliced.objectCount < 8) {
                    results.push({ from, to, skip: true, notes: sliced?.objectCount ?? 0 });
                    continue;
                }
                try {
                    const one = await runOne({ text: sliced.text, algorithm, options });
                    results.push({ from, to, notes: sliced.objectCount, ...one });
                } catch (error) {
                    results.push({ from, to, notes: sliced.objectCount, error: String(error?.message || error) });
                }
            }
            self.postMessage({ id, ok: true, ranges: true, results });
            return;
        }

        // ---- 整图模式 ----
        const one = await runOne({ text, algorithm, options });
        self.postMessage({ id, ok: true, ...one });
    } catch (error) {
        self.postMessage({ id, ok: false, error: String(error?.message || error) });
    }
};
