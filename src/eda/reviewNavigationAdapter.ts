import {
	buildReviewCameraCommand,
	verifyReviewViewport,
} from '../domain/reviewCameraPolicy';
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

export async function activateReviewPcbDocument(
	documentTabId: string,
): Promise<void> {
	const activated = await eda.dmt_EditorControl.activateDocument(documentTabId);
	if (!activated) {
		throw new Error('无法激活布局预览对应的 PCB 文档。');
	}

	const current = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (!current) {
		throw new Error('激活 PCB 后无法读取当前文档信息。');
	}
	if (current.documentType !== EDMT_EditorDocumentType.PCB) {
		throw new Error('布局预览对应的文档已不再是 PCB。');
	}
	if (current.tabId !== documentTabId) {
		throw new Error('PCB 文档激活结果与布局预览冻结的 Tab 不一致。');
	}
}

async function focusReviewCamera(
	documentTabId: string,
	focus: ReviewNavigationFocus,
): Promise<void> {
	const command = buildReviewCameraCommand(focus.region);
	const viewport = await eda.dmt_EditorControl.zoomTo(
		command.centerX,
		command.centerY,
		command.scaleRatio,
		documentTabId,
	);
	if (!viewport) {
		throw new Error('EasyEDA 拒绝执行 PCB 局部定位与放大。');
	}

	const verification = verifyReviewViewport(command, viewport);
	if (!verification.ok) {
		throw new Error([
			'EasyEDA 返回的 PCB 视口不满足定位契约。',
			...verification.reasons,
			'focus ' + verification.focusSpanMil.toFixed(1) + ' mil',
			'viewport ' + verification.viewportSpanMil.toFixed(1) + ' mil',
			'ratio ' + verification.viewportToFocusRatio.toFixed(2),
		].join('；'));
	}
}

export async function navigateReviewToPcb(
	scene: LayoutReviewScene,
	focus: ReviewNavigationFocus,
): Promise<{ documentTabId: string }> {
	// The review scene freezes the source PCB tab at scene-collection time.
	// Cleanup or auxiliary iframe activity must never be allowed to retarget a
	// later click to whichever PCB happens to own focus at that instant.
	const documentTabId = scene.documentTabId;
	await activateReviewPcbDocument(documentTabId);
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

		// One explicit camera command is the final source of truth. Selection and
		// markers are presentation only and never drive the camera.
		await focusReviewCamera(documentTabId, focus);
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
