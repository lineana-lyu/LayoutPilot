import assert from 'node:assert/strict';

import { buildReviewFocusRegion } from '../src/domain/reviewNavigator';

function span(region: { left: number; right: number; top: number; bottom: number }) {
	return {
		width: region.right - region.left,
		height: region.bottom - region.top,
	};
}

const tiny = buildReviewFocusRegion({
	minX: 100,
	minY: 200,
	maxX: 140,
	maxY: 220,
});
assert.deepEqual(span(tiny), {
	width: 720,
	height: 720,
});
assert.equal((tiny.left + tiny.right) / 2, 120);
assert.equal((tiny.top + tiny.bottom) / 2, 210);

const medium = buildReviewFocusRegion({
	minX: 0,
	minY: 0,
	maxX: 200,
	maxY: 100,
});
assert.deepEqual(span(medium), {
	width: 1000,
	height: 1000,
});

const large = buildReviewFocusRegion({
	minX: 0,
	minY: 0,
	maxX: 400,
	maxY: 300,
});
assert.deepEqual(span(large), {
	width: 1400,
	height: 1400,
});

const targetContext = buildReviewFocusRegion({
	minX: 100,
	minY: 100,
	maxX: 160,
	maxY: 140,
}, 840);
assert.deepEqual(span(targetContext), {
	width: 840,
	height: 840,
});

console.log('Review navigation framing tests passed.');
