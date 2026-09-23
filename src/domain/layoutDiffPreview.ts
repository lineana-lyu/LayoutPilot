import {
	paddedCanvasRegion,
	unionCanvasBounds,
	type CanvasBounds,
	type CanvasRegion,
} from './canvasRegion';
import type { LayoutPlanItem } from './layoutPlan';
import type { PhysicalComponentSnapshot } from './physicalPlacement';

export type LayoutDiffPreviewMode = 'original' | 'proposed' | 'diff';

export interface LayoutReviewPad {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
}

export interface LayoutReviewComponent {
	id: string;
	designator: string;
	anchor: { x: number; y: number };
	bounds: CanvasBounds;
	layer: string;
	pads: LayoutReviewPad[];
	geometrySource: 'pad-envelope' | 'recentered-bbox';
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
	subject: LayoutReviewComponent;
	subjectTargetBounds: CanvasBounds;
	owner?: LayoutReviewComponent;
	traces: LayoutReviewTrace[];
	vias: LayoutReviewVia[];
}

function finite(value: number): boolean {
	return Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function ensureMinimumSpan(
	min: number,
	max: number,
	anchor: number,
	minSpan = 20,
): { min: number; max: number } {
	if (max - min >= minSpan) return { min, max };
	const half = minSpan / 2;
	return {
		min: anchor - half,
		max: anchor + half,
	};
}

export function buildLayoutReviewComponent(
	component: PhysicalComponentSnapshot,
): LayoutReviewComponent | undefined {
	if (!finite(component.x) || !finite(component.y)) return undefined;

	const pads = component.pads.filter(pad =>
		finite(pad.x) && finite(pad.y)
	);

	if (pads.length) {
		const xs: number[] = [component.x];
		const ys: number[] = [component.y];

		for (const pad of pads) {
			const halfWidth = finite(pad.width) && pad.width > 0
				? pad.width / 2
				: 2;
			const halfHeight = finite(pad.height) && pad.height > 0
				? pad.height / 2
				: 2;
			xs.push(pad.x - halfWidth, pad.x + halfWidth);
			ys.push(pad.y - halfHeight, pad.y + halfHeight);
		}

		let minX = Math.min(...xs);
		let maxX = Math.max(...xs);
		let minY = Math.min(...ys);
		let maxY = Math.max(...ys);

		const span = Math.max(maxX - minX, maxY - minY);
		const margin = clamp(span * 0.04, 3, 12);
		minX -= margin;
		maxX += margin;
		minY -= margin;
		maxY += margin;

		const xSpan = ensureMinimumSpan(minX, maxX, component.x);
		const ySpan = ensureMinimumSpan(minY, maxY, component.y);

		return {
			id: component.id,
			designator: component.designator,
			anchor: { x: component.x, y: component.y },
			layer: component.layer,
			pads: pads.map(pad => ({
				x: pad.x,
				y: pad.y,
				width: pad.width,
				height: pad.height,
				rotation: pad.rotation,
			})),
			bounds: {
				minX: xSpan.min,
				minY: ySpan.min,
				maxX: xSpan.max,
				maxY: ySpan.max,
			},
			geometrySource: 'pad-envelope',
		};
	}

	if (
		component.bounds
		&& finite(component.bounds.minX)
		&& finite(component.bounds.minY)
		&& finite(component.bounds.maxX)
		&& finite(component.bounds.maxY)
	) {
		const width = clamp(
			component.bounds.maxX - component.bounds.minX,
			20,
			320,
		);
		const height = clamp(
			component.bounds.maxY - component.bounds.minY,
			20,
			320,
		);

		return {
			id: component.id,
			designator: component.designator,
			anchor: { x: component.x, y: component.y },
			layer: component.layer,
			pads: [],
			bounds: {
				minX: component.x - width / 2,
				minY: component.y - height / 2,
				maxX: component.x + width / 2,
				maxY: component.y + height / 2,
			},
			geometrySource: 'recentered-bbox',
		};
	}

	return undefined;
}

export function translateReviewBounds(
	bounds: CanvasBounds,
	dx: number,
	dy: number,
): CanvasBounds {
	return {
		minX: bounds.minX + dx,
		minY: bounds.minY + dy,
		maxX: bounds.maxX + dx,
		maxY: bounds.maxY + dy,
	};
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
	subjectCurrentBounds: CanvasBounds,
	ownerBounds?: CanvasBounds,
): CanvasRegion {
	const subjectTargetBounds = translateReviewBounds(
		subjectCurrentBounds,
		item.to.x - item.from.x,
		item.to.y - item.from.y,
	);
	const union = unionCanvasBounds(
		[subjectCurrentBounds, subjectTargetBounds, ownerBounds],
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
