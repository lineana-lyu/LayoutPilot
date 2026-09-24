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

const SIDECAR_MIN_WIDTH_PX = 430;
const SIDECAR_MAX_WIDTH_PX = 520;
const SIDECAR_TARGET_VIEWPORT_RATIO = 0.26;
const SIDECAR_MAX_VIEWPORT_RATIO = 0.34;

/**
 * EasyEDA exposes extension HTML as a dialog iframe, not as a native dock.
 *
 * LayoutPilot therefore uses a board-visibility budget instead of arbitrary
 * compact/standard/wide presets:
 *
 * - aim for roughly one quarter of the host viewport;
 * - never consume more than ~34% on ordinary desktop/laptop viewports when the
 *   minimum readable width can still be respected;
 * - keep enough width for the single-column engineering inspector;
 * - pin the sidecar to the right edge at creation time.
 *
 * This makes "leave the PCB visible" an explicit invariant rather than a tuned
 * pixel constant for one screenshot resolution.
 */
export function buildWorkbenchFrameLayout(
	viewport: WorkbenchHostViewport,
): WorkbenchHostFrameLayout {
	const maxAvailableWidth = Math.max(320, viewport.width - 24);
	const readableMinWidth = Math.min(SIDECAR_MIN_WIDTH_PX, maxAvailableWidth);
	const viewportBudgetWidth = Math.floor(
		viewport.width * SIDECAR_MAX_VIEWPORT_RATIO,
	);
	const readableMaxWidth = Math.max(
		readableMinWidth,
		Math.min(
			SIDECAR_MAX_WIDTH_PX,
			maxAvailableWidth,
			viewportBudgetWidth,
		),
	);
	const width = clamp(
		Math.round(viewport.width * SIDECAR_TARGET_VIEWPORT_RATIO),
		readableMinWidth,
		readableMaxWidth,
	);

	const maxHeight = Math.max(420, viewport.height - 84);
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
