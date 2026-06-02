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

function makeText(text, { fontSize, color, fontWeight, marginLeft, marginRight } = {}) {
  const css = { fontSize, color, fontWeight };
  if (marginLeft) css.marginLeft = marginLeft;
  if (marginRight) css.marginRight = marginRight;
  return { type: "text", text: String(text), css };
}

function formatCents(cents) {
  const y = Math.floor(cents / 100);
  const f = cents % 100;
  return { intPart: `${y}.`, decPart: f >= 10 ? String(f) : "0" + f };
}

export function viewPrice({
  prices = 0,
  priceBold = true,
  prefixBold = true,
  suffixBold = false,
  prefix = "￥",
  suffix,
  fontSize = 40,
  color = "#FF283A",
  top,
  left,
  prefixMarginRight,
  suffixMarginLeft,
} = {}) {
  const mSize = fontSize / 2;
  const boldIf = (flag) => (flag ? "bold" : "normal");
  const views = [];

  if (prefix) {
    views.push(
      makeText(prefix, {
        fontSize: mSize,
        color,
        fontWeight: boldIf(prefixBold),
        marginRight: prefixMarginRight,
      }),
    );
  }

  if (Array.isArray(prices)) {
    const nums = prices.map((item) => parseInt(item, 10) || 0);
    const minP = formatCents(Math.min(...nums));
    const maxP = formatCents(Math.max(...nums));

    views.push(
      makeText(minP.intPart, { fontSize, color, fontWeight: boldIf(priceBold) }),
      makeText(minP.decPart, { fontSize: mSize, color, fontWeight: boldIf(priceBold) }),
      makeText("~", { fontSize, color, fontWeight: boldIf(priceBold) }),
      makeText(maxP.intPart, { fontSize, color, fontWeight: boldIf(priceBold) }),
      makeText(maxP.decPart, { fontSize: mSize, color, fontWeight: boldIf(priceBold) }),
    );
  } else {
    const pv = parseInt(prices, 10) || 0;
    const p = formatCents(pv);

    views.push(
      makeText(p.intPart, { fontSize, color, fontWeight: boldIf(priceBold) }),
      makeText(p.decPart, { fontSize: mSize, color, fontWeight: boldIf(priceBold) }),
    );
  }

  if (suffix) {
    views.push(
      makeText(suffix, {
        fontSize: mSize,
        color,
        fontWeight: boldIf(suffixBold),
        marginLeft: suffixMarginLeft,
      }),
    );
  }

  return {
    type: "view",
    css: { left, top, display: "flex", alignItems: "baseline" },
    views,
  };
}
