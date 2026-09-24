import assert from 'node:assert/strict';

import {
	establishPcbEditorContext,
	type EditorContextPort,
} from '../src/application/editorContextTransaction';

async function main(): Promise<void> {
	{
		const calls: string[] = [];
		const port: EditorContextPort = {
			getSplitScreenIdByTabId: async tabId => {
				calls.push(`resolve-split:${tabId}`);
				return 'split-a';
			},
			getTabsBySplitScreenId: async splitId => {
				calls.push(`list-tabs:${splitId}`);
				return [
					{ tabId: 'pcb-tab', documentType: 'PCB' },
					{ tabId: 'other-tab', documentType: 'SCH' },
				];
			},
			activateSplitScreen: async splitId => {
				calls.push(`activate-split:${splitId}`);
				return true;
			},
			activateDocument: async tabId => {
				calls.push(`activate-tab:${tabId}`);
				return true;
			},
			getCurrentDocumentInfo: async () => {
				calls.push('read-current');
				return { tabId: 'pcb-tab', documentType: 'PCB' };
			},
		};

		const result = await establishPcbEditorContext({
			port,
			documentTabId: 'pcb-tab',
			pcbDocumentType: 'PCB',
		});

		assert.deepEqual(result, {
			documentTabId: 'pcb-tab',
			splitScreenId: 'split-a',
		});
		assert.deepEqual(calls, [
			'resolve-split:pcb-tab',
			'list-tabs:split-a',
			'activate-split:split-a',
			'activate-tab:pcb-tab',
			'read-current',
		]);
	}

	{
		let cameraContextActivated = false;
		const port: EditorContextPort = {
			getSplitScreenIdByTabId: async () => 'split-a',
			getTabsBySplitScreenId: async () => [
				{ tabId: 'different-tab', documentType: 'PCB' },
			],
			activateSplitScreen: async () => {
				cameraContextActivated = true;
				return true;
			},
			activateDocument: async () => true,
			getCurrentDocumentInfo: async () => ({
				tabId: 'different-tab',
				documentType: 'PCB',
			}),
		};

		await assert.rejects(
			() => establishPcbEditorContext({
				port,
				documentTabId: 'pcb-tab',
				pcbDocumentType: 'PCB',
			}),
			/已不在原编辑器分屏/,
		);
		assert.equal(
			cameraContextActivated,
			false,
			'context activation must fail before changing focus when the tab mapping is stale',
		);
	}

	{
		const port: EditorContextPort = {
			getSplitScreenIdByTabId: async () => 'split-a',
			getTabsBySplitScreenId: async () => [
				{ tabId: 'pcb-tab', documentType: 'PCB' },
			],
			activateSplitScreen: async () => true,
			activateDocument: async () => true,
			getCurrentDocumentInfo: async () => ({
				tabId: 'other-tab',
				documentType: 'PCB',
			}),
		};

		await assert.rejects(
			() => establishPcbEditorContext({
				port,
				documentTabId: 'pcb-tab',
				pcbDocumentType: 'PCB',
			}),
			/当前 Tab 与冻结 PCB Tab 不一致/,
			'host focus changes must be detected instead of entering camera APIs',
		);
	}

	console.log('Editor context transaction tests passed.');
}

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
