import assert from 'node:assert/strict';

import {
	boundsIntersectRegion,
	buildLayoutReviewComponent,
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

const reviewSubjectBounds = {
	minX: 985,
	minY: 990,
	maxX: 1015,
	maxY: 1010,
};
const viewport = buildLayoutReviewViewport(
	item,
	reviewSubjectBounds,
	{
		minX: 1900,
		minY: 1400,
		maxX: 2100,
		maxY: 1600,
	},
);

assert.ok(viewport.left < reviewSubjectBounds.minX);
assert.ok(viewport.right > item.to.x);
assert.ok(viewport.top < reviewSubjectBounds.minY);
assert.ok(viewport.bottom > item.to.y);

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

const padAnchored = buildLayoutReviewComponent({
	id: 'u11',
	designator: 'U11',
	x: 500,
	y: 600,
	rotation: 0,
	layer: 'TOP',
	locked: false,
	bounds: {
		minX: 100,
		minY: 100,
		maxX: 900,
		maxY: 900,
	},
	pads: [
		{
			componentId: 'u11',
			designator: 'U11',
			padNumber: '1',
			x: 470,
			y: 580,
			width: 20,
			height: 12,
			rotation: 0,
		},
		{
			componentId: 'u11',
			designator: 'U11',
			padNumber: '2',
			x: 530,
			y: 620,
			width: 20,
			height: 12,
			rotation: 0,
		},
	],
});

assert.ok(padAnchored);
assert.equal(padAnchored.geometrySource, 'pad-envelope');
assert.deepEqual(
	padAnchored.anchor,
	{ x: 500, y: 600 },
	'review position must use the true component anchor',
);
assert.ok(
	padAnchored.bounds.minX > 400
	&& padAnchored.bounds.maxX < 600
	&& padAnchored.bounds.minY > 500
	&& padAnchored.bounds.maxY < 700,
	'pad envelope must ignore an oversized raw primitive BBox that may include text or graphics',
);

const bboxFallback = buildLayoutReviewComponent({
	id: 'm1',
	designator: 'M1',
	x: 1000,
	y: 2000,
	rotation: 0,
	layer: 'TOP',
	locked: false,
	bounds: {
		minX: 400,
		minY: 1200,
		maxX: 1400,
		maxY: 2500,
	},
	pads: [],
});
assert.ok(bboxFallback);
assert.equal(bboxFallback.geometrySource, 'recentered-bbox');
assert.equal(
	(bboxFallback.bounds.minX + bboxFallback.bounds.maxX) / 2,
	1000,
	'fallback display BBox must be recentered on the component anchor',
);
assert.equal(
	(bboxFallback.bounds.minY + bboxFallback.bounds.maxY) / 2,
	2000,
	'fallback display BBox must be recentered on the component anchor',
);

console.log('Layout diff preview geometry tests passed.');
