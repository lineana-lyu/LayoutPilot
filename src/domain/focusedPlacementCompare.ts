import type { CanvasBounds, CanvasRegion } from './canvasRegion';
import type { LayoutReviewScene } from './layoutDiffPreview';

export interface FocusedReviewRegions {
	overview: CanvasRegion;
	current: CanvasRegion;
	proposed: CanvasRegion;
	focusWidthMil: number;
	focusHeightMil: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function boundsFromPoints(points: Array<{ x: number; y: number }>): CanvasBounds {
	if (!points.length) {
		throw new Error('无法从空板框建立布局总览区域。');
	}
	return {
		minX: Math.min(...points.map(point => point.x)),
		minY: Math.min(...points.map(point => point.y)),
		maxX: Math.max(...points.map(point => point.x)),
		maxY: Math.max(...points.map(point => point.y)),
	};
}

function expandBounds(bounds: CanvasBounds, margin: number): CanvasBounds {
	return {
		minX: bounds.minX - margin,
		minY: bounds.minY - margin,
		maxX: bounds.maxX + margin,
		maxY: bounds.maxY + margin,
	};
}

function regionFromBounds(bounds: CanvasBounds): CanvasRegion {
	return {
		left: bounds.minX,
		right: bounds.maxX,
		top: bounds.minY,
		bottom: bounds.maxY,
	};
}

function sameScaleRegionAround(
	center: { x: number; y: number },
	width: number,
	height: number,
): CanvasRegion {
	return {
		left: center.x - width / 2,
		right: center.x + width / 2,
		top: center.y - height / 2,
		bottom: center.y + height / 2,
	};
}

export function buildFocusedReviewRegions(
	scene: LayoutReviewScene,
): FocusedReviewRegions {
	const boardBounds = boundsFromPoints(scene.boardOuter);
	const boardSpan = Math.max(
		boardBounds.maxX - boardBounds.minX,
		boardBounds.maxY - boardBounds.minY,
	);
	const overviewMargin = clamp(boardSpan * 0.025, 40, 160);
	const overview = regionFromBounds(
		expandBounds(boardBounds, overviewMargin),
	);

	const target = scene.subjectTargetBounds;
	const owner = scene.owner?.bounds;
	const subjectWidth = Math.max(
		20,
		scene.subject.bounds.maxX - scene.subject.bounds.minX,
	);
	const subjectHeight = Math.max(
		20,
		scene.subject.bounds.maxY - scene.subject.bounds.minY,
	);

	const proposedBounds: CanvasBounds = owner
		? {
			minX: Math.min(target.minX, owner.minX),
			minY: Math.min(target.minY, owner.minY),
			maxX: Math.max(target.maxX, owner.maxX),
			maxY: Math.max(target.maxY, owner.maxY),
		}
		: { ...target };

	const proposedWidth = proposedBounds.maxX - proposedBounds.minX;
	const proposedHeight = proposedBounds.maxY - proposedBounds.minY;

	// Keep local review readable. The target/owner neighborhood determines the
	// physical scale; CURRENT uses the exact same span for honest comparison.
	let focusWidth = clamp(
		Math.max(560, proposedWidth * 1.85, subjectWidth * 8),
		560,
		1200,
	);
	let focusHeight = clamp(
		Math.max(420, proposedHeight * 1.85, subjectHeight * 8),
		420,
		900,
	);

	// Normalize both panes to a stable 4:3-ish physical viewport.
	const aspect = 4 / 3;
	if (focusWidth / focusHeight < aspect) {
		focusWidth = Math.min(1200, focusHeight * aspect);
	}
	else {
		focusHeight = Math.min(900, focusWidth / aspect);
	}

	return {
		overview,
		current: sameScaleRegionAround(
			scene.subject.anchor,
			focusWidth,
			focusHeight,
		),
		proposed: sameScaleRegionAround(
			scene.item.to,
			focusWidth,
			focusHeight,
		),
		focusWidthMil: focusWidth,
		focusHeightMil: focusHeight,
	};
}
