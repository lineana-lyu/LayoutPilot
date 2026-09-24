import {
	unionCanvasBounds,
	type CanvasBounds,
} from '../domain/canvasRegion';
import { buildReviewCameraCommand } from '../domain/reviewCameraCommand';
import { buildReviewFocusRegion } from '../domain/reviewNavigator';
import {
	buildBoardPolygonsFromSegments,
	buildBoardRegionFromPolygons,
	parseBoardOutlineSource,
	parseSimpleBoardPolygon,
	tessellateBoardArc,
	type BoardPolygon,
	type BoardRegion,
} from '../domain/boardBoundary';
import type { PhysicalComponentSnapshot } from '../domain/physicalPlacement';

function padDimensions(
	shape: unknown,
): { width: number; height: number } | undefined {
	if (!Array.isArray(shape)) return undefined;
	const width = shape[1];
	const height = shape[2] ?? shape[1];
	if (
		typeof width !== 'number'
		|| typeof height !== 'number'
		|| !Number.isFinite(width)
		|| !Number.isFinite(height)
		|| width <= 0
		|| height <= 0
	) {
		return undefined;
	}
	return { width, height };
}

function closeEnough(a: number, b: number, tolerance = 0.01): boolean {
	return Math.abs(a - b) <= tolerance;
}

export async function collectSimpleBoardBoundary(): Promise<
	| { ok: true; region: BoardRegion }
	| { ok: false; reason: string }
> {
	const [polylines, lines, arcs] = await Promise.all([
		eda.pcb_PrimitivePolyline.getAll(),
		eda.pcb_PrimitiveLine.getAll(),
		eda.pcb_PrimitiveArc.getAll(),
	]);

	const outlinePolylines = polylines.filter(
		primitive => primitive.getState_Layer() === EPCB_LayerId.BOARD_OUTLINE,
	);
	const outlineLines = lines.filter(
		primitive => primitive.getState_Layer() === EPCB_LayerId.BOARD_OUTLINE,
	);
	const outlineArcs = arcs.filter(
		primitive => primitive.getState_Layer() === EPCB_LayerId.BOARD_OUTLINE,
	);

	const contours: BoardPolygon[] = [];
	let approximationToleranceMil = 0;
	const outlineSegments = outlineLines.map(line => ({
		start: {
			x: line.getState_StartX(),
			y: line.getState_StartY(),
		},
		end: {
			x: line.getState_EndX(),
			y: line.getState_EndY(),
		},
	}));

	for (const polyline of outlinePolylines) {
		const polygon = polyline.getState_Polygon();
		if (!polygon) {
			return {
				ok: false,
				reason: '检测到 BOARD_OUTLINE polyline，但无法读取其路径数据。',
			};
		}

		const parsed = parseBoardOutlineSource(polygon.getSource());
		if (!parsed.ok) {
			return {
				ok: false,
				reason: `BOARD_OUTLINE polyline 无法安全解析：${parsed.reason}`,
			};
		}
		contours.push(...parsed.closedPolygons);
		outlineSegments.push(...parsed.segments);
		approximationToleranceMil = Math.max(
			approximationToleranceMil,
			parsed.approximationToleranceMil,
		);
	}

	for (const arc of outlineArcs) {
		const tessellated = tessellateBoardArc(
			{
				x: arc.getState_StartX(),
				y: arc.getState_StartY(),
			},
			{
				x: arc.getState_EndX(),
				y: arc.getState_EndY(),
			},
			arc.getState_ArcAngle(),
		);
		if (!tessellated.ok) {
			return {
				ok: false,
				reason: `BOARD_OUTLINE 独立圆弧无法安全解析：${tessellated.reason}`,
			};
		}
		for (let index = 1; index < tessellated.points.length; index += 1) {
			outlineSegments.push({
				start: tessellated.points[index - 1],
				end: tessellated.points[index],
			});
		}
		approximationToleranceMil = Math.max(
			approximationToleranceMil,
			tessellated.approximationToleranceMil,
		);
	}

	const reconstructed = buildBoardPolygonsFromSegments(outlineSegments);
	if (!reconstructed.ok) {
		return reconstructed;
	}
	contours.push(...reconstructed.polygons);

	if (!contours.length) {
		return {
			ok: false,
			reason: '没有找到可验证的 BOARD_OUTLINE 闭合轮廓。',
		};
	}

	return buildBoardRegionFromPolygons(
		contours,
		approximationToleranceMil,
	);
}

export async function collectSimpleComponentKeepouts(): Promise<
	| { ok: true; polygons: BoardPolygon[] }
	| { ok: false; reason: string }
> {
	const regions = await eda.pcb_PrimitiveRegion.getAll();
	const unresolvedRuleRegions = regions.filter(region =>
		region.getState_RuleType().includes(
			EPCB_PrimitiveRegionRuleType.FOLLOW_REGION_RULE,
		),
	);
	if (unresolvedRuleRegions.length) {
		return {
			ok: false,
			reason:
				'检测到 FOLLOW_REGION_RULE 区域；当前版本尚未解析其自定义规则，不能证明该区域允许放置器件。',
		};
	}

	const noComponentRegions = regions.filter(region =>
		region.getState_RuleType().includes(
			EPCB_PrimitiveRegionRuleType.NO_COMPONENTS,
		),
	);

	const polygons: BoardPolygon[] = [];
	for (const region of noComponentRegions) {
		const polygon = region.getState_ComplexPolygon();
		if (!polygon) {
			return {
				ok: false,
				reason: '检测到 NO_COMPONENTS keepout，但无法读取其 polygon。',
			};
		}

		const parsed = parseSimpleBoardPolygon(polygon.getSource());
		if (!parsed.ok) {
			return {
				ok: false,
				reason: `NO_COMPONENTS keepout 无法安全解析：${parsed.reason}`,
			};
		}
		polygons.push(parsed.polygon);
	}

	return { ok: true, polygons };
}

export async function collectPhysicalComponents(
	routingInspectionComponentIds?: string | string[],
): Promise<PhysicalComponentSnapshot[]> {
	const routingInspectionIds = new Set(
		(Array.isArray(routingInspectionComponentIds)
			? routingInspectionComponentIds
			: routingInspectionComponentIds
				? [routingInspectionComponentIds]
				: []
		).filter(Boolean),
	);
	const components = await eda.pcb_PrimitiveComponent.getAll();
	const result: PhysicalComponentSnapshot[] = [];

	for (const component of components) {
		const id = component.getState_PrimitiveId();
		const designator = component.getState_Designator()
			?? component.getState_Name()
			?? id;
		const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(id);
		const physicalPads = [];

		for (const pad of pads ?? []) {
			const dimensions = padDimensions(pad.getState_Pad());
			let connectedPrimitiveCount: number | undefined;

			if (routingInspectionIds.has(id)) {
				try {
					connectedPrimitiveCount = (
						await pad.getConnectedPrimitives(false)
					).length;
				}
				catch (error) {
					console.warn(
						`[LayoutPilot] Unable to inspect routed primitives for ${designator}.${pad.getState_PadNumber()}`,
						error,
					);
					connectedPrimitiveCount = undefined;
				}
			}

			physicalPads.push({
				componentId: id,
				designator,
				padNumber: String(pad.getState_PadNumber() ?? '?'),
				net: pad.getState_Net(),
				x: pad.getState_X(),
				y: pad.getState_Y(),
				width: dimensions?.width ?? 0,
				height: dimensions?.height ?? 0,
				rotation: pad.getState_Rotation(),
				connectedPrimitiveCount,
			});
		}

		let bounds:
			| { minX: number; minY: number; maxX: number; maxY: number }
			| undefined;
		try {
			bounds = await eda.pcb_Primitive.getPrimitivesBBox([id]);
		}
		catch (error) {
			console.warn(
				`[LayoutPilot] Unable to read measured BBox for ${designator}`,
				error,
			);
			bounds = undefined;
		}

		result.push({
			id,
			designator,
			x: component.getState_X(),
			y: component.getState_Y(),
			rotation: component.getState_Rotation(),
			layer: String(component.getState_Layer()),
			locked: component.getState_PrimitiveLock(),
			bounds,
			pads: physicalPads,
		});
	}

	return result;
}

export async function readComponentPhysicalState(
	componentId: string,
): Promise<{
	x: number;
	y: number;
	locked: boolean;
}> {
	const component = await eda.pcb_PrimitiveComponent.get(componentId);
	if (!component) {
		throw new Error(`找不到 PCB 器件：${componentId}`);
	}
	return {
		x: component.getState_X(),
		y: component.getState_Y(),
		locked: component.getState_PrimitiveLock(),
	};
}

export async function moveComponentAndVerify(
	componentId: string,
	x: number,
	y: number,
): Promise<{ x: number; y: number }> {
	const component = await eda.pcb_PrimitiveComponent.get(componentId);
	if (!component) {
		throw new Error(`找不到 PCB 器件：${componentId}`);
	}
	if (component.getState_PrimitiveLock()) {
		throw new Error('器件在执行前被锁定，拒绝移动。');
	}

	const editable = component.toAsync();
	editable.setState_X(x);
	editable.setState_Y(y);
	await editable.done();

	const refreshed = await eda.pcb_PrimitiveComponent.get(componentId);
	if (!refreshed) {
		throw new Error('移动后无法重新读取器件。');
	}

	const actual = {
		x: refreshed.getState_X(),
		y: refreshed.getState_Y(),
	};

	if (!closeEnough(actual.x, x) || !closeEnough(actual.y, y)) {
		throw new Error(
			`坐标回读校验失败：期望 (${x}, ${y})，实际 (${actual.x}, ${actual.y})`,
		);
	}

	return actual;
}


export interface PcbPadEvidenceComponent {
	id: string;
	designator: string;
	pads: Array<{
		padNumber: string;
		net?: string;
		x: number;
		y: number;
	}>;
}

export async function collectPadEvidenceComponents(
	componentIds: string[],
): Promise<PcbPadEvidenceComponent[]> {
	const uniqueIds = [...new Set(componentIds.filter(Boolean))];
	const result: PcbPadEvidenceComponent[] = [];

	for (const id of uniqueIds) {
		const component = await eda.pcb_PrimitiveComponent.get(id);
		if (!component) continue;

		const designator = component.getState_Designator()
			?? component.getState_Name()
			?? id;
		const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(id);

		result.push({
			id,
			designator,
			pads: (pads ?? []).map(pad => ({
				padNumber: String(pad.getState_PadNumber() ?? '?'),
				net: pad.getState_Net(),
				x: pad.getState_X(),
				y: pad.getState_Y(),
			})),
		});
	}

	return result;
}

async function getSelectedPrimitiveIdsCompat(): Promise<string[]> {
	const control = eda.pcb_SelectControl as unknown as {
		getAllSelectedPrimitives_PrimitiveId?: () => Promise<string[]>;
		getSelectedPrimitives_PrimitiveId?: () => Promise<string[]>;
		getAllSelectedPrimitives?: () => Promise<Array<{
			getState_PrimitiveId?: () => string;
		}>>;
		getSelectedPrimitives?: () => Promise<Array<Record<string, unknown>>>;
	};

	if (typeof control.getAllSelectedPrimitives_PrimitiveId === 'function') {
		return await control.getAllSelectedPrimitives_PrimitiveId();
	}

	if (typeof control.getAllSelectedPrimitives === 'function') {
		const primitives = await control.getAllSelectedPrimitives();
		return primitives
			.map(primitive => primitive.getState_PrimitiveId?.())
			.filter((id): id is string => typeof id === 'string' && id.length > 0);
	}

	if (typeof control.getSelectedPrimitives_PrimitiveId === 'function') {
		return await control.getSelectedPrimitives_PrimitiveId();
	}

	if (typeof control.getSelectedPrimitives === 'function') {
		const primitives = await control.getSelectedPrimitives();
		return primitives
			.map(primitive => {
				const candidate = primitive as Record<string, unknown>;
				const stateId = candidate.primitiveId
					?? candidate.PrimitiveId
					?? candidate.id;
				return typeof stateId === 'string' ? stateId : undefined;
			})
			.filter((id): id is string => Boolean(id));
	}

	console.warn(
		'[LayoutPilot] PCB selection read API is unavailable; evidence review will not restore prior selection.',
	);
	return [];
}

export interface PcbEvidenceReviewContext {
	documentTabId: string;
	originalSelectionIds: string[];
}

export async function beginPcbEvidenceReview(input: {
	subjectId: string;
	subjectDesignator: string;
	ownerId: string;
	ownerDesignator: string;
	powerEvidence?: {
		netName: string;
		subjectPadNumber: string;
		ownerPadNumber: string;
		subjectX: number;
		subjectY: number;
		ownerX: number;
		ownerY: number;
	};
}): Promise<PcbEvidenceReviewContext> {
	const document = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (!document) {
		throw new Error('无法获取当前 PCB 文档信息。');
	}
	if (document.documentType !== EDMT_EditorDocumentType.PCB) {
		throw new Error('当前活动文档不是 PCB，无法执行画布定位。');
	}

	const documentTabId = document.tabId;
	const originalSelectionIds = await getSelectedPrimitiveIdsCompat();

	return {
		documentTabId: documentTabId,
		originalSelectionIds: [...originalSelectionIds],
	};
}

export async function endPcbEvidenceReview(input: {
	documentTabId: string;
	originalSelectionIds: readonly string[];
}): Promise<void> {
	await eda.dmt_EditorControl.activateDocument(input.documentTabId);

	try {
		await eda.dmt_EditorControl.removeIndicatorMarkers(input.documentTabId);
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to clear evidence markers', error);
	}

	await eda.pcb_SelectControl.clearSelected();

	if (input.originalSelectionIds.length) {
		try {
			await eda.pcb_SelectControl.doSelectPrimitives(
				[...input.originalSelectionIds],
			);
		}
		catch (error) {
			console.warn(
				'[LayoutPilot] unable to restore previous PCB selection',
				error,
			);
		}
	}
}

async function readPrimitiveBoundsSafe(
	primitiveId: string,
): Promise<CanvasBounds | undefined> {
	try {
		const box = await eda.pcb_Primitive.getPrimitivesBBox([primitiveId]);
		if (
			box
			&& Number.isFinite(box.minX)
			&& Number.isFinite(box.minY)
			&& Number.isFinite(box.maxX)
			&& Number.isFinite(box.maxY)
		) {
			return box;
		}
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to read primitive BBox for evidence focus', {
			primitiveId,
			error,
		});
	}
	return undefined;
}

async function readComponentPointSafe(
	componentId: string,
): Promise<{ x: number; y: number } | undefined> {
	try {
		const component = await eda.pcb_PrimitiveComponent.get(componentId);
		if (!component) return undefined;
		const x = component.getState_X();
		const y = component.getState_Y();
		return Number.isFinite(x) && Number.isFinite(y)
			? { x, y }
			: undefined;
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to read component point for evidence focus', {
			componentId,
			error,
		});
		return undefined;
	}
}

export async function focusPcbEvidence(input: {
	subjectId: string;
	subjectDesignator: string;
	ownerId: string;
	ownerDesignator: string;
	powerEvidence?: {
		netName: string;
		subjectPadNumber: string;
		ownerPadNumber: string;
		subjectX: number;
		subjectY: number;
		ownerX: number;
		ownerY: number;
	};
}, frozenDocumentTabId?: string): Promise<void> {
	const current = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	const documentTabId = frozenDocumentTabId ?? current?.tabId;
	if (!documentTabId) {
		throw new Error('无法确定当前 PCB 文档。');
	}

	const activated = await eda.dmt_EditorControl.activateDocument(documentTabId);
	if (!activated) {
		throw new Error('无法激活证据核对对应的 PCB 文档。');
	}
	const document = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (
		!document
		|| document.documentType !== EDMT_EditorDocumentType.PCB
		|| document.tabId !== documentTabId
	) {
		throw new Error('证据核对对应的 PCB 文档已失效，请重新打开工作台。');
	}

	await eda.pcb_SelectControl.clearSelected();

	try {
		const selected = await eda.pcb_SelectControl.doSelectPrimitives([
			input.subjectId,
			input.ownerId,
		]);
		if (!selected) {
			console.warn(
				'[LayoutPilot] evidence focus selection was not accepted; continuing with explicit viewport framing',
			);
		}
	}
	catch (error) {
		console.warn(
			'[LayoutPilot] evidence focus selection failed; continuing with explicit viewport framing',
			error,
		);
	}

	const [subjectBounds, ownerBounds, subjectPoint, ownerPoint] =
		await Promise.all([
			readPrimitiveBoundsSafe(input.subjectId),
			readPrimitiveBoundsSafe(input.ownerId),
			readComponentPointSafe(input.subjectId),
			readComponentPointSafe(input.ownerId),
		]);
	const evidencePoints = [
		subjectPoint,
		ownerPoint,
		input.powerEvidence
			? { x: input.powerEvidence.subjectX, y: input.powerEvidence.subjectY }
			: undefined,
		input.powerEvidence
			? { x: input.powerEvidence.ownerX, y: input.powerEvidence.ownerY }
			: undefined,
	].filter((point): point is { x: number; y: number } => Boolean(point));
	const focusBounds = unionCanvasBounds(
		[subjectBounds, ownerBounds],
		evidencePoints,
	);
	if (!focusBounds) {
		throw new Error('无法建立 subject / owner 的可靠定位区域。');
	}
	const region = buildReviewFocusRegion(focusBounds, 840);
	const camera = buildReviewCameraCommand(region);
	const zoomed = await eda.dmt_EditorControl.zoomTo(
		camera.x,
		camera.y,
		camera.scaleRatio,
		documentTabId,
	);
	if (!zoomed) {
		throw new Error('嘉立创EDA未能定位并放大到 subject / owner 区域。');
	}

	await eda.dmt_EditorControl.removeIndicatorMarkers(documentTabId);

	if (input.powerEvidence) {
		const {
			subjectX,
			subjectY,
			ownerX,
			ownerY,
		} = input.powerEvidence;

		await eda.dmt_EditorControl.generateIndicatorMarkers(
			[
				{
					type: EDMT_IndicatorMarkerType.CIRCLE,
					x: subjectX,
					y: subjectY,
					r: 24,
				},
				{
					type: EDMT_IndicatorMarkerType.CIRCLE,
					x: ownerX,
					y: ownerY,
					r: 24,
				},
				{
					type: EDMT_IndicatorMarkerType.LINE,
					startX: subjectX,
					startY: subjectY,
					endX: ownerX,
					endY: ownerY,
				},
			],
			{ r: 23, g: 111, b: 189, alpha: 0.92 },
			2,
			false,
			documentTabId,
		);
	}
}
