import type { CanvasRegion } from '../domain/canvasRegion';
import type {
	LayoutReviewComponent,
	LayoutReviewPad,
	LayoutReviewScene,
} from '../domain/layoutDiffPreview';
import type {
	ReviewNavigationFocus,
} from '../domain/reviewNavigator';

function rotatedPadMarkers(
	pad: LayoutReviewPad,
	dx = 0,
	dy = 0,
): IDMT_IndicatorMarkerShape[] {
	const cx = pad.x + dx;
	const cy = pad.y + dy;
	const halfWidth = Math.max(2, pad.width / 2);
	const halfHeight = Math.max(2, pad.height / 2);
	const angle = (Number.isFinite(pad.rotation) ? pad.rotation : 0)
		* Math.PI / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);

	const point = (x: number, y: number) => ({
		x: cx + x * cos - y * sin,
		y: cy + x * sin + y * cos,
	});
	const corners = [
		point(-halfWidth, -halfHeight),
		point(halfWidth, -halfHeight),
		point(halfWidth, halfHeight),
		point(-halfWidth, halfHeight),
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

function boundsMarkers(
	component: LayoutReviewComponent,
	dx = 0,
	dy = 0,
): IDMT_IndicatorMarkerShape[] {
	const box = component.bounds;
	return [
		{
			type: EDMT_IndicatorMarkerType.LINE,
			startX: box.minX + dx,
			startY: box.minY + dy,
			endX: box.maxX + dx,
			endY: box.minY + dy,
		},
		{
			type: EDMT_IndicatorMarkerType.LINE,
			startX: box.maxX + dx,
			startY: box.minY + dy,
			endX: box.maxX + dx,
			endY: box.maxY + dy,
		},
		{
			type: EDMT_IndicatorMarkerType.LINE,
			startX: box.maxX + dx,
			startY: box.maxY + dy,
			endX: box.minX + dx,
			endY: box.maxY + dy,
		},
		{
			type: EDMT_IndicatorMarkerType.LINE,
			startX: box.minX + dx,
			startY: box.maxY + dy,
			endX: box.minX + dx,
			endY: box.minY + dy,
		},
	];
}

function footprintMarkers(
	component: LayoutReviewComponent,
	dx = 0,
	dy = 0,
): IDMT_IndicatorMarkerShape[] {
	return component.pads.length
		? component.pads.flatMap(pad => rotatedPadMarkers(pad, dx, dy))
		: boundsMarkers(component, dx, dy);
}

export function reviewZoomRatio(region: CanvasRegion): number {
	const width = Math.abs(region.right - region.left);
	const height = Math.abs(region.bottom - region.top);
	const span = Math.max(width, height, 1);

	// The last real-board implementation that reliably navigated EasyEDA used
	// an explicit zoom ratio. Keep that call shape, but derive a moderate ratio
	// continuously from the review region instead of threshold jumps.
	const referenceSpanMil = 560;
	const referenceScaleRatio = 350;
	const requested = referenceScaleRatio * referenceSpanMil / span;
	return Math.round(Math.min(450, Math.max(240, requested)));
}

async function focusReviewRegion(
	documentTabId: string,
	region: CanvasRegion,
): Promise<void> {
	const fitted = await eda.dmt_EditorControl.zoomToRegion(
		region.left,
		region.right,
		region.top,
		region.bottom,
		documentTabId,
	);
	if (!fitted) {
		throw new Error('EasyEDA 拒绝定位当前审查区域。');
	}

	const centerX = (region.left + region.right) / 2;
	const centerY = (region.top + region.bottom) / 2;
	const zoomed = await eda.dmt_EditorControl.zoomTo(
		centerX,
		centerY,
		reviewZoomRatio(region),
		documentTabId,
	);
	if (!zoomed) {
		throw new Error('EasyEDA 拒绝执行局部放大。');
	}
}

export async function navigateReviewToPcb(
	scene: LayoutReviewScene,
	focus: ReviewNavigationFocus,
): Promise<{ documentTabId: string }> {
	// The workbench is already hidden before this function runs. Query the
	// editor that actually owns focus at navigation time, exactly as the last
	// real-board working implementation did. Do not infer split-screen state
	// or reject a valid PCB using secondary tab metadata.
	const document = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (!document) {
		throw new Error('无法获取当前 PCB 文档信息。');
	}
	if (document.documentType !== EDMT_EditorDocumentType.PCB) {
		throw new Error('当前活动文档不是 PCB。');
	}

	const documentTabId = document.tabId;
	const activated = await eda.dmt_EditorControl.activateDocument(documentTabId);
	if (!activated) {
		throw new Error('无法激活当前 PCB 文档。');
	}
	await eda.dmt_EditorControl.removeIndicatorMarkers(documentTabId);

	try {
		await eda.pcb_SelectControl.clearSelected();
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to clear PCB selection before review navigation', error);
	}

	try {
		if (focus.selectPrimitiveId) {
			try {
				await eda.pcb_SelectControl.doSelectPrimitives(
					focus.selectPrimitiveId,
				);
			}
			catch (error) {
				console.warn('[LayoutPilot] review navigation selection failed', {
					primitiveId: focus.selectPrimitiveId,
					error,
				});
			}
		}

		if (focus.kind === 'target') {
			const dx = scene.item.to.x - scene.subject.anchor.x;
			const dy = scene.item.to.y - scene.subject.anchor.y;
			const generated = await eda.dmt_EditorControl.generateIndicatorMarkers(
				footprintMarkers(scene.subject, dx, dy),
				{ r: 36, g: 166, b: 106, alpha: 0.98 },
				3,
				false,
				documentTabId,
			);
			if (!generated) {
				throw new Error('EasyEDA 未能生成 TARGET Footprint Ghost。');
			}
		}
		else if (focus.kind === 'current') {
			const generated = await eda.dmt_EditorControl.generateIndicatorMarkers(
				footprintMarkers(scene.subject),
				{ r: 215, g: 68, b: 68, alpha: 0.96 },
				2,
				false,
				documentTabId,
			);
			if (!generated) {
				console.warn('[LayoutPilot] unable to generate CURRENT review marker');
			}
		}

		await focusReviewRegion(documentTabId, focus.region);
		return { documentTabId };
	}
	catch (error) {
		try {
			await eda.dmt_EditorControl.removeIndicatorMarkers(documentTabId);
		}
		catch (cleanupError) {
			console.warn('[LayoutPilot] unable to clear failed review navigation markers', cleanupError);
		}
		throw error;
	}
}
