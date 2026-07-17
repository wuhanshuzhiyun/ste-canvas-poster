import { RenderPosterOptions, PosterEngine } from "./types";

export function renderPoster(options: RenderPosterOptions): Promise<PosterEngine>;

export function getCanvasNode(selector: string, vm: Record<string, any>): Promise<any>;

export function rpx2px(rpx: number): number;

export function px2rpx(px: number): number;

export function getWindowWidth(): number;

export function measureText(text: string, fontSize: number, bold?: boolean): number;

export function loadImage(canvas: any, src: string): Promise<any>;


export { PosterEngine } from "./types";

export type {
  PosterSchema,
  TemplateData,
  SchemaNode,
  ViewNode,
  ImageNode,
  TextNode,
  QrcodeNode,
  BarcodeNode,
  RenderPosterOptions,
  ToTempFilePathOptions,
  ImageFileType,
  CommonCss,
  ViewCss,
  ImageCss,
  TextCss,
  QrcodeCss,
  BarcodeCss,
  FlexChildCss,
  PaddingValue,
  BorderRadiusValue,
  FontWeight,
  TextAlign,
  FlexDirection,
  AlignItems,
  JustifyContent,
  ObjectFit,
  BackgroundValue,
  TemplateString,
} from "./types";
