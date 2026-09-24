import { endPcbEvidenceReview } from '../eda/pcbPhysicalAdapter';
import {
	getStoredEvidenceReviewSession,
	setStoredEvidenceReviewSession,
} from '../eda/workflowStore';

export async function retireEvidenceInspection(): Promise<boolean> {
	const session = getStoredEvidenceReviewSession();
	if (!session) {
		return false;
	}

	try {
		await endPcbEvidenceReview({
			documentTabId: session.documentTabId,
			originalSelectionIds: session.originalSelectionIds,
		});
	}
	finally {
		await setStoredEvidenceReviewSession(undefined);
	}

	return true;
}
