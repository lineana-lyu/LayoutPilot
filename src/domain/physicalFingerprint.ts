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

function lexicographicCompare(a: string[], b: string[]): number {
	const length = Math.min(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const compared = a[index].localeCompare(b[index]);
		if (compared !== 0) return compared;
	}
	return a.length - b.length;
}

function rotateRing(values: string[], start: number): string[] {
	return values.map((_, index) =>
		values[(start + index) % values.length]
	);
}

function canonicalRing(values: string[]): string[] {
	if (values.length <= 1) return [...values];

	const normalized = [...values];
	if (
		normalized.length > 1
		&& normalized[0] === normalized[normalized.length - 1]
	) {
		normalized.pop();
	}
	if (normalized.length <= 1) return normalized;

	let best: string[] | undefined;
	const consider = (candidate: string[]) => {
		if (!best || lexicographicCompare(candidate, best) < 0) {
			best = candidate;
		}
	};

	for (let start = 0; start < normalized.length; start += 1) {
		consider(rotateRing(normalized, start));
	}

	const reversed = [...normalized].reverse();
	for (let start = 0; start < reversed.length; start += 1) {
		consider(rotateRing(reversed, start));
	}

	return best ?? normalized;
}

function canonicalPolygon(polygon: BoardPolygon): string[] {
	return canonicalRing(
		polygon.points.map(point =>
			`${numeric(point.x)}:${numeric(point.y)}`,
		),
	);
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
					|| String(a.net ?? '').localeCompare(String(b.net ?? ''))
					|| a.x - b.x
					|| a.y - b.y
					|| a.width - b.width
					|| a.height - b.height
					|| a.rotation - b.rotation,
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

	return `phys-v2-${hashText(canonical)}`;
}
