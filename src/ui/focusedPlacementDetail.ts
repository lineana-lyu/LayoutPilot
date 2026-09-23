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
	const opacity = muted ? 0.54 : 0.92;

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
				x="${component.bounds.minX + dx}"
				y="${-(component.bounds.maxY + dy)}"
				width="${component.bounds.maxX - component.bounds.minX}"
				height="${component.bounds.maxY - component.bounds.minY}"
				fill="${padFill}"
				fill-opacity="${muted ? 0.16 : 0.28}"
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

	return `<g>${pads}${label}</g>`;
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
			})
		).join('');

	const subject = mode === 'current'
		? renderComponent(scene.subject, { accent: 'current' })
		: renderComponent(scene.subject, {
			dx: scene.item.to.x - scene.subject.anchor.x,
			dy: scene.item.to.y - scene.subject.anchor.y,
			accent: 'target',
		});

	const focus = mode === 'current'
		? scene.subject.anchor
		: scene.item.to;
	const accent = mode === 'current' ? '#ff3f3f' : '#21c879';
	const focusTitle = mode === 'current' ? 'CURRENT' : 'PROPOSED';

	return `
		<svg class="focused-vector-svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" role="img">
			<rect x="${region.left}" y="${-region.bottom}" width="${width}" height="${height}" fill="#52051d"/>
			<g opacity=".62">${traces}${vias}</g>
			<g>${components}</g>
			<circle cx="${focus.x}" cy="${-focus.y}" r="${Math.max(72, Math.min(width, height) * 0.14)}"
				fill="${accent}" fill-opacity=".10" stroke="${accent}" stroke-opacity=".9"
				stroke-width="4" stroke-dasharray="10 7" vector-effect="non-scaling-stroke"/>
			<circle cx="${focus.x}" cy="${-focus.y}" r="${Math.max(42, Math.min(width, height) * 0.08)}"
				fill="none" stroke="${accent}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
			${subject}
			<g transform="translate(${focus.x} ${-focus.y})">
				<rect x="-58" y="-86" width="116" height="28" rx="5" fill="${accent}" fill-opacity=".96"/>
				<text x="0" y="-67" text-anchor="middle" font-size="16" font-family="Segoe UI,sans-serif"
					font-weight="700" fill="#fff">${focusTitle} · ${escapeHtml(scene.item.subjectDesignator)}</text>
			</g>
		</svg>
	`;
}

export function renderFocusedLocalDetailCompare(input: {
	scene: LayoutReviewScene;
	overviewUrl?: string;
}): string {
	const regions = buildFocusedReviewRegions(input.scene);
	const scale = `${regions.focusWidthMil.toFixed(0)} × ${regions.focusHeightMil.toFixed(0)} mil`;
	const overview = input.overviewUrl
		? `<img class="focused-native-image overview" src="${escapeHtml(input.overviewUrl)}" alt="整板定位图" draggable="false"/>`
		: `
			<svg class="focused-vector-overview" viewBox="${regions.overview.left} ${-regions.overview.bottom} ${regions.overview.right - regions.overview.left} ${regions.overview.bottom - regions.overview.top}">
				<rect x="${regions.overview.left}" y="${-regions.overview.bottom}"
					width="${regions.overview.right - regions.overview.left}"
					height="${regions.overview.bottom - regions.overview.top}" fill="#52051d"/>
				<circle cx="${input.scene.subject.anchor.x}" cy="${-input.scene.subject.anchor.y}" r="38" fill="#ff4545"/>
				<circle cx="${input.scene.item.to.x}" cy="${-input.scene.item.to.y}" r="38" fill="#24c978"/>
			</svg>
		`;

	return `
		<div class="focused-placement-review local-detail">
			<section class="focused-overview-card">
				<div class="focused-section-head">
					<div>
						<strong>整板定位</strong>
						<span>只看“从哪里 → 到哪里”；真正判断布局看下面两张局部图</span>
					</div>
				</div>
				<div class="focused-overview-image-wrap">${overview}</div>
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
					<div class="focused-pane-caption">红色双环 + 红色 Footprint = 当前待移动器件</div>
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
					<div class="focused-pane-caption">旧器件位置已从建议图移除；绿色双环 + 绿色真实 Pad Footprint = 建议位置</div>
				</section>
			</div>
		</div>
	`;
}
