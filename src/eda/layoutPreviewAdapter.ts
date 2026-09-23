import {
	paddedCanvasRegion,
	unionCanvasBounds,
	type CanvasBounds,
	type CanvasRegion,
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

function ownerMarkers(box: CanvasBounds) {
	return boundsMarkers(box);
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
	];
}

function currentMarkers(item: LayoutPlanItem) {
	return boundsMarkers(item.fromBounds);
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

export interface LayoutPreviewFocusOptions {
	region?: CanvasRegion;
	selectPrimitiveId?: string;
}

export async function showLayoutPlanGhost(
	plan: LayoutPlan,
	focus?: LayoutPreviewFocusOptions,
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

	const ownerBounds = await collectOwnerBounds(plan);

	await eda.dmt_EditorControl.generateIndicatorMarkers(
		plan.items.flatMap(currentMarkers),
		{ r: 215, g: 68, b: 68, alpha: 0.92 },
		1,
		false,
		document.tabId,
	);

	if (ownerBounds.length) {
		await eda.dmt_EditorControl.generateIndicatorMarkers(
			ownerBounds.flatMap(ownerMarkers),
			{ r: 138, g: 147, b: 156, alpha: 0.92 },
			2,
			false,
			document.tabId,
		);
	}

	if (plan.items.length) {
		await eda.dmt_EditorControl.generateIndicatorMarkers(
			plan.items.flatMap(targetMarkers),
			{ r: 36, g: 166, b: 106, alpha: 0.96 },
			2,
			false,
			document.tabId,
		);
	}

	let region = focus?.region;
	if (!region) {
		const viewportBounds = unionCanvasBounds(
			[
				...plan.items.flatMap(item => [item.fromBounds, item.toBounds]),
				...ownerBounds,
			],
			plan.items.flatMap(item => [item.from, item.to]),
		);
		if (viewportBounds) {
			region = paddedCanvasRegion(viewportBounds, {
				marginRatio: 0.16,
				minMarginMil: 60,
				minSpanMil: 220,
			});
		}
	}

	if (focus?.selectPrimitiveId) {
		try {
			await eda.pcb_SelectControl.clearSelected();
			await eda.pcb_SelectControl.doSelectPrimitives(
				focus.selectPrimitiveId,
			);
		}
		catch (error) {
			console.warn('[LayoutPilot] unable to select focused review component', {
				primitiveId: focus.selectPrimitiveId,
				error,
			});
		}
	}

	if (region) {
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
