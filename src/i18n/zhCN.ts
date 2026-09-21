import type { StructuralEvidence, StructuralFeature } from '../domain/componentFeatures';

export function coreLevelZh(level: StructuralFeature['coreLevel']): string {
	switch (level) {
		case 'high':
			return '高';
		case 'medium':
			return '中';
		default:
			return '低';
	}
}

export function yesNoZh(value: boolean): string {
	return value ? '是' : '否';
}

export function lockedZh(value: boolean): string {
	return value ? '已锁定' : '未锁定';
}

export function structuralEvidenceZh(evidence: StructuralEvidence): string {
	switch (evidence.code) {
		case 'IC_PREFIX':
			return '位号前缀为 U，通常表示 IC 类器件';
		case 'HIGH_PAD_COUNT':
			return `焊盘数量较多（${evidence.value ?? 0} 个）`;
		case 'MULTI_PAD':
			return `属于多焊盘器件（${evidence.value ?? 0} 个焊盘）`;
		case 'HIGH_DEGREE':
			return `与 ${evidence.value ?? 0} 个其他器件直接相连`;
		case 'LOW_DEGREE':
			return `与 ${evidence.value ?? 0} 个其他器件相连`;
		case 'HIGH_NET_COUNT':
			return `参与 ${evidence.value ?? 0} 个已命名网络`;
		case 'LOW_NET_COUNT':
			return `参与 ${evidence.value ?? 0} 个已命名网络`;
		case 'PASSIVE_PREFIX':
			return '位号前缀属于常见无源器件类型，因此降低“核心器件”候选权重';
		case 'BOUNDARY_PREFIX':
			return '位号前缀更像连接器/接口器件，优先视为边界器件候选';
		case 'ISOLATED':
			return '当前在电路关系图中没有与其他器件建立网络连接';
	}
}
