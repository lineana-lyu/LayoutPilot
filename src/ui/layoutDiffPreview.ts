import type {
	LayoutDiffPreviewMode,
	LayoutReviewScene,
} from '../domain/layoutDiffPreview';

function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function rectSvg(
	bounds: { minX: number; minY: number; maxX: number; maxY: number },
	attributes: string,
): string {
	return `<rect x="${bounds.minX}" y="${-bounds.maxY}" width="${Math.max(0.1, bounds.maxX - bounds.minX)}" height="${Math.max(0.1, bounds.maxY - bounds.minY)}" ${attributes}/>`;
}

function polygonPoints(points: Array<{ x: number; y: number }>): string {
	return points.map(point => `${point.x},${-point.y}`).join(' ');
}

function center(bounds: {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}): { x: number; y: number } {
	return {
		x: (bounds.minX + bounds.maxX) / 2,
		y: (bounds.minY + bounds.maxY) / 2,
	};
}

export function renderLayoutDiffPreviewSvg(
	scene: LayoutReviewScene,
	mode: LayoutDiffPreviewMode,
): string {
	const { viewport, item } = scene;
	const viewWidth = Math.max(1, viewport.right - viewport.left);
	const viewHeight = Math.max(1, viewport.bottom - viewport.top);
	const viewBox = `${viewport.left} ${-viewport.bottom} ${viewWidth} ${viewHeight}`;
	const labelFontSize = Math.max(
		18,
		Math.min(42, Math.max(viewWidth, viewHeight) * 0.026),
	);
	const labelHeight = labelFontSize * 1.7;
	const subjectIds = new Set([item.subjectId, item.ownerId]);

	const board = `
		<polygon points="${polygonPoints(scene.boardOuter)}" fill="#f5f6f7" stroke="#aeb5bd" stroke-width="3" vector-effect="non-scaling-stroke"/>
		${scene.boardHoles.map(hole =>
			`<polygon points="${polygonPoints(hole)}" fill="#ffffff" stroke="#c5cbd1" stroke-width="2" vector-effect="non-scaling-stroke"/>`
		).join('')}
	`;

	const traces = scene.traces.map(trace =>
		`<line x1="${trace.startX}" y1="${-trace.startY}" x2="${trace.endX}" y2="${-trace.endY}" stroke="#9aa1a9" stroke-opacity=".42" stroke-width="${Math.max(1.2, Math.min(8, trace.width))}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
	).join('');

	const vias = scene.vias.map(via =>
		`<circle cx="${via.x}" cy="${-via.y}" r="${Math.max(2, via.diameter / 2)}" fill="none" stroke="#959ca4" stroke-opacity=".48" stroke-width="1.3" vector-effect="non-scaling-stroke"/>`
	).join('');

	const contextComponents = scene.components
		.filter(component => !subjectIds.has(component.id))
		.map(component =>
			rectSvg(
				component.bounds,
				'fill="#dfe3e7" fill-opacity=".62" stroke="#9ea5ad" stroke-width="1.2" vector-effect="non-scaling-stroke"',
			)
		)
		.join('');

	const owner = scene.owner
		? rectSvg(
			scene.owner.bounds,
			'fill="#d5d9de" fill-opacity=".72" stroke="#666f78" stroke-width="2.2" vector-effect="non-scaling-stroke"',
		)
		: '';

	const current = mode === 'proposed'
		? ''
		: rectSvg(
			item.fromBounds,
			mode === 'original'
				? 'fill="#87929d" fill-opacity=".2" stroke="#56616c" stroke-width="3" vector-effect="non-scaling-stroke"'
				: 'fill="none" stroke="#69737e" stroke-width="2.4" stroke-dasharray="8 5" vector-effect="non-scaling-stroke"',
		);

	const targetColor = item.executionBlockers.length ? '#d88716' : '#2f72d6';
	const target = mode === 'original'
		? ''
		: rectSvg(
			item.toBounds,
			`fill="${targetColor}" fill-opacity=".22" stroke="${targetColor}" stroke-width="4" vector-effect="non-scaling-stroke"`,
		);

	const currentCenter = center(item.fromBounds);
	const targetCenter = center(item.toBounds);
	const ownerCenter = scene.owner ? center(scene.owner.bounds) : undefined;

	const arrow = mode === 'diff'
		? `<line x1="${currentCenter.x}" y1="${-currentCenter.y}" x2="${targetCenter.x}" y2="${-targetCenter.y}" stroke="${targetColor}" stroke-width="2.4" stroke-dasharray="7 5" marker-end="url(#lp-arrow)" vector-effect="non-scaling-stroke"/>`
		: '';

	const label = (
		text: string,
		x: number,
		y: number,
		kind: 'muted' | 'target' = 'muted',
	) => {
		const width = Math.max(
			labelFontSize * 4.8,
			text.length * labelFontSize * 0.62,
		);
		const inset = labelFontSize * 0.8;
		const localLeft = -labelFontSize * 0.3;
		const clampedX = Math.max(
			viewport.left + inset - localLeft,
			Math.min(
				x,
				viewport.right - inset - width - localLeft,
			),
		);
		const clampedY = Math.max(
			viewport.top + inset,
			Math.min(
				y,
				viewport.bottom - inset - labelHeight,
			),
		);
		return `
		<g transform="translate(${clampedX} ${-clampedY})">
			<rect x="${-labelFontSize * 0.3}" y="${-labelHeight}" width="${width}" height="${labelHeight}" rx="${labelFontSize * 0.22}"
				fill="${kind === 'target' ? targetColor : '#ffffff'}"
				fill-opacity="${kind === 'target' ? '.94' : '.92'}"
				stroke="${kind === 'target' ? targetColor : '#aab1b8'}"
				vector-effect="non-scaling-stroke"/>
			<text x="${labelFontSize * 0.2}" y="${-labelFontSize * 0.38}" font-size="${labelFontSize}" font-family="Microsoft YaHei UI,Segoe UI,sans-serif"
				fill="${kind === 'target' ? '#ffffff' : '#505962'}">${escapeHtml(text)}</text>
		</g>`;
	};

	const labels = [
		mode !== 'proposed'
			? label(`CURRENT · ${item.subjectDesignator}`, currentCenter.x, currentCenter.y, 'muted')
			: '',
		mode !== 'original'
			? label(`TARGET · ${item.subjectDesignator}`, targetCenter.x, targetCenter.y, 'target')
			: '',
		ownerCenter
			? label(`OWNER · ${item.ownerDesignator}`, ownerCenter.x, ownerCenter.y, 'muted')
			: '',
	].join('');

	return `
		<svg class="layout-diff-svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" role="img"
			aria-label="${escapeHtml(item.subjectDesignator)} 布局差异预览">
			<defs>
				<marker id="lp-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
					<path d="M0,0 L9,4.5 L0,9 z" fill="${targetColor}"/>
				</marker>
			</defs>
			<rect x="${viewport.left}" y="${-viewport.bottom}" width="${viewWidth}" height="${viewHeight}" fill="#eef0f2"/>
			${board}
			${traces}
			${vias}
			${contextComponents}
			${owner}
			${current}
			${arrow}
			${target}
			${labels}
		</svg>
	`;
}
