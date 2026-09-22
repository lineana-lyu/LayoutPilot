import assert from 'node:assert/strict';

import {
	placementPlansEquivalent,
	planDecouplingPlacement,
	validatePlacementTarget,
	type PhysicalComponentSnapshot,
} from '../src/domain/physicalPlacement';

const board = {
	points: [
		{ x: -1000, y: -1000 },
		{ x: 1000, y: -1000 },
		{ x: 1000, y: 1000 },
		{ x: -1000, y: 1000 },
	],
};

function component(
	id: string,
	designator: string,
	x: number,
	y: number,
	options?: {
		locked?: boolean;
		layer?: string;
		routed?: number;
		powerPadX?: number;
		powerPadY?: number;
		groundPadX?: number;
		groundPadY?: number;
	},
): PhysicalComponentSnapshot {
	const powerPadX = options?.powerPadX ?? x + 10;
	const powerPadY = options?.powerPadY ?? y;
	const groundPadX = options?.groundPadX ?? x - 10;
	const groundPadY = options?.groundPadY ?? y;
	const padHalf = 12;
	const minX = Math.min(powerPadX, groundPadX) - padHalf;
	const maxX = Math.max(powerPadX, groundPadX) + padHalf;
	const minY = Math.min(powerPadY, groundPadY) - padHalf;
	const maxY = Math.max(powerPadY, groundPadY) + padHalf;

	return {
		id,
		designator,
		x,
		y,
		rotation: 0,
		layer: options?.layer ?? 'TOP',
		locked: options?.locked ?? false,
		bounds: { minX, minY, maxX, maxY },
		pads: [
			{
				componentId: id,
				designator,
				padNumber: '1',
				net: '3V3',
				x: powerPadX,
				y: powerPadY,
				width: 24,
				height: 24,
				rotation: 0,
				connectedPrimitiveCount: options?.routed,
			},
			{
				componentId: id,
				designator,
				padNumber: '2',
				net: 'GND',
				x: groundPadX,
				y: groundPadY,
				width: 24,
				height: 24,
				rotation: 0,
				connectedPrimitiveCount: options?.routed,
			},
		],
	};
}

{
	const subject = component('c1', 'C1', 300, 300, {
		routed: 0,
		powerPadX: 290,
		groundPadX: 310,
	});
	const owner = component('u1', 'U1', 100, 100, {
		powerPadX: 130,
		powerPadY: 100,
		groundPadX: 90,
	});
	const result = planDecouplingPlacement({
		subject,
		owner,
		obstacles: [subject, owner],
		board,
		componentKeepouts: [],
		powerNet: '3V3',
		groundNet: 'GND',
	});

	assert.equal(result.ready, true);
	assert.ok(result.plan);
	assert.equal(result.plan.ownerPowerPadNumber, '1');
	assert.equal(result.plan.subjectPowerPadNumber, '1');
	assert.notDeepEqual(result.plan.from, result.plan.to);
}

{
	const subject = component('c1', 'C1', 300, 300);
	const owner = component('u1', 'U1', 100, 100);
	const result = planDecouplingPlacement({
		subject,
		owner,
		obstacles: [subject, owner],
		board,
		componentKeepouts: [],
		powerNet: '3V3',
		groundNet: 'GND',
	});

	assert.equal(result.ready, false);
	assert.ok(result.reasons.some(reason => reason.includes('无法确认')));
}

{
	const subject = component('c1', 'C1', 300, 300, {
		routed: 1,
	});
	const owner = component('u1', 'U1', 100, 100);
	const result = planDecouplingPlacement({
		subject,
		owner,
		obstacles: [subject, owner],
		board,
		componentKeepouts: [],
		powerNet: '3V3',
		groundNet: 'GND',
	});

	assert.equal(result.ready, false);
	assert.ok(result.reasons.some(reason => reason.includes('已有布线')));
}

{
	const subject = component('c1', 'C1', 300, 300, {
		routed: 0,
		locked: true,
	});
	const owner = component('u1', 'U1', 100, 100);
	const result = planDecouplingPlacement({
		subject,
		owner,
		obstacles: [subject, owner],
		board,
		componentKeepouts: [],
		powerNet: '3V3',
		groundNet: 'GND',
	});

	assert.equal(result.ready, false);
	assert.ok(result.reasons.some(reason => reason.includes('已锁定')));
}

{
	const subject = component('c1', 'C1', 300, 300, {
		routed: 0,
		layer: 'BOTTOM',
	});
	const owner = component('u1', 'U1', 100, 100, {
		layer: 'TOP',
	});
	const result = planDecouplingPlacement({
		subject,
		owner,
		obstacles: [subject, owner],
		board,
		componentKeepouts: [],
		powerNet: '3V3',
		groundNet: 'GND',
	});

	assert.equal(result.ready, false);
	assert.ok(result.reasons.some(reason => reason.includes('不在同一器件层')));
}

{
	const subject = component('c1', 'C1', 300, 300, { routed: 0 });
	const owner = component('u1', 'U1', 100, 100);
	const unknownObstacle: PhysicalComponentSnapshot = {
		id: 'x1',
		designator: 'X1',
		x: 220,
		y: 100,
		rotation: 0,
		layer: 'TOP',
		locked: false,
		pads: [],
	};
	const result = planDecouplingPlacement({
		subject,
		owner,
		obstacles: [subject, owner, unknownObstacle],
		board,
		componentKeepouts: [],
		powerNet: '3V3',
		groundNet: 'GND',
	});

	assert.equal(result.ready, false);
	assert.ok(result.reasons.some(reason => reason.includes('不能证明候选位置无碰撞')));
}

{
	const subject = component('c1', 'C1', 300, 300, {
		routed: 0,
		powerPadX: 290,
		groundPadX: 310,
	});
	const owner = component('u1', 'U1', 100, 100, {
		powerPadX: 130,
		powerPadY: 100,
		groundPadX: 90,
	});
	const blockingKeepout = {
		points: [
			{ x: 150, y: 50 },
			{ x: 300, y: 50 },
			{ x: 300, y: 150 },
			{ x: 150, y: 150 },
		],
	};
	const result = planDecouplingPlacement({
		subject,
		owner,
		obstacles: [subject, owner],
		board,
		componentKeepouts: [blockingKeepout],
		powerNet: '3V3',
		groundNet: 'GND',
	});

	assert.equal(result.ready, false);
	assert.ok(result.reasons.some(reason => reason.includes('keepout')));
}

{
	const subject = component('c1', 'C1', 300, 300, { routed: 0 });
	const obstacle = component('u1', 'U1', 100, 100);
	const safe = validatePlacementTarget({
		subject,
		obstacles: [subject, obstacle],
		board,
		componentKeepouts: [],
		target: { x: 300, y: 300 },
	});
	assert.equal(safe.valid, true);

	const collision = validatePlacementTarget({
		subject,
		obstacles: [subject, obstacle],
		board,
		componentKeepouts: [],
		target: { x: 110, y: 100 },
	});
	assert.equal(collision.valid, false);
	assert.ok(collision.reasons.some(reason => reason.includes('BBox 冲突')));

	const outside = validatePlacementTarget({
		subject,
		obstacles: [subject, obstacle],
		board,
		componentKeepouts: [],
		target: { x: 995, y: 995 },
	});
	assert.equal(outside.valid, false);
	assert.ok(outside.reasons.some(reason => reason.includes('板框')));
}

{
	const subject = component('c1', 'C1', 300, 300, {
		routed: 0,
		powerPadX: 290,
		groundPadX: 310,
	});
	const owner = component('u1', 'U1', 100, 100, {
		powerPadX: 130,
		groundPadX: 90,
	});
	const mechanicalObstacle: PhysicalComponentSnapshot = {
		id: 'h1',
		designator: 'H1',
		x: -600,
		y: -600,
		rotation: 0,
		layer: 'TOP',
		locked: true,
		bounds: {
			minX: -650,
			minY: -650,
			maxX: -550,
			maxY: -550,
		},
		pads: [],
	};
	const result = planDecouplingPlacement({
		subject,
		owner,
		obstacles: [subject, owner, mechanicalObstacle],
		board,
		componentKeepouts: [],
		powerNet: '3V3',
		groundNet: 'GND',
	});
	assert.equal(
		result.ready,
		true,
		'a measured mechanical obstacle does not need fake electrical pads',
	);
}

{
	const a = {
		subjectId: 'c1',
		subjectDesignator: 'C1',
		ownerId: 'u1',
		ownerDesignator: 'U1',
		powerNet: '3V3',
		groundNet: 'GND',
		ownerPowerPadNumber: '1',
		subjectPowerPadNumber: '1',
		ownerGroundPadNumber: '2',
		subjectGroundPadNumber: '2',
		estimatedLoopProxyMil: 80,
		from: { x: 100, y: 200 },
		to: { x: 120, y: 220 },
		clearanceMil: 20,
		rationale: 'test',
	};
	assert.equal(placementPlansEquivalent(a, { ...a }), true);
	assert.equal(
		placementPlansEquivalent(a, {
			...a,
			to: { x: 125, y: 220 },
		}),
		false,
	);
	assert.equal(
		placementPlansEquivalent(a, {
			...a,
			ownerPowerPadNumber: '3',
		}),
		false,
	);
}

console.log('Physical placement planner tests passed.');
