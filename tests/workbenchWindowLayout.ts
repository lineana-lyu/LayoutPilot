import assert from 'node:assert/strict';

import { buildWorkbenchFrameLayout } from '../src/domain/workbenchWindowLayout';

const desktop = buildWorkbenchFrameLayout({ width: 1920, height: 1080 });
assert.equal(desktop.width, 499);
assert.equal(desktop.height, 950);
assert.equal(desktop.x, 1409);
assert.equal(desktop.y, 44);
assert.ok(
	desktop.width / 1920 < 0.27,
	'the sidecar should preserve more than 73% of a desktop PCB viewport',
);

const laptop = buildWorkbenchFrameLayout({ width: 1366, height: 768 });
assert.equal(laptop.width, 430);
assert.equal(laptop.height, 676);
assert.equal(laptop.x, 924);
assert.equal(laptop.y, 44);
assert.ok(
	laptop.width / 1366 < 0.32,
	'the sidecar should preserve roughly two thirds of a laptop PCB viewport',
);

const compactHost = buildWorkbenchFrameLayout({ width: 1024, height: 720 });
assert.equal(compactHost.width, 430);
assert.ok(
	compactHost.width < compactHost.x,
	'the sidecar should still leave a distinct PCB area on a compact host',
);

console.log('Workbench PCB-visibility-budget tests passed.');
