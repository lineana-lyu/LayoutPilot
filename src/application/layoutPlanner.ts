import type { BoardPolygon, BoardRegion } from '../domain/boardBoundary';
import {
	solveClusterAssignment,
	type ClusterPlacementMember,
} from '../domain/clusterAssignment';
import {
	createLayoutPlan,
	type LayoutPlan,
	type LayoutPlanItem,
} from '../domain/layoutPlan';
import {
	enumerateDecouplingPlacementAlternatives,
	type PhysicalBounds,
	type PhysicalComponentSnapshot,
	type PhysicalPlacementAlternative,
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

export interface LayoutPlanningUnchanged {
	constraintId: string;
	subjectDesignator: string;
	ownerDesignator: string;
	currentLoopProxyMil: number;
	reason: string;
}

export interface LocalLayoutPlanResult {
	plan?: LayoutPlan;
	skipped: LayoutPlanningSkip[];
	unchanged: LayoutPlanningUnchanged[];
}

interface ClusterMemberPayload {
	candidate: LayoutPlanningCandidate;
	subject: PhysicalComponentSnapshot;
	alternative: PhysicalPlacementAlternative;
	executionBlockers: string[];
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
		currentLoopProxyMil: plan.currentLoopProxyMil,
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

function clusterKey(candidate: LayoutPlanningCandidate): string {
	return [
		candidate.ownerId,
		candidate.powerNet,
		candidate.groundNet,
	].join('|');
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
	const uniqueCandidates = new Map<string, LayoutPlanningCandidate>();
	for (const candidate of input.candidates) {
		if (!uniqueCandidates.has(candidate.subjectId)) {
			uniqueCandidates.set(candidate.subjectId, candidate);
		}
	}

	const clusterMap = new Map<string, LayoutPlanningCandidate[]>();
	for (const candidate of uniqueCandidates.values()) {
		const key = clusterKey(candidate);
		const members = clusterMap.get(key) ?? [];
		members.push(candidate);
		clusterMap.set(key, members);
	}

	// Larger electrical neighborhoods are solved first. Designators no longer
	// determine who gets the best physical slots around an owner.
	const clusters = [...clusterMap.entries()].sort((a, b) =>
		b[1].length - a[1].length || a[0].localeCompare(b[0])
	);

	let virtualComponents: PhysicalComponentSnapshot[] = input.physicalComponents.map(component => ({
		...component,
		bounds: component.bounds ? { ...component.bounds } : undefined,
		pads: component.pads.map(pad => ({ ...pad })),
	}));
	const items: LayoutPlanItem[] = [];
	const skipped: LayoutPlanningSkip[] = [];
	const unchanged: LayoutPlanningUnchanged[] = [];

	for (const [, clusterCandidates] of clusters) {
		const clusterSubjectIds = new Set(clusterCandidates.map(candidate => candidate.subjectId));
		const fixedObstacles = virtualComponents.filter(
			component => !clusterSubjectIds.has(component.id),
		);
		const solverMembers: ClusterPlacementMember<ClusterMemberPayload>[] = [];
		let clusterInvalid = false;

		for (const candidate of clusterCandidates) {
			const subject = virtualComponents.find(component => component.id === candidate.subjectId);
			const owner = virtualComponents.find(component => component.id === candidate.ownerId);
			if (!subject || !owner) {
				skipped.push({
					constraintId: candidate.constraintId,
					subjectDesignator: candidate.subjectDesignator,
					reasons: ['无法在当前 PCB 物理快照中定位 subject 或 owner'],
				});
				clusterInvalid = true;
				continue;
			}

			const alternatives = enumerateDecouplingPlacementAlternatives({
				subject,
				owner,
				obstacles: fixedObstacles,
				board: input.board,
				componentKeepouts: input.componentKeepouts,
				powerNet: candidate.powerNet,
				groundNet: candidate.groundNet,
				mode: 'preview',
				maxMoveAlternatives: 8,
			});
			if (!alternatives.ready || !alternatives.alternatives.length) {
				skipped.push({
					constraintId: candidate.constraintId,
					subjectDesignator: candidate.subjectDesignator,
					reasons: alternatives.reasons.length
						? [...alternatives.reasons]
						: ['没有可参与联合规划的布局状态'],
				});
				clusterInvalid = true;
				continue;
			}

			solverMembers.push({
				subjectId: subject.id,
				options: alternatives.alternatives.map((alternative, index) => ({
					id: `${subject.id}:${alternative.kind}:${index}`,
					subjectId: subject.id,
					cost: alternative.cost,
					bounds: { ...alternative.targetBounds },
					clearanceMil: alternative.clearanceMil,
					payload: {
						candidate,
						subject,
						alternative,
						executionBlockers: [...alternatives.executionBlockers],
					},
				})),
			});
		}

		// A partially missing cluster would make the remaining joint solution
		// misleading, so fail closed for that cluster instead of reverting to
		// sequential greedy placement.
		if (clusterInvalid || solverMembers.length !== clusterCandidates.length) {
			continue;
		}

		const solution = solveClusterAssignment({ members: solverMembers });
		if (!solution.complete) {
			for (const candidate of clusterCandidates) {
				skipped.push({
					constraintId: candidate.constraintId,
					subjectDesignator: candidate.subjectDesignator,
					reasons: [solution.reason ?? 'Cluster 联合规划失败'],
				});
			}
			continue;
		}

		for (const assignment of solution.assignments) {
			const {
				candidate,
				subject,
				alternative,
				executionBlockers,
			} = assignment.payload;

			if (alternative.kind === 'keep-current' || !alternative.plan) {
				unchanged.push({
					constraintId: candidate.constraintId,
					subjectDesignator: candidate.subjectDesignator,
					ownerDesignator: candidate.ownerDesignator,
					currentLoopProxyMil: alternative.loopProxyMil,
					reason: '当前位置参与与新位置相同的目标函数比较，并在联合规划中胜出。',
				});
				continue;
			}

			const item = planToItem(
				candidate,
				subject,
				alternative.plan,
				executionBlockers,
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
					? translateComponent(component, alternative.plan!.to)
					: component
			);
		}
	}

	if (
		input.maxItems !== undefined
		&& items.length > Math.max(1, input.maxItems)
	) {
		return {
			skipped: [
				...skipped,
				{
					constraintId: 'layout-plan-capacity',
					subjectDesignator: 'LayoutPlan',
					reasons: [
						`联合规划产生 ${items.length} 个必要移动，超过调用方允许的 ${input.maxItems} 项。为避免截断 Cluster 结果，已失败关闭。`,
					],
				},
			],
			unchanged,
		};
	}

	if (!items.length) {
		return { skipped, unchanged };
	}

	return {
		plan: createLayoutPlan({
			snapshotId: input.snapshotId,
			semanticFingerprint: input.semanticFingerprint,
			physicalFingerprint: input.physicalFingerprint,
			items,
		}),
		skipped,
		unchanged,
	};
}
