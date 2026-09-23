import {
	boundsIntersectRegion,
	buildLayoutReviewComponent,
	buildLayoutReviewViewport,
	traceIntersectsRegion,
	translateReviewBounds,
	viaIntersectsRegion,
	type LayoutReviewComponent,
	type LayoutReviewScene,
	type LayoutReviewTrace,
	type LayoutReviewVia,
} from '../domain/layoutDiffPreview';
import type { LayoutPlan } from '../domain/layoutPlan';
import {
	collectPhysicalComponents,
	collectSimpleBoardBoundary,
} from './pcbPhysicalAdapter';

function finite(value: number): boolean {
	return Number.isFinite(value);
}

export async function collectLayoutReviewScene(
	plan: LayoutPlan,
	itemIndex = 0,
): Promise<LayoutReviewScene> {
	const item = plan.items[itemIndex];
	if (!item) {
		throw new Error('布局方案中不存在可预览项。');
	}

	const [board, physicalComponents, lines, vias] = await Promise.all([
		collectSimpleBoardBoundary(),
		collectPhysicalComponents(),
		eda.pcb_PrimitiveLine.getAll(),
		eda.pcb_PrimitiveVia.getAll(),
	]);

	if (!board.ok) {
		throw new Error(`无法建立布局审查板框：${board.reason}`);
	}

	const allComponentShapes = physicalComponents
		.map(buildLayoutReviewComponent)
		.filter((value): value is LayoutReviewComponent => Boolean(value));

	const subject = allComponentShapes.find(
		component => component.id === item.subjectId,
	);
	if (!subject) {
		throw new Error(`无法建立 ${item.subjectDesignator} 的审查显示几何。`);
	}
	const owner = allComponentShapes.find(
		component => component.id === item.ownerId,
	);

	const viewport = buildLayoutReviewViewport(
		item,
		subject.bounds,
		owner?.bounds,
	);
	const componentShapes = allComponentShapes.filter(component =>
		boundsIntersectRegion(component.bounds, viewport)
	);
	const subjectTargetBounds = translateReviewBounds(
		subject.bounds,
		item.to.x - item.from.x,
		item.to.y - item.from.y,
	);

	const traces: LayoutReviewTrace[] = lines
		.filter(line => Boolean(line.getState_Net()))
		.map(line => ({
			startX: line.getState_StartX(),
			startY: line.getState_StartY(),
			endX: line.getState_EndX(),
			endY: line.getState_EndY(),
			width: Math.max(1, line.getState_LineWidth()),
			layer: String(line.getState_Layer() ?? ''),
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
		subject,
		subjectTargetBounds,
		owner,
		traces,
		vias: reviewVias,
	};
}
