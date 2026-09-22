import assert from 'node:assert/strict';

import {
	clearWorkflowSemanticSnapshot,
	createEmptyWorkflowState,
	normalizeWorkflowState,
	removeWorkflowHumanDecision,
	replaceWorkflowSemanticSnapshot,
	setWorkflowPlacementCommand,
	upsertWorkflowHumanDecision,
} from '../src/application/workflowState';
import { createHumanOwnershipDecision } from '../src/domain/humanOwnershipDecision';
import { createPlacementCommand } from '../src/domain/placementCommand';
import { createSemanticSnapshot } from '../src/domain/semanticSnapshot';

const t0 = '2026-09-22T01:00:00.000Z';
const snapshotA = createSemanticSnapshot('sem-v1-board-a', [], t0);
const snapshotB = createSemanticSnapshot(
	'sem-v1-board-b',
	[],
	'2026-09-22T01:01:00.000Z',
);

let state = createEmptyWorkflowState(t0);
assert.equal(state.semanticSnapshot, undefined);
assert.deepEqual(state.humanOwnershipDecisions, []);

state = replaceWorkflowSemanticSnapshot(state, snapshotA, t0);
assert.equal(state.semanticSnapshot?.id, snapshotA.id);

const decisionA = createHumanOwnershipDecision(
	{
		snapshotId: snapshotA.id,
		componentId: 'c14',
		componentDesignator: 'C14',
		ownerComponentId: 'u6',
		ownerDesignator: 'U6',
	},
	'2026-09-22T01:02:00.000Z',
);
state = upsertWorkflowHumanDecision(
	state,
	decisionA,
	'2026-09-22T01:02:00.000Z',
);
assert.equal(state.humanOwnershipDecisions.length, 1);
assert.equal(state.humanOwnershipDecisions[0].ownerDesignator, 'U6');

const replacement = createHumanOwnershipDecision(
	{
		snapshotId: snapshotA.id,
		componentId: 'c14',
		componentDesignator: 'C14',
		ownerComponentId: 'u8',
		ownerDesignator: 'U8',
	},
	'2026-09-22T01:03:00.000Z',
);
state = upsertWorkflowHumanDecision(
	state,
	replacement,
	'2026-09-22T01:03:00.000Z',
);
assert.equal(state.humanOwnershipDecisions.length, 1);
assert.equal(state.humanOwnershipDecisions[0].ownerDesignator, 'U8');

const command = createPlacementCommand({
	snapshotId: snapshotA.id,
	boardFingerprint: snapshotA.boardFingerprint,
	constraintId: 'C14:near:U8',
	componentId: 'c14',
	componentDesignator: 'C14',
	from: { x: 100, y: 200 },
	to: { x: 120, y: 220 },
	createdAt: '2026-09-22T01:04:00.000Z',
});
state = setWorkflowPlacementCommand(
	state,
	command,
	'2026-09-22T01:04:00.000Z',
);
assert.equal(state.lastPlacementCommand?.boardFingerprint, 'sem-v1-board-a');

const roundTrip = normalizeWorkflowState(
	JSON.parse(JSON.stringify(state)),
	'2026-09-22T01:05:00.000Z',
);
assert.equal(roundTrip.semanticSnapshot?.id, snapshotA.id);
assert.equal(roundTrip.humanOwnershipDecisions[0].ownerDesignator, 'U8');
assert.equal(roundTrip.lastPlacementCommand?.id, command.id);
assert.equal(Object.isFrozen(roundTrip), true);
assert.equal(Object.isFrozen(roundTrip.semanticSnapshot), true);

state = removeWorkflowHumanDecision(
	state,
	snapshotA.id,
	'c14',
	'2026-09-22T01:06:00.000Z',
);
assert.equal(state.humanOwnershipDecisions.length, 0);

state = upsertWorkflowHumanDecision(
	state,
	decisionA,
	'2026-09-22T01:07:00.000Z',
);
state = replaceWorkflowSemanticSnapshot(
	state,
	snapshotB,
	'2026-09-22T01:08:00.000Z',
);
assert.equal(state.semanticSnapshot?.id, snapshotB.id);
assert.equal(
	state.humanOwnershipDecisions.length,
	0,
	'new Semantic Snapshot must retire old human decisions',
);
assert.equal(
	state.lastPlacementCommand?.id,
	command.id,
	'physical undo command survives semantic reanalysis and remains board-bound',
);

state = clearWorkflowSemanticSnapshot(
	state,
	'2026-09-22T01:09:00.000Z',
);
assert.equal(state.semanticSnapshot, undefined);
assert.equal(state.humanOwnershipDecisions.length, 0);
assert.equal(state.lastPlacementCommand?.id, command.id);

assert.throws(
	() => upsertWorkflowHumanDecision(
		state,
		decisionA,
		'2026-09-22T01:10:00.000Z',
	),
	/does not belong/,
);

const corrupted = normalizeWorkflowState(
	{ schemaVersion: 999, humanOwnershipDecisions: ['bad'] },
	'2026-09-22T01:11:00.000Z',
);
assert.equal(corrupted.semanticSnapshot, undefined);
assert.deepEqual(corrupted.humanOwnershipDecisions, []);

console.log('Workflow state tests passed.');
