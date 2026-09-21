import type { CandidateGroupingResult } from '../domain/candidateGrouping';
import type { CircuitGraph } from '../domain/circuitGraph';
import type { StructuralFeature } from '../domain/componentFeatures';
import type { HumanOwnershipDecision } from '../domain/humanOwnershipDecision';
import { buildConstraintPreview, mergeConstraintPreviewResults, type ConstraintPreviewResult } from '../domain/layoutConstraintEngine';
import type { ExplicitOwnershipHint } from '../domain/ownershipRelation';
import { buildSemanticContexts, type SemanticComponentContext, type SemanticComponentMetadata } from '../domain/semanticContext';
import type { SemanticSnapshot, SemanticSnapshotEntry } from '../domain/semanticSnapshot';

export interface ConstraintEvaluationInput {
	snapshot: SemanticSnapshot;
	graph: CircuitGraph;
	features: StructuralFeature[];
	grouping: CandidateGroupingResult;
	semanticMetadata: SemanticComponentMetadata[];
	humanOwnershipDecisions: HumanOwnershipDecision[];
}

export interface ConstraintEntryEvaluation {
	entry: SemanticSnapshotEntry;
	context: SemanticComponentContext;
	humanOwnershipDecision?: HumanOwnershipDecision;
	result?: ConstraintPreviewResult;
}

export interface ConstraintEvaluation {
	explicitOwnershipHints: ExplicitOwnershipHint[];
	effectiveContexts: SemanticComponentContext[];
	entries: ConstraintEntryEvaluation[];
	merged: ConstraintPreviewResult;
}

export function buildConstraintEvaluation(
	input: ConstraintEvaluationInput,
): ConstraintEvaluation {
	const decisionsForSnapshot = input.humanOwnershipDecisions.filter(
		decision => decision.snapshotId === input.snapshot.id,
	);
	const explicitOwnershipHints: ExplicitOwnershipHint[] = decisionsForSnapshot.map(
		decision => ({
			componentId: decision.componentId,
			ownerComponentId: decision.ownerComponentId,
			source: decision.source,
		}),
	);

	const effectiveContexts = buildSemanticContexts(
		input.graph,
		input.features,
		input.grouping,
		input.semanticMetadata,
		explicitOwnershipHints,
	);
	const contextById = new Map(
		effectiveContexts.map(context => [context.componentId, context]),
	);
	const decisionById = new Map(
		decisionsForSnapshot.map(decision => [decision.componentId, decision]),
	);

	const entries: ConstraintEntryEvaluation[] = input.snapshot.entries.map(entry => {
		const context = contextById.get(entry.componentId) ?? entry.context;
		const humanOwnershipDecision = decisionById.get(entry.componentId);

		if (entry.status !== 'valid' || !entry.inference) {
			return {
				entry,
				context,
				humanOwnershipDecision,
			};
		}

		return {
			entry,
			context,
			humanOwnershipDecision,
			result: buildConstraintPreview(context, entry.inference),
		};
	});

	return {
		explicitOwnershipHints,
		effectiveContexts,
		entries,
		merged: mergeConstraintPreviewResults(
			entries
				.map(item => item.result)
				.filter((result): result is ConstraintPreviewResult => Boolean(result)),
		),
	};
}
