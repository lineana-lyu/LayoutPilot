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
		case 'PERIPHERAL_PREFIX':
			return '位号前缀更像离散/交互外围器件，因此不作为核心器件候选';
		case 'BOUNDARY_PREFIX':
			return '位号前缀更像连接器/接口器件，优先视为边界器件候选';
		case 'ISOLATED':
			return '当前在电路关系图中没有与其他器件建立网络连接';
	}
}


import type { GroupEvidence } from '../domain/candidateGrouping';

export function groupEvidenceZh(evidence: GroupEvidence): string {
	switch (evidence.code) {
		case 'CORE_SELECTED':
			return `${evidence.component ?? '该器件'} 被选为候选核心器件`;
		case 'PERIPHERAL_SINGLE_CORE_NEIGHBOR':
			return `${evidence.component ?? '该器件'} 属于外围器件候选，且只通过有效信号关系关联到核心器件 ${evidence.core ?? ''}，因此归入该候选功能块`;
		case 'BOUNDARY_KEPT_SEPARATE':
			return `${evidence.component ?? '该器件'} 更像接口/连接器，暂不并入核心模块`;
		case 'ISOLATED_UNGROUPED':
			return `${evidence.component ?? '该器件'} 当前没有网络连接，暂不归组`;
		case 'ONLY_LOW_INFORMATION_NETS':
			return `${evidence.component ?? '该器件'} 目前只通过全局电源/地等低信息网络关联到核心器件（${(evidence.cores ?? []).join('、') || '未知'}），暂不强行归组`;
		case 'MULTIPLE_CORE_CANDIDATES':
			return `${evidence.component ?? '该器件'} 同时与多个核心器件存在有效结构关联（${(evidence.cores ?? []).join('、') || '未知'}），归属存在歧义`;
	}
}


import type { NetGroupingClass } from '../domain/netInformativeness';

export function netGroupingClassZh(value: NetGroupingClass): string {
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

export function semanticMissingEvidenceZh(code: string): string {
	switch (code) {
		case 'component-name':
			return '器件名称/数值';
		case 'footprint':
			return '封装信息';
		case 'manufacturer':
			return '制造商';
		case 'value-or-extra-properties':
			return '器件值或扩展属性';
		case 'informative-signal-net':
			return '缺少可用于功能判断的明确控制/信号网络';
		case 'direct-core-relation':
			return '缺少直接核心器件关联';
		default:
			return code;
	}
}
