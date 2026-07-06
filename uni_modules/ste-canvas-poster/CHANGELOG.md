# Changelog

All notable changes to this project will be documented in this file.

## 1.3.0（2026-06-05）

### 新增

- 新增 `barcode` 元素：内置一维条码生成，支持以下格式
  - **EAN-13**：12 位自动计算 mod-10 校验位；13 位自动校验末位
  - **Code-128**（Code Set B）：支持 ASCII 32–127
- 新增配套 CSS 属性 `showText` / `textSize` / `textColor` / `textMargin`
- 新增 `format` 节点属性：`'EAN13' | 'CODE128'`
- 新增 `BarcodeNode` / `BarcodeCss` 类型导出

## 1.2.6（2026-06-06）

### 新增

- 新增`image`元素`css`属性`objectFit`值：
  - `widthFix`: 宽度固定为 `width`，高度按原图比例自动计算。
  - `heightFix`：高度固定为 `height`，宽度按原图比例自动计算。

## 1.2.5（2026-06-04）

### 修复

- 修复`text`行高大于10时表现异常的问题

## 1.2.4（2026-06-03）

### 删除

- 移除 `viewPrice` 业务方法，减小包体积

## 1.2.3（2026-06-03）

### 修复

- 修复`flex`布局下`text`样式异常BUG

## 1.2.2（2026-06-03）

### 修复

- 修复`flex`布局图文对齐问题
- 修复 text 元素自动高度计算问题

## 1.2.1（2026-06-02）

### 修复

- 修复`flex`布局图文对齐问题

## 1.2.0 (2026-05-28)

### 新增

- viewPrice 支持价格区间（prices 传数组），如 `prices: [1500, 2900]` 渲染为 ￥15.00~29.00
- Flex 布局支持 `alignItems: 'baseline'`，不同字号文本按基线对齐
- text 元素支持自动高度（省略 height 时引擎自动根据内容计算）
- 新增 half-leading（半行距），字形在行高盒子内垂直居中

### 修复

- 修复纯数字字符串文本（如 "000"）被 rpx 转换误判为尺寸值导致内容丢失
- 修复 text 无 width 时使用 parentWidth 导致宽度过大、浮点精度拆行的问题
- 修复 Flex 布局中子元素 height 未回填导致对齐失效的问题
- 修复 viewPrice 加粗属性拼写错误（blod → bold）和不支持的 bold 属性（改为 fontWeight）

### 优化

- 合并 measureText.js 到 tools.js，精简文件结构
- \_splitTextLines 抽取为独立方法，消除 \_drawText 中的重复代码
- NON_DIMENSION_KEYS 扩充，新增 text/src/color/fontWeight 等非尺寸属性排除
- package.json 适配 UniApp 官方插件市场完整格式（dcloudext、uni_modules.platforms）

## 1.1.0 (2026-05-28)

### 修复

- 优化圆角绘制逻辑，避免超出边界

## 1.0.2 (2026-05-26)

### 修复

- 修复 APP 图片加载 BUG

## 1.0.1 (2026-05-26)

### 移除

- 移除原项目中对 URL 解析的依赖

## 1.0.0 (2026-05-26)

### 首次发布

- Schema 驱动的声明式海报绘制引擎
- 支持微信小程序与 APP 双端
- 内置元素类型：view、image、text、qrcode
- Flex 布局支持（row / column、alignItems、justifyContent）
- 模板变量自动替换 `{{key}}`
- rpx 到 px 自动转换
- 渐变背景（linear-gradient）
- 圆角/边框/阴影
- 文本多行换行、省略号、删除线
- 图片 objectFit（fill / cover / contain）
- 内置二维码生成，无需额外依赖
- 完整 TypeScript 类型声明
