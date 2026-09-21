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
		associatedCore: 'U_CORE',
		confidence,
		evidenceRefs: [
			'component:value',
			'net:VCC_RAIL',
			'net:GROUND_RAIL',
			'core:U_CORE',
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
		'decoupling.near-associated-core.v1',
	);
	assert.deepEqual(
		new Set(result.proposals[0].evidenceRefs),
		new Set([
			'component:value',
			'core:U_CORE',
			'net:VCC_RAIL',
			'net:GROUND_RAIL',
		]),
	);
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
}

{
	const context = makeContext();
	const inference: SemanticInference = {
		status: 'inferred',
		role: 'power-switch',
		associatedCore: 'U_CORE',
		confidence: 'high',
		evidenceRefs: ['core:U_CORE'],
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
