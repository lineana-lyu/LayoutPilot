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

export type PolicyCheckStatus = 'pass' | 'fail' | 'not-applicable';

export interface ConstraintPolicyCheck {
	id: string;
	label: string;
	status: PolicyCheckStatus;
	detail?: string;
}

export interface ConstraintPolicyDiagnostic {
	policyId: string;
	role: SemanticRole;
	checks: ConstraintPolicyCheck[];
}

export type ConstraintPolicySkipReason =
	| 'semantic-not-inferred'
	| 'unknown-semantic-role'
	| 'no-policy-for-role'
	| 'policy-evidence-insufficient';

export interface ConstraintPolicyResult {
	constraints: DerivedLayoutConstraint[];
	skipReason?: ConstraintPolicySkipReason;
	diagnostics: ConstraintPolicyDiagnostic[];
}

interface ConstraintPolicy {
	id: string;
	role: SemanticRole;
	evaluate: (
		context: SemanticComponentContext,
		inference: SemanticInference,
	) => {
		constraints: DerivedLayoutConstraint[];
		checks: ConstraintPolicyCheck[];
	};
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
 * Policy: only when deterministic ownership says the component has one
 * unique owner may a decoupling capacitor generate a "near owner" constraint.
 *
 * Bridge/shared-signal/rail-domain/unknown relations are intentionally
 * non-owning and must not be compressed into a synthetic core.
 */
const decouplingNearCorePolicy: ConstraintPolicy = {
	id: 'decoupling.near-deterministic-owner.v2',
	role: 'decoupling-capacitor',
	evaluate(context, inference) {
		const relation = context.ownership.relation;
		const core = context.ownership.ownerDesignator;
		const ownerValid = Boolean(
			core
			&& (relation === 'single-core' || relation === 'explicit-owner')
			&& context.relatedCoreDesignators.includes(core),
		);

		const powerNet = ownerValid && core
			? findCoreRelatedNet(context, core, 'global-power')
			: undefined;
		const groundNet = ownerValid && core
			? findCoreRelatedNet(context, core, 'global-ground')
			: undefined;

		const checks: ConstraintPolicyCheck[] = [
			{
				id: 'deterministic-owner',
				label: '确定性关系提供唯一 owner',
				status: ownerValid ? 'pass' : 'fail',
				detail: ownerValid && core
					? `relation=${relation}，owner=${core}`
					: `当前 relation=${relation}，不能强行生成唯一 owner。`,
			},
			{
				id: 'owner-related-power-net',
				label: '存在与 owner 同网的全局电源网络',
				status: !ownerValid
					? 'not-applicable'
					: powerNet
						? 'pass'
						: 'fail',
				detail: powerNet
					? `电源网络：${powerNet.netName}`
					: ownerValid
						? '未找到同时连接该器件与 owner 的 global-power 网络。'
						: '需先有确定性唯一 owner。',
			},
			{
				id: 'owner-related-ground-net',
				label: '存在与 owner 同网的全局地网络',
				status: !ownerValid
					? 'not-applicable'
					: groundNet
						? 'pass'
						: 'fail',
				detail: groundNet
					? `地网络：${groundNet.netName}`
					: ownerValid
						? '未找到同时连接该器件与 owner 的 global-ground 网络。'
						: '需先有确定性唯一 owner。',
			},
		];

		if (!ownerValid || !core || !powerNet || !groundNet) {
			return {
				constraints: [],
				checks,
			};
		}

		const evidenceRefs = [
			`relation:${relation}`,
			`owner:${core}`,
			`net:${powerNet.netName}`,
			`net:${groundNet.netName}`,
		];

		if (context.value) {
			evidenceRefs.unshift('component:value');
		}

		return {
			constraints: [
				{
					type: 'near',
					target: core,
					evidenceRefs,
					policyId: 'decoupling.near-deterministic-owner.v2',
					rationale:
						'确定性关系已给出唯一 owner，且该器件与 owner 共享电源和地，因此生成“靠近 owner”的布局约束。',
				},
			],
			checks,
		};
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
			diagnostics: [],
		};
	}

	if (inference.role === 'unknown') {
		return {
			constraints: [],
			skipReason: 'unknown-semantic-role',
			diagnostics: [],
		};
	}

	const matchingPolicies = POLICIES.filter(
		policy => policy.role === inference.role,
	);

	if (!matchingPolicies.length) {
		return {
			constraints: [],
			skipReason: 'no-policy-for-role',
			diagnostics: [],
		};
	}

	const evaluations = matchingPolicies.map(policy => {
		const result = policy.evaluate(context, inference);
		return {
			policy,
			...result,
		};
	});

	const constraints = evaluations.flatMap(item => item.constraints);
	const diagnostics: ConstraintPolicyDiagnostic[] = evaluations.map(item => ({
		policyId: item.policy.id,
		role: item.policy.role,
		checks: item.checks,
	}));

	if (!constraints.length) {
		return {
			constraints: [],
			skipReason: 'policy-evidence-insufficient',
			diagnostics,
		};
	}

	return {
		constraints,
		diagnostics,
	};
}
