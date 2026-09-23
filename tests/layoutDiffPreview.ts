import assert from 'node:assert/strict';

import {
	boundsIntersectRegion,
	buildLayoutReviewComponent,
	buildLayoutReviewViewport,
	traceIntersectsRegion,
	translateReviewBounds,
	viaIntersectsRegion,
} from '../src/domain/layoutDiffPreview';
import type { LayoutPlanItem } from '../src/domain/layoutPlan';
import { buildFocusedReviewRegions } from '../src/domain/focusedPlacementCompare';
import { resolveReviewNavigationFocus } from '../src/domain/reviewNavigator';
import { renderNativeSnapshotDiffOverlay } from '../src/ui/nativeSnapshotDiff';
import { renderFocusedLocalDetailCompare } from '../src/ui/focusedPlacementDetail';

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
		{ startX: 900, startY: 1000, endX: 2050, endY: 1500, width: 8, layer: 'TopLayer' },
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

const subject = buildLayoutReviewComponent({
	id: 'c21',
	designator: 'C21',
	x: 1000,
	y: 1000,
	rotation: 0,
	layer: 'TOP',
	locked: false,
	bounds: item.fromBounds,
	pads: [
		{
			componentId: 'c21',
			designator: 'C21',
			padNumber: '1',
			x: 990,
			y: 1000,
			width: 10,
			height: 16,
			rotation: 0,
		},
		{
			componentId: 'c21',
			designator: 'C21',
			padNumber: '2',
			x: 1010,
			y: 1000,
			width: 10,
			height: 16,
			rotation: 0,
		},
	],
});
assert.ok(subject);

const nativeOverlay = renderNativeSnapshotDiffOverlay(
	{
		planId: 'layout-plan-test',
		itemIndex: 0,
		item,
		viewport,
		boardOuter: [],
		boardHoles: [],
		components: [subject, padAnchored],
		subject,
		subjectTargetBounds: translateReviewBounds(
			subject.bounds,
			item.to.x - item.from.x,
			item.to.y - item.from.y,
		),
		owner: padAnchored,
		traces: [],
		vias: [],
	},
	viewport,
	'diff',
);
assert.match(nativeOverlay, /#d74444/, 'native diff must mark CURRENT in red');
assert.match(nativeOverlay, /#24a66a/, 'native diff must mark TARGET in green');
assert.match(nativeOverlay, /CURRENT · C21/);
assert.match(nativeOverlay, /TARGET · C21/);
assert.match(nativeOverlay, /OWNER · U11/);

const focusedScene = {
	planId: 'layout-plan-focused',
	itemIndex: 0,
	item,
	viewport,
	boardOuter: [
		{ x: 0, y: 0 },
		{ x: 3000, y: 0 },
		{ x: 3000, y: 2200 },
		{ x: 0, y: 2200 },
	],
	boardHoles: [],
	components: [subject, padAnchored],
	subject,
	subjectTargetBounds: translateReviewBounds(
		subject.bounds,
		item.to.x - item.from.x,
		item.to.y - item.from.y,
	),
	owner: padAnchored,
	traces: [],
	vias: [],
};

const focused = buildFocusedReviewRegions(focusedScene);
const currentWidth = focused.current.right - focused.current.left;
const currentHeight = focused.current.bottom - focused.current.top;
const proposedWidth = focused.proposed.right - focused.proposed.left;
const proposedHeight = focused.proposed.bottom - focused.proposed.top;

assert.equal(
	currentWidth,
	proposedWidth,
	'CURRENT and PROPOSED panes must use the same physical width',
);
assert.equal(
	currentHeight,
	proposedHeight,
	'CURRENT and PROPOSED panes must use the same physical height',
);
assert.equal(
	(focused.current.left + focused.current.right) / 2,
	focusedScene.subject.anchor.x,
);
assert.equal(
	(focused.proposed.left + focused.proposed.right) / 2,
	focusedScene.item.to.x,
);
assert.ok(
	focused.overview.left < 0
	&& focused.overview.right > 3000
	&& focused.overview.top < 0
	&& focused.overview.bottom > 2200,
	'overview must contain the whole board with a margin',
);

const focusedHtml = renderFocusedLocalDetailCompare({
	scene: focusedScene,
});
assert.match(focusedHtml, /BEFORE/);
assert.match(focusedHtml, /AFTER/);
assert.match(focusedHtml, /CURRENT · C21/);
assert.match(focusedHtml, /TARGET · C21/);
assert.match(focusedHtml, /data-review-nav="current"/);
assert.match(focusedHtml, /data-review-nav="target"/);
assert.match(focusedHtml, /review-nav-strip/);
assert.match(focusedHtml, /当前位置/);
assert.match(focusedHtml, /建议位置/);
assert.doesNotMatch(
	focusedHtml,
	/focused-vector-overview/,
	'position navigation should not rely on a misleading miniature board map',
);
assert.match(focusedHtml, /data-review-nav="component"/);
assert.match(focusedHtml, /review-focus-halo/);
assert.doesNotMatch(
	focusedHtml,
	/绿色双环/,
	'permanent spotlight circles must not be part of the review copy',
);

const currentFocus = resolveReviewNavigationFocus(
	focusedScene,
	{ kind: 'current' },
);
assert.equal(currentFocus.selectPrimitiveId, 'c21');
assert.ok(currentFocus.region.left < subject.bounds.minX);
assert.ok(currentFocus.region.right > subject.bounds.maxX);
assert.ok(
	currentFocus.region.right - currentFocus.region.left <= 220,
	'CURRENT hotspot navigation should keep a tight local horizontal span',
);
assert.ok(
	currentFocus.region.bottom - currentFocus.region.top <= 220,
	'CURRENT hotspot navigation should keep a tight local vertical span',
);

const componentFocus = resolveReviewNavigationFocus(
	focusedScene,
	{ kind: 'component', componentId: 'u11' },
);
assert.equal(componentFocus.selectPrimitiveId, 'u11');
assert.ok(componentFocus.region.left < padAnchored.bounds.minX);
assert.ok(componentFocus.region.right > padAnchored.bounds.maxX);

const targetFocus = resolveReviewNavigationFocus(
	focusedScene,
	{ kind: 'target' },
);
assert.equal(targetFocus.selectPrimitiveId, undefined);
assert.ok(targetFocus.region.left < focusedScene.subjectTargetBounds.minX);
assert.ok(targetFocus.region.right > focusedScene.subjectTargetBounds.maxX);

console.log('Layout diff preview geometry tests passed.');
