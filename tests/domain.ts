import assert from 'node:assert/strict';

import { buildCandidateGroups } from '../src/domain/candidateGrouping';
import { buildCircuitGraph, type CircuitComponentSnapshot } from '../src/domain/circuitGraph';
import { extractStructuralFeatures, type ComponentMetadata } from '../src/domain/componentFeatures';
import { buildNetGroupingProfiles } from '../src/domain/netInformativeness';

function featuresFor(components: CircuitComponentSnapshot[]) {
	const graph = buildCircuitGraph(components);
	const metadata: ComponentMetadata[] = components.map(component => ({
		id: component.id,
		designator: component.designator,
	}));
	return {
		graph,
		features: extractStructuralFeatures(graph, metadata),
	};
}

function toyFixture(): CircuitComponentSnapshot[] {
	return [
		{
			id: 'u1',
			designator: 'U1',
			padCount: 100,
			pads: [
				{ padNumber: '76', net: 'SIG_R1' },
			],
		},
		{
			id: 'r1',
			designator: 'R1',
			padCount: 2,
			pads: [
				{ padNumber: '2', net: 'SIG_R1' },
			],
		},
		{
			id: 'c1',
			designator: 'C1',
			padCount: 2,
			pads: [],
		},
	];
}

function sharedRailFixture(): CircuitComponentSnapshot[] {
	return [
		{
			id: 'u1',
			designator: 'U1',
			padCount: 32,
			pads: [
				{ padNumber: '1', net: 'GND' },
				{ padNumber: '2', net: '3V3' },
				{ padNumber: '3', net: 'SIG_U1' },
				{ padNumber: '4', net: 'USB_SIG' },
			],
		},
		{
			id: 'u2',
			designator: 'U2',
			padCount: 16,
			pads: [
				{ padNumber: '1', net: 'GND' },
				{ padNumber: '2', net: '3V3' },
				{ padNumber: '3', net: 'SIG_U2' },
			],
		},
		{
			id: 'r1',
			designator: 'R1',
			padCount: 2,
			pads: [
				{ padNumber: '1', net: 'SIG_U1' },
				{ padNumber: '2', net: 'GND' },
			],
		},
		{
			id: 'r2',
			designator: 'R2',
			padCount: 2,
			pads: [
				{ padNumber: '1', net: 'SIG_U2' },
				{ padNumber: '2', net: 'GND' },
			],
		},
		{
			id: 'c1',
			designator: 'C1',
			padCount: 2,
			pads: [
				{ padNumber: '1', net: '3V3' },
				{ padNumber: '2', net: 'GND' },
			],
		},
		{
			id: 'j1',
			designator: 'J1',
			padCount: 4,
			pads: [
				{ padNumber: '1', net: 'USB_SIG' },
				{ padNumber: '2', net: 'GND' },
			],
		},
	];
}

{
	const { graph, features } = featuresFor(toyFixture());
	const result = buildCandidateGroups(graph, features);

	assert.equal(result.groups.length, 1);
	assert.equal(result.groups[0].coreDesignator, 'U1');
	assert.deepEqual(result.groups[0].satelliteDesignators, ['R1']);
	assert.deepEqual(result.ungroupedDesignators, ['C1']);
	assert.deepEqual(result.ambiguousDesignators, []);
}

{
	const { graph, features } = featuresFor(sharedRailFixture());
	const profiles = buildNetGroupingProfiles(graph);
	const result = buildCandidateGroups(graph, features);

	assert.equal(profiles.get('GND')?.classification, 'global-ground');
	assert.equal(profiles.get('3V3')?.classification, 'global-power');

	const u1 = result.groups.find(group => group.coreDesignator === 'U1');
	const u2 = result.groups.find(group => group.coreDesignator === 'U2');

	assert.ok(u1);
	assert.ok(u2);
	assert.ok(u1.satelliteDesignators.includes('R1'));
	assert.ok(!u1.satelliteDesignators.includes('R2'));
	assert.ok(u2.satelliteDesignators.includes('R2'));
	assert.ok(!u2.satelliteDesignators.includes('R1'));

	assert.ok(result.ambiguousDesignators.includes('C1'));
	assert.ok(result.boundaryDesignators.includes('J1'));
}

console.log('LayoutPilot domain regression tests passed.');
