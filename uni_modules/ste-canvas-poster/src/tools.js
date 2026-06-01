const NARROW_CHARS = new Set([
  0x69, 0x6c, 0x6a, 0x74, 0x66, 0x72, 0x2e, 0x2c, 0x3b, 0x3a, 0x21, 0x7c, 0x27, 0x60, 0xb4, 0x5e, 0x7e, 0x28, 0x29, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x5c, 0x2d, 0x5f,
]);

const WIDE_CHARS = new Set([0x57, 0x4d, 0x40, 0x25, 0x26, 0x6d, 0x77, 0x4f, 0x51, 0x44, 0x48, 0x47, 0x4e, 0x52, 0x55, 0x56]);

function isFullWidth(code) {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0x2e80 && code <= 0x2fdf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x2f800 && code <= 0x2fa1f) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0xa000 && code <= 0xa48f) ||
    (code >= 0xa490 && code <= 0xa4cf)
  );
}

function getCharWidthRatio(code) {
  if (isFullWidth(code)) return 1.0;
  if (NARROW_CHARS.has(code)) return 0.33;
  if (WIDE_CHARS.has(code)) return 0.78;
  if (code >= 0x30 && code <= 0x39) return 0.55;
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return 0.58;
  if (code >= 0xc0 && code <= 0x24f) return 0.6;
  if (code >= 0x2018 && code <= 0x201d) return 0.55;
  if (code === 0x3000) return 1.0;
  if (code === 0x200b || code === 0xfeff) return 0;
  return 0.55;
}

/**
 * 计算文本宽度
 */
export function measureText(text, fontSize, bold = false) {
  if (text == null || typeof text !== "string") return 0;
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    width += getCharWidthRatio(code) * fontSize;
  }
  if (bold) width *= 1.06;
  return Math.ceil(width);
}

let _windowWidth = null;

export function getWindowWidth() {
  if (_windowWidth === null) {
    const current = uni.getSystemInfoSync().windowWidth;
    _windowWidth = current;
  }
  return _windowWidth || 375;
}

export function rpx2px(rpx) {
  if (_windowWidth == null) {
    _windowWidth = getWindowWidth();
  }
  return (rpx * _windowWidth) / 750;
}

export function px2rpx(px) {
  if (_windowWidth == null) {
    _windowWidth = getWindowWidth();
  }
  return (px * 750) / _windowWidth;
}

export function viewPrice({
  prices = 0,
  priceBold = true,
  prefixBold = true,
  suffixBold = false,
  prefix = "￥",
  suffix = "",
  fontSize = 40,
  color = "#FF283A",
  top = 0,
  left = 0,
} = {}) {
  const mSize = fontSize / 2;
  const result = {
    type: "view",
    css: { left, top, display: "flex", alignItems: "baseline" },
    views: [
      {
        type: "text",
        text: prefix,
        css: { fontSize: mSize, color, fontWeight: prefixBold ? "bold" : "normal" },
      },
    ],
  };
  if (typeof prices === "number" || typeof prices === "string") {
    const pv = parseInt(prices, 10) || 0;
    const y = Math.floor(pv / 100);
    const f = (pv % 100 >= 10 ? pv % 100 : "0" + (pv % 100)).toString();

    result.views.push({
      type: "text",
      text: `${y}.`,
      css: {
        fontSize,
        color,
        fontWeight: priceBold ? "bold" : "normal",
      },
    });

    result.views.push({
      type: "text",
      text: f,
      css: {
        fontSize: mSize,
        color,
        fontWeight: priceBold ? "bold" : "normal",
      },
    });
  } else if (Array.isArray(prices)) {
    const nums = prices.map((item) => parseInt(item, 10) || 0);
    const y = nums.map((v) => Math.floor(v / 100));
    const f = nums.map((v) => v % 100);
    const ys = Math.min(...y);
    const fs = Math.min(...f) >= 10 ? String(Math.min(...f)) : "0" + Math.min(...f);
    const ye = Math.max(...y);
    const fe = Math.max(...f) >= 10 ? String(Math.max(...f)) : "0" + Math.max(...f);
    result.views.push({
      type: "text",
      text: `${ys}.`,
      css: {
        fontSize,
        color,
        fontWeight: priceBold ? "bold" : "normal",
      },
    });
    result.views.push({
      type: "text",
      text: fs,
      css: {
        fontSize: mSize,
        color,
        fontWeight: priceBold ? "bold" : "normal",
      },
    });
    result.views.push({
      type: "text",
      text: "~",
      css: {
        fontSize,
        color,
        fontWeight: priceBold ? "bold" : "normal",
      },
    });

    result.views.push({
      type: "text",
      text: `${ye}.`,
      css: {
        fontSize,
        color,
        fontWeight: priceBold ? "bold" : "normal",
      },
    });
    result.views.push({
      type: "text",
      text: fe,
      css: {
        fontSize: mSize,
        color,
        fontWeight: priceBold ? "bold" : "normal",
      },
    });
  }
  result.views.push({
    type: "text",
    text: suffix,
    css: {
      fontSize: mSize,
      color,
      fontWeight: suffixBold ? "bold" : "normal",
    },
  });
  return result;
}
