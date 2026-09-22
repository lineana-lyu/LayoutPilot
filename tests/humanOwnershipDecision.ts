import assert from 'node:assert/strict';

import {
	createHumanOwnershipDecision,
	toExplicitOwnershipHints,
} from '../src/domain/humanOwnershipDecision';

const decision = createHumanOwnershipDecision(
	{
		snapshotId: 'semantic-a',
		componentId: 'c14',
		componentDesignator: 'C14',
		ownerComponentId: 'u6',
		ownerDesignator: 'U6',
	},
	'2026-09-21T12:30:00.000Z',
);

assert.equal(Object.isFrozen(decision), true);
assert.deepEqual(toExplicitOwnershipHints([decision]), [
	{
		componentId: 'c14',
		ownerComponentId: 'u6',
		source: 'user-confirmed-owner-v1',
	},
]);

console.log('Human ownership decision tests passed.');
