import assert from 'node:assert/strict';

import { buildWorkbenchFrameLayout } from '../src/domain/workbenchWindowLayout';

const desktop = buildWorkbenchFrameLayout({ width: 1920, height: 1080 });
assert.equal(desktop.width, 1114);
assert.equal(desktop.height, 929);
assert.equal(desktop.x, 792);
assert.equal(desktop.y, 44);
assert.ok(
	desktop.x >= 700,
	'the workbench should leave a substantial PCB area visible on desktop',
);

const laptop = buildWorkbenchFrameLayout({ width: 1366, height: 768 });
assert.equal(laptop.width, 860);
assert.equal(laptop.height, 660);
assert.equal(laptop.x, 492);
assert.equal(laptop.y, 44);

console.log('Workbench host-window layout tests passed.');
