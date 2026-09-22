import assert from 'node:assert/strict';

import {
	paddedCanvasRegion,
	unionCanvasBounds,
} from '../src/domain/canvasRegion';

const union = unionCanvasBounds(
	[
		{ minX: 100, minY: 200, maxX: 140, maxY: 240 },
		{ minX: 300, minY: 100, maxX: 360, maxY: 180 },
		undefined,
	],
	[
		{ x: 500, y: 500 },
		{ x: Number.NaN, y: 0 },
	],
);

assert.deepEqual(union, {
	minX: 100,
	minY: 100,
	maxX: 500,
	maxY: 500,
});

assert.equal(
	unionCanvasBounds([], []),
	undefined,
	'empty evidence must not invent a viewport',
);

const region = paddedCanvasRegion({
	minX: 100,
	minY: 100,
	maxX: 200,
	maxY: 200,
});

assert.ok(region.left < 100);
assert.ok(region.right > 200);
assert.ok(region.top < 100);
assert.ok(region.bottom > 200);
assert.ok(
	region.right - region.left >= 160,
	'viewport should preserve a practical minimum span',
);

console.log('Canvas region tests passed.');
