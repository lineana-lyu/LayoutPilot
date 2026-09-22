import extensionConfig from '../../extension.json' with { type: 'json' };

import { clearLayoutPlanGhost } from '../eda/layoutPreviewAdapter';
import {
	getStoredLayoutPreviewSession,
	setStoredLayoutPreviewSession,
} from '../eda/workflowStore';
import { openLayoutPilotWorkbench } from './workbenchWindow';

const ACTIVE_PREVIEW_ID_KEY = 'layoutpilot.layout-preview-active-id.v1';
let previewSequence = 0;

function createPreviewWindowId(): string {
	previewSequence += 1;
	const version = String(extensionConfig.version ?? 'unknown')
		.replace(/[^a-zA-Z0-9_-]/g, '-');
	return [
		'layoutpilot-layout-preview',
		version,
		Date.now().toString(36),
		previewSequence.toString(36),
	].join('-');
}

function getStoredPreviewWindowId(): string | undefined {
	const value = eda.sys_Storage.getExtensionUserConfig(ACTIVE_PREVIEW_ID_KEY);
	return typeof value === 'string' && value.length ? value : undefined;
}

async function rememberPreviewWindowId(id: string): Promise<void> {
	await eda.sys_Storage.setExtensionUserConfig(ACTIVE_PREVIEW_ID_KEY, id);
}

async function clearPreviewWindowId(): Promise<void> {
	await eda.sys_Storage.setExtensionUserConfig(ACTIVE_PREVIEW_ID_KEY, '');
}

export async function clearActiveLayoutPreviewCanvas(): Promise<void> {
	const session = getStoredLayoutPreviewSession();
	if (!session) return;

	try {
		await clearLayoutPlanGhost({
			documentTabId: session.documentTabId,
			planId: session.planId,
		});
	}
	finally {
		await setStoredLayoutPreviewSession(undefined);
	}
}

async function closePreviewWindowInstance(id: string | undefined): Promise<void> {
	if (!id) return;
	try {
		await eda.sys_IFrame.closeIFrame(id);
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to close layout preview bar', {
			id,
			error,
		});
	}
}

export async function openLayoutPreviewBar(): Promise<void> {
	const previousId = getStoredPreviewWindowId();
	const id = createPreviewWindowId();
	const viewport = eda.sys_Window.getViewportSize();
	const width = Math.max(620, Math.min(860, viewport.width - 80));
	const height = 152;
	const x = Math.max(16, Math.round((viewport.width - width) / 2));
	const y = Math.max(44, viewport.height - height - 72);

	const opened = await eda.sys_IFrame.openIFrame(
		'/iframe/layout-preview.html',
		width,
		height,
		id,
		{
			title: 'LayoutPilot · 布局预览',
			maximizeButton: false,
			minimizeButton: false,
			grayscaleMask: false,
			x,
			y,
			onBeforeCloseCallFn: async () => {
				try {
					await clearActiveLayoutPreviewCanvas();
				}
				catch (error) {
					console.warn('[LayoutPilot] preview cleanup failed on close', error);
				}
				await clearPreviewWindowId();
				await openLayoutPilotWorkbench();
				return true;
			},
		},
	);

	if (!opened) {
		throw new Error('嘉立创EDA未能打开 LayoutPilot 布局预览条。');
	}

	await rememberPreviewWindowId(id);
	if (previousId && previousId !== id) {
		await closePreviewWindowInstance(previousId);
	}
}

export async function closeLayoutPreviewBarAndReturn(): Promise<void> {
	const id = getStoredPreviewWindowId();

	try {
		await clearActiveLayoutPreviewCanvas();
	}
	catch (error) {
		console.warn('[LayoutPilot] layout preview canvas cleanup failed', error);
	}

	await clearPreviewWindowId();
	await closePreviewWindowInstance(id);
	await openLayoutPilotWorkbench();
}
