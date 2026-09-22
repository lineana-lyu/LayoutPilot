import extensionConfig from '../../extension.json' with { type: 'json' };

export type LayoutPilotWorkbenchSizeMode = 'compact' | 'standard' | 'wide';

const WORKBENCH_SIZE_KEY = 'layoutpilot.workbench-size.v2';
const ACTIVE_WORKBENCH_ID_KEY = 'layoutpilot.workbench-active-id.v2';

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

export function getLayoutPilotWorkbenchSizeMode(): LayoutPilotWorkbenchSizeMode {
	const raw = eda.sys_Storage.getExtensionUserConfig(WORKBENCH_SIZE_KEY);
	return raw === 'compact' || raw === 'wide' || raw === 'standard'
		? raw
		: 'standard';
}

async function setLayoutPilotWorkbenchSizeMode(
	mode: LayoutPilotWorkbenchSizeMode,
): Promise<void> {
	const success = await eda.sys_Storage.setExtensionUserConfig(
		WORKBENCH_SIZE_KEY,
		mode,
	);
	if (!success) {
		throw new Error('嘉立创EDA未能保存 LayoutPilot 窗口规格。');
	}
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

function dimensionsFor(
	mode: LayoutPilotWorkbenchSizeMode,
	viewport: { width: number; height: number },
): { width: number; height: number; x: number; y: number } {
	const maxWidth = Math.max(620, viewport.width - 40);
	const maxHeight = Math.max(560, viewport.height - 76);

	let width: number;
	let height: number;

	if (mode === 'compact') {
		width = Math.min(maxWidth, Math.max(760, Math.round(viewport.width * 0.52)));
		height = Math.min(maxHeight, Math.max(620, Math.round(viewport.height * 0.72)));
	}
	else if (mode === 'wide') {
		width = maxWidth;
		height = maxHeight;
	}
	else {
		width = Math.min(maxWidth, Math.max(1040, Math.round(viewport.width * 0.72)));
		height = Math.min(maxHeight, Math.max(720, Math.round(viewport.height * 0.84)));
	}

	return {
		width,
		height,
		x: Math.max(12, Math.round((viewport.width - width) / 2)),
		y: 38,
	};
}

async function closeWorkbenchInstance(id: string | undefined): Promise<void> {
	if (!id) return;
	try {
		await eda.sys_IFrame.closeIFrame(id);
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to retire workbench iframe', {
			id,
			error,
		});
	}
}

async function openFreshWorkbenchFrame(
	mode: LayoutPilotWorkbenchSizeMode,
): Promise<string> {
	const id = createWorkbenchInstanceId();
	const viewport = eda.sys_Window.getViewportSize();
	const size = dimensionsFor(mode, viewport);

	const opened = await eda.sys_IFrame.openIFrame(
		'/iframe/workbench.html',
		size.width,
		size.height,
		id,
		{
			title: `LayoutPilot ${extensionConfig.version} · PCB 布局工作台`,
			maximizeButton: true,
			minimizeButton: true,
			minimizeStyle: 'collapsed',
			grayscaleMask: false,
			x: size.x,
			y: size.y,
		},
	);

	if (!opened) {
		throw new Error(
			[
				'嘉立创EDA返回工作台打开失败。',
				`Workbench ID: ${id}`,
				`窗口规格: ${mode}`,
				'HTML: /iframe/workbench.html',
			].join('\n'),
		);
	}

	return id;
}

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

	const mode = getLayoutPilotWorkbenchSizeMode();
	const freshId = await openFreshWorkbenchFrame(mode);
	await rememberActiveWorkbenchId(freshId);

	// Only retire the stale instance after the new one is proven alive.
	if (activeId && activeId !== freshId) {
		await closeWorkbenchInstance(activeId);
	}
}

export async function resizeLayoutPilotWorkbench(
	mode: LayoutPilotWorkbenchSizeMode,
): Promise<void> {
	const currentMode = getLayoutPilotWorkbenchSizeMode();
	if (currentMode === mode) return;

	const previousId = getStoredActiveWorkbenchId();
	await setLayoutPilotWorkbenchSizeMode(mode);

	let freshId: string;
	try {
		freshId = await openFreshWorkbenchFrame(mode);
	}
	catch (error) {
		await setLayoutPilotWorkbenchSizeMode(currentMode);
		throw error;
	}

	try {
		await rememberActiveWorkbenchId(freshId);
	}
	catch (error) {
		await closeWorkbenchInstance(freshId);
		await setLayoutPilotWorkbenchSizeMode(currentMode);
		throw error;
	}

	// New iframe is alive and recorded before the previous one is closed.
	await closeWorkbenchInstance(previousId);
}

export async function closeLayoutPilotWorkbench(): Promise<void> {
	const activeId = getStoredActiveWorkbenchId();
	await closeWorkbenchInstance(activeId);
	await clearActiveWorkbenchId();
}

export async function hideLayoutPilotWorkbench(): Promise<void> {
	const activeId = getStoredActiveWorkbenchId();
	if (!activeId) {
		throw new Error('当前没有可隐藏的 LayoutPilot 工作台实例。');
	}

	const hidden = await eda.sys_IFrame.hideIFrame(activeId);
	if (hidden === false) {
		throw new Error('嘉立创EDA未能隐藏当前 LayoutPilot 工作台。');
	}
}
