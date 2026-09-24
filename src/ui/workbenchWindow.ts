import extensionConfig from '../../extension.json' with { type: 'json' };

import { buildWorkbenchFrameLayout } from '../domain/workbenchWindowLayout';

const ACTIVE_WORKBENCH_ID_KEY = 'layoutpilot.workbench-active-id.v4';

let instanceSequence = 0;

function versionToken(): string {
	return String(extensionConfig.version ?? 'unknown')
		.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function createWorkbenchInstanceId(): string {
	instanceSequence += 1;
	return [
		'layoutpilot-workbench',
		versionToken(),
		Date.now().toString(36),
		instanceSequence.toString(36),
	].join('-');
}

function getStoredActiveWorkbenchId(): string | undefined {
	const value = eda.sys_Storage.getExtensionUserConfig(ACTIVE_WORKBENCH_ID_KEY);
	return typeof value === 'string' && value.length ? value : undefined;
}

async function rememberActiveWorkbenchId(id: string): Promise<void> {
	const success = await eda.sys_Storage.setExtensionUserConfig(
		ACTIVE_WORKBENCH_ID_KEY,
		id,
	);
	if (!success) {
		throw new Error('嘉立创EDA未能保存当前 LayoutPilot 工作台实例。');
	}
}

async function clearActiveWorkbenchId(): Promise<void> {
	await eda.sys_Storage.setExtensionUserConfig(
		ACTIVE_WORKBENCH_ID_KEY,
		'',
	);
}

async function closeFrame(id: string | undefined): Promise<void> {
	if (!id) return;
	try {
		await eda.sys_IFrame.closeIFrame(id);
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to close workbench iframe', {
			id,
			error,
		});
	}
}

async function openFreshWorkbenchFrame(): Promise<string> {
	const id = createWorkbenchInstanceId();
	const viewport = eda.sys_Window.getViewportSize();
	const layout = buildWorkbenchFrameLayout(viewport);

	const opened = await eda.sys_IFrame.openIFrame(
		'/iframe/workbench.html',
		layout.width,
		layout.height,
		id,
		{
			title: `LayoutPilot ${extensionConfig.version} · PCB 布局工作台`,
			maximizeButton: true,
			minimizeButton: false,
			grayscaleMask: false,
			x: layout.x,
			y: layout.y,
		},
	);

	if (!opened) {
		throw new Error(
			[
				'嘉立创EDA返回工作台打开失败。',
				`Workbench ID: ${id}`,
				`窗口: ${layout.width}×${layout.height} @ (${layout.x}, ${layout.y})`,
				'HTML: /iframe/workbench.html',
			].join('\n'),
		);
	}

	return id;
}

/**
 * Continuity-oriented restore used when returning from PCB inspection.
 *
 * It prefers the exact hidden workbench so in-memory review state survives.
 */
export async function openLayoutPilotWorkbench(): Promise<void> {
	const activeId = getStoredActiveWorkbenchId();
	if (activeId) {
		try {
			const shown = await eda.sys_IFrame.showIFrame(activeId);
			if (shown) {
				return;
			}
		}
		catch (error) {
			console.warn('[LayoutPilot] stored workbench instance is stale', {
				activeId,
				error,
			});
		}
	}

	const freshId = await openFreshWorkbenchFrame();
	await rememberActiveWorkbenchId(freshId);
	if (activeId && activeId !== freshId) {
		await closeFrame(activeId);
	}
}

/**
 * Recovery-oriented open used from the extension menu.
 *
 * A fresh iframe is created before the previous id is retired. This keeps the
 * prior minimize/restore recovery guarantee without requiring a persistent
 * helper popup on the PCB canvas.
 */
export async function reopenLayoutPilotWorkbench(): Promise<void> {
	const previousId = getStoredActiveWorkbenchId();
	const freshId = await openFreshWorkbenchFrame();

	try {
		await rememberActiveWorkbenchId(freshId);
	}
	catch (error) {
		await closeFrame(freshId);
		throw error;
	}

	if (previousId && previousId !== freshId) {
		await closeFrame(previousId);
	}
}

export async function closeLayoutPilotWorkbench(): Promise<void> {
	const activeId = getStoredActiveWorkbenchId();
	await closeFrame(activeId);
	await clearActiveWorkbenchId();
}
