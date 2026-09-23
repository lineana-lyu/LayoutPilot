import {
	paddedCanvasRegion,
	unionCanvasBounds,
	type CanvasBounds,
	type CanvasRegion,
} from './canvasRegion';
import type { LayoutPlanItem } from './layoutPlan';

export type LayoutDiffPreviewMode = 'original' | 'proposed' | 'diff';

export interface LayoutReviewComponent {
	id: string;
	designator: string;
	bounds: CanvasBounds;
}

export interface LayoutReviewTrace {
	startX: number;
	startY: number;
	endX: number;
	endY: number;
	width: number;
}

export interface LayoutReviewVia {
	x: number;
	y: number;
	diameter: number;
}

export interface LayoutReviewScene {
	planId: string;
	itemIndex: number;
	item: LayoutPlanItem;
	viewport: CanvasRegion;
	boardOuter: Array<{ x: number; y: number }>;
	boardHoles: Array<Array<{ x: number; y: number }>>;
	components: LayoutReviewComponent[];
	owner?: LayoutReviewComponent;
	traces: LayoutReviewTrace[];
	vias: LayoutReviewVia[];
}

export function boundsIntersectRegion(
	bounds: CanvasBounds,
	region: CanvasRegion,
): boolean {
	return !(
		bounds.maxX < region.left
		|| bounds.minX > region.right
		|| bounds.maxY < region.top
		|| bounds.minY > region.bottom
	);
}

export function traceIntersectsRegion(
	trace: LayoutReviewTrace,
	region: CanvasRegion,
): boolean {
	const bounds = {
		minX: Math.min(trace.startX, trace.endX),
		minY: Math.min(trace.startY, trace.endY),
		maxX: Math.max(trace.startX, trace.endX),
		maxY: Math.max(trace.startY, trace.endY),
	};
	return boundsIntersectRegion(bounds, region);
}

export function viaIntersectsRegion(
	via: LayoutReviewVia,
	region: CanvasRegion,
): boolean {
	const radius = Math.max(0, via.diameter) / 2;
	return boundsIntersectRegion(
		{
			minX: via.x - radius,
			minY: via.y - radius,
			maxX: via.x + radius,
			maxY: via.y + radius,
		},
		region,
	);
}

export function buildLayoutReviewViewport(
	item: LayoutPlanItem,
	ownerBounds?: CanvasBounds,
): CanvasRegion {
	const union = unionCanvasBounds(
		[item.fromBounds, item.toBounds, ownerBounds],
		[item.from, item.to],
	);
	if (!union) {
		throw new Error('无法建立布局审查视口。');
	}

	return paddedCanvasRegion(union, {
		marginRatio: 0.24,
		minMarginMil: 100,
		minSpanMil: 520,
	});
}
