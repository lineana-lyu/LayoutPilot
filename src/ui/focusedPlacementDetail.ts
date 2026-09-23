import type { CanvasRegion } from '../domain/canvasRegion';
import {
	boundsIntersectRegion,
	traceIntersectsRegion,
	viaIntersectsRegion,
	type LayoutReviewComponent,
	type LayoutReviewScene,
} from '../domain/layoutDiffPreview';
import { buildFocusedReviewRegions } from '../domain/focusedPlacementCompare';

function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function traceColor(layer: string): string {
	const normalized = layer.toLowerCase();
	if (normalized.includes('bottom') || normalized.includes('bottomlayer')) {
		return '#2d62c8';
	}
	return '#d64545';
}

function translateBounds(
	bounds: { minX: number; minY: number; maxX: number; maxY: number },
	dx: number,
	dy: number,
) {
	return {
		minX: bounds.minX + dx,
		minY: bounds.minY + dy,
		maxX: bounds.maxX + dx,
		maxY: bounds.maxY + dy,
	};
}

function renderHoverHalo(
	bounds: { minX: number; minY: number; maxX: number; maxY: number },
	color: string,
): string {
	const margin = Math.max(
		8,
		Math.min(
			22,
			Math.max(
				bounds.maxX - bounds.minX,
				bounds.maxY - bounds.minY,
			) * 0.18,
		),
	);
	return `
		<rect
			class="review-focus-halo"
			x="${bounds.minX - margin}"
			y="${-(bounds.maxY + margin)}"
			width="${bounds.maxX - bounds.minX + margin * 2}"
			height="${bounds.maxY - bounds.minY + margin * 2}"
			rx="${Math.min(10, margin * 0.45)}"
			fill="${color}"
			fill-opacity=".08"
			stroke="${color}"
			stroke-width="3"
			stroke-dasharray="8 5"
			vector-effect="non-scaling-stroke"
		/>
	`;
}

function renderPad(
	x: number,
	y: number,
	width: number,
	height: number,
	rotation: number,
	fill: string,
	stroke: string,
	opacity = 1,
): string {
	return `
		<rect
			x="${x - Math.max(2, width) / 2}"
			y="${-(y + Math.max(2, height) / 2)}"
			width="${Math.max(2, width)}"
			height="${Math.max(2, height)}"
			rx="${Math.min(4, Math.max(1, Math.min(width, height) * 0.18))}"
			transform="rotate(${-rotation} ${x} ${-y})"
			fill="${fill}"
			fill-opacity="${opacity}"
			stroke="${stroke}"
			stroke-width="1.5"
			vector-effect="non-scaling-stroke"
		/>
	`;
}

function renderComponent(
	component: LayoutReviewComponent,
	options?: {
		dx?: number;
		dy?: number;
		muted?: boolean;
		accent?: 'current' | 'target' | 'owner';
		showDesignator?: boolean;
		navigationKind?: 'component' | 'current' | 'target';
	},
): string {
	const dx = options?.dx ?? 0;
	const dy = options?.dy ?? 0;
	const accent = options?.accent;
	const muted = options?.muted ?? false;
	const padFill = accent === 'current'
		? '#ff6969'
		: accent === 'target'
			? '#47d48a'
			: accent === 'owner'
				? '#dfe7ef'
				: '#d6b84b';
	const padStroke = accent === 'current'
		? '#ff2f2f'
		: accent === 'target'
			? '#1eb86b'
			: accent === 'owner'
				? '#a8b4c0'
				: '#f2d75e';
	const opacity = muted ? 0.5 : 0.94;
	const translatedBounds = translateBounds(component.bounds, dx, dy);
	const navigationKind = options?.navigationKind ?? 'component';
	const componentId = navigationKind === 'target' ? '' : component.id;
	const dataComponent = componentId
		? ` data-review-component-id="${escapeHtml(componentId)}"`
		: '';

	const pads = component.pads.length
		? component.pads.map(pad =>
			renderPad(
				pad.x + dx,
				pad.y + dy,
				pad.width,
				pad.height,
				pad.rotation,
				padFill,
				padStroke,
				opacity,
			)
		).join('')
		: `
			<rect
				x="${translatedBounds.minX}"
				y="${-translatedBounds.maxY}"
				width="${translatedBounds.maxX - translatedBounds.minX}"
				height="${translatedBounds.maxY - translatedBounds.minY}"
				fill="${padFill}"
				fill-opacity="${muted ? 0.15 : 0.3}"
				stroke="${padStroke}"
				stroke-width="1.5"
				vector-effect="non-scaling-stroke"
			/>
		`;

	const label = options?.showDesignator === false
		? ''
		: `
			<text
				x="${component.anchor.x + dx}"
				y="${-(component.anchor.y + dy) - 14}"
				text-anchor="middle"
				font-size="15"
				font-family="Microsoft YaHei UI,Segoe UI,sans-serif"
				font-weight="700"
				fill="${accent === 'current' ? '#ff6b6b' : accent === 'target' ? '#57e29c' : '#f4dc67'}"
				stroke="#2a1720"
				stroke-width="3"
				paint-order="stroke"
				vector-effect="non-scaling-stroke"
			>${escapeHtml(component.designator)}</text>
		`;

	const haloColor = accent === 'current'
		? '#ff4a4a'
		: accent === 'target'
			? '#29cc7b'
			: '#77a7ff';

	return `
		<g
			class="review-hotspot ${accent ? `accent-${accent}` : ''}"
			data-review-nav="${navigationKind}"
			${dataComponent}
			tabindex="0"
			role="button"
			aria-label="${escapeHtml(component.designator)}，点击在真实 PCB 中定位"
		>
			<title>${escapeHtml(component.designator)} · 点击在真实 PCB 中定位</title>
			${renderHoverHalo(translatedBounds, haloColor)}
			${pads}
			${label}
		</g>
	`;
}

function renderLocalPcb(
	scene: LayoutReviewScene,
	region: CanvasRegion,
	mode: 'current' | 'proposed',
): string {
	const width = Math.max(1, region.right - region.left);
	const height = Math.max(1, region.bottom - region.top);
	const viewBox = `${region.left} ${-region.bottom} ${width} ${height}`;
	const subjectId = scene.subject.id;

	const traces = scene.traces
		.filter(trace => traceIntersectsRegion(trace, region))
		.map(trace => `
			<line
				x1="${trace.startX}" y1="${-trace.startY}"
				x2="${trace.endX}" y2="${-trace.endY}"
				stroke="${traceColor(trace.layer)}"
				stroke-width="${Math.max(1, trace.width)}"
				stroke-opacity=".68"
				stroke-linecap="round"
				vector-effect="non-scaling-stroke"
			/>
		`).join('');

	const vias = scene.vias
		.filter(via => viaIntersectsRegion(via, region))
		.map(via => `
			<circle cx="${via.x}" cy="${-via.y}" r="${Math.max(4, via.diameter / 2)}"
				fill="#222a31" stroke="#9aa4ad" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
			<circle cx="${via.x}" cy="${-via.y}" r="${Math.max(1.5, via.diameter * 0.18)}"
				fill="#0f1418"/>
		`).join('');

	const components = scene.components
		.filter(component =>
			component.id !== subjectId
			&& boundsIntersectRegion(component.bounds, region)
		)
		.map(component =>
			renderComponent(component, {
				muted: component.id !== scene.owner?.id,
				accent: component.id === scene.owner?.id ? 'owner' : undefined,
				navigationKind: 'component',
			})
		).join('');

	const subject = mode === 'current'
		? renderComponent(scene.subject, {
			accent: 'current',
			navigationKind: 'current',
		})
		: renderComponent(scene.subject, {
			dx: scene.item.to.x - scene.subject.anchor.x,
			dy: scene.item.to.y - scene.subject.anchor.y,
			accent: 'target',
			navigationKind: 'target',
		});

	const statusColor = mode === 'current' ? '#d74444' : '#24a66a';
	const statusText = mode === 'current' ? 'BEFORE' : 'AFTER';

	return `
		<svg class="focused-vector-svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" role="img">
			<rect x="${region.left}" y="${-region.bottom}" width="${width}" height="${height}" fill="#52051d"/>
			<g opacity=".62">${traces}${vias}</g>
			<g>${components}</g>
			${subject}
			<g pointer-events="none" transform="translate(${region.left + 18} ${-(region.top + 18)})">
				<rect x="0" y="0" width="92" height="24" rx="4" fill="${statusColor}" fill-opacity=".95"/>
				<text x="46" y="17" text-anchor="middle" font-size="13" font-family="Segoe UI,sans-serif"
					font-weight="700" fill="#fff">${statusText}</text>
			</g>
		</svg>
	`;
}

function renderStructuredOverview(scene: LayoutReviewScene): string {
	const regions = buildFocusedReviewRegions(scene);
	const width = regions.overview.right - regions.overview.left;
	const height = regions.overview.bottom - regions.overview.top;
	const markerSize = Math.max(28, Math.min(56, Math.max(width, height) * 0.018));
	const currentX = scene.subject.anchor.x;
	const currentY = scene.subject.anchor.y;
	const targetX = scene.item.to.x;
	const targetY = scene.item.to.y;
	const outer = scene.boardOuter.map(point => `${point.x},${-point.y}`).join(' ');

	const navMarker = (
		kind: 'current' | 'target',
		x: number,
		y: number,
		color: string,
		label: string,
	) => `
		<g class="review-hotspot minimap-marker"
			data-review-nav="${kind}"
			tabindex="0"
			role="button"
			aria-label="${escapeHtml(label)}，点击在真实 PCB 中定位">
			<title>${escapeHtml(label)} · 点击在真实 PCB 中定位</title>
			<rect class="review-focus-halo"
				x="${x - markerSize * 0.85}"
				y="${-y - markerSize * 0.85}"
				width="${markerSize * 1.7}"
				height="${markerSize * 1.7}"
				rx="${markerSize * 0.18}"
				fill="${color}"
				fill-opacity=".08"
				stroke="${color}"
				stroke-width="3"
				stroke-dasharray="8 5"
				vector-effect="non-scaling-stroke"/>
			<rect
				x="${x - markerSize / 2}"
				y="${-y - markerSize / 2}"
				width="${markerSize}"
				height="${markerSize}"
				rx="${markerSize * 0.13}"
				fill="${color}"
				stroke="#ffffff"
				stroke-width="2"
				vector-effect="non-scaling-stroke"/>
		</g>
	`;

	return `
		<svg class="focused-vector-overview interactive"
			viewBox="${regions.overview.left} ${-regions.overview.bottom} ${width} ${height}"
			preserveAspectRatio="xMidYMid meet"
			role="img">
			<rect x="${regions.overview.left}" y="${-regions.overview.bottom}" width="${width}" height="${height}" fill="#2d3035"/>
			<polygon points="${outer}" fill="#64132b" stroke="#c8b057" stroke-width="3" vector-effect="non-scaling-stroke"/>
			<line x1="${currentX}" y1="${-currentY}" x2="${targetX}" y2="${-targetY}"
				stroke="#cfd5da" stroke-width="2" stroke-dasharray="9 7" vector-effect="non-scaling-stroke"/>
			${navMarker('current', currentX, currentY, '#d74444', `CURRENT · ${scene.item.subjectDesignator}`)}
			${navMarker('target', targetX, targetY, '#24a66a', `TARGET · ${scene.item.subjectDesignator}`)}
		</svg>
	`;
}

export function renderFocusedLocalDetailCompare(input: {
	scene: LayoutReviewScene;
}): string {
	const regions = buildFocusedReviewRegions(input.scene);
	const scale = `${regions.focusWidthMil.toFixed(0)} × ${regions.focusHeightMil.toFixed(0)} mil`;

	return `
		<div class="focused-placement-review local-detail interactive-review">
			<section class="focused-overview-card">
				<div class="focused-section-head">
					<div>
						<strong>整板导航</strong>
						<span>红色旧位置 → 绿色建议位置；点击方块直接跳到真实 PCB</span>
					</div>
				</div>
				<div class="focused-overview-image-wrap">${renderStructuredOverview(input.scene)}</div>
			</section>

			<div class="focused-compare-grid">
				<section class="focused-compare-pane current">
					<div class="focused-pane-head">
						<div>
							<span class="focused-kicker current">BEFORE</span>
							<strong>${escapeHtml(input.scene.item.subjectDesignator)} 当前位置</strong>
						</div>
						<span class="focused-scale">同尺度 · ${escapeHtml(scale)}</span>
					</div>
					<div class="focused-pane-image-wrap vector">${renderLocalPcb(input.scene, regions.current, 'current')}</div>
					<div class="focused-pane-caption">器件本体直接用红色 Footprint 表示；悬停显示定位框，点击跳到真实 PCB</div>
				</section>

				<section class="focused-compare-pane proposed">
					<div class="focused-pane-head">
						<div>
							<span class="focused-kicker proposed">AFTER</span>
							<strong>${escapeHtml(input.scene.item.subjectDesignator)} → near(${escapeHtml(input.scene.item.ownerDesignator)})</strong>
						</div>
						<span class="focused-scale">同尺度 · ${escapeHtml(scale)}</span>
					</div>
					<div class="focused-pane-image-wrap vector">${renderLocalPcb(input.scene, regions.proposed, 'proposed')}</div>
					<div class="focused-pane-caption">绿色真实 Pad Footprint = 建议位置；点击它可直接跳到 Target 在真实 PCB 中核对</div>
				</section>
			</div>
		</div>
	`;
}
