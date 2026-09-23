import type { HumanOwnershipDecision } from '../domain/humanOwnershipDecision';
import type { PlacementCommandRecord } from '../domain/placementCommand';
import { isEvidenceReviewSession, type EvidenceReviewSession } from '../domain/evidenceReviewSession';
import type { SemanticSnapshot } from '../domain/semanticSnapshot';
import {
	isLayoutPlan,
	layoutPlanAcceptanceMode,
	type LayoutPlan,
} from '../domain/layoutPlan';
import { isLayoutPreviewSession, type LayoutPreviewSession } from '../domain/layoutPreviewSession';

export interface LayoutPilotWorkflowState {
	schemaVersion: 1;
	semanticSnapshot?: SemanticSnapshot;
	humanOwnershipDecisions: HumanOwnershipDecision[];
	lastPlacementCommand?: PlacementCommandRecord;
	layoutPlan?: LayoutPlan;
	referencePlans: LayoutPlan[];
	layoutPreviewSession?: LayoutPreviewSession;
	evidenceReviewSession?: EvidenceReviewSession;
	updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSemanticSnapshot(value: unknown): value is SemanticSnapshot {
	return isRecord(value)
		&& value.schemaVersion === 1
		&& typeof value.id === 'string'
		&& typeof value.boardFingerprint === 'string'
		&& typeof value.createdAt === 'string'
		&& Array.isArray(value.entries);
}

function isHumanOwnershipDecision(value: unknown): value is HumanOwnershipDecision {
	return isRecord(value)
		&& typeof value.snapshotId === 'string'
		&& typeof value.componentId === 'string'
		&& typeof value.componentDesignator === 'string'
		&& typeof value.ownerComponentId === 'string'
		&& typeof value.ownerDesignator === 'string'
		&& typeof value.createdAt === 'string'
		&& value.source === 'user-confirmed-owner-v1';
}

function isPlacementCommand(value: unknown): value is PlacementCommandRecord {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& typeof value.snapshotId === 'string'
		&& typeof value.boardFingerprint === 'string'
		&& typeof value.constraintId === 'string'
		&& typeof value.componentId === 'string'
		&& typeof value.componentDesignator === 'string'
		&& isRecord(value.from)
		&& typeof value.from.x === 'number'
		&& typeof value.from.y === 'number'
		&& isRecord(value.to)
		&& typeof value.to.x === 'number'
		&& typeof value.to.y === 'number'
		&& typeof value.createdAt === 'string'
		&& (
			value.status === 'planned'
			|| value.status === 'applied'
			|| value.status === 'undone'
			|| value.status === 'superseded'
		);
}

function freezeDeep<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
		return value;
	}
	for (const child of Object.values(value as Record<string, unknown>)) {
		freezeDeep(child);
	}
	return Object.freeze(value as object) as T;
}

export function createEmptyWorkflowState(
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	return freezeDeep({
		schemaVersion: 1,
		humanOwnershipDecisions: [],
		referencePlans: [],
		updatedAt,
	});
}

export function normalizeWorkflowState(
	value: unknown,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	if (!isRecord(value) || value.schemaVersion !== 1) {
		return createEmptyWorkflowState(updatedAt);
	}

	const semanticSnapshot = isSemanticSnapshot(value.semanticSnapshot)
		? value.semanticSnapshot
		: undefined;
	const humanOwnershipDecisions = Array.isArray(value.humanOwnershipDecisions)
		? value.humanOwnershipDecisions.filter(isHumanOwnershipDecision)
		: [];
	const lastPlacementCommand = isPlacementCommand(value.lastPlacementCommand)
		? value.lastPlacementCommand
		: undefined;
	const rawLayoutPlan = isLayoutPlan(value.layoutPlan)
		? value.layoutPlan
		: undefined;
	const layoutPlan =
		semanticSnapshot
		&& rawLayoutPlan?.snapshotId === semanticSnapshot.id
		&& rawLayoutPlan.semanticFingerprint === semanticSnapshot.boardFingerprint
			? rawLayoutPlan
			: undefined;
	const referencePlans = semanticSnapshot && Array.isArray(value.referencePlans)
		? value.referencePlans
			.filter(isLayoutPlan)
			.filter(plan =>
				plan.status === 'accepted'
				&& layoutPlanAcceptanceMode(plan) === 'reference-only'
				&& plan.semanticFingerprint === semanticSnapshot.boardFingerprint
			)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(0, 20)
		: [];
	const rawLayoutPreviewSession = isLayoutPreviewSession(value.layoutPreviewSession)
		? value.layoutPreviewSession
		: undefined;
	const previewPlanExists = Boolean(
		layoutPlan?.id === rawLayoutPreviewSession?.planId
		|| referencePlans.some(plan => plan.id === rawLayoutPreviewSession?.planId),
	);
	const layoutPreviewSession = previewPlanExists
		? rawLayoutPreviewSession
		: undefined;

	const evidenceReviewSession = isEvidenceReviewSession(value.evidenceReviewSession)
		? value.evidenceReviewSession
		: undefined;
	const validEvidenceReviewSession =
		semanticSnapshot
		&& evidenceReviewSession?.snapshotId === semanticSnapshot.id
		&& evidenceReviewSession.boardFingerprint === semanticSnapshot.boardFingerprint
			? evidenceReviewSession
			: undefined;

	const validDecisions = semanticSnapshot
		? humanOwnershipDecisions.filter(
				decision => decision.snapshotId === semanticSnapshot.id,
			)
		: [];

	return freezeDeep({
		schemaVersion: 1,
		semanticSnapshot,
		humanOwnershipDecisions: validDecisions,
		lastPlacementCommand,
		layoutPlan,
		referencePlans,
		layoutPreviewSession,
		evidenceReviewSession: validEvidenceReviewSession,
		updatedAt:
			typeof value.updatedAt === 'string'
				? value.updatedAt
				: updatedAt,
	});
}

export function replaceWorkflowSemanticSnapshot(
	state: LayoutPilotWorkflowState,
	snapshot: SemanticSnapshot,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	return freezeDeep({
		...state,
		semanticSnapshot: snapshot,
		humanOwnershipDecisions: [],
		layoutPlan: undefined,
		referencePlans: state.referencePlans.filter(
			plan => plan.semanticFingerprint === snapshot.boardFingerprint,
		),
		layoutPreviewSession: undefined,
		evidenceReviewSession: undefined,
		updatedAt,
	});
}

export function clearWorkflowSemanticSnapshot(
	state: LayoutPilotWorkflowState,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	const {
		semanticSnapshot: _semanticSnapshot,
		humanOwnershipDecisions: _humanOwnershipDecisions,
		layoutPlan: _layoutPlan,
		referencePlans: _referencePlans,
		layoutPreviewSession: _layoutPreviewSession,
		evidenceReviewSession: _evidenceReviewSession,
		...rest
	} = state;
	return freezeDeep({
		...rest,
		schemaVersion: 1 as const,
		humanOwnershipDecisions: [],
		referencePlans: [],
		updatedAt,
	});
}

export function upsertWorkflowHumanDecision(
	state: LayoutPilotWorkflowState,
	decision: HumanOwnershipDecision,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	if (!state.semanticSnapshot || decision.snapshotId !== state.semanticSnapshot.id) {
		throw new Error('Human ownership decision does not belong to the active Semantic Snapshot.');
	}

	const existingDecision = state.humanOwnershipDecisions.find(item =>
		item.snapshotId === decision.snapshotId
		&& item.componentId === decision.componentId
	);
	const sameOwner = existingDecision?.ownerComponentId === decision.ownerComponentId;
	const humanOwnershipDecisions = [
		...state.humanOwnershipDecisions.filter(item =>
			!(
				item.snapshotId === decision.snapshotId
				&& item.componentId === decision.componentId
			)
		),
		decision,
	];

	return freezeDeep({
		...state,
		humanOwnershipDecisions,
		layoutPlan: sameOwner ? state.layoutPlan : undefined,
		layoutPreviewSession: sameOwner ? state.layoutPreviewSession : undefined,
		updatedAt,
	});
}

export function removeWorkflowHumanDecision(
	state: LayoutPilotWorkflowState,
	snapshotId: string,
	componentId: string,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	return freezeDeep({
		...state,
		layoutPlan: undefined,
		layoutPreviewSession: undefined,
		humanOwnershipDecisions: state.humanOwnershipDecisions.filter(item =>
			!(
				item.snapshotId === snapshotId
				&& item.componentId === componentId
			),
		),
		updatedAt,
	});
}

export function setWorkflowPlacementCommand(
	state: LayoutPilotWorkflowState,
	command: PlacementCommandRecord | undefined,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	const next = {
		...state,
		updatedAt,
	} as LayoutPilotWorkflowState;

	if (command) {
		next.lastPlacementCommand = command;
	}
	else {
		delete next.lastPlacementCommand;
	}

	return freezeDeep(next);
}


export function setWorkflowEvidenceReviewSession(
	state: LayoutPilotWorkflowState,
	session: EvidenceReviewSession | undefined,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	const next = {
		...state,
		updatedAt,
	} as LayoutPilotWorkflowState;

	if (session) {
		next.evidenceReviewSession = session;
	}
	else {
		delete next.evidenceReviewSession;
	}

	return freezeDeep(next);
}


export function setWorkflowLayoutPlan(
	state: LayoutPilotWorkflowState,
	plan: LayoutPlan | undefined,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	if (
		plan
		&& (
			!state.semanticSnapshot
			|| plan.snapshotId !== state.semanticSnapshot.id
			|| plan.semanticFingerprint !== state.semanticSnapshot.boardFingerprint
		)
	) {
		throw new Error('LayoutPlan does not belong to the active Semantic Snapshot.');
	}

	const next = {
		...state,
		updatedAt,
	} as LayoutPilotWorkflowState;

	if (plan) {
		const samePlanIdentity = state.layoutPlan?.id === plan.id;
		next.layoutPlan = plan;
		if (!samePlanIdentity) {
			delete next.layoutPreviewSession;
		}
	}
	else {
		delete next.layoutPlan;
		delete next.layoutPreviewSession;
	}

	return freezeDeep(next);
}


export function archiveWorkflowReferencePlan(
	state: LayoutPilotWorkflowState,
	plan: LayoutPlan,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	if (
		!state.semanticSnapshot
		|| plan.semanticFingerprint !== state.semanticSnapshot.boardFingerprint
		|| plan.status !== 'accepted'
		|| layoutPlanAcceptanceMode(plan) !== 'reference-only'
	) {
		throw new Error(
			'Only accepted reference-only LayoutPlans for the active board can be archived.',
		);
	}

	const referencePlans = [
		plan,
		...state.referencePlans.filter(item => item.id !== plan.id),
	]
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, 20);

	return freezeDeep({
		...state,
		referencePlans,
		updatedAt,
	});
}

export function setAndArchiveWorkflowReferencePlan(
	state: LayoutPilotWorkflowState,
	plan: LayoutPlan,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	const withActivePlan = setWorkflowLayoutPlan(state, plan, updatedAt);
	return archiveWorkflowReferencePlan(withActivePlan, plan, updatedAt);
}

export function setWorkflowLayoutPreviewSession(
	state: LayoutPilotWorkflowState,
	session: LayoutPreviewSession | undefined,
	updatedAt = new Date().toISOString(),
): LayoutPilotWorkflowState {
	if (session) {
		const planExists = state.layoutPlan?.id === session.planId
			|| state.referencePlans.some(plan => plan.id === session.planId);
		if (!planExists) {
			throw new Error(
				'Layout preview session does not belong to the active or archived LayoutPlan.',
			);
		}
	}

	const next = {
		...state,
		updatedAt,
	} as LayoutPilotWorkflowState;

	if (session) {
		next.layoutPreviewSession = session;
	}
	else {
		delete next.layoutPreviewSession;
	}

	return freezeDeep(next);
}
