import type { CanvasRegion } from '../domain/canvasRegion';
import { verifyFocusedViewport } from '../domain/reviewViewportContract';

export interface EditorCameraPort {
	activateDocument(documentTabId: string): Promise<boolean>;
	fitRegion(documentTabId: string, region: CanvasRegion): Promise<boolean>;
	centerAt(
		documentTabId: string,
		x: number,
		y: number,
	): Promise<CanvasRegion | false>;
}

export interface ExplicitCameraFocusResult {
	viewport: CanvasRegion;
	center: { x: number; y: number };
}

function regionCenter(region: CanvasRegion): { x: number; y: number } {
	return {
		x: (region.left + region.right) / 2,
		y: (region.top + region.bottom) / 2,
	};
}

export async function focusExplicitRegion(input: {
	port: EditorCameraPort;
	documentTabId: string;
	region: CanvasRegion;
}): Promise<ExplicitCameraFocusResult> {
	const activated = await input.port.activateDocument(input.documentTabId);
	if (!activated) {
		throw new Error('原始 PCB 文档已关闭或无法重新激活。');
	}

	const fitted = await input.port.fitRegion(
		input.documentTabId,
		input.region,
	);
	if (!fitted) {
		throw new Error('EasyEDA 拒绝按显式区域执行 PCB 聚焦。');
	}

	const center = regionCenter(input.region);
	const viewport = await input.port.centerAt(
		input.documentTabId,
		center.x,
		center.y,
	);
	if (!viewport) {
		throw new Error('EasyEDA 无法返回显式中心定位后的视口。');
	}

	const verification = verifyFocusedViewport({
		expected: input.region,
		actual: viewport,
	});
	if (!verification.ok) {
		throw new Error([
			'EasyEDA 已接受显式区域定位，但实际视口未满足聚焦契约。',
			...verification.reasons,
			`expected span ${verification.expectedSpan.width.toFixed(1)}×${verification.expectedSpan.height.toFixed(1)} mil`,
			`actual span ${verification.actualSpan.width.toFixed(1)}×${verification.actualSpan.height.toFixed(1)} mil`,
		].join('；'));
	}

	return { viewport, center };
}
