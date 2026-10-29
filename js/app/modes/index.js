// 模式注册表：按键数分发到 4K / 6K / 7K 三个独立模块。
// 5K / 8K / 9K / 10K 没有段位表，返回 null，调用方显示星数 + 「无段位表」。

import { mode4k } from "./mode4k.js";
import { mode6k } from "./mode6k.js";
import { mode7k } from "./mode7k.js";

const MODES = {
    4: mode4k,
    6: mode6k,
    7: mode7k,
};

export { mode4k, mode6k, mode7k };

/** 取该键数的模式模块；没有段位表返回 null。 */
export function getMode(keys) {
    return MODES[Number(keys)] || null;
}

/** 该键数是否有段位表。 */
export function hasDanTable(keys) {
    return Boolean(getMode(keys));
}
