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

/**
 * EasyEDA exposes extension UI as a dialog iframe, not as a dockable panel.
 *
 * LayoutPilot therefore treats the workbench as a deliberately narrow
 * right-side "sidecar": it should leave most of the PCB visible instead of
 * trying to emulate free resize/move behavior the host API does not provide.
 */
export function buildWorkbenchFrameLayout(
	viewport: WorkbenchHostViewport,
): WorkbenchHostFrameLayout {
	const maxWidth = Math.max(420, viewport.width - 32);
	const maxHeight = Math.max(420, viewport.height - 84);
	const preferredMinWidth = Math.min(500, maxWidth);
	const preferredMaxWidth = Math.min(620, maxWidth);
	const width = clamp(
		Math.round(viewport.width * 0.30),
		preferredMinWidth,
		preferredMaxWidth,
	);
	const preferredMinHeight = Math.min(640, maxHeight);
	const height = clamp(
		Math.round(viewport.height * 0.88),
		preferredMinHeight,
		maxHeight,
	);

	return {
		width,
		height,
		x: Math.max(8, viewport.width - width - 12),
		y: viewport.height - height >= 64 ? 44 : 8,
	};
}
