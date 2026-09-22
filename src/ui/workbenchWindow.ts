const WORKBENCH_ID = 'layoutpilot-workbench';

export async function openLayoutPilotWorkbench(): Promise<void> {
	const shown = await eda.sys_IFrame.showIFrame(WORKBENCH_ID);
	if (shown) {
		return;
	}

	const viewport = eda.sys_Window.getViewportSize();
	const width = Math.max(520, Math.min(680, Math.round(viewport.width * 0.38)));
	const height = Math.max(620, Math.min(900, viewport.height - 96));
	const x = Math.max(16, viewport.width - width - 24);
	const y = 48;

	const opened = await eda.sys_IFrame.openIFrame(
		'/iframe/workbench.html',
		width,
		height,
		WORKBENCH_ID,
		{
			title: 'LayoutPilot · PCB 布局工作台',
			maximizeButton: true,
			minimizeButton: true,
			minimizeStyle: 'collapsed',
			grayscaleMask: false,
			x,
			y,
		},
	);

	if (!opened) {
		throw new Error('LayoutPilot 工作台打开失败。');
	}
}

export async function closeLayoutPilotWorkbench(): Promise<void> {
	await eda.sys_IFrame.closeIFrame(WORKBENCH_ID);
}
