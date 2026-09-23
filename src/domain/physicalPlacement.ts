import { boxInsideBoardRegion, boxIntersectsPolygon, type BoardPolygon, type BoardRegion } from './boardBoundary';
import { evaluatePlacementObjective, isStrictPlacementImprovement } from './placementObjective';

export interface PhysicalPadSnapshot {
	componentId: string;
	designator: string;
	padNumber: string;
	net?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	connectedPrimitiveCount?: number;
}

export interface PhysicalBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface PhysicalComponentSnapshot {
	id: string;
	designator: string;
	x: number;
	y: number;
	rotation: number;
	layer: string;
	locked: boolean;
	bounds?: PhysicalBounds;
	pads: PhysicalPadSnapshot[];
}

export interface PlacementPoint {
	x: number;
	y: number;
}

export interface PhysicalPlacementPlan {
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
	currentLoopProxyMil: number;
	estimatedLoopProxyMil: number;
	from: PlacementPoint;
	to: PlacementPoint;
	clearanceMil: number;
	rationale: string;
}


export function placementPlansEquivalent(
	a: PhysicalPlacementPlan,
	b: PhysicalPlacementPlan,
	tolerance = 0.01,
): boolean {
	const samePoint = (p1: PlacementPoint, p2: PlacementPoint) =>
		Math.abs(p1.x - p2.x) <= tolerance
		&& Math.abs(p1.y - p2.y) <= tolerance;

	return a.subjectId === b.subjectId
		&& a.ownerId === b.ownerId
		&& a.powerNet === b.powerNet
		&& a.groundNet === b.groundNet
		&& a.ownerPowerPadNumber === b.ownerPowerPadNumber
		&& a.subjectPowerPadNumber === b.subjectPowerPadNumber
		&& a.ownerGroundPadNumber === b.ownerGroundPadNumber
		&& a.subjectGroundPadNumber === b.subjectGroundPadNumber
		&& Math.abs(a.currentLoopProxyMil - b.currentLoopProxyMil) <= tolerance
		&& Math.abs(a.estimatedLoopProxyMil - b.estimatedLoopProxyMil) <= tolerance
		&& Math.abs(a.clearanceMil - b.clearanceMil) <= tolerance
		&& samePoint(a.from, b.from)
		&& samePoint(a.to, b.to);
}

export type PlacementTargetFailureCode =
	| 'invalid-input'
	| 'invalid-obstacle'
	| 'collision'
	| 'board-boundary'
	| 'keepout';

export interface PlacementTargetValidation {
	valid: boolean;
	reasons: string[];
	failureCode?: PlacementTargetFailureCode;
}

export interface PlacementReadiness {
	ready: boolean;
	reasons: string[];
	executionBlockers: string[];
	plan?: PhysicalPlacementPlan;
}

interface BBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const DEFAULT_CLEARANCE_MIL = 20;
const MIN_LOCAL_SEARCH_RADIUS_MIL = 200;
const MAX_LOCAL_SEARCH_RADIUS_MIL = 500;
const MIN_LOCAL_SEARCH_STEP_MIL = 10;
const MAX_LOCAL_SEARCH_STEP_MIL = 25;

function componentBox(component: PhysicalComponentSnapshot): BBox | undefined {
	const bounds = component.bounds;
	if (
		!bounds
		|| !Number.isFinite(bounds.minX)
		|| !Number.isFinite(bounds.minY)
		|| !Number.isFinite(bounds.maxX)
		|| !Number.isFinite(bounds.maxY)
		|| bounds.maxX <= bounds.minX
		|| bounds.maxY <= bounds.minY
	) {
		return undefined;
	}
	return { ...bounds };
}

function translatedBox(
	box: BBox,
	dx: number,
	dy: number,
): BBox {
	return {
		minX: box.minX + dx,
		minY: box.minY + dy,
		maxX: box.maxX + dx,
		maxY: box.maxY + dy,
	};
}

function expandBox(box: BBox, clearance: number): BBox {
	return {
		minX: box.minX - clearance,
		minY: box.minY - clearance,
		maxX: box.maxX + clearance,
		maxY: box.maxY + clearance,
	};
}

function boxesOverlap(a: BBox, b: BBox): boolean {
	return !(
		a.maxX <= b.minX
		|| a.minX >= b.maxX
		|| a.maxY <= b.minY
		|| a.minY >= b.maxY
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function localSearchStep(clearanceMil: number): number {
	return clamp(
		clearanceMil,
		MIN_LOCAL_SEARCH_STEP_MIL,
		MAX_LOCAL_SEARCH_STEP_MIL,
	);
}

function localSearchRadius(
	subjectBox: BBox,
	ownerBox: BBox,
	clearanceMil: number,
): number {
	const subjectSpan = Math.max(
		subjectBox.maxX - subjectBox.minX,
		subjectBox.maxY - subjectBox.minY,
	);
	const ownerSpan = Math.max(
		ownerBox.maxX - ownerBox.minX,
		ownerBox.maxY - ownerBox.minY,
	);
	const localScale = Math.max(subjectSpan, Math.min(ownerSpan, 200));

	return clamp(
		localScale * 2 + clearanceMil * 4,
		MIN_LOCAL_SEARCH_RADIUS_MIL,
		MAX_LOCAL_SEARCH_RADIUS_MIL,
	);
}

function buildLocalSearchOffsets(
	stepMil: number,
	radiusMil: number,
): PlacementPoint[] {
	const offsets: PlacementPoint[] = [];
	const maxRing = Math.max(1, Math.ceil(radiusMil / stepMil));

	for (let ring = 1; ring <= maxRing; ring += 1) {
		const distance = ring * stepMil;

		for (let xIndex = -ring; xIndex <= ring; xIndex += 1) {
			offsets.push({
				x: xIndex * stepMil,
				y: -distance,
			});
			offsets.push({
				x: xIndex * stepMil,
				y: distance,
			});
		}

		for (let yIndex = -ring + 1; yIndex <= ring - 1; yIndex += 1) {
			offsets.push({
				x: -distance,
				y: yIndex * stepMil,
			});
			offsets.push({
				x: distance,
				y: yIndex * stepMil,
			});
		}
	}

	return offsets;
}

function isFinitePositive(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

function validateMeasuredBounds(
	component: PhysicalComponentSnapshot,
): string[] {
	const reasons: string[] = [];
	if (!Number.isFinite(component.x) || !Number.isFinite(component.y)) {
		reasons.push(`${component.designator} 器件坐标无效`);
	}
	if (!componentBox(component)) {
		reasons.push(
			`${component.designator} 缺少可信的 EasyEDA 实测器件 BBox`,
		);
	}
	return reasons;
}

function validateComponentGeometry(
	component: PhysicalComponentSnapshot,
): string[] {
	const reasons = validateMeasuredBounds(component);
	if (!component.pads.length) {
		reasons.push(`${component.designator} 没有可用于物理规划的焊盘`);
	}
	for (const pad of component.pads) {
		if (
			!Number.isFinite(pad.x)
			|| !Number.isFinite(pad.y)
			|| !isFinitePositive(pad.width)
			|| !isFinitePositive(pad.height)
		) {
			reasons.push(
				`${component.designator}.${pad.padNumber} 焊盘几何信息不完整`,
			);
		}
	}
	return reasons;
}

export function validatePlacementTarget(input: {
	subject: PhysicalComponentSnapshot;
	obstacles: PhysicalComponentSnapshot[];
	board: BoardRegion;
	componentKeepouts: BoardPolygon[];
	target: PlacementPoint;
	clearanceMil?: number;
}): PlacementTargetValidation {
	const {
		subject,
		obstacles,
		board,
		componentKeepouts,
		target,
	} = input;
	const clearanceMil = input.clearanceMil ?? DEFAULT_CLEARANCE_MIL;
	const reasons = validateMeasuredBounds(subject);

	if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
		reasons.push('目标坐标无效');
	}
	if (!Number.isFinite(clearanceMil) || clearanceMil <= 0) {
		reasons.push('布局安全间距必须为正数');
	}
	if (reasons.length) {
		return {
			valid: false,
			reasons,
			failureCode: 'invalid-input',
		};
	}

	const subjectBox = componentBox(subject);
	if (!subjectBox) {
		return {
			valid: false,
			reasons: [`${subject.designator} 无法建立实测器件 BBox`],
			failureCode: 'invalid-input',
		};
	}

	const relevantObstacles = obstacles.filter(component =>
		component.id !== subject.id
		&& component.layer === subject.layer
	);
	const invalidObstacle = relevantObstacles.find(
		component => validateMeasuredBounds(component).length > 0,
	);
	if (invalidObstacle) {
		return {
			valid: false,
			reasons: [
				`无法确认 ${invalidObstacle.designator} 的 EasyEDA 实测 BBox，不能证明目标位置无碰撞`,
			],
			failureCode: 'invalid-obstacle',
		};
	}

	const dx = target.x - subject.x;
	const dy = target.y - subject.y;
	const translated = expandBox(
		translatedBox(subjectBox, dx, dy),
		clearanceMil,
	);
	const collision = relevantObstacles.find(component => {
		const box = componentBox(component);
		return Boolean(box && boxesOverlap(translated, box));
	});
	if (collision) {
		return {
			valid: false,
			reasons: [`目标位置与 ${collision.designator} 的实测器件 BBox 冲突`],
			failureCode: 'collision',
		};
	}
	if (!boxInsideBoardRegion(translated, board)) {
		return {
			valid: false,
			reasons: ['目标位置超出可验证板框或安全余量越界'],
			failureCode: 'board-boundary',
		};
	}
	if (componentKeepouts.some(keepout =>
		boxIntersectsPolygon(translated, keepout),
	)) {
		return {
			valid: false,
			reasons: ['目标位置与 NO_COMPONENTS keepout 冲突'],
			failureCode: 'keepout',
		};
	}

	return { valid: true, reasons: [] };
}

export type PhysicalPlacementAlternativeKind = 'keep-current' | 'move';

export interface PhysicalPlacementAlternative {
	kind: PhysicalPlacementAlternativeKind;
	cost: number;
	loopProxyMil: number;
	movementMil: number;
	target: PlacementPoint;
	targetBounds: PhysicalBounds;
	clearanceMil: number;
	plan?: PhysicalPlacementPlan;
}

export interface PhysicalPlacementAlternatives {
	ready: boolean;
	reasons: string[];
	executionBlockers: string[];
	alternatives: PhysicalPlacementAlternative[];
}

function bestCurrentLoopProxy(input: {
	subjectPowerPads: PhysicalPadSnapshot[];
	subjectGroundPads: PhysicalPadSnapshot[];
	ownerPowerPads: PhysicalPadSnapshot[];
	ownerGroundPads: PhysicalPadSnapshot[];
}): number | undefined {
	let best = Number.POSITIVE_INFINITY;
	for (const subjectPowerPad of input.subjectPowerPads) {
		for (const ownerPowerPad of input.ownerPowerPads) {
			const powerDistance = Math.hypot(
				subjectPowerPad.x - ownerPowerPad.x,
				subjectPowerPad.y - ownerPowerPad.y,
			);
			for (const subjectGroundPad of input.subjectGroundPads) {
				for (const ownerGroundPad of input.ownerGroundPads) {
					const groundDistance = Math.hypot(
						subjectGroundPad.x - ownerGroundPad.x,
						subjectGroundPad.y - ownerGroundPad.y,
					);
					best = Math.min(best, powerDistance + groundDistance);
				}
			}
		}
	}
	return Number.isFinite(best) ? best : undefined;
}

export function enumerateDecouplingPlacementAlternatives(input: {
	subject: PhysicalComponentSnapshot;
	owner: PhysicalComponentSnapshot;
	obstacles: PhysicalComponentSnapshot[];
	board: BoardRegion;
	componentKeepouts: BoardPolygon[];
	powerNet: string;
	groundNet: string;
	clearanceMil?: number;
	mode?: 'preview' | 'execution';
	maxMoveAlternatives?: number;
}): PhysicalPlacementAlternatives {
	const {
		subject,
		owner,
		obstacles,
		board,
		componentKeepouts,
		powerNet,
		groundNet,
	} = input;
	const clearanceMil = input.clearanceMil ?? DEFAULT_CLEARANCE_MIL;
	const mode = input.mode ?? 'execution';
	const maxMoveAlternatives = Math.max(
		1,
		Math.min(input.maxMoveAlternatives ?? 8, 16),
	);
	const reasons = [
		...validateComponentGeometry(subject),
		...validateComponentGeometry(owner),
	];
	const executionBlockers: string[] = [];

	const blockExecution = (reason: string) => {
		if (mode === 'execution') reasons.push(reason);
		else executionBlockers.push(reason);
	};

	if (subject.locked) {
		blockExecution(`${subject.designator} 已锁定，不允许自动移动`);
	}
	if (subject.layer !== owner.layer) {
		blockExecution(
			`${subject.designator} 与 ${owner.designator} 不在同一器件层；可生成跨层参考预览，但自动执行仍按失败关闭策略拒绝`,
		);
	}
	if (subject.pads.some(pad => pad.connectedPrimitiveCount === undefined)) {
		blockExecution(
			`${subject.designator} 的已有布线状态无法确认，执行阶段按失败关闭策略拒绝移动`,
		);
	}
	else if (subject.pads.some(pad => (pad.connectedPrimitiveCount ?? 0) > 0)) {
		blockExecution(
			`${subject.designator} 已有布线/铜连接，当前只允许预览，不执行器件移动`,
		);
	}

	const subjectPowerPads = subject.pads.filter(pad => pad.net === powerNet);
	const subjectGroundPads = subject.pads.filter(pad => pad.net === groundNet);
	const ownerPowerPads = owner.pads.filter(pad => pad.net === powerNet);
	const ownerGroundPads = owner.pads.filter(pad => pad.net === groundNet);

	if (!subjectPowerPads.length) {
		reasons.push(`${subject.designator} 未找到电源网 ${powerNet} 的焊盘`);
	}
	if (!subjectGroundPads.length) {
		reasons.push(`${subject.designator} 未找到地网 ${groundNet} 的焊盘`);
	}
	if (!ownerPowerPads.length) {
		reasons.push(`${owner.designator} 未找到同一电源网 ${powerNet} 的焊盘`);
	}
	if (!ownerGroundPads.length) {
		reasons.push(`${owner.designator} 未找到地网 ${groundNet} 的焊盘`);
	}
	if (!Number.isFinite(clearanceMil) || clearanceMil <= 0) {
		reasons.push('布局安全间距必须为正数');
	}

	if (reasons.length) {
		return { ready: false, reasons, executionBlockers, alternatives: [] };
	}

	const subjectBox = componentBox(subject);
	const ownerBox = componentBox(owner);
	if (!subjectBox || !ownerBox) {
		return {
			ready: false,
			reasons: ['无法建立 subject / owner 的 EasyEDA 实测器件 BBox'],
			executionBlockers,
			alternatives: [],
		};
	}

	const invalidObstacle = obstacles.find(component =>
		component.id !== subject.id
		&& component.layer === subject.layer
		&& validateMeasuredBounds(component).length > 0
	);
	if (invalidObstacle) {
		return {
			ready: false,
			reasons: [
				`无法确认 ${invalidObstacle.designator} 的 EasyEDA 实测 BBox，不能证明候选位置无碰撞`,
			],
			executionBlockers,
			alternatives: [],
		};
	}

	const currentLoopProxy = bestCurrentLoopProxy({
		subjectPowerPads,
		subjectGroundPads,
		ownerPowerPads,
		ownerGroundPads,
	});
	if (currentLoopProxy === undefined) {
		return {
			ready: false,
			reasons: ['无法建立当前位置的去耦回路几何基线'],
			executionBlockers,
			alternatives: [],
		};
	}

	const baselineObjective = evaluatePlacementObjective({
		loopProxyMil: currentLoopProxy,
		movementMil: 0,
	});
	const keepCurrent: PhysicalPlacementAlternative = {
		kind: 'keep-current',
		cost: baselineObjective.totalCost,
		loopProxyMil: currentLoopProxy,
		movementMil: 0,
		target: { x: subject.x, y: subject.y },
		targetBounds: { ...subjectBox },
		clearanceMil,
	};

	const moveAlternatives: PhysicalPlacementAlternative[] = [];
	const rejectionCounts = new Map<PlacementTargetFailureCode, number>();
	const searchStepMil = localSearchStep(clearanceMil);
	const searchRadiusMil = localSearchRadius(
		subjectBox,
		ownerBox,
		clearanceMil,
	);
	const searchOffsets = buildLocalSearchOffsets(searchStepMil, searchRadiusMil);
	const recordRejection = (code?: PlacementTargetFailureCode) => {
		if (!code) return;
		rejectionCounts.set(code, (rejectionCounts.get(code) ?? 0) + 1);
	};

	for (const subjectPowerPad of subjectPowerPads) {
		for (const ownerPowerPad of ownerPowerPads) {
			for (const offset of searchOffsets) {
				const targetPowerPad = {
					x: ownerPowerPad.x + offset.x,
					y: ownerPowerPad.y + offset.y,
				};
				const subjectPowerOffset = {
					x: subjectPowerPad.x - subject.x,
					y: subjectPowerPad.y - subject.y,
				};
				const to = {
					x: targetPowerPad.x - subjectPowerOffset.x,
					y: targetPowerPad.y - subjectPowerOffset.y,
				};
				const dx = to.x - subject.x;
				const dy = to.y - subject.y;
				const targetValidation = validatePlacementTarget({
					subject,
					obstacles,
					board,
					componentKeepouts,
					target: to,
					clearanceMil,
				});
				if (!targetValidation.valid) {
					recordRejection(targetValidation.failureCode);
					continue;
				}

				const translatedGroundPads = subjectGroundPads.map(pad => ({
					pad,
					x: pad.x + dx,
					y: pad.y + dy,
				}));
				let bestGroundPair:
					| {
						subjectPad: PhysicalPadSnapshot;
						ownerPad: PhysicalPadSnapshot;
						distance: number;
					}
					| undefined;

				for (const subjectGroundPad of translatedGroundPads) {
					for (const ownerGroundPad of ownerGroundPads) {
						const distance = Math.hypot(
							subjectGroundPad.x - ownerGroundPad.x,
							subjectGroundPad.y - ownerGroundPad.y,
						);
						if (!bestGroundPair || distance < bestGroundPair.distance) {
							bestGroundPair = {
								subjectPad: subjectGroundPad.pad,
								ownerPad: ownerGroundPad,
								distance,
							};
						}
					}
				}
				if (!bestGroundPair) continue;

				const powerDistance = Math.hypot(offset.x, offset.y);
				const loopProxy = powerDistance + bestGroundPair.distance;
				const moveDistance = Math.hypot(dx, dy);
				const objective = evaluatePlacementObjective({
					loopProxyMil: loopProxy,
					movementMil: moveDistance,
				});
				if (!isStrictPlacementImprovement(baselineObjective, objective)) {
					continue;
				}

				const plan: PhysicalPlacementPlan = {
					subjectId: subject.id,
					subjectDesignator: subject.designator,
					ownerId: owner.id,
					ownerDesignator: owner.designator,
					powerNet,
					groundNet,
					ownerPowerPadNumber: ownerPowerPad.padNumber,
					subjectPowerPadNumber: subjectPowerPad.padNumber,
					ownerGroundPadNumber: bestGroundPair.ownerPad.padNumber,
					subjectGroundPadNumber: bestGroundPair.subjectPad.padNumber,
					currentLoopProxyMil: currentLoopProxy,
					estimatedLoopProxyMil: loopProxy,
					from: { x: subject.x, y: subject.y },
					to,
					clearanceMil,
					rationale:
						'当前位置作为正式 no-op 基线参与同一目标函数比较；仅保留严格优于当前状态的候选。候选通过板框、NO_COMPONENTS keepout 与 EasyEDA 实测器件 BBox 硬约束后，再按去耦回路几何代理与移动代价排序。',
				};
				moveAlternatives.push({
					kind: 'move',
					cost: objective.totalCost,
					loopProxyMil: loopProxy,
					movementMil: moveDistance,
					target: { ...to },
					targetBounds: translatedBox(subjectBox, dx, dy),
					clearanceMil,
					plan,
				});
			}
		}
	}

	moveAlternatives.sort((a, b) =>
		a.cost - b.cost
		|| a.target.x - b.target.x
		|| a.target.y - b.target.y
	);

	if (!moveAlternatives.length) {
		const rejectionSummary = [
			['器件 BBox 碰撞', rejectionCounts.get('collision') ?? 0],
			['板框 / 安全余量', rejectionCounts.get('board-boundary') ?? 0],
			['NO_COMPONENTS keepout', rejectionCounts.get('keepout') ?? 0],
			['障碍物几何无效', rejectionCounts.get('invalid-obstacle') ?? 0],
			['候选输入无效', rejectionCounts.get('invalid-input') ?? 0],
		]
			.filter(([, count]) => Number(count) > 0)
			.map(([label, count]) => `${label} ${count}`)
			.join('，');
		return {
			ready: true,
			reasons: rejectionSummary
				? [`没有新位置能够严格优于当前位置；候选拒绝统计：${rejectionSummary}。`]
				: ['当前位置在当前目标函数下优于或等于全部合法新位置。'],
			executionBlockers,
			alternatives: [keepCurrent],
		};
	}

	return {
		ready: true,
		reasons: [],
		executionBlockers,
		alternatives: [
			keepCurrent,
			...moveAlternatives.slice(0, maxMoveAlternatives),
		],
	};
}

export function planDecouplingPlacement(input: {
	subject: PhysicalComponentSnapshot;
	owner: PhysicalComponentSnapshot;
	obstacles: PhysicalComponentSnapshot[];
	board: BoardRegion;
	componentKeepouts: BoardPolygon[];
	powerNet: string;
	groundNet: string;
	clearanceMil?: number;
	mode?: 'preview' | 'execution';
}): PlacementReadiness {
	const result = enumerateDecouplingPlacementAlternatives(input);
	if (!result.ready) {
		return {
			ready: false,
			reasons: result.reasons,
			executionBlockers: result.executionBlockers,
		};
	}
	const move = result.alternatives.find(alternative =>
		alternative.kind === 'move' && alternative.plan
	);
	if (!move?.plan) {
		return {
			ready: false,
			reasons: result.reasons.length
				? result.reasons
				: [`${input.subject.designator} 当前位置已是当前目标函数下的最优状态，无需移动。`],
			executionBlockers: result.executionBlockers,
		};
	}
	return {
		ready: true,
		reasons: [],
		executionBlockers: result.executionBlockers,
		plan: move.plan,
	};
}
