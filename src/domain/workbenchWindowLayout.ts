export interface WorkbenchHostViewport {
	width: number;
	height: number;
}

export interface WorkbenchHostFrameLayout {
	width: number;
	height: number;
	x: number;
	y: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function buildWorkbenchFrameLayout(
	viewport: WorkbenchHostViewport,
): WorkbenchHostFrameLayout {
	const maxWidth = Math.max(420, viewport.width - 32);
	const maxHeight = Math.max(420, viewport.height - 84);
	const preferredMinWidth = Math.min(860, maxWidth);
	const preferredMinHeight = Math.min(640, maxHeight);
	const width = clamp(
		Math.round(viewport.width * 0.58),
		preferredMinWidth,
		Math.min(1320, maxWidth),
	);
	const height = clamp(
		Math.round(viewport.height * 0.86),
		preferredMinHeight,
		maxHeight,
	);

	return {
		width,
		height,
		x: Math.max(8, viewport.width - width - 14),
		y: viewport.height - height >= 64 ? 44 : 8,
	};
}

export function buildWorkbenchDockLayout(
	viewport: WorkbenchHostViewport,
): WorkbenchHostFrameLayout {
	const width = Math.min(
		Math.max(260, Math.round(viewport.width * 0.18)),
		Math.min(340, Math.max(260, viewport.width - 32)),
	);
	const height = 48;

	return {
		width,
		height,
		x: Math.max(8, viewport.width - width - 18),
		y: 52,
	};
}
