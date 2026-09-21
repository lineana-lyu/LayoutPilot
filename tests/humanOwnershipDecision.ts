import assert from 'node:assert/strict';

import {
	clearHumanOwnershipDecisions,
	createHumanOwnershipDecision,
	removeHumanOwnershipDecision,
	getHumanOwnershipDecisions,
	toExplicitOwnershipHints,
	upsertHumanOwnershipDecision,
} from '../src/domain/humanOwnershipDecision';

clearHumanOwnershipDecisions();

{
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

	upsertHumanOwnershipDecision(decision);

	assert.deepEqual(getHumanOwnershipDecisions('semantic-a'), [decision]);
	assert.deepEqual(toExplicitOwnershipHints('semantic-a'), [
		{
			componentId: 'c14',
			ownerComponentId: 'u6',
			source: 'user-confirmed-owner-v1',
		},
	]);
	assert.equal(Object.isFrozen(decision), true);
}

{
	const replacement = createHumanOwnershipDecision(
		{
			snapshotId: 'semantic-a',
			componentId: 'c14',
			componentDesignator: 'C14',
			ownerComponentId: 'u8',
			ownerDesignator: 'U8',
		},
		'2026-09-21T12:31:00.000Z',
	);

	upsertHumanOwnershipDecision(replacement);

	const current = getHumanOwnershipDecisions('semantic-a');
	assert.equal(current.length, 1);
	assert.equal(current[0].ownerDesignator, 'U8');
}

{
	const otherSnapshot = createHumanOwnershipDecision(
		{
			snapshotId: 'semantic-b',
			componentId: 'c14',
			componentDesignator: 'C14',
			ownerComponentId: 'u9',
			ownerDesignator: 'U9',
		},
		'2026-09-21T12:32:00.000Z',
	);
	upsertHumanOwnershipDecision(otherSnapshot);

	clearHumanOwnershipDecisions('semantic-a');
	assert.equal(getHumanOwnershipDecisions('semantic-a').length, 0);
	assert.equal(getHumanOwnershipDecisions('semantic-b').length, 1);

	removeHumanOwnershipDecision('semantic-b', 'c14');
	assert.equal(getHumanOwnershipDecisions('semantic-b').length, 0);
}

console.log('Human ownership decision tests passed.');
