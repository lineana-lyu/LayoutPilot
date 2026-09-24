import type { CanvasRegion } from './canvasRegion';

export interface ReviewCameraCommand {
	x: number;
	y: number;
	scaleRatio: number;
}

const REFERENCE_CONTEXT_SPAN_MIL = 840;
const REFERENCE_SCALE_PERCENT = 30;
const MIN_SCALE_PERCENT = 18;
const MAX_SCALE_PERCENT = 36;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function buildReviewCameraCommand(
	region: CanvasRegion,
): ReviewCameraCommand {
	const left = Math.min(region.left, region.right);
	const right = Math.max(region.left, region.right);
	const top = Math.min(region.top, region.bottom);
	const bottom = Math.max(region.top, region.bottom);
	if (
		!Number.isFinite(left)
		|| !Number.isFinite(right)
		|| !Number.isFinite(top)
		|| !Number.isFinite(bottom)
		|| right <= left
		|| bottom <= top
	) {
		throw new Error('Review camera region must be finite and have positive area.');
	}

	const spanMil = Math.max(right - left, bottom - top);
	const requestedScale = REFERENCE_SCALE_PERCENT
		* REFERENCE_CONTEXT_SPAN_MIL
		/ spanMil;

	return {
		x: (left + right) / 2,
		y: (top + bottom) / 2,
		scaleRatio: Math.round(
		clamp(requestedScale, MIN_SCALE_PERCENT, MAX_SCALE_PERCENT),
		* 10,
		) / 10,
	};
}
