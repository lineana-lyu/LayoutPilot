import type { CircuitGraph } from './circuitGraph';
import type { SemanticComponentContext } from './semanticContext';
import type { SemanticInference } from './semanticInference';

export type SemanticSnapshotEntryStatus =
	| 'valid'
	| 'blocked'
	| 'mock'
	| 'failed';

export interface SemanticSnapshotEntry {
	componentId: string;
	designator: string;
	context: SemanticComponentContext;
	status: SemanticSnapshotEntryStatus;
	inference?: SemanticInference;
	validationErrors: string[];
	provider?: string;
	model?: string;
	error?: string;
}

export interface SemanticSnapshot {
	schemaVersion: 1;
	id: string;
	boardFingerprint: string;
	createdAt: string;
	entries: SemanticSnapshotEntry[];
}

export interface SemanticBoardState {
	graph: CircuitGraph;
	contexts: SemanticComponentContext[];
}

let activeSnapshot: SemanticSnapshot | undefined;

function hashText(value: string): string {
	// FNV-1a 32-bit. This is an identity/staleness hash, not a security hash.
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function compareText(a: string, b: string): number {
	return a.localeCompare(b);
}

function canonicalBoardState(state: SemanticBoardState) {
	const nodes = state.graph.nodes
		.map(node => ({
			id: node.id,
			designator: node.designator,
			name: node.name ?? null,
			padCount: node.padCount,
		}))
		.sort((a, b) => compareText(a.id, b.id));

	const nets = state.graph.nets
		.map(net => ({
			name: net.name,
			endpoints: net.endpoints
				.map(endpoint => ({
					componentId: endpoint.componentId,
					designator: endpoint.designator,
					padNumber: endpoint.padNumber,
				}))
				.sort((a, b) =>
					compareText(a.componentId, b.componentId)
					|| compareText(a.padNumber, b.padNumber),
				),
		}))
		.sort((a, b) => compareText(a.name, b.name));

	const contexts = state.contexts
		.map(context => ({
			componentId: context.componentId,
			designator: context.designator,
			name: context.name ?? null,
			rawName: context.rawName ?? null,
			value: context.value ?? null,
			manufacturerPart: context.manufacturerPart ?? null,
			referencePrefix: context.referencePrefix,
			manufacturer: context.manufacturer ?? null,
			supplier: context.supplier ?? null,
			footprintName: context.footprintName ?? null,
			ownership: {
				relation: context.ownership.relation,
				ownerDesignator: context.ownership.ownerDesignator ?? null,
				hostDesignators: [...context.ownership.hostDesignators].sort(compareText),
				sharedSignalNets: [...context.ownership.sharedSignalNets].sort(compareText),
				railNets: [...context.ownership.railNets].sort(compareText),
			},
			connectedNets: context.connectedNets
				.map(net => ({
					netName: net.netName,
					classification: net.classification,
					electricalRole: net.electricalRole,
					nameOrigin: net.nameOrigin,
					fanout: net.fanout,
					selfPads: [...net.selfPads].sort(compareText),
					peerEndpoints: net.peerEndpoints
						.map(peer => ({ ...peer }))
						.sort((a, b) =>
							compareText(a.designator, b.designator)
							|| compareText(a.padNumber, b.padNumber),
						),
				}))
				.sort((a, b) => compareText(a.netName, b.netName)),
		}))
		.sort((a, b) => compareText(a.componentId, b.componentId));

	return { nodes, nets, contexts };
}

export function buildSemanticBoardFingerprint(
	state: SemanticBoardState,
): string {
	const canonical = JSON.stringify(canonicalBoardState(state));
	return `sem-v1-${hashText(canonical)}`;
}

function cloneSnapshotContext(
	context: SemanticComponentContext,
): SemanticComponentContext {
	return {
		...context,
		otherProperty: undefined,
		connectedNets: context.connectedNets.map(net => ({
			...net,
			selfPads: [...net.selfPads],
			peerEndpoints: net.peerEndpoints.map(peer => ({ ...peer })),
			coreDesignators: [...net.coreDesignators],
		})),
		relatedCoreDesignators: [...context.relatedCoreDesignators],
		ownership: {
			...context.ownership,
			hostDesignators: [...context.ownership.hostDesignators],
			sharedSignalNets: [...context.ownership.sharedSignalNets],
			railNets: [...context.ownership.railNets],
		},
		informativeSignalNets: [...context.informativeSignalNets],
		lowInformationNets: [...context.lowInformationNets],
		missingEvidence: [...context.missingEvidence],
	};
}

function freezeDeep<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
		return value;
	}

	for (const child of Object.values(value as Record<string, unknown>)) {
		freezeDeep(child);
	}

	return Object.freeze(value as object) as T;
}

export function createSemanticSnapshot(
	boardFingerprint: string,
	entries: SemanticSnapshotEntry[],
	createdAt = new Date().toISOString(),
): SemanticSnapshot {
	const entryIdentity = entries
		.map(entry => [
			entry.componentId,
			entry.status,
			entry.inference?.role ?? '',
			entry.inference?.confidence ?? '',
		].join(':'))
		.sort(compareText)
		.join('|');
	const suffix = hashText(`${boardFingerprint}|${createdAt}|${entryIdentity}`);

	const snapshot: SemanticSnapshot = {
		schemaVersion: 1,
		id: `semantic-${suffix}`,
		boardFingerprint,
		createdAt,
		entries: entries.map(entry => ({
			...entry,
			context: cloneSnapshotContext(entry.context),
			inference: entry.inference
				? {
					...entry.inference,
					evidenceRefs: [...entry.inference.evidenceRefs],
				}
				: undefined,
			validationErrors: [...entry.validationErrors],
		})),
	};

	return freezeDeep(snapshot);
}

export function setActiveSemanticSnapshot(snapshot: SemanticSnapshot): void {
	activeSnapshot = snapshot;
}

export function getActiveSemanticSnapshot(): SemanticSnapshot | undefined {
	return activeSnapshot;
}

export function clearActiveSemanticSnapshot(): void {
	activeSnapshot = undefined;
}

export function semanticSnapshotMatchesBoard(
	snapshot: SemanticSnapshot,
	boardFingerprint: string,
): boolean {
	return snapshot.boardFingerprint === boardFingerprint;
}
