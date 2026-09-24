import assert from 'node:assert/strict';

import {
	buildReviewCameraCommand,
	verifyReviewViewport,
} from '../src/domain/reviewCameraPolicy';

const compact = buildReviewCameraCommand({
	left: 0,
	right: 460,
	top: 0,
	bottom: 460,
});
assert.deepEqual(
	{ x: compact.centerX, y: compact.centerY },
	{ x: 230, y: 230 },
);
assert.equal(
	compact.scaleRatio,
	500,
	'small component regions should use the bounded close-up scale',
);

const normal = buildReviewCameraCommand({
	left: 0,
	right: 560,
	top: 0,
	bottom: 560,
});
assert.equal(normal.scaleRatio, 420);

const large = buildReviewCameraCommand({
	left: 0,
	right: 1000,
	top: 0,
	bottom: 1000,
});
assert.equal(
	large.scaleRatio,
	300,
	'large regions should remain bounded instead of zooming out indefinitely',
);
assert.ok(compact.scaleRatio > normal.scaleRatio);
assert.ok(normal.scaleRatio > large.scaleRatio);

assert.throws(
	() => buildReviewCameraCommand({
		left: Number.NaN,
		right: 100,
		top: 0,
		bottom: 100,
	}),
	/non-finite/,
);
assert.throws(
	() => buildReviewCameraCommand({
		left: 100,
		right: 100,
		top: 100,
		bottom: 100,
	}),
	/positive span/,
);

const goodViewport = verifyReviewViewport(normal, {
	left: -400,
	right: 960,
	top: -400,
	bottom: 960,
});
assert.equal(goodViewport.ok, true);
assert.ok(goodViewport.viewportToFocusRatio < 3.6);

const offTargetViewport = verifyReviewViewport(normal, {
	left: 1000,
	right: 1400,
	top: 1000,
	bottom: 1400,
});
assert.equal(offTargetViewport.ok, false);
assert.ok(
	offTargetViewport.reasons.some(reason =>
		reason.includes('outside the returned viewport')
	),
);

const tooWideViewport = verifyReviewViewport(normal, {
	left: -1000,
	right: 1600,
	top: -1000,
	bottom: 1600,
});
assert.equal(tooWideViewport.ok, false);
assert.ok(
	tooWideViewport.reasons.some(reason =>
		reason.includes('too wide')
	),
);

console.log('Review camera policy tests passed.');
