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

export interface SemanticEvidenceItem {
	id: string;
	label: string;
	source: 'component' | 'net' | 'peer' | 'ownership-relation';
}

export interface SemanticInference {
	status: 'inferred' | 'insufficient-evidence';
	role: SemanticRole;
	confidence: SemanticConfidence;
	evidenceRefs: string[];
	explanation: string;
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

function netOriginLabel(value: string): string {
	switch (value) {
		case 'generated':
			return '自动生成名称';
		case 'global':
			return '全局网络名称';
		default:
			return '显式名称';
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
			label:
				`网络 ${net.netName}（${netClassificationLabel(net.classification)}；`
				+ `${netOriginLabel(net.nameOrigin)}；fanout=${net.fanout}）`,
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

	items.push({
		id: `relation:${context.ownership.relation}`,
		label: `确定性归属关系：${context.ownership.relation}。 ${context.ownership.explanation}`,
		source: 'ownership-relation',
	});

	if (context.ownership.ownerDesignator) {
		items.push({
			id: `owner:${context.ownership.ownerDesignator}`,
			label: `确定性唯一 owner：${context.ownership.ownerDesignator}`,
			source: 'ownership-relation',
		});
	}

	for (const host of context.ownership.hostDesignators) {
		items.push({
			id: `host:${host}`,
			label: `归属关系 Host：${host}`,
			source: 'ownership-relation',
		});
	}

	for (const netName of context.ownership.sharedSignalNets) {
		items.push({
			id: `shared:${netName}`,
			label: `多 Host 共享信号：${netName}`,
			source: 'ownership-relation',
		});
	}

	for (const netName of context.ownership.railNets) {
		items.push({
			id: `rail:${netName}`,
			label: `电源域网络：${netName}`,
			source: 'ownership-relation',
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
	const allowedRoles = new Set(
		allowedSemanticRolesForPrefix(context.referencePrefix),
	);

	if (inference.status === 'insufficient-evidence' && inference.role !== 'unknown') {
		errors.push('证据不足时，role 必须为 unknown。');
	}

	if (inference.status === 'inferred' && inference.evidenceRefs.length === 0) {
		errors.push('语义推断必须引用至少一条确定性证据。');
	}

	if (!allowedRoles.has(inference.role)) {
		errors.push(
			`语义角色 ${inference.role} 与器件位号前缀 ${context.referencePrefix} 不兼容。`,
		);
	}

	for (const ref of inference.evidenceRefs) {
		if (!allowedEvidenceIds.has(ref)) {
			errors.push(`AI 引用了不存在的证据：${ref}`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
