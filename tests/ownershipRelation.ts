import assert from 'node:assert/strict';

import { buildCircuitGraph, type CircuitComponentSnapshot } from '../src/domain/circuitGraph';
import { extractStructuralFeatures } from '../src/domain/componentFeatures';
import {
	resolveOwnershipRelation,
	type ExplicitOwnershipHint,
} from '../src/domain/ownershipRelation';

function analyze(components: CircuitComponentSnapshot[]) {
	const graph = buildCircuitGraph(components);
	const features = extractStructuralFeatures(
		graph,
		components.map(component => ({
			id: component.id,
			designator: component.designator,
		})),
	);
	return { graph, features };
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'part',
			designator: 'R_TEST',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'SIG_ONLY' }],
		},
		{
			id: 'core-a',
			designator: 'U_A',
			padCount: 8,
			pads: [{ padNumber: '1', net: 'SIG_ONLY' }],
		},
	];
	const { graph, features } = analyze(components);
	const result = resolveOwnershipRelation(
		graph,
		features,
		'part',
	);

	assert.equal(result.relation, 'single-core');
	assert.equal(result.ownerDesignator, 'U_A');
	assert.deepEqual(result.hostDesignators, ['U_A']);
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'part',
			designator: 'Q_TEST',
			padCount: 4,
			pads: [
				{ padNumber: '1', net: 'SIG_LEFT' },
				{ padNumber: '2', net: 'SIG_RIGHT' },
			],
		},
		{
			id: 'core-a',
			designator: 'U_A',
			padCount: 8,
			pads: [{ padNumber: '1', net: 'SIG_LEFT' }],
		},
		{
			id: 'core-b',
			designator: 'U_B',
			padCount: 8,
			pads: [{ padNumber: '1', net: 'SIG_RIGHT' }],
		},
	];
	const { graph, features } = analyze(components);
	const result = resolveOwnershipRelation(
		graph,
		features,
		'part',
	);

	assert.equal(result.relation, 'bridge');
	assert.deepEqual(
		new Set(result.hostDesignators),
		new Set(['U_A', 'U_B']),
	);
	assert.equal(result.ownerDesignator, undefined);
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'part',
			designator: 'R_TEST',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'BUS_SHARED' }],
		},
		{
			id: 'core-a',
			designator: 'U_A',
			padCount: 8,
			pads: [{ padNumber: '1', net: 'BUS_SHARED' }],
		},
		{
			id: 'core-b',
			designator: 'U_B',
			padCount: 8,
			pads: [{ padNumber: '1', net: 'BUS_SHARED' }],
		},
		{
			id: 'core-c',
			designator: 'U_C',
			padCount: 8,
			pads: [{ padNumber: '1', net: 'BUS_SHARED' }],
		},
	];
	const { graph, features } = analyze(components);
	const result = resolveOwnershipRelation(
		graph,
		features,
		'part',
	);

	assert.equal(result.relation, 'shared-signal');
	assert.deepEqual(result.sharedSignalNets, ['BUS_SHARED']);
	assert.deepEqual(
		new Set(result.hostDesignators),
		new Set(['U_A', 'U_B', 'U_C']),
	);
	assert.equal(result.ownerDesignator, undefined);
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'part',
			designator: 'C_TEST',
			padCount: 2,
			pads: [
				{ padNumber: '1', net: 'VDD_RAIL' },
				{ padNumber: '2', net: 'GND' },
			],
		},
		{
			id: 'core-a',
			designator: 'U_A',
			padCount: 16,
			pads: [
				{ padNumber: '1', net: 'VDD_RAIL' },
				{ padNumber: '2', net: 'GND' },
			],
		},
		{
			id: 'core-b',
			designator: 'U_B',
			padCount: 16,
			pads: [
				{ padNumber: '1', net: 'VDD_RAIL' },
				{ padNumber: '2', net: 'GND' },
			],
		},
	];
	const { graph, features } = analyze(components);
	const result = resolveOwnershipRelation(
		graph,
		features,
		'part',
	);

	assert.equal(result.relation, 'rail-domain');
	assert.deepEqual(result.railNets, ['VDD_RAIL']);
	assert.equal(result.ownerDesignator, undefined);
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'part',
			designator: 'C_TEST',
			padCount: 2,
			pads: [{ padNumber: '2', net: 'GND' }],
		},
		{
			id: 'core-a',
			designator: 'U_A',
			padCount: 16,
			pads: [{ padNumber: '1', net: 'GND' }],
		},
	];
	const { graph, features } = analyze(components);
	const result = resolveOwnershipRelation(
		graph,
		features,
		'part',
	);

	assert.equal(result.relation, 'unknown');
	assert.equal(result.ownerDesignator, undefined);
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'part',
			designator: 'R_TEST',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'SIG_ONLY' }],
		},
		{
			id: 'core-a',
			designator: 'U_A',
			padCount: 8,
			pads: [{ padNumber: '1', net: 'SIG_ONLY' }],
		},
		{
			id: 'core-b',
			designator: 'U_B',
			padCount: 16,
			pads: [],
		},
	];
	const { graph, features } = analyze(components);
	const hints: ExplicitOwnershipHint[] = [
		{
			componentId: 'part',
			ownerComponentId: 'core-b',
			source: 'synthetic-explicit-group',
		},
	];
	const result = resolveOwnershipRelation(
		graph,
		features,
		'part',
		hints,
	);

	assert.equal(result.relation, 'explicit-owner');
	assert.equal(result.ownerDesignator, 'U_B');
	assert.deepEqual(result.hostDesignators, ['U_B']);
	assert.equal(result.evidence[0].kind, 'explicit-owner');
}

console.log('Ownership Relation Resolver tests passed.');
