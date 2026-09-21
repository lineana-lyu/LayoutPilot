import type { PlacementPoint } from './physicalPlacement';

export interface PlacementCommandRecord {
	id: string;
	snapshotId: string;
	constraintId: string;
	componentId: string;
	componentDesignator: string;
	from: PlacementPoint;
	to: PlacementPoint;
	createdAt: string;
	verifiedAt?: string;
	status: 'planned' | 'applied' | 'undone' | 'superseded';
}

let lastCommand: PlacementCommandRecord | undefined;

function hashText(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createPlacementCommand(input: {
	snapshotId: string;
	constraintId: string;
	componentId: string;
	componentDesignator: string;
	from: PlacementPoint;
	to: PlacementPoint;
	createdAt?: string;
}): PlacementCommandRecord {
	const createdAt = input.createdAt ?? new Date().toISOString();
	const id = `placement-${hashText([
		input.snapshotId,
		input.constraintId,
		input.componentId,
		input.from.x,
		input.from.y,
		input.to.x,
		input.to.y,
		createdAt,
	].join('|'))}`;

	return Object.freeze({
		id,
		snapshotId: input.snapshotId,
		constraintId: input.constraintId,
		componentId: input.componentId,
		componentDesignator: input.componentDesignator,
		from: Object.freeze({ ...input.from }),
		to: Object.freeze({ ...input.to }),
		createdAt,
		status: 'planned' as const,
	});
}

export function markPlacementCommandApplied(
	command: PlacementCommandRecord,
	verifiedAt = new Date().toISOString(),
): PlacementCommandRecord {
	return Object.freeze({
		...command,
		status: 'applied' as const,
		verifiedAt,
	});
}

export function markPlacementCommandUndone(
	command: PlacementCommandRecord,
): PlacementCommandRecord {
	return Object.freeze({
		...command,
		status: 'undone' as const,
	});
}

export function markPlacementCommandSuperseded(
	command: PlacementCommandRecord,
): PlacementCommandRecord {
	return Object.freeze({
		...command,
		status: 'superseded' as const,
	});
}

export function setLastPlacementCommand(
	command: PlacementCommandRecord | undefined,
): void {
	lastCommand = command;
}

export function getLastPlacementCommand(): PlacementCommandRecord | undefined {
	return lastCommand;
}
