import type { CanvasBounds, CanvasRegion } from '../domain/canvasRegion';
import { buildFocusedReviewRegions } from '../domain/focusedPlacementCompare';
import type {
	LayoutReviewComponent,
	LayoutReviewPad,
	LayoutReviewScene,
} from '../domain/layoutDiffPreview';

export interface FocusedNativePcbReviewSnapshots {
	documentTabId: string;
	overview: Blob;
	current: Blob;
	proposed: Blob;
	focusWidthMil: number;
	focusHeightMil: number;
}

type Marker = IDMT_IndicatorMarkerShape;

function boundsMarkers(box: CanvasBounds): Marker[] {
	return [
		{
			type: EDMT_IndicatorMarkerType.LINE,
			startX: box.minX,
			startY: box.minY,
			endX: box.maxX,
			endY: box.minY,
		},
		{
			type: EDMT_IndicatorMarkerType.LINE,
			startX: box.maxX,
			startY: box.minY,
			endX: box.maxX,
			endY: box.maxY,
		},
		{
			type: EDMT_IndicatorMarkerType.LINE,
			startX: box.maxX,
			startY: box.maxY,
			endX: box.minX,
			endY: box.maxY,
		},
		{
			type: EDMT_IndicatorMarkerType.LINE,
			startX: box.minX,
			startY: box.maxY,
			endX: box.minX,
			endY: box.minY,
		},
	];
}

function rotatedPadMarkers(
	pad: LayoutReviewPad,
	dx = 0,
	dy = 0,
): Marker[] {
	const cx = pad.x + dx;
	const cy = pad.y + dy;
	const halfW = Math.max(2, pad.width / 2);
	const halfH = Math.max(2, pad.height / 2);
	const angle = (Number.isFinite(pad.rotation) ? pad.rotation : 0)
		* Math.PI / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);

	const point = (x: number, y: number) => ({
		x: cx + x * cos - y * sin,
		y: cy + x * sin + y * cos,
	});
	const corners = [
		point(-halfW, -halfH),
		point(halfW, -halfH),
		point(halfW, halfH),
		point(-halfW, halfH),
	];

	return corners.map((start, index) => {
		const end = corners[(index + 1) % corners.length];
		return {
			type: EDMT_IndicatorMarkerType.LINE,
			startX: start.x,
			startY: start.y,
			endX: end.x,
			endY: end.y,
		};
	});
}

function footprintMarkers(
	component: LayoutReviewComponent,
	dx = 0,
	dy = 0,
): Marker[] {
	if (component.pads.length) {
		return component.pads.flatMap(pad =>
			rotatedPadMarkers(pad, dx, dy)
		);
	}

	return boundsMarkers({
		minX: component.bounds.minX + dx,
		minY: component.bounds.minY + dy,
		maxX: component.bounds.maxX + dx,
		maxY: component.bounds.maxY + dy,
	});
}

function currentMarkers(scene: LayoutReviewScene): Marker[] {
	return [
		...footprintMarkers(scene.subject),
		...boundsMarkers(scene.subject.bounds),
		{
			type: EDMT_IndicatorMarkerType.CIRCLE,
			x: scene.subject.anchor.x,
			y: scene.subject.anchor.y,
			r: 12,
		},
	];
}

function targetMarkers(scene: LayoutReviewScene): Marker[] {
	const dx = scene.item.to.x - scene.subject.anchor.x;
	const dy = scene.item.to.y - scene.subject.anchor.y;
	return [
		...footprintMarkers(scene.subject, dx, dy),
		...boundsMarkers(scene.subjectTargetBounds),
		{
			type: EDMT_IndicatorMarkerType.CIRCLE,
			x: scene.item.to.x,
			y: scene.item.to.y,
			r: 14,
		},
	];
}

function ownerMarkers(scene: LayoutReviewScene): Marker[] {
	if (!scene.owner) return [];
	return [
		...boundsMarkers(scene.owner.bounds),
		{
			type: EDMT_IndicatorMarkerType.CIRCLE,
			x: scene.owner.anchor.x,
			y: scene.owner.anchor.y,
			r: 10,
		},
	];
}

async function settleNativeCanvas(): Promise<void> {
	await new Promise<void>(resolve => {
		window.setTimeout(resolve, 120);
	});
}

async function addMarkers(
	documentTabId: string,
	markers: Marker[],
	color: { r: number; g: number; b: number; alpha: number },
	lineWidth: number,
	errorMessage: string,
): Promise<void> {
	if (!markers.length) return;
	const generated = await eda.dmt_EditorControl.generateIndicatorMarkers(
		markers,
		color,
		lineWidth,
		false,
		documentTabId,
	);
	if (!generated) {
		throw new Error(errorMessage);
	}
}

async function captureRegion(
	documentTabId: string,
	region: CanvasRegion,
	setupMarkers: () => Promise<void>,
): Promise<Blob> {
	await eda.dmt_EditorControl.removeIndicatorMarkers(documentTabId);
	const zoomed = await eda.dmt_EditorControl.zoomToRegion(
		region.left,
		region.right,
		region.top,
		region.bottom,
		documentTabId,
	);
	if (!zoomed) {
		throw new Error('EasyEDA 无法定位布局审查区域。');
	}

	await settleNativeCanvas();
	await setupMarkers();
	await settleNativeCanvas();

	const blob = await eda.dmt_EditorControl.getCurrentRenderedAreaImage(
		documentTabId,
	);
	if (!blob || blob.size <= 0) {
		throw new Error('EasyEDA 未返回可用的 PCB 原生渲染图像。');
	}
	return blob;
}

export async function captureFocusedNativePcbReview(
	scene: LayoutReviewScene,
): Promise<FocusedNativePcbReviewSnapshots> {
	const document = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (!document) {
		throw new Error('无法获取当前 PCB 文档信息。');
	}
	if (document.documentType !== EDMT_EditorDocumentType.PCB) {
		throw new Error('当前活动文档不是 PCB，无法获取原生布局预览。');
	}

	await eda.dmt_EditorControl.activateDocument(document.tabId);
	const regions = buildFocusedReviewRegions(scene);

	try {
		const overview = await captureRegion(
			document.tabId,
			regions.overview,
			async () => {
				await addMarkers(
					document.tabId,
					currentMarkers(scene),
					{ r: 215, g: 68, b: 68, alpha: 0.98 },
					3,
					'EasyEDA 未能生成 CURRENT 总览标记。',
				);
				await addMarkers(
					document.tabId,
					[
						...targetMarkers(scene),
						{
							type: EDMT_IndicatorMarkerType.LINE,
							startX: scene.subject.anchor.x,
							startY: scene.subject.anchor.y,
							endX: scene.item.to.x,
							endY: scene.item.to.y,
						},
					],
					{ r: 36, g: 166, b: 106, alpha: 0.98 },
					3,
					'EasyEDA 未能生成 TARGET 总览标记。',
				);
			},
		);

		const current = await captureRegion(
			document.tabId,
			regions.current,
			async () => {
				await addMarkers(
					document.tabId,
					currentMarkers(scene),
					{ r: 215, g: 68, b: 68, alpha: 0.98 },
					3,
					'EasyEDA 未能生成 CURRENT 局部标记。',
				);
			},
		);

		const proposed = await captureRegion(
			document.tabId,
			regions.proposed,
			async () => {
				await addMarkers(
					document.tabId,
					ownerMarkers(scene),
					{ r: 238, g: 242, b: 246, alpha: 0.95 },
					2,
					'EasyEDA 未能生成 Owner 局部标记。',
				);
				await addMarkers(
					document.tabId,
					targetMarkers(scene),
					{ r: 36, g: 166, b: 106, alpha: 0.98 },
					3,
					'EasyEDA 未能生成 TARGET Footprint Ghost。',
				);
			},
		);

		return {
			documentTabId: document.tabId,
			overview,
			current,
			proposed,
			focusWidthMil: regions.focusWidthMil,
			focusHeightMil: regions.focusHeightMil,
		};
	}
	finally {
		try {
			await eda.dmt_EditorControl.removeIndicatorMarkers(document.tabId);
		}
		catch (error) {
			console.warn('[LayoutPilot] unable to clear focused review markers', {
				documentTabId: document.tabId,
				error,
			});
		}
	}
}
