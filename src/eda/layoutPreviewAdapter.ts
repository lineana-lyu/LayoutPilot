import {
	paddedCanvasRegion,
	unionCanvasBounds,
	type CanvasBounds,
} from '../domain/canvasRegion';
import type { LayoutPlan, LayoutPlanItem } from '../domain/layoutPlan';

export interface LayoutPreviewCanvasSession {
	documentTabId: string;
	planId: string;
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

function targetMarkers(item: LayoutPlanItem) {
	return [
		...boundsMarkers(item.toBounds),
		{
			type: EDMT_IndicatorMarkerType.LINE,
			startX: item.from.x,
			startY: item.from.y,
			endX: item.to.x,
			endY: item.to.y,
		},
		{
			type: EDMT_IndicatorMarkerType.CIRCLE,
			x: item.to.x,
			y: item.to.y,
			r: 18,
		},
	];
}

function currentMarkers(item: LayoutPlanItem) {
	return [
		...boundsMarkers(item.fromBounds),
		{
			type: EDMT_IndicatorMarkerType.CIRCLE,
			x: item.from.x,
			y: item.from.y,
			r: 12,
		},
	];
}

async function collectOwnerBounds(plan: LayoutPlan): Promise<CanvasBounds[]> {
	const ownerIds = [...new Set(plan.items.map(item => item.ownerId))];
	const bounds: CanvasBounds[] = [];

	for (const ownerId of ownerIds) {
		try {
			const box = await eda.pcb_Primitive.getPrimitivesBBox([ownerId]);
			if (
				box
				&& Number.isFinite(box.minX)
				&& Number.isFinite(box.minY)
				&& Number.isFinite(box.maxX)
				&& Number.isFinite(box.maxY)
			) {
				bounds.push(box);
			}
		}
		catch (error) {
			console.warn('[LayoutPilot] unable to read Owner BBox for preview', {
				ownerId,
				error,
			});
		}
	}

	return bounds;
}

export async function showLayoutPlanGhost(
	plan: LayoutPlan,
): Promise<LayoutPreviewCanvasSession> {
	const document = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (!document) {
		throw new Error('无法获取当前 PCB 文档信息。');
	}
	if (document.documentType !== EDMT_EditorDocumentType.PCB) {
		throw new Error('当前活动文档不是 PCB，无法显示布局预览。');
	}

	await eda.dmt_EditorControl.activateDocument(document.tabId);
	await eda.dmt_EditorControl.removeIndicatorMarkers(document.tabId);

	const eligibleItems = plan.items.filter(
		item => item.executionBlockers.length === 0,
	);
	const previewOnlyItems = plan.items.filter(
		item => item.executionBlockers.length > 0,
	);
	const ownerBounds = await collectOwnerBounds(plan);

	await eda.dmt_EditorControl.generateIndicatorMarkers(
		plan.items.flatMap(currentMarkers),
		{ r: 116, g: 126, b: 139, alpha: 0.85 },
		1,
		false,
		document.tabId,
	);

	if (ownerBounds.length) {
		await eda.dmt_EditorControl.generateIndicatorMarkers(
			ownerBounds.flatMap(boundsMarkers),
			{ r: 35, g: 130, b: 95, alpha: 0.95 },
			2,
			false,
			document.tabId,
		);
	}

	if (eligibleItems.length) {
		await eda.dmt_EditorControl.generateIndicatorMarkers(
			eligibleItems.flatMap(targetMarkers),
			{ r: 64, g: 126, b: 220, alpha: 0.95 },
			2,
			false,
			document.tabId,
		);
	}

	if (previewOnlyItems.length) {
		await eda.dmt_EditorControl.generateIndicatorMarkers(
			previewOnlyItems.flatMap(targetMarkers),
			{ r: 196, g: 132, b: 38, alpha: 0.95 },
			2,
			false,
			document.tabId,
		);
	}

	const viewportBounds = unionCanvasBounds(
		[
			...plan.items.flatMap(item => [item.fromBounds, item.toBounds]),
			...ownerBounds,
		],
		plan.items.flatMap(item => [item.from, item.to]),
	);
	if (viewportBounds) {
		const region = paddedCanvasRegion(viewportBounds, {
			marginRatio: 0.16,
			minMarginMil: 60,
			minSpanMil: 220,
		});
		try {
			const zoomed = await eda.dmt_EditorControl.zoomToRegion(
				region.left,
				region.right,
				region.top,
				region.bottom,
				document.tabId,
			);
			if (!zoomed) {
				console.warn('[LayoutPilot] layout preview region zoom was rejected');
			}
		}
		catch (error) {
			console.warn('[LayoutPilot] unable to frame layout preview', error);
		}
	}

	return {
		documentTabId: document.tabId,
		planId: plan.id,
	};
}

export async function clearLayoutPlanGhost(
	session: LayoutPreviewCanvasSession,
): Promise<void> {
	try {
		await eda.dmt_EditorControl.activateDocument(session.documentTabId);
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to reactivate preview document', error);
	}

	try {
		await eda.dmt_EditorControl.removeIndicatorMarkers(session.documentTabId);
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to clear layout preview markers', error);
	}
}
