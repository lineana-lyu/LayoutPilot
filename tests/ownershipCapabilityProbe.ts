import assert from 'node:assert/strict';

import {
	filterOwnershipPropertyNames,
	findOwnershipFields,
	findOwnershipMemberNames,
	isOwnershipCapabilityKey,
} from '../src/domain/ownershipCapabilityProbe';

{
	assert.equal(isOwnershipCapabilityKey('groupId'), true);
	assert.equal(isOwnershipCapabilityKey('Reuse Block'), true);
	assert.equal(isOwnershipCapabilityKey('channelId'), true);
	assert.equal(isOwnershipCapabilityKey('Manufacturer'), false);
}

{
	const hits = findOwnershipFields(
		{
			Value: '100nF',
			metadata: {
				groupId: '$1e16',
				channelId: '$2e5_$4e3',
			},
		},
		'otherProperty',
	);

	assert.deepEqual(
		hits.map(hit => [hit.path, hit.valuePreview]),
		[
			['metadata.groupId', '$1e16'],
			['metadata.channelId', '$2e5_$4e3'],
		],
	);
}

{
	const hits = findOwnershipFields(
		{
			moduleInfo: {
				reuseBlock: 'SensorBoard',
			},
			manufacturer: 'Acme',
		},
		'component',
	);

	assert.equal(hits.length, 2);
	assert.equal(hits[0].path, 'moduleInfo');
	assert.equal(hits[1].path, 'moduleInfo.reuseBlock');
}

{
	class SyntheticComponent {
		getState_Designator(): string {
			return 'U1';
		}

		getState_GroupId(): string {
			return '$group';
		}

		getReuseBlockInfo(): string {
			return 'block';
		}
	}

	const hits = findOwnershipMemberNames(
		new SyntheticComponent(),
		'component-runtime',
	);

	assert.deepEqual(
		hits.map(hit => hit.path),
		['getReuseBlockInfo', 'getState_GroupId'],
	);
}

{
	const names = filterOwnershipPropertyNames([
		'Value',
		'Group ID',
		'Channel ID',
		'Reuse Module',
		'Manufacturer',
		'Group ID',
	]);

	assert.deepEqual(names, [
		'Channel ID',
		'Group ID',
		'Reuse Module',
	]);
}

console.log('Ownership capability probe tests passed.');
