import assert from 'node:assert/strict';

import { buildReviewCameraCommand } from '../src/domain/reviewCameraCommand';
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


const tinyCamera = buildReviewCameraCommand(tiny);
assert.deepEqual(
	{ x: tinyCamera.x, y: tinyCamera.y },
	{ x: 120, y: 210 },
);
assert.equal(
	tinyCamera.scaleRatio,
	35,
	'tiny passive context should use a moderate close-up rather than hundreds of percent',
);

const targetCamera = buildReviewCameraCommand(targetContext);
assert.equal(targetCamera.scaleRatio, 30);

const largeCamera = buildReviewCameraCommand(large);
assert.equal(
	largeCamera.scaleRatio,
	18,
	'large review context should use the lower zoom bound',
);

assert.throws(
	() => buildReviewCameraCommand({
		left: Number.NaN,
		right: 100,
		top: 0,
		bottom: 100,
	}),
	/finite/,
);

console.log('Review camera command tests passed.');
