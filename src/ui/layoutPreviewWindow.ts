import extensionConfig from '../../extension.json' with { type: 'json' };

import { clearLayoutPlanGhost } from '../eda/layoutPreviewAdapter';
import {
	getStoredLayoutPreviewSession,
	setStoredLayoutPreviewSession,
} from '../eda/workflowStore';
import { openLayoutPilotWorkbench } from './workbenchWindow';

const ACTIVE_PREVIEW_ID_KEY = 'layoutpilot.layout-preview-active-id.v1';
const ACTIVE_PREVIEW_CONTEXT_KEY = 'layoutpilot.layout-preview-context.v1';

export type LayoutPreviewBarMode = 'plan' | 'navigation';

export interface LayoutPreviewBarContext {
	mode: LayoutPreviewBarMode;
	label?: string;
}

export interface LayoutPreviewBarOptions {
	mode?: LayoutPreviewBarMode;
	label?: string;
}

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

export function getLayoutPreviewBarContext(): LayoutPreviewBarContext {
	const value = eda.sys_Storage.getExtensionUserConfig(
		ACTIVE_PREVIEW_CONTEXT_KEY,
	);
	if (typeof value !== 'string' || !value.length) {
		return { mode: 'plan' };
	}
	try {
		const parsed = JSON.parse(value) as Partial<LayoutPreviewBarContext>;
		return {
			mode: parsed.mode === 'navigation' ? 'navigation' : 'plan',
			label: typeof parsed.label === 'string' ? parsed.label : undefined,
		};
	}
	catch {
		return { mode: 'plan' };
	}
}

async function rememberPreviewContext(
	context: LayoutPreviewBarContext,
): Promise<void> {
	await eda.sys_Storage.setExtensionUserConfig(
		ACTIVE_PREVIEW_CONTEXT_KEY,
		JSON.stringify(context),
	);
}

async function clearPreviewContext(): Promise<void> {
	await eda.sys_Storage.setExtensionUserConfig(
		ACTIVE_PREVIEW_CONTEXT_KEY,
		'',
	);
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

export async function openLayoutPreviewBar(
	options: LayoutPreviewBarOptions = {},
): Promise<void> {
	const context: LayoutPreviewBarContext = {
		mode: options.mode === 'navigation' ? 'navigation' : 'plan',
		label: options.label,
	};
	const previousId = getStoredPreviewWindowId();
	const id = createPreviewWindowId();
	const viewport = eda.sys_Window.getViewportSize();
	const navigation = context.mode === 'navigation';
	const width = navigation
		? Math.max(280, Math.min(360, viewport.width - 40))
		: Math.max(540, Math.min(720, viewport.width - 80));
	const height = navigation ? 54 : 116;
	const x = navigation
		? Math.max(16, viewport.width - width - 18)
		: Math.max(16, Math.round((viewport.width - width) / 2));
	const y = navigation
		? 48
		: Math.max(44, viewport.height - height - 72);

	await rememberPreviewContext(context);

	const opened = await eda.sys_IFrame.openIFrame(
		'/iframe/layout-preview.html',
		width,
		height,
		id,
		{
			title: navigation
				? 'LayoutPilot · 定位核对'
				: 'LayoutPilot · 布局预览',
			maximizeButton: false,
			minimizeButton: navigation,
			minimizeStyle: navigation ? 'collapsed' : undefined,
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
				await clearPreviewContext();
				await openLayoutPilotWorkbench();
				return true;
			},
		},
	);

	if (!opened) {
		await clearPreviewContext();
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
	await clearPreviewContext();
	await closePreviewWindowInstance(id);
	await openLayoutPilotWorkbench();
}
