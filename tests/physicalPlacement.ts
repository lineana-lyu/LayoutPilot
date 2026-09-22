import assert from 'node:assert/strict';

import {
	planDecouplingPlacement,
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

console.log('Physical placement planner tests passed.');
