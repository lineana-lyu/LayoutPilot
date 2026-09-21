import type { SemanticComponentContext } from './semanticContext';
import type {
	SemanticInference,
	SemanticRole,
} from './semanticInference';

export type LayoutConstraintType =
	| 'near'
	| 'group-with'
	| 'keep-short'
	| 'edge'
	| 'keepout';

export interface DerivedLayoutConstraint {
	type: LayoutConstraintType;
	target?: string;
	evidenceRefs: string[];
	policyId: string;
	rationale: string;
}

export type ConstraintPolicySkipReason =
	| 'semantic-not-inferred'
	| 'unknown-semantic-role'
	| 'no-policy-for-role'
	| 'policy-evidence-insufficient';

export interface ConstraintPolicyResult {
	constraints: DerivedLayoutConstraint[];
	skipReason?: ConstraintPolicySkipReason;
}

interface ConstraintPolicy {
	id: string;
	role: SemanticRole;
	derive: (
		context: SemanticComponentContext,
		inference: SemanticInference,
	) => DerivedLayoutConstraint[];
}

function findCoreRelatedNet(
	context: SemanticComponentContext,
	core: string,
	classification: 'global-power' | 'global-ground',
) {
	return context.connectedNets.find(
		net =>
			net.classification === classification
			&& net.coreDesignators.includes(core),
	);
}

/**
 * Policy: a decoupling capacitor should be kept close to the IC whose
 * power/ground domain it decouples.
 *
 * This is intentionally derived from deterministic context rather than an
 * LLM-proposed layout action. The policy requires:
 * - semantic role = decoupling-capacitor;
 * - a validated associated core;
 * - a power net related to that core;
 * - a ground net related to that core.
 *
 * No board-specific designators or net names are encoded here.
 */
const decouplingNearCorePolicy: ConstraintPolicy = {
	id: 'decoupling.near-associated-core.v1',
	role: 'decoupling-capacitor',
	derive(context, inference) {
		const core = inference.associatedCore;
		if (!core || !context.relatedCoreDesignators.includes(core)) {
			return [];
		}

		const powerNet = findCoreRelatedNet(context, core, 'global-power');
		const groundNet = findCoreRelatedNet(context, core, 'global-ground');

		if (!powerNet || !groundNet) {
			return [];
		}

		const evidenceRefs = [
			`core:${core}`,
			`net:${powerNet.netName}`,
			`net:${groundNet.netName}`,
		];

		if (context.value) {
			evidenceRefs.unshift('component:value');
		}

		return [
			{
				type: 'near',
				target: core,
				evidenceRefs,
				policyId: 'decoupling.near-associated-core.v1',
				rationale:
					'去耦器件与关联核心共享电源和地网络，因此生成“靠近关联核心”的布局约束。',
			},
		];
	},
};

const POLICIES: ConstraintPolicy[] = [
	decouplingNearCorePolicy,
];

export function deriveLayoutConstraints(
	context: SemanticComponentContext,
	inference: SemanticInference,
): ConstraintPolicyResult {
	if (inference.status !== 'inferred') {
		return {
			constraints: [],
			skipReason: 'semantic-not-inferred',
		};
	}

	if (inference.role === 'unknown') {
		return {
			constraints: [],
			skipReason: 'unknown-semantic-role',
		};
	}

	const matchingPolicies = POLICIES.filter(
		policy => policy.role === inference.role,
	);

	if (!matchingPolicies.length) {
		return {
			constraints: [],
			skipReason: 'no-policy-for-role',
		};
	}

	const constraints = matchingPolicies.flatMap(
		policy => policy.derive(context, inference),
	);

	if (!constraints.length) {
		return {
			constraints: [],
			skipReason: 'policy-evidence-insufficient',
		};
	}

	return { constraints };
}
