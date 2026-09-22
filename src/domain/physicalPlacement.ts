import { boxInsideBoard, boxIntersectsPolygon, type BoardPolygon } from './boardBoundary';

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
		&& Math.abs(a.clearanceMil - b.clearanceMil) <= tolerance
		&& samePoint(a.from, b.from)
		&& samePoint(a.to, b.to);
}

export interface PlacementTargetValidation {
	valid: boolean;
	reasons: string[];
}

export interface PlacementReadiness {
	ready: boolean;
	reasons: string[];
	plan?: PhysicalPlacementPlan;
}

interface BBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const DEFAULT_CLEARANCE_MIL = 20;
const EPSILON = 1e-6;

function rotatedHalfExtents(
	width: number,
	height: number,
	rotation: number,
): { halfX: number; halfY: number } {
	const radians = rotation * Math.PI / 180;
	const cos = Math.abs(Math.cos(radians));
	const sin = Math.abs(Math.sin(radians));
	return {
		halfX: cos * width / 2 + sin * height / 2,
		halfY: sin * width / 2 + cos * height / 2,
	};
}

function padBox(pad: PhysicalPadSnapshot): BBox {
	const { halfX, halfY } = rotatedHalfExtents(
		pad.width,
		pad.height,
		pad.rotation,
	);
	return {
		minX: pad.x - halfX,
		minY: pad.y - halfY,
		maxX: pad.x + halfX,
		maxY: pad.y + halfY,
	};
}

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

function unitVector(x: number, y: number): PlacementPoint | undefined {
	const length = Math.hypot(x, y);
	if (length < EPSILON) {
		return undefined;
	}
	return {
		x: x / length,
		y: y / length,
	};
}

function candidateDirections(
	owner: PhysicalComponentSnapshot,
	ownerPad: PhysicalPadSnapshot,
): PlacementPoint[] {
	const outward = unitVector(
		ownerPad.x - owner.x,
		ownerPad.y - owner.y,
	);
	const base = outward
		? [
				outward,
				{ x: -outward.y, y: outward.x },
				{ x: outward.y, y: -outward.x },
				{ x: -outward.x, y: -outward.y },
			]
		: [
				{ x: 1, y: 0 },
				{ x: -1, y: 0 },
				{ x: 0, y: 1 },
				{ x: 0, y: -1 },
			];

	const seen = new Set<string>();
	return base.filter(direction => {
		const key = `${direction.x.toFixed(6)}:${direction.y.toFixed(6)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function supportDistance(
	pad: PhysicalPadSnapshot,
	direction: PlacementPoint,
): number {
	const { halfX, halfY } = rotatedHalfExtents(
		pad.width,
		pad.height,
		pad.rotation,
	);
	return Math.abs(direction.x) * halfX + Math.abs(direction.y) * halfY;
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
	board: BoardPolygon;
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
		return { valid: false, reasons };
	}

	const subjectBox = componentBox(subject);
	if (!subjectBox) {
		return {
			valid: false,
			reasons: [`${subject.designator} 无法建立实测器件 BBox`],
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
		};
	}
	if (!boxInsideBoard(translated, board)) {
		return {
			valid: false,
			reasons: ['目标位置超出可验证板框或安全余量越界'],
		};
	}
	if (componentKeepouts.some(keepout =>
		boxIntersectsPolygon(translated, keepout),
	)) {
		return {
			valid: false,
			reasons: ['目标位置与 NO_COMPONENTS keepout 冲突'],
		};
	}

	return { valid: true, reasons: [] };
}

export function planDecouplingPlacement(input: {
	subject: PhysicalComponentSnapshot;
	owner: PhysicalComponentSnapshot;
	obstacles: PhysicalComponentSnapshot[];
	board: BoardPolygon;
	componentKeepouts: BoardPolygon[];
	powerNet: string;
	groundNet: string;
	clearanceMil?: number;
}): PlacementReadiness {
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
	const reasons = [
		...validateComponentGeometry(subject),
		...validateComponentGeometry(owner),
	];

	if (subject.locked) {
		reasons.push(`${subject.designator} 已锁定，不允许自动移动`);
	}
	if (subject.layer !== owner.layer) {
		reasons.push(
			`${subject.designator} 与 ${owner.designator} 不在同一器件层`,
		);
	}
	if (subject.pads.some(pad => pad.connectedPrimitiveCount === undefined)) {
		reasons.push(
			`${subject.designator} 的已有布线状态无法确认，按失败关闭策略拒绝移动`,
		);
	}
	else if (subject.pads.some(pad => (pad.connectedPrimitiveCount ?? 0) > 0)) {
		reasons.push(
			`${subject.designator} 已有布线/铜连接，v0.7 不执行器件移动`,
		);
	}

	const subjectPowerPads = subject.pads.filter(pad => pad.net === powerNet);
	const subjectGroundPads = subject.pads.filter(pad => pad.net === groundNet);
	const ownerPowerPads = owner.pads.filter(pad => pad.net === powerNet);
	const ownerGroundPads = owner.pads.filter(pad => pad.net === groundNet);

	if (!subjectPowerPads.length) {
		reasons.push(
			`${subject.designator} 未找到电源网 ${powerNet} 的焊盘`,
		);
	}
	if (!subjectGroundPads.length) {
		reasons.push(
			`${subject.designator} 未找到地网 ${groundNet} 的焊盘`,
		);
	}
	if (!ownerPowerPads.length) {
		reasons.push(
			`${owner.designator} 未找到同一电源网 ${powerNet} 的焊盘`,
		);
	}
	if (!ownerGroundPads.length) {
		reasons.push(
			`${owner.designator} 未找到地网 ${groundNet} 的焊盘`,
		);
	}
	if (!Number.isFinite(clearanceMil) || clearanceMil <= 0) {
		reasons.push('布局安全间距必须为正数');
	}

	if (reasons.length) {
		return { ready: false, reasons };
	}

	const subjectBox = componentBox(subject);
	if (!subjectBox) {
		return {
			ready: false,
			reasons: [`${subject.designator} 无法建立 EasyEDA 实测器件 BBox`],
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
		};
	}

	const candidates: Array<{
		plan: PhysicalPlacementPlan;
		score: number;
	}> = [];

	for (const subjectPowerPad of subjectPowerPads) {
	for (const ownerPowerPad of ownerPowerPads) {
		for (const direction of candidateDirections(owner, ownerPowerPad)) {
			const centreDistance =
				supportDistance(ownerPowerPad, direction)
				+ supportDistance(subjectPowerPad, direction)
				+ clearanceMil;

			const targetPowerPad = {
				x: ownerPowerPad.x + direction.x * centreDistance,
				y: ownerPowerPad.y + direction.y * centreDistance,
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

			if (!bestGroundPair) {
				continue;
			}

			const powerDistance = Math.hypot(
				targetPowerPad.x - ownerPowerPad.x,
				targetPowerPad.y - ownerPowerPad.y,
			);
			const moveDistance = Math.hypot(dx, dy);
			const loopProxy = powerDistance + bestGroundPair.distance;
			const score = loopProxy + moveDistance * 0.05;

			candidates.push({
				score,
				plan: {
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
					estimatedLoopProxyMil: loopProxy,
					from: { x: subject.x, y: subject.y },
					to,
					clearanceMil,
					rationale:
						'以 owner 的同电源网焊盘为锚点生成合法候选，碰撞检查使用 EasyEDA 运行时实测器件 BBox；再用 power-pad 距离 + 最近 ground 返回距离作为去耦回路几何代理排序。该指标用于候选优选，不等同于 SI/PI 证明。',
				},
			});
		}
	}
	}

	if (candidates.length) {
		candidates.sort((a, b) => a.score - b.score);
		return {
			ready: true,
			reasons: [],
			plan: candidates[0].plan,
		};
	}

	return {
		ready: false,
		reasons: [
			`未找到同时满足板框、器件 keepout 与 ${clearanceMil} mil 近似器件避让条件的候选位置`,
		],
	};
}
