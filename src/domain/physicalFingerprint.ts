import type { BoardPolygon, BoardRegion } from './boardBoundary';
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

function compareSequence(a: string[], b: string[]): number {
	const length = Math.min(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const compared = a[index].localeCompare(b[index]);
		if (compared !== 0) return compared;
	}
	return a.length - b.length;
}

function minimalRotation(points: string[]): string[] {
	if (points.length <= 1) return [...points];

	let best = 0;
	for (let candidate = 1; candidate < points.length; candidate += 1) {
		for (let offset = 0; offset < points.length; offset += 1) {
			const left = points[(candidate + offset) % points.length];
			const right = points[(best + offset) % points.length];
			const compared = left.localeCompare(right);
			if (compared < 0) {
				best = candidate;
				break;
			}
			if (compared > 0) break;
		}
	}

	return points.map((_, index) =>
		points[(best + index) % points.length]
	);
}

function canonicalPolygon(polygon: BoardPolygon): string[] {
	const points = polygon.points.map(point =>
		`${numeric(point.x)}:${numeric(point.y)}`,
	);

	if (
		points.length > 1
		&& points[0] === points[points.length - 1]
	) {
		points.pop();
	}

	const forward = minimalRotation(points);
	const reversed = minimalRotation([...points].reverse());

	return compareSequence(forward, reversed) <= 0
		? forward
		: reversed;
}

export function buildPhysicalBoardFingerprint(input: {
	components: PhysicalComponentSnapshot[];
	board: BoardRegion;
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
		board: {
			outer: canonicalPolygon(input.board.outer),
			approximationToleranceMil: numeric(input.board.approximationToleranceMil),
			holes: input.board.holes
				.map(canonicalPolygon)
				.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
		},
		keepouts,
	});

	return `phys-v1-${hashText(canonical)}`;
}
