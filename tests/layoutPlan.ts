import assert from 'node:assert/strict';

import {
	canTransitionLayoutPlan,
	createLayoutPlan,
	isLayoutPlan,
	layoutPlanAcceptanceMode,
	layoutPlanMatchesCurrentState,
	markLayoutPlanAccepted,
	transitionLayoutPlan,
} from '../src/domain/layoutPlan';
import {
	formatLayoutPlanItemReview,
	layoutPlanItemReviewMetrics,
} from '../src/domain/layoutPlanReview';
import { buildPhysicalBoardFingerprint } from '../src/domain/physicalFingerprint';

const components = [
	{
		id: 'c1',
		designator: 'C1',
		x: 100,
		y: 100,
		rotation: 0,
		layer: 'TOP',
		locked: false,
		bounds: { minX: 95, minY: 95, maxX: 105, maxY: 105 },
		pads: [
			{
				componentId: 'c1',
				designator: 'C1',
				padNumber: '1',
				net: '+3.3V',
				x: 98,
				y: 100,
				width: 4,
				height: 4,
				rotation: 0,
				connectedPrimitiveCount: 0,
			},
		],
	},
];

const board = {
	outer: {
		points: [
			{ x: 0, y: 0 },
			{ x: 500, y: 0 },
			{ x: 500, y: 500 },
			{ x: 0, y: 500 },
		],
	},
	holes: [],
	approximationToleranceMil: 0,
};

const fingerprintA = buildPhysicalBoardFingerprint({
	components,
	board,
	componentKeepouts: [],
});
const fingerprintB = buildPhysicalBoardFingerprint({
	components: [{ ...components[0], x: 101 }],
	board,
	componentKeepouts: [],
});
assert.notEqual(
	fingerprintA,
	fingerprintB,
	'physical movement must invalidate LayoutPlan fingerprint',
);

const plan = createLayoutPlan({
	snapshotId: 'semantic-a',
	semanticFingerprint: 'sem-v1-a',
	physicalFingerprint: fingerprintA,
	createdAt: '2026-09-22T02:00:00.000Z',
	items: [
		{
			constraintId: 'C1:near:U1',
			subjectId: 'c1',
			subjectDesignator: 'C1',
			ownerId: 'u1',
			ownerDesignator: 'U1',
			powerNet: '+3.3V',
			groundNet: 'GND',
			ownerPowerPadNumber: '8',
			subjectPowerPadNumber: '1',
			ownerGroundPadNumber: '4',
			subjectGroundPadNumber: '2',
			from: { x: 100, y: 100 },
			to: { x: 130, y: 100 },
			fromBounds: { minX: 95, minY: 95, maxX: 105, maxY: 105 },
			toBounds: { minX: 125, minY: 95, maxX: 135, maxY: 105 },
			movementMil: 30,
			currentLoopProxyMil: 100,
			estimatedLoopProxyMil: 44,
			clearanceMil: 20,
			executionBlockers: [],
			rationale: 'fixture',
		},
	],
});

assert.equal(plan.status, 'preview');
assert.equal(Object.isFrozen(plan), true);
assert.equal(Object.isFrozen(plan.items), true);
assert.equal(Object.isFrozen(plan.items[0].to), true);
assert.equal(isLayoutPlan(JSON.parse(JSON.stringify(plan))), true);

assert.equal(
	layoutPlanAcceptanceMode(plan),
	'executable',
	'plan without execution blockers should be executable',
);

const referencePlan = createLayoutPlan({
	snapshotId: 'semantic-a',
	semanticFingerprint: 'sem-v1-a',
	physicalFingerprint: fingerprintA,
	createdAt: '2026-09-22T02:00:01.000Z',
	items: [
		{
			...plan.items[0],
			executionBlockers: ['C1 已有布线/铜连接，当前只允许预览，不执行器件移动'],
		},
	],
});
assert.equal(
	layoutPlanAcceptanceMode(referencePlan),
	'reference-only',
	'fully blocked preview must remain an explicit reference workflow',
);

const accepted = markLayoutPlanAccepted(plan);
assert.equal(accepted.status, 'accepted');
assert.equal(plan.status, 'preview', 'LayoutPlan status update must be immutable');
assert.equal(canTransitionLayoutPlan(plan, 'accept'), true);
assert.equal(canTransitionLayoutPlan(accepted, 'accept'), false);
assert.throws(
	() => transitionLayoutPlan(accepted, 'accept'),
	/Invalid LayoutPlan transition/,
	'accepted plan must not be accepted twice',
);

const review = layoutPlanItemReviewMetrics(plan.items[0]);
assert.equal(review.outcome, 'improved');
assert.equal(review.beforeLoopProxyMil, 100);
assert.equal(review.afterLoopProxyMil, 44);
assert.match(formatLayoutPlanItemReview(plan.items[0]), /降低 56\.0%/);

assert.equal(
	layoutPlanMatchesCurrentState(plan, {
		snapshotId: 'semantic-a',
		semanticFingerprint: 'sem-v1-a',
		physicalFingerprint: fingerprintA,
	}),
	true,
);
assert.equal(
	layoutPlanMatchesCurrentState(plan, {
		snapshotId: 'semantic-a',
		semanticFingerprint: 'sem-v1-a',
		physicalFingerprint: fingerprintB,
	}),
	false,
);

console.log('LayoutPlan tests passed.');
