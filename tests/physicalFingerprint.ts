import assert from 'node:assert/strict';

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
		bounds: { minX: 90, minY: 90, maxX: 110, maxY: 110 },
		pads: [
			{
				componentId: 'c1',
				designator: 'C1',
				padNumber: '2',
				net: 'GND',
				x: 105,
				y: 100,
				width: 8,
				height: 8,
				rotation: 0,
				connectedPrimitiveCount: 0,
			},
			{
				componentId: 'c1',
				designator: 'C1',
				padNumber: '1',
				net: '+3.3V',
				x: 95,
				y: 100,
				width: 8,
				height: 8,
				rotation: 0,
				connectedPrimitiveCount: 0,
			},
		],
	},
];

const ring = [
	{ x: 0, y: 0 },
	{ x: 500, y: 0 },
	{ x: 500, y: 300 },
	{ x: 0, y: 300 },
];

const rotate = <T>(values: T[], start: number): T[] =>
	values.map((_, index) => values[(start + index) % values.length]);

const fingerprint = (
	outerPoints: typeof ring,
	keepoutPoints = [
		{ x: 100, y: 100 },
		{ x: 150, y: 100 },
		{ x: 150, y: 150 },
		{ x: 100, y: 150 },
	],
) => buildPhysicalBoardFingerprint({
	components,
	board: {
		outer: { points: outerPoints },
		holes: [],
		approximationToleranceMil: 0,
	},
	componentKeepouts: [{ points: keepoutPoints }],
});

const base = fingerprint(ring);
assert.match(base, /^phys-v2-/);

assert.equal(
	fingerprint(rotate(ring, 2)),
	base,
	'polygon start vertex must not change the physical fingerprint',
);

assert.equal(
	fingerprint([...ring].reverse()),
	base,
	'polygon winding direction must not change the physical fingerprint',
);

const keepout = [
	{ x: 100, y: 100 },
	{ x: 150, y: 100 },
	{ x: 150, y: 150 },
	{ x: 100, y: 150 },
];
assert.equal(
	fingerprint(ring, rotate(keepout, 1)),
	base,
	'keepout start vertex must not change the physical fingerprint',
);
assert.equal(
	fingerprint(ring, [...keepout].reverse()),
	base,
	'keepout winding direction must not change the physical fingerprint',
);

const moved = buildPhysicalBoardFingerprint({
	components: [{ ...components[0], x: 101 }],
	board: {
		outer: { points: ring },
		holes: [],
		approximationToleranceMil: 0,
	},
	componentKeepouts: [{ points: keepout }],
});
assert.notEqual(
	moved,
	base,
	'a real component move must still change the physical fingerprint',
);

console.log('Physical fingerprint canonicalization tests passed.');
