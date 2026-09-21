import type { SemanticComponentContext } from './semanticContext';

export type SemanticRole =
	| 'decoupling-capacitor'
	| 'bulk-capacitor'
	| 'filter-capacitor'
	| 'power-path-inductor'
	| 'power-switch'
	| 'protection-device'
	| 'reset-network'
	| 'timing-device'
	| 'connector-interface'
	| 'other'
	| 'unknown';

export type SemanticConfidence = 'low' | 'medium' | 'high';

export type LayoutConstraintType =
	| 'near'
	| 'group-with'
	| 'keep-short'
	| 'edge'
	| 'keepout'
	| 'no-constraint';

export interface SemanticEvidenceItem {
	id: string;
	label: string;
	source: 'component' | 'net' | 'peer' | 'core-relation';
}

export interface SemanticInference {
	status: 'inferred' | 'insufficient-evidence';
	role: SemanticRole;
	associatedCore?: string;
	confidence: SemanticConfidence;
	evidenceRefs: string[];
	explanation: string;
	constraints: Array<{
		type: LayoutConstraintType;
		target?: string;
		evidenceRefs: string[];
	}>;
}

export interface SemanticInferenceValidation {
	valid: boolean;
	errors: string[];
}

export function allowedSemanticRolesForPrefix(prefix: string): SemanticRole[] {
	const normalized = prefix.trim().toUpperCase();

	if (normalized === 'C') {
		return [
			'decoupling-capacitor',
			'bulk-capacitor',
			'filter-capacitor',
			'other',
			'unknown',
		];
	}

	if (normalized === 'L' || normalized === 'FB') {
		return [
			'power-path-inductor',
			'other',
			'unknown',
		];
	}

	if (normalized === 'Q') {
		return [
			'power-switch',
			'protection-device',
			'other',
			'unknown',
		];
	}

	if (normalized === 'D') {
		return [
			'protection-device',
			'other',
			'unknown',
		];
	}

	if (normalized === 'SW') {
		return [
			'reset-network',
			'other',
			'unknown',
		];
	}

	if (normalized === 'X' || normalized === 'Y') {
		return [
			'timing-device',
			'other',
			'unknown',
		];
	}

	if (['J', 'P', 'CN', 'H'].includes(normalized)) {
		return [
			'connector-interface',
			'other',
			'unknown',
		];
	}

	return [
		'reset-network',
		'power-switch',
		'protection-device',
		'other',
		'unknown',
	];
}

function netClassificationLabel(value: string): string {
	switch (value) {
		case 'global-ground':
			return '全局地';
		case 'global-power':
			return '全局电源';
		case 'named-signal':
			return '明确命名信号';
		case 'high-fanout':
			return '高扇出网络';
		default:
			return '局部网络';
	}
}

export function buildSemanticEvidenceCatalog(
	context: SemanticComponentContext,
): SemanticEvidenceItem[] {
	const items: SemanticEvidenceItem[] = [];

	if (context.name) {
		items.push({
			id: 'component:name',
			label: `器件名称：${context.name}`,
			source: 'component',
		});
	}
	if (context.value) {
		items.push({
			id: 'component:value',
			label: `器件值：${context.value}`,
			source: 'component',
		});
	}
	if (context.manufacturerPart) {
		items.push({
			id: 'component:manufacturer-part',
			label: `制造商型号：${context.manufacturerPart}`,
			source: 'component',
		});
	}
	if (context.footprintName) {
		items.push({
			id: 'component:footprint',
			label: `封装：${context.footprintName}`,
			source: 'component',
		});
	}

	for (const net of context.connectedNets) {
		items.push({
			id: `net:${net.netName}`,
			label: `网络 ${net.netName}（${netClassificationLabel(net.classification)}）`,
			source: 'net',
		});

		for (const peer of net.peerEndpoints) {
			items.push({
				id: `peer:${net.netName}:${peer.designator}.${peer.padNumber}`,
				label: `${net.netName} 上关联 ${peer.designator}.${peer.padNumber}`,
				source: 'peer',
			});
		}
	}

	for (const core of context.relatedCoreDesignators) {
		items.push({
			id: `core:${core}`,
			label: `可能相关核心器件：${core}`,
			source: 'core-relation',
		});
	}

	return items;
}

export function validateSemanticInference(
	context: SemanticComponentContext,
	inference: SemanticInference,
): SemanticInferenceValidation {
	const errors: string[] = [];
	const catalog = buildSemanticEvidenceCatalog(context);
	const allowedEvidenceIds = new Set(catalog.map(item => item.id));
	const allowedCores = new Set(context.relatedCoreDesignators);
	const allowedConstraintTargets = new Set([
		...context.relatedCoreDesignators,
		...context.connectedNets.map(net => net.netName),
	]);
	const allowedRoles = new Set(
		allowedSemanticRolesForPrefix(context.referencePrefix),
	);

	if (inference.status === 'insufficient-evidence') {
		if (inference.role !== 'unknown') {
			errors.push('证据不足时，role 必须为 unknown。');
		}
		if (inference.constraints.some(item => item.type !== 'no-constraint')) {
			errors.push('证据不足时，不允许输出主动布局约束。');
		}
	}

	if (inference.status === 'inferred' && inference.evidenceRefs.length === 0) {
		errors.push('语义推断必须引用至少一条确定性证据。');
	}

	if (!allowedRoles.has(inference.role)) {
		errors.push(
			`语义角色 ${inference.role} 与器件位号前缀 ${context.referencePrefix} 不兼容。`,
		);
	}

	if (
		inference.associatedCore
		&& !allowedCores.has(inference.associatedCore)
	) {
		errors.push(`关联核心 ${inference.associatedCore} 不存在于规则层提供的候选核心中。`);
	}

	const allEvidenceRefs = [
		...inference.evidenceRefs,
		...inference.constraints.flatMap(item => item.evidenceRefs),
	];

	for (const ref of allEvidenceRefs) {
		if (!allowedEvidenceIds.has(ref)) {
			errors.push(`AI 引用了不存在的证据：${ref}`);
		}
	}

	for (const constraint of inference.constraints) {
		if (constraint.type === 'no-constraint' && constraint.target) {
			errors.push('no-constraint 不应包含 target。');
		}
		if (constraint.type !== 'no-constraint' && constraint.evidenceRefs.length === 0) {
			errors.push(`布局约束 ${constraint.type} 必须引用证据。`);
		}
		if (
			constraint.target
			&& !allowedConstraintTargets.has(constraint.target)
		) {
			errors.push(
				`布局约束目标 ${constraint.target} 不存在于当前器件的候选核心或已连接网络中。`,
			);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
