import type {
	LayoutDiffPreviewMode,
	LayoutReviewScene,
} from '../domain/layoutDiffPreview';
import type { CanvasBounds, CanvasRegion } from '../domain/canvasRegion';

function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function rectSvg(
	bounds: CanvasBounds,
	attributes: string,
): string {
	return `<rect x="${bounds.minX}" y="${-bounds.maxY}" width="${Math.max(0.1, bounds.maxX - bounds.minX)}" height="${Math.max(0.1, bounds.maxY - bounds.minY)}" ${attributes}/>`;
}

function labelSvg(input: {
	text: string;
	x: number;
	y: number;
	viewport: CanvasRegion;
	fontSize: number;
	fill: string;
	stroke: string;
	textColor: string;
}): string {
	const height = input.fontSize * 1.7;
	const width = Math.max(
		input.fontSize * 4.6,
		input.text.length * input.fontSize * 0.62,
	);
	const inset = input.fontSize * 0.7;
	const localLeft = -input.fontSize * 0.3;
	const x = Math.max(
		input.viewport.left + inset - localLeft,
		Math.min(
			input.x,
			input.viewport.right - inset - width - localLeft,
		),
	);
	const y = Math.max(
		input.viewport.top + inset,
		Math.min(
			input.y,
			input.viewport.bottom - inset - height,
		),
	);

	return `
		<g transform="translate(${x} ${-y})">
			<rect x="${localLeft}" y="${-height}" width="${width}" height="${height}" rx="${input.fontSize * 0.2}"
				fill="${input.fill}" fill-opacity=".94" stroke="${input.stroke}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
			<text x="${input.fontSize * 0.18}" y="${-input.fontSize * 0.38}" font-size="${input.fontSize}"
				font-family="Microsoft YaHei UI,Segoe UI,sans-serif" fill="${input.textColor}">
				${escapeHtml(input.text)}
			</text>
		</g>
	`;
}

export function renderNativeSnapshotDiffOverlay(
	scene: LayoutReviewScene,
	viewport: CanvasRegion,
	mode: LayoutDiffPreviewMode,
): string {
	const width = Math.max(1, viewport.right - viewport.left);
	const height = Math.max(1, viewport.bottom - viewport.top);
	const viewBox = `${viewport.left} ${-viewport.bottom} ${width} ${height}`;
	const fontSize = Math.max(18, Math.min(40, Math.max(width, height) * 0.025));

	const current = mode === 'proposed'
		? ''
		: rectSvg(
			scene.subject.bounds,
			'fill="#d74444" fill-opacity=".18" stroke="#d74444" stroke-width="4" vector-effect="non-scaling-stroke"',
		);

	const target = mode === 'original'
		? ''
		: rectSvg(
			scene.subjectTargetBounds,
			'fill="#24a66a" fill-opacity=".22" stroke="#24a66a" stroke-width="4" vector-effect="non-scaling-stroke"',
		);

	const owner = scene.owner
		? rectSvg(
			scene.owner.bounds,
			'fill="none" stroke="#ffffff" stroke-opacity=".9" stroke-width="2" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"',
		)
		: '';

	const arrow = mode === 'diff'
		? `<line x1="${scene.subject.anchor.x}" y1="${-scene.subject.anchor.y}" x2="${scene.item.to.x}" y2="${-scene.item.to.y}"
			stroke="#24a66a" stroke-width="2.6" stroke-dasharray="8 6" marker-end="url(#native-review-arrow)" vector-effect="non-scaling-stroke"/>`
		: '';

	const labels = [
		mode !== 'proposed'
			? labelSvg({
				text: `CURRENT · ${scene.item.subjectDesignator}`,
				x: scene.subject.anchor.x,
				y: scene.subject.anchor.y,
				viewport,
				fontSize,
				fill: '#d74444',
				stroke: '#d74444',
				textColor: '#ffffff',
			})
			: '',
		mode !== 'original'
			? labelSvg({
				text: `TARGET · ${scene.item.subjectDesignator}`,
				x: scene.item.to.x,
				y: scene.item.to.y,
				viewport,
				fontSize,
				fill: '#24a66a',
				stroke: '#24a66a',
				textColor: '#ffffff',
			})
			: '',
		scene.owner
			? labelSvg({
				text: `OWNER · ${scene.item.ownerDesignator}`,
				x: scene.owner.anchor.x,
				y: scene.owner.anchor.y,
				viewport,
				fontSize,
				fill: '#ffffff',
				stroke: '#8a939c',
				textColor: '#47515b',
			})
			: '',
	].join('');

	return `
		<svg class="native-review-overlay" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
			<defs>
				<marker id="native-review-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
					<path d="M0,0 L9,4.5 L0,9 z" fill="#24a66a"/>
				</marker>
			</defs>
			${owner}
			${current}
			${arrow}
			${target}
			${labels}
		</svg>
	`;
}

export function renderNativeSnapshotDiffFrame(input: {
	imageUrl: string;
	scene: LayoutReviewScene;
	viewport: CanvasRegion;
	mode: LayoutDiffPreviewMode;
}): string {
	return `
		<div class="native-review-frame">
			<img
				class="native-review-image"
				src="${escapeHtml(input.imageUrl)}"
				alt="EasyEDA 原生 PCB 布局审查快照"
				draggable="false"
			/>
			${renderNativeSnapshotDiffOverlay(
				input.scene,
				input.viewport,
				input.mode,
			)}
		</div>
	`;
}


export function renderNativeSnapshotImageFrame(imageUrl: string): string {
	return `
		<div class="native-review-frame">
			<img
				class="native-review-image native-review-image-marked"
				src="${escapeHtml(imageUrl)}"
				alt="EasyEDA 原生 PCB 布局审查快照"
				draggable="false"
			/>
		</div>
	`;
}


export function renderFocusedPlacementCompare(input: {
	overviewUrl: string;
	currentUrl: string;
	proposedUrl: string;
	subjectDesignator: string;
	ownerDesignator: string;
	layer: string;
	focusWidthMil: number;
	focusHeightMil: number;
}): string {
	const scale = `${input.focusWidthMil.toFixed(0)} × ${input.focusHeightMil.toFixed(0)} mil`;
	return `
		<div class="focused-placement-review">
			<section class="focused-overview-card">
				<div class="focused-section-head">
					<div>
						<strong>整板定位</strong>
						<span>只用于确认改动发生在板子的哪里</span>
					</div>
					<div class="focused-overview-legend">
						<span><i class="legend-chip current-red"></i>当前</span>
						<span><i class="legend-chip target-green"></i>建议</span>
					</div>
				</div>
				<div class="focused-overview-image-wrap">
					<img class="focused-native-image overview" src="${escapeHtml(input.overviewUrl)}" alt="整板布局定位图" draggable="false"/>
				</div>
			</section>

			<div class="focused-compare-grid">
				<section class="focused-compare-pane current">
					<div class="focused-pane-head">
						<div>
							<span class="focused-kicker current">CURRENT</span>
							<strong>${escapeHtml(input.subjectDesignator)} · ${escapeHtml(input.layer)}</strong>
						</div>
						<span class="focused-scale">同尺度 · ${escapeHtml(scale)}</span>
					</div>
					<div class="focused-pane-image-wrap">
						<img class="focused-native-image" src="${escapeHtml(input.currentUrl)}" alt="当前布局局部图" draggable="false"/>
					</div>
					<div class="focused-pane-caption">真实 PCB 当前局部 · 红色轮廓标出待移动器件</div>
				</section>

				<section class="focused-compare-pane proposed">
					<div class="focused-pane-head">
						<div>
							<span class="focused-kicker proposed">PROPOSED</span>
							<strong>${escapeHtml(input.subjectDesignator)} → near(${escapeHtml(input.ownerDesignator)})</strong>
						</div>
						<span class="focused-scale">同尺度 · ${escapeHtml(scale)}</span>
					</div>
					<div class="focused-pane-image-wrap">
						<img class="focused-native-image" src="${escapeHtml(input.proposedUrl)}" alt="建议布局局部图" draggable="false"/>
					</div>
					<div class="focused-pane-caption">当前 PCB 环境 + 绿色真实 Pad Footprint Ghost · 尚未重新布线</div>
				</section>
			</div>
		</div>
	`;
}
