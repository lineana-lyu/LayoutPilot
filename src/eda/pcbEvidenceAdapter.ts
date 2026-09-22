export interface PadGeometry {
	componentId: string;
	designator: string;
	padNumber: string;
	net?: string;
	x: number;
	y: number;
}

export interface SharedNetPadEvidence {
	netName: string;
	subjectPadNumber: string;
	ownerPadNumber: string;
	subjectX: number;
	subjectY: number;
	ownerX: number;
	ownerY: number;
	distanceMil: number;
}

async function readComponentPads(
	componentId: string,
): Promise<PadGeometry[]> {
	const component = await eda.pcb_PrimitiveComponent.get(componentId);
	if (!component) {
		return [];
	}
	const designator = component.getState_Designator()
		?? component.getState_Name()
		?? componentId;
	const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(
		componentId,
	);
	return (pads ?? []).map(pad => ({
		componentId,
		designator,
		padNumber: String(pad.getState_PadNumber() ?? '?'),
		net: pad.getState_Net(),
		x: pad.getState_X(),
		y: pad.getState_Y(),
	}));
}

export async function collectNearestSharedNetPadEvidence(input: {
	subjectComponentId: string;
	ownerComponentId: string;
	netNames: string[];
}): Promise<SharedNetPadEvidence[]> {
	const [subjectPads, ownerPads] = await Promise.all([
		readComponentPads(input.subjectComponentId),
		readComponentPads(input.ownerComponentId),
	]);

	const evidence: SharedNetPadEvidence[] = [];
	for (const netName of input.netNames) {
		const subjectOnNet = subjectPads.filter(pad => pad.net === netName);
		const ownerOnNet = ownerPads.filter(pad => pad.net === netName);
		let best: SharedNetPadEvidence | undefined;

		for (const subjectPad of subjectOnNet) {
			for (const ownerPad of ownerOnNet) {
				const distanceMil = Math.hypot(
					subjectPad.x - ownerPad.x,
					subjectPad.y - ownerPad.y,
				);
				if (!best || distanceMil < best.distanceMil) {
					best = {
						netName,
						subjectPadNumber: subjectPad.padNumber,
						ownerPadNumber: ownerPad.padNumber,
						subjectX: subjectPad.x,
						subjectY: subjectPad.y,
						ownerX: ownerPad.x,
						ownerY: ownerPad.y,
						distanceMil,
					};
				}
			}
		}

		if (best) {
			evidence.push(best);
		}
	}

	return evidence.sort((a, b) => a.distanceMil - b.distanceMil);
}

export async function focusPcbComponents(input: {
	componentIds: string[];
	markerEvidence?: SharedNetPadEvidence[];
}): Promise<void> {
	const componentIds = [...new Set(input.componentIds.filter(Boolean))];
	if (!componentIds.length) {
		throw new Error('没有可定位的 PCB 器件。');
	}

	await eda.pcb_SelectControl.clearSelected();
	const selected = await eda.pcb_SelectControl.doSelectPrimitives(componentIds);
	if (!selected) {
		throw new Error('嘉立创EDA未能选中目标器件。');
	}

	try {
		await eda.dmt_EditorControl.removeIndicatorMarkers();
	}
	catch (error) {
		console.warn('[LayoutPilot] unable to clear previous PCB markers', error);
	}

	const markers = (input.markerEvidence ?? []).slice(0, 2).flatMap(item => [
		{
			type: EDMT_IndicatorMarkerType.CIRCLE,
			x: item.subjectX,
			y: item.subjectY,
			r: 24,
		},
		{
			type: EDMT_IndicatorMarkerType.CIRCLE,
			x: item.ownerX,
			y: item.ownerY,
			r: 24,
		},
		{
			type: EDMT_IndicatorMarkerType.LINE,
			startX: item.subjectX,
			startY: item.subjectY,
			endX: item.ownerX,
			endY: item.ownerY,
		},
	]);

	if (markers.length) {
		try {
			await eda.dmt_EditorControl.generateIndicatorMarkers(
				markers,
				{ r: 26, g: 111, b: 189, alpha: 0.95 },
				3,
				false,
			);
		}
		catch (error) {
			console.warn('[LayoutPilot] unable to draw PCB evidence markers', error);
		}
	}

	const zoomed = await eda.dmt_EditorControl.zoomToSelectedPrimitives();
	if (zoomed === false) {
		throw new Error('嘉立创EDA未能缩放到所选器件。');
	}
}
