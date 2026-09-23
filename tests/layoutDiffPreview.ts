import assert from 'node:assert/strict';

import {
	boundsIntersectRegion,
	buildLayoutReviewViewport,
	traceIntersectsRegion,
	viaIntersectsRegion,
} from '../src/domain/layoutDiffPreview';
import type { LayoutPlanItem } from '../src/domain/layoutPlan';

const item: LayoutPlanItem = {
	constraintId: 'C21:near:U11',
	subjectId: 'c21',
	subjectDesignator: 'C21',
	ownerId: 'u11',
	ownerDesignator: 'U11',
	powerNet: '+3.3V',
	groundNet: 'GND',
	ownerPowerPadNumber: '8',
	subjectPowerPadNumber: '2',
	ownerGroundPadNumber: '5',
	subjectGroundPadNumber: '1',
	from: { x: 1000, y: 1000 },
	to: { x: 2000, y: 1500 },
	fromBounds: { minX: 980, minY: 985, maxX: 1020, maxY: 1015 },
	toBounds: { minX: 1980, minY: 1485, maxX: 2020, maxY: 1515 },
	movementMil: 1118,
	currentLoopProxyMil: 1803.8,
	estimatedLoopProxyMil: 370.5,
	clearanceMil: 20,
	executionBlockers: ['reference-only'],
	rationale: 'fixture',
};

const viewport = buildLayoutReviewViewport(item, {
	minX: 1900,
	minY: 1400,
	maxX: 2100,
	maxY: 1600,
});

assert.ok(viewport.left < item.fromBounds.minX);
assert.ok(viewport.right > item.toBounds.maxX);
assert.ok(viewport.top < item.fromBounds.minY);
assert.ok(viewport.bottom > item.toBounds.maxY);

assert.equal(
	boundsIntersectRegion(
		{ minX: 1500, minY: 1200, maxX: 1600, maxY: 1300 },
		viewport,
	),
	true,
);
assert.equal(
	boundsIntersectRegion(
		{ minX: -5000, minY: -5000, maxX: -4900, maxY: -4900 },
		viewport,
	),
	false,
);

assert.equal(
	traceIntersectsRegion(
		{ startX: 900, startY: 1000, endX: 2050, endY: 1500, width: 8 },
		viewport,
	),
	true,
);

assert.equal(
	viaIntersectsRegion(
		{ x: item.to.x, y: item.to.y, diameter: 20 },
		viewport,
	),
	true,
);

console.log('Layout diff preview geometry tests passed.');
