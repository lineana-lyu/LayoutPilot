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

function headerFalseCoreFixture(): CircuitComponentSnapshot[] {
	return [
		{
			id: 'u1',
			designator: 'U1',
			padCount: 32,
			pads: [
				{ padNumber: '1', net: 'GND' },
				{ padNumber: '2', net: '3V' },
				{ padNumber: '3', net: 'NRST' },
			],
		},
		{
			id: 'h5',
			designator: 'H5',
			padCount: 16,
			pads: [
				{ padNumber: '1', net: 'GND' },
				{ padNumber: '14', net: 'VDD' },
				{ padNumber: '12', net: 'NRST' },
				{ padNumber: '15', net: '3V' },
				{ padNumber: '16', net: 'GND' },
			],
		},
		{
			id: 'r1',
			designator: 'R1',
			padCount: 2,
			pads: [
				{ padNumber: '1', net: 'NRST' },
				{ padNumber: '2', net: '3V' },
			],
		},
		{
			id: 'c4',
			designator: 'C4',
			padCount: 2,
			pads: [
				{ padNumber: '1', net: 'GND' },
				{ padNumber: '2', net: 'NRST' },
			],
		},
		{
			id: 'sw1',
			designator: 'SW1',
			padCount: 4,
			pads: [
				{ padNumber: '1', net: 'NRST' },
				{ padNumber: '2', net: 'GND' },
			],
		},
		{
			id: 'x1',
			designator: 'X1',
			padCount: 2,
			pads: [
				{ padNumber: '1', net: 'OSC1' },
				{ padNumber: '2', net: 'OSC2' },
			],
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


{
	const { graph, features } = featuresFor(headerFalseCoreFixture());
	const profiles = buildNetGroupingProfiles(graph);
	const result = buildCandidateGroups(graph, features);
	const h5 = features.find(feature => feature.designator === 'H5');
	const x1 = features.find(feature => feature.designator === 'X1');
	const sw1 = features.find(feature => feature.designator === 'SW1');
	const u1Group = result.groups.find(group => group.coreDesignator === 'U1');

	assert.equal(profiles.get('NRST')?.classification, 'named-signal');
	assert.equal(profiles.get('NRST')?.groupingWeight, 1);

	assert.ok(h5);
	assert.equal(h5.isBoundaryCandidate, true);
	assert.equal(h5.isCoreEligible, false);
	assert.ok(result.boundaryDesignators.includes('H5'));
	assert.ok(!result.groups.some(group => group.coreDesignator === 'H5'));

	assert.ok(x1);
	assert.equal(x1.isPassiveCandidate, true);
	assert.equal(x1.isCoreEligible, false);

	assert.ok(sw1);
	assert.equal(sw1.isPeripheralCandidate, true);
	assert.equal(sw1.isCoreEligible, false);

	assert.ok(u1Group);
	assert.ok(u1Group.satelliteDesignators.includes('R1'));
	assert.ok(u1Group.satelliteDesignators.includes('C4'));
	assert.ok(u1Group.satelliteDesignators.includes('SW1'));
}

console.log('Header false-core regression passed.');
