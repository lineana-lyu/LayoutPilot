import type { PhysicalBounds, PlacementPoint } from './physicalPlacement';

export type LayoutPlanStatus =
	| 'preview'
	| 'accepted'
	| 'rejected'
	| 'applied'
	| 'superseded';

export interface LayoutPlanItem {
	constraintId: string;
	subjectId: string;
	subjectDesignator: string;
	ownerId: string;
	ownerDesignator: string;
	powerNet: string;
	groundNet: string;
	ownerPowerPadNumber: string;
	subjectPowerPadNumber: string;
	ownerGroundPadNumber: string;
	subjectGroundPadNumber: string;
	from: PlacementPoint;
	to: PlacementPoint;
	fromBounds: PhysicalBounds;
	toBounds: PhysicalBounds;
	movementMil: number;
	currentLoopProxyMil: number;
	estimatedLoopProxyMil: number;
	clearanceMil: number;
	executionBlockers: string[];
	rationale: string;
}

export interface LayoutPlan {
	schemaVersion: 1;
	id: string;
	snapshotId: string;
	semanticFingerprint: string;
	physicalFingerprint: string;
	createdAt: string;
	status: LayoutPlanStatus;
	items: LayoutPlanItem[];
}

function hashText(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
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

export function createLayoutPlan(input: {
	snapshotId: string;
	semanticFingerprint: string;
	physicalFingerprint: string;
	items: LayoutPlanItem[];
	createdAt?: string;
}): LayoutPlan {
	const createdAt = input.createdAt ?? new Date().toISOString();
	const stableItems = input.items.map(item => ({
		...item,
		from: { ...item.from },
		to: { ...item.to },
		fromBounds: { ...item.fromBounds },
		toBounds: { ...item.toBounds },
		executionBlockers: [...item.executionBlockers],
	}));

	const id = `layout-plan-${hashText(JSON.stringify({
		snapshotId: input.snapshotId,
		semanticFingerprint: input.semanticFingerprint,
		physicalFingerprint: input.physicalFingerprint,
		items: stableItems,
		createdAt,
	}))}`;

	return freezeDeep({
		schemaVersion: 1 as const,
		id,
		snapshotId: input.snapshotId,
		semanticFingerprint: input.semanticFingerprint,
		physicalFingerprint: input.physicalFingerprint,
		createdAt,
		status: 'preview' as const,
		items: stableItems,
	});
}

export type LayoutPlanAcceptanceMode =
	| 'executable'
	| 'mixed'
	| 'reference-only';

export function layoutPlanAcceptanceMode(
	plan: LayoutPlan,
): LayoutPlanAcceptanceMode {
	const executable = plan.items.filter(
		item => item.executionBlockers.length === 0,
	).length;
	if (executable === 0) return 'reference-only';
	if (executable === plan.items.length) return 'executable';
	return 'mixed';
}

export type LayoutPlanEvent =
	| 'accept'
	| 'reject'
	| 'apply'
	| 'supersede';

const LAYOUT_PLAN_TRANSITIONS: Record<
	LayoutPlanStatus,
	Partial<Record<LayoutPlanEvent, LayoutPlanStatus>>
> = {
	preview: {
		accept: 'accepted',
		reject: 'rejected',
		supersede: 'superseded',
	},
	accepted: {
		apply: 'applied',
		supersede: 'superseded',
	},
	rejected: {},
	applied: {
		supersede: 'superseded',
	},
	superseded: {},
};

export function canTransitionLayoutPlan(
	plan: LayoutPlan,
	event: LayoutPlanEvent,
): boolean {
	return Boolean(LAYOUT_PLAN_TRANSITIONS[plan.status][event]);
}

export function transitionLayoutPlan(
	plan: LayoutPlan,
	event: LayoutPlanEvent,
): LayoutPlan {
	const nextStatus = LAYOUT_PLAN_TRANSITIONS[plan.status][event];
	if (!nextStatus) {
		throw new Error(
			`Invalid LayoutPlan transition: ${plan.status} --${event}--> ?`,
		);
	}
	return freezeDeep({
		...plan,
		status: nextStatus,
	});
}

export function markLayoutPlanAccepted(
	plan: LayoutPlan,
): LayoutPlan {
	return transitionLayoutPlan(plan, 'accept');
}

export function markLayoutPlanRejected(
	plan: LayoutPlan,
): LayoutPlan {
	return transitionLayoutPlan(plan, 'reject');
}

export function markLayoutPlanApplied(
	plan: LayoutPlan,
): LayoutPlan {
	return transitionLayoutPlan(plan, 'apply');
}

export function markLayoutPlanSuperseded(
	plan: LayoutPlan,
): LayoutPlan {
	return transitionLayoutPlan(plan, 'supersede');
}

export type LayoutPlanStateMismatch =
	| 'snapshot'
	| 'semantic'
	| 'physical';

export function layoutPlanStateMismatches(
	plan: LayoutPlan,
	input: {
		snapshotId: string;
		semanticFingerprint: string;
		physicalFingerprint: string;
	},
): LayoutPlanStateMismatch[] {
	const mismatches: LayoutPlanStateMismatch[] = [];
	if (plan.snapshotId !== input.snapshotId) mismatches.push('snapshot');
	if (plan.semanticFingerprint !== input.semanticFingerprint) {
		mismatches.push('semantic');
	}
	if (plan.physicalFingerprint !== input.physicalFingerprint) {
		mismatches.push('physical');
	}
	return mismatches;
}

export function layoutPlanMatchesCurrentState(
	plan: LayoutPlan,
	input: {
		snapshotId: string;
		semanticFingerprint: string;
		physicalFingerprint: string;
	},
): boolean {
	return layoutPlanStateMismatches(plan, input).length === 0;
}


function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPoint(value: unknown): value is PlacementPoint {
	return isRecord(value)
		&& typeof value.x === 'number'
		&& Number.isFinite(value.x)
		&& typeof value.y === 'number'
		&& Number.isFinite(value.y);
}

function isBounds(value: unknown): value is PhysicalBounds {
	return isRecord(value)
		&& typeof value.minX === 'number'
		&& typeof value.minY === 'number'
		&& typeof value.maxX === 'number'
		&& typeof value.maxY === 'number'
		&& Number.isFinite(value.minX)
		&& Number.isFinite(value.minY)
		&& Number.isFinite(value.maxX)
		&& Number.isFinite(value.maxY);
}

export function isLayoutPlan(value: unknown): value is LayoutPlan {
	if (!isRecord(value) || value.schemaVersion !== 1) return false;
	if (
		typeof value.id !== 'string'
		|| typeof value.snapshotId !== 'string'
		|| typeof value.semanticFingerprint !== 'string'
		|| typeof value.physicalFingerprint !== 'string'
		|| typeof value.createdAt !== 'string'
		|| !(
			value.status === 'preview'
			|| value.status === 'accepted'
			|| value.status === 'rejected'
			|| value.status === 'applied'
			|| value.status === 'superseded'
		)
		|| !Array.isArray(value.items)
	) {
		return false;
	}

	return value.items.every(item => {
		if (!isRecord(item)) return false;
		return typeof item.constraintId === 'string'
			&& typeof item.subjectId === 'string'
			&& typeof item.subjectDesignator === 'string'
			&& typeof item.ownerId === 'string'
			&& typeof item.ownerDesignator === 'string'
			&& typeof item.powerNet === 'string'
			&& typeof item.groundNet === 'string'
			&& typeof item.ownerPowerPadNumber === 'string'
			&& typeof item.subjectPowerPadNumber === 'string'
			&& typeof item.ownerGroundPadNumber === 'string'
			&& typeof item.subjectGroundPadNumber === 'string'
			&& isPoint(item.from)
			&& isPoint(item.to)
			&& isBounds(item.fromBounds)
			&& isBounds(item.toBounds)
			&& typeof item.movementMil === 'number'
			&& Number.isFinite(item.movementMil)
			&& typeof item.currentLoopProxyMil === 'number'
			&& Number.isFinite(item.currentLoopProxyMil)
			&& typeof item.estimatedLoopProxyMil === 'number'
			&& Number.isFinite(item.estimatedLoopProxyMil)
			&& typeof item.clearanceMil === 'number'
			&& Number.isFinite(item.clearanceMil)
			&& Array.isArray(item.executionBlockers)
			&& item.executionBlockers.every(reason => typeof reason === 'string')
			&& typeof item.rationale === 'string';
	});
}
