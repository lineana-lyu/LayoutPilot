import type { LayoutPlan, LayoutPlanItem } from '../domain/layoutPlan';

export interface LayoutPreviewCanvasSession {
	documentTabId: string;
	planId: string;
}

function rectangleMarkers(item: LayoutPlanItem) {
	const box = item.toBounds;
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

function previewCenter(plan: LayoutPlan): { x: number; y: number } {
	const points = plan.items.flatMap(item => [
		item.from,
		item.to,
	]);
	const sum = points.reduce(
		(acc, point) => ({
			x: acc.x + point.x,
			y: acc.y + point.y,
		}),
		{ x: 0, y: 0 },
	);
	return {
		x: sum.x / points.length,
		y: sum.y / points.length,
	};
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

	if (eligibleItems.length) {
		await eda.dmt_EditorControl.generateIndicatorMarkers(
			eligibleItems.flatMap(rectangleMarkers),
			{ r: 64, g: 126, b: 220, alpha: 0.95 },
			2,
			false,
			document.tabId,
		);
	}

	if (previewOnlyItems.length) {
		await eda.dmt_EditorControl.generateIndicatorMarkers(
			previewOnlyItems.flatMap(rectangleMarkers),
			{ r: 196, g: 132, b: 38, alpha: 0.95 },
			2,
			false,
			document.tabId,
		);
	}

	const center = previewCenter(plan);
	try {
		await eda.dmt_EditorControl.zoomTo(
			center.x,
			center.y,
			undefined,
			document.tabId,
		);
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to center layout preview', error);
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
