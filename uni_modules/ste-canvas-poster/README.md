# ste-canvas-poster

基于 Canvas 2D API 的声明式海报绘制引擎，支持微信小程序与 APP 双端。

## 特性

- **Schema 驱动** — 通过 JSON 描述海报结构，数值直接使用设计稿 rpx
- **双端一致** — 一套 Schema 同时适配微信小程序与 APP，无需条件编译
- **模板变量** — Schema 中 `{{key}}` 自动替换为 data 数据
- **Flex 布局** — view 容器支持 `display: 'flex'` 及子元素 margin
- **内置二维码** — qrcode 类型直接生成二维码，无需额外依赖
- **TypeScript 支持** — 完整类型声明，开发时自动补全

## 安装

```bash
npm install ste-canvas-poster
```

## 快速开始

### 1. 定义 Schema

```javascript
const schema = {
  width: 750,
  height: 1068,
  background: "#FFFFFF",
  views: [
    {
      type: "view",
      css: {
        left: 54,
        top: 54,
        width: 642,
        height: 960,
        borderRadius: 20,
        background: "#FFFFFF",
      },
    },
    {
      type: "image",
      src: "{{coverImage}}",
      css: {
        left: 96,
        top: 160,
        width: 560,
        height: 478,
        borderRadius: 12,
        objectFit: "cover",
      },
    },
    {
      type: "text",
      text: "{{titleText}}",
      css: {
        left: 96,
        top: 730,
        fontSize: 32,
        fontWeight: "bold",
        color: "#181818",
        maxWidth: 560,
        ellipsis: true,
      },
    },
    {
      type: "qrcode",
      src: "{{qrcodeUrl}}",
      css: { left: 504, top: 842, width: 160, height: 160 },
    },
  ],
};
```

### 2. 准备数据

```javascript
const data = {
  coverImage: "https://example.com/cover.jpg",
  titleText: "精选商品",
  qrcodeUrl: "https://example.com",
};
```

### 3. 渲染与保存

```javascript
import { renderPoster } from "ste-canvas-poster";

// 渲染
const engine = await renderPoster({
  schema,
  data,
  selector: "#myCanvas",
  vm: this,
});

// 保存到相册
await engine.saveToAlbum();

// 或获取临时路径（用于分享）
const tempPath = await engine.toTempFilePath();
```

### 4. Template 模板

```vue
<template>
  <!-- #ifdef MP-WEIXIN -->
  <canvas id="myCanvas" type="2d" class="canvas" :style="canvasStyle" />
  <!-- #endif -->
  <!-- #ifdef APP-PLUS -->
  <canvas
    canvas-id="myCanvas"
    id="myCanvas"
    class="canvas"
    :style="canvasStyle"
  />
  <!-- #endif -->
</template>
```

```javascript
computed: {
  canvasStyle() {
    return { width: '750rpx', height: '1068rpx' };
  }
}
```

---

## API

### renderPoster(options)

渲染海报，自动处理rpx 转换和平台差异。

```typescript
function renderPoster(options: RenderPosterOptions): Promise<PosterEngine>;
```

**参数**：

| 参数       | 类型                  | 必填 | 默认值   | 说明                                  |
| ---------- | --------------------- | ---- | -------- | ------------------------------------- |
| `schema`   | `PosterSchema`        | 是   | -        | 海报结构描述                          |
| `data`     | `TemplateData`        | 否   | `{}`     | 模板变量数据                          |
| `selector` | `string`              | 是   | -        | Canvas 选择器，如 `'#myCanvas'`       |
| `vm`       | `Record<string, any>` | 是   | -        | Vue 组件实例                          |
| `dpr`      | `number`              | 否   | 自动获取 | 像素比                                |
| `useRpx`   | `boolean`             | 否   | `true`   | 是否将 schema 数值视为 rpx 并自动转换 |

**返回值**：`Promise<PosterEngine>` — 引擎实例

### PosterEngine

渲染完成后返回的引擎实例，提供以下方法：

#### engine.saveToAlbum()

导出图片并保存到系统相册。

```typescript
saveToAlbum(): Promise<string>
```

**返回值**：临时文件路径

#### engine.toTempFilePath(options?)

导出为临时文件路径，不保存到相册。

```typescript
toTempFilePath(options?: ToTempFilePathOptions): Promise<string>
```

| 参数       | 类型             | 默认值  | 说明                         |
| ---------- | ---------------- | ------- | ---------------------------- |
| `fileType` | `'png' \| 'jpg'` | `'png'` | 导出格式                     |
| `quality`  | `number`         | `1`     | 图片质量（0-1），仅 jpg 有效 |

**返回值**：临时文件路径

#### engine.destroy()

销毁引擎实例，释放图片缓存等资源。组件卸载时调用。

```typescript
destroy(): void
```

### 工具函数

#### rpx2px(rpx)

将 rpx 转换为 px（基于当前屏幕宽度）。

```typescript
function rpx2px(rpx: number): number;
```

#### px2rpx(px)

将 px 转换为 rpx。

```typescript
function px2rpx(px: number): number;
```

#### getCanvasNode(selector, vm)

获取 Canvas 节点（双端统一封装）。

```typescript
function getCanvasNode(selector: string, vm: Record<string, any>): Promise<any>;
```

#### measureText(text, fontSize, bold?)

计算文本渲染宽度，考虑中英文、数字、符号的宽度差异。

```typescript
function measureText(text: string, fontSize: number, bold?: boolean): number;
```

| 参数       | 类型      | 必填 | 默认值  | 说明                |
| ---------- | --------- | ---- | ------- | ------------------- |
| `text`     | `string`  | 是   | -       | 文本内容            |
| `fontSize` | `number`  | 是   | -       | 字号（rpx）         |
| `bold`     | `boolean` | 否   | `false` | 是否加粗（加宽 6%） |

**返回值**：文本宽度（rpx），向上取整

---

## Schema 规范

### 根节点

```javascript
{
  width: 750,                  // 画布宽度（rpx）
  height: 1068,                // 画布高度（rpx）
  borderRadius: 24,            // 画布圆角（可选，导出圆角图片）
  background: '#FFFFFF',       // 背景色或渐变（可选，不设置则透明）
  backgroundImage: '{{bg}}',   // 背景图（可选，支持模板变量，加载失败回退到 background）
  views: []                    // 元素列表，按顺序绘制
}
```

**背景配置**：

| 配置                                                              | 效果                      |
| ----------------------------------------------------------------- | ------------------------- |
| 不设置 `background` 和 `backgroundImage`                          | 透明，导出 PNG 带透明通道 |
| `background: '#FFFFFF'`                                           | 白色背景                  |
| `background: 'linear-gradient(180deg, #FF0000 0%, #FFFFFF 100%)'` | 渐变背景                  |
| `backgroundImage: '{{bg}}'`                                       | 背景图                    |

**圆角说明**：设置 `borderRadius` 后，整个画布被裁剪为圆角矩形，圆角外区域透明。

### 元素类型

#### view — 容器

支持背景、边框、圆角和 Flex 布局，可嵌套子元素。

```javascript
{
  type: 'view',
  css: {
    left: 54,
    top: 54,
    width: 642,
    height: 960,
    borderRadius: 20,
    background: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#CCCCCC'
  },
  views: []  // 子元素
}
```

**渐变背景**：

```javascript
background: "linear-gradient(180deg, #EE3C3C 0%, #FFFFFF 100%)";
// 角度遵循 CSS 规范：0deg 从下到上，90deg 从左到右，180deg 从上到下
```

**Flex 布局**：

```javascript
{
  type: 'view',
  css: {
    left: 54, top: 54, width: 642, height: 200,
    background: '#F5F5F5',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: [20, 30]  // [上下, 左右] 或 [上, 右, 下, 左]
  },
  views: [
    { type: 'image', css: { width: 30, height: 30, borderRadius: 15, marginRight: 8 } },
    { type: 'text', text: '{{name}}', css: { fontSize: 24, width: 100, height: 24 } }
  ]
}
```

#### image — 图片

绘制图片，支持圆角裁剪和 objectFit。

```javascript
{
  type: 'image',
  src: '{{coverImage}}',  // 支持模板变量
  css: {
    left: 96,
    top: 160,
    width: 560,
    height: 478,
    borderRadius: 12,
    objectFit: 'cover'     // 'fill' | 'cover' | 'contain'
  }
}
```

#### text — 文本

绘制文本，支持多行换行、省略号、删除线。

```javascript
{
  type: 'text',
  text: '{{titleText}}',  // 支持模板变量
  css: {
    left: 96,
    top: 730,
    fontSize: 32,
    fontWeight: 'bold',     // 'normal' | 'bold' | '400' | '700'
    fontFamily: 'sans-serif',
    color: '#181818',
    textAlign: 'left',      // 'left' | 'center' | 'right'
    lineHeight: 1.4,        // 行高倍数（不是 px）
    maxWidth: 560,          // 超过则换行或省略
    ellipsis: true,         // 单行省略号
    lines: 2                // 最大行数（0 = 不限）
  }
}
```

#### qrcode — 二维码

生成并绘制二维码，内容支持模板变量。

```javascript
{
  type: 'qrcode',
  text: '{{qrcodeUrl}}',   // 或 src: '{{qrcodeUrl}}'
  css: {
    left: 504,
    top: 842,
    width: 160,
    height: 160,
    color: '#000000',                       // 前景色
    background: '#FFFFFF'                   // 背景色
  }
}
```

---

## CSS 属性参考

### 通用属性

所有元素均可使用：

| 属性           | 类型                 | 默认值 | 说明                           |
| -------------- | -------------------- | ------ | ------------------------------ |
| `left`         | `number`             | `0`    | x 坐标                         |
| `top`          | `number`             | `0`    | y 坐标                         |
| `right`        | `number`             | -      | 右侧定位                       |
| `bottom`       | `number`             | -      | 底部定位                       |
| `width`        | `number`             | -      | 宽度                           |
| `height`       | `number`             | -      | 高度                           |
| `opacity`      | `number`             | `1`    | 透明度（0-1），不参与 rpx 缩放 |
| `borderRadius` | `number \| number[]` | `0`    | 圆角，支持 `[lt, rt, rb, lb]`  |

### view 属性

| 属性              | 类型                                          | 默认值         | 说明           |
| ----------------- | --------------------------------------------- | -------------- | -------------- |
| `background`      | `string`                                      | -              | 背景色或渐变   |
| `backgroundColor` | `string`                                      | -              | 同 background  |
| `borderWidth`     | `number`                                      | -              | 边框宽度       |
| `borderColor`     | `string`                                      | -              | 边框颜色       |
| `display`         | `'flex'`                                      | -              | 启用 Flex 布局 |
| `flexDirection`   | `'row' \| 'column'`                           | `'row'`        | 主轴方向       |
| `alignItems`      | `'flex-start' \| 'center' \| 'flex-end'`      | `'flex-start'` | 交叉轴对齐     |
| `justifyContent`  | `'flex-start' \| 'center' \| 'space-between'` | `'flex-start'` | 主轴对齐       |
| `padding`         | `number \| number[]`                          | `0`            | 内边距         |

### image 属性

| 属性        | 类型                             | 默认值   | 说明     |
| ----------- | -------------------------------- | -------- | -------- |
| `objectFit` | `'fill' \| 'cover' \| 'contain'` | `'fill'` | 缩放模式 |

### text 属性

| 属性             | 类型                            | 默认值         | 说明                      |
| ---------------- | ------------------------------- | -------------- | ------------------------- |
| `fontSize`       | `number`                        | `14`           | 字号                      |
| `fontWeight`     | `string \| number`              | `'normal'`     | 字重                      |
| `fontFamily`     | `string`                        | `'sans-serif'` | 字体                      |
| `color`          | `string`                        | `'#000000'`    | 文本颜色                  |
| `textAlign`      | `'left' \| 'center' \| 'right'` | `'left'`       | 对齐方式                  |
| `lineHeight`     | `number`                        | `1.4`          | 行高倍数，不参与 rpx 缩放 |
| `maxWidth`       | `number`                        | -              | 最大宽度                  |
| `ellipsis`       | `boolean`                       | `false`        | 单行省略号                |
| `lines`          | `number`                        | `0`            | 最大行数，不参与 rpx 缩放 |
| `textDecoration` | `'line-through' \| 'none'`      | -              | 文本装饰                  |

### Flex 子元素 margin

Flex 布局中子元素支持的间距属性：

| 属性           | 类型     | 默认值 | 说明   |
| -------------- | -------- | ------ | ------ |
| `marginLeft`   | `number` | `0`    | 左间距 |
| `marginRight`  | `number` | `0`    | 右间距 |
| `marginTop`    | `number` | `0`    | 上间距 |
| `marginBottom` | `number` | `0`    | 下间距 |

### 不参与 rpx 缩放的字段

| 字段         | 语义                       |
| ------------ | -------------------------- |
| `opacity`    | 透明度 0~1                 |
| `lines`      | 行数                       |
| `flex`       | flex 比例                  |
| `lineHeight` | 行高倍数                   |
| `fontWeight` | 字重（数字形式如 400/700） |
| `zIndex`     | 层叠顺序                   |
| `dpr`        | 像素比                     |

---

## 命名规范

所有 Schema 及 CSS 属性统一使用 **camelCase**（驼峰命名）：

```javascript
// ✅ 正确
{ css: { fontSize: 32, borderRadius: 12, objectFit: 'cover' } }

// ❌ 错误
{ css: { 'font-size': 32, 'border-radius': 12, 'object-fit': 'cover' } }
```

---

## 平台差异

| 特性          | 微信小程序              | APP                        |
| ------------- | ----------------------- | -------------------------- |
| Canvas 初始化 | `canvas.createImage()`  | `uni.createCanvasContext`  |
| 图片路径      | 直接使用网络 URL        | 需先 `downloadFile` 到本地 |
| rpx 缩放      | CSS 自动处理，scale = 1 | scale = windowWidth / 750  |
| 图片加载      | `canvas.createImage()`  | `uni.getImageInfo`         |

---

## 常见问题

### 海报只显示一部分

Canvas 内部尺寸小于元素坐标范围。确保 `canvas.width/height` 不小于最大元素坐标，小程序端保持设计稿尺寸。

### 文字大小与预期不符

`fontSize` 单位为 rpx，确保 `useRpx: true`（默认值）。

---

## 文件结构

```
ste-canvas-poster/
├── index.js               # 导出入口
├── index.d.ts             # 函数类型声明
├── types.d.ts             # Schema / CSS 类型声明
├── src/
│   ├── posterAdapter.js   # 双端适配：Canvas 初始化、rpx 转换、图片预下载
│   ├── posterEngine.js    # 绘制引擎：Schema 解析、Canvas 绘制
│   ├── qrcodeGenerator.js # 二维码生成
│   └── measureText.js     # 文本宽度计算
└── package.json
```

## License

ISC
