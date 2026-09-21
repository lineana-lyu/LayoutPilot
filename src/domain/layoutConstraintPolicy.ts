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
	evaluate(context, inference) {
		const core = inference.associatedCore;
		const coreValid = Boolean(
			core && context.relatedCoreDesignators.includes(core),
		);

		const powerNet = coreValid && core
			? findCoreRelatedNet(context, core, 'global-power')
			: undefined;
		const groundNet = coreValid && core
			? findCoreRelatedNet(context, core, 'global-ground')
			: undefined;

		const checks: ConstraintPolicyCheck[] = [
			{
				id: 'associated-core',
				label: '已确定且有效的关联核心',
				status: coreValid ? 'pass' : 'fail',
				detail: coreValid && core
					? `关联核心：${core}`
					: '缺少有效 associatedCore，或该核心不在规则层候选集合中。',
			},
			{
				id: 'core-related-power-net',
				label: '存在与关联核心同网的全局电源网络',
				status: !coreValid
					? 'not-applicable'
					: powerNet
						? 'pass'
						: 'fail',
				detail: powerNet
					? `电源网络：${powerNet.netName}`
					: coreValid
						? '未找到同时连接该器件与关联核心的 global-power 网络。'
						: '需先确定有效关联核心。',
			},
			{
				id: 'core-related-ground-net',
				label: '存在与关联核心同网的全局地网络',
				status: !coreValid
					? 'not-applicable'
					: groundNet
						? 'pass'
						: 'fail',
				detail: groundNet
					? `地网络：${groundNet.netName}`
					: coreValid
						? '未找到同时连接该器件与关联核心的 global-ground 网络。'
						: '需先确定有效关联核心。',
			},
		];

		if (!coreValid || !core || !powerNet || !groundNet) {
			return {
				constraints: [],
				checks,
			};
		}

		const evidenceRefs = [
			`core:${core}`,
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
					policyId: 'decoupling.near-associated-core.v1',
					rationale:
						'去耦器件与关联核心共享电源和地网络，因此生成“靠近关联核心”的布局约束。',
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
