/**
 * PosterEngine - 统一海报绘制引擎
 * 版本：v0.0.1
 * 支持平台：微信小程序 / APP
 * 说明：基于 Canvas 2D API，通过声明式 JSON Schema 驱动绘制，双端一致。
 */

import { generateQRMatrix } from "./qrcodeGenerator.js";

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────
const MAX_IMAGE_CACHE_SIZE = 50;

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

const LINEAR_GRADIENT_RE = /linear-gradient\(\s*(\d+)deg\s*,\s*(.+)\)/i;
const TEMPLATE_RE = /\{\{(\w+)\}\}/g;

function normalizeImageSrc(src) {
  return src || "";
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
  if (ctx.measureText(text).width + ctx.measureText(suffix).width <= maxWidth) return text;
  const suffixWidth = ctx.measureText(suffix).width;
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
  if (typeof padding === "number")
    return { top: padding, right: padding, bottom: padding, left: padding };
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
  const [lt, rt, rb, lb] = parseBorderRadius(radius);
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
  const halfLen =
    (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
  const x0 = cx - Math.cos(rad) * halfLen;
  const y0 = cy - Math.sin(rad) * halfLen;
  const x1 = cx + Math.cos(rad) * halfLen;
  const y1 = cy + Math.sin(rad) * halfLen;

  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  const stops = m[2].split(",").map((s) => s.trim());
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
      if (/^data:image/i.test(normalizedSrc)) {
        const img = {
          src: normalizedSrc,
          width: 200,
          height: 200,
          path: normalizedSrc,
        };
        resolve(img);
        return;
      }

      if (/^_doc\/uniapp_temp_/i.test(normalizedSrc)) {
        // 临时文件路径，尝试加载
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
            console.error("[PosterEngine] 临时文件加载失败:", err);
            reject(new Error(`图片加载失败: ${err}`));
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
  constructor({ canvas, schema, data = {}, dpr }) {
    if (!canvas) throw new Error("[PosterEngine] canvas 节点不能为空");
    if (!schema) throw new Error("[PosterEngine] schema 不能为空");

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.schema = schema;
    this.data = data;
    this.dpr = dpr || uni.getSystemInfoSync().pixelRatio || 2;
    this._imgCache = new Map();
    this._tplCache = new Map();
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

    const {
      width,
      height,
      backgroundImage,
      borderRadius,
      views = [],
    } = this.schema;
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

    const { fileType = "png", quality = 1 } = options;
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

  async saveToAlbum() {
    this._checkDestroyed();

    const tempPath = await this.toTempFilePath();
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

  async _drawNode(
    node,
    offsetX = 0,
    offsetY = 0,
    parentWidth = null,
    parentHeight = null,
  ) {
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

    let x, y;
    if (css.right != null && css.right >= 0) {
      x = offsetX + refWidth - css.right - resolvedWidth;
    } else {
      x = (css.left || 0) + offsetX;
    }
    if (css.bottom != null && css.bottom >= 0) {
      y = offsetY + refHeight - css.bottom - (css.height || 0);
    } else {
      y = (css.top || 0) + offsetY;
    }

    const savedLeft = css.left;
    const savedTop = css.top;
    const savedWidth = css.width;
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
      roundRectPath(ctx, x, y, resolvedWidth || 0, css.height || 0, br);
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
        this._drawText(node);
        break;
      case "qrcode":
        await this._drawQRCode(node);
        break;
      default:
        console.warn(`[PosterEngine] 未知元素类型: ${type}`);
    }

    ctx.restore();
    css.left = savedLeft;
    css.top = savedTop;
    css.width = savedWidth;
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
        fillStyle =
          parseLinearGradient(ctx, background, x, y, w || 0, h || 0) ||
          background;
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
    if (!resolvedSrc) return;

    const { left: x, top: y, width: w, height: h } = css;
    const objectFit = css.objectFit || "fill";

    try {
      const img = await this._loadImageCached(resolvedSrc);
      const ctx = this.ctx;
      const imgSrc = this._getImageSrc(img);

      if (objectFit === "cover") {
        const { sx, sy, sw, sh, dx, dy, dw, dh } = calcCover(
          img.width,
          img.height,
          x,
          y,
          w,
          h,
        );
        ctx.drawImage(imgSrc, sx, sy, sw, sh, dx, dy, dw, dh);
      } else if (objectFit === "contain") {
        const scale = Math.min(w / img.width, h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = x + (w - dw) / 2;
        const dy = y + (h - dh) / 2;
        ctx.drawImage(imgSrc, dx, dy, dw, dh);
      } else {
        ctx.drawImage(imgSrc, x, y, w, h);
      }
    } catch (e) {
      console.error("[PosterEngine] 图片绘制失败", e);
    }
  }

  _drawText(node) {
    const { text, css } = node;
    const resolvedText = this._resolveTemplate(String(text || ""));

    const ctx = this.ctx;
    const fontSize = css.fontSize || 14;
    const fontWeight = css.fontWeight || "normal";
    const fontFamily = css.fontFamily || "sans-serif";
    const color = css.color || "#000000";
    const textAlign = css.textAlign || "left";
    const lineHeight = css.lineHeight || 1.4;
    const lines = css.lines || 0;
    const ellipsis = css.ellipsis || false;
    const textDecoration = css.textDecoration || "";
    const textBgColor = css.background || css.backgroundColor;

    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = "top";

    const { left: x, top: y, width: elemWidth, maxWidth: elemMaxWidth } = css;
    const textWidth = elemWidth || elemMaxWidth || this._logicalWidth;

    let drawX = x;
    if (textAlign === "center") {
      drawX = x + (textWidth || 0) / 2;
      ctx.textAlign = "center";
    } else if (textAlign === "right") {
      drawX = x + (textWidth || 0);
      ctx.textAlign = "right";
    } else {
      ctx.textAlign = "left";
    }

    const lineHeightPx =
      typeof lineHeight === "number" && lineHeight > 10
        ? lineHeight
        : fontSize * lineHeight;

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
        for (let i = 0; i < segment.length; ) {
          const remaining = segment.substring(i);
          const fitLen = binarySearchSplit(ctx, remaining, textWidth);
          if (fitLen === 0) {
            if (currentLine) allLines.push(currentLine);
            currentLine = segment[i];
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
    if (lines > 0 && allLines.length > lines) {
      renderLines = allLines.slice(0, lines);
      const lastLine = renderLines[renderLines.length - 1];
      renderLines[renderLines.length - 1] = binarySearchTruncate(ctx, lastLine, textWidth) + "...";
    }

    if (ellipsis && textWidth) {
      const singleLine = allLines.join("");
      if (ctx.measureText(singleLine).width > textWidth) {
        renderLines = [binarySearchTruncate(ctx, singleLine, textWidth) + "..."];
      } else {
        renderLines = [singleLine];
      }
    }

    if (textBgColor) {
      const pd = parsePadding(css.padding);
      ctx.fillStyle = textBgColor;
      const bgX = x;
      const bgY = y;
      const bgW = textWidth || 0;
      const bgH = renderLines.length * lineHeightPx;
      if (css.borderRadius) {
        roundRectPath(
          ctx,
          bgX - pd.left,
          bgY - pd.top,
          bgW + pd.left + pd.right,
          bgH + pd.top + pd.bottom,
          css.borderRadius,
        );
        ctx.fill();
      } else {
        ctx.fillRect(
          bgX - pd.left,
          bgY - pd.top,
          bgW + pd.left + pd.right,
          bgH + pd.top + pd.bottom,
        );
      }
    }

    ctx.fillStyle = color;
    renderLines.forEach((line, i) => {
      const lineY = y + i * lineHeightPx;
      ctx.fillText(line, drawX, lineY);

      if (textDecoration === "line-through") {
        const lineWidth = ctx.measureText(line).width;
        let lineStartX = drawX;
        if (textAlign === "center") {
          lineStartX = drawX - lineWidth / 2;
        } else if (textAlign === "right") {
          lineStartX = drawX - lineWidth;
        }
        const midY = lineY + fontSize / 2;
        ctx.beginPath();
        ctx.moveTo(lineStartX, midY);
        ctx.lineTo(lineStartX + lineWidth, midY);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, fontSize / 16);
        ctx.stroke();
      }
    });
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

    let totalFixed = 0;
    children.forEach((child) => {
      const childCss = child.css || {};
      const ml = childCss.marginLeft || 0;
      const mr = childCss.marginRight || 0;
      const mt = childCss.marginTop || 0;
      const mb = childCss.marginBottom || 0;
      const childWidth = this._resolveChildWidth(child, innerW);
      if (isRow) {
        totalFixed += childWidth + ml + mr;
      } else {
        totalFixed += (childCss.height || 0) + mt + mb;
      }
    });

    const gap =
      justifyContent === "space-between" && children.length > 1
        ? (isRow ? innerW - totalFixed : innerH - totalFixed) /
          (children.length - 1)
        : justifyContent === "center"
          ? isRow
            ? (innerW - totalFixed) / 2
            : (innerH - totalFixed) / 2
          : 0;

    let cursor = isRow ? innerX : innerY;

    if (justifyContent === "center") {
      cursor += gap;
    }

    for (const child of children) {
      const childCss = child.css || {};
      const ml = childCss.marginLeft || 0;
      const mr = childCss.marginRight || 0;
      const mt = childCss.marginTop || 0;
      const mb = childCss.marginBottom || 0;
      const cw = this._resolveChildWidth(child, innerW);
      const ch = childCss.height || 0;

      let cx, cy;

      if (isRow) {
        cx = cursor + ml;
        cy = this._calcAlignOffset(alignItems, innerY, innerH, ch, mt, mb);
        cursor = cx + cw + mr;
        if (justifyContent === "space-between") cursor += gap;
      } else {
        cy = cursor + mt;
        cx = this._calcAlignOffset(alignItems, innerX, innerW, cw, ml, mr);
        cursor = cy + ch + mb;
        if (justifyContent === "space-between") cursor += gap;
      }

      const savedLeft = childCss.left;
      const savedTop = childCss.top;
      const savedWidth = childCss.width;
      childCss.left = cx;
      childCss.top = cy;
      childCss.width = cw;
      await this._drawNode(child, 0, 0, cw, ch);
      childCss.left = savedLeft;
      childCss.top = savedTop;
      childCss.width = savedWidth;
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

  _calcTextWidth(node, maxWidth = Infinity) {
    const { text, css } = node;
    const resolvedText = this._resolveTemplate(String(text || ""));
    const ctx = this.ctx;
    const fontSize = css.fontSize || 14;
    const fontWeight = css.fontWeight || "normal";
    const fontFamily = css.fontFamily || "sans-serif";
    const effectiveMaxWidth =
      maxWidth != null && !isNaN(maxWidth) ? maxWidth : Infinity;
    const textMaxWidth = css.maxWidth || effectiveMaxWidth;

    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    const textWidth = ctx.measureText(resolvedText).width;
    return Math.min(textWidth, textMaxWidth);
  }

  _calcAlignOffset(align, start, size, childSize, marginStart, marginEnd) {
    switch (align) {
      case "center":
        return start + (size - childSize) / 2;
      case "flex-end":
        return start + size - childSize - marginEnd;
      default:
        return start + marginStart;
    }
  }

  async _drawQRCode(node) {
    const qrText = node.text || node.src || "";
    const resolvedText = this._resolveTemplate(qrText);
    if (!resolvedText) return;

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
            ctx.fillRect(
              x + (c + margin) * moduleSize,
              y + (r + margin) * moduleSize,
              moduleSize,
              moduleSize,
            );
          }
        }
      }
    } catch (e) {
      console.error("[PosterEngine] 二维码生成失败", e);
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
    const result = str.replace(TEMPLATE_RE, (_, key) => {
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
