/**
 * barcodeGenerator.js - 轻量级条码生成器
 * 版本：v1.3.0
 *
 * 支持格式：
 *   - EAN-13  (12/13 位数字，含 mod-10 校验位)
 *   - Code-128 Code Set B (ASCII 32–127)
 *
 * 用法：
 *   import { generateBarcodeMatrix } from './barcodeGenerator.js';
 *   const matrix = generateBarcodeMatrix({ format: 'EAN13', text: '6901028001234' });
 *   // matrix 为 [rows] 的二维数组，每行模块为 0/1
 */

// ─────────────────────────────────────────────
// EAN-13
// ─────────────────────────────────────────────

// 左侧 L 编码（奇校验）
const EAN13_L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];

// 左侧 G 编码（偶校验）
const EAN13_G = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];

// 右侧 R 编码
const EAN13_R = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];

// 首位数字 → 6 位 L/G 奇偶模式（0=L, 1=G）
const EAN13_PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

// EAN-13 总模块数（不含静区）
const EAN13_BAR_MODULES = 3 + 42 + 5 + 42 + 3; // = 95
const EAN13_QUIET_MODULES = 9 + 7; // 左侧 9 + 右侧 7

/**
 * 计算 EAN-13 校验位（mod-10）
 * 加权位（左→右，第 1 位权重 3、3、1、3、1…）
 * 校验位 = (10 - (sum mod 10)) mod 10
 */
function ean13CheckDigit(twelve) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const w = i % 2 === 0 ? 3 : 1; // 左起第 1 位权重 3
    sum += parseInt(twelve[i], 10) * w;
  }
  return (10 - (sum % 10)) % 10;
}

function generateEAN13(rawText) {
  const text = String(rawText || "").replace(/\D/g, "");
  if (text.length !== 12 && text.length !== 13) {
    throw new Error(`[barcodeGenerator] EAN-13 需要 12 或 13 位数字，实际 ${text.length} 位`);
  }

  let fullText = text;
  if (text.length === 12) {
    fullText = text + String(ean13CheckDigit(text));
  } else if (parseInt(text[12], 10) !== ean13CheckDigit(text.slice(0, 12))) {
    // 13 位但校验位不匹配：抛错，由上层决定
    throw new Error(`[barcodeGenerator] EAN-13 校验位不匹配：期望 ${ean13CheckDigit(text.slice(0, 12))}，实际 ${text[12]}`);
  }

  const first = parseInt(fullText[0], 10);
  const parity = EAN13_PARITY[first];
  const left6 = fullText.slice(1, 7);
  const right6 = fullText.slice(7, 13);

  const bits = [];

  // 左侧静区
  for (let i = 0; i < 9; i++) bits.push(0);

  // 起始 guard: 101
  bits.push(1, 0, 1);

  // 左侧 6 位：按 parity 选择 L/G
  for (let i = 0; i < 6; i++) {
    const d = parseInt(left6[i], 10);
    const pattern = parity[i] === "L" ? EAN13_L[d] : EAN13_G[d];
    for (const c of pattern) bits.push(parseInt(c, 10));
  }

  // 中心 guard: 01010
  bits.push(0, 1, 0, 1, 0);

  // 右侧 6 位：R 编码
  for (let i = 0; i < 6; i++) {
    const d = parseInt(right6[i], 10);
    const pattern = EAN13_R[d];
    for (const c of pattern) bits.push(parseInt(c, 10));
  }

  // 结束 guard: 101
  bits.push(1, 0, 1);

  // 右侧静区
  for (let i = 0; i < 7; i++) bits.push(0);

  return { bits, format: "EAN13", displayText: fullText, humanReadable: fullText };
}

// ─────────────────────────────────────────────
// Code-128 Code Set B
// ─────────────────────────────────────────────

// 每个 symbol 11 模块，左→右：bar-space-bar-space-bar-space-bar-space-bar-space-bar
const CODE128_PATTERNS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100", // 0-4
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000", // 5-9
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110", // 10-14
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100", // 15-19
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100", // 20-24
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010", // 25-29
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000", // 30-34
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000", // 35-39
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110", // 40-44
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110", // 45-49
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000", // 50-54
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010", // 55-59
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100", // 60-64
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000", // 65-69
  "10011010000", "10011000010", "10000110100", "10000110010", "11000010010", // 70-74
  "11001010000", "11110111010", "11000010100", "10001111010", "10100111100", // 75-79
  "10010111100", "10010011110", "10111100100", "10011110100", "10011110010", // 80-84
  "11110100100", "11110010100", "11110010010", "11011011110", "11011110110", // 85-89
  "11110110110", "10101111000", "10100011110", "10001011110", "10111101000", // 90-94
  "10111100010", "11110101000", "11110100010", "11110101110", "11110111110", // 95-99
  "11111010100", "11111010010", "11111010000",                            // 100-102 (FNC4/FNC5/FNC1)
  "11010000100", // 103 = Start A
  "11010010000", // 104 = Start B
  "11010011100", // 105 = Start C
];

// 终止符：13 模块（11 数据 + 终止 2 模块）
const CODE128_STOP = "1100011101011";

function generateCode128B(rawText) {
  const text = String(rawText || "");
  if (!text) {
    throw new Error("[barcodeGenerator] Code-128 内容不能为空");
  }
  // Code Set B 限制：ASCII 32–127
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 127) {
      throw new Error(`[barcodeGenerator] Code-128B 不支持字符 "${text[i]}" (code ${code})，仅支持 ASCII 32–127`);
    }
  }

  const values = [104]; // Start B
  for (let i = 0; i < text.length; i++) {
    values.push(text.charCodeAt(i) - 32);
  }
  // 校验位 = (start + Σ value_i * (i+1)) mod 103
  let checksum = values[0];
  for (let i = 1; i < values.length; i++) {
    checksum += values[i] * i;
  }
  values.push(checksum % 103);

  const bits = [];
  // 左侧静区（10 模块）
  for (let i = 0; i < 10; i++) bits.push(0);

  for (let i = 0; i < values.length; i++) {
    const pattern = CODE128_PATTERNS[values[i]];
    for (const c of pattern) bits.push(parseInt(c, 10));
  }

  // 终止符（13 模块）
  for (const c of CODE128_STOP) bits.push(parseInt(c, 10));

  // 右侧静区（10 模块）
  for (let i = 0; i < 10; i++) bits.push(0);

  return { bits, format: "CODE128", displayText: text, humanReadable: text };
}

// ─────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────

/**
 * 生成条码模块矩阵
 * @param {Object} options
 * @param {"EAN13"|"CODE128"} options.format
 * @param {string} options.text
 * @returns {{ bits: number[][], format: string, displayText: string, humanReadable: string }}
 *   bits 为单行二维数组（rows=1），每格 0/1
 */
export function generateBarcodeMatrix({ format, text } = {}) {
  let result;
  if (format === "EAN13" || format === "EAN-13") {
    result = generateEAN13(text);
  } else if (format === "CODE128" || format === "CODE-128") {
    result = generateCode128B(text);
  } else {
    throw new Error(`[barcodeGenerator] 暂不支持的格式: ${format}（当前支持 EAN13 / CODE128）`);
  }
  return {
    bits: [result.bits],
    format: result.format,
    displayText: result.displayText,
    humanReadable: result.humanReadable,
  };
}

/**
 * 仅生成位序列（一维），不包装成单行矩阵，便于上层直接绘制
 */
export function generateBarcodeBits({ format, text } = {}) {
  const r = generateBarcodeMatrix({ format, text });
  return r.bits[0];
}
