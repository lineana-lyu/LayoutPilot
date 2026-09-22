import { executePlacementTransaction } from '../application/placementTransaction';
import {
	markLayoutPlanApplied,
	type LayoutPlan,
	type LayoutPlanItem,
} from '../domain/layoutPlan';
import {
	placementPlansEquivalent,
	planDecouplingPlacement,
	type PhysicalPlacementPlan,
} from '../domain/physicalPlacement';
import {
	createPlacementCommand,
	markPlacementCommandApplied,
	markPlacementCommandSuperseded,
	type PlacementCommandRecord,
} from '../domain/placementCommand';
import { validateStoredLayoutPlanCurrent } from './layoutPlanRuntime';
import {
	collectPhysicalComponents,
	collectSimpleBoardBoundary,
	collectSimpleComponentKeepouts,
	moveComponentAndVerify,
	readComponentPhysicalState,
} from './pcbPhysicalAdapter';
import {
	getStoredLastPlacementCommand,
	setStoredLastPlacementCommand,
	setStoredLayoutPlan,
} from './workflowStore';

export type LayoutPlanPreflightResult =
	| {
		ok: true;
		plan: LayoutPlan;
		item: LayoutPlanItem;
		executionPlan: PhysicalPlacementPlan;
	}
	| {
		ok: false;
		message: string;
	};

function closeEnough(a: number, b: number, tolerance = 0.01): boolean {
	return Math.abs(a - b) <= tolerance;
}

function itemAsPhysicalPlan(item: LayoutPlanItem): PhysicalPlacementPlan {
	return {
		subjectId: item.subjectId,
		subjectDesignator: item.subjectDesignator,
		ownerId: item.ownerId,
		ownerDesignator: item.ownerDesignator,
		powerNet: item.powerNet,
		groundNet: item.groundNet,
		ownerPowerPadNumber: item.ownerPowerPadNumber,
		subjectPowerPadNumber: item.subjectPowerPadNumber,
		ownerGroundPadNumber: item.ownerGroundPadNumber,
		subjectGroundPadNumber: item.subjectGroundPadNumber,
		estimatedLoopProxyMil: item.estimatedLoopProxyMil,
		from: { ...item.from },
		to: { ...item.to },
		clearanceMil: item.clearanceMil,
		rationale: item.rationale,
	};
}

async function retireSatisfiedOutstandingCommand(): Promise<
	| { ok: true }
	| { ok: false; message: string }
> {
	const outstanding = getStoredLastPlacementCommand();
	if (!outstanding || outstanding.status !== 'applied') {
		return { ok: true };
	}

	let current;
	try {
		current = await readComponentPhysicalState(outstanding.componentId);
	}
	catch (error) {
		return {
			ok: false,
			message: [
				`上一条 Placement Command ${outstanding.id} 仍标记为 applied，`,
				'但当前无法确认对应器件的物理状态。',
				String(error),
				'请先人工检查 PCB，再继续执行新的布局方案。',
			].join('\n'),
		};
	}

	if (
		closeEnough(current.x, outstanding.to.x)
		&& closeEnough(current.y, outstanding.to.y)
	) {
		return {
			ok: false,
			message: [
				`仍有一条未关闭的 Placement Command：${outstanding.id}`,
				`${outstanding.componentDesignator} 仍位于上次目标位置。`,
				'请先撤销上次布局，再应用新的 LayoutPlan。',
			].join('\n'),
		};
	}

	await setStoredLastPlacementCommand(
		markPlacementCommandSuperseded(outstanding),
	);
	return { ok: true };
}

export async function preflightAcceptedLayoutPlan(): Promise<
	LayoutPlanPreflightResult
> {
	const validation = await validateStoredLayoutPlanCurrent();
	if (!validation.ok) {
		return validation;
	}

	const plan = validation.plan;
	if (plan.status !== 'accepted') {
		return {
			ok: false,
			message: '当前 LayoutPlan 尚未被用户接受。请先查看 Ghost Preview 并点击“接受方案”。',
		};
	}

	if (plan.items.length !== 1) {
		return {
			ok: false,
			message: 'v0.9 MVP 只允许一次 Apply 一个 LayoutPlan item；请重新生成单器件预览。',
		};
	}

	const item = plan.items[0];
	const outstanding = await retireSatisfiedOutstandingCommand();
	if (!outstanding.ok) return outstanding;

	const physical = await collectPhysicalComponents(item.subjectId);
	const subject = physical.find(component => component.id === item.subjectId);
	const owner = physical.find(component => component.id === item.ownerId);
	if (!subject || !owner) {
		return {
			ok: false,
			message: '当前 PCB 无法定位 LayoutPlan 中的 subject 或 owner。',
		};
	}

	const board = await collectSimpleBoardBoundary();
	if (!board.ok) {
		return {
			ok: false,
			message: `板框预检失败：${board.reason}`,
		};
	}
	const keepouts = await collectSimpleComponentKeepouts();
	if (!keepouts.ok) {
		return {
			ok: false,
			message: `Keepout 预检失败：${keepouts.reason}`,
		};
	}

	const readiness = planDecouplingPlacement({
		subject,
		owner,
		obstacles: physical,
		board: board.region,
		componentKeepouts: keepouts.polygons,
		powerNet: item.powerNet,
		groundNet: item.groundNet,
		clearanceMil: item.clearanceMil,
		mode: 'execution',
	});

	if (!readiness.ready || !readiness.plan) {
		return {
			ok: false,
			message: [
				`${item.subjectDesignator} 当前未通过物理预检。`,
				...readiness.reasons.map(reason => `• ${reason}`),
			].join('\n'),
		};
	}

	const frozenPlan = itemAsPhysicalPlan(item);
	if (!placementPlansEquivalent(frozenPlan, readiness.plan)) {
		return {
			ok: false,
			message: [
				'当前 PCB 的最佳合法候选位置已经与 Ghost Preview 不同。',
				'LayoutPilot 不会在 Apply 阶段偷偷改用新坐标。',
				'请重新生成布局预览并再次确认。',
			].join('\n'),
		};
	}

	const baselineDrcPassed = await eda.pcb_Drc.check(true, false, false);
	if (!baselineDrcPassed) {
		return {
			ok: false,
			message: '当前 PCB 没有干净的 DRC 基线，按失败关闭策略拒绝执行移动。',
		};
	}

	return {
		ok: true,
		plan,
		item,
		executionPlan: readiness.plan,
	};
}

export type ApplyAcceptedLayoutPlanResult =
	| {
		ok: true;
		command: PlacementCommandRecord;
		item: LayoutPlanItem;
	}
	| {
		ok: false;
		message: string;
		rollbackAttempted?: boolean;
		rollbackVerified?: boolean;
		rollbackDrcPassed?: boolean;
	};

export async function executeAcceptedLayoutPlan(
	expectedPlanId: string,
): Promise<ApplyAcceptedLayoutPlanResult> {
	const preflight = await preflightAcceptedLayoutPlan();
	if (!preflight.ok) return preflight;
	if (preflight.plan.id !== expectedPlanId) {
		return {
			ok: false,
			message: 'LayoutPlan 在确认期间已经变化，本次执行已取消。',
		};
	}

	const { plan, item, executionPlan } = preflight;
	const command = createPlacementCommand({
		snapshotId: plan.snapshotId,
		boardFingerprint: plan.semanticFingerprint,
		constraintId: item.constraintId,
		componentId: item.subjectId,
		componentDesignator: item.subjectDesignator,
		from: item.from,
		to: item.to,
	});

	const transaction = await executePlacementTransaction(
		{
			componentId: item.subjectId,
			from: item.from,
			to: item.to,
		},
		{
			moveAndVerify: async (componentId, point) => {
				await moveComponentAndVerify(componentId, point.x, point.y);
			},
			checkDrc: () => eda.pcb_Drc.check(true, false, false),
		},
	);

	if (!transaction.ok) {
		await setStoredLastPlacementCommand(undefined);
		return {
			ok: false,
			message: transaction.error,
			rollbackAttempted: transaction.rollbackAttempted,
			rollbackVerified: transaction.rollbackVerified,
			rollbackDrcPassed: transaction.rollbackDrcPassed,
		};
	}

	const appliedCommand = markPlacementCommandApplied(command);
	await setStoredLastPlacementCommand(appliedCommand);
	await setStoredLayoutPlan(markLayoutPlanApplied(plan));

	return {
		ok: true,
		command: appliedCommand,
		item: {
			...item,
			to: { ...executionPlan.to },
		},
	};
}
