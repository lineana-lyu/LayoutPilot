import type { SemanticComponentContext } from '../domain/semanticContext';
import type {
	SemanticEvidenceItem,
	SemanticInference,
} from '../domain/semanticInference';

export interface SemanticGatewayRequest {
	version: '1';
	context: SemanticComponentContext;
	evidenceCatalog: SemanticEvidenceItem[];
	allowedRoles: SemanticInference['role'][];
	allowedConstraintTargets: string[];
	validationFeedback?: string[];
}

export interface SemanticGatewayResponse {
	inference: SemanticInference;
	provider?: string;
	model?: string;
}

const SEMANTIC_ROLES = new Set([
	'decoupling-capacitor',
	'bulk-capacitor',
	'filter-capacitor',
	'power-path-inductor',
	'power-switch',
	'protection-device',
	'reset-network',
	'timing-device',
	'connector-interface',
	'other',
	'unknown',
]);

const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const STATUSES = new Set(['inferred', 'insufficient-evidence']);
const CONSTRAINT_TYPES = new Set([
	'near',
	'group-with',
	'keep-short',
	'edge',
	'keepout',
	'no-constraint',
]);

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function parseSemanticGatewayResponse(value: unknown): SemanticGatewayResponse {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('AI Gateway 返回值不是对象。');
	}

	const response = value as Record<string, unknown>;
	const rawInference = response.inference;

	if (!rawInference || typeof rawInference !== 'object' || Array.isArray(rawInference)) {
		throw new Error('AI Gateway 缺少 inference 对象。');
	}

	const inference = rawInference as Record<string, unknown>;

	if (!STATUSES.has(String(inference.status))) {
		throw new Error('AI Gateway 返回了无效的 status。');
	}
	if (!SEMANTIC_ROLES.has(String(inference.role))) {
		throw new Error('AI Gateway 返回了无效的 role。');
	}
	if (!CONFIDENCE_LEVELS.has(String(inference.confidence))) {
		throw new Error('AI Gateway 返回了无效的 confidence。');
	}
	if (!isStringArray(inference.evidenceRefs)) {
		throw new Error('AI Gateway 的 evidenceRefs 必须是字符串数组。');
	}
	if (typeof inference.explanation !== 'string') {
		throw new Error('AI Gateway 缺少 explanation。');
	}
	if (
		inference.associatedCore !== undefined
		&& typeof inference.associatedCore !== 'string'
	) {
		throw new Error('AI Gateway 的 associatedCore 格式错误。');
	}
	if (!Array.isArray(inference.constraints)) {
		throw new Error('AI Gateway 的 constraints 必须是数组。');
	}

	const constraints = inference.constraints.map((rawConstraint) => {
		if (
			!rawConstraint
			|| typeof rawConstraint !== 'object'
			|| Array.isArray(rawConstraint)
		) {
			throw new Error('AI Gateway 包含格式错误的布局约束。');
		}

		const constraint = rawConstraint as Record<string, unknown>;
		if (!CONSTRAINT_TYPES.has(String(constraint.type))) {
			throw new Error('AI Gateway 返回了未知布局约束类型。');
		}
		if (!isStringArray(constraint.evidenceRefs)) {
			throw new Error('AI Gateway 布局约束缺少 evidenceRefs。');
		}
		if (
			constraint.target !== undefined
			&& typeof constraint.target !== 'string'
		) {
			throw new Error('AI Gateway 布局约束 target 格式错误。');
		}

		return {
			type: constraint.type as SemanticInference['constraints'][number]['type'],
			target: constraint.target as string | undefined,
			evidenceRefs: constraint.evidenceRefs,
		};
	});

	return {
		inference: {
			status: inference.status as SemanticInference['status'],
			role: inference.role as SemanticInference['role'],
			associatedCore: inference.associatedCore as string | undefined,
			confidence: inference.confidence as SemanticInference['confidence'],
			evidenceRefs: inference.evidenceRefs,
			explanation: inference.explanation,
			constraints,
		},
		provider: typeof response.provider === 'string' ? response.provider : undefined,
		model: typeof response.model === 'string' ? response.model : undefined,
	};
}

export function normalizeGatewayBaseUrl(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, '');
	if (!/^https?:\/\//i.test(trimmed)) {
		throw new Error('Gateway 地址必须以 http:// 或 https:// 开头。');
	}
	return trimmed;
}

export function buildSemanticGatewayRequest(
	context: SemanticComponentContext,
	evidenceCatalog: SemanticEvidenceItem[],
	allowedRoles: SemanticInference['role'][],
	validationFeedback?: string[],
): SemanticGatewayRequest {
	return {
		version: '1',
		context,
		evidenceCatalog,
		allowedRoles,
		allowedConstraintTargets: [
			...context.relatedCoreDesignators,
			...context.connectedNets.map(net => net.netName),
		],
		validationFeedback,
	};
}
