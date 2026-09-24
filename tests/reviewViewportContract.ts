import assert from 'node:assert/strict';

import { verifyFocusedViewport } from '../src/domain/reviewViewportContract';

const expected = {
	left: 100,
	right: 560,
	top: 200,
	bottom: 660,
};

const fitted = verifyFocusedViewport({
	expected,
	actual: {
		left: 20,
		right: 640,
		top: 200,
		bottom: 660,
	},
});
assert.equal(fitted.ok, true);

const wholeBoardFallback = verifyFocusedViewport({
	expected,
	actual: {
		left: -1500,
		right: 2500,
		top: -1300,
		bottom: 2600,
	},
});
assert.equal(wholeBoardFallback.ok, false);
assert.ok(
	wholeBoardFallback.reasons.some(reason => reason.includes('wider')),
	'a whole-board viewport must not be accepted as a successful local focus',
);

const missedTarget = verifyFocusedViewport({
	expected,
	actual: {
		left: -1000,
		right: -400,
		top: -900,
		bottom: -300,
	},
});
assert.equal(missedTarget.ok, false);
assert.ok(
	missedTarget.reasons.some(reason => reason.includes('outside')),
	'a viewport that misses the requested target must fail verification',
);

console.log('Review viewport contract tests passed.');
