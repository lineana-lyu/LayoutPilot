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

function focusRegion(
	bounds: CanvasBounds,
	minSpanMil = 460,
): CanvasRegion {
	return paddedCanvasRegion(bounds, {
		marginRatio: 0.28,
		minMarginMil: 72,
		minSpanMil,
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
			region: focusRegion(targetContext, 560),
		};
	}

	if (request.kind === 'current') {
		return {
			kind: 'current',
			region: focusRegion(scene.subject.bounds),
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
		region: focusRegion(component.bounds),
		component,
		selectPrimitiveId: component.id,
	};
}
