import {
	clearWorkflowSemanticSnapshot,
	createEmptyWorkflowState,
	normalizeWorkflowState,
	removeWorkflowHumanDecision,
	replaceWorkflowSemanticSnapshot,
	setWorkflowPlacementCommand,
	setWorkflowEvidenceReviewSession,
	setWorkflowLayoutPlan,
	setWorkflowLayoutPreviewSession,
	upsertWorkflowHumanDecision,
	type LayoutPilotWorkflowState,
} from '../application/workflowState';
import type { HumanOwnershipDecision } from '../domain/humanOwnershipDecision';
import type { PlacementCommandRecord } from '../domain/placementCommand';
import type { SemanticSnapshot } from '../domain/semanticSnapshot';
import type { EvidenceReviewSession } from '../domain/evidenceReviewSession';
import type { LayoutPlan } from '../domain/layoutPlan';
import type { LayoutPreviewSession } from '../domain/layoutPreviewSession';

const WORKFLOW_STORAGE_KEY = 'layoutpilot.workflow-state.v1';

function loadState(): LayoutPilotWorkflowState {
	const raw = eda.sys_Storage.getExtensionUserConfig(WORKFLOW_STORAGE_KEY);
	if (raw === undefined) {
		return createEmptyWorkflowState();
	}

	try {
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		return normalizeWorkflowState(parsed);
	}
	catch (error) {
		console.warn('[LayoutPilot] workflow state is corrupted; ignoring stored value', error);
		return createEmptyWorkflowState();
	}
}

async function saveState(state: LayoutPilotWorkflowState): Promise<void> {
	const success = await eda.sys_Storage.setExtensionUserConfig(
		WORKFLOW_STORAGE_KEY,
		JSON.stringify(state),
	);
	if (!success) {
		throw new Error('嘉立创EDA未能保存 LayoutPilot 工作流状态。');
	}
}

export function getStoredSemanticSnapshot(): SemanticSnapshot | undefined {
	return loadState().semanticSnapshot;
}

export async function replaceStoredSemanticSnapshot(
	snapshot: SemanticSnapshot,
): Promise<void> {
	await saveState(replaceWorkflowSemanticSnapshot(loadState(), snapshot));
}

export async function clearStoredSemanticSnapshot(): Promise<void> {
	await saveState(clearWorkflowSemanticSnapshot(loadState()));
}

export function getStoredHumanOwnershipDecisions(
	snapshotId: string,
): HumanOwnershipDecision[] {
	return loadState().humanOwnershipDecisions.filter(
		decision => decision.snapshotId === snapshotId,
	);
}

export async function upsertStoredHumanOwnershipDecision(
	decision: HumanOwnershipDecision,
): Promise<void> {
	await saveState(upsertWorkflowHumanDecision(loadState(), decision));
}

export async function removeStoredHumanOwnershipDecision(
	snapshotId: string,
	componentId: string,
): Promise<void> {
	await saveState(
		removeWorkflowHumanDecision(loadState(), snapshotId, componentId),
	);
}

export function getStoredLastPlacementCommand(): PlacementCommandRecord | undefined {
	return loadState().lastPlacementCommand;
}

export async function setStoredLastPlacementCommand(
	command: PlacementCommandRecord | undefined,
): Promise<void> {
	await saveState(setWorkflowPlacementCommand(loadState(), command));
}

export function inspectStoredWorkflowState(): LayoutPilotWorkflowState {
	return loadState();
}


export function getStoredEvidenceReviewSession(): EvidenceReviewSession | undefined {
	return loadState().evidenceReviewSession;
}

export async function setStoredEvidenceReviewSession(
	session: EvidenceReviewSession | undefined,
): Promise<void> {
	await saveState(setWorkflowEvidenceReviewSession(loadState(), session));
}


export function getStoredLayoutPlan(): LayoutPlan | undefined {
	return loadState().layoutPlan;
}

export async function setStoredLayoutPlan(
	plan: LayoutPlan | undefined,
): Promise<void> {
	await saveState(setWorkflowLayoutPlan(loadState(), plan));
}


export function getStoredLayoutPreviewSession(): LayoutPreviewSession | undefined {
	return loadState().layoutPreviewSession;
}

export async function setStoredLayoutPreviewSession(
	session: LayoutPreviewSession | undefined,
): Promise<void> {
	await saveState(setWorkflowLayoutPreviewSession(loadState(), session));
}
