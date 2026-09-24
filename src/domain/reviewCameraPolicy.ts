import type { CanvasRegion } from './canvasRegion';

export interface ReviewCameraCommand {
	centerX: number;
	centerY: number;
	scaleRatio: number;
	focusRegion: CanvasRegion;
}

export interface ReviewViewport {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface ReviewViewportVerification {
	ok: boolean;
	reasons: string[];
	focusSpanMil: number;
	viewportSpanMil: number;
	viewportToFocusRatio: number;
}

const REFERENCE_SPAN_MIL = 560;
const REFERENCE_SCALE_RATIO = 420;
const MIN_SCALE_RATIO = 300;
const MAX_SCALE_RATIO = 500;
const MAX_VIEWPORT_TO_FOCUS_RATIO = 3.6;

function finite(value: number): boolean {
	return Number.isFinite(value);
}

function normalized(region: CanvasRegion): CanvasRegion {
	return {
		left: Math.min(region.left, region.right),
		right: Math.max(region.left, region.right),
		top: Math.min(region.top, region.bottom),
		bottom: Math.max(region.top, region.bottom),
	};
}

function span(region: CanvasRegion): number {
	return Math.max(
		Math.abs(region.right - region.left),
		Math.abs(region.bottom - region.top),
	);
}

function finiteRegion(region: CanvasRegion): boolean {
	return finite(region.left)
		&& finite(region.right)
		&& finite(region.top)
		&& finite(region.bottom);
}

export function buildReviewCameraCommand(
	region: CanvasRegion,
): ReviewCameraCommand {
	const focusRegion = normalized(region);
	if (!finiteRegion(focusRegion)) {
		throw new Error('Review camera region contains non-finite coordinates.');
	}

	const focusSpanMil = span(focusRegion);
	if (!(focusSpanMil > 0)) {
		throw new Error('Review camera region must have a positive span.');
	}

	const requestedScale = REFERENCE_SCALE_RATIO
		* REFERENCE_SPAN_MIL
		/ focusSpanMil;
	const scaleRatio = Math.round(Math.min(
		MAX_SCALE_RATIO,
		Math.max(MIN_SCALE_RATIO, requestedScale),
	));

	return {
		centerX: (focusRegion.left + focusRegion.right) / 2,
		centerY: (focusRegion.top + focusRegion.bottom) / 2,
		scaleRatio,
		focusRegion,
	};
}

export function verifyReviewViewport(
	command: ReviewCameraCommand,
	viewport: ReviewViewport,
): ReviewViewportVerification {
	const actual = normalized(viewport);
	const reasons: string[] = [];
	const focusSpanMil = span(command.focusRegion);
	const viewportSpanMil = span(actual);
	const viewportToFocusRatio = focusSpanMil > 0
		? viewportSpanMil / focusSpanMil
		: Number.POSITIVE_INFINITY;

	if (!finiteRegion(actual) || !(viewportSpanMil > 0)) {
		reasons.push('EasyEDA returned an invalid camera viewport.');
	}

	if (
		command.centerX < actual.left
		|| command.centerX > actual.right
		|| command.centerY < actual.top
		|| command.centerY > actual.bottom
	) {
		reasons.push('The requested review center is outside the returned viewport.');
	}

	if (
		finite(viewportToFocusRatio)
		&& viewportToFocusRatio > MAX_VIEWPORT_TO_FOCUS_RATIO
	) {
		reasons.push(
			'EasyEDA returned a viewport that is too wide for component review.',
		);
	}

	return {
		ok: reasons.length === 0,
		reasons,
		focusSpanMil,
		viewportSpanMil,
		viewportToFocusRatio,
	};
}
