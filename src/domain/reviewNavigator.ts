import {
	paddedCanvasRegion,
	unionCanvasBounds,
	type CanvasBounds,
	type CanvasRegion,
} from './canvasRegion';
import type {
	LayoutReviewComponent,
	LayoutReviewScene,
} from './layoutDiffPreview';

export type ReviewNavigationKind = 'component' | 'current' | 'target';

export interface ReviewNavigationRequest {
	kind: ReviewNavigationKind;
	componentId?: string;
}

export interface ReviewNavigationFocus {
	kind: ReviewNavigationKind;
	region: CanvasRegion;
	component?: LayoutReviewComponent;
	selectPrimitiveId?: string;
}

const DEFAULT_MIN_CONTEXT_SPAN_MIL = 720;
const TARGET_MIN_CONTEXT_SPAN_MIL = 840;
const MAX_CONTEXT_SPAN_MIL = 1400;
const COMPONENT_CONTEXT_MULTIPLIER = 5;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function buildReviewFocusRegion(
	bounds: CanvasBounds,
	minContextSpanMil = DEFAULT_MIN_CONTEXT_SPAN_MIL,
): CanvasRegion {
	const width = Math.max(0, bounds.maxX - bounds.minX);
	const height = Math.max(0, bounds.maxY - bounds.minY);
	const contentSpan = Math.max(width, height, 1);
	const desiredSpan = clamp(
		contentSpan * COMPONENT_CONTEXT_MULTIPLIER,
		minContextSpanMil,
		MAX_CONTEXT_SPAN_MIL,
	);

	return paddedCanvasRegion(bounds, {
		marginRatio: 0.6,
		minMarginMil: 120,
		minSpanMil: desiredSpan,
	});
}

export function resolveReviewNavigationFocus(
	scene: LayoutReviewScene,
	request: ReviewNavigationRequest,
): ReviewNavigationFocus {
	if (request.kind === 'target') {
		const targetContext = unionCanvasBounds([
			scene.subjectTargetBounds,
			scene.owner?.bounds,
		]) ?? scene.subjectTargetBounds;
		return {
			kind: 'target',
			region: buildReviewFocusRegion(
				targetContext,
				TARGET_MIN_CONTEXT_SPAN_MIL,
			),
		};
	}

	if (request.kind === 'current') {
		return {
			kind: 'current',
			region: buildReviewFocusRegion(scene.subject.bounds),
			component: scene.subject,
			selectPrimitiveId: scene.subject.id,
		};
	}

	if (!request.componentId) {
		throw new Error('缺少要定位的 PCB 器件 ID。');
	}

	const component = scene.components.find(
		item => item.id === request.componentId,
	);
	if (!component) {
		throw new Error('当前布局审查场景中不存在该器件。');
	}

	return {
		kind: 'component',
		region: buildReviewFocusRegion(component.bounds),
		component,
		selectPrimitiveId: component.id,
	};
}
