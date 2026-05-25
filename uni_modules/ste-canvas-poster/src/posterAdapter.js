/**
 * posterAdapter.js - 海报引擎双端适配层
 * 版本：v0.0.1
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

import { PosterEngine } from "./posterEngine.js";

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/**
 * 判断是否为完整 URL
 * @param {string} src
 * @returns {boolean}
 */
function isFullUrl(src) {
  if (!src) return false;
  return (
    /^https?:\/\//i.test(src) ||
    /^data:image/i.test(src) ||
    /^wxfile:/i.test(src)
  );
}

/**
 * 解析图片路径（相对路径 → 完整 URL）
 * @param {string} src
 * @returns {string}
 */
function resolveImagePath(src) {
  if (!src) return "";
  if (isFullUrl(src)) return src;
  // #ifdef APP-PLUS
  if (/^(file:|\/var\/|\/storage\/)/i.test(src)) return src;
  // #endif
  return src;
}

/**
 * 深度解析数据对象中的所有图片路径
 * @param {Object} data
 * @returns {Object}
 */
const IMAGE_KEY_SUFFIX_RE = /(Image|Img|Url|Src|Photo|Pic)$/i;
const IMAGE_KEY_EXACT_RE = /^(background|qrcode|cover|avatar)$/i;

function resolveDataImages(data) {
  if (!data || typeof data !== "object") return data;

  let resolved = null;
  for (const [key, value] of Object.entries(data)) {
    if (
      typeof value === "string" &&
      (IMAGE_KEY_SUFFIX_RE.test(key) || IMAGE_KEY_EXACT_RE.test(key))
    ) {
      const newPath = resolveImagePath(value);
      if (newPath !== value) {
        if (!resolved) {
          resolved = { ...data };
        }
        resolved[key] = newPath;
      }
    }
  }
  return resolved || data;
}

// ─────────────────────────────────────────────
// 辅助：rpx → px 转换
// ─────────────────────────────────────────────

let _windowWidth = null;

function getWindowWidth() {
  const current = uni.getSystemInfoSync().windowWidth;
  _windowWidth = current;
  return _windowWidth;
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
  "lineHeight",
  "zIndex",
  "dpr",
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

function transformSchemaRpx(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (_windowWidth == null) {
    _windowWidth = getWindowWidth() || 375;
  }
  const scale = _windowWidth / 750;

  function traverseInPlace(obj) {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        traverseInPlace(obj[i]);
      }
      return;
    }
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value && typeof value === "object") {
        traverseInPlace(value);
      } else if (shouldTransform(value)) {
        if (NON_DIMENSION_KEYS.has(key) || (key === "fontWeight" && typeof value === "number")) {
          continue;
        }
        obj[key] = transformValue(value, scale);
      }
    }
  }

  traverseInPlace(schema);
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
  // #ifdef MP-WEIXIN
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
                  console.warn(
                    "[posterAdapter] 图片预下载失败，保留原值:",
                    err,
                  );
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

    // #ifdef MP-WEIXIN
    const query = uni.createSelectorQuery().in(vm);
    query
      .select(selector)
      .node((res) => {
        const node = res && res.node ? res.node : res;
        if (node) {
          resolve(node);
        } else {
          reject(new Error(`[posterAdapter] 未找到 Canvas 节点: ${selector}`));
        }
      })
      .exec();
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
 * @returns {Promise<PosterEngine>}   返回引擎实例，供后续 save/share 使用
 */
export async function renderPoster({
  schema,
  data = {},
  selector,
  vm,
  dpr,
  useRpx = true,
}) {
  if (!selector) throw new Error("[posterAdapter] selector 不能为空");
  if (!vm) throw new Error("[posterAdapter] vm 不能为空");

  // 深拷贝 schema，避免修改用户传入的原始对象
  const schemaCopy = JSON.parse(JSON.stringify(schema));

  // 自动将 schema 中的 rpx 转换为 px（业务层可以直接使用设计稿的 rpx 值）
  const transformedSchema = useRpx ? transformSchemaRpx(schemaCopy) : schemaCopy;

  // 自动解析数据中的图片路径（相对路径 → 完整 URL）
  const resolvedData = resolveDataImages(data);
  let preloadedData = resolvedData;

  // #ifdef APP-PLUS
  preloadedData = await preloadSchemaImages(transformedSchema, resolvedData);
  // #endif

  const canvas = await getCanvasNode(selector, vm);
  const engine = new PosterEngine({
    canvas,
    schema: transformedSchema,
    data: preloadedData,
    dpr,
  });
  await engine.render();
  return engine;
}
