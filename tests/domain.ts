import assert from 'node:assert/strict';

import { buildCandidateGroups } from '../src/domain/candidateGrouping';
import { buildCircuitGraph, type CircuitComponentSnapshot } from '../src/domain/circuitGraph';
import { extractStructuralFeatures, type ComponentMetadata } from '../src/domain/componentFeatures';
import { buildNetGroupingProfiles } from '../src/domain/netInformativeness';
import { buildSemanticContexts, resolveComponentDisplayName, type SemanticComponentContext } from '../src/domain/semanticContext';
import { allowedSemanticRolesForPrefix, buildSemanticEvidenceCatalog, validateSemanticInference } from '../src/domain/semanticInference';
import { buildSemanticGatewayRequest, normalizeGatewayBaseUrl, parseSemanticGatewayResponse } from '../src/ai/gatewayClient';
import { buildConstraintPreviewForInference, mergeConstraintPreviewResults } from '../src/domain/layoutConstraintEngine';

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


{
	const { graph, features } = featuresFor(sharedRailFixture());
	const grouping = buildCandidateGroups(graph, features);
	const contexts = buildSemanticContexts(
		graph,
		features,
		grouping,
		sharedRailFixture().map(component => ({
			id: component.id,
			designator: component.designator,
			name: component.designator,
		})),
	);

	const c1 = contexts.find(context => context.designator === 'C1');
	assert.ok(c1);
	assert.deepEqual(new Set(c1.relatedCoreDesignators), new Set(['U1', 'U2']));
	assert.deepEqual(new Set(c1.lowInformationNets), new Set(['GND', '3V3']));
	assert.equal(c1.informativeSignalNets.length, 0);
	assert.ok(c1.missingEvidence.includes('informative-signal-net'));
}

console.log('Semantic context regression passed.');


{
	assert.equal(
		resolveComponentDisplayName('={Value}', { Value: '100nF' }),
		'100nF',
	);
	assert.equal(
		resolveComponentDisplayName('={Manufacturer Part}', {
			'Manufacturer Part': 'BLM21PG221SN1D',
		}),
		'BLM21PG221SN1D',
	);
	assert.equal(
		resolveComponentDisplayName('STM32F103C8T6', { Value: 'ignored' }),
		'STM32F103C8T6',
	);
}

console.log('Semantic metadata template resolution passed.');


{
	const { graph, features } = featuresFor(sharedRailFixture());
	const grouping = buildCandidateGroups(graph, features);
	const contexts = buildSemanticContexts(
		graph,
		features,
		grouping,
		sharedRailFixture().map(component => ({
			id: component.id,
			designator: component.designator,
			name: component.designator,
		})),
	);

	const c1 = contexts.find(context => context.designator === 'C1');
	assert.ok(c1);

	const catalog = buildSemanticEvidenceCatalog(c1);
	assert.ok(catalog.some(item => item.id === 'net:GND'));
	assert.ok(catalog.some(item => item.id === 'net:3V3'));
	assert.ok(catalog.some(item => item.id === 'core:U1'));
	assert.ok(catalog.some(item => item.id === 'core:U2'));

	const valid = validateSemanticInference(c1, {
		status: 'insufficient-evidence',
		role: 'unknown',
		confidence: 'low',
		evidenceRefs: ['net:GND', 'net:3V3'],
		explanation: '只有共享电源/地关系，无法确定具体归属。',
		constraints: [
			{
				type: 'no-constraint',
				evidenceRefs: ['net:GND', 'net:3V3'],
			},
		],
	});
	assert.equal(valid.valid, true);

	const hallucinated = validateSemanticInference(c1, {
		status: 'inferred',
		role: 'decoupling-capacitor',
		associatedCore: 'U99',
		confidence: 'high',
		evidenceRefs: ['datasheet:invented'],
		explanation: '错误示例',
		constraints: [
			{
				type: 'near',
				target: 'U99.VDD',
				evidenceRefs: ['datasheet:invented'],
			},
		],
	});
	assert.equal(hallucinated.valid, false);
	assert.ok(hallucinated.errors.some(error => error.includes('不存在于规则层')));
	assert.ok(hallucinated.errors.some(error => error.includes('不存在的证据')));
}

console.log('Semantic inference validator passed.');


{
	assert.equal(
		normalizeGatewayBaseUrl('http://127.0.0.1:8787/'),
		'http://127.0.0.1:8787',
	);
	assert.throws(
		() => normalizeGatewayBaseUrl('127.0.0.1:8787'),
		/http:\/\/|https:\/\//,
	);

	const { graph, features } = featuresFor(sharedRailFixture());
	const grouping = buildCandidateGroups(graph, features);
	const context = buildSemanticContexts(
		graph,
		features,
		grouping,
		sharedRailFixture().map(component => ({
			id: component.id,
			designator: component.designator,
			name: component.designator,
		})),
	).find(item => item.designator === 'C1');

	assert.ok(context);
	const catalog = buildSemanticEvidenceCatalog(context);
	const request = buildSemanticGatewayRequest(
		context,
		catalog,
		allowedSemanticRolesForPrefix(context.referencePrefix),
	);
	assert.equal(request.version, '1');
	assert.equal(request.context.designator, 'C1');
	assert.ok(request.allowedRoles.includes('decoupling-capacitor'));
	assert.ok(request.allowedConstraintTargets.includes('U1'));
	assert.ok(request.allowedConstraintTargets.includes('GND'));

	const parsed = parseSemanticGatewayResponse({
		inference: {
			status: 'insufficient-evidence',
			role: 'unknown',
			confidence: 'low',
			evidenceRefs: ['net:GND', 'net:3V3'],
			explanation: '证据不足。',
			constraints: [
				{
					type: 'no-constraint',
					evidenceRefs: ['net:GND', 'net:3V3'],
				},
			],
		},
		provider: 'mock',
		model: 'fixture',
	});
	assert.equal(parsed.provider, 'mock');

	assert.throws(
		() => parseSemanticGatewayResponse({
			inference: {
				status: 'inferred',
				role: 'invented-role',
				confidence: 'high',
				evidenceRefs: [],
				explanation: 'bad',
				constraints: [],
			},
		}),
		/role/,
	);
}

console.log('AI gateway contract regression passed.');


{
	const { graph, features } = featuresFor(sharedRailFixture());
	const grouping = buildCandidateGroups(graph, features);
	const context = buildSemanticContexts(
		graph,
		features,
		grouping,
		sharedRailFixture().map(component => ({
			id: component.id,
			designator: component.designator,
			name: component.designator,
		})),
	).find(item => item.designator === 'C1');

	assert.ok(context);
	const catalog = buildSemanticEvidenceCatalog(context);
	assert.ok(catalog.some(item => item.label.includes('全局地')));
	assert.ok(catalog.some(item => item.label.includes('全局电源')));

	const invalidTarget = validateSemanticInference(context, {
		status: 'inferred',
		role: 'decoupling-capacitor',
		associatedCore: 'U1',
		confidence: 'medium',
		evidenceRefs: ['net:GND', 'net:3V3', 'core:U1'],
		explanation: '测试无效约束目标。',
		constraints: [
			{
				type: 'near',
				target: 'U99',
				evidenceRefs: ['core:U1'],
			},
		],
	});
	assert.equal(invalidTarget.valid, false);
	assert.ok(invalidTarget.errors.some(error => error.includes('布局约束目标 U99')));
}

console.log('Constraint target validation passed.');


{
	assert.ok(allowedSemanticRolesForPrefix('C').includes('decoupling-capacitor'));
	assert.ok(!allowedSemanticRolesForPrefix('C').includes('power-path-inductor'));
	assert.ok(allowedSemanticRolesForPrefix('L').includes('power-path-inductor'));
	assert.ok(!allowedSemanticRolesForPrefix('L').includes('filter-capacitor'));

	const context: SemanticComponentContext = {
		componentId: 'l1',
		designator: 'L1',
		referencePrefix: 'L',
		structuralRole: 'ambiguous',
		connectedNets: [
			{
				netName: '3V',
				classification: 'global-power',
				groupingWeight: 0.1,
				selfPads: ['2'],
				peerEndpoints: [],
				coreDesignators: ['U1'],
			},
			{
				netName: 'VDD',
				classification: 'global-power',
				groupingWeight: 0.1,
				selfPads: ['1'],
				peerEndpoints: [],
				coreDesignators: ['U1'],
			},
		],
		relatedCoreDesignators: ['U1'],
		informativeSignalNets: [],
		lowInformationNets: ['3V', 'VDD'],
		missingEvidence: [],
	};

	const invalidRole = validateSemanticInference(context, {
		status: 'inferred',
		role: 'filter-capacitor',
		associatedCore: 'U1',
		confidence: 'medium',
		evidenceRefs: ['net:3V', 'net:VDD', 'core:U1'],
		explanation: '错误地把 L1 判断成电容。',
		constraints: [
			{
				type: 'near',
				target: 'U1',
				evidenceRefs: ['core:U1'],
			},
		],
	});

	assert.equal(invalidRole.valid, false);
	assert.ok(invalidRole.errors.some(error => error.includes('与器件位号前缀 L 不兼容')));
}

console.log('Semantic role compatibility validation passed.');


{
	const low = buildConstraintPreviewForInference('C5', {
		status: 'inferred',
		role: 'decoupling-capacitor',
		associatedCore: 'U1',
		confidence: 'low',
		evidenceRefs: ['component:value', 'core:U1'],
		explanation: '低置信测试',
		constraints: [
			{ type: 'near', target: 'U1', evidenceRefs: ['core:U1'] },
		],
	});
	assert.equal(low.proposals.length, 1);
	assert.equal(low.proposals[0].strength, 'advisory');
	assert.equal(low.proposals[0].execution, 'review-only');

	const medium = buildConstraintPreviewForInference('C6', {
		status: 'inferred',
		role: 'decoupling-capacitor',
		associatedCore: 'U1',
		confidence: 'medium',
		evidenceRefs: ['component:value', 'core:U1'],
		explanation: '中置信测试',
		constraints: [
			{ type: 'near', target: 'U1', evidenceRefs: ['core:U1'] },
		],
	});
	assert.equal(medium.proposals.length, 1);
	assert.equal(medium.proposals[0].strength, 'soft');
	assert.equal(medium.proposals[0].execution, 'preview-eligible');

	const unknown = buildConstraintPreviewForInference('L1', {
		status: 'insufficient-evidence',
		role: 'unknown',
		confidence: 'low',
		evidenceRefs: [],
		explanation: '证据不足',
		constraints: [
			{ type: 'no-constraint', evidenceRefs: [] },
		],
	});
	assert.equal(unknown.proposals.length, 0);
	assert.equal(unknown.skipped[0].reason, 'insufficient-semantic-evidence');

	const unsupportedPowerSwitch = buildConstraintPreviewForInference('Q1', {
		status: 'inferred',
		role: 'power-switch',
		associatedCore: 'U1',
		confidence: 'medium',
		evidenceRefs: ['net:3V', 'net:VBAT', 'core:U1'],
		explanation: '角色可识别，但当前没有足够的 Pin/功能拓扑证据驱动布局。',
		constraints: [
			{ type: 'keep-short', target: '3V', evidenceRefs: ['net:3V'] },
			{ type: 'keep-short', target: 'VBAT', evidenceRefs: ['net:VBAT'] },
			{ type: 'near', target: 'U1', evidenceRefs: ['core:U1'] },
		],
	});
	assert.equal(unsupportedPowerSwitch.proposals.length, 0);
	assert.equal(
		unsupportedPowerSwitch.skipped[0].reason,
		'unsupported-role-constraint',
	);

	const noConstraint = buildConstraintPreviewForInference('Q2', {
		status: 'inferred',
		role: 'power-switch',
		associatedCore: 'U1',
		confidence: 'medium',
		evidenceRefs: ['core:U1'],
		explanation: '角色可识别但没有可靠布局动作',
		constraints: [
			{ type: 'no-constraint', evidenceRefs: ['core:U1'] },
		],
	});
	assert.equal(noConstraint.proposals.length, 0);
	assert.equal(noConstraint.skipped[0].reason, 'no-active-constraint');

	const merged = mergeConstraintPreviewResults([
		low,
		medium,
		unknown,
		unsupportedPowerSwitch,
		noConstraint,
	]);
	assert.equal(merged.proposals.length, 2);
	assert.equal(merged.advisoryCount, 1);
	assert.equal(merged.softCount, 1);
	assert.equal(merged.previewEligibleCount, 1);
	assert.equal(merged.reviewOnlyCount, 1);
	assert.equal(merged.skipped.length, 3);

	for (const proposal of merged.proposals) {
		assert.notEqual(proposal.strength, 'hard');
		assert.equal(proposal.requiresReview, true);
	}
}

console.log('Phase 3 constraint engine regression passed.');
