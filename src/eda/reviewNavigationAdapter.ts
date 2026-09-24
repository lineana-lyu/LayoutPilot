import type { CanvasRegion } from '../domain/canvasRegion';
import type {
	LayoutReviewComponent,
	LayoutReviewPad,
	LayoutReviewScene,
} from '../domain/layoutDiffPreview';
import type {
	ReviewNavigationFocus,
} from '../domain/reviewNavigator';
import { verifyFocusedViewport } from '../domain/reviewViewportContract';

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

async function readViewport(
	documentTabId: string,
): Promise<CanvasRegion> {
	const viewport = await eda.dmt_EditorControl.zoomTo(
		undefined,
		undefined,
		undefined,
		documentTabId,
	);
	if (!viewport) {
		throw new Error('EasyEDA 无法回读当前 PCB 视口，不能确认定位是否真实生效。');
	}
	return viewport;
}

async function zoomToRegionVerified(
	documentTabId: string,
	region: CanvasRegion,
): Promise<CanvasRegion> {
	let lastDiagnostic = 'unknown viewport state';

	for (let attempt = 0; attempt < 2; attempt += 1) {
		const activated = await eda.dmt_EditorControl.activateDocument(documentTabId);
		if (!activated) {
			throw new Error('定位过程中 PCB 文档失去激活状态。');
		}

		const zoomed = await eda.dmt_EditorControl.zoomToRegion(
			region.left,
			region.right,
			region.top,
			region.bottom,
			documentTabId,
		);
		if (!zoomed) {
			lastDiagnostic = 'zoomToRegion returned false';
			continue;
		}

		const actual = await readViewport(documentTabId);
		const verification = verifyFocusedViewport({
			expected: region,
			actual,
		});
		if (verification.ok) {
			return actual;
		}
		lastDiagnostic = [
			...verification.reasons,
			`expected span ${verification.expectedSpan.width.toFixed(1)}×${verification.expectedSpan.height.toFixed(1)} mil`,
			`actual span ${verification.actualSpan.width.toFixed(1)}×${verification.actualSpan.height.toFixed(1)} mil`,
		].join('；');
	}

	throw new Error(
		`EasyEDA 返回定位成功，但视口回读未满足聚焦条件：${lastDiagnostic}`,
	);
}

export async function navigateReviewToPcb(
	scene: LayoutReviewScene,
	focus: ReviewNavigationFocus,
): Promise<{ documentTabId: string }> {
	const documentTabId = scene.documentTabId;
	if (!documentTabId) {
		throw new Error('布局审查场景缺少冻结的 PCB Tab ID。');
	}

	const activated = await eda.dmt_EditorControl.activateDocument(documentTabId);
	if (!activated) {
		throw new Error('原始 PCB 文档已关闭或无法重新激活，请重新生成布局预览。');
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
				const selected = await eda.pcb_SelectControl.doSelectPrimitives(
					focus.selectPrimitiveId,
				);
				if (selected) {
					// Seed the host editor with a primitive-based focus first. The
					// bounded context region below is still authoritative, but this
					// prevents a stale whole-board viewport from winning the first
					// focus race after the workbench window is hidden.
					await eda.dmt_EditorControl.zoomToSelectedPrimitives(documentTabId);
				}
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
			const markers = footprintMarkers(
				scene.subject,
				dx,
				dy,
			);

			const generated = await eda.dmt_EditorControl.generateIndicatorMarkers(
				markers,
				{ r: 36, g: 166, b: 106, alpha: 0.98 },
				3,
				true,
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

		await zoomToRegionVerified(documentTabId, focus.region);

		return {
			documentTabId,
		};
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
