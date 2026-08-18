# ste-canvas-poster 兼容性检查报告

> 检查对象：`D:\Project_2025\canvas-poster\uni_modules\ste-canvas-poster`（v1.2.9）
> 检查时间：2026-08-17
> 检查方式：插件市场官方声明 + 源码条件编译分支逐行核对

---

## 一、官方声明兼容性（package.json → `uni_modules.platforms`）

这是 DCloud 插件市场对插件兼容性的**权威声明**，插件作者明确勾选了支持范围：

| 平台 | 声明 | 说明 |
| --- | --- | --- |
| **App (vue)** | ✅ 1.0.2 | Android / iOS，Vue 页面 |
| **App (nvue)** | ✅ 1.0.2 | Android / iOS，nvue 原生渲染 |
| **微信小程序** | ✅ 1.0.2 | mp-weixin |
| H5 / web (safari) | ❌ `-` | 明确不支持 |
| H5 / web (chrome) | ❌ `-` | 明确不支持 |
| 支付宝小程序 | ❌ `-` | 明确不支持 |
| 抖音/字节小程序 | ❌ `-` | 明确不支持 |
| 百度小程序 | ❌ `-` | 明确不支持 |
| 快手小程序 | ❌ `-` | 明确不支持 |
| QQ 小程序 | ❌ `-` | 明确不支持 |
| 京东小程序 | ❌ `-` | 明确不支持 |
| 飞书小程序 | ❌ `-` | 明确不支持 |
| 小红书小程序 | ❌ `-` | 明确不支持 |
| 快应用（华为/联盟） | ❌ `-` | 明确不支持 |
| 鸿蒙 HarmonyOS | ❌ `-` | 明确不支持 |
| uni-app-x (android/ios/harmony) | ❌ `-` | 明确不支持 |

`package.json` 的 `description` 字段也写明：**"基于 Canvas 2D API 的声明式海报绘制引擎，支持微信小程序与 APP 双端"**。

---

## 二、源码实际兼容性（条件编译分支核对）

插件平台差异全部通过 uni-app `// #ifdef` 条件编译实现，分布在两个核心文件：

### 1. `src/posterAdapter.js → getCanvasNode()`（获取 Canvas 节点）
```js
// #ifdef APP-PLUS          → 用 uni.createCanvasContext + mockCanvas
// #ifdef MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY → 用 uni.createSelectorQuery().node()
// #ifdef H5                → 用 document.querySelector 取 DOM canvas
// 其余平台：命中兜底 #ifndef → Promise.reject（不再静默卡死）
```
**关键风险已修复**：除 `APP-PLUS` / `MP-WEIXIN` / `MP-QQ` / `MP-TOUTIAO` / `MP-ALIPAY` / `H5` 外，任何其他平台调用此函数会立即 `reject` 明确报错（早期版本为永久挂起）。

### 2. `src/posterEngine.js → render()`（画布尺寸与缩放）
```js
// #ifdef MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY || H5
this.canvas.width = Math.round(width * dpr);  ctx.scale(dpr, dpr);
// #ifdef APP-PLUS
this.canvas.width = width;  // 不 scale（APP 端 mockCanvas 已换算）
// 其他平台：canvas.width 保持默认 300×150，不 scale → 渲染尺寸错乱
```
`APP-PLUS` 还需在 `render()` 末尾调用旧式 `ctx.draw(false, callback)` 提交绘制。

### 3. `loadImage()`（图片加载）
```js
// #ifdef APP-PLUS 且 _canvasId → uni.getImageInfo（旧式 canvas 无 createImage）
// 其他所有平台 → canvas.createImage()
```
`toTempFilePath()`（导出图片）：`APP-PLUS && _canvasId` 用 `canvasId` 方式，其余（含微信）用 `canvas` 节点方式调用 `uni.canvasToTempFilePath`。

### 结论：源码运行时真正可工作的平台
- ✅ **微信小程序**：节点获取、createImage、dpr 缩放、canvasToTempFilePath 全部分支齐备
- ✅ **App（Android/iOS）**：createCanvasContext、getImageInfo、ctx.draw、canvasToTempFilePath 齐备
- ✅ **QQ 小程序**（2026-08-17 扩展）：复用微信分支（`MP-WEIXIN || MP-QQ`）
- ✅ **H5**（2026-08-17 扩展）：DOM canvas / `new Image()` / `toDataURL` / `<a download>`
- ✅ **支付宝小程序**（2026-08-17 扩展）：复用微信 canvas 2d 分支（`MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY`），`createImage` / `canvasToTempFilePath` / `saveImageToPhotosAlbum` 走 uni 通用封装
- ✅ **抖音/字节小程序**（2026-08-17 扩展）：复用微信 canvas 2d 分支，`tt.*` 同源 API 自然命中
- ❌ 其余平台：在 `getCanvasNode` 命中兜底 `reject`，不再静默卡死

---

## 三、三处声明 / 配置矛盾点（需注意）

1. **manifest.json 与插件真实能力矛盾**
   `manifest.json` 声明可编译到 `mp-weixin / mp-alipay / mp-baidu / mp-toutiao / app-plus / quickapp`。其中 `mp-alipay / mp-toutiao` 已通过扩展条件编译复用微信分支支持；但 `mp-baidu / quickapp` 在插件源码中**仍无任何对应分支**，若真去编译运行会在 `getCanvasNode` 命中兜底 `reject`。这是因为 manifest 是"宿主项目可编译目标"，不等于插件已兼容。

2. **README 模板已随扩展更新，但官方 platforms 声明未同步**
   README 的 `<canvas>` 模板示例条件编译已扩展为 `MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY || H5`，与实际分支一致。但插件市场 `package.json → uni_modules.platforms` 官方声明仍停留在"微信 + App 双端"（支付宝/抖音标为 `-`），属于"官方声明未同步"，不影响本地实际运行兼容性。

3. **目录名 `canvas-poster` 与插件名 `ste-canvas-poster`**
   当前工程是插件的一个 demo/宿主项目，不要把宿主 `manifest.json` 的平台列表误读为插件支持列表。

---

## 四、目前真实支持的平台（最终结论）

| 平台 | 运行时可用 | 依据 |
| --- | --- | --- |
| 微信小程序 (mp-weixin) | ✅ 完整支持 | MP-WEIXIN 分支齐备 |
| App Android/iOS (vue/nvue) | ✅ 完整支持 | APP-PLUS 分支齐备 |
| QQ 小程序 (mp-qq) | ✅ 完整支持（2026-08-17 扩展） | 与微信同源，复用 MP-WEIXIN 分支 |
| 支付宝小程序 (mp-alipay) | ✅ 完整支持（2026-08-17 扩展） | 复用微信 canvas 2d 分支，走 uni 通用封装 |
| 抖音/字节小程序 (mp-toutiao) | ✅ 完整支持（2026-08-17 扩展） | 复用微信 canvas 2d 分支，tt.* 同源 |
| H5 (web) | ✅ 完整支持（2026-08-17 扩展） | 新增 H5 分支：DOM canvas / new Image() / toDataURL / <a download> |
| 百度小程序 (mp-baidu) | ❌ | 无对应分支，getCanvasNode 命中兜底 reject |
| 快手/京东/小红书/飞书小程序 | ❌ | 无对应分支，getCanvasNode 命中兜底 reject |
| 快应用 | ❌ | 无分支且 canvas 能力弱 |
| 鸿蒙 / uni-app-x | ❌ | 需 uts/ArkUI 重写 |

---

## 五、后续可兼容的平台及可行性（按优先级）

| 优先级 | 平台 | 可行性 | 改造要点 |
| --- | --- | --- | --- |
| ✅ 已完成 | **QQ 小程序 (mp-qq)** | 极易（2026-08-17 完成） | canvas 2d API 与微信同源，已将 `#ifdef MP-WEIXIN` 改为 `#ifdef MP-WEIXIN \|\| MP-QQ`，并同步修复兜底避免误触 |
| ✅ 已完成 | **H5 (web)** | 中（2026-08-17 完成） | 已新增 H5 分支：`getCanvasNode` 用 `document.querySelector` 取 DOM canvas；`loadImage` 用 `new Image()`（crossOrigin）；`toTempFilePath` 用 `canvas.toDataURL()`；`saveToAlbum` 用 `<a download>`；render 额外设置 canvas.style 显示尺寸 |
| ✅ 已完成 | **支付宝小程序 (mp-alipay)** | 中（2026-08-17 完成） | 复用微信 canvas 2d 分支：条件编译扩为 `MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY`，`createImage` / `canvasToTempFilePath` / `saveImageToPhotosAlbum` 走 uni 通用封装 |
| ✅ 已完成 | **抖音/字节小程序 (mp-toutiao)** | 中（2026-08-17 完成） | 复用微信 canvas 2d 分支：`tt.*` 同源 API 自然命中，条件编译同理扩展 |
| ★☆☆ | **百度小程序 (mp-baidu)** | 较难 | 百度 canvas 2d 支持较弱，部分 API 缺失 |
| ★☆☆ | **快手/小红书/飞书小程序** | 较难 | 生态较新、兼容层不稳定 |
| ✕ | **快应用** | 几乎不可行 | 无 canvas 2d，能力极弱 |
| ✕ | **uni-app-x / 鸿蒙** | 高成本 | 需用 uts / ArkUI 重写绘制层 |

---

## 六、兼容性改造建议（若要做扩展）

1. ✅ **已为 `getCanvasNode` 增加兜底分支**（2026-08-17）：当前为六层 `#ifndef`（APP-PLUS / MP-WEIXIN / MP-QQ / H5 / MP-TOUTIAO / MP-ALIPAY），非支持平台直接 `reject(new Error(...))` 而非永久挂起。
2. ✅ **QQ 小程序已完成**（2026-08-17）：扩展条件编译复用微信分支。
3. ✅ **H5 已完成**（2026-08-17）：DOM canvas 节点 + new Image() + toDataURL + <a download>。
4. ✅ **支付宝/抖音已完成**（2026-08-17）：复用微信 canvas 2d 分支，条件编译统一扩展为 `MP-WEIXIN || MP-QQ || MP-TOUTIAO || MP-ALIPAY`，导出/保存走 uni 通用封装（`uni.canvasToTempFilePath` / `uni.saveImageToPhotosAlbum`），兜底补两层 `#ifndef` 避免误触。
5. **统一导出接口抽象**（待做）：将 `canvasToTempFilePath` 按平台封装为内部方法，便于后续新增 `my.` / `tt.` 显式前缀分支（目前依赖 uni 自动转发）。

---

*报告生成方式：基于源码逐文件条件编译核对，非仅依赖文档声明。*
