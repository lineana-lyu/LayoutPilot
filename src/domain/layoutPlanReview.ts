import type { LayoutPlanItem } from './layoutPlan';

export interface LayoutPlanItemReviewMetrics {
	beforeLoopProxyMil: number;
	afterLoopProxyMil: number;
	deltaMil: number;
	reductionPercent?: number;
	outcome: 'improved' | 'unchanged' | 'worse';
}

export function layoutPlanItemReviewMetrics(
	item: LayoutPlanItem,
): LayoutPlanItemReviewMetrics {
	const beforeLoopProxyMil = item.currentLoopProxyMil;
	const afterLoopProxyMil = item.estimatedLoopProxyMil;
	const deltaMil = afterLoopProxyMil - beforeLoopProxyMil;
	const epsilon = 0.01;
	const outcome = deltaMil < -epsilon
		? 'improved'
		: deltaMil > epsilon
			? 'worse'
			: 'unchanged';
	const reductionPercent = beforeLoopProxyMil > 0
		? ((beforeLoopProxyMil - afterLoopProxyMil) / beforeLoopProxyMil) * 100
		: undefined;

	return {
		beforeLoopProxyMil,
		afterLoopProxyMil,
		deltaMil,
		reductionPercent,
		outcome,
	};
}

export function formatLayoutPlanItemReview(
	item: LayoutPlanItem,
): string {
	const metrics = layoutPlanItemReviewMetrics(item);
	const before = metrics.beforeLoopProxyMil.toFixed(1);
	const after = metrics.afterLoopProxyMil.toFixed(1);
	const ratio = metrics.reductionPercent;

	if (metrics.outcome === 'improved' && ratio !== undefined) {
		return `回路几何代理 ${before} → ${after} mil（降低 ${Math.max(0, ratio).toFixed(1)}%）`;
	}
	if (metrics.outcome === 'worse' && ratio !== undefined) {
		return `回路几何代理 ${before} → ${after} mil（增加 ${Math.abs(ratio).toFixed(1)}%）`;
	}
	return `回路几何代理 ${before} → ${after} mil（基本不变）`;
}
