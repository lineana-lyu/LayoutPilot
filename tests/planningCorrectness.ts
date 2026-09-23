import assert from 'node:assert/strict';

import {
	solveClusterAssignment,
	type ClusterPlacementMember,
} from '../src/domain/clusterAssignment';
import {
	planDecouplingPlacement,
	type PhysicalComponentSnapshot,
} from '../src/domain/physicalPlacement';
import {
	evaluatePlacementObjective,
	isStrictPlacementImprovement,
} from '../src/domain/placementObjective';

const baseline = evaluatePlacementObjective({
	loopProxyMil: 200,
	movementMil: 0,
});
const worseMove = evaluatePlacementObjective({
	loopProxyMil: 220,
	movementMil: 50,
});
assert.equal(
	isStrictPlacementImprovement(baseline, worseMove),
	false,
	'a move that worsens the objective must never beat KEEP_CURRENT',
);

function component(
	id: string,
	designator: string,
	x: number,
	y: number,
): PhysicalComponentSnapshot {
	return {
		id,
		designator,
		x,
		y,
		rotation: 0,
		layer: 'TOP',
		locked: false,
		bounds: {
			minX: x - 18,
			minY: y - 14,
			maxX: x + 18,
			maxY: y + 14,
		},
		pads: [
			{
				componentId: id,
				designator,
				padNumber: '1',
				net: '3V3',
				x: x + 10,
				y,
				width: 12,
				height: 12,
				rotation: 0,
				connectedPrimitiveCount: 0,
			},
			{
				componentId: id,
				designator,
				padNumber: '2',
				net: 'GND',
				x: x - 10,
				y,
				width: 12,
				height: 12,
				rotation: 0,
				connectedPrimitiveCount: 0,
			},
		],
	};
}

{
	const owner = component('owner', 'U1', 0, 0);
	const subject = component('subject', 'C1', 1, 0);
	const result = planDecouplingPlacement({
		subject,
		owner,
		obstacles: [subject, owner],
		board: {
			outer: {
				points: [
					{ x: -1000, y: -1000 },
					{ x: 1000, y: -1000 },
					{ x: 1000, y: 1000 },
					{ x: -1000, y: 1000 },
				],
			},
			holes: [],
			approximationToleranceMil: 0,
		},
		componentKeepouts: [],
		powerNet: '3V3',
		groundNet: 'GND',
		mode: 'preview',
	});
	assert.equal(result.ready, false);
	assert.ok(
		result.reasons.some(reason => reason.includes('当前位置')),
		'planner must emit no move when current placement wins the same objective',
	);
}

interface AssignmentPayload {
	label: string;
}

function option(
	id: string,
	subjectId: string,
	cost: number,
	x: number,
): ClusterPlacementMember<AssignmentPayload>['options'][number] {
	return {
		id,
		subjectId,
		cost,
		bounds: {
			minX: x,
			minY: 0,
			maxX: x + 10,
			maxY: 10,
		},
		clearanceMil: 0,
		payload: { label: id },
	};
}

const members: ClusterPlacementMember<AssignmentPayload>[] = [
	{
		subjectId: 'A',
		options: [
			option('A-slot-1', 'A', 1, 0),
			option('A-slot-2', 'A', 2, 100),
		],
	},
	{
		subjectId: 'B',
		options: [
			option('B-slot-1', 'B', 1.1, 0),
			option('B-slot-2', 'B', 100, 100),
		],
	},
];

const joint = solveClusterAssignment({ members });
assert.equal(joint.complete, true);
assert.equal(joint.totalCost, 3.1);
assert.deepEqual(
	new Set(joint.assignments.map(item => item.id)),
	new Set(['A-slot-2', 'B-slot-1']),
	'joint assignment must avoid the sequential greedy trap',
);

const reversed = solveClusterAssignment({ members: [...members].reverse() });
assert.equal(reversed.complete, true);
assert.deepEqual(
	new Set(reversed.assignments.map(item => item.id)),
	new Set(['A-slot-2', 'B-slot-1']),
	'input/designator order must not change the optimal cluster assignment',
);

console.log('Planning correctness tests passed.');
