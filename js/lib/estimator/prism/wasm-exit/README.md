# Prism wasm 出口层

这里的 `lib.rs` / `Cargo.toml` 是 Prism Rust 源码树里的一个附加 crate，
作用是把上游 `prism` crate 的 API 暴露成 wasm 能调用的纯 C-ABI 函数。

**它不改动 Prism 的任何算法。**

## 为什么不用 wasm-bindgen

wasm-bindgen 要从 crates.io 拉一堆依赖，在受限网络下容易卡住。
Prism 上游本身零外部依赖（全是 path 依赖），所以这里手写一层简单的
「线性内存传字符串 + 返回指针」即可，产物更小、编译不联网。

## 接口

| 导出函数 | 作用 |
|---|---|
| `prism_alloc(n) -> ptr` | 分配 n 字节，给 JS 写入输入文本 |
| `prism_free(ptr, n)` | 释放输入缓冲区 |
| `prism_analyze(textPtr, len, rate, od, goal, overallOnly) -> i32` | 算整图，结果写成 JSON 放进 RESULT_SLOT |
| `prism_analyze_ln(textPtr, len, rate, od, goal) -> i32` | 只算 LN 难度 |
| `prism_supports(keyCount) -> i32` | 该键数是否由 Prism 评级（6/7/8 → 1） |
| `prism_version() -> i32` | 返回引擎版本字符串 |
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
