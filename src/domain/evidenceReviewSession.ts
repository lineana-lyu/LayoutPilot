import type { SharedRailPadEvidence } from './physicalEvidence';

export interface EvidenceReviewSession {
	schemaVersion: 1;
	snapshotId: string;
	boardFingerprint: string;
	subjectId: string;
	subjectDesignator: string;
	ownerId: string;
	ownerDesignator: string;
	railLabel: string;
	powerEvidence?: Readonly<SharedRailPadEvidence>;
	documentTabId: string;
	originalSelectionIds: readonly string[];
	createdAt: string;
}

export function createEvidenceReviewSession(
	input: Omit<EvidenceReviewSession, 'schemaVersion' | 'createdAt'>,
	createdAt = new Date().toISOString(),
): EvidenceReviewSession {
	return Object.freeze({
		schemaVersion: 1 as const,
		...input,
		originalSelectionIds: Object.freeze([...input.originalSelectionIds]),
		powerEvidence: input.powerEvidence
			? Object.freeze({ ...input.powerEvidence })
			: undefined,
		createdAt,
	});
}

export function isEvidenceReviewSession(
	value: unknown,
): value is EvidenceReviewSession {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const item = value as Record<string, unknown>;
	const evidence = item.powerEvidence;
	const evidenceValid = evidence === undefined
		|| (
			Boolean(evidence)
			&& typeof evidence === 'object'
			&& !Array.isArray(evidence)
			&& typeof (evidence as Record<string, unknown>).netName === 'string'
			&& typeof (evidence as Record<string, unknown>).subjectPadNumber === 'string'
			&& typeof (evidence as Record<string, unknown>).ownerPadNumber === 'string'
			&& typeof (evidence as Record<string, unknown>).subjectX === 'number'
			&& typeof (evidence as Record<string, unknown>).subjectY === 'number'
			&& typeof (evidence as Record<string, unknown>).ownerX === 'number'
			&& typeof (evidence as Record<string, unknown>).ownerY === 'number'
			&& typeof (evidence as Record<string, unknown>).distanceMil === 'number'
			&& Number.isFinite((evidence as Record<string, number>).distanceMil)
		);

	return item.schemaVersion === 1
		&& typeof item.snapshotId === 'string'
		&& typeof item.boardFingerprint === 'string'
		&& typeof item.subjectId === 'string'
		&& typeof item.subjectDesignator === 'string'
		&& typeof item.ownerId === 'string'
		&& typeof item.ownerDesignator === 'string'
		&& typeof item.railLabel === 'string'
		&& typeof item.documentTabId === 'string'
		&& Array.isArray(item.originalSelectionIds)
		&& item.originalSelectionIds.every(id => typeof id === 'string')
		&& typeof item.createdAt === 'string'
		&& evidenceValid;
}
