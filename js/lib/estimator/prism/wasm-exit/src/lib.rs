// Prism WASM 出口层 —— 纯 C-ABI，不依赖 wasm-bindgen。
//
// 设计：JS 侧用 alloc/写入线性内存传字符串进来；本层把结果序列化成一段
// UTF-8 JSON 放进一块由 invoke 分配的 Buffer，返回一个三元组：
//   ret[0] = ptr, ret[1] = len
// 调用方读出后用 free_bytes 释放。
//
// 算法本身一行未改：所有数值都来自上游 prism crate 的 analyze_prism_from_text。

use std::alloc::{alloc, dealloc, Layout};

/// 由 JS 侧读取的内部返回值：指向 [ptr, len] 两个 u32 的小缓冲区。
/// 用 16 字节对齐分配，避免宿主端按 Float64 视图读时对不齐。
static mut RESULT_SLOT: [u32; 4] = [0; 4];

/// 分配 n 字节，返回指针，供 JS 写入输入文本。
#[no_mangle]
pub extern "C" fn prism_alloc(n: usize) -> *mut u8 {
    if n == 0 {
        return std::ptr::null_mut();
    }
    let layout = Layout::from_size_align(n, 8).expect("layout");
    unsafe { alloc(layout) }
}

/// 释放 prism_alloc 分配的块。
#[no_mangle]
pub extern "C" fn prism_free(ptr: *mut u8, n: usize) {
    if ptr.is_null() || n == 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(n, 8) {
        unsafe { dealloc(ptr, layout) }
    }
}

/// 释放输出缓冲区。
#[no_mangle]
pub extern "C" fn prism_free_bytes(ptr: *mut u8, n: usize) {
    prism_free(ptr, n);
}

/// 结果缓冲区指针（JS 读 ret[0]）。
#[no_mangle]
pub extern "C" fn prism_result_ptr() -> *mut u8 {
    unsafe { RESULT_SLOT.as_mut_ptr() as *mut u8 }
}

/// 写一个人工构造的 JSON 错误/结果，返回 1 表示成功生产了输出。
fn emit(json: String) -> i32 {
    // 末尾补 0 方便宿主端用 strlen 之类的方式调试
    let mut bytes = json.into_bytes();
    bytes.push(0);
    let len = bytes.len();
    let boxed = bytes.into_boxed_slice();
    let ptr = Box::into_raw(boxed) as *mut u8;
    unsafe {
        RESULT_SLOT[0] = ptr as u32;
        RESULT_SLOT[1] = len as u32;
    }
    1
}

fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn f64_json(v: f64) -> String {
    if v.is_finite() {
        // 保留足够精度，避免往返丢位
        format!("{}", v)
    } else {
        "null".to_string()
    }
}

/// 核心入口。
///
/// 参数：
///   text_ptr / text_len —— 线性内存里的 osu! 谱面文本（UTF-8）
///   rate               —— 速率倍率（1.0 = 原速）
///   od                 —— 覆盖 OD；传负值表示「用谱面自带的 OD」
///   goal               —— 目标成绩（0.965 为默认基准）
///   overall_only       —— 非 0 时只算 Overall，跳过各 skillset
///
/// 返回 1 表示已把 JSON 写入 RESULT_SLOT；0 表示键数不受 Prism 支持。
#[no_mangle]
pub extern "C" fn prism_analyze(
    text_ptr: *const u8,
    text_len: usize,
    rate: f64,
    od: f64,
    goal: f64,
    overall_only: u32,
) -> i32 {
    if text_ptr.is_null() || text_len == 0 {
        return emit(r#"{"ok":false,"error":"empty chart text"}"#.to_string());
    }

    let bytes = unsafe { std::slice::from_raw_parts(text_ptr, text_len) };
    let text = match std::str::from_utf8(bytes) {
        Ok(t) => t,
        Err(e) => {
            return emit(format!(r#"{{"ok":false,"error":"invalid utf-8: {}"}}"#, escape_json(&e.to_string())))
        }
    };

    let options = prism::PrismOptions {
        rate: Some(rate),
        od: if od < 0.0 { None } else { Some(od) },
        goal: Some(goal),
        overall_only: overall_only != 0,
    };

    match prism::analyze_prism_from_text(text, &options) {
        Some(result) => {
            let mut values = String::from("{");
            for (i, (name, value)) in result.values.iter().enumerate() {
                if i > 0 {
                    values.push(',');
                }
                values.push('"');
                values.push_str(name);
                values.push_str("\":");
                values.push_str(&f64_json(*value));
            }
            values.push('}');

            let json = format!(
                r#"{{"ok":true,"version":{},"keyCount":{},"rate":{},"goal":{},"centreHand":{},"values":{}}}"#,
                result.version,
                result.key_count,
                f64_json(result.rate),
                f64_json(result.goal),
                result.centre_hand,
                values
            );
            emit(json)
        }
        None => emit(r#"{"ok":false,"error":"unsupported key count"}"#.to_string()),
    }
}

/// LN 入口：走上游独立的 LN 模型 + LN scale。
///
/// 与 prism_analyze 同一套参数约定；结果为单个数（LN 难度），
/// 以 JSON `{"ok":true,"ln":<number>}` 写入 RESULT_SLOT。
#[no_mangle]
pub extern "C" fn prism_analyze_ln(
    text_ptr: *const u8,
    text_len: usize,
    rate: f64,
    od: f64,
    goal: f64,
) -> i32 {
    if text_ptr.is_null() || text_len == 0 {
        return emit(r#"{"ok":false,"error":"empty chart text"}"#.to_string());
    }
    let bytes = unsafe { std::slice::from_raw_parts(text_ptr, text_len) };
    let text = match std::str::from_utf8(bytes) {
        Ok(t) => t,
        Err(e) => {
            return emit(format!(r#"{{"ok":false,"error":"invalid utf-8: {}"}}"#, escape_json(&e.to_string())))
        }
    };

    let map = chart_parser::parse_mania_beatmap(text);
    let notes = prism::chart_notes(&map);
    let options = prism::PrismOptions {
        rate: Some(rate),
        od: if od < 0.0 { None } else { Some(od) },
        goal: Some(goal),
        overall_only: true,
    };

    match prism::analyze_prism_ln(&notes, map.key_count, map.od, &options) {
        Some(ln) => emit(format!(r#"{{"ok":true,"ln":{}}}"#, f64_json(ln))),
        None => emit(r#"{"ok":false,"error":"unsupported key count"}"#.to_string()),
    }
}

/// 探测某键数是否由 Prism 评级（6/7/8 为 true）。
#[no_mangle]
pub extern "C" fn prism_supports(key_count: i32) -> i32 {
    if prism::uses_prism(Some(key_count)) { 1 } else { 0 }
}

/// 返回计算引擎版本字符串（如 "prism-v25"），写入 RESULT_SLOT。
#[no_mangle]
pub extern "C" fn prism_version() -> i32 {
    let v = prism::prism_engine_version();
    emit(format!(r#"{{"ok":true,"version":"{}"}}"#, escape_json(&v)))
}
