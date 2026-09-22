import extensionConfig from '../../extension.json' with { type: 'json' };

import { endPcbEvidenceReview } from '../eda/pcbPhysicalAdapter';
import {
	getStoredEvidenceReviewSession,
	setStoredEvidenceReviewSession,
} from '../eda/workflowStore';
import { openLayoutPilotWorkbench } from './workbenchWindow';

function currentReviewBarId(): string {
	const version = String(extensionConfig.version ?? 'unknown')
		.replace(/[^a-zA-Z0-9_-]/g, '-');
	return `layoutpilot-evidence-review-${version}`;
}

async function cleanupReviewSession(): Promise<void> {
	const session = getStoredEvidenceReviewSession();
	if (!session) return;

	try {
		await endPcbEvidenceReview({
			documentTabId: session.documentTabId,
			originalSelectionIds: session.originalSelectionIds,
		});
	}
	finally {
		await setStoredEvidenceReviewSession(undefined);
	}
}

export async function retireEvidenceReviewBar(): Promise<void> {
	await cleanupReviewSession();
	try {
		await eda.sys_IFrame.closeIFrame(currentReviewBarId());
	}
	catch {
		// No existing review window is a normal state.
	}
}

export async function openEvidenceReviewBar(): Promise<void> {
	const reviewBarId = currentReviewBarId();
	const viewport = eda.sys_Window.getViewportSize();
	const width = Math.max(560, Math.min(760, viewport.width - 80));
	const height = 142;
	const x = Math.max(16, Math.round((viewport.width - width) / 2));
	const y = Math.max(48, viewport.height - height - 72);

	const opened = await eda.sys_IFrame.openIFrame(
		'/iframe/evidence-review.html',
		width,
		height,
		reviewBarId,
		{
			title: 'LayoutPilot · 证据核对',
			maximizeButton: false,
			minimizeButton: false,
			grayscaleMask: false,
			x,
			y,
			onBeforeCloseCallFn: async () => {
				await cleanupReviewSession();
				await openLayoutPilotWorkbench();
				return true;
			},
		},
	);

	if (!opened) {
		throw new Error('嘉立创EDA未能打开 LayoutPilot 证据核对条。');
	}
}

export async function closeEvidenceReviewBarAndReturn(): Promise<void> {
	await cleanupReviewSession();
	await eda.sys_IFrame.closeIFrame(currentReviewBarId());
	await openLayoutPilotWorkbench();
}
