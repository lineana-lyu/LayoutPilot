import type {
	LayoutConstraintType,
	SemanticConfidence,
	SemanticInference,
	SemanticRole,
} from './semanticInference';

export type ConstraintStrength = 'advisory' | 'soft';
export type ConstraintExecution = 'review-only' | 'preview-eligible';
export type ConstraintSource = 'ai-semantic';

export type ActiveLayoutConstraintType = Exclude<
	LayoutConstraintType,
	'no-constraint'
>;

export type ConstraintSkipReason =
	| 'insufficient-semantic-evidence'
	| 'unknown-semantic-role'
	| 'no-active-constraint'
	| 'unsupported-role-constraint';

export interface ConstraintProposal {
	id: string;
	subject: string;
	type: ActiveLayoutConstraintType;
	target?: string;
	strength: ConstraintStrength;
	execution: ConstraintExecution;
	source: ConstraintSource;
	confidence: SemanticConfidence;
	role: SemanticRole;
	evidenceRefs: string[];
	explanation: string;
	requiresReview: true;
}

export interface ConstraintSkip {
	subject: string;
	reason: ConstraintSkipReason;
	confidence: SemanticConfidence;
	role: SemanticRole;
}

export interface ConstraintPreviewResult {
	proposals: ConstraintProposal[];
	skipped: ConstraintSkip[];
	advisoryCount: number;
	softCount: number;
	previewEligibleCount: number;
	reviewOnlyCount: number;
}

function policyForConfidence(
	confidence: SemanticConfidence,
): Pick<ConstraintProposal, 'strength' | 'execution'> {
	if (confidence === 'low') {
		return {
			strength: 'advisory',
			execution: 'review-only',
		};
	}

	return {
		strength: 'soft',
		execution: 'preview-eligible',
	};
}

export function buildConstraintPreviewForInference(
	subject: string,
	inference: SemanticInference,
): ConstraintPreviewResult {
	if (inference.status === 'insufficient-evidence') {
		return {
			proposals: [],
			skipped: [
				{
					subject,
					reason: 'insufficient-semantic-evidence',
					confidence: inference.confidence,
					role: inference.role,
				},
			],
			advisoryCount: 0,
			softCount: 0,
			previewEligibleCount: 0,
			reviewOnlyCount: 0,
		};
	}

	if (inference.role === 'unknown') {
		return {
			proposals: [],
			skipped: [
				{
					subject,
					reason: 'unknown-semantic-role',
					confidence: inference.confidence,
					role: inference.role,
				},
			],
			advisoryCount: 0,
			softCount: 0,
			previewEligibleCount: 0,
			reviewOnlyCount: 0,
		};
	}

	const modelActiveConstraints = inference.constraints
		.filter(
			(
				constraint,
			): constraint is SemanticInference['constraints'][number] & {
				type: ActiveLayoutConstraintType;
			} => constraint.type !== 'no-constraint',
		);

	const activeConstraints = modelActiveConstraints.filter((constraint) => {
		// Phase 3 v1 deliberately supports only one executable semantic pattern:
		// a decoupling capacitor may be placed near its validated associated core.
		//
		// Recognizing a role such as "power-switch" does NOT by itself prove
		// where that device should sit. Those roles need stronger evidence
		// (pin semantics, datasheet/function topology) before they are allowed
		// to emit placement-driving constraints.
		if (inference.role !== 'decoupling-capacitor') {
			return false;
		}

		if (
			constraint.type !== 'near'
			|| !constraint.target
			|| !inference.associatedCore
		) {
			return false;
		}

		return constraint.target === inference.associatedCore;
	});

	if (!activeConstraints.length) {
		const reason = modelActiveConstraints.length
			? 'unsupported-role-constraint'
			: 'no-active-constraint';

		return {
			proposals: [],
			skipped: [
				{
					subject,
					reason,
					confidence: inference.confidence,
					role: inference.role,
				},
			],
			advisoryCount: 0,
			softCount: 0,
			previewEligibleCount: 0,
			reviewOnlyCount: 0,
		};
	}

	const policy = policyForConfidence(inference.confidence);
	const unique = new Map<string, ConstraintProposal>();

	for (const constraint of activeConstraints) {
		const key = [
			subject,
			constraint.type,
			constraint.target ?? '',
		].join(':');

		if (unique.has(key)) {
			continue;
		}

		unique.set(key, {
			id: key,
			subject,
			type: constraint.type,
			target: constraint.target,
			strength: policy.strength,
			execution: policy.execution,
			source: 'ai-semantic',
			confidence: inference.confidence,
			role: inference.role,
			evidenceRefs: [...constraint.evidenceRefs],
			explanation: inference.explanation,
			requiresReview: true,
		});
	}

	const proposals = Array.from(unique.values());
	const advisoryCount = proposals.filter(
		item => item.strength === 'advisory',
	).length;
	const softCount = proposals.filter(
		item => item.strength === 'soft',
	).length;
	const previewEligibleCount = proposals.filter(
		item => item.execution === 'preview-eligible',
	).length;
	const reviewOnlyCount = proposals.filter(
		item => item.execution === 'review-only',
	).length;

	return {
		proposals,
		skipped: [],
		advisoryCount,
		softCount,
		previewEligibleCount,
		reviewOnlyCount,
	};
}

export function mergeConstraintPreviewResults(
	results: ConstraintPreviewResult[],
): ConstraintPreviewResult {
	return {
		proposals: results.flatMap(result => result.proposals),
		skipped: results.flatMap(result => result.skipped),
		advisoryCount: results.reduce(
			(sum, result) => sum + result.advisoryCount,
			0,
		),
		softCount: results.reduce(
			(sum, result) => sum + result.softCount,
			0,
		),
		previewEligibleCount: results.reduce(
			(sum, result) => sum + result.previewEligibleCount,
			0,
		),
		reviewOnlyCount: results.reduce(
			(sum, result) => sum + result.reviewOnlyCount,
			0,
		),
	};
}
