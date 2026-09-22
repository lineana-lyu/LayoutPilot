export interface EvidencePad {
	padNumber: string;
	net?: string;
	x: number;
	y: number;
}

export interface EvidenceComponent {
	id: string;
	designator: string;
	pads: EvidencePad[];
}

export interface SharedRailPadEvidence {
	netName: string;
	subjectPadNumber: string;
	ownerPadNumber: string;
	subjectX: number;
	subjectY: number;
	ownerX: number;
	ownerY: number;
	distanceMil: number;
}

export function buildClosestSharedRailPadEvidence(
	subject: EvidenceComponent,
	owner: EvidenceComponent,
	railNets: string[],
): SharedRailPadEvidence | undefined {
	const railSet = new Set(railNets.filter(Boolean));
	let best: SharedRailPadEvidence | undefined;

	for (const subjectPad of subject.pads) {
		if (!subjectPad.net || !railSet.has(subjectPad.net)) continue;

		for (const ownerPad of owner.pads) {
			if (ownerPad.net !== subjectPad.net) continue;

			const distanceMil = Math.hypot(
				subjectPad.x - ownerPad.x,
				subjectPad.y - ownerPad.y,
			);
			if (!Number.isFinite(distanceMil)) continue;

			const candidate: SharedRailPadEvidence = {
				netName: subjectPad.net,
				subjectPadNumber: subjectPad.padNumber,
				ownerPadNumber: ownerPad.padNumber,
				subjectX: subjectPad.x,
				subjectY: subjectPad.y,
				ownerX: ownerPad.x,
				ownerY: ownerPad.y,
				distanceMil,
			};

			if (!best || candidate.distanceMil < best.distanceMil) {
				best = candidate;
			}
		}
	}

	return best;
}
