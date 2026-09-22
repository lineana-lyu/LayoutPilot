import type { BoardPolygon, BoardRegion } from '../domain/boardBoundary';
import {
	createLayoutPlan,
	type LayoutPlan,
	type LayoutPlanItem,
} from '../domain/layoutPlan';
import {
	planDecouplingPlacement,
	type PhysicalBounds,
	type PhysicalComponentSnapshot,
	type PhysicalPlacementPlan,
} from '../domain/physicalPlacement';

export interface LayoutPlanningCandidate {
	constraintId: string;
	subjectId: string;
	subjectDesignator: string;
	ownerId: string;
	ownerDesignator: string;
	powerNet: string;
	groundNet: string;
}

export interface LayoutPlanningSkip {
	constraintId: string;
	subjectDesignator: string;
	reasons: string[];
}

export interface LocalLayoutPlanResult {
	plan?: LayoutPlan;
	skipped: LayoutPlanningSkip[];
}

function translateBounds(
	bounds: PhysicalBounds,
	dx: number,
	dy: number,
): PhysicalBounds {
	return {
		minX: bounds.minX + dx,
		minY: bounds.minY + dy,
		maxX: bounds.maxX + dx,
		maxY: bounds.maxY + dy,
	};
}

function planToItem(
	candidate: LayoutPlanningCandidate,
	subject: PhysicalComponentSnapshot,
	plan: PhysicalPlacementPlan,
	executionBlockers: string[],
): LayoutPlanItem | undefined {
	if (!subject.bounds) return undefined;

	const dx = plan.to.x - plan.from.x;
	const dy = plan.to.y - plan.from.y;

	return {
		constraintId: candidate.constraintId,
		subjectId: plan.subjectId,
		subjectDesignator: plan.subjectDesignator,
		ownerId: plan.ownerId,
		ownerDesignator: plan.ownerDesignator,
		powerNet: plan.powerNet,
		groundNet: plan.groundNet,
		ownerPowerPadNumber: plan.ownerPowerPadNumber,
		subjectPowerPadNumber: plan.subjectPowerPadNumber,
		ownerGroundPadNumber: plan.ownerGroundPadNumber,
		subjectGroundPadNumber: plan.subjectGroundPadNumber,
		from: { ...plan.from },
		to: { ...plan.to },
		fromBounds: { ...subject.bounds },
		toBounds: translateBounds(subject.bounds, dx, dy),
		movementMil: Math.hypot(dx, dy),
		estimatedLoopProxyMil: plan.estimatedLoopProxyMil,
		clearanceMil: plan.clearanceMil,
		executionBlockers: [...executionBlockers],
		rationale: plan.rationale,
	};
}

function translateComponent(
	component: PhysicalComponentSnapshot,
	to: { x: number; y: number },
): PhysicalComponentSnapshot {
	const dx = to.x - component.x;
	const dy = to.y - component.y;

	return {
		...component,
		x: to.x,
		y: to.y,
		bounds: component.bounds
			? translateBounds(component.bounds, dx, dy)
			: undefined,
		pads: component.pads.map(pad => ({
			...pad,
			x: pad.x + dx,
			y: pad.y + dy,
		})),
	};
}

export function buildLocalLayoutPlan(input: {
	snapshotId: string;
	semanticFingerprint: string;
	physicalFingerprint: string;
	candidates: LayoutPlanningCandidate[];
	physicalComponents: PhysicalComponentSnapshot[];
	board: BoardRegion;
	componentKeepouts: BoardPolygon[];
	maxItems?: number;
}): LocalLayoutPlanResult {
	const maxItems = Math.max(1, Math.min(input.maxItems ?? 4, 8));
	const uniqueCandidates = new Map<string, LayoutPlanningCandidate>();

	for (const candidate of input.candidates) {
		if (!uniqueCandidates.has(candidate.subjectId)) {
			uniqueCandidates.set(candidate.subjectId, candidate);
		}
	}

	const ordered = [...uniqueCandidates.values()]
		.sort((a, b) =>
			a.ownerDesignator.localeCompare(b.ownerDesignator)
			|| a.subjectDesignator.localeCompare(b.subjectDesignator),
		)
		.slice(0, maxItems);

	let virtualComponents = input.physicalComponents.map(component => ({
		...component,
		bounds: component.bounds ? { ...component.bounds } : undefined,
		pads: component.pads.map(pad => ({ ...pad })),
	}));
	const items: LayoutPlanItem[] = [];
	const skipped: LayoutPlanningSkip[] = [];

	for (const candidate of ordered) {
		const subject = virtualComponents.find(
			component => component.id === candidate.subjectId,
		);
		const owner = virtualComponents.find(
			component => component.id === candidate.ownerId,
		);

		if (!subject || !owner) {
			skipped.push({
				constraintId: candidate.constraintId,
				subjectDesignator: candidate.subjectDesignator,
				reasons: ['无法在当前 PCB 物理快照中定位 subject 或 owner'],
			});
			continue;
		}

		const readiness = planDecouplingPlacement({
			subject,
			owner,
			obstacles: virtualComponents,
			board: input.board,
			componentKeepouts: input.componentKeepouts,
			powerNet: candidate.powerNet,
			groundNet: candidate.groundNet,
			mode: 'preview',
		});

		if (!readiness.ready || !readiness.plan) {
			skipped.push({
				constraintId: candidate.constraintId,
				subjectDesignator: candidate.subjectDesignator,
				reasons: [...readiness.reasons],
			});
			continue;
		}

		const item = planToItem(
			candidate,
			subject,
			readiness.plan,
			readiness.executionBlockers,
		);
		if (!item) {
			skipped.push({
				constraintId: candidate.constraintId,
				subjectDesignator: candidate.subjectDesignator,
				reasons: ['缺少 subject 实测 BBox，无法建立 Ghost Preview 轮廓'],
			});
			continue;
		}

		items.push(item);
		virtualComponents = virtualComponents.map(component =>
			component.id === subject.id
				? translateComponent(component, readiness.plan!.to)
				: component,
		);
	}

	if (!items.length) {
		return { skipped };
	}

	return {
		plan: createLayoutPlan({
			snapshotId: input.snapshotId,
			semanticFingerprint: input.semanticFingerprint,
			physicalFingerprint: input.physicalFingerprint,
			items,
		}),
		skipped,
	};
}
