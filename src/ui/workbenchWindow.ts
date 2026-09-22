import extensionConfig from '../../extension.json' with { type: 'json' };

export type LayoutPilotWorkbenchSizeMode = 'compact' | 'standard' | 'wide';

const WORKBENCH_SIZE_KEY = 'layoutpilot.workbench-size.v1';
const ACTIVE_WORKBENCH_ID_KEY = 'layoutpilot.workbench-active-id.v1';

function versionToken(): string {
	return String(extensionConfig.version ?? 'unknown')
		.replace(/[^a-zA-Z0-9_-]/g, '-');
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

function workbenchId(mode = getLayoutPilotWorkbenchSizeMode()): string {
	return `layoutpilot-workbench-${versionToken()}-${mode}`;
}

function allCurrentVersionWorkbenchIds(): string[] {
	return (['compact', 'standard', 'wide'] as const).map(mode =>
		workbenchId(mode),
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

async function rememberActiveWorkbenchId(id: string): Promise<void> {
	await eda.sys_Storage.setExtensionUserConfig(ACTIVE_WORKBENCH_ID_KEY, id);
}

async function retirePreviouslyActiveWorkbench(nextId: string): Promise<void> {
	const previous = eda.sys_Storage.getExtensionUserConfig(
		ACTIVE_WORKBENCH_ID_KEY,
	);
	if (typeof previous !== 'string' || !previous || previous === nextId) {
		return;
	}
	try {
		await eda.sys_IFrame.closeIFrame(previous);
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to retire previous workbench iframe', {
			previous,
			error,
		});
	}
}

async function openWorkbenchFrame(
	mode: LayoutPilotWorkbenchSizeMode,
	options?: { retirePrevious?: boolean },
): Promise<boolean> {
	const id = workbenchId(mode);
	const viewport = eda.sys_Window.getViewportSize();
	const size = dimensionsFor(mode, viewport);

	if (options?.retirePrevious !== false) {
		await retirePreviouslyActiveWorkbench(id);
	}

	try {
		const shown = await eda.sys_IFrame.showIFrame(id);
		if (shown) {
			await rememberActiveWorkbenchId(id);
			return true;
		}
	}
	catch (error) {
		console.warn('[LayoutPilot] showIFrame failed; opening fresh workbench', {
			id,
			error,
		});
	}

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

	if (opened) {
		await rememberActiveWorkbenchId(id);
	}

	return opened;
}

export async function openLayoutPilotWorkbench(): Promise<void> {
	const mode = getLayoutPilotWorkbenchSizeMode();
	let opened = false;

	try {
		opened = await openWorkbenchFrame(mode);
	}
	catch (error) {
		throw new Error(
			[
				'嘉立创EDA打开 LayoutPilot 工作台时发生异常。',
				`窗口规格: ${mode}`,
				`原因: ${String(error)}`,
			].join('\n'),
		);
	}

	if (!opened) {
		throw new Error(
			[
				'嘉立创EDA返回工作台打开失败。',
				`Workbench ID: ${workbenchId(mode)}`,
				'HTML: /iframe/workbench.html',
			].join('\n'),
		);
	}
}

export async function resizeLayoutPilotWorkbench(
	mode: LayoutPilotWorkbenchSizeMode,
): Promise<void> {
	const currentMode = getLayoutPilotWorkbenchSizeMode();
	if (currentMode === mode) {
		return;
	}

	const previousId = workbenchId(currentMode);
	await setLayoutPilotWorkbenchSizeMode(mode);

	const opened = await openWorkbenchFrame(mode, { retirePrevious: false });
	if (!opened) {
		await setLayoutPilotWorkbenchSizeMode(currentMode);
		throw new Error(`无法切换到“${mode}”窗口规格。`);
	}

	try {
		await eda.sys_IFrame.closeIFrame(previousId);
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to close previous size workbench', error);
	}
}

export async function closeLayoutPilotWorkbench(): Promise<void> {
	for (const id of allCurrentVersionWorkbenchIds()) {
		try {
			await eda.sys_IFrame.closeIFrame(id);
		}
		catch {
			// A size mode may not have been opened.
		}
	}
}

export async function hideLayoutPilotWorkbench(): Promise<void> {
	await eda.sys_IFrame.hideIFrame(workbenchId());
}
