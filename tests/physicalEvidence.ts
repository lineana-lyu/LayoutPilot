import assert from 'node:assert/strict';

import {
	buildClosestSharedRailPadEvidence,
	type EvidenceComponent,
} from '../src/domain/physicalEvidence';

const subject: EvidenceComponent = {
	id: 'c12',
	designator: 'C12',
	pads: [
		{ padNumber: '1', net: 'GND', x: 100, y: 100 },
		{ padNumber: '2', net: '+3.3V', x: 120, y: 100 },
	],
};

const owner: EvidenceComponent = {
	id: 'u11',
	designator: 'U11',
	pads: [
		{ padNumber: '5', net: 'GND', x: 260, y: 90 },
		{ padNumber: '8', net: '+3.3V', x: 220, y: 100 },
		{ padNumber: '9', net: '+3.3V', x: 400, y: 100 },
	],
};

{
	const evidence = buildClosestSharedRailPadEvidence(
		subject,
		owner,
		['+3.3V'],
	);
	assert.ok(evidence);
	assert.equal(evidence.netName, '+3.3V');
	assert.equal(evidence.subjectPadNumber, '2');
	assert.equal(evidence.ownerPadNumber, '8');
	assert.equal(evidence.distanceMil, 100);
}

{
	const evidence = buildClosestSharedRailPadEvidence(
		subject,
		owner,
		['+5V'],
	);
	assert.equal(evidence, undefined);
}

{
	const evidence = buildClosestSharedRailPadEvidence(
		subject,
		{
			...owner,
			pads: [
				{ padNumber: '8', net: '+3.3V', x: 220, y: 100 },
				{ padNumber: '9', net: '+3.3V', x: 130, y: 100 },
			],
		},
		['+3.3V'],
	);
	assert.ok(evidence);
	assert.equal(evidence.ownerPadNumber, '9');
	assert.equal(evidence.distanceMil, 10);
}

console.log('Physical evidence tests passed.');
