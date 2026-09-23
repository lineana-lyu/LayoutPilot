import assert from 'node:assert/strict';

import { buildLocalLayoutPlan } from '../src/application/layoutPlanner';
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

const multiPhysical = [
	{
		id: 'c-a',
		designator: 'C_A',
		x: 700,
		y: 700,
		rotation: 0,
		layer: 'TOP',
		locked: false,
		bounds: { minX: 680, minY: 685, maxX: 720, maxY: 715 },
		pads: [
			{ componentId: 'c-a', designator: 'C_A', padNumber: '1', net: '3V3', x: 690, y: 700, width: 12, height: 18, rotation: 0, connectedPrimitiveCount: 0 },
			{ componentId: 'c-a', designator: 'C_A', padNumber: '2', net: 'GND', x: 710, y: 700, width: 12, height: 18, rotation: 0, connectedPrimitiveCount: 0 },
		],
	},
	{
		id: 'u-a',
		designator: 'U_A',
		x: 300,
		y: 300,
		rotation: 0,
		layer: 'TOP',
		locked: true,
		bounds: { minX: 260, minY: 260, maxX: 340, maxY: 340 },
		pads: [
			{ componentId: 'u-a', designator: 'U_A', padNumber: '1', net: '3V3', x: 330, y: 300, width: 14, height: 14, rotation: 0 },
			{ componentId: 'u-a', designator: 'U_A', padNumber: '2', net: 'GND', x: 270, y: 300, width: 14, height: 14, rotation: 0 },
		],
	},
	{
		id: 'c-b',
		designator: 'C_B',
		x: 1300,
		y: 1300,
		rotation: 0,
		layer: 'TOP',
		locked: false,
		bounds: { minX: 1280, minY: 1285, maxX: 1320, maxY: 1315 },
		pads: [
			{ componentId: 'c-b', designator: 'C_B', padNumber: '1', net: '3V3', x: 1290, y: 1300, width: 12, height: 18, rotation: 0, connectedPrimitiveCount: 0 },
			{ componentId: 'c-b', designator: 'C_B', padNumber: '2', net: 'GND', x: 1310, y: 1300, width: 12, height: 18, rotation: 0, connectedPrimitiveCount: 0 },
		],
	},
	{
		id: 'u-b',
		designator: 'U_B',
		x: 1700,
		y: 1700,
		rotation: 0,
		layer: 'TOP',
		locked: true,
		bounds: { minX: 1660, minY: 1660, maxX: 1740, maxY: 1740 },
		pads: [
			{ componentId: 'u-b', designator: 'U_B', padNumber: '1', net: '3V3', x: 1730, y: 1700, width: 14, height: 14, rotation: 0 },
			{ componentId: 'u-b', designator: 'U_B', padNumber: '2', net: 'GND', x: 1670, y: 1700, width: 14, height: 14, rotation: 0 },
		],
	},
];

const multiPlan = buildLocalLayoutPlan({
	snapshotId: 'semantic-multi',
	semanticFingerprint: 'sem-multi',
	physicalFingerprint: 'phys-multi',
	candidates: [
		{
			constraintId: 'C_A:near:U_A',
			subjectId: 'c-a',
			subjectDesignator: 'C_A',
			ownerId: 'u-a',
			ownerDesignator: 'U_A',
			powerNet: '3V3',
			groundNet: 'GND',
		},
		{
			constraintId: 'C_B:near:U_B',
			subjectId: 'c-b',
			subjectDesignator: 'C_B',
			ownerId: 'u-b',
			ownerDesignator: 'U_B',
			powerNet: '3V3',
			groundNet: 'GND',
		},
	],
	physicalComponents: multiPhysical,
	board: {
		outer: {
			points: [
				{ x: 0, y: 0 },
				{ x: 2000, y: 0 },
				{ x: 2000, y: 2000 },
				{ x: 0, y: 2000 },
			],
		},
		holes: [],
		approximationToleranceMil: 0,
	},
	componentKeepouts: [],
	maxItems: 8,
});
assert.ok(multiPlan.plan);
assert.equal(
	multiPlan.plan.items.length,
	2,
	'multi-owner review must retain every legal confirmed placement item',
);
assert.deepEqual(
	new Set(multiPlan.plan.items.map(item => item.subjectDesignator)),
	new Set(['C_A', 'C_B']),
);

console.log('LayoutPlan tests passed.');
