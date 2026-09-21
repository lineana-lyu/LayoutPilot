import assert from 'node:assert/strict';

import type { CircuitNet } from '../src/domain/circuitGraph';
import {
	classifyNetForGrouping,
	isGeneratedNetName,
	isPowerLikeNetName,
} from '../src/domain/netInformativeness';

function net(name: string, fanout = 2): CircuitNet {
	const componentIds = Array.from({ length: fanout }, (_, index) => `c${index + 1}`);
	return {
		name,
		componentIds,
		endpoints: componentIds.map((componentId, index) => ({
			componentId,
			designator: `U${index + 1}`,
			padNumber: String(index + 1),
			net: name,
		})),
	};
}

{
	assert.equal(isGeneratedNetName('U4_5'), true);
	assert.equal(isGeneratedNetName('C9_1'), true);
	assert.equal(isGeneratedNetName('Q2_3'), true);
	assert.equal(isGeneratedNetName('U1_A1'), true);
	assert.equal(isGeneratedNetName('I2C_SCL'), false);
}

{
	assert.equal(isPowerLikeNetName('VBAT_4.2V'), true);
	assert.equal(isPowerLikeNetName('+3.3V'), true);
	assert.equal(isPowerLikeNetName('5V_OUT'), true);
	assert.equal(isPowerLikeNetName('VBAT_SENSE'), false);
}

{
	const profile = classifyNetForGrouping(net('U4_5'), 12);
	assert.equal(profile.classification, 'local');
	assert.equal(profile.electricalRole, 'signal');
	assert.equal(profile.nameOrigin, 'generated');
	assert.equal(profile.groupingWeight, 1);
}

{
	const profile = classifyNetForGrouping(net('VBAT_4.2V'), 12);
	assert.equal(profile.classification, 'global-power');
	assert.equal(profile.electricalRole, 'power');
	assert.equal(profile.nameOrigin, 'global');
}

{
	const profile = classifyNetForGrouping(net('I2C_SCL', 4), 12);
	assert.equal(profile.classification, 'named-signal');
	assert.equal(profile.electricalRole, 'signal');
	assert.equal(profile.nameOrigin, 'explicit');
}

{
	const profile = classifyNetForGrouping(net('VBAT_SENSE'), 12);
	assert.equal(profile.classification, 'named-signal');
	assert.equal(profile.electricalRole, 'signal');
	assert.equal(profile.nameOrigin, 'explicit');
}

console.log('Net informativeness profile tests passed.');
