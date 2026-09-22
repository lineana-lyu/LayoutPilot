import { buildConstraintEvaluation } from './constraintEvaluation';
import {
	buildSemanticBoardFingerprint,
	semanticSnapshotMatchesBoard,
	type SemanticSnapshot,
} from '../domain/semanticSnapshot';
import { collectAnalysisState, type AnalysisState } from '../eda/analysisAdapter';
import {
	getStoredHumanOwnershipDecisions,
	getStoredSemanticSnapshot,
} from '../eda/workflowStore';

export interface CurrentConstraintSession {
	analysisState: AnalysisState;
	snapshot: SemanticSnapshot;
	boardFingerprint: string;
	evaluation: ReturnType<typeof buildConstraintEvaluation>;
}

export type CurrentConstraintSessionResult =
	| { ok: true; value: CurrentConstraintSession }
	| {
		ok: false;
		reason: 'missing-snapshot' | 'stale-snapshot';
		message: string;
	};

export async function collectCurrentConstraintSession(): Promise<
	CurrentConstraintSessionResult
> {
	const analysisState = await collectAnalysisState();
	const boardFingerprint = buildSemanticBoardFingerprint({
		graph: analysisState.graph,
		contexts: analysisState.contexts,
	});
	const snapshot = getStoredSemanticSnapshot();

	if (!snapshot) {
		return {
			ok: false,
			reason: 'missing-snapshot',
			message: '当前没有可复用的 Semantic Snapshot。请先运行 AI 语义分析。',
		};
	}

	if (!semanticSnapshotMatchesBoard(snapshot, boardFingerprint)) {
		return {
			ok: false,
			reason: 'stale-snapshot',
			message: [
				'当前 PCB 的语义输入已经变化，旧 Snapshot 已过期。',
				`Snapshot：${snapshot.id}`,
				`旧 Fingerprint：${snapshot.boardFingerprint}`,
				`当前 Fingerprint：${boardFingerprint}`,
			].join('\n'),
		};
	}

	const evaluation = buildConstraintEvaluation({
		snapshot,
		graph: analysisState.graph,
		features: analysisState.features,
		grouping: analysisState.grouping,
		semanticMetadata: analysisState.semanticMetadata,
		humanOwnershipDecisions: getStoredHumanOwnershipDecisions(snapshot.id),
	});

	return {
		ok: true,
		value: {
			analysisState,
			snapshot,
			boardFingerprint,
			evaluation,
		},
	};
}
