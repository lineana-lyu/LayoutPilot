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
assert.match(base, /^phys-v3-/);

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

const bboxPresentationChanged = buildPhysicalBoardFingerprint({
	components: [{
		...components[0],
		bounds: { minX: -500, minY: -400, maxX: 800, maxY: 700 },
	}],
	board: {
		outer: { points: ring },
		holes: [],
		approximationToleranceMil: 0,
	},
	componentKeepouts: [{ points: keepout }],
});
assert.equal(
	bboxPresentationChanged,
	base,
	'derived EasyEDA primitive BBox changes must not stale an unchanged physical plan',
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

const routingComponents = [
	{
		...components[0],
		id: 'c1',
		designator: 'C1',
		pads: components[0].pads.map(pad => ({
			...pad,
			componentId: 'c1',
			designator: 'C1',
			connectedPrimitiveCount: 3,
		})),
	},
	{
		...components[0],
		id: 'c2',
		designator: 'C2',
		x: 200,
		y: 200,
		bounds: { minX: 190, minY: 190, maxX: 210, maxY: 210 },
		pads: components[0].pads.map(pad => ({
			...pad,
			componentId: 'c2',
			designator: 'C2',
			x: pad.x + 100,
			y: pad.y + 100,
			connectedPrimitiveCount: 7,
		})),
	},
];

const scoped = buildPhysicalBoardFingerprint({
	components: routingComponents,
	board: {
		outer: { points: ring },
		holes: [],
		approximationToleranceMil: 0,
	},
	componentKeepouts: [],
	routingEvidenceComponentIds: ['c1'],
});

const sameScopedWithOtherRoutingUnknown = buildPhysicalBoardFingerprint({
	components: routingComponents.map(component =>
		component.id === 'c2'
			? {
				...component,
				pads: component.pads.map(pad => ({
					...pad,
					connectedPrimitiveCount: undefined,
				})),
			}
			: component
	),
	board: {
		outer: { points: ring },
		holes: [],
		approximationToleranceMil: 0,
	},
	componentKeepouts: [],
	routingEvidenceComponentIds: ['c1'],
});

assert.equal(
	scoped,
	sameScopedWithOtherRoutingUnknown,
	'routing evidence outside the LayoutPlan scope must not change the fingerprint',
);

const scopedSubjectRoutingChanged = buildPhysicalBoardFingerprint({
	components: routingComponents.map(component =>
		component.id === 'c1'
			? {
				...component,
				pads: component.pads.map(pad => ({
					...pad,
					connectedPrimitiveCount: (pad.connectedPrimitiveCount ?? 0) + 1,
				})),
			}
			: component
	),
	board: {
		outer: { points: ring },
		holes: [],
		approximationToleranceMil: 0,
	},
	componentKeepouts: [],
	routingEvidenceComponentIds: ['c1'],
});

assert.notEqual(
	scoped,
	scopedSubjectRoutingChanged,
	'routing evidence for the actual LayoutPlan subject must still invalidate the fingerprint',
);

console.log('Physical fingerprint canonicalization tests passed.');
