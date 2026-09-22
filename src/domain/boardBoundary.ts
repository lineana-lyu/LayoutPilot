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
	}
	| { ok: false; reason: string };

export function parseBoardOutlineSource(
	source: unknown,
): BoardOutlineSourceParseResult {
	if (!Array.isArray(source) || !source.length) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE source 为空或格式未知',
		};
	}

	if (source[0] === 'R') {
		const parsed = parseSimpleBoardPolygon(source);
		return parsed.ok
			? {
				ok: true,
				segments: [],
				closedPolygons: [parsed.polygon],
			}
			: parsed;
	}

	if (source.some(token =>
		token === 'ARC'
		|| token === 'CARC'
		|| token === 'C'
		|| token === 'CIRCLE'
	)) {
		return {
			ok: false,
			reason:
				'当前 BOARD_OUTLINE polyline 含圆弧/贝塞尔/圆形路径；当前版本不做几何离散近似。',
		};
	}

	const points: BoardPoint[] = [];
	let index = 0;
	if (isFiniteNumber(source[0]) && isFiniteNumber(source[1])) {
		points.push({
			x: source[0],
			y: source[1],
		});
		index = 2;
	}
	else {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE polyline 缺少起始坐标',
		};
	}

	while (index < source.length) {
		const token = source[index++];
		if (token !== 'L') {
			return {
				ok: false,
				reason: `无法可靠解析 BOARD_OUTLINE 路径命令：${String(token)}`,
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
			return {
				ok: false,
				reason: 'BOARD_OUTLINE polyline 的 L 命令缺少坐标',
			};
		}
	}

	const normalizedPath: BoardPoint[] = [];
	for (const point of points) {
		if (
			!normalizedPath.length
			|| !samePoint(normalizedPath[normalizedPath.length - 1], point)
		) {
			normalizedPath.push(point);
		}
	}

	if (normalizedPath.length < 2) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE polyline 有效路径点少于 2 个',
		};
	}

	const segments: BoardSegment[] = [];
	for (let pointIndex = 1; pointIndex < normalizedPath.length; pointIndex += 1) {
		const start = normalizedPath[pointIndex - 1];
		const end = normalizedPath[pointIndex];
		if (!samePoint(start, end)) {
			segments.push({
				start: { ...start },
				end: { ...end },
			});
		}
	}

	if (!segments.length) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE polyline 没有有效线段',
		};
	}

	return {
		ok: true,
		segments,
		closedPolygons: [],
	};
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
		},
	};
}

const BOARD_ENDPOINT_TOLERANCE_MIL = 0.01;

function endpointKey(point: BoardPoint): string {
	return [
		Math.round(point.x / BOARD_ENDPOINT_TOLERANCE_MIL),
		Math.round(point.y / BOARD_ENDPOINT_TOLERANCE_MIL),
	].join(':');
}

export function buildBoardPolygonsFromSegments(
	segments: BoardSegment[],
): { ok: true; polygons: BoardPolygon[] } | { ok: false; reason: string } {
	if (!segments.length) {
		return { ok: true, polygons: [] };
	}

	const edges = segments.flatMap((segment, index) => {
		const startKey = endpointKey(segment.start);
		const endKey = endpointKey(segment.end);
		if (startKey === endKey) return [];
		return [{
			index,
			start: { ...segment.start },
			end: { ...segment.end },
			startKey,
			endKey,
		}];
	});

	if (!edges.length) {
		return {
			ok: false,
			reason: 'BOARD_OUTLINE 没有可用于重建轮廓的有效线段。',
		};
	}

	const adjacency = new Map<string, number[]>();
	const register = (key: string, edgeIndex: number) => {
		const list = adjacency.get(key) ?? [];
		list.push(edgeIndex);
		adjacency.set(key, list);
	};

	edges.forEach((edge, edgeIndex) => {
		register(edge.startKey, edgeIndex);
		register(edge.endKey, edgeIndex);
	});

	for (const [key, connected] of adjacency) {
		if (connected.length !== 2) {
			return {
				ok: false,
				reason:
					connected.length < 2
						? `BOARD_OUTLINE 存在断点（节点 ${key} 只有 ${connected.length} 条相连边）。`
						: `BOARD_OUTLINE 存在分叉/轮廓接触（节点 ${key} 有 ${connected.length} 条相连边）。`,
			};
		}
	}

	const unused = new Set(edges.map((_, index) => index));
	const polygons: BoardPolygon[] = [];

	while (unused.size) {
		const firstIndex = unused.values().next().value as number;
		const first = edges[firstIndex];
		unused.delete(firstIndex);

		const startKey = first.startKey;
		let currentKey = first.endKey;
		const points: BoardPoint[] = [
			{ ...first.start },
			{ ...first.end },
		];

		let safety = edges.length + 1;
		while (currentKey !== startKey && safety > 0) {
			safety -= 1;
			const connected = adjacency.get(currentKey) ?? [];
			const nextIndex = connected.find(edgeIndex => unused.has(edgeIndex));
			if (nextIndex === undefined) {
				return {
					ok: false,
					reason: 'BOARD_OUTLINE 拓扑无法闭合；轮廓可能存在断点或重复边。',
				};
			}

			const edge = edges[nextIndex];
			unused.delete(nextIndex);

			if (edge.startKey === currentKey) {
				points.push({ ...edge.end });
				currentKey = edge.endKey;
			}
			else if (edge.endKey === currentKey) {
				points.push({ ...edge.start });
				currentKey = edge.startKey;
			}
			else {
				return {
					ok: false,
					reason: 'BOARD_OUTLINE 邻接图与线段端点不一致。',
				};
			}
		}

		if (currentKey !== startKey) {
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
	if (!boxInsideBoard(box, region.outer)) {
		return false;
	}
	return region.holes.every(hole => !boxIntersectsPolygon(box, hole));
}
