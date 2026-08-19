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

    // #ifdef H5
    const img = new Image();
    // 跨域图片需服务端允许 CORS，否则 canvas 被污染、toDataURL 导出会抛安全错误
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => {
      console.error("[PosterEngine] 图片加载失败:", e);
      reject(new Error(`图片加载失败: ${e}`));
    };
    img.src = normalizedSrc;
    // #endif

    // #ifndef H5
    // #ifndef APP-PLUS
    const img = canvas.createImage();
    img.onload = () => {
      // 抖音/支付宝等平台 canvas.createImage() 的 onload 回调中
      // img.width / img.height 可能未设置（仍为 0），导致：
      //  1. hasSize=false → cover/contain/widthFix/heightFix 全部退化为 fill
      //  2. widthFix/heightFix 算高/宽时 0/0=NaN → drawImage 静默丢弃
      // 兜底：用 uni.getImageInfo 补齐自然尺寸（仍以 img 本身作为 drawImage 入参）
      if (img.width > 0 && img.height > 0) {
        resolve(img);
        return;
      }
      // #ifdef MP-TOUTIAO
      console.error(
        `[TT-DIAG] loadImage: onload 后 width/height 为 ${img.width}x${img.height}，` +
          `触发 getImageInfo 兜底: ${normalizedSrc.substring(0, 60)}`,
      );
      // #endif
      uni.getImageInfo({
        src: normalizedSrc,
        success: (res) => {
          // width/height 可能是只读 getter，赋值失败时静默降级（引擎走 fill 兜底）
          try {
            if (img.width <= 0) img.width = res.width;
            if (img.height <= 0) img.height = res.height;
          } catch (e) { }
          resolve(img);
        },
        fail: () => {
          // 拿不到尺寸也 resolve：hasSize=false 时引擎走 fill 兜底，至少能画出图
          resolve(img);
        },
      });
    };
    img.onerror = (e) => {
      console.error("[PosterEngine] 图片加载失败:", e);
      reject(new Error(`图片加载失败: ${e}`));
    };
    img.src = normalizedSrc;
    // #endif
    // #endif
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
    // #ifdef H5
    // H5 端强制 dpr=1：buffer 直接等于 CSS 逻辑尺寸，导出图尺寸与屏幕所见 1:1，
    // 避免高 dpr 屏下 buffer 物理像素被 ×dpr 放大，造成“buffer 比窗口大”的误判。
    this.dpr = 1;
    // #endif
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

  /**
   * 执行 Canvas 渲染
   * @description 按顺序绘制 schema 中的所有视图节点，支持背景图/圆角/条件编译
   * @returns {Promise<void>} 渲染完成后 resolve
   */
  async render() {
    this._checkDestroyed();
    this._tplCache.clear();
    this._splitCache.clear();

    const { width, height, backgroundImage, borderRadius, views = [] } = this.schema;
    const background = this.schema.background || this.schema.backgroundColor;
    const dpr = this.dpr;

    this._logicalWidth = width;
    this._logicalHeight = height;

    // #ifdef MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    // #endif

    // #ifdef MP-TOUTIAO
    // 抖音端诊断：定位图片位置错乱问题（schema 逻辑尺寸 / buffer / dpr / rpx 基准）
    console.error(
      `[TT-DIAG] render: schema=${width}x${height} ` +
        `buffer=${this.canvas.width}x${this.canvas.height} ` +
        `dpr=${dpr} windowWidth=${uni.getSystemInfoSync().windowWidth}`,
    );
    // #endif

    // #ifdef H5
    // H5：以画布“实际显示尺寸”为基准，彻底摆脱 getWindowWidth / rpx 基准不一致导致的放大溢出。
    // 内层真 <canvas> 在取节点时已补 width:100%;height:100%；若 rect 取到 0，则回退测量父容器尺寸。
    const _rect = this.canvas.getBoundingClientRect();
    let _displayW = _rect.width;
    let _displayH = _rect.height;
    if (!_displayW || !_displayH) {
      const _pr = this.canvas.parentElement && this.canvas.parentElement.getBoundingClientRect();
      if (_pr) {
        _displayW = _displayW || _pr.width;
        _displayH = _displayH || _pr.height;
      }
    }
    _displayW = _displayW || width;
    _displayH = _displayH || height;
    this.canvas.width = Math.round(_displayW * dpr);
    this.canvas.height = Math.round(_displayH * dpr);
    // #ifdef H5
    const _renderCs = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(this.canvas) : null;
    const _renderParent = this.canvas.parentElement;
    const _renderParentCs = _renderParent && typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(_renderParent) : null;
    console.error("[POSTER-DIAG] 3.render:", {
      dpr,
      logicalW: width,
      logicalH: height,
      displayW: Math.round(_displayW),
      displayH: Math.round(_displayH),
      bufferW: this.canvas.width,
      bufferH: this.canvas.height,
      fit: width > 0 ? +(_displayW / width).toFixed(4) : 1,
      innerWidth: typeof window !== "undefined" ? window.innerWidth : null,
      innerHeight: typeof window !== "undefined" ? window.innerHeight : null,
      canvasClient: `${this.canvas.clientWidth},${this.canvas.clientHeight}`,
      canvasOffset: `${this.canvas.offsetWidth},${this.canvas.offsetHeight}`,
      canvasScroll: `${this.canvas.scrollWidth},${this.canvas.scrollHeight}`,
      canvasComputed: _renderCs
        ? { w: _renderCs.width, h: _renderCs.height, maxH: _renderCs.maxHeight, maxW: _renderCs.maxWidth, disp: _renderCs.display }
        : null,
      parentClient: _renderParent ? `${_renderParent.clientWidth},${_renderParent.clientHeight}` : null,
      parentComputed: _renderParentCs
        ? { w: _renderParentCs.width, h: _renderParentCs.height, maxH: _renderParentCs.maxHeight, disp: _renderParentCs.display }
        : null,
    });
    // #endif
    // #endif

    // #ifdef APP-PLUS
    this.canvas.width = width;
    this.canvas.height = height;
    // #endif

    const ctx = this.ctx;

    ctx.save();

    // #ifdef MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY
    ctx.scale(dpr, dpr);
    // #endif

    // #ifdef H5
    // 把逻辑坐标系（width×height）等比缩放到实际显示尺寸，海报始终铺满卡片（任意 dpr / rpx 基准都正确）
    console.error(`[POSTER-DIAG] 3.render-scale-before: canvas.attrs=${this.canvas.width}x${this.canvas.height} canvas.css=${this.canvas.clientWidth}x${this.canvas.clientHeight}`);
    const _fit = width > 0 ? _displayW / width : 1;
    ctx.scale(dpr * _fit, dpr * _fit);
    this._renderScale = dpr * _fit; // 1 逻辑px = 多少设备px（供逐节点绘制日志使用）
    console.error(`[POSTER-DIAG] 3.render-scale-after: ctx.canvas.attrs=${ctx.canvas.width}x${ctx.canvas.height}`);
    // #endif

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

    // #ifdef H5
    this._drawLog = true;
    this._drawLogIdx = 1;
    this._overflowNodes = [];
    // #endif

    for (const node of views) {
      await this._drawNode(node, 0, 0);
    }

    // #ifdef H5
    // 绘制完毕汇总：直接告诉用户“有没有溢出、是哪几个节点”，避免肉眼误判。
    if (this._drawLog) {
      console.error(
        `[POSTER-DRAW-SUMMARY] total=${this._drawLogIdx - 1} ` +
          `overflowCount=${this._overflowNodes.length} ` +
          `overflowIndices=${JSON.stringify(this._overflowNodes)} ` +
          `canvas=${this._logicalWidth}x${this._logicalHeight} ` +
          `buffer=${this.canvas.width}x${this.canvas.height}`
      );
    }
    // #endif

    // #ifdef H5
    console.error(`[POSTER-DIAG] 3.render-done: canvas.attrs=${this.canvas.width}x${this.canvas.height} canvas.css=${this.canvas.clientWidth}x${this.canvas.clientHeight}`);
    // 延迟检查：500ms 后再读一次 canvas.width/height，确认是否被 uni-app 异步重置
    const _checkCanvas = this.canvas;
    setTimeout(() => {
      console.error(`[POSTER-DIAG] 7.delayed-check(500ms): canvas.attrs=${_checkCanvas.width}x${_checkCanvas.height} canvas.css=${_checkCanvas.clientWidth}x${_checkCanvas.clientHeight}`);
    }, 500);
    // #endif

    // #ifdef H5
    // 地面真相诊断：在逻辑画布的四角与底边画醒目的品红标记，
    // 并绘制 0/25/50/75/100% 水平扫描线 + 百分比文字，
    // 一眼即可判断“截图到底截到了画布的百分之多少”。
    if (this._drawLog) {
      ctx.save();
      ctx.strokeStyle = "#FF00FF";
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, width - 4, height - 4);
      ctx.fillStyle = "#FF00FF";
      ctx.beginPath();
      ctx.arc(width - 14, height - 14, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(width / 2, height - 14, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(14, height - 14, 10, 0, Math.PI * 2);
      ctx.fill();
      // 百分比扫描线
      const _scanColors = ["#FF00FF", "#00FF00", "#0000FF", "#FFFF00", "#00FFFF"];
      const _scanRatios = [0, 0.25, 0.5, 0.75, 1];
      _scanRatios.forEach((r, i) => {
        const y = Math.round(height * r);
        ctx.strokeStyle = _scanColors[i];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillStyle = _scanColors[i];
        ctx.font = "bold 24px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText(`${Math.round(r * 100)}%`, 6, y + 4);
      });
      // 注：buffer 内容完整性检查已移至 toTempFilePath 的 4.export-content
      // （导出图 = canvas buffer 完整副本，用 Image 加载后读底部像素，比 getImageData 坐标更可靠）
      ctx.restore();
      console.error(`[POSTER-DIAG] 5.visual-marker: 已画扫描线(0/25/50/75/100%)，请截图看截到哪条线。logicCanvas=${width}x${height}`);
      console.error(`[POSTER-DIAG] 8.export-check: 请立即点击“导出为图片”，若导出的图片是 ${this.canvas.width}x${this.canvas.height} 且包含完整扫描线，则绘制完整，问题在显示层/截图范围。`);
    }
    // #endif

    ctx.restore();

    // #ifdef H5
    // 视口诊断：判断 canvas 是否因为“超出视口底部”而被用户误认为“只显示一半”。
    if (this._drawLog && typeof window !== "undefined" && this.canvas.getBoundingClientRect) {
      const _vRect = this.canvas.getBoundingClientRect();
      const _docEl = document.documentElement;
      const _clientH = _docEl ? _docEl.clientHeight : 0;
      const _innerH = window.innerHeight || _clientH;
      const _scrollY = window.scrollY || window.pageYOffset || 0;
      const _docTop = _vRect.top + _scrollY;
      console.error(
        `[POSTER-DIAG] 6.viewport: ` +
          `innerHeight=${_innerH} clientHeight=${_clientH} ` +
          `canvasTop=${Math.round(_vRect.top)} canvasBottom=${Math.round(_vRect.bottom)} ` +
          `docTop=${Math.round(_docTop)} scrollY=${Math.round(_scrollY)} ` +
          `canvasCssH=${Math.round(_vRect.height)} ` +
          `visibleH=${Math.max(0, Math.min(_vRect.bottom, _clientH) - _vRect.top)} ` +
          `visibleRatio=${_vRect.height > 0 ? +(Math.max(0, Math.min(_vRect.bottom, _clientH) - _vRect.top) / _vRect.height).toFixed(2) : 0}` +
          ` dpr=${window.devicePixelRatio || 1}`
      );
    }
    // #endif

    // APP-PLUS 平台需要调用 ctx.draw() 并等待回调
    // #ifdef APP-PLUS
    await new Promise((resolve, reject) => {
      if (this.canvas._canvasId) {
        ctx.draw(false, (res) => {
          if (res && res.errMsg && res.errMsg.includes("ok")) {
            resolve();
          } else {
            reject(new Error("ctx.draw 回调失败: " + (res?.errMsg || "unknown")));
          }
        });
      } else {
        // 无 canvasId 时直接 resolve（可能是 mock 环境或自定义 canvas）
        resolve();
      }
    });
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
      // #ifdef H5
      try {
        const mime = fileType === "jpg" ? "jpeg" : fileType;
        const dataUrl = this.canvas.toDataURL(`image/${mime}`, quality);
        // 临时诊断：导出图片真实像素尺寸 + 内容完整性（区分“绘制不完整”还是“显示/截图被截断”）
        if (typeof window !== "undefined" && window.Image && typeof document !== "undefined") {
          const img = new window.Image();
          img.onload = () => {
            const _w = img.width, _h = img.height;
            console.error(`[POSTER-DIAG] 4.export: dataURL size=${_w}x${_h} canvasBuffer=${this.canvas.width}x${this.canvas.height}`);
            // 铁证：把导出图绘到临时 canvas，读【底部 12 行】像素，统计青色(100%扫描线)占比。
            // 导出图 = canvas buffer 完整副本，受屏幕显示/截图方式影响最小，能直接判定绘制是否完整。
            try {
              const _tmp = document.createElement("canvas");
              _tmp.width = _w;
              _tmp.height = _h;
              const _tctx = _tmp.getContext("2d");
              _tctx.drawImage(img, 0, 0);
              const _sh = Math.min(12, _h);
              const _d = _tctx.getImageData(0, _h - _sh, _w, _sh).data;
              const _tot = _w * _sh;
              let _cyan = 0;
              for (let i = 0; i < _d.length; i += 4) {
                if (_d[i] < 80 && _d[i + 1] > 180 && _d[i + 2] > 180 && _d[i + 3] > 180) _cyan++;
              }
              const _pct = ((_cyan / _tot) * 100).toFixed(1);
              console.error(`[POSTER-DIAG] 4.export-content: img=${_w}x${_h} bottomCyan=${_pct}% => ${_cyan > 0 ? "底部扫描线已绘入 buffer，绘制完整，问题在显示层/截图范围" : "底部无青色，绘制确实不完整（需深挖绘制逻辑）"}`);
            } catch (e) {
              console.error(`[POSTER-DIAG] 4.export-content: 读取失败`, e);
            }
          };
          img.src = dataUrl;
        }
        resolve(dataUrl);
        return;
      } catch (e) {
        reject(e);
        return;
      }
      // #endif

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
    // #ifdef H5
    return new Promise((resolve, reject) => {
      try {
        const a = document.createElement("a");
        a.href = tempPath;
        a.download = `poster_${Date.now()}.${this.exportOptions.fileType}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        resolve(tempPath);
      } catch (e) {
        reject(e);
      }
    });
    // #endif

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
          if (img.width > 0 && img.height > 0) {
            css.height = Math.ceil((img.height / img.width) * resolvedWidth);
          }
        } catch (e) { }
      }
    }

    if (type === "image" && css.width == null && css.objectFit === "heightFix") {
      const resolvedSrc = this._resolveTemplate(node.src);
      if (resolvedSrc) {
        try {
          const img = await this._loadImageCached(resolvedSrc);
          if (img.width > 0 && img.height > 0) {
            css.width = Math.ceil((img.width / img.height) * (css.height || 0));
            resolvedWidth = css.width;
          }
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

    // #ifdef H5
    // 逐节点绘制日志：打印每个元素在【逻辑坐标系】下的盒子（x/y/w/h，已含 rpx→px 转换结果），
    // 并自动判定是否超出画布边界：right = x+w 是否 > 画布宽；bottom = y+h 是否 > 画布高。
    // 一旦超出即打 ⚠️OVERFLOW，并把序号记入 _overflowNodes，供 render 末尾汇总。
    if (this._drawLog) {
      const _right = x + resolvedWidth;
      const _bottom = y + resolvedHeight;
      const _rs = this._renderScale || 1;
      // 元素在 canvas buffer 中的【物理像素】盒：逻辑坐标 × renderScale（这是真正的绘制落点）
      const _bufRight = _right * _rs;
      const _bufBottom = _bottom * _rs;
      const _bufW = this.canvas.width;
      const _bufH = this.canvas.height;
      // 双重校验：既比逻辑画布，也比 buffer 物理边界（之前只比逻辑坐标，漏掉了物理像素越界）
      const _ovX = _right > this._logicalWidth + 0.5 || _bufRight > _bufW + 0.5;
      const _ovY = _bottom > this._logicalHeight + 0.5 || _bufBottom > _bufH + 0.5;
      const _flag = _ovX || _ovY ? " ⚠️OVERFLOW" : "";
      if (_ovX || _ovY) this._overflowNodes.push(this._drawLogIdx);
      console.error(
        `[POSTER-DRAW] #${this._drawLogIdx++} type=${type} ` +
          `box(logical)={x:${+x.toFixed(1)},y:${+y.toFixed(1)},w:${+resolvedWidth.toFixed(1)},h:${+resolvedHeight.toFixed(1)}} ` +
          `right:${+_right.toFixed(1)} bottom:${+_bottom.toFixed(1)} ` +
          `canvas=${this._logicalWidth}x${this._logicalHeight} ` +
          `buffer=${_bufW}x${_bufH} ` +
          `bufRight:${+_bufRight.toFixed(1)} bufBottom:${+_bufBottom.toFixed(1)} ` +
          `scale=${_rs.toFixed(2)}` +
          _flag
      );
    }
    // #endif

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

      // #ifdef MP-TOUTIAO
      // 抖音端诊断：逐图打印自然尺寸 + 绘制坐标，定位"位置不准确"
      console.error(
        `[TT-DIAG] drawImage: fit=${objectFit} ` +
          `img=${img.width}x${img.height} hasSize=${hasSize} ` +
          `box={x:${x},y:${y},w:${w},h:${h}}`,
      );
      // #endif

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
      } else if (hasSize && objectFit === "widthFix") {
        const dw = w;
        const dh = (img.height / img.width) * w;
        ctx.drawImage(imgSrc, x, y, dw, dh);
      } else if (hasSize && objectFit === "heightFix") {
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
    // #ifdef MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY || H5
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
