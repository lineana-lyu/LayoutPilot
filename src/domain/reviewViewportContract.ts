import type { CanvasRegion } from './canvasRegion';

export interface ViewportVerification {
	ok: boolean;
	reasons: string[];
	expectedCenter: { x: number; y: number };
	actualCenter: { x: number; y: number };
	expectedSpan: { width: number; height: number };
	actualSpan: { width: number; height: number };
}

function normalized(region: CanvasRegion): CanvasRegion {
	return {
		left: Math.min(region.left, region.right),
		right: Math.max(region.left, region.right),
		top: Math.min(region.top, region.bottom),
		bottom: Math.max(region.top, region.bottom),
	};
}

function finiteRegion(region: CanvasRegion): boolean {
	return Number.isFinite(region.left)
		&& Number.isFinite(region.right)
		&& Number.isFinite(region.top)
		&& Number.isFinite(region.bottom);
}

export function verifyFocusedViewport(input: {
	expected: CanvasRegion;
	actual: CanvasRegion;
	maxSpanRatio?: number;
}): ViewportVerification {
	const maxSpanRatio = input.maxSpanRatio ?? 2.5;
	const expected = normalized(input.expected);
	const actual = normalized(input.actual);
	const expectedCenter = {
		x: (expected.left + expected.right) / 2,
		y: (expected.top + expected.bottom) / 2,
	};
	const actualCenter = {
		x: (actual.left + actual.right) / 2,
		y: (actual.top + actual.bottom) / 2,
	};
	const expectedSpan = {
		width: expected.right - expected.left,
		height: expected.bottom - expected.top,
	};
	const actualSpan = {
		width: actual.right - actual.left,
		height: actual.bottom - actual.top,
	};
	const reasons: string[] = [];

	if (!finiteRegion(expected) || !finiteRegion(actual)) {
		reasons.push('viewport region contains non-finite coordinates');
	}
	if (
		expectedCenter.x < actual.left
		|| expectedCenter.x > actual.right
		|| expectedCenter.y < actual.top
		|| expectedCenter.y > actual.bottom
	) {
		reasons.push('focused target center is outside the actual viewport');
	}
	if (
		expectedSpan.width > 0
		&& actualSpan.width > expectedSpan.width * maxSpanRatio
	) {
		reasons.push('actual viewport is materially wider than the requested focus');
	}
	if (
		expectedSpan.height > 0
		&& actualSpan.height > expectedSpan.height * maxSpanRatio
	) {
		reasons.push('actual viewport is materially taller than the requested focus');
	}

	return {
		ok: reasons.length === 0,
		reasons,
		expectedCenter,
		actualCenter,
		expectedSpan,
		actualSpan,
	};
}
