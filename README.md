# ManiaLiveDan

**English** | [中文](README.zh-CN.md)

**Real-time osu!mania dan overlay (tosu plugin)**

<p align="center">
  <a href="https://github.com/M1ra1Fx/ManiaLiveDan/releases/latest/download/ManiaLiveDan.by.MiraiFx.zip">
    <img alt="Download plugin" src="https://img.shields.io/badge/%E2%AC%87%20Download-Latest-2ea44f?style=for-the-badge&logo=github&logoColor=white">
  </a>
  <a href="https://github.com/M1ra1Fx/ManiaLiveDan/releases">
    <img alt="All releases" src="https://img.shields.io/badge/All%20Releases-Releases-6e7681?style=for-the-badge">
  </a>
  <img alt="License" src="https://img.shields.io/badge/License-MIT-3b82f6?style=for-the-badge">
</p>

Segments adapt to the current playback position: stretches where difficulty stays stable are
merged into long, held segments, while stretches that change keep shorter, denser segments.
The display only switches when you cross a segment boundary.

**Since 0.4.0 there are three independent dan systems for 4K / 6K / 7K**, and every algorithm is
bundled locally — ManiaMapAnalyser is no longer required.

## Preview

<p align="center">
  <img src="docs/preview-4k.png" width="620" alt="4K horizontal">
  <img src="docs/preview-7k.png" width="230" alt="7K vertical">
</p>

<p align="center">
  <img src="docs/preview-7k-top.png" width="300" alt="7K Stellium rainbow-white">
</p>

## Supported dan ladders

| Keys | RC | LN |
| --- | --- | --- |
| 4K | `Reform 1`–`Reform 10` → `α / β / γ / δ / ε / ζ / η / θ / ι / κ` | `LN 1`–`LN 17` |
| 6K | `Regular 0`–`Regular 9` → `Terra / Celestial / Mystery / Nihility / Finish` | same as RC |
| 7K | `Regular 0`–`Regular 10` → `Gamma / Azimuth / Zenith / Stellium` | same as RC |

- Every tier is split into 5 sub-tiers: `low / mid-low / mid / mid-high / high`
- 5K / 8K / 9K / 10K have no dan table and only show star rating
- 7K has no `Wild` table; anything above Stellium caps at `Stellium high`

> ⚠️ **The 6K `Terra…Finish` tiers are extrapolated**, not official thresholds. The upstream
> ManiaMapAnalyser 6K table stops at `Regular 9 high` (7.965 stars); the web ladder lists these
> five further tiers but the star ranges are not published. They are appended using upstream's own
> shrinking step pattern (Regular 8 spans 0.36, Regular 9 spans 0.33, then each tier narrows ×0.917),
> giving 7.965 → 9.246 stars in total. This is marked `extrapolated` in the code.

## Installation

> Use the **Download** button at the top of this page to grab the zip, then unpack it as below.

1. Put the whole `ManiaLiveDan.by.MiraiFx` folder into tosu's `static` directory
   (by default `C:\Tosu\static\` — do not nest it an extra level).
2. Restart tosu or refresh the dashboard → **ManiaLiveDan** appears in the Counters list.
3. Select it as your in-game overlay, or open it as an OBS browser source:
   `http://localhost:24050/ManiaLiveDan.by.MiraiFx/`

To install with git, **keep the folder name `ManiaLiveDan.by.MiraiFx`** (tosu uses it as the
counter name):

```bash
cd C:/Tosu/static
git clone https://github.com/<your-username>/ManiaLiveDan.git ManiaLiveDan.by.MiraiFx
```

After that, `git pull` updates the counter you are using directly.

## Language

The overlay interface defaults to **English**. To switch it, open the counter settings in the
tosu panel and change **Language / 语言** (`en` / `zh`). The change takes effect immediately —
no page refresh needed.

The default for fresh installs lives in `js/app/config.js` (`language: "en"`), and the panel
setting in `settings.json` overrides it.

## Whole-map algorithm (chosen in the panel)

The tosu panel's counter settings have three dropdowns, one per key mode:

| Keys | Available algorithms | Default |
| --- | --- | --- |
| 4K | `Mixed / Azusa / Roxy / Sunny / Daniel / Companella` | Mixed |
| 6K | `Mixed / Sunny / Daniel` | Mixed |
| 7K | `Mixed / Sunny / Daniel` | Mixed |

- **Azusa / Roxy only support 4K in their source**, so they are not offered for 6K/7K
- **Companella is only meaningful for 4K** (it consumes the 4K MSD scale)
- Changing a dropdown → **the current beatmap is re-estimated immediately**
- "Current segment" always uses Sunny: it is the only estimator with local information; feeding a
  5–20 second slice to Mixed degenerates into a monotonic function of window length

## Vibro segment detection

Vibro is a stretch where a single column's speed exceeds what human fingers can tap. Star rating
algorithms will inevitably rate it high as extreme JackSpeed (in RPG 7* that stretch comes out as
`LN17+ε`), but players who can vibro clear it comfortably — so that number misleads players.

This plugin **does not change the difficulty algorithm**; it only detects vibro independently at the
segmentation layer. Segments classified as vibro display `VIBRO` instead of a dan number.

Four criteria (all must hold):

1. Busiest single column ≥ **10 NPS** (the normal finger limit is around 9–10)
2. Median gap between consecutive notes in that column ≤ **100 ms**
3. That column's **single-note ratio ≥ 0.4** — at least 40% of its notes land alone, rather than
   all being wrapped inside chords
4. Consecutive ultra-short gaps lasting ≥ **1.0 s**

Criterion 3 exists specifically to reject "fast triple-stack chords": during triple stacks every
column can hit 20 NPS, and criteria 1 and 2 alone cannot tell the two apart. The thresholds were
loosened to 100 ms / 0.4 so that "anchor spam" also counts as vibro — one column firing
continuously at 97 ms with chords stacked on the other columns (the RPG Overdrive 158 s / 170 s
stretch). Triple-stack chords have a single-note ratio near 0 and are still rejected.

Detection looks for spam runs across the **entire beatmap** and then assigns them to segments by
time (a segment is marked VIBRO when ≥ 45% of it is covered), because vibro runs usually last only
1–1.5 seconds and per-segment detection would cut them at boundaries.

## Display

| Area | Meaning |
| --- | --- |
| Top-left | Connection/status, `4K`/`6K`/`7K`, mods, algorithm tag |
| **RC DAN** | RC dan badge for the current segment |
| **LN DAN** | LN dan badge for the same segment, side by side at the same size |
| Star badge | Sunny star rating for the current segment |
| `Whole map` | Dan for the entire beatmap (using the selected algorithm) |

- Badge art comes from mania-tracker, and **the sub-tier swaps the image directly**
  (`-low / -mid-low / -mid-high / -high`). The `-- / - / + / ++` marks and the
  `Reform` / `Regular` prefix are no longer drawn by default
- The panel offers **Show Tier Mark**: adds a `-- / - / + / ++` superscript at the badge's
  top-right corner (off by default)
- **No LN dan anywhere in the beatmap** (zero hold notes, or below the LN table floor) → the LN
  block is **hidden entirely**, and no dash is drawn in song select either
- When LN dan exists: **during play** it hides if the current segment has no LN;
  **in song select / idle** it is always shown
- Tall windows (aspect ratio ≤ 4:5) automatically stack the RC and LN blocks vertically

## Neon glow

- **RC tiers 1–10**: white palette, brighter the higher you go
- **RC above tier 10 (named tiers)**: each uses its own hand-tuned palette
  (`js/app/modes/palettes.js`). The web badges are monochrome silver, so sampling their colors
  yields no differentiation — a graded palette was tuned by hand instead
- **LN 1–10**: white (the earlier pale-aqua was removed in 0.4.0)
- **6K / 7K are one step brighter than 4K overall**: difficulty coefficient ×1.5, spin speed +50%
- **Breathing**: 4K starts at `rank ≥ 14` (Delta); **6K/7K start at 7dan**, with the dark end
  pinned to that mode's own 7dan brightness
- Arc length: `RC rank × 2 : LN rank`, with LN capped at 1/3

## Tunable parameters

In `js/app/config.js`:

- `language`: interface language when the panel has no setting (default `"en"`)
- `defaultAlgorithm`: algorithm used when the panel has no setting (default `Mixed`)
- `estimatorTimeoutMs`: per whole-map analysis timeout (default 60 s)
- `showLnMinStar`: 4K's LN display floor (default 4.84; 6K/7K use their own table floors)
- `segmentationEnabled` / `segmentCurveWindowMs` / `segmentMinMs`: adaptive segmentation
- `extendedRange`: use 4K's extended dan table (default `false`)
- `glowBaseSpeed` / `glowRcShareWeight`: glow linear speed and arc-length weights

## Implementation notes

- Beatmap source: tosu `/websocket/v2` + `/files/beatmap/file`
- Three modules: `js/app/modes/mode4k.js` / `mode6k.js` / `mode7k.js`, each carrying its own dan
  table, badge paths, LN floor and glow parameters; changing 6K never touches 4K
- Algorithms: `js/lib/estimator/` (Sunny / Daniel / Azusa / Roxy / Mixed / Companella),
  Etterna (MSD) in `js/lib/ett/`, ONNX runtime in `js/lib/estimator/companella/`
- Length scale: the slice's own length factor is replaced with the whole-map length factor, so
  segment dan and whole-map dan are measured with the same ruler

## Known limitations

- The 6K `Terra…Finish` tiers are extrapolated values
- The plugin is roughly 15 MB (it bundles the ONNX runtime); the first load takes a few seconds to warm up
- If an upstream algorithm is ported and later updated, the copy must be synced manually
- 5K / 8K / 9K / 10K have no dan table

## Credits / License

- Algorithms and dan interval tables: **ManiaMapAnalyser** by Leo_Black — MIT
  https://github.com/LeoBlackMT/osumania_map_analyser
- Original algorithm: **Sunny Rework** (Star-Rating-Rebirth) by sunnyxxy
  https://github.com/sunnyxxy/Star-Rating-Rebirth
- Dan badge art: **mania-tracker.com**
- Runtime environment: **tosu** — https://tosu.app

This plugin's own code is released under MIT; see `NOTICE.md` for details.

## Development

There is no build step — everything is plain ES modules, so just edit and refresh the page.

```
js/app/          application layer (mode dispatch, segmentation, UI, vibro detection)
js/lib/          ported algorithms (estimator / ett / interlude / patterns / pipeline)
assets/dan/      dan badges, three sets: 4k / 6k / 7k
styles.css       card and glow styling
```

For debugging you can open the counter page directly in a browser; `window.__MLD` in the console
holds the current analysis result and a settings snapshot.

## License

This project is released under [MIT](LICENSE). The bundled third-party algorithms and image assets
carry their own licenses; see [NOTICE.md](NOTICE.md).
