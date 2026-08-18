/**
 * posterAdapter.js - 海报引擎双端适配层
 * 版本：v1.2.0
 *
 * 功能：
 *  1. 兼容微信小程序 / APP 两端获取 Canvas 2D 节点
 *  2. 封装 renderPoster 高层 API
 *  3. 自动处理图片路径解析（相对路径 → 完整 URL）
 *  4. 自动处理 APP 端图片下载本地化
 *
 * 使用方式（业务层无需关心平台差异）：
 *   const engine = await renderPoster({ schema, data, selector: '#myCanvas', vm: this });
 *   await engine.saveToAlbum();
 */

import { PosterEngine, LINE_HEIGHT_PX_THRESHOLD } from "./posterEngine.js";
import { getWindowWidth } from "./tools.js";

/**
 * 将 Schema 中的 rpx 值转换为 px
 * 业务层可以直接使用 rpx（如 750rpx），插件自动转换为当前屏幕的 px 值
 * @param {Object} schema - 原始 schema（包含 rpx 值）
 * @returns {Object} - 转换后的 schema（所有 rpx 转为 px）
 */
const NON_DIMENSION_KEYS = new Set([
  "opacity",
  "lines",
  "flex",
  "zIndex",
  "dpr",
  "text",
  "src",
  "color",
  "borderColor",
  "fontWeight",
  "fontFamily",
  "textAlign",
  "textDecoration",
  "objectFit",
  "display",
  "flexDirection",
  "alignItems",
  "justifyContent",
  "type",
]);

function shouldTransform(val) {
  if (typeof val === "number") return true;
  if (typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val)) return true;
  return false;
}

function transformValue(val, scale) {
  if (typeof val === "number") return Math.floor(val * scale);
  if (typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val)) {
    return Math.floor(parseFloat(val) * scale);
  }
  return val;
}

function traverseInPlace(obj, scale) {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      traverseInPlace(obj[i], scale);
    }
    return;
  }
  if (!obj || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value && typeof value === "object") {
      traverseInPlace(value, scale);
    } else if (shouldTransform(value)) {
      // lineHeight ≤ 10 是倍数（不转），> 10 视为 px 值（需要 rpx→px 转换）
      if (key === "lineHeight") {
        const num = typeof value === "number" ? value : parseFloat(value);
        if (!isFinite(num) || num <= LINE_HEIGHT_PX_THRESHOLD) continue;
      }
      if (NON_DIMENSION_KEYS.has(key)) {
        continue;
      }
      obj[key] = transformValue(value, scale);
    }
  }
}

function transformSchemaRpx(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const scale = getWindowWidth() / 750;
  traverseInPlace(schema, scale);
  return schema;
}

/**
 * 用外部给定的 scale 转换 schema 的 rpx（不依赖 getWindowWidth）。
 * H5 端用它按“画布真实显示尺寸”反推比例，彻底规避 getWindowWidth 与 uni rpx 基准不一致。
 */
function transformSchemaWithScale(schema, scale) {
  if (!schema || typeof schema !== "object") return schema;
  traverseInPlace(schema, scale);
  return schema;
}

// ─────────────────────────────────────────────
// 辅助：APP 端图片预下载
// ─────────────────────────────────────────────

function downloadImageToLocal(url) {
  if (!url) return Promise.resolve("");
  if (/^wxfile:/i.test(url)) return Promise.resolve(url);
  if (/^data:image/i.test(url)) return Promise.resolve(url);
  // #ifdef APP-PLUS
  if (/^(file:|\/var\/|\/storage\/)/i.test(url)) return Promise.resolve(url);
  // #endif

  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      success: ({ tempFilePath, statusCode }) => {
        if (statusCode >= 200 && statusCode < 300 && tempFilePath) {
          resolve(tempFilePath);
        } else {
          console.error("[posterAdapter] 图片下载失败，状态码:", statusCode);
          reject(new Error(`下载失败，状态码: ${statusCode}`));
        }
      },
      fail: (err) => {
        console.error("[posterAdapter] 图片下载失败", err);
        reject(err);
      },
    });
  });
}

/**
 * 批量将 Schema 中的网络图片预下载到本地（APP 端专用）
 * @param {Object} schema
 * @param {Object} data    已解析过的数据
 * @returns {Promise<Object>}  新的 data 对象，图片字段替换为本地路径
 */
async function preloadSchemaImages(schema, data = {}) {
  // #ifdef MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY
  return data;
  // #endif

  // #ifdef APP-PLUS
  const newData = { ...data };
  const promises = [];

  // 判断是否需要下载：网络图片（http/https）需要下载，其他类型不需要
  function shouldDownload(url) {
    if (!url) return false;
    return /^https?:\/\//.test(url);
  }

  function traverse(views = []) {
    for (const node of views) {
      if (node.type === "image" && node.src) {
        const tplMatch = node.src.match(/\{\{(\w+)\}\}/);
        if (tplMatch) {
          const key = tplMatch[1];
          const value = newData[key];
          if (shouldDownload(value)) {
            promises.push(
              downloadImageToLocal(value)
                .then((localPath) => {
                  newData[key] = localPath;
                })
                .catch((err) => {
                  console.warn("[posterAdapter] 图片预下载失败，保留原值:", err);
                  // 下载失败保留原值
                }),
            );
          }
        }
      }
      if (node.views?.length) {
        traverse(node.views);
      }
    }
  }

  traverse(schema.views || []);

  if (schema.backgroundImage) {
    const bgKey = (schema.backgroundImage.match(/\{\{(\w+)\}\}/) || [])[1];
    if (bgKey && shouldDownload(newData[bgKey])) {
      promises.push(
        downloadImageToLocal(newData[bgKey])
          .then((localPath) => {
            newData[bgKey] = localPath;
          })
          .catch((err) => {
            console.warn("[posterAdapter] 背景图预下载失败，保留原值:", err);
            // 下载失败保留原值
          }),
      );
    }
  }

  await Promise.all(promises);
  return newData;
  // #endif
}

// ─────────────────────────────────────────────
// 获取 Canvas 节点
// ─────────────────────────────────────────────

export function getCanvasNode(selector, vm) {
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    const canvasId = selector.replace("#", "");
    const ctx = uni.createCanvasContext(canvasId, vm);
    if (ctx) {
      const sysInfo = uni.getSystemInfoSync();
      const screenWidth = sysInfo.screenWidth || sysInfo.windowWidth || 375;
      const rpxToPx = screenWidth / 750;
      const defaultWidth = Math.floor(750 * rpxToPx);
      const defaultHeight = Math.floor(1068 * rpxToPx);

      const mockCanvas = {
        width: defaultWidth,
        height: defaultHeight,
        getContext: (type) => (type === "2d" ? ctx : null),
        createImage: () => {
          // 构造一个与小程序端 canvas.createImage() 行为一致的图片对象
          // 当 src 被赋值时，自动调用 uni.getImageInfo 加载图片尺寸并触发 onload
          const img = {
            width: 0,
            height: 0,
            onload: null,
            onerror: null,
          };
          let _src = "";
          Object.defineProperty(img, "src", {
            get() {
              return _src;
            },
            set(val) {
              _src = val;
              if (!val) return;
              uni.getImageInfo({
                src: val,
                success: (res) => {
                  img.width = res.width;
                  img.height = res.height;
                  if (img.onload) img.onload();
                },
                fail: (err) => {
                  if (img.onerror) img.onerror(err);
                },
              });
            },
            enumerable: true,
            configurable: true,
          });
          return img;
        },
        _canvasId: canvasId,
        _vm: vm,
      };
      resolve(mockCanvas);
      return;
    }
    // #endif

    // #ifdef MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY
    // 统一使用 fields({ node: true }) + exec 回调读取 res[0].node。
    // 微信/QQ/抖音/支付宝四端通用；差异仅在下方 .in(vm) 的附加条件（见 MP-ALIPAY 排除）。
    const query = uni.createSelectorQuery();
    // #ifndef MP-ALIPAY
    // 支付宝小程序不支持 selectorQuery.in(component)（官方明确“使用无效果”），
    // 调用后会导致页级 canvas 节点查询失败、res[0].node 为 undefined。
    // 故支付宝端不附加 .in(vm)，直接按页面范围查询即可命中页级 canvas。
    if (vm) {
      query.in(vm);
    }
    // #endif
    query
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = res && res[0] && res[0].node;
        if (node) {
          resolve(node);
        } else {
          reject(new Error(`[posterAdapter] 未找到 Canvas 节点: ${selector}`));
        }
      });
    // #endif

    // #ifdef H5
    let el = document.querySelector(selector);
    // uni-app H5 会把 <canvas type="2d"> 组件包成 <uni-canvas>，内部再套 <canvas>。
    // <uni-canvas> 组件会异步重置内部 canvas 的 width/height 属性（按 CSS×dpr），
    // 导致引擎设置的 buffer 被清空、上下文重置，画面错乱。
    // 解决：隐藏 <uni-canvas>，创建原生 <canvas> 兄弟节点，uni-app 完全管不到它。
    if (el && typeof el.getContext !== "function") {
      const _uniCanvas = el; // <uni-canvas>
      const _wrapper = _uniCanvas.parentElement; // .canvas-wrapper
      if (_wrapper) {
        _uniCanvas.style.display = "none"; // 隐藏 uni-app 的 canvas 组件
        // 复用已创建的原生 canvas（多次渲染时不重复创建）
        let rawCanvas = _wrapper.querySelector("canvas.raw-poster-canvas");
        if (!rawCanvas) {
          rawCanvas = document.createElement("canvas");
          rawCanvas.className = "raw-poster-canvas";
          rawCanvas.style.cssText =
            "width:100%;height:100%;display:block;box-sizing:border-box;";
          _wrapper.appendChild(rawCanvas);
        }
        el = rawCanvas;
      } else {
        // 兜底：直接取内部 canvas
        const inner = el.querySelector("canvas");
        if (inner) el = inner;
      }
    }
    if (el && typeof el.getContext === "function") {
      const _elRect = el.getBoundingClientRect();
      const _cs =
        typeof window !== "undefined" && window.getComputedStyle
          ? window.getComputedStyle(el)
          : null;
      const _fmt = (n) => (n == null ? "null" : Math.round(n));
      console.error(
        `[POSTER-DIAG] 1.getNode: ` +
          `innerWidth=${typeof window !== "undefined" ? window.innerWidth : null} ` +
          `innerHeight=${typeof window !== "undefined" ? window.innerHeight : null} ` +
          `canvas(rect)=${_fmt(_elRect.width)},${_fmt(_elRect.height)} ` +
          `canvas(computed)=${_cs ? JSON.stringify({ w: _cs.width, h: _cs.height, maxH: _cs.maxHeight, disp: _cs.display }) : "null"} ` +
          `canvas(attrs)=${el.width},${el.height} ` +
          `isRaw=${el.className.includes("raw-poster-canvas")}`,
      );
      // 祖辈链
      if (typeof window !== "undefined" && window.getComputedStyle) {
        const _chain = [];
        let _cur = el;
        while (_cur && _cur !== document.body) {
          const _c = window.getComputedStyle(_cur);
          const _r = _cur.getBoundingClientRect();
          _chain.push({
            tag: _cur.tagName,
            id: _cur.id || "",
            cls: _cur.className && typeof _cur.className === "string" ? _cur.className.split(" ")[0] : "",
            w: Math.round(_r.width),
            h: Math.round(_r.height),
            cssW: _c.width,
            cssH: _c.height,
            maxH: _c.maxHeight,
            overflow: _c.overflow,
            overflowY: _c.overflowY,
            pos: _c.position,
            disp: _c.display,
          });
          _cur = _cur.parentElement;
        }
        console.error("[POSTER-DIAG] 1.ancestors:", JSON.stringify(_chain));
      }
      el.style.display = "block";
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.boxSizing = "border-box";
      resolve(el);
    } else {
      reject(new Error(`[posterAdapter] 未找到 Canvas 节点: ${selector}`));
    }
    // #endif

    // #ifndef APP-PLUS
    // #ifndef MP-WEIXIN
    // #ifndef MP-QQ
    // #ifndef H5
    // #ifndef MP-TOUTIAO
    // #ifndef MP-ALIPAY
    // 兜底分支：当前平台不在已支持列表内（如百度 / 快手 / 京东 / 小红书 / 飞书 / 快应用 / 鸿蒙 等）
    // 直接 reject，避免 Promise 永久挂起导致页面白屏卡死（原实现在非支持平台会静默卡死）
    const _platform = (uni.getSystemInfoSync && uni.getSystemInfoSync().platform) || "unknown";
    reject(
      new Error(
        `[ste-canvas-poster] 当前平台「${_platform}」暂不支持海报绘制。` +
          `本插件目前仅支持 App（Android/iOS）、微信小程序（mp-weixin）、QQ 小程序（mp-qq）、支付宝小程序（mp-alipay）、抖音小程序（mp-toutiao）与 H5。` +
          `如需扩展平台兼容，请参考兼容性报告或联系插件维护者。`,
      ),
    );
    return;
    // #endif
    // #endif
    // #endif
    // #endif
    // #endif
    // #endif
  });
}

// ─────────────────────────────────────────────
// 高层 API
// ─────────────────────────────────────────────

/**
 * 渲染海报（一步到位，自动处理路径解析和平台差异）
 *
 * @param {Object} options
 * @param {Object}  options.schema    JSON Schema 对象（数值可直接使用 rpx）
 * @param {Object}  [options.data]    模板变量数据（图片路径可以是相对路径）
 * @param {string}  options.selector  Canvas 选择器（如 '#posterCanvas'）
 * @param {Object}  options.vm        Vue 组件实例（this）
 * @param {number}  [options.dpr]     像素比（可选，默认自动获取）
 * @param {boolean} [options.useRpx]  是否将 schema 中的数值视为 rpx 并自动转换（默认 true）
 * @param {Object}  [options.exportOptions] 导出图片选项 { fileType, quality }
 *   - fileType: 'png' | 'jpg' | 'webp'，默认 'png'
 *   - quality:  0–1，仅 jpg/webp 有效
 *   不传时也支持后续 engine.saveToAlbum({ fileType, quality }) 覆盖
 * @returns {Promise<PosterEngine>}   返回引擎实例，供后续 save/share 使用
 */
export async function renderPoster({ schema, data = {}, selector, vm, dpr, useRpx = true, exportOptions }) {
  if (!selector) throw new Error("[posterAdapter] selector 不能为空");
  if (!vm) throw new Error("[posterAdapter] vm 不能为空");

  // 深拷贝 schema，避免修改用户传入的原始对象
  const schemaCopy = JSON.parse(JSON.stringify(schema));

  let transformedSchema = schemaCopy;
  let canvas = null;

  // #ifdef H5
  // 取节点后，直接测量画布“真实显示尺寸”，用 显示宽 / schema 设计宽 反推 rpx→px 比例。
  // 这样海报必定按白卡实际大小绘制（1:1），彻底绕开 getWindowWidth / innerWidth 推算，
  // 且设备模式/缩放后白卡随 CSS 收缩、此处实时重测，缩放比自动修正，不会放大溢出。
  canvas = await getCanvasNode(selector, vm);
  if (useRpx) {
    const _cr = canvas.getBoundingClientRect();
    let _cardW = _cr && _cr.width;
    if (!_cardW) {
      const _pr = canvas.parentElement && canvas.parentElement.getBoundingClientRect();
      _cardW = _pr && _pr.width;
    }
    const _designW = typeof schemaCopy.width === "number" ? schemaCopy.width : 750;
    const _scale = _cardW ? _cardW / _designW : getWindowWidth() / 750;
    transformedSchema = transformSchemaWithScale(schemaCopy, _scale);
    // #ifdef H5
    console.error("[POSTER-DIAG] 2.transform:", {
      innerWidth: typeof window !== "undefined" ? window.innerWidth : null,
      cardW: Math.round(_cardW || 0),
      designW: _designW,
      scale: +(_scale || 0).toFixed(4),
      schemaLogicalW: Math.round(typeof schemaCopy.width === "number" ? schemaCopy.width : 710),
    });
    // #endif
  }
  // #endif

  // #ifndef H5
  // 非 H5 仍按原逻辑（getWindowWidth 在各小程序/App 为正确基准）
  if (useRpx) transformedSchema = transformSchemaRpx(schemaCopy);
  canvas = await getCanvasNode(selector, vm);
  // #endif

  let preloadedData = data;

  // #ifdef APP-PLUS
  preloadedData = await preloadSchemaImages(transformedSchema, data);
  // #endif

  const engine = new PosterEngine({
    canvas,
    schema: transformedSchema,
    data: preloadedData,
    dpr,
    exportOptions,
  });
  await engine.render();
  return engine;
}
