<template>
	<view class="container">
		<view class="test-selector">
			<view class="selector-title">选择测试项</view>
			<view class="selector-list">
				<view v-for="(item, index) in testCases" :key="index" class="selector-item" :class="{ active: currentTest === index }" @click="selectTest(index)">
					{{ item.name }}
				</view>
			</view>
		</view>
		<view class="message" :class="messageType">
			{{ message }}
		</view>
		<view class="action-buttons">
			<button type="primary" size="mini" @click="renderCanvas">渲染</button>
			<button size="mini" @click="toTempFilePath">导出为图片</button>
			<button type="warn" size="mini" @click="saveToAlbum">保存到相册</button>
		</view>

		<view class="canvas-wrapper" :style="[canvasSize]">
			<canvas id="testCanvas" canvas-id="testCanvas" type="2d" style="width: 100%; height: 100%" class="test-canvas"></canvas>
		</view>

		<!-- 导出图预览 = canvas buffer 完整副本，直接反映绘制内容是否完整（地面真相），绕开屏幕显示/局部截图干扰 -->
		<view v-if="exportedUrl" class="export-preview-wrap">
			<view class="export-preview-title">导出图预览（地面真相：反映绘制是否完整）</view>
			<image :src="exportedUrl" class="export-preview" mode="widthFix"></image>
		</view>
	</view>
</template>

<script lang="ts" setup>
import { ref, computed, onBeforeUnmount, getCurrentInstance } from "vue";
import { renderPoster } from "@/uni_modules/ste-canvas-poster";
import { PosterEngine, PosterSchema, TemplateData } from "@/uni_modules/ste-canvas-poster/types.d";
import { base64Img } from "./base64img";

const canvasWidth = 710;   // 设计稿宽（schema 坐标基准，所有测试用例按此设计，勿改）
const canvasHeight = 1200; // 设计稿高
const displayWidth = 600;  // 白卡显示宽(rpx)：<710 即为海报留出左右边距，海报按白卡实测宽自动等比缩小铺满

interface TestCase {
	name: string;
	description: string;
	schema: PosterSchema;
	data: TemplateData;
}

const instance = getCurrentInstance();
const currentTest = ref(0);
const message = ref("");
const messageType = ref<"success" | "error">("success");
let engine: PosterEngine | null = null;
const exportedUrl = ref(""); // 导出图（H5 下为 dataURL），用于页面预览，作为绘制完整性的地面真相

const testCases: TestCase[] = [
	{
		name: "1. 基础矩形",
		description: "测试纯色填充矩形、边框、圆角",
		schema: {
			width: canvasWidth,
			height: canvasHeight,
			views: [
				{ type: "view", css: { left: 40, top: 40, width: 630, height: 200, backgroundColor: "#FF6B6B", borderRadius: 24 } },
				{ type: "view", css: { left: 40, top: 280, width: 300, height: 160, backgroundColor: "#4ECDC4", borderRadius: 16 } },
				{ type: "view", css: { right: 40, top: 280, width: 300, height: 160, backgroundColor: "#45B7D1", borderRadius: [16, 16, 0, 0] } },
				{ type: "view", css: { left: 40, top: 480, width: 630, height: 120, borderWidth: 4, borderColor: "#FF9F43", borderRadius: 16 } },
				{ type: "view", css: { left: 40, top: 640, width: 630, height: 160, backgroundColor: "rgba(155, 89, 182, 0.5)" } },
			],
		},
		data: {},
	},
	{
		name: "2. 渐变矩形",
		description: "测试线性渐变填充",
		schema: {
			width: canvasWidth,
			height: canvasHeight,
			views: [
				{
					type: "view",
					css: { left: 40, top: 40, width: 630, height: 200, backgroundColor: "linear-gradient(180deg, #FF6B6B 0%, #FF9F43 100%)", borderRadius: 24 },
				},
				{
					type: "view",
					css: { left: 40, top: 280, width: 630, height: 200, backgroundColor: "linear-gradient(90deg, #4ECDC4 0%, #45B7D1 100%)", borderRadius: 24 },
				},
				{
					type: "view",
					css: { left: 40, top: 520, width: 630, height: 200, backgroundColor: "linear-gradient(45deg, #9B59B6 0%, #3498DB 100%)", borderRadius: 24 },
				},
				{
					type: "view",
					css: { left: 40, top: 760, width: 300, height: 160, backgroundColor: "linear-gradient(180deg, #F1C40F 0%, #E74C3C 100%)", borderRadius: 16 },
				},
				{
					type: "view",
					css: { right: 40, top: 760, width: 300, height: 160, backgroundColor: "linear-gradient(180deg, #2ECC71 0%, #1ABC9C 100%)", borderRadius: 16 },
				},
			],
		},
		data: {},
	},
	{
		name: "3. 文本渲染",
		description: "测试各种文本样式：字体、颜色、对齐、省略号",
		schema: {
			width: canvasWidth,
			height: canvasHeight,
			views: [
				{ type: "text", text: "标题文本 - 72rpx", css: { left: 40, top: 60, fontSize: 72, color: "#2C3E50", fontWeight: "bold" } },
				{ type: "text", text: "普通文本 - 56rpx", css: { left: 40, top: 160, fontSize: 56, color: "#34495E" } },
				{ type: "text", text: "小型文本 - 40rpx", css: { left: 40, top: 240, fontSize: 40, color: "#7F8C8D" } },
				{ type: "text", text: "居中对齐的文本", css: { top: 320, fontSize: 48, color: "#3498DB", textAlign: "center" } },
				{ type: "text", text: "右对齐的文本", css: { right: 40, top: 400, fontSize: 48, color: "#9B59B6", textAlign: "right" } },
				{ type: "text", text: "行高测试\n这是第二行", css: { left: 40, top: 480, fontSize: 44, color: "#2C3E50", lineHeight: 2 } },
				{
					type: "view",
					css: {
						left: 40,
						top: 700,
						width: 630,
						height: 330,
						borderWidth: 4,
						borderColor: "#FF9F43",
						borderRadius: 16,
					},
					views: [
						{
							type: "text",
							text: "这是一段很长的文本内容用来测试单行省略号功能是否正常工作，超出部分应该显示省略号",
							css: { top: 12, fontSize: 34, color: "#f00", maxWidth: 630, ellipsis: true },
						},
						{
							type: "text",
							text: "这是一段很长的文本内容用来测试多行省略号功能是否正常工作，当文本超过指定行数时，最后一行应该以省略号结尾，超出部分不再显示",
							css: { top: 70, fontSize: 34, color: "#f0f", maxWidth: 630, lines: 2 },
						},
						{
							type: "text",
							text: "多行省略号测试：这是第一行内容，这是第二行内容，这是第三行内容，第四行应该被截断并显示省略号，后面的文字都不应该出现",
							css: { top: 180, fontSize: 34, color: "#00f", maxWidth: 630, lines: 3 },
						},
					],
				},
				{ type: "text", text: "{{userName}} 的邀请函", css: { top: 1400, fontSize: 52, color: "#E67E22", fontWeight: "bold", textAlign: "center" } },
			],
		},
		data: { userName: "张三" },
	},
	{
		name: "4. 图片渲染",
		description: "测试图片加载、object-fit、裁剪",
		schema: {
			width: canvasWidth,
			height: canvasHeight,
			views: [
				{ type: "text", text: "👇 objectFit: fill", css: { left: 20, top: 10, width: 300, fontSize: 24, color: "#f99", fontWeight: "bold", textAlign: "center" } },
				{ type: "image", src: "{{coverImage}}", css: { left: 20, top: 60, width: 300, height: 150, objectFit: "fill", borderRadius: 24 } },
				{ type: "text", text: "👇 objectFit: cover", css: { left: 340, top: 10, width: 300, fontSize: 24, color: "#f99", fontWeight: "bold", textAlign: "center" } },
				{ type: "image", src: "{{coverImage}}", css: { left: 340, top: 60, width: 300, height: 150, objectFit: "cover", borderRadius: 24 } },
				{ type: "text", text: "👇 objectFit: contain", css: { left: 20, top: 220, width: 300, fontSize: 24, color: "#f99", fontWeight: "bold", textAlign: "center" } },
				{ type: "image", src: "{{coverImage}}", css: { left: 20, top: 270, width: 300, height: 150, objectFit: "contain", borderRadius: 24 } },
				{ type: "text", text: "👇 objectFit: widthFix", css: { left: 340, top: 220, width: 300, fontSize: 24, color: "#f99", fontWeight: "bold", textAlign: "center" } },
				{ type: "image", src: "{{coverImage}}", css: { left: 340, top: 270, width: 300, objectFit: "widthFix", borderRadius: 24 } },
				{ type: "text", text: "👇 objectFit: heightFix", css: { left: 20, top: 450, width: 300, fontSize: 24, color: "#f99", fontWeight: "bold", textAlign: "center" } },
				{ type: "image", src: "{{coverImage}}", css: { left: 20, top: 500, height: 150, objectFit: "heightFix", borderRadius: 24 } },
			],
		},
		data: {
			coverImage: "https://picsum.photos/600/600",
		},
	},
	{
		name: "5. 二维码生成",
		description: "测试 QRCode 生成与样式",
		schema: {
			width: canvasWidth,
			height: canvasHeight,
			views: [
				{
					type: "view",
					css: { left: 40, top: 40, width: 630, height: 670, backgroundColor: "#f5f5f5", borderRadius: 32 },
					views: [
						{ type: "text", text: "扫码领取福利", css: { top: 40, fontSize: 56, color: "#2C3E50", fontWeight: "bold", textAlign: "center" } },
						{ type: "qrcode", src: "{{qrcodeUrl}}", css: { left: 125, top: 140, width: 380, height: 380, backgroundColor: "#9ff", color: "#f00" } },
						{
							type: "text",
							text: "{{productName}}",
							css: { top: 560, fontSize: 44, color: "#E74C3C", fontWeight: "bold", textAlign: "center" },
						},
					],
				},
			],
		},
		data: {
			qrcodeUrl: "https://stellar-ui.intecloud.com.cn/?projectName=stellar-ui-plus&menu=%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97&active=%E4%BB%8B%E7%BB%8D",
			productName: "StellarUI",
		},
	},
	{
		name: "6. 复杂海报",
		description: "综合测试：商品推广海报",
		schema: {
			width: canvasWidth,
			height: canvasHeight,
			backgroundColor: "linear-gradient(180deg, #667eea 0%, #764ba2 100%)",
			views: [
				{
					type: "view",
					css: { left: 40, top: 40, width: 630, height: 80, backgroundColor: "#fff", borderRadius: 24, display: "flex", alignItems: "flex-start" },
					views: [
						{ type: "image", src: "data:image/png;base64," + base64Img, css: { width: 60, height: 60, objectFit: "cover", borderRadius: 70 } },
						{ type: "text", text: "{{brandName}}", css: { fontSize: 30, color: "#2C3E50", fontWeight: "bold" } },
					],
				},
				{
					type: "view",
					css: { left: 40, top: 130, width: 630, height: 80, backgroundColor: "#fff", borderRadius: 24, display: "flex", alignItems: "center" },
					views: [
						{ type: "image", src: "{{brandAvatar}}", css: { width: 60, height: 60, objectFit: "cover", borderRadius: 70 } },
						{ type: "text", text: "{{brandName}}", css: { fontSize: 30, color: "#2C3E50", fontWeight: "bold", marginTop: 20 } },
					],
				},
				{
					type: "view",
					css: { left: 40, top: 220, width: 630, height: 80, backgroundColor: "#fff", borderRadius: 24, display: "flex", alignItems: "flex-end" },
					views: [
						{ type: "image", src: "{{brandAvatar}}", css: { width: 60, height: 60, objectFit: "cover", borderRadius: 70 } },
						{ type: "text", text: "{{brandName}}", css: { fontSize: 30, color: "#2C3E50", fontWeight: "bold", marginTop: 20 } },
					],
				},
				{
					type: "view",
					css: { left: 40, top: 320, width: 630, height: 60, backgroundColor: "#fff", borderRadius: 12 },
					views: [
						{ type: "image", src: "{{brandAvatar}}", css: { width: 60, height: 60, objectFit: "cover", borderRadius: 70 } },
						{ type: "text", text: "{{brandName}}12ABCabcg", css: { left: 66, lineHeight: 60, fontSize: 30, color: "#2C3E50", fontWeight: "bold" } },
					],
				},
				{
					type: "view",
					css: { left: 40, top: 400, width: 630, height: 500, backgroundColor: "#fff", borderRadius: 24 },
					views: [
						{
							type: "image",
							src: "{{productImage}}",
							css: { left: 0, top: 0, height: 320, objectFit: "cover" },
						},
						{
							type: "view",
							css: { left: 30, top: 330, height: 60, backgroundColor: "#eee", borderRadius: 12, display: "flex", alignItems: "baseline" },
							views: [
								{ type: "text", text: "￥", css: { fontSize: 24, color: "#E74C3C", lineHeight: 1, fontWeight: "bold" } },
								{ type: "text", text: "15", css: { fontSize: 48, color: "#E74C3C", lineHeight: 1, fontWeight: "bold" } },
								{ type: "text", text: ".00", css: { fontSize: 24, color: "#E74C3C", lineHeight: 1, fontWeight: "bold" } },
								{ type: "text", text: "起", css: { fontSize: 24, color: "#E74C3C", lineHeight: 1 } },
							],
						},
						{ type: "text", text: "{{productName}}", css: { left: 30, top: 400, fontSize: 40, color: "#2C3E50", fontWeight: "bold" } },
						{ type: "text", text: "{{productDesc}}", css: { left: 30, top: 450, fontSize: 28, color: "#7F8C8D" } },
					],
				},
				{ type: "qrcode", src: "{{qrcodeUrl}}", css: { left: 255, top: 920, width: 200, height: 200 } },
			],
		},
		data: {
			brandAvatar: "https://picsum.photos/140/140",
			brandName: "优选商城",
			productImage: "https://picsum.photos/600/320",
			productName: "精选有机苹果 5斤装",
			productDesc: "产地直发 新鲜直达",
			originalPrice: "59.9",
			salePrice: "29.9",
			discount: "5",
			qrcodeUrl: "https://stellar-ui.intecloud.com.cn",
		},
	},
	{
		name: "7. 圆角边框",
		description: "测试不同圆角配置：统一值、数组值",
		schema: {
			width: canvasWidth,
			height: canvasHeight,
			views: [
				{ type: "view", css: { left: 40, top: 40, width: 630, height: 160, backgroundColor: "#3498DB", borderRadius: 0 } },
				{ type: "view", css: { left: 40, top: 240, width: 630, height: 160, backgroundColor: "#3498DB", borderRadius: 80 } },
				{ type: "view", css: { left: 40, top: 440, width: 630, height: 160, backgroundColor: "#E74C3C", borderRadius: 16 } },
				{ type: "view", css: { left: 40, top: 640, width: 630, height: 160, backgroundColor: "#2ECC71", borderRadius: [80, 16, 80, 16] } },
				{ type: "view", css: { left: 40, top: 840, width: 300, height: 120, backgroundColor: "#9B59B6", borderRadius: [0, 0, 60, 60] } },
				{ type: "view", css: { right: 40, top: 840, width: 300, height: 120, backgroundColor: "#F39C12", borderRadius: [60, 60, 0, 0] } },
			],
		},
		data: {},
	},
	{
		name: "8. Flex 横向布局",
		description: "测试 flexDirection: row、alignItems、justifyContent",
		schema: {
			width: canvasWidth,
			height: canvasHeight,
			backgroundColor: "#F8F9FA",
			views: [
				{
					type: "view",
					css: {
						left: 40,
						top: 40,
						width: 630,
						height: 180,
						backgroundColor: "#FFFFFF",
						borderRadius: 16,
						display: "flex",
						flexDirection: "row",
						alignItems: "flex-start",
						padding: [16, 16],
					},
					views: [
						{ type: "view", css: { width: 120, height: 60, backgroundColor: "#FF6B6B", borderRadius: 8 } },
						{ type: "view", css: { width: 120, height: 100, backgroundColor: "#4ECDC4", borderRadius: 8, marginLeft: 16 } },
						{ type: "view", css: { width: 120, height: 80, backgroundColor: "#45B7D1", borderRadius: 8, marginLeft: 16 } },
					],
				},
				{
					type: "text",
					text: "↑ row + alignItems: flex-start",
					css: { left: 56, top: 230, fontSize: 22, color: "#6C757D" },
				},
				{
					type: "view",
					css: {
						left: 40,
						top: 270,
						width: 630,
						height: 180,
						backgroundColor: "#FFFFFF",
						borderRadius: 16,
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						padding: [16, 16],
					},
					views: [
						{ type: "view", css: { width: 120, height: 60, backgroundColor: "#FF6B6B", borderRadius: 8 } },
						{ type: "view", css: { width: 120, height: 100, backgroundColor: "#4ECDC4", borderRadius: 8, marginLeft: 16 } },
						{ type: "view", css: { width: 120, height: 80, backgroundColor: "#45B7D1", borderRadius: 8, marginLeft: 16 } },
					],
				},
				{
					type: "text",
					text: "↑ row + alignItems: center",
					css: { left: 56, top: 460, fontSize: 22, color: "#6C757D" },
				},
				{
					type: "view",
					css: {
						left: 40,
						top: 500,
						width: 630,
						height: 180,
						backgroundColor: "#FFFFFF",
						borderRadius: 16,
						display: "flex",
						flexDirection: "row",
						alignItems: "flex-end",
						padding: [16, 16],
					},
					views: [
						{ type: "view", css: { width: 120, height: 60, backgroundColor: "#FF6B6B", borderRadius: 8 } },
						{ type: "view", css: { width: 120, height: 100, backgroundColor: "#4ECDC4", borderRadius: 8, marginLeft: 16 } },
						{ type: "view", css: { width: 120, height: 80, backgroundColor: "#45B7D1", borderRadius: 8, marginLeft: 16 } },
					],
				},
				{
					type: "text",
					text: "↑ row + alignItems: flex-end",
					css: { left: 56, top: 690, fontSize: 22, color: "#6C757D" },
				},
				{
					type: "view",
					css: {
						left: 40,
						top: 730,
						width: 630,
						height: 180,
						backgroundColor: "#FFFFFF",
						borderRadius: 16,
						display: "flex",
						flexDirection: "row",
						justifyContent: "center",
						alignItems: "center",
						padding: [16, 16],
					},
					views: [
						{ type: "view", css: { width: 120, height: 80, backgroundColor: "#E67E22", borderRadius: 8 } },
						{ type: "view", css: { width: 120, height: 80, backgroundColor: "#9B59B6", borderRadius: 8, marginLeft: 16 } },
					],
				},
				{
					type: "text",
					text: "↑ row + justifyContent: center",
					css: { left: 56, top: 920, fontSize: 22, color: "#6C757D" },
				},
				{
					type: "view",
					css: {
						left: 40,
						top: 960,
						width: 630,
						height: 180,
						backgroundColor: "#FFFFFF",
						borderRadius: 16,
						display: "flex",
						flexDirection: "row",
						justifyContent: "space-between",
						alignItems: "center",
						padding: [16, 16],
					},
					views: [
						{ type: "view", css: { width: 120, height: 80, backgroundColor: "#E74C3C", borderRadius: 8 } },
						{ type: "view", css: { width: 120, height: 80, backgroundColor: "#2ECC71", borderRadius: 8 } },
						{ type: "view", css: { width: 120, height: 80, backgroundColor: "#3498DB", borderRadius: 8 } },
					],
				},
				{
					type: "text",
					text: "↑ row + justifyContent: space-between",
					css: { left: 56, top: 1150, fontSize: 22, color: "#6C757D" },
				},
			],
		},
		data: {},
	},
	{
		name: "10. 条码渲染",
		description: "测试 EAN-13 / Code-128 条码生成与样式",
		schema: {
			width: canvasWidth,
			height: canvasHeight,
			views: [
				{
					type: "view",
					css: { left: 40, top: 40, width: 630, height: 320, backgroundColor: "#FFFFFF", borderRadius: 16 },
					views: [
						{ type: "text", text: "EAN-13（自动补校验位）", css: { left: 16, top: 16, fontSize: 24, color: "#6C757D", fontWeight: "bold" } },
						{
							type: "barcode",
							format: "EAN13",
							text: "690102800123",
							css: { left: 40, top: 56, width: 550, height: 220, backgroundColor: "#FFFFFF", color: "#000000" },
						},
					],
				},
				{
					type: "view",
					css: { left: 40, top: 400, width: 630, height: 320, backgroundColor: "#FFFFFF", borderRadius: 16 },
					views: [
						{ type: "text", text: "EAN-13（13 位 + 模板变量）", css: { left: 16, top: 16, fontSize: 24, color: "#6C757D", fontWeight: "bold" } },
						{ type: "barcode", format: "EAN13", text: "{{ean13}}", css: { left: 40, top: 56, width: 550, height: 220, backgroundColor: "#FFFFFF", color: "#1f6feb" } },
					],
				},
				{
					type: "view",
					css: { left: 40, top: 760, width: 630, height: 320, backgroundColor: "#FFFFFF", borderRadius: 16 },
					views: [
						{ type: "text", text: "Code-128（ASCII）", css: { left: 16, top: 16, fontSize: 24, color: "#6C757D", fontWeight: "bold" } },
						{
							type: "barcode",
							format: "CODE128",
							text: "{{sku}}",
							css: { left: 40, top: 56, width: 550, height: 220, backgroundColor: "#FFFFFF", color: "#000000", showText: true, textSize: 22, textColor: "#E74C3C" },
						},
					],
				},
			],
		},
		data: {
			ean13: "5901234123457",
			sku: "SKU-2026-A001",
		},
	},
	{
		name: "9. Flex 纵向布局",
		description: "测试 flexDirection: column、padding、margin",
		schema: {
			width: canvasWidth,
			height: canvasHeight,
			backgroundColor: "#F8F9FA",
			views: [
				{
					type: "view",
					css: { left: 40, top: 40, width: 300, height: 360, backgroundColor: "#FFFFFF", borderRadius: 16, display: "flex", flexDirection: "column", padding: [16, 16] },
					views: [
						{ type: "text", text: "column 基础", css: { fontSize: 20, color: "#6C757D", width: 268, height: 24 } },
						{ type: "text", text: "标题一", css: { fontSize: 32, color: "#2C3E50", fontWeight: "bold", width: 268, height: 32, marginTop: 30 } },
						{ type: "text", text: "标题二", css: { fontSize: 32, color: "#2C3E50", fontWeight: "bold", width: 268, height: 32, marginTop: 20 } },
						{ type: "text", text: "标题三", css: { fontSize: 32, color: "#2C3E50", fontWeight: "bold", width: 268, height: 32, marginTop: 20 } },
					],
				},
				{
					type: "view",
					css: { left: 370, top: 40, width: 300, height: 360, backgroundColor: "#FFFFFF", borderRadius: 16, display: "flex", flexDirection: "column", padding: [20, 20] },
					views: [
						{ type: "text", text: "column + padding", css: { fontSize: 20, color: "#6C757D", width: 260, height: 24 } },
						{ type: "view", css: { width: 240, height: 60, backgroundColor: "#FF6B6B", borderRadius: 8, marginTop: 20 } },
						{ type: "view", css: { width: 240, height: 60, backgroundColor: "#4ECDC4", borderRadius: 8, marginTop: 16 } },
						{ type: "view", css: { width: 240, height: 60, backgroundColor: "#45B7D1", borderRadius: 8, marginTop: 16 } },
					],
				},
				{
					type: "view",
					css: {
						left: 40,
						top: 440,
						width: 630,
						height: 120,
						backgroundColor: "#FFFFFF",
						borderRadius: 16,
						display: "flex",
						flexDirection: "row",
						alignItems: "center",
						padding: [20, 24],
					},
					views: [
						{ type: "view", css: { width: 80, height: 80, backgroundColor: "#E0E0E0", borderRadius: 40 } },
						{ type: "text", text: "{{userName}}", css: { fontSize: 36, color: "#2C3E50", fontWeight: "bold", width: 200, height: 36, marginLeft: 20 } },
					],
				},
				{
					type: "text",
					text: "↑ row + alignItems: center (头像+昵称)",
					css: { left: 56, top: 570, fontSize: 22, color: "#6C757D" },
				},
				{
					type: "view",
					css: {
						left: 40,
						top: 610,
						width: 630,
						height: 140,
						backgroundColor: "#FFFFFF",
						borderRadius: 16,
						display: "flex",
						flexDirection: "row",
						justifyContent: "space-between",
						alignItems: "center",
						padding: [20, 24],
					},
					views: [
						{ type: "view", css: { width: 80, height: 80, backgroundColor: "#E74C3C", borderRadius: 8 } },
						{ type: "view", css: { width: 80, height: 80, backgroundColor: "#F39C12", borderRadius: 8 } },
						{ type: "view", css: { width: 80, height: 80, backgroundColor: "#27AE60", borderRadius: 8 } },
					],
				},
				{
					type: "text",
					text: "↑ row + justifyContent: space-between",
					css: { left: 56, top: 860, fontSize: 22, color: "#6C757D" },
				},
				{
					type: "view",
					css: {
						left: 40,
						top: 800,
						width: 630,
						height: 180,
						backgroundColor: "#FFFFFF",
						borderRadius: 16,
						display: "flex",
						flexDirection: "column",
						justifyContent: "center",
						alignItems: "center",
						padding: [20, 24],
					},
					views: [
						{ type: "view", css: { width: 200, height: 60, backgroundColor: "#3498DB", borderRadius: 8 } },
						{ type: "view", css: { width: 200, height: 60, backgroundColor: "#9B59B6", borderRadius: 8, marginTop: 16 } },
					],
				},
				{
					type: "text",
					text: "↑ column + justifyContent: center + alignItems: center",
					css: { left: 56, top: 1000, fontSize: 22, color: "#6C757D" },
				},
			],
		},
		data: { userName: "王小明" },
	},
];

const canvasSize = computed(() => {
	// 宽度用 vw（浏览器原生，不依赖 uni-app rpx/font-size 换算），高度用 aspect-ratio 由浏览器按宽高比自动算出。
	// 避免 uni-canvas 包装层 height:100% 继承链断裂导致纵向截断。
	const wVw = (displayWidth / 750) * 100; // 600rpx → 80vw
	return {
		width: `${wVw.toFixed(2)}vw`,
		aspectRatio: `${canvasWidth} / ${canvasHeight}`,
	};
});

onBeforeUnmount(() => {
	if (engine) {
		engine.destroy();
		engine = null;
	}
});

function selectTest(index: number) {
	currentTest.value = index;
	message.value = "";
	if (engine) {
		engine.destroy();
	}
	engine = null;
}

function fixCanvasSize() {
	// #ifdef H5
	// uni-app H5 把 <canvas type="2d"> 包成 <uni-canvas>，内部再套 <canvas class="uni-canvas-canvas">。
	// 真机上 height:100% 继承链偶发断裂，导致内部 canvas 只有默认高度、纵向截断。
	// 这里用 JS 取 wrapper 宽度后按设计宽高比直接算出 px 高度，并强制所有相关元素 100% 填满。
	const wrapper = document.querySelector('.canvas-wrapper');
	if (!wrapper) return;
	const rect = wrapper.getBoundingClientRect();
	const targetH = (rect.width * canvasHeight) / canvasWidth;
	wrapper.style.height = `${targetH}px`;
	['uni-canvas', '.uni-canvas-canvas', 'canvas.test-canvas', 'canvas'].forEach((sel) => {
		const el = wrapper.querySelector(sel);
		if (el) {
			el.style.width = '100%';
			el.style.height = '100%';
		}
	});
	// #endif
}

async function renderCanvas() {
	try {
		message.value = "";
		fixCanvasSize();
		const testCase = testCases[currentTest.value];
		uni.showLoading({ title: "渲染中......" });
		const result = await renderPoster({
			schema: testCase.schema,
			data: testCase.data,
			selector: "#testCanvas",
			vm: instance?.proxy,
		});
		engine = result;
		message.value = "渲染成功！";
		messageType.value = "success";
		uni.hideLoading();
	} catch (e: any) {
		console.error("渲染失败:", e);
		message.value = `渲染失败: ${e.message}`;
		messageType.value = "error";
	}
}

async function toTempFilePath() {
	if (!engine) {
		message.value = "请先渲染再保存";
		messageType.value = "error";
		uni.showToast({
			title: "请先渲染",
			icon: "none",
		});
		return;
	}
	try {
		const result = await engine.toTempFilePath();
		if (result) {
			message.value = "导出成功";
			messageType.value = "success";
			exportedUrl.value = result; // H5 下 result 为 dataURL，直接用于页面预览
		} else {
			message.value = "导出失败";
			messageType.value = "error";
		}
	} catch (e: any) {
		console.error("导出失败:", e);
		message.value = `导出失败: ${e.message}`;
		messageType.value = "error";
	}
}

async function saveToAlbum() {
	if (!engine) {
		message.value = "请先渲染再保存";
		messageType.value = "error";
		uni.showToast({
			title: "请先渲染",
			icon: "none",
		});
		return;
	}
	try {
		const result = await engine.saveToAlbum();
		if (result) {
			message.value = "已保存到相册";
			messageType.value = "success";
		} else {
			message.value = "保存失败，用户取消";
			messageType.value = "error";
		}
	} catch (e: any) {
		console.error("保存失败:", e);
		message.value = `保存失败: ${e.message}`;
		messageType.value = "error";
	}
}
</script>

<style scoped>
.container {
	padding: 20rpx;
	background-color: #f5f5f5;
	min-height: 100vh;
}

.test-selector {
	background-color: #fff;
	border-radius: 12rpx;
	padding: 20rpx;
	margin-bottom: 20rpx;
}

.selector-title {
	font-size: 28rpx;
	color: #333;
	font-weight: bold;
	margin-bottom: 16rpx;
}

.selector-list {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
}

.selector-item {
	padding: 12rpx 20rpx;
	font-size: 24rpx;
	background-color: #f0f0f0;
	border-radius: 8rpx;
	color: #666;
}

.selector-item.active {
	background-color: #007aff;
	color: #fff;
}

.canvas-wrapper {
	background-color: #fff;
	border-radius: 12rpx;
	display: block;
	margin: 0 auto 20rpx;
	/* 双保险：行内 canvasSize 已设 aspect-ratio；这里再固定宽度，防止 uni-canvas 内部高度继承链断裂 */
	width: 80vw;
	overflow: visible;
}

/* 强制 uni-canvas 内部及原生 canvas 100% 填满 wrapper */
.canvas-wrapper .uni-canvas-canvas,
.canvas-wrapper canvas.raw-poster-canvas {
	display: block;
	width: 100% !important;
	height: 100% !important;
}

.action-buttons {
	display: flex;
	gap: 20rpx;
	justify-content: center;
	margin-bottom: 20rpx;
}

.message {
	padding: 0 20rpx;
	border-radius: 8rpx;
	text-align: center;
	font-size: 26rpx;
	line-height: 80rpx;
	height: 80rpx;
	margin-bottom: 20rpx;
}

.message.success {
	background-color: #d4edda;
	color: #155724;
}

.message.error {
	background-color: #f8d7da;
	color: #721c24;
}

.export-preview-wrap {
	background-color: #fff;
	border-radius: 12rpx;
	padding: 20rpx;
	margin: 0 auto 20rpx;
	text-align: center;
}

.export-preview-title {
	font-size: 24rpx;
	color: #007aff;
	font-weight: bold;
	margin-bottom: 16rpx;
}

.export-preview {
	width: 100%;
	border: 1rpx solid #eee;
	border-radius: 8rpx;
	display: block;
}
</style>
