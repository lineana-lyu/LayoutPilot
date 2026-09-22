import { buildCandidateGroups } from '../domain/candidateGrouping';
import { buildCircuitGraph, type CircuitComponentSnapshot } from '../domain/circuitGraph';
import { extractStructuralFeatures, type ComponentMetadata } from '../domain/componentFeatures';
import {
	buildSemanticContexts,
	type SemanticComponentMetadata,
} from '../domain/semanticContext';

export async function collectAnalysisState() {
	const components = await eda.pcb_PrimitiveComponent.getAll();
	const snapshots: CircuitComponentSnapshot[] = [];
	const metadata: ComponentMetadata[] = [];
	const semanticMetadata: SemanticComponentMetadata[] = [];

	for (const component of components) {
		const primitiveId = component.getState_PrimitiveId();
		const designator = component.getState_Designator()
			?? component.getState_Name()
			?? primitiveId;
		const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(
			primitiveId,
		);
		const footprint = component.getState_Footprint();

		snapshots.push({
			id: primitiveId,
			designator,
			name: component.getState_Name(),
			padCount: pads?.length ?? 0,
			pads: (pads ?? []).map(pad => ({
				padNumber: String(pad.getState_PadNumber() ?? '?'),
				net: pad.getState_Net(),
			})),
		});

		const commonMeta = {
			id: primitiveId,
			designator,
			manufacturer: component.getState_Manufacturer(),
			supplier: component.getState_Supplier(),
			footprintName: footprint?.name,
		};

		metadata.push(commonMeta);
		semanticMetadata.push({
			...commonMeta,
			name: component.getState_Name(),
			otherProperty: component.getState_OtherProperty(),
		});
	}

	const graph = buildCircuitGraph(snapshots);
	const features = extractStructuralFeatures(graph, metadata);
	const grouping = buildCandidateGroups(graph, features);
	const contexts = buildSemanticContexts(
		graph,
		features,
		grouping,
		semanticMetadata,
	);

	return {
		graph,
		features,
		grouping,
		contexts,
		semanticMetadata,
	};
}

export type AnalysisState = Awaited<ReturnType<typeof collectAnalysisState>>;
