import extensionConfig from '../../extension.json' with { type: 'json' };

import {
	buildWorkbenchDockLayout,
	buildWorkbenchFrameLayout,
} from '../domain/workbenchWindowLayout';

const ACTIVE_WORKBENCH_ID_KEY = 'layoutpilot.workbench-active-id.v3';
const WORKBENCH_DOCK_ID = 'layoutpilot-workbench-dock';

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
		console.warn('[LayoutPilot] unable to close iframe', {
			id,
			error,
		});
	}
}

async function closeWorkbenchDock(): Promise<void> {
	try {
		await eda.sys_IFrame.closeIFrame(WORKBENCH_DOCK_ID);
	}
	catch {
		// The dock normally does not exist while the workbench is expanded.
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
			// Native minimize is intentionally disabled. In current EasyEDA builds
			// the collapsed host rectangle can blend into the editor and may restore
			// with stale placement after the whole application is minimized.
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

async function openWorkbenchDock(): Promise<void> {
	await closeWorkbenchDock();
	const viewport = eda.sys_Window.getViewportSize();
	const layout = buildWorkbenchDockLayout(viewport);
	const opened = await eda.sys_IFrame.openIFrame(
		'/iframe/workbench-dock.html',
		layout.width,
		layout.height,
		WORKBENCH_DOCK_ID,
		{
			title: 'LayoutPilot · 工作台已收起',
			maximizeButton: false,
			minimizeButton: false,
			grayscaleMask: false,
			x: layout.x,
			y: layout.y,
		},
	);
	if (!opened) {
		throw new Error('嘉立创EDA未能打开 LayoutPilot 收起条。');
	}
}

/**
 * Internal restore path used by preview/evidence return actions.
 *
 * It first attempts to reveal the exact hidden iframe so transient workbench
 * state (for example an inline layout review) survives a PCB inspection. If
 * the host no longer recognizes that iframe, a fresh frame is created.
 */
export async function openLayoutPilotWorkbench(): Promise<void> {
	await closeWorkbenchDock();
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
 * User-invoked recovery path from the extension menu.
 *
 * Do not trust showIFrame() here: after the host application has been minimized
 * and restored, current EasyEDA builds may still report a stale iframe as
 * showable even though it is no longer visible or is positioned incorrectly.
 * A menu-level "open workbench" therefore recreates the host frame
 * transactionally from persisted workflow state.
 */
export async function reopenLayoutPilotWorkbench(): Promise<void> {
	await closeWorkbenchDock();
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

/**
 * Product-level collapse control.
 *
 * EasyEDA exposes open/hide/show/close for extension iframes but no arbitrary
 * runtime resize API. The old compact/standard/wide presets therefore did not
 * solve the actual need ("let me see the board"). Collapsing hides the working
 * iframe and opens a small branded return strip instead of using the host's
 * ambiguous native minimized rectangle.
 */
export async function collapseLayoutPilotWorkbench(): Promise<void> {
	const activeId = getStoredActiveWorkbenchId();
	if (!activeId) {
		throw new Error('当前没有可收起的 LayoutPilot 工作台实例。');
	}

	await openWorkbenchDock();
	try {
		const hidden = await eda.sys_IFrame.hideIFrame(activeId);
		if (hidden === false) {
			throw new Error('嘉立创EDA未能隐藏当前 LayoutPilot 工作台。');
		}
	}
	catch (error) {
		await closeWorkbenchDock();
		throw error;
	}
}

export async function restoreLayoutPilotWorkbenchFromDock(): Promise<void> {
	const activeId = getStoredActiveWorkbenchId();
	if (activeId) {
		try {
			const shown = await eda.sys_IFrame.showIFrame(activeId);
			if (shown) {
				await closeWorkbenchDock();
				return;
			}
		}
		catch (error) {
			console.warn('[LayoutPilot] unable to restore collapsed workbench', {
				activeId,
				error,
			});
		}
	}

	// If the hidden frame was invalidated by a host minimize/restore cycle,
	// recover from persisted workflow state with a fresh instance.
	await reopenLayoutPilotWorkbench();
}

export async function closeLayoutPilotWorkbench(): Promise<void> {
	await closeWorkbenchDock();
	const activeId = getStoredActiveWorkbenchId();
	await closeFrame(activeId);
	await clearActiveWorkbenchId();
}

export async function hideLayoutPilotWorkbench(): Promise<void> {
	const activeId = getStoredActiveWorkbenchId();
	if (!activeId) {
		throw new Error('当前没有可隐藏的 LayoutPilot 工作台实例。');
	}

	await closeWorkbenchDock();
	const hidden = await eda.sys_IFrame.hideIFrame(activeId);
	if (hidden === false) {
		throw new Error('嘉立创EDA未能隐藏当前 LayoutPilot 工作台。');
	}
}
