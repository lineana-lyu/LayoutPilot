import assert from 'node:assert/strict';

import { buildCircuitGraph, type CircuitComponentSnapshot } from '../src/domain/circuitGraph';
import type { SemanticComponentContext } from '../src/domain/semanticContext';
import {
	buildSemanticBoardFingerprint,
	clearActiveSemanticSnapshot,
	createSemanticSnapshot,
	getActiveSemanticSnapshot,
	semanticSnapshotMatchesBoard,
	setActiveSemanticSnapshot,
} from '../src/domain/semanticSnapshot';

function graphFixture(order: 'normal' | 'reversed' = 'normal') {
	const components: CircuitComponentSnapshot[] = [
		{
			id: 'u1',
			designator: 'U1',
			padCount: 8,
			pads: [{ padNumber: '1', net: 'SIG' }],
		},
		{
			id: 'r1',
			designator: 'R1',
			padCount: 2,
			pads: [{ padNumber: '2', net: 'SIG' }],
		},
	];

	return buildCircuitGraph(order === 'normal' ? components : [...components].reverse());
}

function contextFixture(netName = 'SIG'): SemanticComponentContext {
	return {
		componentId: 'r1',
		designator: 'R1',
		name: '10k',
		referencePrefix: 'R',
		structuralRole: 'ambiguous',
		connectedNets: [
			{
				netName,
				classification: 'named-signal',
				electricalRole: 'signal',
				nameOrigin: 'explicit',
				fanout: 2,
				groupingWeight: 1,
				selfPads: ['2'],
				peerEndpoints: [{ designator: 'U1', padNumber: '1' }],
				coreDesignators: ['U1'],
			},
		],
		relatedCoreDesignators: ['U1'],
		ownership: {
			relation: 'single-core',
			ownerDesignator: 'U1',
			hostDesignators: ['U1'],
			sharedSignalNets: [],
			railNets: [],
			explanation: 'fixture',
		},
		informativeSignalNets: [netName],
		lowInformationNets: [],
		missingEvidence: [],
	};
}

{
	const a = buildSemanticBoardFingerprint({
		graph: graphFixture('normal'),
		contexts: [contextFixture()],
	});
	const b = buildSemanticBoardFingerprint({
		graph: graphFixture('reversed'),
		contexts: [contextFixture()],
	});

	assert.equal(a, b, 'fingerprint must not depend on enumeration order');
}

{
	const base = buildSemanticBoardFingerprint({
		graph: graphFixture(),
		contexts: [contextFixture()],
	});
	const changed = buildSemanticBoardFingerprint({
		graph: graphFixture(),
		contexts: [contextFixture('SIG_CHANGED')],
	});

	assert.notEqual(base, changed, 'semantic input changes must invalidate the fingerprint');
}

{
	clearActiveSemanticSnapshot();
	assert.equal(getActiveSemanticSnapshot(), undefined);

	const fingerprint = buildSemanticBoardFingerprint({
		graph: graphFixture(),
		contexts: [contextFixture()],
	});
	const snapshot = createSemanticSnapshot(
		fingerprint,
		[
			{
				componentId: 'r1',
				designator: 'R1',
				context: contextFixture(),
				status: 'valid',
				inference: {
					status: 'inferred',
					role: 'other',
					confidence: 'medium',
					evidenceRefs: ['component:name'],
					explanation: 'fixture',
				},
				validationErrors: [],
				provider: 'fixture',
				model: 'fixture-model',
			},
		],
		'2026-09-21T12:00:00.000Z',
	);

	setActiveSemanticSnapshot(snapshot);
	assert.equal(getActiveSemanticSnapshot()?.id, snapshot.id);
	assert.equal(semanticSnapshotMatchesBoard(snapshot, fingerprint), true);
	assert.equal(semanticSnapshotMatchesBoard(snapshot, 'sem-v1-stale'), false);
	assert.doesNotThrow(() => JSON.stringify(snapshot), 'snapshot must stay serializable');
}

console.log('Semantic snapshot tests passed.');
