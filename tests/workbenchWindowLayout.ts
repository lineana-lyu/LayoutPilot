import assert from 'node:assert/strict';

import { buildWorkbenchFrameLayout } from '../src/domain/workbenchWindowLayout';

const desktop = buildWorkbenchFrameLayout({ width: 1920, height: 1080 });
assert.equal(desktop.width, 576);
assert.equal(desktop.height, 950);
assert.equal(desktop.x, 1332);
assert.equal(desktop.y, 44);
assert.ok(
	desktop.width / 1920 <= 0.32,
	'the workbench should preserve most of the PCB canvas on desktop',
);

const laptop = buildWorkbenchFrameLayout({ width: 1366, height: 768 });
assert.equal(laptop.width, 500);
assert.equal(laptop.height, 676);
assert.equal(laptop.x, 854);
assert.equal(laptop.y, 44);
assert.ok(
	laptop.width / 1366 < 0.38,
	'the workbench should remain a sidecar on laptop-sized viewports',
);

console.log('Workbench sidecar layout tests passed.');
