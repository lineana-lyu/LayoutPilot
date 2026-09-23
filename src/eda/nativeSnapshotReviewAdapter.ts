import type {
	LayoutDiffPreviewMode,
	LayoutReviewScene,
} from '../domain/layoutDiffPreview';
import type { CanvasBounds } from '../domain/canvasRegion';

export interface NativePcbReviewSnapshotSet {
	documentTabId: string;
	images: Record<LayoutDiffPreviewMode, Blob>;
}

function boundsMarkers(box: CanvasBounds) {
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

function currentMarkers(scene: LayoutReviewScene) {
	return [
		...boundsMarkers(scene.subject.bounds),
		{
			type: EDMT_IndicatorMarkerType.CIRCLE,
			x: scene.subject.anchor.x,
			y: scene.subject.anchor.y,
			r: 14,
		},
	];
}

function targetMarkers(scene: LayoutReviewScene, includeMovement: boolean) {
	return [
		...boundsMarkers(scene.subjectTargetBounds),
		...(includeMovement
			? [{
				type: EDMT_IndicatorMarkerType.LINE,
				startX: scene.subject.anchor.x,
				startY: scene.subject.anchor.y,
				endX: scene.item.to.x,
				endY: scene.item.to.y,
			}]
			: []),
		{
			type: EDMT_IndicatorMarkerType.CIRCLE,
			x: scene.item.to.x,
			y: scene.item.to.y,
			r: 18,
		},
	];
}

function ownerMarkers(scene: LayoutReviewScene) {
	if (!scene.owner) return [];
	return [
		...boundsMarkers(scene.owner.bounds),
		{
			type: EDMT_IndicatorMarkerType.CIRCLE,
			x: scene.owner.anchor.x,
			y: scene.owner.anchor.y,
			r: 12,
		},
	];
}

async function settleNativeCanvas(): Promise<void> {
	await new Promise<void>(resolve => {
		window.setTimeout(resolve, 90);
	});
}

async function captureRenderedFrame(
	documentTabId: string,
	mode: LayoutDiffPreviewMode,
	scene: LayoutReviewScene,
): Promise<Blob> {
	await eda.dmt_EditorControl.removeIndicatorMarkers(documentTabId);

	const owners = ownerMarkers(scene);
	if (owners.length) {
		const generated = await eda.dmt_EditorControl.generateIndicatorMarkers(
			owners,
			{ r: 138, g: 147, b: 156, alpha: 0.9 },
			2,
			false,
			documentTabId,
		);
		if (!generated) {
			throw new Error(`${mode}: EasyEDA 未能生成 Owner 审查标记。`);
		}
	}

	if (mode !== 'proposed') {
		const generated = await eda.dmt_EditorControl.generateIndicatorMarkers(
			currentMarkers(scene),
			{ r: 215, g: 68, b: 68, alpha: 0.96 },
			3,
			false,
			documentTabId,
		);
		if (!generated) {
			throw new Error(`${mode}: EasyEDA 未能生成 CURRENT 审查标记。`);
		}
	}

	if (mode !== 'original') {
		const generated = await eda.dmt_EditorControl.generateIndicatorMarkers(
			targetMarkers(scene, mode === 'diff'),
			{ r: 36, g: 166, b: 106, alpha: 0.96 },
			3,
			false,
			documentTabId,
		);
		if (!generated) {
			throw new Error(`${mode}: EasyEDA 未能生成 TARGET 审查标记。`);
		}
	}

	await settleNativeCanvas();

	const blob = await eda.dmt_EditorControl.getCurrentRenderedAreaImage(
		documentTabId,
	);
	if (!blob || blob.size <= 0) {
		throw new Error(`${mode}: EasyEDA 未返回可用的 PCB 原生渲染图像。`);
	}
	return blob;
}

export async function captureNativePcbReviewSnapshots(
	scene: LayoutReviewScene,
): Promise<NativePcbReviewSnapshotSet> {
	const document = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (!document) {
		throw new Error('无法获取当前 PCB 文档信息。');
	}
	if (document.documentType !== EDMT_EditorDocumentType.PCB) {
		throw new Error('当前活动文档不是 PCB，无法获取原生布局预览。');
	}

	await eda.dmt_EditorControl.activateDocument(document.tabId);

	try {
		const zoomed = await eda.dmt_EditorControl.zoomToRegion(
			scene.viewport.left,
			scene.viewport.right,
			scene.viewport.top,
			scene.viewport.bottom,
			document.tabId,
		);
		if (!zoomed) {
			throw new Error('EasyEDA 无法定位布局审查区域。');
		}

		await settleNativeCanvas();

		const original = await captureRenderedFrame(
			document.tabId,
			'original',
			scene,
		);
		const proposed = await captureRenderedFrame(
			document.tabId,
			'proposed',
			scene,
		);
		const diff = await captureRenderedFrame(
			document.tabId,
			'diff',
			scene,
		);

		return {
			documentTabId: document.tabId,
			images: {
				original,
				proposed,
				diff,
			},
		};
	}
	finally {
		try {
			await eda.dmt_EditorControl.removeIndicatorMarkers(document.tabId);
		}
		catch (error) {
			console.warn('[LayoutPilot] unable to clear native snapshot markers', {
				documentTabId: document.tabId,
				error,
			});
		}
	}
}
