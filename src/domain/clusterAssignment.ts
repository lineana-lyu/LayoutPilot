export interface ClusterBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface ClusterPlacementOption<T> {
	id: string;
	subjectId: string;
	cost: number;
	bounds: ClusterBounds;
	clearanceMil: number;
	keepsCurrent: boolean;
	payload: T;
}

export interface ClusterPlacementMember<T> {
	subjectId: string;
	options: ClusterPlacementOption<T>[];
}

export interface ClusterAssignmentResult<T> {
	complete: boolean;
	assignments: ClusterPlacementOption<T>[];
	totalCost?: number;
	statesVisited: number;
	reason?: string;
}

const DEFAULT_MAX_STATES = 50_000;
const EPSILON = 1e-9;

function expandBounds(bounds: ClusterBounds, margin: number): ClusterBounds {
	return {
		minX: bounds.minX - margin,
		minY: bounds.minY - margin,
		maxX: bounds.maxX + margin,
		maxY: bounds.maxY + margin,
	};
}

function boundsOverlap(a: ClusterBounds, b: ClusterBounds): boolean {
	return !(
		a.maxX <= b.minX
		|| a.minX >= b.maxX
		|| a.maxY <= b.minY
		|| a.minY >= b.maxY
	);
}

export function clusterOptionsConflict<T>(
	a: ClusterPlacementOption<T>,
	b: ClusterPlacementOption<T>,
): boolean {
	if (a.subjectId === b.subjectId) return false;
	// Two no-op choices preserve an already existing board state. Clearance
	// gates apply when at least one component is actually being relocated.
	if (a.keepsCurrent && b.keepsCurrent) return false;
	const clearance = Math.max(a.clearanceMil, b.clearanceMil);
	return boundsOverlap(expandBounds(a.bounds, clearance), b.bounds)
		|| boundsOverlap(expandBounds(b.bounds, clearance), a.bounds);
}

export function solveClusterAssignment<T>(input: {
	members: ClusterPlacementMember<T>[];
	maxStates?: number;
}): ClusterAssignmentResult<T> {
	const maxStates = input.maxStates ?? DEFAULT_MAX_STATES;
	if (!Number.isInteger(maxStates) || maxStates <= 0) {
		throw new Error('Cluster search state budget 必须为正整数。');
	}

	const members = input.members.map(member => ({
		subjectId: member.subjectId,
		options: [...member.options].sort((a, b) =>
			a.cost - b.cost || a.id.localeCompare(b.id)
		),
	}));

	if (members.some(member => member.options.length === 0)) {
		return {
			complete: false,
			assignments: [],
			statesVisited: 0,
			reason: 'Cluster 中至少一个器件没有可选布局状态。',
		};
	}

	// Search the most constrained members first. This changes only search order,
	// never the objective or result, and avoids designator-driven placement.
	members.sort((a, b) =>
		a.options.length - b.options.length
		|| a.subjectId.localeCompare(b.subjectId)
	);

	const suffixLowerBound = new Array<number>(members.length + 1).fill(0);
	for (let index = members.length - 1; index >= 0; index -= 1) {
		suffixLowerBound[index] = suffixLowerBound[index + 1]
		+ members[index].options[0].cost;
	}

	let statesVisited = 0;
	let exhausted = false;
	let bestCost = Number.POSITIVE_INFINITY;
	let best: ClusterPlacementOption<T>[] | undefined;
	const chosen: ClusterPlacementOption<T>[] = [];

	const visit = (index: number, cost: number): void => {
		if (exhausted) return;
		statesVisited += 1;
		if (statesVisited > maxStates) {
			exhausted = true;
			return;
		}
		if (cost + suffixLowerBound[index] >= bestCost - EPSILON) return;
		if (index >= members.length) {
			bestCost = cost;
			best = [...chosen];
			return;
		}

		for (const option of members[index].options) {
			if (chosen.some(existing => clusterOptionsConflict(existing, option))) {
				continue;
			}
			chosen.push(option);
			visit(index + 1, cost + option.cost);
			chosen.pop();
			if (exhausted) return;
		}
	};

	visit(0, 0);

	if (exhausted) {
		return {
			complete: false,
			assignments: [],
			statesVisited,
			reason: `Cluster 联合规划超过确定性搜索预算（${maxStates} states），已失败关闭而不是退化为顺序贪心。`,
		};
	}
	if (!best) {
		return {
			complete: false,
			assignments: [],
			statesVisited,
			reason: 'Cluster 中不存在能够同时满足器件间距的联合布局组合。',
		};
	}

	return {
		complete: true,
		assignments: best,
		totalCost: bestCost,
		statesVisited,
	};
}
