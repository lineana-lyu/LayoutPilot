import extensionConfig from '../../extension.json' with { type: 'json' };

function currentWorkbenchId(): string {
	const version = String(extensionConfig.version ?? 'unknown')
		.replace(/[^a-zA-Z0-9_-]/g, '-');
	return `layoutpilot-workbench-${version}`;
}

export async function openLayoutPilotWorkbench(): Promise<void> {
	const workbenchId = currentWorkbenchId();


	try {
		const shown = await eda.sys_IFrame.showIFrame(workbenchId);
		if (shown) {
			return;
		}
	}
	catch (error) {
		console.warn(
			'[LayoutPilot] showIFrame failed; attempting a fresh open',
			{ workbenchId, error },
		);
	}

	try {
		await eda.sys_IFrame.closeIFrame();
	}
	catch (error) {
		console.warn(
			'[LayoutPilot] Unable to retire stale extension iframes before open',
			error,
		);
	}

	const viewport = eda.sys_Window.getViewportSize();
	const width = Math.max(
		520,
		Math.min(680, Math.round(viewport.width * 0.38)),
	);
	const height = Math.max(
		620,
		Math.min(900, viewport.height - 96),
	);
	const x = Math.max(16, viewport.width - width - 24);
	const y = 48;

	let opened = false;
	try {
		opened = await eda.sys_IFrame.openIFrame(
			'/iframe/workbench.html',
			width,
			height,
			workbenchId,
			{
				title: `LayoutPilot ${extensionConfig.version} · PCB 布局工作台`,
				maximizeButton: true,
				minimizeButton: true,
				minimizeStyle: 'collapsed',
				grayscaleMask: false,
				x,
				y,
			},
		);
	}
	catch (error) {
		throw new Error(
			[
				'嘉立创EDA sys_IFrame.openIFrame 调用抛出异常。',
				`Workbench ID: ${workbenchId}`,
				`Viewport: ${viewport.width}×${viewport.height}`,
				`原因: ${String(error)}`,
			].join('\n'),
		);
	}

	if (!opened) {
		throw new Error(
			[
				'嘉立创EDA返回工作台打开失败。',
				`Workbench ID: ${workbenchId}`,
				'HTML: /iframe/workbench.html',
				`Viewport: ${viewport.width}×${viewport.height}`,
			].join('\n'),
		);
	}
}

export async function closeLayoutPilotWorkbench(): Promise<void> {
	await eda.sys_IFrame.closeIFrame(currentWorkbenchId());
}

export async function hideLayoutPilotWorkbench(): Promise<void> {
	await eda.sys_IFrame.hideIFrame(currentWorkbenchId());
}
