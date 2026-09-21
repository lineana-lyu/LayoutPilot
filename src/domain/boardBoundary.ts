export interface BoardPoint {
	x: number;
	y: number;
}

export interface BoardPolygon {
	points: BoardPoint[];
}

export type BoardPolygonParseResult =
	| { ok: true; polygon: BoardPolygon }
	| { ok: false; reason: string };

interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const EPSILON = 1e-6;

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function samePoint(a: BoardPoint, b: BoardPoint): boolean {
	return Math.abs(a.x - b.x) <= EPSILON
		&& Math.abs(a.y - b.y) <= EPSILON;
}

function normalizePoints(points: BoardPoint[]): BoardPoint[] {
	const result: BoardPoint[] = [];
	for (const point of points) {
		if (!result.length || !samePoint(result[result.length - 1], point)) {
			result.push(point);
		}
	}
	if (
		result.length >= 2
		&& samePoint(result[0], result[result.length - 1])
	) {
		result.pop();
	}
	return result;
}

export function parseSimpleBoardPolygon(
	source: unknown,
): BoardPolygonParseResult {
	if (!Array.isArray(source) || !source.length) {
		return { ok: false, reason: '板框 polygon source 为空或格式未知' };
	}

	if (source.some(token =>
		token === 'ARC'
		|| token === 'CARC'
		|| token === 'C'
		|| token === 'CIRCLE'
	)) {
		return {
			ok: false,
			reason: 'v0.7 不对含圆弧/贝塞尔/圆形的复杂板框执行自动移动',
		};
	}

	if (source[0] === 'R') {
		const [x, y, width, height, rotation, round] = source.slice(1, 7);
		if (
			!isFiniteNumber(x)
			|| !isFiniteNumber(y)
			|| !isFiniteNumber(width)
			|| !isFiniteNumber(height)
		) {
			return { ok: false, reason: '矩形板框参数不完整' };
		}
		if (
			(isFiniteNumber(rotation) && Math.abs(rotation) > EPSILON)
			|| (isFiniteNumber(round) && Math.abs(round) > EPSILON)
		) {
			return {
				ok: false,
				reason: 'v0.7 不对旋转或圆角矩形板框执行自动移动',
			};
		}

		return {
			ok: true,
			polygon: {
				points: normalizePoints([
					{ x, y },
					{ x: x + width, y },
					{ x: x + width, y: y - height },
					{ x, y: y - height },
				]),
			},
		};
	}

	const points: BoardPoint[] = [];
	let index = 0;

	if (isFiniteNumber(source[0]) && isFiniteNumber(source[1])) {
		points.push({ x: source[0], y: source[1] });
		index = 2;
	}

	while (index < source.length) {
		const token = source[index++];
		if (token !== 'L') {
			return {
				ok: false,
				reason: `v0.7 无法可靠解析板框命令：${String(token)}`,
			};
		}

		let added = 0;
		while (
			isFiniteNumber(source[index])
			&& isFiniteNumber(source[index + 1])
		) {
			points.push({
				x: source[index] as number,
				y: source[index + 1] as number,
			});
			index += 2;
			added += 1;
		}

		if (!added) {
			return { ok: false, reason: '板框 L 命令缺少坐标' };
		}
	}

	const normalized = normalizePoints(points);
	if (normalized.length < 3) {
		return { ok: false, reason: '板框有效顶点少于 3 个' };
	}

	return {
		ok: true,
		polygon: { points: normalized },
	};
}


export interface BoardSegment {
	start: BoardPoint;
	end: BoardPoint;
}

export function buildSimpleBoardPolygonFromSegments(
	segments: BoardSegment[],
): BoardPolygonParseResult {
	if (segments.length < 3) {
		return { ok: false, reason: '板框线段少于 3 条' };
	}

	const unused = [...segments];
	const first = unused.shift()!;
	const points: BoardPoint[] = [{ ...first.start }, { ...first.end }];
	let current = first.end;

	while (unused.length) {
		const nextIndex = unused.findIndex(segment =>
			samePoint(segment.start, current)
			|| samePoint(segment.end, current),
		);
		if (nextIndex < 0) {
			return { ok: false, reason: '板框线段存在断点或多环，无法形成单一闭合轮廓' };
		}

		const [segment] = unused.splice(nextIndex, 1);
		const nextPoint = samePoint(segment.start, current)
			? segment.end
			: segment.start;
		points.push({ ...nextPoint });
		current = nextPoint;

		if (samePoint(current, points[0]) && unused.length > 0) {
			return { ok: false, reason: '板框包含多个闭合环或额外线段' };
		}
	}

	if (!samePoint(current, points[0])) {
		return { ok: false, reason: '板框线段未闭合' };
	}

	const normalized = normalizePoints(points);
	if (normalized.length < 3) {
		return { ok: false, reason: '板框有效顶点少于 3 个' };
	}

	return {
		ok: true,
		polygon: { points: normalized },
	};
}

function pointOnSegment(
	point: BoardPoint,
	a: BoardPoint,
	b: BoardPoint,
): boolean {
	const cross = (point.y - a.y) * (b.x - a.x)
		- (point.x - a.x) * (b.y - a.y);
	if (Math.abs(cross) > EPSILON) return false;
	const dot = (point.x - a.x) * (b.x - a.x)
		+ (point.y - a.y) * (b.y - a.y);
	if (dot < -EPSILON) return false;
	const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
	return dot <= lengthSquared + EPSILON;
}

export function pointInOrOnPolygon(
	point: BoardPoint,
	polygon: BoardPolygon,
): boolean {
	const { points } = polygon;
	for (let index = 0; index < points.length; index += 1) {
		const next = (index + 1) % points.length;
		if (pointOnSegment(point, points[index], points[next])) {
			return true;
		}
	}

	let inside = false;
	for (
		let index = 0, previous = points.length - 1;
		index < points.length;
		previous = index++
	) {
		const a = points[index];
		const b = points[previous];
		const crosses = (a.y > point.y) !== (b.y > point.y)
			&& point.x
			< ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
		if (crosses) inside = !inside;
	}
	return inside;
}

function orientation(
	a: BoardPoint,
	b: BoardPoint,
	c: BoardPoint,
): number {
	return (b.y - a.y) * (c.x - b.x)
		- (b.x - a.x) * (c.y - b.y);
}

function properSegmentsIntersect(
	a1: BoardPoint,
	a2: BoardPoint,
	b1: BoardPoint,
	b2: BoardPoint,
): boolean {
	const o1 = orientation(a1, a2, b1);
	const o2 = orientation(a1, a2, b2);
	const o3 = orientation(b1, b2, a1);
	const o4 = orientation(b1, b2, a2);

	return (
		((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON))
		&& ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))
	);
}

export function boxInsideBoard(
	box: Box,
	polygon: BoardPolygon,
): boolean {
	const corners: BoardPoint[] = [
		{ x: box.minX, y: box.minY },
		{ x: box.maxX, y: box.minY },
		{ x: box.maxX, y: box.maxY },
		{ x: box.minX, y: box.maxY },
	];

	if (corners.some(corner => !pointInOrOnPolygon(corner, polygon))) {
		return false;
	}

	const boxEdges = corners.map((corner, index) => [
		corner,
		corners[(index + 1) % corners.length],
	] as const);
	const boardEdges = polygon.points.map((point, index) => [
		point,
		polygon.points[(index + 1) % polygon.points.length],
	] as const);

	return !boxEdges.some(([a1, a2]) =>
		boardEdges.some(([b1, b2]) =>
			properSegmentsIntersect(a1, a2, b1, b2),
		),
	);
}
