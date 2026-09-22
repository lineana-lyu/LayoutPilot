import type { BoardPolygon } from './boardBoundary';
import type { PhysicalComponentSnapshot } from './physicalPlacement';

function hashText(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function numeric(value: number | undefined): string | null {
	return Number.isFinite(value)
		? Number(value).toFixed(3)
		: null;
}

function canonicalPolygon(polygon: BoardPolygon): string[] {
	return polygon.points.map(point =>
		`${numeric(point.x)}:${numeric(point.y)}`,
	);
}

export function buildPhysicalBoardFingerprint(input: {
	components: PhysicalComponentSnapshot[];
	board: BoardPolygon;
	componentKeepouts: BoardPolygon[];
}): string {
	const components = [...input.components]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map(component => ({
			id: component.id,
			designator: component.designator,
			x: numeric(component.x),
			y: numeric(component.y),
			rotation: numeric(component.rotation),
			layer: component.layer,
			locked: component.locked,
			bounds: component.bounds
				? {
					minX: numeric(component.bounds.minX),
					minY: numeric(component.bounds.minY),
					maxX: numeric(component.bounds.maxX),
					maxY: numeric(component.bounds.maxY),
				}
				: null,
			pads: [...component.pads]
				.sort((a, b) =>
					a.padNumber.localeCompare(b.padNumber)
					|| String(a.net ?? '').localeCompare(String(b.net ?? '')),
				)
				.map(pad => ({
					padNumber: pad.padNumber,
					net: pad.net ?? null,
					x: numeric(pad.x),
					y: numeric(pad.y),
					width: numeric(pad.width),
					height: numeric(pad.height),
					rotation: numeric(pad.rotation),
					connectedPrimitiveCount: pad.connectedPrimitiveCount ?? null,
				})),
		}));

	const keepouts = input.componentKeepouts
		.map(canonicalPolygon)
		.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

	const canonical = JSON.stringify({
		components,
		board: canonicalPolygon(input.board),
		keepouts,
	});

	return `phys-v1-${hashText(canonical)}`;
}
