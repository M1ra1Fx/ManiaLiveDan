# Prism wasm exit shim

**English** · [中文 ↓](#中文)

This directory holds a single extra crate that lives inside the Prism Rust source tree. Its only job
is to expose the upstream `prism` crate's API as plain C-ABI functions so WebAssembly can call them.

**It changes none of Prism's algorithm logic.**

## Why not wasm-bindgen

wasm-bindgen pulls a dependency tree from crates.io, which can stall on restricted networks.
Prism upstream has zero external dependencies (all path deps), so a hand-written
"write a string into linear memory, get a pointer back" layer is enough — smaller artefact, and the
build needs no network.

## Exported functions

| Export | Purpose |
|---|---|
| `prism_alloc(n) -> ptr` | Allocate `n` bytes for the JS side to write the input text into |
| `prism_free(ptr, n)` | Free an input buffer |
| `prism_analyze(textPtr, len, rate, od, goal, overallOnly) -> i32` | Score the whole map, writing the result as JSON into RESULT_SLOT |
| `prism_analyze_ln(textPtr, len, rate, od, goal) -> i32` | Score LN difficulty only |
| `prism_supports(keyCount) -> i32` | Whether Prism rates this key mode (6/7/8 → 1) |
| `prism_version() -> i32` | Write the engine version string into RESULT_SLOT |
| `prism_result_ptr() -> ptr` | Address of the result slot (layout: `[ptr:u32, len:u32, ...]`) |
| `prism_free_bytes(ptr, n)` | Free a result buffer |

A negative `od` means "use the OD the beatmap declares".

## How to use

1. Fetch the whole upstream `algorithms/prism` directory
2. Put this directory's `Cargo.toml` and `src/lib.rs` into `algorithms/prism/crates/prism-wasm/`
3. Build:

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown -p prism-wasm
```

The artefact appears at `target/wasm32-unknown-unknown/release/prism_wasm.wasm`;
copy it to `js/lib/estimator/prism/prism.wasm`.

## JS side

See `loadPrism()` / `prismDifficulty()` in `js/lib/estimator/prism/index.js`.

## License

This shim is MIT by MiraiFx. Prism upstream is MIT, Copyright (c) 2026 aleju03 — see `NOTICE.md`.

---

<a id="中文"></a>

# 中文

本目录是 Prism Rust 源码树里的一个附加 crate，作用只有一个：
把上游 `prism` crate 的 API 暴露成纯 C-ABI 函数，让 WebAssembly 能调用。

**它不改动 Prism 的任何算法逻辑。**

## 为什么不用 wasm-bindgen

wasm-bindgen 要从 crates.io 拉一堆依赖，在受限网络下容易卡住。
Prism 上游本身零外部依赖（全是 path 依赖），所以手写一层
「往线性内存写字符串、拿回指针」就够了 —— 产物更小、编译不联网。

## 导出的函数

| 导出 | 作用 |
|---|---|
| `prism_alloc(n) -> ptr` | 分配 n 字节，给 JS 写入输入文本 |
| `prism_free(ptr, n)` | 释放输入缓冲区 |
| `prism_analyze(textPtr, len, rate, od, goal, overallOnly) -> i32` | 算整图，结果写成 JSON 放进 RESULT_SLOT |
| `prism_analyze_ln(textPtr, len, rate, od, goal) -> i32` | 只算 LN 难度 |
| `prism_supports(keyCount) -> i32` | 该键数是否由 Prism 评级（6/7/8 → 1） |
| `prism_version() -> i32` | 把引擎版本字符串写进 RESULT_SLOT |
| `prism_result_ptr() -> ptr` | 结果槽地址（结构：`[ptr:u32, len:u32, ...]`） |
| `prism_free_bytes(ptr, n)` | 释放结果缓冲区 |

`od` 传负数表示「用谱面自带的 OD」。

## 使用方法

1. 把上游 `algorithms/prism` 整个目录取下来
2. 把本目录的 `Cargo.toml` 和 `src/lib.rs` 放到 `algorithms/prism/crates/prism-wasm/`
3. 编译：

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown -p prism-wasm
```

产物在 `target/wasm32-unknown-unknown/release/prism_wasm.wasm`，
复制到 `js/lib/estimator/prism/prism.wasm`。

## JS 侧

见 `js/lib/estimator/prism/index.js` 的 `loadPrism()` / `prismDifficulty()`。

## 许可

本出口层为 MIT，作者 MiraiFx。Prism 上游为 MIT，版权 (c) 2026 aleju03 —— 详见 `NOTICE.md`。
