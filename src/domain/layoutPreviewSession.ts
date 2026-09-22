export interface LayoutPreviewSession {
	schemaVersion: 1;
	planId: string;
	documentTabId: string;
	createdAt: string;
}

export function createLayoutPreviewSession(input: {
	planId: string;
	documentTabId: string;
	createdAt?: string;
}): LayoutPreviewSession {
	return Object.freeze({
		schemaVersion: 1 as const,
		planId: input.planId,
		documentTabId: input.documentTabId,
		createdAt: input.createdAt ?? new Date().toISOString(),
	});
}

export function isLayoutPreviewSession(
	value: unknown,
): value is LayoutPreviewSession {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const item = value as Record<string, unknown>;
	return item.schemaVersion === 1
		&& typeof item.planId === 'string'
		&& typeof item.documentTabId === 'string'
		&& typeof item.createdAt === 'string';
}
