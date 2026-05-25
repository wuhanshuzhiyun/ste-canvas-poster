const NARROW_CHARS = new Set([
	0x69, 0x6c, 0x6a, 0x74, 0x66, 0x72, 0x2e, 0x2c, 0x3b, 0x3a, 0x21, 0x7c, 0x27, 0x60, 0xb4, 0x5e, 0x7e, 0x28, 0x29,
	0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x5c, 0x2d, 0x5f, 0x31,
]);

const WIDE_CHARS = new Set([
	0x57, 0x4d, 0x40, 0x25, 0x26, 0x6d, 0x77, 0x4f, 0x51, 0x44, 0x48, 0x47, 0x4e, 0x52, 0x55, 0x56,
]);

function isFullWidth(code) {
	return (
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x3000 && code <= 0x303f) ||
		(code >= 0xff01 && code <= 0xff60) ||
		(code >= 0xfe30 && code <= 0xfe6f) ||
		(code >= 0x2e80 && code <= 0x2fdf) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0x2f800 && code <= 0x2fa1f) ||
		(code >= 0xac00 && code <= 0xd7af) ||
		(code >= 0x3040 && code <= 0x309f) ||
		(code >= 0x30a0 && code <= 0x30ff) ||
		(code >= 0xa000 && code <= 0xa48f) ||
		(code >= 0xa490 && code <= 0xa4cf)
	);
}

function getCharWidthRatio(code) {
	if (isFullWidth(code)) return 1.0;
	if (NARROW_CHARS.has(code)) return 0.33;
	if (WIDE_CHARS.has(code)) return 0.78;
	if (code >= 0x30 && code <= 0x39) return 0.55;
	if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return 0.58;
	if (code >= 0xc0 && code <= 0x24f) return 0.6;
	if (code >= 0x2018 && code <= 0x201d) return 0.55;
	if (code === 0x3000) return 1.0;
	if (code === 0x200b || code === 0xfeff) return 0;
	return 0.55;
}

/**
 * 计算文本宽度
 */
export function measureText(text, fontSize, bold = false) {
	if (!text || typeof text !== 'string') return 0;
	let width = 0;
	for (const char of text) {
		const code = char.codePointAt(0);
		width += getCharWidthRatio(code) * fontSize;
	}
	if (bold) width *= 1.06;
	return Math.ceil(width);
}
