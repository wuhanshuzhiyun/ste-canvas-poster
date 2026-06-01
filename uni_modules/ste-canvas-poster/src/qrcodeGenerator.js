/**
 * qrcodeGenerator.js - 轻量级 QR 码生成器
 * 版本：v1.2.0
 *
 * 基于 Nayuki QR Code generator 算法原理实现，纯 JS，无 DOM 依赖。
 *
 * 用法：
 *   import { generateQRMatrix } from './qrcodeGenerator.js';
 *   const matrix = generateQRMatrix('https://example.com');
 *   // matrix[r][c] => 1=黑, 0=白
 */

// ─────────────────────────────────────────────
// 工具：UTF-8 编码
// ─────────────────────────────────────────────

function stringToUtf8Bytes(text) {
  const encoded = encodeURIComponent(text);
  const bytes = [];
  for (let i = 0; i < encoded.length; ) {
    if (encoded[i] === "%") {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      bytes.push(encoded.charCodeAt(i));
      i++;
    }
  }
  return bytes;
}

// ─────────────────────────────────────────────
// 伽罗华域 GF(2^8) 运算
// ─────────────────────────────────────────────

const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = x << 1;
    if (x > 255) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[(GF_LOG[x] + GF_LOG[y]) % 255];
}

function gfPow(x, p) {
  return GF_EXP[(GF_LOG[x] * p) % 255];
}

function rsGeneratorPoly(count) {
  let g = [1];
  for (let i = 0; i < count; i++) {
    const factor = [1, gfPow(2, i)];
    const result = new Array(g.length + factor.length - 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      for (let k = 0; k < factor.length; k++) {
        result[j + k] ^= gfMul(g[j], factor[k]);
      }
    }
    g = result;
  }
  return g;
}

function rsCalcErrorCorrection(data, eccCount) {
  const gen = rsGeneratorPoly(eccCount);
  const msg = [...data, ...new Array(gen.length - 1).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coeff = msg[i];
    if (coeff !== 0) {
      for (let j = 1; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coeff);
      }
    }
  }
  return msg.slice(data.length);
}

// ─────────────────────────────────────────────
// QR 码版本参数（版本 1-40，纠错级别 M）
// 每项: [totalCodewords, ecCodewordsPerBlock, numBlocks, dataCodewordsPerBlock]
// ─────────────────────────────────────────────

const EC_PARAMS = {
  // version: [totalCodewords, ecPerBlock, numBlocks, dataPerBlock]
  1: [26, 10, 1, 16],
  2: [44, 16, 1, 28],
  3: [70, 26, 1, 44],
  4: [100, 18, 2, 32],
  5: [134, 24, 2, 43],
  6: [172, 16, 4, 27],
  7: [196, 18, 4, 31],
  8: [242, 22, 4, 38],
  9: [292, 22, 5, 36],
  10: [346, 26, 5, 43],
  11: [404, 30, 5, 50],
  12: [466, 22, 8, 36],
  13: [532, 22, 9, 37],
  14: [581, 24, 9, 38],
  15: [655, 24, 10, 40],
  16: [733, 28, 10, 45],
  17: [815, 28, 11, 46],
  18: [901, 26, 13, 43],
  19: [991, 26, 14, 44],
  20: [1085, 26, 16, 41],
};

// 数据容量（Byte 模式，纠错级别 M）
const BYTE_CAPACITY = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666];

function selectVersion(dataLen) {
  for (let v = 1; v <= 20; v++) {
    if (dataLen <= (BYTE_CAPACITY[v] || 0)) return v;
  }
  return 20;
}

// ─────────────────────────────────────────────
// 数据编码（Byte 模式）
// ─────────────────────────────────────────────

function encodeData(text, version) {
  const bytes = stringToUtf8Bytes(text);
  const bits = [];

  // 模式指示符：Byte = 0100
  bits.push(0, 1, 0, 0);

  // 字符计数指示符
  const lenBits = version <= 9 ? 8 : 16;
  for (let i = lenBits - 1; i >= 0; i--) {
    bits.push((bytes.length >> i) & 1);
  }

  // 数据位
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((b >> i) & 1);
    }
  }

  // 终止符（最多4个0）
  const params = EC_PARAMS[version];
  const totalDataBits = (params[2] * params[3] + (params[2] > 1 ? 0 : 0)) * 8;
  // 简化：用总数据码字 * 8
  const dataCodewords = Math.floor((params[0] * params[3]) / (params[3] + params[1]));
  const totalBits = dataCodewords * 8;

  for (let i = 0; i < 4 && bits.length < totalBits; i++) bits.push(0);

  // 字节对齐
  while (bits.length % 8) bits.push(0);

  // 转码字
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | (bits[i + j] || 0);
    codewords.push(val);
  }

  // 填充码字
  const pad = [0xec, 0x11];
  while (codewords.length < dataCodewords) {
    codewords.push(pad[codewords.length % 2]);
  }

  return codewords;
}

// ─────────────────────────────────────────────
// 矩阵操作
// ─────────────────────────────────────────────

function createMatrix(size) {
  const mat = [];
  for (let i = 0; i < size; i++) {
    mat.push(new Array(size).fill(-1)); // -1 = 未占用
  }
  return mat;
}

// 放置 Finder Pattern（7x7 定位图案 + 1格间隔带）
function placeFinder(mat, row, col) {
  const pattern = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const mr = row + r;
      const mc = col + c;
      if (mr < 0 || mc < 0 || mr >= mat.length || mc >= mat.length) continue;
      if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
        mat[mr][mc] = pattern[r][c];
      } else {
        mat[mr][mc] = 0; // 间隔带为白
      }
    }
  }
}

// 对齐图案位置表
const ALIGNMENT_POSITIONS = [
  null,
  null, // v1
  [6, 18], // v2
  [6, 22], // v3
  [6, 26], // v4
  [6, 30], // v5
  [6, 34], // v6
  [6, 22, 38], // v7
  [6, 24, 42], // v8
  [6, 26, 46], // v9
  [6, 28, 50], // v10
  [6, 30, 54], // v11
  [6, 32, 58], // v12
  [6, 34, 62], // v13
  [6, 26, 46, 66], // v14
  [6, 26, 48, 70], // v15
  [6, 26, 50, 74], // v16
  [6, 30, 54, 78], // v17
  [6, 30, 56, 82], // v18
  [6, 30, 58, 86], // v19
  [6, 34, 62, 90], // v20
];

function placeAlignment(mat, version) {
  if (version < 2) return;
  const positions = ALIGNMENT_POSITIONS[version];
  if (!positions) return;

  for (const r of positions) {
    for (const c of positions) {
      // 跳过与 finder 重叠的位置
      if (mat[r][c] !== -1) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const val = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0) ? 1 : 0;
          mat[r + dr][c + dc] = val;
        }
      }
    }
  }
}

function placeTiming(mat, size) {
  for (let i = 8; i < size - 8; i++) {
    if (mat[6][i] === -1) mat[6][i] = i % 2 === 0 ? 1 : 0;
    if (mat[i][6] === -1) mat[i][6] = i % 2 === 0 ? 1 : 0;
  }
}

function placeDarkModule(mat, version) {
  mat[4 * version + 9][8] = 1;
}

// 格式信息编码
function placeFormatInfo(mat, size, maskPattern) {
  // 纠错级别 M = 00
  const ecl = 0b00;
  let data = (ecl << 3) | maskPattern;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >> 9) * 0b10100110111);
  }
  const bits = ((data << 10) | rem) ^ 0b101010000010010;

  // 第一组位置
  const positions1 = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  // 第二组位置
  const positions2 = [
    [size - 1, 8],
    [size - 2, 8],
    [size - 3, 8],
    [size - 4, 8],
    [size - 5, 8],
    [size - 6, 8],
    [size - 7, 8],
    [8, size - 8],
    [8, size - 7],
    [8, size - 6],
    [8, size - 5],
    [8, size - 4],
    [8, size - 3],
    [8, size - 2],
    [8, size - 1],
  ];

  for (let i = 0; i < 15; i++) {
    const bit = (bits >> (14 - i)) & 1;
    if (positions1[i]) mat[positions1[i][0]][positions1[i][1]] = bit;
    if (positions2[i]) mat[positions2[i][0]][positions2[i][1]] = bit;
  }
}

// 版本信息（版本 >= 7）
function placeVersionInfo(mat, size, version) {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) {
    rem = (rem << 1) ^ ((rem >> 11) * 0b1111100100101);
  }
  const bits = (version << 12) | rem;

  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const r = Math.floor(i / 3);
    const c = size - 11 + (i % 3);
    mat[r][c] = bit;
    mat[c][r] = bit;
  }
}

// 放置数据位
function placeDataBits(mat, size, dataBits) {
  let bitIdx = 0;
  let upward = true;

  for (let colPair = size - 1; colPair >= 1; colPair -= 2) {
    if (colPair === 6) colPair = 5; // 跳过时序列列

    for (let rowOffset = 0; rowOffset < size; rowOffset++) {
      const row = upward ? size - 1 - rowOffset : rowOffset;

      for (let colOffset = 0; colOffset <= 1; colOffset++) {
        const col = colPair - colOffset;
        if (mat[row][col] !== -1) continue; // 跳过已占用的功能区域
        mat[row][col] = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
      }
    }
    upward = !upward;
  }
}

// ─────────────────────────────────────────────
// 掩码评估与应用
// ─────────────────────────────────────────────

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// 只对数据区域应用掩码（功能区域保持不变）
function applyMask(mat, size, maskPattern) {
  const fn = MASK_FNS[maskPattern];
  const result = mat.map((row) => [...row]);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isDataArea(size, r, c)) {
        result[r][c] = fn(r, c) ? mat[r][c] ^ 1 : mat[r][c];
      }
    }
  }
  return result;
}

// 判断是否为数据区域（非功能区域）
function isDataArea(size, r, c) {
  // Finder + 分隔带区域
  if (r <= 8 && c <= 8) return false; // 左上
  if (r <= 8 && c >= size - 8) return false; // 右上
  if (r >= size - 8 && c <= 8) return false; // 左下

  // 时序图案
  if (r === 6 || c === 6) return false;

  // 暗模块
  if (r === size - 8 && c === 8) return false;

  return true;
}

// 评估掩码惩罚分（简化版，选择惩罚最小的掩码）
function evaluatePenalty(mat, size) {
  let penalty = 0;

  // 规则1：同行/列连续同色5个以上
  for (let r = 0; r < size; r++) {
    let count = 1;
    for (let c = 1; c < size; c++) {
      if (mat[r][c] === mat[r][c - 1]) {
        count++;
      } else {
        if (count >= 5) penalty += count - 2;
        count = 1;
      }
    }
    if (count >= 5) penalty += count - 2;
  }
  for (let c = 0; c < size; c++) {
    let count = 1;
    for (let r = 1; r < size; r++) {
      if (mat[r][c] === mat[r - 1][c]) {
        count++;
      } else {
        if (count >= 5) penalty += count - 2;
        count = 1;
      }
    }
    if (count >= 5) penalty += count - 2;
  }

  // 规则2：2x2同色块
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = mat[r][c];
      if (v === mat[r][c + 1] && v === mat[r + 1][c] && v === mat[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  return penalty;
}

// ─────────────────────────────────────────────
// 核心：生成 QR 矩阵
// ─────────────────────────────────────────────

/**
 * 生成 QR 码模块矩阵
 * @param {string} text 要编码的文本
 * @returns {number[][]} 二维数组，1=黑，0=白
 */
export function generateQRMatrix(text) {
  const byteLen = stringToUtf8Bytes(text).length;
  if (byteLen > BYTE_CAPACITY[20]) {
    throw new Error(`[qrcodeGenerator] 数据过长(${byteLen}字节)，最大支持${BYTE_CAPACITY[20]}字节`);
  }
  const version = selectVersion(byteLen);
  const size = 17 + 4 * version;

  // 编码数据 + 纠错
  const codewords = encodeData(text, version);
  const params = EC_PARAMS[version];
  const numBlocks = params[2];
  const ecPerBlock = params[1];

  // 分块计算纠错码
  const dataPerBlock = params[3];
  const shortBlockLen = Math.floor(codewords.length / numBlocks);
  const longBlocks = codewords.length % numBlocks;

  const blocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < numBlocks; i++) {
    const blockLen = shortBlockLen + (i >= numBlocks - longBlocks ? 1 : 0);
    const blockData = codewords.slice(offset, offset + blockLen);
    offset += blockLen;
    blocks.push(blockData);
    ecBlocks.push(rsCalcErrorCorrection(blockData, ecPerBlock));
  }

  // 交错排列数据和纠错码字
  const interleaved = [];
  const maxDataLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i < blocks[j].length) interleaved.push(blocks[j][i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let j = 0; j < numBlocks; j++) {
      interleaved.push(ecBlocks[j][i]);
    }
  }

  // 转为位流
  const dataBits = [];
  for (const byte of interleaved) {
    for (let i = 7; i >= 0; i--) {
      dataBits.push((byte >> i) & 1);
    }
  }

  // 尝试所有8种掩码，选择惩罚最小的
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestMatrix = null;

  for (let mask = 0; mask < 8; mask++) {
    const mat = createMatrix(size);

    // 放置功能图案
    placeFinder(mat, 0, 0);
    placeFinder(mat, 0, size - 7);
    placeFinder(mat, size - 7, 0);
    placeAlignment(mat, version);
    placeTiming(mat, size);
    placeDarkModule(mat, version);
    placeFormatInfo(mat, size, mask);
    placeVersionInfo(mat, size, version);

    // 放置数据
    placeDataBits(mat, size, dataBits);

    // 应用掩码（只对数据区域）
    const masked = applyMask(mat, size, mask);

    // 重新放置格式信息（掩码后）
    placeFormatInfo(masked, size, mask);

    const penalty = evaluatePenalty(masked, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestMatrix = masked;
    }
  }

  return bestMatrix;
}
