export interface OwnershipCapabilityHit {
	source: string;
	path: string;
	valuePreview?: string;
}

const OWNERSHIP_KEY_PATTERN =
	/(?:group|reuse|block|channel|module|owner|ownership|cluster|belong|attach)/i;

export function isOwnershipCapabilityKey(value: string): boolean {
	return OWNERSHIP_KEY_PATTERN.test(value);
}

function previewValue(value: unknown): string | undefined {
	if (
		typeof value === 'string'
		|| typeof value === 'number'
		|| typeof value === 'boolean'
	) {
		return String(value).slice(0, 120);
	}

	if (value === null) {
		return 'null';
	}

	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value)
		&& typeof value === 'object'
		&& !Array.isArray(value);
}

export function findOwnershipFields(
	value: unknown,
	source: string,
	maxDepth = 3,
): OwnershipCapabilityHit[] {
	const hits: OwnershipCapabilityHit[] = [];
	const visited = new Set<unknown>();

	function walk(current: unknown, path: string, depth: number): void {
		if (depth > maxDepth || current === null || current === undefined) {
			return;
		}

		if (
			typeof current !== 'object'
			&& typeof current !== 'function'
		) {
			return;
		}

		if (visited.has(current)) {
			return;
		}
		visited.add(current);

		if (Array.isArray(current)) {
			current.slice(0, 20).forEach((item, index) =>
				walk(item, `${path}[${index}]`, depth + 1),
			);
			return;
		}

		if (!isRecord(current)) {
			return;
		}

		for (const [key, item] of Object.entries(current)) {
			const childPath = path ? `${path}.${key}` : key;

			if (isOwnershipCapabilityKey(key)) {
				hits.push({
					source,
					path: childPath,
					valuePreview: previewValue(item),
				});
			}

			if (depth < maxDepth) {
				walk(item, childPath, depth + 1);
			}
		}
	}

	walk(value, '', 0);

	return hits;
}

export function findOwnershipMemberNames(
	value: unknown,
	source: string,
	maxPrototypeDepth = 4,
): OwnershipCapabilityHit[] {
	if (
		value === null
		|| value === undefined
		|| (typeof value !== 'object' && typeof value !== 'function')
	) {
		return [];
	}

	const names = new Set<string>();
	let current: object | null = value as object;
	let depth = 0;

	while (current && depth <= maxPrototypeDepth) {
		try {
			for (const name of Object.getOwnPropertyNames(current)) {
				if (isOwnershipCapabilityKey(name)) {
					names.add(name);
				}
			}
			current = Object.getPrototypeOf(current);
		}
		catch {
			break;
		}
		depth += 1;
	}

	return Array.from(names)
		.sort()
		.map(name => ({
			source,
			path: name,
		}));
}

export function filterOwnershipPropertyNames(
	propertyNames: string[],
): string[] {
	return Array.from(
		new Set(
			propertyNames
				.filter(isOwnershipCapabilityKey)
				.map(name => name.trim())
				.filter(Boolean),
		),
	).sort();
}
