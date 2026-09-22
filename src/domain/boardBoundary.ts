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

export type BoardOutlineSourceParseResult =
	| {
		ok: true;
		segments: BoardSegment[];
		closedPolygons: BoardPolygon[];
		approximationToleranceMil: number;
	}
	| { ok: false; reason: string };

export const BOARD_CURVE_APPROX_TOLERANCE_MIL = 0.05;
const MAX_CURVE_SEGMENTS = 4096;

function distance(a: BoardPoint, b: BoardPoint): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

function appendPathSegments(
	points: BoardPoint[],
	target: BoardSegment[],
): void {
	for (let index = 1; index < points.length; index += 1) {
		const start = points[index - 1];
		const end = points[index];
		if (!samePoint(start, end)) {
			target.push({
				start: { ...start },
				end: { ...end },
			});
		}
	}
}

function arcStepCount(
	radius: number,
	sweepRadians: number,
	toleranceMil: number,
): number | undefined {
	if (
		!Number.isFinite(radius)
		|| radius <= EPSILON
		|| !Number.isFinite(sweepRadians)
		|| Math.abs(sweepRadians) <= EPSILON
	) {
		return undefined;
	}

	const tolerance = Math.max(EPSILON, toleranceMil);
	const ratio = Math.min(1.999999, tolerance / radius);
	const maxStep = 2 * Math.acos(Math.max(-1, 1 - ratio));
	if (!Number.isFinite(maxStep) || maxStep <= EPSILON) {
		return undefined;
	}

	const steps = Math.max(
		1,
		Math.ceil(Math.abs(sweepRadians) / maxStep),
	);
	if (steps > MAX_CURVE_SEGMENTS) {
		return undefined;
	}

	const actualStep = Math.abs(sweepRadians) / steps;
	const actualSagitta = radius * (1 - Math.cos(actualStep / 2));
	return actualSagitta <= tolerance * 1.000001
		? steps
		: undefined;
}

export function tessellateBoardArc(
	start: BoardPoint,
	end: BoardPoint,
	sweepDegrees: number,
	toleranceMil = BOARD_CURVE_APPROX_TOLERANCE_MIL,
):
	| { ok: true; points: BoardPoint[]; approximationToleranceMil: number }
	| { ok: false; reason: string } {
	if (!Number.isFinite(sweepDegrees) || Math.abs(sweepDegrees) <= EPSILON) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE 圆弧 sweep angle 无效',
		};
	}
	if (Math.abs(sweepDegrees) >= 360 - 1e-7) {
		return {
			ok: false,
			reason: '接近整圆的 ARC/CARC 不能仅凭两个端点安全恢复；应使用 CIRCLE 或明确闭合圆。',
		};
	}

	const chord = distance(start, end);
	if (chord <= EPSILON) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE 圆弧起终点重合，无法恢复圆心',
		};
	}

	const sweepRadians = sweepDegrees * Math.PI / 180;
	const sinHalf = Math.sin(Math.abs(sweepRadians) / 2);
	if (Math.abs(sinHalf) <= EPSILON) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE 圆弧角度导致半径不可解',
		};
	}

	const radius = chord / (2 * Math.abs(sinHalf));
	const h = radius
		* Math.cos(Math.abs(sweepRadians) / 2)
		* Math.sign(sweepRadians);
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const center = {
		x: (start.x + end.x) / 2 - (dy / chord) * h,
		y: (start.y + end.y) / 2 + (dx / chord) * h,
	};

	const steps = arcStepCount(radius, sweepRadians, toleranceMil);
	if (!steps) {
		return {
			ok: false,
			reason:
				'BOARD_OUTLINE 圆弧无法在当前误差预算内稳定离散；请检查半径/扫角是否异常。',
		};
	}

	const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
	const points: BoardPoint[] = [{ ...start }];
	for (let step = 1; step <= steps; step += 1) {
		if (step === steps) {
			points.push({ ...end });
			continue;
		}
		const angle = startAngle + sweepRadians * (step / steps);
		points.push({
			x: center.x + radius * Math.cos(angle),
			y: center.y + radius * Math.sin(angle),
		});
	}

	return {
		ok: true,
		points,
		approximationToleranceMil: toleranceMil,
	};
}

function pointLineDistance(
	point: BoardPoint,
	start: BoardPoint,
	end: BoardPoint,
): number {
	const length = distance(start, end);
	if (length <= EPSILON) return distance(point, start);
	return Math.abs(
		(end.x - start.x) * (start.y - point.y)
		- (start.x - point.x) * (end.y - start.y),
	) / length;
}

function midpoint(a: BoardPoint, b: BoardPoint): BoardPoint {
	return {
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
	};
}

function tessellateBezierRecursive(
	p0: BoardPoint,
	p1: BoardPoint,
	p2: BoardPoint,
	p3: BoardPoint,
	toleranceMil: number,
	depth: number,
	target: BoardPoint[],
): boolean {
	const flatness = Math.max(
		pointLineDistance(p1, p0, p3),
		pointLineDistance(p2, p0, p3),
	);
	if (flatness <= toleranceMil) {
		target.push({ ...p3 });
		return true;
	}
	if (depth >= 18 || target.length >= MAX_CURVE_SEGMENTS) {
		return false;
	}

	const p01 = midpoint(p0, p1);
	const p12 = midpoint(p1, p2);
	const p23 = midpoint(p2, p3);
	const p012 = midpoint(p01, p12);
	const p123 = midpoint(p12, p23);
	const p0123 = midpoint(p012, p123);

	return tessellateBezierRecursive(
		p0, p01, p012, p0123, toleranceMil, depth + 1, target,
	) && tessellateBezierRecursive(
		p0123, p123, p23, p3, toleranceMil, depth + 1, target,
	);
}

function tessellateBoardBezier(
	p0: BoardPoint,
	p1: BoardPoint,
	p2: BoardPoint,
	p3: BoardPoint,
	toleranceMil = BOARD_CURVE_APPROX_TOLERANCE_MIL,
):
	| { ok: true; points: BoardPoint[]; approximationToleranceMil: number }
	| { ok: false; reason: string } {
	const points: BoardPoint[] = [{ ...p0 }];
	const ok = tessellateBezierRecursive(
		p0, p1, p2, p3, toleranceMil, 0, points,
	);
	return ok
		? {
			ok: true,
			points,
			approximationToleranceMil: toleranceMil,
		}
		: {
			ok: false,
			reason:
				'BOARD_OUTLINE Bézier 曲线无法在当前误差预算内稳定离散。',
		};
}

function rotateAndTranslate(
	point: BoardPoint,
	origin: BoardPoint,
	rotationDegrees: number,
): BoardPoint {
	const radians = rotationDegrees * Math.PI / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return {
		x: origin.x + point.x * cos - point.y * sin,
		y: origin.y + point.x * sin + point.y * cos,
	};
}

function circleArcPoints(
	center: BoardPoint,
	radius: number,
	startDegrees: number,
	endDegrees: number,
	toleranceMil: number,
): BoardPoint[] | undefined {
	const sweep = (endDegrees - startDegrees) * Math.PI / 180;
	const steps = arcStepCount(radius, sweep, toleranceMil);
	if (!steps) return undefined;

	const points: BoardPoint[] = [];
	for (let step = 0; step <= steps; step += 1) {
		const angle = (
			startDegrees
			+ (endDegrees - startDegrees) * (step / steps)
		) * Math.PI / 180;
		points.push({
			x: center.x + radius * Math.cos(angle),
			y: center.y + radius * Math.sin(angle),
		});
	}
	return points;
}

function parseRectangleOutline(
	source: unknown[],
	toleranceMil: number,
): BoardOutlineSourceParseResult {
	const x = source[1];
	const y = source[2];
	const width = source[3];
	const height = source[4];
	const rotation = isFiniteNumber(source[5]) ? source[5] : 0;
	const roundRaw = source.length >= 8 ? source[7] : source[6];

	if (
		!isFiniteNumber(x)
		|| !isFiniteNumber(y)
		|| !isFiniteNumber(width)
		|| !isFiniteNumber(height)
		|| !isFiniteNumber(rotation)
	) {
		return { ok: false, reason: '矩形 BOARD_OUTLINE 参数不完整' };
	}

	const origin = { x, y };
	const round = isFiniteNumber(roundRaw)
		? Math.max(
			0,
			Math.min(
				roundRaw,
				Math.min(Math.abs(width), Math.abs(height)) / 2,
			),
		)
		: 0;

	if (round <= EPSILON) {
		return {
			ok: true,
			segments: [],
			closedPolygons: [{
				points: [
					{ x: 0, y: 0 },
					{ x: width, y: 0 },
					{ x: width, y: -height },
					{ x: 0, y: -height },
				].map(point =>
					rotateAndTranslate(point, origin, rotation),
				),
			}],
			approximationToleranceMil: 0,
		};
	}

	const corners = [
		{ center: { x: width - round, y: -round }, a0: 90, a1: 0 },
		{ center: { x: width - round, y: -height + round }, a0: 0, a1: -90 },
		{ center: { x: round, y: -height + round }, a0: -90, a1: -180 },
		{ center: { x: round, y: -round }, a0: 180, a1: 90 },
	];
	const points: BoardPoint[] = [];
	for (const corner of corners) {
		const arc = circleArcPoints(
			corner.center,
			round,
			corner.a0,
			corner.a1,
			toleranceMil,
		);
		if (!arc) {
			return {
				ok: false,
				reason: '圆角矩形 BOARD_OUTLINE 无法在误差预算内离散',
			};
		}
		for (const point of arc) {
			const transformed = rotateAndTranslate(
				point,
				origin,
				rotation,
			);
			if (
				!points.length
				|| !samePoint(points[points.length - 1], transformed)
			) {
				points.push(transformed);
			}
		}
	}

	return {
		ok: true,
		segments: [],
		closedPolygons: [{ points: normalizePoints(points) }],
		approximationToleranceMil: toleranceMil,
	};
}

function parseCircleOutline(
	source: unknown[],
	toleranceMil: number,
): BoardOutlineSourceParseResult {
	const cx = source[1];
	const cy = source[2];
	const radius = source[3];
	if (
		!isFiniteNumber(cx)
		|| !isFiniteNumber(cy)
		|| !isFiniteNumber(radius)
		|| radius <= EPSILON
	) {
		return { ok: false, reason: 'CIRCLE BOARD_OUTLINE 参数不完整' };
	}

	const steps = arcStepCount(radius, 2 * Math.PI - 1e-12, toleranceMil);
	if (!steps) {
		return {
			ok: false,
			reason: 'CIRCLE BOARD_OUTLINE 无法在误差预算内离散',
		};
	}
	const points: BoardPoint[] = [];
	for (let step = 0; step < steps; step += 1) {
		const angle = 2 * Math.PI * step / steps;
		points.push({
			x: cx + radius * Math.cos(angle),
			y: cy + radius * Math.sin(angle),
		});
	}
	return {
		ok: true,
		segments: [],
		closedPolygons: [{ points }],
		approximationToleranceMil: toleranceMil,
	};
}

function parseFlatBoardOutlineSource(
	source: unknown[],
	toleranceMil: number,
): BoardOutlineSourceParseResult {
	if (!source.length) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE source 为空',
		};
	}
	if (source[0] === 'R') {
		return parseRectangleOutline(source, toleranceMil);
	}
	if (source[0] === 'CIRCLE') {
		return parseCircleOutline(source, toleranceMil);
	}
	if (!isFiniteNumber(source[0]) || !isFiniteNumber(source[1])) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE polyline 缺少起始坐标',
		};
	}

	let current: BoardPoint = {
		x: source[0],
		y: source[1],
	};
	let index = 2;
	let mode = 'L';
	const segments: BoardSegment[] = [];
	let approximationToleranceMil = 0;

	while (index < source.length) {
		const token = source[index];
		if (typeof token === 'string') {
			mode = token;
			index += 1;
			continue;
		}

		if (mode === 'L') {
			const x = source[index];
			const y = source[index + 1];
			if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
				return {
					ok: false,
					reason: 'BOARD_OUTLINE L 命令坐标不完整',
				};
			}
			const next = { x, y };
			appendPathSegments([current, next], segments);
			current = next;
			index += 2;
			continue;
		}

		if (mode === 'ARC' || mode === 'CARC') {
			const angle = source[index];
			const endX = source[index + 1];
			const endY = source[index + 2];
			if (
				!isFiniteNumber(angle)
				|| !isFiniteNumber(endX)
				|| !isFiniteNumber(endY)
			) {
				return {
					ok: false,
					reason: `BOARD_OUTLINE ${mode} 参数不完整`,
				};
			}
			const arc = tessellateBoardArc(
				current,
				{ x: endX, y: endY },
				angle,
				toleranceMil,
			);
			if (!arc.ok) return arc;
			appendPathSegments(arc.points, segments);
			approximationToleranceMil = Math.max(
				approximationToleranceMil,
				arc.approximationToleranceMil,
			);
			current = { x: endX, y: endY };
			index += 3;
			continue;
		}

		if (mode === 'C') {
			const x1 = source[index];
			const y1 = source[index + 1];
			const x2 = source[index + 2];
			const y2 = source[index + 3];
			const endX = source[index + 4];
			const endY = source[index + 5];
			if (
				!isFiniteNumber(x1)
				|| !isFiniteNumber(y1)
				|| !isFiniteNumber(x2)
				|| !isFiniteNumber(y2)
				|| !isFiniteNumber(endX)
				|| !isFiniteNumber(endY)
			) {
				return {
					ok: false,
					reason: 'BOARD_OUTLINE Bézier 参数不完整',
				};
			}
			const bezier = tessellateBoardBezier(
				current,
				{ x: x1, y: y1 },
				{ x: x2, y: y2 },
				{ x: endX, y: endY },
				toleranceMil,
			);
			if (!bezier.ok) return bezier;
			appendPathSegments(bezier.points, segments);
			approximationToleranceMil = Math.max(
				approximationToleranceMil,
				bezier.approximationToleranceMil,
			);
			current = { x: endX, y: endY };
			index += 6;
			continue;
		}

		return {
			ok: false,
			reason: `无法可靠解析 BOARD_OUTLINE 路径命令：${mode}`,
		};
	}

	if (!segments.length) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE polyline 没有有效路径段',
		};
	}

	return {
		ok: true,
		segments,
		closedPolygons: [],
		approximationToleranceMil,
	};
}

export function parseBoardOutlineSource(
	source: unknown,
	toleranceMil = BOARD_CURVE_APPROX_TOLERANCE_MIL,
): BoardOutlineSourceParseResult {
	if (!Array.isArray(source) || !source.length) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE source 为空或格式未知',
		};
	}

	if (Array.isArray(source[0])) {
		const segments: BoardSegment[] = [];
		const closedPolygons: BoardPolygon[] = [];
		let approximationToleranceMil = 0;

		for (const ring of source) {
			const parsed = parseBoardOutlineSource(ring, toleranceMil);
			if (!parsed.ok) return parsed;
			segments.push(...parsed.segments);
			closedPolygons.push(...parsed.closedPolygons);
			approximationToleranceMil = Math.max(
				approximationToleranceMil,
				parsed.approximationToleranceMil,
			);
		}
		return {
			ok: true,
			segments,
			closedPolygons,
			approximationToleranceMil,
		};
	}

	return parseFlatBoardOutlineSource(source, toleranceMil);
}

export function buildSimpleBoardPolygonFromSegments(
	segments: BoardSegment[],
): BoardPolygonParseResult {
	const rebuilt = buildBoardPolygonsFromSegments(segments);
	if (!rebuilt.ok) return rebuilt;
	if (rebuilt.polygons.length !== 1) {
		return {
			ok: false,
			reason:
				rebuilt.polygons.length
					? '板框包含多个闭合轮廓，无法作为单一 BoardPolygon 返回'
					: '没有可验证的闭合板框轮廓',
		};
	}
	return {
		ok: true,
		polygon: rebuilt.polygons[0],
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

function pointInsideBox(point: BoardPoint, box: Box): boolean {
	return point.x >= box.minX - EPSILON
		&& point.x <= box.maxX + EPSILON
		&& point.y >= box.minY - EPSILON
		&& point.y <= box.maxY + EPSILON;
}

export function boxIntersectsPolygon(
	box: Box,
	polygon: BoardPolygon,
): boolean {
	const corners: BoardPoint[] = [
		{ x: box.minX, y: box.minY },
		{ x: box.maxX, y: box.minY },
		{ x: box.maxX, y: box.maxY },
		{ x: box.minX, y: box.maxY },
	];

	if (corners.some(corner => pointInOrOnPolygon(corner, polygon))) {
		return true;
	}
	if (polygon.points.some(point => pointInsideBox(point, box))) {
		return true;
	}

	const boxEdges = corners.map((corner, index) => [
		corner,
		corners[(index + 1) % corners.length],
	] as const);
	const polygonEdges = polygon.points.map((point, index) => [
		point,
		polygon.points[(index + 1) % polygon.points.length],
	] as const);

	return boxEdges.some(([a1, a2]) =>
		polygonEdges.some(([b1, b2]) =>
			properSegmentsIntersect(a1, a2, b1, b2),
		),
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


export interface BoardRegion {
	outer: BoardPolygon;
	holes: BoardPolygon[];
	/**
	 * Maximum Hausdorff-style geometric deviation introduced while flattening
	 * native EasyEDA curves into line segments. Placement validation inflates
	 * the component BBox by this amount before board-boundary checks.
	 */
	approximationToleranceMil: number;
}

export type BoardRegionBuildResult =
	| { ok: true; region: BoardRegion }
	| { ok: false; reason: string };

export function polygonSignedArea(polygon: BoardPolygon): number {
	let area = 0;
	for (let index = 0; index < polygon.points.length; index += 1) {
		const current = polygon.points[index];
		const next = polygon.points[(index + 1) % polygon.points.length];
		area += current.x * next.y - next.x * current.y;
	}
	return area / 2;
}

function segmentsIntersectOrTouch(
	a1: BoardPoint,
	a2: BoardPoint,
	b1: BoardPoint,
	b2: BoardPoint,
): boolean {
	if (properSegmentsIntersect(a1, a2, b1, b2)) {
		return true;
	}
	return pointOnSegment(a1, b1, b2)
		|| pointOnSegment(a2, b1, b2)
		|| pointOnSegment(b1, a1, a2)
		|| pointOnSegment(b2, a1, a2);
}

function polygonsIntersectOrTouch(
	a: BoardPolygon,
	b: BoardPolygon,
): boolean {
	return a.points.some((a1, index) => {
		const a2 = a.points[(index + 1) % a.points.length];
		return b.points.some((b1, otherIndex) => {
			const b2 = b.points[(otherIndex + 1) % b.points.length];
			return segmentsIntersectOrTouch(a1, a2, b1, b2);
		});
	});
}

function polygonStrictlyInside(
	inner: BoardPolygon,
	outer: BoardPolygon,
): boolean {
	if (polygonsIntersectOrTouch(inner, outer)) {
		return false;
	}
	return inner.points.every(point => pointInOrOnPolygon(point, outer));
}

export function buildBoardRegionFromPolygons(
	polygons: BoardPolygon[],
	approximationToleranceMil = 0,
): BoardRegionBuildResult {
	const valid = polygons.filter(polygon => polygon.points.length >= 3);
	if (!valid.length) {
		return { ok: false, reason: '没有可验证的闭合 BOARD_OUTLINE 轮廓' };
	}

	const ordered = [...valid].sort(
		(a, b) =>
			Math.abs(polygonSignedArea(b))
			- Math.abs(polygonSignedArea(a)),
	);
	const outer = ordered[0];
	if (Math.abs(polygonSignedArea(outer)) <= EPSILON) {
		return { ok: false, reason: 'BOARD_OUTLINE 外轮廓面积为 0' };
	}

	const holes: BoardPolygon[] = [];
	for (const contour of ordered.slice(1)) {
		if (!polygonStrictlyInside(contour, outer)) {
			return {
				ok: false,
				reason:
					'检测到不位于主外轮廓内部的额外 BOARD_OUTLINE；可能是拼板、多板或轮廓相交，按安全策略拒绝规划。',
			};
		}

		const ambiguousHole = holes.find(hole =>
			polygonsIntersectOrTouch(hole, contour)
			|| polygonStrictlyInside(contour, hole)
			|| polygonStrictlyInside(hole, contour),
		);
		if (ambiguousHole) {
			return {
				ok: false,
				reason:
					'检测到相交或嵌套的内部 BOARD_OUTLINE；当前版本无法安全区分 hole / island。',
			};
		}
		holes.push(contour);
	}

	return {
		ok: true,
		region: {
			outer,
			holes,
			approximationToleranceMil: Math.max(0, approximationToleranceMil),
		},
	};
}

const BOARD_ENDPOINT_TOLERANCE_MIL = 0.01;

function endpointsCoincide(
	a: BoardPoint,
	b: BoardPoint,
): boolean {
	return Math.abs(a.x - b.x) <= BOARD_ENDPOINT_TOLERANCE_MIL
		&& Math.abs(a.y - b.y) <= BOARD_ENDPOINT_TOLERANCE_MIL;
}

export function buildBoardPolygonsFromSegments(
	segments: BoardSegment[],
): { ok: true; polygons: BoardPolygon[] } | { ok: false; reason: string } {
	if (!segments.length) {
		return { ok: true, polygons: [] };
	}

	const endpointRecords = segments.flatMap((segment, edgeIndex) => [
		{ edgeIndex, side: 'start' as const, point: segment.start },
		{ edgeIndex, side: 'end' as const, point: segment.end },
	]);

	const parent = endpointRecords.map((_, index) => index);
	const find = (index: number): number => {
		let current = index;
		while (parent[current] !== current) {
			parent[current] = parent[parent[current]];
			current = parent[current];
		}
		return current;
	};
	const unite = (a: number, b: number) => {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) parent[rootB] = rootA;
	};

	for (let a = 0; a < endpointRecords.length; a += 1) {
		for (let b = a + 1; b < endpointRecords.length; b += 1) {
			if (endpointsCoincide(
				endpointRecords[a].point,
				endpointRecords[b].point,
			)) {
				unite(a, b);
			}
		}
	}

	const endpointVertex = endpointRecords.map((_, index) => find(index));
	const edgeVertices = segments.map((segment, edgeIndex) => {
		const startRecord = edgeIndex * 2;
		const endRecord = startRecord + 1;
		return {
			index: edgeIndex,
			start: { ...segment.start },
			end: { ...segment.end },
			startVertex: endpointVertex[startRecord],
			endVertex: endpointVertex[endRecord],
		};
	}).filter(edge => edge.startVertex !== edge.endVertex);

	if (!edgeVertices.length) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE 没有可用于重建轮廓的有效线段。',
		};
	}

	const vertexPoint = new Map<number, BoardPoint>();
	for (let index = 0; index < endpointRecords.length; index += 1) {
		const vertex = endpointVertex[index];
		if (!vertexPoint.has(vertex)) {
			vertexPoint.set(vertex, { ...endpointRecords[index].point });
		}
	}

	const adjacency = new Map<number, number[]>();
	const register = (vertex: number, edgeIndex: number) => {
		const list = adjacency.get(vertex) ?? [];
		list.push(edgeIndex);
		adjacency.set(vertex, list);
	};

	edgeVertices.forEach((edge, edgeIndex) => {
		register(edge.startVertex, edgeIndex);
		register(edge.endVertex, edgeIndex);
	});

	for (const [vertex, connected] of adjacency) {
		if (connected.length !== 2) {
			const point = vertexPoint.get(vertex);
			const label = point
				? `(${point.x.toFixed(3)}, ${point.y.toFixed(3)})`
				: String(vertex);
			return {
				ok: false,
				reason:
					connected.length < 2
						? `BOARD_OUTLINE 存在断点：节点 ${label} 只有 ${connected.length} 条相连边。`
						: `BOARD_OUTLINE 存在分叉/轮廓接触：节点 ${label} 有 ${connected.length} 条相连边。`,
			};
		}
	}

	const unused = new Set(edgeVertices.map((_, index) => index));
	const polygons: BoardPolygon[] = [];

	while (unused.size) {
		const firstIndex = unused.values().next().value as number;
		const first = edgeVertices[firstIndex];
		unused.delete(firstIndex);

		const startVertex = first.startVertex;
		let currentVertex = first.endVertex;
		const points: BoardPoint[] = [
			{ ...first.start },
			{ ...first.end },
		];

		let safety = edgeVertices.length + 1;
		while (currentVertex !== startVertex && safety > 0) {
			safety -= 1;
			const connected = adjacency.get(currentVertex) ?? [];
			const nextIndex = connected.find(edgeIndex => unused.has(edgeIndex));
			if (nextIndex === undefined) {
				return {
					ok: false,
					reason: 'BOARD_OUTLINE 拓扑无法闭合；轮廓可能存在断点或重复边。',
				};
			}

			const edge = edgeVertices[nextIndex];
			unused.delete(nextIndex);

			if (edge.startVertex === currentVertex) {
				points.push({ ...edge.end });
				currentVertex = edge.endVertex;
			}
			else if (edge.endVertex === currentVertex) {
				points.push({ ...edge.start });
				currentVertex = edge.startVertex;
			}
			else {
				return {
					ok: false,
					reason: 'BOARD_OUTLINE 邻接图与线段端点不一致。',
				};
			}
		}

		if (currentVertex !== startVertex) {
			return {
				ok: false,
				reason: 'BOARD_OUTLINE 轮廓遍历超过安全上限，无法证明闭合。',
			};
		}

		const normalized = normalizePoints(points);
		if (normalized.length < 3) {
			return {
				ok: false,
				reason: 'BOARD_OUTLINE 闭合轮廓有效顶点少于 3 个。',
			};
		}
		polygons.push({ points: normalized });
	}

	return { ok: true, polygons };
}


export function boxInsideBoardRegion(
	box: Box,
	region: BoardRegion,
): boolean {
	const margin = Math.max(0, region.approximationToleranceMil);
	const conservativeBox = {
		minX: box.minX - margin,
		minY: box.minY - margin,
		maxX: box.maxX + margin,
		maxY: box.maxY + margin,
	};

	if (!boxInsideBoard(conservativeBox, region.outer)) {
		return false;
	}
	return region.holes.every(
		hole => !boxIntersectsPolygon(conservativeBox, hole),
	);
}
