export interface CanvasPoint {
	x: number;
	y: number;
}

export interface CanvasBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface CanvasRegion {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

function finite(value: number): boolean {
	return Number.isFinite(value);
}

export function isCanvasBounds(value: CanvasBounds | undefined): value is CanvasBounds {
	return Boolean(
		value
		&& finite(value.minX)
		&& finite(value.minY)
		&& finite(value.maxX)
		&& finite(value.maxY)
		&& value.maxX >= value.minX
		&& value.maxY >= value.minY,
	);
}

export function unionCanvasBounds(
	bounds: Array<CanvasBounds | undefined>,
	points: CanvasPoint[] = [],
): CanvasBounds | undefined {
	const xs: number[] = [];
	const ys: number[] = [];

	for (const box of bounds) {
		if (!isCanvasBounds(box)) continue;
		xs.push(box.minX, box.maxX);
		ys.push(box.minY, box.maxY);
	}

	for (const point of points) {
		if (!finite(point.x) || !finite(point.y)) continue;
		xs.push(point.x);
		ys.push(point.y);
	}

	if (!xs.length || !ys.length) return undefined;

	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
}

export function paddedCanvasRegion(
	bounds: CanvasBounds,
	options?: {
		marginRatio?: number;
		minMarginMil?: number;
		minSpanMil?: number;
	},
): CanvasRegion {
	const marginRatio = options?.marginRatio ?? 0.18;
	const minMarginMil = options?.minMarginMil ?? 80;
	const minSpanMil = options?.minSpanMil ?? 160;

	const width = Math.max(0, bounds.maxX - bounds.minX);
	const height = Math.max(0, bounds.maxY - bounds.minY);
	const horizontalExtra = Math.max(
		minMarginMil,
		width * marginRatio,
		(minSpanMil - width) / 2,
	);
	const verticalExtra = Math.max(
		minMarginMil,
		height * marginRatio,
		(minSpanMil - height) / 2,
	);

	return {
		left: bounds.minX - horizontalExtra,
		right: bounds.maxX + horizontalExtra,
		top: bounds.minY - verticalExtra,
		bottom: bounds.maxY + verticalExtra,
	};
}
