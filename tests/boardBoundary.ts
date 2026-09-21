import assert from 'node:assert/strict';

import {
	boxInsideBoard,
	buildSimpleBoardPolygonFromSegments,
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
