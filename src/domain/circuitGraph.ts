export interface CircuitPadEndpoint {
	componentId: string;
	designator: string;
	padNumber: string;
	net: string;
}

export interface CircuitComponentSnapshot {
	id: string;
	designator: string;
	name?: string;
	padCount: number;
	pads: Array<{
		padNumber: string;
		net?: string;
	}>;
}

export interface CircuitNet {
	name: string;
	endpoints: CircuitPadEndpoint[];
	componentIds: string[];
}

export interface CircuitGraphNode {
	id: string;
	designator: string;
	name?: string;
	padCount: number;
	connectedNetCount: number;
	neighborComponentIds: string[];
	isIsolated: boolean;
}

export interface CircuitGraph {
	nodes: CircuitGraphNode[];
	nets: CircuitNet[];
}

export function buildCircuitGraph(
	components: CircuitComponentSnapshot[],
): CircuitGraph {
	const netEndpoints = new Map<string, CircuitPadEndpoint[]>();

	for (const component of components) {
		for (const pad of component.pads) {
			const net = pad.net?.trim();
			if (!net || net.toLowerCase() === 'none') {
				continue;
			}

			const endpoints = netEndpoints.get(net) ?? [];
			endpoints.push({
				componentId: component.id,
				designator: component.designator,
				padNumber: pad.padNumber,
				net,
			});
			netEndpoints.set(net, endpoints);
		}
	}

	const nets: CircuitNet[] = Array.from(netEndpoints.entries())
		.map(([name, endpoints]) => ({
			name,
			endpoints,
			componentIds: Array.from(new Set(endpoints.map(endpoint => endpoint.componentId))),
		}))
		.sort((a, b) => b.componentIds.length - a.componentIds.length || a.name.localeCompare(b.name));

	const nodeNetNames = new Map<string, Set<string>>();
	const nodeNeighbors = new Map<string, Set<string>>();

	for (const net of nets) {
		for (const componentId of net.componentIds) {
			const netNames = nodeNetNames.get(componentId) ?? new Set<string>();
			netNames.add(net.name);
			nodeNetNames.set(componentId, netNames);

			const neighbors = nodeNeighbors.get(componentId) ?? new Set<string>();
			for (const otherComponentId of net.componentIds) {
				if (otherComponentId !== componentId) {
					neighbors.add(otherComponentId);
				}
			}
			nodeNeighbors.set(componentId, neighbors);
		}
	}

	const nodes: CircuitGraphNode[] = components.map(component => {
		const connectedNetCount = nodeNetNames.get(component.id)?.size ?? 0;
		const neighborComponentIds = Array.from(nodeNeighbors.get(component.id) ?? []);

		return {
			id: component.id,
			designator: component.designator,
			name: component.name,
			padCount: component.padCount,
			connectedNetCount,
			neighborComponentIds,
			isIsolated: connectedNetCount === 0,
		};
	});

	return { nodes, nets };
}
