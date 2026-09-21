import assert from 'node:assert/strict';

import {
	buildConstraintPreview,
	mergeConstraintPreviewResults,
} from '../src/domain/layoutConstraintEngine';
import type { SemanticComponentContext } from '../src/domain/semanticContext';
import type { SemanticInference } from '../src/domain/semanticInference';

function makeContext(options?: {
	includePower?: boolean;
	includeGround?: boolean;
}): SemanticComponentContext {
	const includePower = options?.includePower ?? true;
	const includeGround = options?.includeGround ?? true;

	const connectedNets: SemanticComponentContext['connectedNets'] = [];

	if (includePower) {
		connectedNets.push({
			netName: 'VCC_RAIL',
			classification: 'global-power',
			electricalRole: 'power',
			nameOrigin: 'global',
			fanout: 2,
			groupingWeight: 0.1,
			selfPads: ['1'],
			peerEndpoints: [
				{
					designator: 'U_CORE',
					padNumber: '10',
				},
			],
			coreDesignators: ['U_CORE'],
		});
	}

	if (includeGround) {
		connectedNets.push({
			netName: 'GROUND_RAIL',
			classification: 'global-ground',
			electricalRole: 'ground',
			nameOrigin: 'global',
			fanout: 2,
			groupingWeight: 0.1,
			selfPads: ['2'],
			peerEndpoints: [
				{
					designator: 'U_CORE',
					padNumber: '11',
				},
			],
			coreDesignators: ['U_CORE'],
		});
	}

	return {
		componentId: 'component-under-test',
		designator: 'C_TEST',
		name: '100nF',
		value: '100nF',
		referencePrefix: 'C',
		structuralRole: 'ambiguous',
		connectedNets,
		relatedCoreDesignators: ['U_CORE'],
		ownership: {
			relation: 'single-core',
			ownerDesignator: 'U_CORE',
			hostDesignators: ['U_CORE'],
			sharedSignalNets: [],
			railNets: includePower ? ['VCC_RAIL'] : [],
			explanation: '合成测试中的唯一 owner。',
		},
		informativeSignalNets: [],
		lowInformationNets: connectedNets.map(net => net.netName),
		missingEvidence: [],
	};
}

function makeInference(
	confidence: SemanticInference['confidence'],
): SemanticInference {
	return {
		status: 'inferred',
		role: 'decoupling-capacitor',
		confidence,
		evidenceRefs: [
			'component:value',
			'net:VCC_RAIL',
			'net:GROUND_RAIL',
			'relation:single-core',
			'owner:U_CORE',
		],
		explanation: '语义测试输入。',
	};
}

{
	const result = buildConstraintPreview(makeContext(), makeInference('low'));

	assert.equal(result.proposals.length, 1);
	assert.equal(result.proposals[0].type, 'near');
	assert.equal(result.proposals[0].target, 'U_CORE');
	assert.equal(result.proposals[0].strength, 'advisory');
	assert.equal(result.proposals[0].execution, 'review-only');
	assert.equal(result.proposals[0].source, 'semantic-policy');
	assert.equal(
		result.proposals[0].policyId,
		'decoupling.near-deterministic-owner.v2',
	);
	assert.deepEqual(
		new Set(result.proposals[0].evidenceRefs),
		new Set([
			'component:value',
			'relation:single-core',
			'owner:U_CORE',
			'net:VCC_RAIL',
			'net:GROUND_RAIL',
		]),
	);
	assert.equal(result.skipped.length, 0);
}

{
	const result = buildConstraintPreview(
		makeContext(),
		makeInference('medium'),
	);

	assert.equal(result.proposals.length, 1);
	assert.equal(result.proposals[0].strength, 'soft');
	assert.equal(result.proposals[0].execution, 'preview-eligible');
}

{
	const result = buildConstraintPreview(
		makeContext({ includeGround: false }),
		makeInference('medium'),
	);

	assert.equal(result.proposals.length, 0);
	assert.equal(
		result.skipped[0].reason,
		'policy-evidence-insufficient',
	);
	const diagnostic = result.skipped[0].diagnostics[0];
	assert.equal(diagnostic.policyId, 'decoupling.near-deterministic-owner.v2');
	assert.equal(
		diagnostic.checks.find(check => check.id === 'deterministic-owner')?.status,
		'pass',
	);
	assert.equal(
		diagnostic.checks.find(check => check.id === 'owner-related-power-net')?.status,
		'pass',
	);
	assert.equal(
		diagnostic.checks.find(check => check.id === 'owner-related-ground-net')?.status,
		'fail',
	);
}

{
	const context = makeContext();
	context.ownership = {
		relation: 'explicit-owner',
		ownerDesignator: 'U_CORE',
		hostDesignators: ['U_CORE'],
		sharedSignalNets: [],
		railNets: ['VCC_RAIL'],
		explanation: '用户通过显式确认提供唯一 owner。',
	};
	const result = buildConstraintPreview(context, makeInference('medium'));

	assert.equal(result.proposals.length, 1);
	assert.equal(result.proposals[0].type, 'near');
	assert.equal(result.proposals[0].target, 'U_CORE');
	assert.ok(result.proposals[0].evidenceRefs.includes('relation:explicit-owner'));
	assert.ok(result.proposals[0].evidenceRefs.includes('owner:U_CORE'));
}

{
	const context = makeContext();
	context.ownership = {
		relation: 'rail-domain',
		hostDesignators: ['U_CORE'],
		sharedSignalNets: [],
		railNets: ['VCC_RAIL'],
		explanation: '只有电源域关系，没有唯一 owner。',
	};
	const result = buildConstraintPreview(context, makeInference('medium'));

	assert.equal(result.proposals.length, 0);
	assert.equal(result.skipped[0].reason, 'policy-evidence-insufficient');
	const diagnostic = result.skipped[0].diagnostics[0];
	assert.equal(
		diagnostic.checks.find(check => check.id === 'deterministic-owner')?.status,
		'fail',
	);
	assert.equal(
		diagnostic.checks.find(check => check.id === 'owner-related-power-net')?.status,
		'not-applicable',
	);
	assert.equal(
		diagnostic.checks.find(check => check.id === 'owner-related-ground-net')?.status,
		'not-applicable',
	);
}

{
	const context = makeContext();
	const inference: SemanticInference = {
		status: 'inferred',
		role: 'power-switch',
		confidence: 'high',
		evidenceRefs: ['relation:single-core', 'owner:U_CORE'],
		explanation: '角色本身不足以决定布局位置。',
	};

	const result = buildConstraintPreview(context, inference);

	assert.equal(result.proposals.length, 0);
	assert.equal(result.skipped[0].reason, 'no-policy-for-role');
}

{
	const context = makeContext();
	const inference: SemanticInference = {
		status: 'insufficient-evidence',
		role: 'unknown',
		confidence: 'low',
		evidenceRefs: [],
		explanation: '证据不足。',
	};

	const result = buildConstraintPreview(context, inference);

	assert.equal(result.proposals.length, 0);
	assert.equal(result.skipped[0].reason, 'semantic-not-inferred');
}

{
	const low = buildConstraintPreview(makeContext(), makeInference('low'));
	const medium = buildConstraintPreview(makeContext(), makeInference('medium'));
	const merged = mergeConstraintPreviewResults([low, medium]);

	assert.equal(merged.proposals.length, 2);
	assert.equal(merged.advisoryCount, 1);
	assert.equal(merged.softCount, 1);
	assert.equal(merged.previewEligibleCount, 1);
	assert.equal(merged.reviewOnlyCount, 1);

	for (const proposal of merged.proposals) {
		assert.equal(proposal.requiresReview, true);
		assert.notEqual(proposal.strength as string, 'hard');
	}
}

console.log('Phase 3 policy-engine tests passed.');
