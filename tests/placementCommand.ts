import assert from 'node:assert/strict';

import {
	createPlacementCommand,
	getLastPlacementCommand,
	markPlacementCommandApplied,
	markPlacementCommandSuperseded,
	markPlacementCommandUndone,
	setLastPlacementCommand,
} from '../src/domain/placementCommand';

setLastPlacementCommand(undefined);

const command = createPlacementCommand({
	snapshotId: 'semantic-1',
	constraintId: 'C1:policy:near:U1',
	componentId: 'c1',
	componentDesignator: 'C1',
	from: { x: 100, y: 200 },
	to: { x: 120, y: 220 },
	createdAt: '2026-09-21T13:00:00.000Z',
});

assert.equal(command.status, 'planned');
assert.equal(Object.isFrozen(command), true);
assert.equal(Object.isFrozen(command.from), true);
assert.equal(Object.isFrozen(command.to), true);

const applied = markPlacementCommandApplied(
	command,
	'2026-09-21T13:01:00.000Z',
);
assert.equal(applied.status, 'applied');
assert.equal(applied.verifiedAt, '2026-09-21T13:01:00.000Z');

setLastPlacementCommand(applied);
assert.equal(getLastPlacementCommand()?.id, applied.id);

const undone = markPlacementCommandUndone(applied);
setLastPlacementCommand(undone);
assert.equal(getLastPlacementCommand()?.status, 'undone');

const superseded = markPlacementCommandSuperseded(applied);
setLastPlacementCommand(superseded);
assert.equal(getLastPlacementCommand()?.status, 'superseded');

console.log('Placement command tests passed.');
