import assert from 'node:assert/strict';

import {
	boxInsideBoard,
	boxInsideBoardRegion,
	buildBoardRegionFromPolygons,
	buildBoardPolygonsFromSegments,
	buildSimpleBoardPolygonFromSegments,
	parseBoardOutlineSource,
	parseSimpleBoardPolygon,
} from '../src/domain/boardBoundary';

{
	const parsed = parseSimpleBoardPolygon([
		0, 0,
		'L',
		500, 0,
		500, 500,
		0, 500,
		0, 0,
	]);
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(
			boxInsideBoard(
				{ minX: 100, minY: 100, maxX: 200, maxY: 200 },
				parsed.polygon,
			),
			true,
		);
		assert.equal(
			boxInsideBoard(
				{ minX: 450, minY: 450, maxX: 550, maxY: 550 },
				parsed.polygon,
			),
			false,
		);
	}
}

{
	const parsed = parseSimpleBoardPolygon([
		0, 0,
		'ARC',
		90,
		100, 100,
	]);
	assert.equal(parsed.ok, false);
}

{
	const parsed = buildSimpleBoardPolygonFromSegments([
		{ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
		{ start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
		{ start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
		{ start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
	]);
	assert.equal(parsed.ok, true);
}

{
	const parsed = buildSimpleBoardPolygonFromSegments([
		{ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
		{ start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
		{ start: { x: 500, y: 500 }, end: { x: 600, y: 500 } },
	]);
	assert.equal(parsed.ok, false);
}

{
	const concave = parseSimpleBoardPolygon([
		0, 0,
		'L',
		400, 0,
		400, 400,
		250, 400,
		250, 150,
		150, 150,
		150, 400,
		0, 400,
		0, 0,
	]);
	assert.equal(concave.ok, true);
	if (concave.ok) {
		assert.equal(
			boxInsideBoard(
				{ minX: 170, minY: 200, maxX: 230, maxY: 260 },
				concave.polygon,
			),
			false,
			'box inside the concave cut-in must be rejected',
		);
	}
}

console.log('Board boundary tests passed.');


{
	const region = buildBoardRegionFromPolygons([
		{
			points: [
				{ x: 0, y: 0 },
				{ x: 1000, y: 0 },
				{ x: 1000, y: 1000 },
				{ x: 0, y: 1000 },
			],
		},
		{
			points: [
				{ x: 400, y: 400 },
				{ x: 600, y: 400 },
				{ x: 600, y: 600 },
				{ x: 400, y: 600 },
			],
		},
	]);
	assert.equal(region.ok, true);
	if (region.ok) {
		assert.equal(region.region.holes.length, 1);
		assert.equal(
			boxInsideBoardRegion(
				{ minX: 100, minY: 100, maxX: 180, maxY: 180 },
				region.region,
			),
			true,
		);
		assert.equal(
			boxInsideBoardRegion(
				{ minX: 450, minY: 450, maxX: 550, maxY: 550 },
				region.region,
			),
			false,
			'component BBox inside a board cutout must be rejected',
		);
	}
}

{
	const panelLike = buildBoardRegionFromPolygons([
		{
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 100 },
				{ x: 0, y: 100 },
			],
		},
		{
			points: [
				{ x: 300, y: 0 },
				{ x: 400, y: 0 },
				{ x: 400, y: 100 },
				{ x: 300, y: 100 },
			],
		},
	]);
	assert.equal(
		panelLike.ok,
		false,
		'disjoint outer contours must remain fail-closed',
	);
}


{
	const sources = [
		[0, 0, 'L', 100, 0],
		[100, 0, 'L', 100, 100],
		[100, 100, 'L', 0, 100],
		[0, 100, 'L', 0, 0],
	] as const;

	const segments = sources.flatMap(source => {
		const parsed = parseBoardOutlineSource([...source]);
		assert.equal(parsed.ok, true);
		return parsed.ok ? parsed.segments : [];
	});
	const rebuilt = buildBoardPolygonsFromSegments(segments);
	assert.equal(rebuilt.ok, true);
	if (rebuilt.ok) {
		assert.equal(rebuilt.polygons.length, 1);
		assert.equal(rebuilt.polygons[0].points.length, 4);
	}
}

{
	const first = parseBoardOutlineSource([0, 0, 'L', 100, 0, 100, 100]);
	assert.equal(first.ok, true);
	const reconstructed = buildBoardPolygonsFromSegments([
		...(first.ok ? first.segments : []),
		{ start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
		{ start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
	]);
	assert.equal(reconstructed.ok, true);
	if (reconstructed.ok) {
		assert.equal(reconstructed.polygons.length, 1);
	}
}

{
	const twoPointPath = parseBoardOutlineSource([0, 0, 'L', 100, 0]);
	assert.equal(twoPointPath.ok, true);
	if (twoPointPath.ok) {
		assert.equal(twoPointPath.segments.length, 1);
		assert.equal(twoPointPath.closedPolygons.length, 0);
	}
}
