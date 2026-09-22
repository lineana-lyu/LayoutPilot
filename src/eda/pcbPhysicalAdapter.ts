import {
	buildSimpleBoardPolygonFromSegments,
	parseSimpleBoardPolygon,
	type BoardPolygon,
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
	| { ok: true; polygon: BoardPolygon }
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

	if (outlineArcs.length) {
		return {
			ok: false,
			reason: '当前板框包含独立圆弧；v0.7 不对曲线板框执行自动移动。',
		};
	}

	if (outlinePolylines.length > 1) {
		return {
			ok: false,
			reason: '检测到多个 BOARD_OUTLINE polyline，无法证明不存在多环/镂空。',
		};
	}

	if (outlinePolylines.length === 1) {
		if (outlineLines.length) {
			return {
				ok: false,
				reason: '板框同时存在 polyline 与独立 line，v0.7 不猜测它们的组合关系。',
			};
		}

		const polygon = outlinePolylines[0].getState_Polygon();
		if (!polygon) {
			return {
				ok: false,
				reason: 'BOARD_OUTLINE polyline 缺少 polygon 数据。',
			};
		}

		return parseSimpleBoardPolygon(polygon.getSource());
	}

	if (!outlineLines.length) {
		return {
			ok: false,
			reason: '没有找到可验证的 BOARD_OUTLINE。',
		};
	}

	return buildSimpleBoardPolygonFromSegments(
		outlineLines.map(line => ({
			start: {
				x: line.getState_StartX(),
				y: line.getState_StartY(),
			},
			end: {
				x: line.getState_EndX(),
				y: line.getState_EndY(),
			},
		})),
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
				'检测到 FOLLOW_REGION_RULE 区域；v0.7 尚未解析其自定义规则，不能证明该区域允许放置器件。',
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
	routingInspectionComponentId?: string,
): Promise<PhysicalComponentSnapshot[]> {
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

			if (id === routingInspectionComponentId) {
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
