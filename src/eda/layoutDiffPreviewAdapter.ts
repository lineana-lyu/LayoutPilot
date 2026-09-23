import {
	boundsIntersectRegion,
	buildLayoutReviewViewport,
	traceIntersectsRegion,
	viaIntersectsRegion,
	type LayoutReviewComponent,
	type LayoutReviewScene,
	type LayoutReviewTrace,
	type LayoutReviewVia,
} from '../domain/layoutDiffPreview';
import type { LayoutPlan } from '../domain/layoutPlan';
import { collectSimpleBoardBoundary } from './pcbPhysicalAdapter';

function finite(value: number): boolean {
	return Number.isFinite(value);
}

async function readComponentBounds(
	id: string,
): Promise<LayoutReviewComponent['bounds'] | undefined> {
	try {
		const box = await eda.pcb_Primitive.getPrimitivesBBox([id]);
		if (
			box
			&& finite(box.minX)
			&& finite(box.minY)
			&& finite(box.maxX)
			&& finite(box.maxY)
		) {
			return {
				minX: box.minX,
				minY: box.minY,
				maxX: box.maxX,
				maxY: box.maxY,
			};
		}
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to read review component BBox', {
			id,
			error,
		});
	}
	return undefined;
}

export async function collectLayoutReviewScene(
	plan: LayoutPlan,
	itemIndex = 0,
): Promise<LayoutReviewScene> {
	const item = plan.items[itemIndex];
	if (!item) {
		throw new Error('布局方案中不存在可预览项。');
	}

	const [board, ownerBounds, components, lines, vias] = await Promise.all([
		collectSimpleBoardBoundary(),
		readComponentBounds(item.ownerId),
		eda.pcb_PrimitiveComponent.getAll(),
		eda.pcb_PrimitiveLine.getAll(),
		eda.pcb_PrimitiveVia.getAll(),
	]);

	if (!board.ok) {
		throw new Error(`无法建立布局审查板框：${board.reason}`);
	}

	const viewport = buildLayoutReviewViewport(item, ownerBounds);

	const componentShapes = (
		await Promise.all(
			components.map(async component => {
				const id = component.getState_PrimitiveId();
				const bounds = await readComponentBounds(id);
				if (!bounds || !boundsIntersectRegion(bounds, viewport)) {
					return undefined;
				}
				return {
					id,
					designator:
						component.getState_Designator()
						?? component.getState_Name()
						?? id,
					bounds,
				} satisfies LayoutReviewComponent;
			}),
		)
	).filter((value): value is LayoutReviewComponent => Boolean(value));

	const owner = componentShapes.find(component => component.id === item.ownerId)
		?? (ownerBounds
			? {
				id: item.ownerId,
				designator: item.ownerDesignator,
				bounds: ownerBounds,
			}
			: undefined);

	const traces: LayoutReviewTrace[] = lines
		.filter(line => Boolean(line.getState_Net()))
		.map(line => ({
			startX: line.getState_StartX(),
			startY: line.getState_StartY(),
			endX: line.getState_EndX(),
			endY: line.getState_EndY(),
			width: Math.max(1, line.getState_LineWidth()),
		}))
		.filter(trace =>
			finite(trace.startX)
			&& finite(trace.startY)
			&& finite(trace.endX)
			&& finite(trace.endY)
			&& traceIntersectsRegion(trace, viewport)
		);

	const reviewVias: LayoutReviewVia[] = vias
		.filter(via => Boolean(via.getState_Net()))
		.map(via => ({
			x: via.getState_X(),
			y: via.getState_Y(),
			diameter: Math.max(1, via.getState_Diameter()),
		}))
		.filter(via =>
			finite(via.x)
			&& finite(via.y)
			&& viaIntersectsRegion(via, viewport)
		);

	return {
		planId: plan.id,
		itemIndex,
		item,
		viewport,
		boardOuter: board.region.outer.points.map(point => ({ ...point })),
		boardHoles: board.region.holes.map(hole =>
			hole.points.map(point => ({ ...point }))
		),
		components: componentShapes,
		owner,
		traces,
		vias: reviewVias,
	};
}
