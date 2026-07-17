/**
 * PosterEngine - 统一海报绘制引擎
 * 版本：v1.2.0
 * 支持平台：微信小程序 / APP
 * 说明：基于 Canvas 2D API，通过声明式 JSON Schema 驱动绘制，双端一致。
 */

import { generateQRMatrix } from "./qrcodeGenerator.js";
import { generateBarcodeMatrix } from "./barcodeGenerator.js";

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────
const MAX_IMAGE_CACHE_SIZE = 50;

// CSS 默认值
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 1.4;
const DEFAULT_FONT_WEIGHT = "normal";
const DEFAULT_FONT_FAMILY = "sans-serif";
const DEFAULT_TEXT_COLOR = "#000000";
const DEFAULT_TEXT_ALIGN = "left";
const DEFAULT_TEXT_DECORATION = "";

// 字体度量兜底比例（浏览器无 fontBoundingBox 时使用）
const FONT_ASCENT_FALLBACK_RATIO = 0.8;
const FONT_DESCENT_FALLBACK_RATIO = 0.2;

// 行高阈值：>10 视为 px 值，否则视为 fontSize 倍数
export const LINE_HEIGHT_PX_THRESHOLD = 10;

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

const LINEAR_GRADIENT_RE = /linear-gradient\(\s*(\d+)deg\s*,\s*(.+)\)/i;

function normalizeImageSrc(src) {
  return src ?? "";
}

function binarySearchSplit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text.length;
  let lo = 1;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.substring(0, mid)).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return ctx.measureText(text.substring(0, lo)).width <= maxWidth ? lo : 0;
}

function binarySearchTruncate(ctx, text, maxWidth, suffix = "...") {
  const suffixWidth = ctx.measureText(suffix).width;
  if (ctx.measureText(text).width + suffixWidth <= maxWidth) return text;
  const targetWidth = maxWidth - suffixWidth;
  if (targetWidth <= 0) return "";
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.measureText(text.substring(0, mid)).width <= targetWidth) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return text.substring(0, lo - 1);
}

function parsePadding(padding) {
  if (padding == null) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof padding === "number") return { top: padding, right: padding, bottom: padding, left: padding };
  const [t = 0, r = 0, b = 0, l = 0] = padding;
  if (padding.length === 2) return { top: t, right: r, bottom: t, left: r };
  return { top: t, right: r, bottom: b, left: l };
}

function parseBorderRadius(r) {
  if (r == null || r === 0) return [0, 0, 0, 0];
  if (typeof r === "number") return [r, r, r, r];
  const [lt = 0, rt = 0, rb = 0, lb = 0] = r;
  return [lt, rt, rb, lb];
}

function roundRectPath(ctx, x, y, w, h, radius) {
  let [lt, rt, rb, lb] = parseBorderRadius(radius);
  const maxRadius = Math.min(w / 2, h / 2);

  lt = Math.min(lt, maxRadius);
  rt = Math.min(rt, maxRadius);
  rb = Math.min(rb, maxRadius);
  lb = Math.min(lb, maxRadius);

  ctx.beginPath();
  ctx.moveTo(x + lt, y);
  ctx.lineTo(x + w - rt, y);
  ctx.arcTo(x + w, y, x + w, y + rt, rt);
  ctx.lineTo(x + w, y + h - rb);
  ctx.arcTo(x + w, y + h, x + w - rb, y + h, rb);
  ctx.lineTo(x + lb, y + h);
  ctx.arcTo(x, y + h, x, y + h - lb, lb);
  ctx.lineTo(x, y + lt);
  ctx.arcTo(x, y, x + lt, y, lt);
  ctx.closePath();
}

function parseLinearGradient(ctx, gradientStr, x, y, w, h) {
  const m = gradientStr.match(LINEAR_GRADIENT_RE);
  if (!m) return null;

  const deg = parseInt(m[1], 10);
  const rad = ((deg - 90) * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const halfLen = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
  const x0 = cx - Math.cos(rad) * halfLen;
  const y0 = cy - Math.sin(rad) * halfLen;
  const x1 = cx + Math.cos(rad) * halfLen;
  const y1 = cy + Math.sin(rad) * halfLen;

  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  const stopsStr = m[2];
  const stops = [];
  let depth = 0;
  let segStart = 0;
  for (let i = 0; i <= stopsStr.length; i++) {
    const ch = stopsStr[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if ((ch === "," || i === stopsStr.length) && depth === 0) {
      const seg = stopsStr.substring(segStart, i).trim();
      if (seg) stops.push(seg);
      segStart = i + 1;
    }
  }
  stops.forEach((stop) => {
    const parts = stop.split(/\s+/);
    const color = parts[0];
    const offset = parts[1] ? parseFloat(parts[1]) / 100 : 0;
    gradient.addColorStop(offset, color);
  });
  return gradient;
}

function calcCover(imgW, imgH, dstX, dstY, dstW, dstH) {
  const scale = Math.max(dstW / imgW, dstH / imgH);
  const sw = dstW / scale;
  const sh = dstH / scale;
  const sx = (imgW - sw) / 2;
  const sy = (imgH - sh) / 2;
  return { sx, sy, sw, sh, dx: dstX, dy: dstY, dw: dstW, dh: dstH };
}

// ─────────────────────────────────────────────
// 图片加载
// ─────────────────────────────────────────────

export function loadImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const normalizedSrc = normalizeImageSrc(src);
    if (!normalizedSrc) {
      reject(new Error(`图片路径为空`));
      return;
    }

    // #ifdef APP-PLUS
    if (canvas._canvasId) {
      // data: URI 优先直传 getImageInfo（部分平台支持，省一次磁盘 IO）；失败再走临时文件
      if (/^data:image/i.test(normalizedSrc)) {
        const fallback = () => resolve({ src: normalizedSrc, width: 0, height: 0, path: normalizedSrc });
        const done = (w, h) => resolve({ src: normalizedSrc, width: w, height: h, path: normalizedSrc });
        uni.getImageInfo({
          src: normalizedSrc,
          success: (res) => done(res.width, res.height),
          fail: () => {
            if (typeof uni.getFileSystemManager !== "function") return fallback();
            const fileSystem = uni.getFileSystemManager();
            if (!fileSystem) return fallback();
            const base64 = normalizedSrc.replace(/^data:image\/\w+;base64,/, "");
            const tmp = `_doc/uniapp_temp_poster_${Date.now()}.png`;
            fileSystem.writeFile({
              filePath: tmp, data: base64, encoding: "base64",
              success: () => uni.getImageInfo({ src: tmp, success: (res) => done(res.width, res.height), fail: fallback }),
              fail: fallback,
            });
          },
        });
        return;
      }
      uni.getImageInfo({
        src: normalizedSrc,
        success: (res) => {
          const img = {
            src: normalizedSrc,
            width: res.width,
            height: res.height,
            path: res.path || normalizedSrc,
          };
          resolve(img);
        },
        fail: (err) => {
          console.error("[PosterEngine] 图片加载失败:", err);
          reject(new Error(`图片加载失败: ${err}`));
        },
      });
      return;
    }
    // #endif

    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = (e) => {
      console.error("[PosterEngine] 图片加载失败:", e);
      reject(new Error(`图片加载失败: ${e}`));
    };
    img.src = normalizedSrc;
  });
}

// ─────────────────────────────────────────────
// PosterEngine 核心类
// ─────────────────────────────────────────────

export class PosterEngine {
  constructor({ canvas, schema, data = {}, dpr, exportOptions = {} }) {
    if (!canvas) throw new Error("[PosterEngine] canvas 节点不能为空");
    if (!schema) throw new Error("[PosterEngine] schema 不能为空");

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.schema = schema;
    this.data = data;
    this.dpr = dpr || uni.getSystemInfoSync().pixelRatio || 2;
    // 公共属性：默认导出格式，允许外部读取
    const { fileType = "png", quality = 1 } = exportOptions || {};
    this.exportOptions = { fileType, quality };
    this._imgCache = new Map();
    this._tplCache = new Map();
    this._splitCache = new Map();
    this._destroyed = false;
    this._logicalWidth = schema.width || 0;
    this._logicalHeight = schema.height || 0;
  }

  // ─────────────────────────────────────────────
  // 公共 API
  // ─────────────────────────────────────────────

  async render() {
    this._checkDestroyed();
    this._tplCache.clear();
    this._splitCache.clear();

    const { width, height, backgroundImage, borderRadius, views = [] } = this.schema;
    const background = this.schema.background || this.schema.backgroundColor;
    const dpr = this.dpr;

    this._logicalWidth = width;
    this._logicalHeight = height;

    // #ifdef MP-WEIXIN
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    // #endif

    // #ifdef APP-PLUS
    this.canvas.width = width;
    this.canvas.height = height;
    // #endif

    const ctx = this.ctx;

    // #ifdef MP-WEIXIN
    ctx.scale(dpr, dpr);
    // #endif

    ctx.save();

    if (borderRadius) {
      roundRectPath(ctx, 0, 0, width, height, borderRadius);
      ctx.clip();
    }

    if (backgroundImage) {
      const resolvedBg = this._resolveTemplate(backgroundImage);
      if (resolvedBg) {
        try {
          const img = await this._loadImageCached(resolvedBg);
          const imgSrc = this._getImageSrc(img);
          ctx.drawImage(imgSrc, 0, 0, width, height);
        } catch (e) {
          console.warn("[PosterEngine] 背景图加载失败，使用背景色", e);
          this._fillBackground(background, width, height);
        }
      }
    } else if (background) {
      this._fillBackground(background, width, height);
    }

    await this._preloadAllImages(views);

    for (const node of views) {
      await this._drawNode(node, 0, 0);
    }

    ctx.restore();

    // #ifdef APP-PLUS
    if (this.canvas._canvasId) {
      ctx.draw();
    }
    // #endif
  }

  toTempFilePath(options = {}) {
    this._checkDestroyed();

    // 合并：实例级 exportOptions 默认值 + 调用时 options 覆盖
    const { fileType = this.exportOptions.fileType, quality = this.exportOptions.quality } = options;
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const dpr = this.dpr;

    return new Promise((resolve, reject) => {
      const canvasOptions = {
        fileType,
        quality,
        success: ({ tempFilePath }) => {
          resolve(tempFilePath);
        },
        fail: (err) => {
          reject(err);
        },
      };

      // #ifdef APP-PLUS
      if (this.canvas._canvasId) {
        canvasOptions.canvasId = this.canvas._canvasId;
        if (this.canvas._vm) {
          canvasOptions._this = this.canvas._vm;
        }
        canvasOptions.x = 0;
        canvasOptions.y = 0;
        canvasOptions.width = canvasWidth;
        canvasOptions.height = canvasHeight;
        canvasOptions.destWidth = Math.floor(canvasWidth * dpr);
        canvasOptions.destHeight = Math.floor(canvasHeight * dpr);
      } else {
        // #endif
        canvasOptions.canvas = this.canvas;
        canvasOptions.x = 0;
        canvasOptions.y = 0;
        canvasOptions.width = canvasWidth;
        canvasOptions.height = canvasHeight;
        canvasOptions.destWidth = canvasWidth;
        canvasOptions.destHeight = canvasHeight;
        // #ifdef APP-PLUS
      }
      // #endif

      uni.canvasToTempFilePath(canvasOptions);
    });
  }

  async saveToAlbum(options = {}) {
    this._checkDestroyed();

    const tempPath = await this.toTempFilePath(options);
    return new Promise((resolve, reject) => {
      uni.saveImageToPhotosAlbum({
        filePath: tempPath,
        success: () => resolve(tempPath),
        fail: (err) => {
          if (err.errMsg && err.errMsg.includes("auth deny")) {
            uni.showModal({
              title: "需要相册权限",
              content: "请在设置中开启相册访问权限",
              showCancel: false,
            });
          }
          reject(err);
        },
      });
    });
  }

  destroy() {
    this._imgCache.clear();
    this._tplCache.clear();
    this.canvas = null;
    this.ctx = null;
    this.schema = null;
    this.data = null;
    this._destroyed = true;
  }

  _checkDestroyed() {
    if (this._destroyed) {
      throw new Error("[PosterEngine] 引擎已销毁，请重新创建实例");
    }
  }

  // ─────────────────────────────────────────────
  // 私有方法：绘制节点
  // ─────────────────────────────────────────────

  async _drawNode(node, offsetX = 0, offsetY = 0, parentWidth = null, parentHeight = null) {
    const { type } = node;
    const css = node.css || {};

    let resolvedWidth;
    if (css.width != null) {
      resolvedWidth = css.width;
    } else if (parentWidth != null && parentWidth >= 0) {
      resolvedWidth = parentWidth;
    } else if (parentWidth === null) {
      resolvedWidth = this._logicalWidth;
    } else {
      resolvedWidth = 0;
    }

    const refWidth = parentWidth != null ? parentWidth : this._logicalWidth;
    const refHeight = parentHeight != null ? parentHeight : this._logicalHeight;

    const savedLeft = css.left;
    const savedTop = css.top;
    const savedWidth = css.width;
    const savedHeight = css.height;

    if (type === "text" && css.height == null) {
      css.height = this._resolveTextHeight(node, resolvedWidth);
    }

    if (type === "image" && css.height == null && css.objectFit === "widthFix") {
      const resolvedSrc = this._resolveTemplate(node.src);
      if (resolvedSrc) {
        try {
          const img = await this._loadImageCached(resolvedSrc);
          css.height = Math.ceil((img.height / img.width) * resolvedWidth);
        } catch (e) { }
      }
    }

    if (type === "image" && css.width == null && css.objectFit === "heightFix") {
      const resolvedSrc = this._resolveTemplate(node.src);
      if (resolvedSrc) {
        try {
          const img = await this._loadImageCached(resolvedSrc);
          css.width = Math.ceil((img.width / img.height) * (css.height || 0));
          resolvedWidth = css.width;
        } catch (e) { }
      }
    }

    const resolvedHeight = css.height ?? 0;

    let x, y;
    if (css.right != null && css.right >= 0) {
      x = offsetX + refWidth - css.right - resolvedWidth;
    } else {
      x = (css.left ?? 0) + offsetX;
    }
    if (css.bottom != null && css.bottom >= 0) {
      y = offsetY + refHeight - css.bottom - resolvedHeight;
    } else {
      y = (css.top ?? 0) + offsetY;
    }

    css.left = x;
    css.top = y;
    css.width = resolvedWidth;

    const ctx = this.ctx;
    ctx.save();

    if (css.opacity != null && css.opacity !== 1) {
      ctx.globalAlpha = css.opacity;
    }

    const br = css.borderRadius;
    if (br) {
      roundRectPath(ctx, x, y, resolvedWidth || 0, resolvedHeight, br);
      ctx.clip();
    }

    switch (type) {
      case "view":
        await this._drawView(node);
        break;
      case "image":
        await this._drawImage(node);
        break;
      case "text":
        this._drawText(node, savedWidth);
        break;
      case "qrcode":
        await this._drawQRCode(node);
        break;
      case "barcode":
        await this._drawBarcode(node);
        break;
      default:
        console.warn(`[PosterEngine] 未知元素类型: ${type}`);
    }

    ctx.restore();
    css.left = savedLeft;
    css.top = savedTop;
    css.width = savedWidth;
    css.height = savedHeight;
  }

  // ─────────────────────────────────────────────
  // 各类型绘制方法
  // ─────────────────────────────────────────────

  _drawBoxBackground(css) {
    const background = css.background || css.backgroundColor;
    const { left: x, top: y, width: w, height: h } = css;
    const hasBg = !!background;
    const hasBorder = !!(css.borderWidth && css.borderColor);
    if (!hasBg && !hasBorder) return;

    const ctx = this.ctx;
    const br = css.borderRadius;

    let fillStyle = null;
    if (hasBg) {
      if (background.includes("linear-gradient")) {
        fillStyle = parseLinearGradient(ctx, background, x, y, w || 0, h || 0) || background;
      } else {
        fillStyle = background;
      }
    }

    if (br) {
      roundRectPath(ctx, x, y, w || 0, h || 0, br);
      if (hasBg) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      if (hasBorder) {
        ctx.strokeStyle = css.borderColor;
        ctx.lineWidth = css.borderWidth;
        ctx.stroke();
      }
    } else {
      if (hasBg) {
        ctx.fillStyle = fillStyle;
        ctx.fillRect(x, y, w || 0, h || 0);
      }
      if (hasBorder) {
        ctx.strokeStyle = css.borderColor;
        ctx.lineWidth = css.borderWidth;
        ctx.strokeRect(x, y, w || 0, h || 0);
      }
    }
  }

  async _drawImage(node) {
    const { src, css } = node;
    const resolvedSrc = this._resolveTemplate(src);
    if (!resolvedSrc || resolvedSrc === "") return;

    const { left: x, top: y, width: w, height: h } = css;
    const objectFit = css.objectFit || "fill";

    try {
      const img = await this._loadImageCached(resolvedSrc);
      const ctx = this.ctx;
      const imgSrc = this._getImageSrc(img);
      const hasSize = img.width > 0 && img.height > 0;

      if (hasSize && objectFit === "cover") {
        const { sx, sy, sw, sh, dx, dy, dw, dh } = calcCover(img.width, img.height, x, y, w, h);
        ctx.drawImage(imgSrc, sx, sy, sw, sh, dx, dy, dw, dh);
      } else if (hasSize && objectFit === "contain") {
        const scale = Math.min(w / img.width, h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = x + (w - dw) / 2;
        const dy = y + (h - dh) / 2;
        ctx.drawImage(imgSrc, dx, dy, dw, dh);
      } else if (objectFit === "widthFix") {
        const dw = w;
        const dh = (img.height / img.width) * w;
        ctx.drawImage(imgSrc, x, y, dw, dh);
      } else if (objectFit === "heightFix") {
        const dh = h;
        const dw = (img.width / img.height) * h;
        ctx.drawImage(imgSrc, x, y, dw, dh);
      } else {
        ctx.drawImage(imgSrc, x, y, w, h);
      }
    } catch (e) {
      console.error("[PosterEngine] 图片绘制失败", e);
    }
  }

  _splitTextLines(node, availableWidth, userWidth) {
    if (this._splitCache.has(node)) return this._splitCache.get(node);
    const { text, css } = node;
    const resolvedText = this._resolveTemplate(String(text ?? ""));

    const ctx = this.ctx;
    const lines = css.lines || 0;
    const ellipsis = css.ellipsis || false;

    this._setFont(css);

    const elemMaxWidth = css.maxWidth;
    const textWidth = userWidth || elemMaxWidth || availableWidth || 0;

    const textLines = resolvedText.split("\n");
    const allLines = [];

    if (!textWidth) {
      textLines.forEach((line) => allLines.push(line));
    } else {
      textLines.forEach((segment) => {
        if (segment === "") {
          allLines.push("");
          return;
        }
        let currentLine = "";
        for (let i = 0; i < segment.length;) {
          const remaining = segment.substring(i);
          const fitLen = binarySearchSplit(ctx, remaining, textWidth);
          if (fitLen === 0) {
            if (currentLine) {
              allLines.push(currentLine);
              currentLine = "";
            }
            allLines.push(segment[i]);
            i++;
          } else if (fitLen >= remaining.length) {
            currentLine += remaining;
            i = segment.length;
          } else {
            allLines.push(currentLine + remaining.substring(0, fitLen));
            currentLine = "";
            i += fitLen;
          }
        }
        if (currentLine) allLines.push(currentLine);
      });
    }

    let renderLines = allLines;
    if (ellipsis && textWidth) {
      // 单行省略号优先级高于多行截断
      const singleLine = allLines.join("");
      renderLines = ctx.measureText(singleLine).width > textWidth
        ? [binarySearchTruncate(ctx, singleLine, textWidth) + "..."]
        : [singleLine];
    } else if (lines > 0 && allLines.length > lines) {
      renderLines = allLines.slice(0, lines);
      const lastLine = renderLines[renderLines.length - 1];
      renderLines[renderLines.length - 1] = binarySearchTruncate(ctx, lastLine, textWidth) + "...";
    }

    const result = { renderLines, textWidth, resolvedText };
    this._splitCache.set(node, result);
    return result;
  }

  _resolveTextHeight(node, availableWidth) {
    const css = node.css || {};
    if (css.height != null) return css.height;

    const { renderLines } = this._splitTextLines(node, availableWidth, css.width);
    return renderLines.length * this._getLineHeightPx(css);
  }

  _drawText(node, userWidth) {
    const { css } = node;
    const ctx = this.ctx;
    const fontSize = css.fontSize ?? DEFAULT_FONT_SIZE;
    const color = css.color ?? DEFAULT_TEXT_COLOR;
    const textAlign = css.textAlign ?? DEFAULT_TEXT_ALIGN;
    const textDecoration = css.textDecoration ?? DEFAULT_TEXT_DECORATION;

    const { left: x, top: y, width: elemWidth, maxWidth: elemMaxWidth } = css;
    const textWidth = userWidth || elemWidth || elemMaxWidth || this._logicalWidth;

    ctx.textBaseline = "alphabetic";

    const drawX = this._calcTextDrawX(x, textWidth, textAlign, ctx);

    const { renderLines } = this._splitTextLines(node, this._logicalWidth, userWidth);
    const lineHeightPx = this._getLineHeightPx(css);

    this._drawTextBackground(css, x, y, textWidth, renderLines.length * lineHeightPx);

    const { ascent: fontAscent, descent } = this._getFontMetrics(css);
    const halfLeading = (lineHeightPx - fontAscent - descent) / 2;
    // CSS 标准：字形在行盒内距顶 = halfLeading（不因 _crossAlign 而变化）
    const leadingOffset = halfLeading;

    ctx.fillStyle = color;
    renderLines.forEach((line, i) => {
      const baselineY = y + leadingOffset + fontAscent + i * lineHeightPx;
      ctx.fillText(line, drawX, baselineY);

      if (textDecoration === "line-through") {
        this._drawTextLineThrough(line, drawX, baselineY, fontAscent, fontSize, textAlign, color);
      }
    });
  }

  // 根据 textAlign 计算文本绘制起点
  _calcTextDrawX(x, textWidth, textAlign, ctx) {
    if (textAlign === "center") {
      ctx.textAlign = "center";
      return x + (textWidth || 0) / 2;
    }
    if (textAlign === "right") {
      ctx.textAlign = "right";
      return x + (textWidth || 0);
    }
    ctx.textAlign = "left";
    return x;
  }

  // 绘制文字背景（包含 padding 和 borderRadius）
  _drawTextBackground(css, x, y, textWidth, textHeight) {
    const textBgColor = css.background || css.backgroundColor;
    if (!textBgColor) return;

    const ctx = this.ctx;
    const pd = parsePadding(css.padding);
    ctx.fillStyle = textBgColor;
    const w = (textWidth || 0) + pd.left + pd.right;
    const h = textHeight + pd.top + pd.bottom;

    if (css.borderRadius) {
      roundRectPath(ctx, x - pd.left, y - pd.top, w, h, css.borderRadius);
      ctx.fill();
    } else {
      ctx.fillRect(x - pd.left, y - pd.top, w, h);
    }
  }

  // 绘制删除线（line-through）
  _drawTextLineThrough(line, drawX, baselineY, fontAscent, fontSize, textAlign, color) {
    const ctx = this.ctx;
    const lineWidth = ctx.measureText(line).width;
    let lineStartX = drawX;
    if (textAlign === "center") {
      lineStartX = drawX - lineWidth / 2;
    } else if (textAlign === "right") {
      lineStartX = drawX - lineWidth;
    }
    const midY = baselineY - fontAscent / 2;
    ctx.beginPath();
    ctx.moveTo(lineStartX, midY);
    ctx.lineTo(lineStartX + lineWidth, midY);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, fontSize / 16);
    ctx.stroke();
  }

  async _drawView(node) {
    const { css, views: children = [] } = node;
    const { left: x, top: y, width: w, height: h } = css;

    this._drawBoxBackground(css);

    if (!children.length) return;

    const display = css.display;
    if (display === "flex") {
      await this._drawFlexChildren(node);
    } else {
      for (const child of children) {
        await this._drawNode(child, x, y, w, h);
      }
    }
  }

  _setFont(css) {
    const fontSize = css.fontSize ?? DEFAULT_FONT_SIZE;
    const fontWeight = css.fontWeight ?? DEFAULT_FONT_WEIGHT;
    const fontFamily = css.fontFamily ?? DEFAULT_FONT_FAMILY;
    this.ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  }

  // 解析 lineHeight 为像素值：>10 视为 px，否则视为 fontSize 倍数
  _getLineHeightPx(css) {
    const fontSize = css.fontSize ?? DEFAULT_FONT_SIZE;
    const lineHeight = css.lineHeight ?? DEFAULT_LINE_HEIGHT;
    return typeof lineHeight === "number" && lineHeight > LINE_HEIGHT_PX_THRESHOLD
      ? lineHeight
      : fontSize * lineHeight;
  }

  // 一次拿到 ascent/descent，避免每个值单独 measureText
  _getFontMetrics(css) {
    this._setFont(css);
    const ctx = this.ctx;
    const fontSize = css.fontSize ?? DEFAULT_FONT_SIZE;
    const fallback = { ascent: fontSize * FONT_ASCENT_FALLBACK_RATIO, descent: fontSize * FONT_DESCENT_FALLBACK_RATIO };

    try {
      const m1 = ctx.measureText("M");
      if (m1.fontBoundingBoxAscent && m1.fontBoundingBoxDescent) {
        return { ascent: m1.fontBoundingBoxAscent, descent: m1.fontBoundingBoxDescent };
      }
    } catch (e) { }
    try {
      const savedBaseline = ctx.textBaseline;
      ctx.textBaseline = "alphabetic";
      const m2 = ctx.measureText("M\u4E2D");
      ctx.textBaseline = savedBaseline || "alphabetic";
      if (m2.actualBoundingBoxAscent || m2.actualBoundingBoxDescent) {
        return { ascent: m2.actualBoundingBoxAscent || fallback.ascent, descent: m2.actualBoundingBoxDescent || fallback.descent };
      }
    } catch (e) { }
    return fallback;
  }

  // 半行距：lineHeight 与实际字形高度的差值的一半
  _getHalfLeading(css) {
    const { ascent, descent } = this._getFontMetrics(css);
    return (this._getLineHeightPx(css) - ascent - descent) / 2;
  }

  // 文字基线到行盒顶部的距离
  _getTextBaselineOffset(node) {
    if (node.type !== "text") return 0;
    const css = node.css || {};
    const { ascent, descent } = this._getFontMetrics(css);
    return (this._getLineHeightPx(css) - ascent - descent) / 2 + ascent;
  }

  async _drawFlexChildren(node) {
    const { css, views: children = [] } = node;
    const { left: x, top: y, width: w, height: h } = css;
    const flexDirection = css.flexDirection || "row";
    const alignItems = css.alignItems || "flex-start";
    const justifyContent = css.justifyContent || "flex-start";
    const pd = parsePadding(css.padding);

    const innerX = x + pd.left;
    const innerY = y + pd.top;
    const innerW = w - pd.left - pd.right;
    const innerH = h - pd.top - pd.bottom;

    const isRow = flexDirection === "row";

    const childSizes = children.map((child) => {
      const childCss = child.css || {};
      const isText = child.type === "text";
      const halfLeading = isText ? this._getHalfLeading(childCss) : 0;
      return {
        ml: childCss.marginLeft || 0,
        mr: childCss.marginRight || 0,
        mt: childCss.marginTop || 0,
        mb: childCss.marginBottom || 0,
        cw: this._resolveChildWidth(child, innerW),
        ch: this._resolveChildHeight(child, innerW, innerH),
        baselineOffset: isText ? this._getTextBaselineOffset(child) : 0,
        halfLeading,
      };
    });

    let totalFixed = 0;
    childSizes.forEach((s) => {
      if (isRow) {
        totalFixed += s.cw + s.ml + s.mr;
      } else {
        totalFixed += s.ch + s.mt + s.mb;
      }
    });

    const gap =
      justifyContent === "space-between" && children.length > 1
        ? (isRow ? innerW - totalFixed : innerH - totalFixed) / (children.length - 1)
        : justifyContent === "center"
          ? isRow
            ? (innerW - totalFixed) / 2
            : (innerH - totalFixed) / 2
          : 0;

    let cursor = isRow ? innerX : innerY;

    if (justifyContent === "center") {
      cursor += gap;
    }

    const maxBaseline = childSizes.reduce((max, s) => Math.max(max, s.baselineOffset), 0);

    for (let idx = 0; idx < children.length; idx++) {
      const child = children[idx];
      const childCss = child.css || {};
      const s = childSizes[idx];
      const { ml, mr, mt, mb, cw, ch, baselineOffset } = s;

      let cx, cy;

      if (isRow) {
        cx = cursor + ml;
        if (alignItems === "baseline") {
          cy = innerY + mt + (maxBaseline - baselineOffset);
        } else {
          cy = this._calcAlignOffset(alignItems, innerY, innerH, ch, mt, mb);
        }
        cursor = cx + cw + mr;
        if (justifyContent === "space-between") cursor += gap;
      } else {
        cy = cursor + mt;
        if (alignItems === "baseline") {
          cx = innerX + ml + (maxBaseline - (baselineOffset || cw / 2));
        } else {
          cx = this._calcAlignOffset(alignItems, innerX, innerW, cw, ml, mr);
        }
        cursor = cy + ch + mb;
        if (justifyContent === "space-between") cursor += gap;
      }

      const savedLeft = childCss.left;
      const savedTop = childCss.top;
      const savedWidth = childCss.width;
      const savedHeight = childCss.height;
      childCss.left = cx;
      childCss.top = cy;
      childCss.width = cw;
      childCss.height = ch;
      await this._drawNode(child, 0, 0, cw, ch);
      childCss.left = savedLeft;
      childCss.top = savedTop;
      childCss.width = savedWidth;
      childCss.height = savedHeight;
    }
  }

  _resolveChildWidth(child, maxWidth = Infinity) {
    const childCss = child.css || {};
    if (childCss.width != null) {
      return childCss.width;
    }
    if (child.type === "text") {
      return this._calcTextWidth(child, maxWidth);
    }
    return 0;
  }

  _resolveChildHeight(child, availableWidth, availableHeight) {
    const childCss = child.css || {};
    if (childCss.height != null) {
      return childCss.height;
    }
    if (child.type === "text") {
      return this._resolveTextHeight(child, availableWidth);
    }
    return 0;
  }

  _calcTextWidth(node, maxWidth = Infinity) {
    const { text, css } = node;
    const resolvedText = this._resolveTemplate(String(text ?? ""));
    const effectiveMaxWidth = maxWidth != null && !isNaN(maxWidth) ? maxWidth : Infinity;
    const textMaxWidth = css.maxWidth || effectiveMaxWidth;

    this._setFont(css);
    const textWidth = this.ctx.measureText(resolvedText).width;
    return Math.min(Math.ceil(textWidth), textMaxWidth);
  }

  _calcAlignOffset(align, start, size, childSize, marginStart, marginEnd) {
    switch (align) {
      case "center":
        // 子元素中线对齐父盒子中线，margin 不参与居中计算
        return start + (size - childSize) / 2;
      case "flex-end":
        return start + size - childSize - marginEnd;
      default:
        return start + marginStart;
    }
  }

  async _drawQRCode(node) {
    const qrText = node.text ?? node.src ?? "";
    const resolvedText = this._resolveTemplate(qrText);
    if (resolvedText == null || resolvedText === "") return;

    const { css } = node;
    const { left: x, top: y, width: w, height: h } = css;
    const bgColor = css.background || css.backgroundColor || "#FFFFFF";
    const qrColor = css.color || "#000000";

    try {
      const matrix = generateQRMatrix(resolvedText);
      const moduleCount = matrix.length;
      const margin = 2;
      const totalModules = moduleCount + margin * 2;
      const moduleSize = w / totalModules;

      const ctx = this.ctx;

      ctx.fillStyle = bgColor;
      ctx.fillRect(x, y, w, h);

      ctx.fillStyle = qrColor;
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          if (matrix[r][c] === 1) {
            ctx.fillRect(x + (c + margin) * moduleSize, y + (r + margin) * moduleSize, moduleSize, moduleSize);
          }
        }
      }
    } catch (e) {
      console.error("[PosterEngine] 二维码生成失败", e);
    }
  }

  async _drawBarcode(node) {
    const rawText = node.text ?? node.src ?? "";
    const resolvedText = this._resolveTemplate(rawText);
    if (resolvedText == null || resolvedText === "") return;

    const { css } = node;
    const { left: x, top: y, width: w, height: h } = css;
    const format = (node.format || "EAN13").toString().toUpperCase();
    const bgColor = css.background || css.backgroundColor || "#FFFFFF";
    const barColor = css.color || "#000000";
    // showText：EAN13 默认 true，Code-128 默认 false
    const showText = css.showText != null ? !!css.showText : format === "EAN13";
    const textColor = css.textColor || barColor;
    // 文本区域高度：默认 18；css.textSize 可覆盖
    const textSize = css.textSize ?? 18;
    const textMargin = css.textMargin ?? 4;

    try {
      const result = generateBarcodeMatrix({ format, text: resolvedText });
      const bits = result.bits[0];
      const moduleCount = bits.length;

      // 文本占用底部高度
      const textAreaH = showText ? textSize + textMargin * 2 : 0;
      const barAreaH = h - textAreaH;
      if (barAreaH <= 0 || w <= 0) return;

      // 计算每个 module 像素宽（保留完整比例）
      const moduleW = w / moduleCount;
      const ctx = this.ctx;

      // 背景
      ctx.fillStyle = bgColor;
      ctx.fillRect(x, y, w, h);

      // 条码
      ctx.fillStyle = barColor;
      for (let i = 0; i < moduleCount; i++) {
        if (bits[i] === 1) {
          ctx.fillRect(
            Math.floor(x + i * moduleW),
            Math.floor(y),
            Math.ceil(moduleW),
            Math.floor(barAreaH),
          );
        }
      }

      // 文本（EAN-13 显示完整 13 位；Code-128 显示原文）
      if (showText) {
        ctx.save();
        ctx.fillStyle = textColor;
        ctx.font = `${textSize}px sans-serif`;
        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        ctx.fillText(result.humanReadable, x + w / 2, y + barAreaH + textMargin);
        ctx.restore();
      }
    } catch (e) {
      console.error("[PosterEngine] 条码生成失败", e);
    }
  }

  // ─────────────────────────────────────────────
  // 私有工具
  // ─────────────────────────────────────────────

  _getImageSrc(img) {
    // #ifdef APP-PLUS
    return img.path || img;
    // #endif
    // #ifdef MP-WEIXIN
    return img;
    // #endif
  }

  async _loadImageCached(src) {
    if (this._imgCache.has(src)) {
      return this._imgCache.get(src);
    }
    const img = await loadImage(this.canvas, src);

    if (this._imgCache.size >= MAX_IMAGE_CACHE_SIZE) {
      const firstKey = this._imgCache.keys().next().value;
      this._imgCache.delete(firstKey);
    }

    this._imgCache.set(src, img);
    return img;
  }

  async _preloadAllImages(views) {
    const promises = [];
    const collect = (nodes) => {
      for (const node of nodes) {
        if (node.type === "image" && node.src) {
          const src = this._resolveTemplate(node.src);
          if (src && !this._imgCache.has(src)) {
            promises.push(
              this._loadImageCached(src).catch((e) => {
                console.warn("[PosterEngine] 图片预加载失败:", e);
              }),
            );
          }
        }
        if (node.views && node.views.length) {
          collect(node.views);
        }
      }
    };

    collect(views);

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  _resolveTemplate(str) {
    if (typeof str !== "string") return str;
    const cached = this._tplCache.get(str);
    if (cached !== undefined) return cached;
    const result = str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = this.data[key];
      return val != null ? String(val) : `{{${key}}}`;
    });
    this._tplCache.set(str, result);
    return result;
  }

  _fillBackground(color, width, height) {
    const ctx = this.ctx;
    if (color && color.includes("linear-gradient")) {
      const grad = parseLinearGradient(ctx, color, 0, 0, width, height);
      ctx.fillStyle = grad || "#FFFFFF";
    } else {
      ctx.fillStyle = color;
    }
    ctx.fillRect(0, 0, width, height);
  }
}
