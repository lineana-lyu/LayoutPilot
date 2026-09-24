import assert from 'node:assert/strict';

import {
	focusExplicitRegion,
	type EditorCameraPort,
} from '../src/application/editorCameraFocus';
import type { CanvasRegion } from '../src/domain/canvasRegion';

const requested: CanvasRegion = {
	left: 100,
	right: 700,
	top: 200,
	bottom: 700,
};

async function main(): Promise<void> {
	{
		const calls: string[] = [];
		const port: EditorCameraPort = {
			fitRegion: async (tabId, region) => {
				calls.push(`fit:${tabId}:${region.left},${region.right},${region.top},${region.bottom}`);
				return true;
			},
			centerAt: async (tabId, x, y) => {
				calls.push(`center:${tabId}:${x},${y}`);
				return {
					left: 50,
					right: 750,
					top: 150,
					bottom: 750,
				};
			},
		};

		const result = await focusExplicitRegion({
			port,
			documentTabId: 'pcb-tab',
			region: requested,
		});

		assert.deepEqual(result.center, { x: 400, y: 450 });
		assert.deepEqual(calls, [
			'fit:pcb-tab:100,700,200,700',
			'center:pcb-tab:400,450',
		]);
	}

	{
		const port: EditorCameraPort = {
			fitRegion: async () => true,
			centerAt: async () => ({
				left: -2000,
				right: 2500,
				top: -1800,
				bottom: 2800,
			}),
		};

		await assert.rejects(
			() => focusExplicitRegion({
				port,
				documentTabId: 'pcb-tab',
				region: requested,
			}),
			/实际视口未满足聚焦契约/,
			'a whole-board fallback must not be reported as a successful local focus',
		);
	}

	{
		let centerCalled = false;
		const port: EditorCameraPort = {
			fitRegion: async () => false,
			centerAt: async () => {
				centerCalled = true;
				return requested;
			},
		};

		await assert.rejects(
			() => focusExplicitRegion({
				port,
				documentTabId: 'pcb-tab',
				region: requested,
			}),
			/拒绝按显式区域/,
		);
		assert.equal(centerCalled, false);
	}

	console.log('Explicit editor camera focus tests passed.');
}

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
