// ─────────────────────────────────────────────
// 导出的函数
// ─────────────────────────────────────────────

import { RenderPosterOptions, PosterEngine } from './types';

/** 渲染海报（一步到位，自动处理路径解析和平台差异） */
export function renderPoster(options: RenderPosterOptions): Promise<PosterEngine>;

/** 获取 Canvas 节点（双端统一封装） */
export function getCanvasNode(selector: string, vm: Record<string, any>): Promise<any>;

/** 将 rpx 转换为 px（基于当前屏幕宽度） */
export function rpx2px(rpx: number): number;

/** 将 px 转换为 rpx */
export function px2rpx(px: number): number;

/** 计算文本渲染宽度（考虑中英文、数字、符号的宽度差异） */
export function measureText(text: string, fontSize: number, bold?: boolean): number;

/** 加载图片（双端统一封装，返回包含 width/height/path 的图片对象） */
export function loadImage(canvas: any, src: string): Promise<any>;
