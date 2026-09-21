import assert from 'node:assert/strict';

import {
	executePlacementTransaction,
	type PlacementTransactionAdapter,
} from '../src/application/placementTransaction';

function adapter(options?: {
	failMoveTo?: boolean;
	postDrcPass?: boolean;
	failRollback?: boolean;
	rollbackDrcPass?: boolean;
}) {
	const moves: Array<{ x: number; y: number }> = [];
	let drcCalls = 0;

	const value: PlacementTransactionAdapter = {
		async moveAndVerify(_componentId, point) {
			moves.push({ ...point });
			if (moves.length === 1 && options?.failMoveTo) {
				throw new Error('move failed after mutation attempt');
			}
			if (moves.length >= 2 && options?.failRollback) {
				throw new Error('rollback failed');
			}
		},
		async checkDrc() {
			drcCalls += 1;
			if (drcCalls === 1) {
				return options?.postDrcPass ?? true;
			}
			return options?.rollbackDrcPass ?? true;
		},
	};

	return {
		value,
		moves,
		getDrcCalls: () => drcCalls,
	};
}

const input = {
	componentId: 'c1',
	from: { x: 10, y: 20 },
	to: { x: 30, y: 40 },
};

{
	const fake = adapter({ postDrcPass: true });
	const result = await executePlacementTransaction(input, fake.value);
	assert.equal(result.ok, true);
	assert.deepEqual(fake.moves, [{ x: 30, y: 40 }]);
	assert.equal(fake.getDrcCalls(), 1);
}

{
	const fake = adapter({
		postDrcPass: false,
		rollbackDrcPass: true,
	});
	const result = await executePlacementTransaction(input, fake.value);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.rollbackAttempted, true);
		assert.equal(result.rollbackVerified, true);
		assert.equal(result.rollbackDrcPassed, true);
	}
	assert.deepEqual(fake.moves, [
		{ x: 30, y: 40 },
		{ x: 10, y: 20 },
	]);
}

{
	const fake = adapter({
		failMoveTo: true,
		rollbackDrcPass: true,
	});
	const result = await executePlacementTransaction(input, fake.value);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.rollbackAttempted, true);
		assert.equal(result.rollbackVerified, true);
	}
	assert.deepEqual(fake.moves, [
		{ x: 30, y: 40 },
		{ x: 10, y: 20 },
	]);
}

{
	const fake = adapter({
		postDrcPass: false,
		failRollback: true,
	});
	const result = await executePlacementTransaction(input, fake.value);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.rollbackAttempted, true);
		assert.equal(result.rollbackVerified, false);
		assert.match(result.error, /回滚失败/);
	}
}

console.log('Placement transaction tests passed.');
