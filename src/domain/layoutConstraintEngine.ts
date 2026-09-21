import type { SemanticComponentContext } from './semanticContext';
import type {
	SemanticConfidence,
	SemanticInference,
	SemanticRole,
} from './semanticInference';
import {
	deriveLayoutConstraints,
	type ConstraintPolicySkipReason,
	type LayoutConstraintType,
} from './layoutConstraintPolicy';

export type ConstraintStrength = 'advisory' | 'soft';
export type ConstraintExecution = 'review-only' | 'preview-eligible';
export type ConstraintSource = 'semantic-policy';

export type ConstraintSkipReason =
	| ConstraintPolicySkipReason
	| 'no-derived-constraint';

export interface ConstraintProposal {
	id: string;
	subject: string;
	type: LayoutConstraintType;
	target?: string;
	strength: ConstraintStrength;
	execution: ConstraintExecution;
	source: ConstraintSource;
	confidence: SemanticConfidence;
	role: SemanticRole;
	evidenceRefs: string[];
	explanation: string;
	policyId: string;
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

export function buildConstraintPreview(
	context: SemanticComponentContext,
	inference: SemanticInference,
): ConstraintPreviewResult {
	const derived = deriveLayoutConstraints(context, inference);

	if (!derived.constraints.length) {
		return {
			proposals: [],
			skipped: [
				{
					subject: context.designator,
					reason: derived.skipReason ?? 'no-derived-constraint',
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

	const confidencePolicy = policyForConfidence(inference.confidence);
	const unique = new Map<string, ConstraintProposal>();

	for (const constraint of derived.constraints) {
		const key = [
			context.designator,
			constraint.policyId,
			constraint.type,
			constraint.target ?? '',
		].join(':');

		if (unique.has(key)) {
			continue;
		}

		unique.set(key, {
			id: key,
			subject: context.designator,
			type: constraint.type,
			target: constraint.target,
			strength: confidencePolicy.strength,
			execution: confidencePolicy.execution,
			source: 'semantic-policy',
			confidence: inference.confidence,
			role: inference.role,
			evidenceRefs: [...constraint.evidenceRefs],
			explanation: constraint.rationale,
			policyId: constraint.policyId,
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
