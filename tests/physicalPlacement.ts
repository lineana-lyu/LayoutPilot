import assert from 'node:assert/strict';

import {
	planDecouplingPlacement,
	type PhysicalComponentSnapshot,
} from '../src/domain/physicalPlacement';

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
	},
): PhysicalComponentSnapshot {
	const powerPadX = options?.powerPadX ?? x + 40;
	const powerPadY = options?.powerPadY ?? y;
	return {
		id,
		designator,
		x,
		y,
		rotation: 0,
		layer: options?.layer ?? 'TOP',
		locked: options?.locked ?? false,
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
				x: x - 40,
				y,
				width: 24,
				height: 24,
				rotation: 0,
				connectedPrimitiveCount: options?.routed,
			},
		],
	};
}

{
	const subject = component('c1', 'C1', 300, 300, { routed: 0 });
	const owner = component('u1', 'U1', 100, 100, {
		powerPadX: 160,
		powerPadY: 100,
	});
	const result = planDecouplingPlacement({
		subject,
		owner,
		obstacles: [subject, owner],
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
		powerNet: '3V3',
		groundNet: 'GND',
	});

	assert.equal(result.ready, false);
	assert.ok(result.reasons.some(reason => reason.includes('不在同一器件层')));
}

console.log('Physical placement planner tests passed.');
