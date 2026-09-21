import assert from 'node:assert/strict';

import { buildCandidateGroups } from '../src/domain/candidateGrouping';
import { buildCircuitGraph, type CircuitComponentSnapshot } from '../src/domain/circuitGraph';
import { extractStructuralFeatures } from '../src/domain/componentFeatures';
import { resolveCoreAssociation } from '../src/domain/coreAssociation';

function analyze(components: CircuitComponentSnapshot[]) {
	const graph = buildCircuitGraph(components);
	const features = extractStructuralFeatures(
		graph,
		components.map(component => ({
			id: component.id,
			designator: component.designator,
		})),
	);
	const grouping = buildCandidateGroups(graph, features);
	return { graph, features, grouping };
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'peripheral',
			designator: 'R_TEST',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'SIG_LOCAL' }],
		},
		{
			id: 'core',
			designator: 'U_MID',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'SIG_LOCAL' }],
		},
	];
	const { graph, features, grouping } = analyze(components);
	const coreFeature = features.find(item => item.id === 'core');
	assert.ok(coreFeature);
	assert.equal(coreFeature.coreLevel, 'medium');

	const result = resolveCoreAssociation(
		graph,
		features,
		grouping,
		'peripheral',
	);

	assert.equal(result.status, 'resolved');
	assert.equal(result.resolvedCoreDesignator, 'U_MID');
	assert.ok(
		result.candidates[0].evidence.some(
			item => item.kind === 'direct-informative-net',
		),
	);
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'peripheral',
			designator: 'C_TEST',
			padCount: 2,
			pads: [{ padNumber: '2', net: 'GND' }],
		},
		{
			id: 'core',
			designator: 'U_CORE',
			padCount: 32,
			pads: [{ padNumber: '1', net: 'GND' }],
		},
	];
	const { graph, features, grouping } = analyze(components);
	const result = resolveCoreAssociation(
		graph,
		features,
		grouping,
		'peripheral',
	);

	assert.equal(result.status, 'insufficient-evidence');
	assert.equal(result.topScore, 0);
	assert.ok(
		result.candidates[0].evidence.some(
			item =>
				item.kind === 'ignored-ground'
				&& item.contribution === 0,
		),
	);
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'peripheral',
			designator: 'C_TEST',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'VDD_LOCAL' }],
		},
		{
			id: 'core',
			designator: 'U_CORE',
			padCount: 16,
			pads: [{ padNumber: '1', net: 'VDD_LOCAL' }],
		},
	];
	const { graph, features, grouping } = analyze(components);
	const result = resolveCoreAssociation(
		graph,
		features,
		grouping,
		'peripheral',
	);

	assert.equal(result.status, 'resolved');
	assert.equal(result.resolvedCoreDesignator, 'U_CORE');
	assert.ok(result.topScore >= 0.5);
	assert.ok(
		result.candidates[0].evidence.some(
			item => item.kind === 'direct-low-fanout-power',
		),
	);
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'peripheral',
			designator: 'C_TEST',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'VDD_SHARED' }],
		},
		{
			id: 'core-a',
			designator: 'U_A',
			padCount: 16,
			pads: [{ padNumber: '1', net: 'VDD_SHARED' }],
		},
		{
			id: 'core-b',
			designator: 'U_B',
			padCount: 16,
			pads: [{ padNumber: '1', net: 'VDD_SHARED' }],
		},
		{
			id: 'r1',
			designator: 'R_A',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'VDD_SHARED' }],
		},
		{
			id: 'r2',
			designator: 'R_B',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'VDD_SHARED' }],
		},
		{
			id: 'r3',
			designator: 'R_C',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'VDD_SHARED' }],
		},
	];
	const { graph, features, grouping } = analyze(components);
	const result = resolveCoreAssociation(
		graph,
		features,
		grouping,
		'peripheral',
	);

	assert.equal(result.status, 'insufficient-evidence');
	assert.equal(result.resolvedCoreDesignator, undefined);
	assert.ok(result.candidates.length >= 2);
	assert.ok(result.topScore < 0.5);
}

{
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'peripheral',
			designator: 'R_TEST',
			padCount: 2,
			pads: [{ padNumber: '1', net: 'SIG_SHARED' }],
		},
		{
			id: 'core-a',
			designator: 'U_A',
			padCount: 16,
			pads: [{ padNumber: '1', net: 'SIG_SHARED' }],
		},
		{
			id: 'core-b',
			designator: 'U_B',
			padCount: 16,
			pads: [{ padNumber: '1', net: 'SIG_SHARED' }],
		},
	];
	const { graph, features, grouping } = analyze(components);
	const result = resolveCoreAssociation(
		graph,
		features,
		grouping,
		'peripheral',
	);

	assert.equal(result.status, 'ambiguous');
	assert.equal(result.resolvedCoreDesignator, undefined);
	assert.equal(result.candidates[0].score, result.candidates[1].score);
	assert.equal(result.margin, 0);
}

console.log('Core Association Resolver tests passed.');
