import assert from 'node:assert/strict';

import {
	createPlacementCommand,
	markPlacementCommandApplied,
	markPlacementCommandSuperseded,
	markPlacementCommandUndone,
} from '../src/domain/placementCommand';

const command = createPlacementCommand({
	snapshotId: 'semantic-1',
	boardFingerprint: 'sem-v1-board-a',
	constraintId: 'C1:policy:near:U1',
	componentId: 'c1',
	componentDesignator: 'C1',
	from: { x: 100, y: 200 },
	to: { x: 120, y: 220 },
	createdAt: '2026-09-21T13:00:00.000Z',
});

assert.equal(command.status, 'planned');
assert.equal(command.boardFingerprint, 'sem-v1-board-a');
assert.equal(Object.isFrozen(command), true);
assert.equal(Object.isFrozen(command.from), true);
assert.equal(Object.isFrozen(command.to), true);

const applied = markPlacementCommandApplied(
	command,
	'2026-09-21T13:01:00.000Z',
);
assert.equal(applied.status, 'applied');
assert.equal(applied.verifiedAt, '2026-09-21T13:01:00.000Z');

const undone = markPlacementCommandUndone(applied);
assert.equal(undone.status, 'undone');

const superseded = markPlacementCommandSuperseded(applied);
assert.equal(superseded.status, 'superseded');

console.log('Placement command tests passed.');
