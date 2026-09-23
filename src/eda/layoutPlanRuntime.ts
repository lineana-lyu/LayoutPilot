import { collectCurrentConstraintSession } from '../application/constraintSession';
import {
	buildLocalLayoutPlan,
	type LayoutPlanningCandidate,
	type LayoutPlanningSkip,
} from '../application/layoutPlanner';
import {
	createLayoutPlan,
	layoutPlanStateMismatches,
	type LayoutPlan,
} from '../domain/layoutPlan';
import { buildPhysicalBoardFingerprint } from '../domain/physicalFingerprint';
import {
	collectPhysicalComponents,
	collectSimpleBoardBoundary,
	collectSimpleComponentKeepouts,
} from './pcbPhysicalAdapter';
import {
	getStoredLayoutPlan,
	setStoredLayoutPlan,
} from './workflowStore';

export type GenerateLayoutPlanResult =
	| {
		ok: true;
		plan: LayoutPlan;
		skipped: LayoutPlanningSkip[];
	}
	| {
		ok: false;
		message: string;
	};

function buildPlanningCandidates(
	session: Awaited<ReturnType<typeof collectCurrentConstraintSession>> & { ok: true },
): LayoutPlanningCandidate[] {
	return session.value.evaluation.entries.flatMap(item => {
		const decision = item.humanOwnershipDecision;
		if (!item.result || !decision) return [];

		return item.result.proposals.flatMap(proposal => {
			if (
				proposal.type !== 'near'
				|| proposal.execution !== 'preview-eligible'
				|| proposal.role !== 'decoupling-capacitor'
			) {
				return [];
			}

			const ownerDesignator = decision.ownerDesignator;
			const powerNet = item.context.connectedNets.find(net =>
				net.classification === 'global-power'
				&& net.coreDesignators.includes(ownerDesignator),
			)?.netName;
			const groundNet = item.context.connectedNets.find(net =>
				net.classification === 'global-ground'
				&& net.coreDesignators.includes(ownerDesignator),
			)?.netName;

			if (!powerNet || !groundNet) return [];

			return [{
				constraintId: proposal.id,
				subjectId: item.entry.componentId,
				subjectDesignator: item.context.designator,
				ownerId: decision.ownerComponentId,
				ownerDesignator,
				powerNet,
				groundNet,
			}];
		});
	});
}

export async function generateCurrentLayoutPlan(
	maxItems = 4,
): Promise<GenerateLayoutPlanResult> {
	const session = await collectCurrentConstraintSession();
	if (!session.ok) {
		return {
			ok: false,
			message: session.message,
		};
	}

	const candidates = buildPlanningCandidates(session);
	if (!candidates.length) {
		return {
			ok: false,
			message: '当前没有满足 Preview 条件的 near(owner) 去耦约束。请先完成至少一个 Owner 确认。',
		};
	}

	const subjectIds = candidates.map(candidate => candidate.subjectId);
	const physical = await collectPhysicalComponents(subjectIds);
	const board = await collectSimpleBoardBoundary();
	if (!board.ok) {
		return {
			ok: false,
			message: `无法建立布局预览：${board.reason}`,
		};
	}

	const keepouts = await collectSimpleComponentKeepouts();
	if (!keepouts.ok) {
		return {
			ok: false,
			message: `无法建立布局预览：${keepouts.reason}`,
		};
	}

	const provisionalPhysicalFingerprint = buildPhysicalBoardFingerprint({
		components: physical,
		board: board.region,
		componentKeepouts: keepouts.polygons,
	});

	const result = buildLocalLayoutPlan({
		snapshotId: session.value.snapshot.id,
		semanticFingerprint: session.value.boardFingerprint,
		physicalFingerprint: provisionalPhysicalFingerprint,
		candidates,
		physicalComponents: physical,
		board: board.region,
		componentKeepouts: keepouts.polygons,
		maxItems,
	});

	if (!result.plan) {
		return {
			ok: false,
			message: [
				'当前没有生成可显示的合法布局预览。',
				...result.skipped.slice(0, 6).map(item =>
					`${item.subjectDesignator}：${item.reasons.join('；')}`
				),
			].join('\n'),
		};
	}

	const routingEvidenceComponentIds = result.plan.items.map(
		item => item.subjectId,
	);
	const physicalFingerprint = buildPhysicalBoardFingerprint({
		components: physical,
		board: board.region,
		componentKeepouts: keepouts.polygons,
		routingEvidenceComponentIds,
	});
	const plan = createLayoutPlan({
		snapshotId: result.plan.snapshotId,
		semanticFingerprint: result.plan.semanticFingerprint,
		physicalFingerprint,
		items: result.plan.items,
		createdAt: result.plan.createdAt,
	});

	await setStoredLayoutPlan(plan);
	return {
		ok: true,
		plan,
		skipped: result.skipped,
	};
}

export type ValidateStoredLayoutPlanResult =
	| {
		ok: true;
		plan: LayoutPlan;
		physicalFingerprint: string;
	}
	| {
		ok: false;
		message: string;
	};

export async function validateLayoutPlanCurrent(
	plan: LayoutPlan,
): Promise<ValidateStoredLayoutPlanResult> {
	const session = await collectCurrentConstraintSession();
	if (!session.ok) {
		return {
			ok: false,
			message: session.message,
		};
	}

	const physical = await collectPhysicalComponents(
		plan.items.map(item => item.subjectId),
	);
	const board = await collectSimpleBoardBoundary();
	if (!board.ok) {
		return {
			ok: false,
			message: `当前板框无法验证：${board.reason}`,
		};
	}
	const keepouts = await collectSimpleComponentKeepouts();
	if (!keepouts.ok) {
		return {
			ok: false,
			message: `当前 Keepout 无法验证：${keepouts.reason}`,
		};
	}

	const physicalFingerprint = buildPhysicalBoardFingerprint({
		components: physical,
		board: board.region,
		componentKeepouts: keepouts.polygons,
		routingEvidenceComponentIds: plan.items.map(item => item.subjectId),
	});

	const mismatches = layoutPlanStateMismatches(plan, {
		snapshotId: session.value.snapshot.id,
		semanticFingerprint: session.value.boardFingerprint,
		physicalFingerprint,
	});
	if (mismatches.length) {
		const labels = mismatches.map(mismatch =>
			mismatch === 'snapshot'
				? 'Semantic Snapshot'
				: mismatch === 'semantic'
					? '语义输入'
					: 'PCB 物理状态'
		);
		return {
			ok: false,
			message: [
				`${labels.join('、') }发生变化，旧 LayoutPlan 已过期。`,
				`Plan physical fingerprint：${plan.physicalFingerprint}`,
				`Current physical fingerprint：${physicalFingerprint}`,
				'请重新生成布局预览。',
			].join('\n'),
		};
	}

	return {
		ok: true,
		plan,
		physicalFingerprint,
	};
}

export async function validateStoredLayoutPlanCurrent(): Promise<
	ValidateStoredLayoutPlanResult
> {
	const plan = getStoredLayoutPlan();
	if (!plan) {
		return {
			ok: false,
			message: '当前没有 LayoutPlan。请先生成布局预览。',
		};
	}
	return validateLayoutPlanCurrent(plan);
}
