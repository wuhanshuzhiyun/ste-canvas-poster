// ste-canvas-poster 类型声明 v1.2.0

// ─────────────────────────────────────────────
// CSS 属性类型
// ─────────────────────────────────────────────

/** padding 值：四边相同 / [上下, 左右] / [上, 右, 下, 左] */
export type PaddingValue = number | [number, number] | [number, number, number, number];

/** borderRadius 值：四角相同 / [左上, 右上, 右下, 左下] */
export type BorderRadiusValue = number | [number, number, number, number];

/** 字重：关键字或数字 */
export type FontWeight = "normal" | "bold" | "400" | "700" | number;

/** 文本水平对齐 */
export type TextAlign = "left" | "center" | "right";

/**Flex 方向 */
export type FlexDirection = "row" | "column";

/** Flex 交叉轴对齐 */
export type AlignItems = "flex-start" | "center" | "flex-end" | "baseline";

/** Flex 主轴对齐 */
export type JustifyContent = "flex-start" | "center" | "space-between";

/** objectFit 模式 */
export type ObjectFit = "fill" | "cover" | "contain" | "widthFix" | "heightFix";

/** 背景色或渐变字符串 */
export type BackgroundValue = string;

/** 模板变量字符串，如 '{{key}}' */
export type TemplateString = string;

// ─────────────────────────────────────────────
// 通用 CSS 属性（所有元素共享）
// ─────────────────────────────────────────────

export interface CommonCss {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
  opacity?: number;
  borderRadius?: BorderRadiusValue;
}

// ─────────────────────────────────────────────
// 各元素 CSS 属性
// ─────────────────────────────────────────────

export interface ViewCss extends CommonCss {
  background?: BackgroundValue;
  backgroundColor?: BackgroundValue;
  borderWidth?: number;
  borderColor?: string;
  display?: "flex";
  flexDirection?: FlexDirection;
  alignItems?: AlignItems;
  justifyContent?: JustifyContent;
  padding?: PaddingValue;
}

export interface ImageCss extends CommonCss {
  objectFit?: ObjectFit;
}

export interface TextCss extends CommonCss {
  fontSize?: number;
  fontWeight?: FontWeight;
  fontFamily?: string;
  color?: string;
  textAlign?: TextAlign;
  lineHeight?: number;
  maxWidth?: number;
  ellipsis?: boolean;
  lines?: number;
  textDecoration?: "line-through" | "none";
  background?: BackgroundValue;
  backgroundColor?: BackgroundValue;
  padding?: PaddingValue;
}

export interface QrcodeCss extends CommonCss {
  color?: string;
  background?: BackgroundValue;
  backgroundColor?: BackgroundValue;
}

// ─────────────────────────────────────────────
// Flex 子元素 margin
// ─────────────────────────────────────────────

export interface FlexChildCss {
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
}

// ─────────────────────────────────────────────
// Schema 视图节点
// ─────────────────────────────────────────────

export interface ViewNode {
  type: "view";
  css?: ViewCss & FlexChildCss;
  views?: SchemaNode[];
}

export interface ImageNode {
  type: "image";
  src: string | TemplateString;
  css?: ImageCss & FlexChildCss;
}

export interface TextNode {
  type: "text";
  text: string | number | TemplateString;
  css?: TextCss & FlexChildCss;
}

export interface QrcodeNode {
  type: "qrcode";
  text?: string | TemplateString;
  src?: string | TemplateString;
  css?: QrcodeCss & FlexChildCss;
}

export type SchemaNode = ViewNode | ImageNode | TextNode | QrcodeNode;

// ─────────────────────────────────────────────
// 根 Schema
// ─────────────────────────────────────────────

export interface PosterSchema {
  width: number;
  height: number;
  borderRadius?: number;
  background?: BackgroundValue;
  backgroundColor?: BackgroundValue;
  backgroundImage?: string | TemplateString;
  views: SchemaNode[];
}

// ─────────────────────────────────────────────
// 模板变量数据
// ─────────────────────────────────────────────

export type TemplateData = Record<string, string | number | boolean | undefined | null>;

// ─────────────────────────────────────────────
// renderPoster 选项
// ─────────────────────────────────────────────

export interface RenderPosterOptions {
  schema: PosterSchema;
  data?: TemplateData;
  selector: string;
  vm: Record<string, any>;
  dpr?: number;
  useRpx?: boolean;
}

// ─────────────────────────────────────────────
// toTempFilePath 选项
// ─────────────────────────────────────────────

export interface ToTempFilePathOptions {
  fileType?: "png" | "jpg";
  quality?: number;
}

// ─────────────────────────────────────────────
// PosterEngine 类
// ─────────────────────────────────────────────

export declare class PosterEngine {
  canvas: any;
  ctx: CanvasRenderingContext2D;
  schema: PosterSchema;
  data: TemplateData;
  dpr: number;

  constructor(options: { canvas: any; schema: PosterSchema; data?: TemplateData; dpr?: number });

  render(): Promise<void>;

  toTempFilePath(options?: ToTempFilePathOptions): Promise<string>;

  saveToAlbum(): Promise<string>;

  destroy(): void;
}
