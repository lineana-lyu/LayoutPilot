import { createHumanOwnershipDecision } from './domain/humanOwnershipDecision';
import { buildSemanticBoardFingerprint } from './domain/semanticSnapshot';
import { collectAnalysisState } from './eda/analysisAdapter';
import {
	getStoredEvidenceReviewSession,
	inspectStoredWorkflowState,
	upsertStoredHumanOwnershipDecision,
} from './eda/workflowStore';
import { closeEvidenceReviewBarAndReturn } from './ui/evidenceReviewWindow';

const title = document.getElementById('title') as HTMLDivElement;
const meta = document.getElementById('meta') as HTMLDivElement;
const evidence = document.getElementById('evidence') as HTMLDivElement;
const status = document.getElementById('status') as HTMLDivElement;
const returnBtn = document.getElementById('returnBtn') as HTMLButtonElement;
const confirmBtn = document.getElementById('confirmBtn') as HTMLButtonElement;

function setBusy(value: boolean): void {
	returnBtn.disabled = value;
	if (value) {
		confirmBtn.disabled = true;
		return;
	}
	render();
}

function render(): void {
	const session = getStoredEvidenceReviewSession();
	if (!session) {
		title.textContent = '核对会话已结束';
		meta.textContent = '';
		evidence.textContent = '';
		confirmBtn.disabled = true;
		return;
	}

	const workflow = inspectStoredWorkflowState();
	const activeDecision = workflow.humanOwnershipDecisions.find(decision =>
		decision.snapshotId === session.snapshotId
		&& decision.componentId === session.subjectId
	);
	const sameOwnerConfirmed =
		activeDecision?.ownerComponentId === session.ownerId;

	title.textContent = `${session.subjectDesignator} ↔ ${session.ownerDesignator}`;
	meta.textContent = sameOwnerConfirmed
		? `电源域：${session.railLabel} · 当前 Owner 已确认，画布仅用于复核证据`
		: activeDecision
			? `电源域：${session.railLabel} · 当前 Owner 为 ${activeDecision.ownerDesignator}，确认后将改为 ${session.ownerDesignator}`
			: `电源域：${session.railLabel} · 这里只读核对，不会自动确认 Owner`;
	confirmBtn.textContent = sameOwnerConfirmed
		? 'Owner 已确认'
		: activeDecision
			? '改为此 Owner'
			: '确认 Owner';
	confirmBtn.disabled = sameOwnerConfirmed;

	if (session.powerEvidence) {
		const item = session.powerEvidence;
		evidence.textContent = [
			item.netName,
			`${session.subjectDesignator}.${item.subjectPadNumber}`,
			'↔',
			`${session.ownerDesignator}.${item.ownerPadNumber}`,
			'·',
			`${item.distanceMil.toFixed(1)} mil 直线距离`,
		].join(' ');
	}
	else {
		evidence.textContent = '当前没有可用的共享电源 Pad 距离证据。';
	}
}

returnBtn.addEventListener('click', async () => {
	if (returnBtn.disabled) return;
	setBusy(true);
	try {
		await closeEvidenceReviewBarAndReturn();
	}
	catch (error) {
		status.textContent = `返回失败：${String(error)}`;
		setBusy(false);
	}
});

confirmBtn.addEventListener('click', async () => {
	if (confirmBtn.disabled) return;
	setBusy(true);
	status.textContent = '';

	try {
		const session = getStoredEvidenceReviewSession();
		const workflow = inspectStoredWorkflowState();
		const snapshot = workflow.semanticSnapshot;

		if (!session || !snapshot) {
			throw new Error('当前没有可确认的证据会话。');
		}
		if (session.snapshotId !== snapshot.id) {
			throw new Error('Semantic Snapshot 已变化，请返回工作台重新核对。');
		}

		const analysis = await collectAnalysisState();
		const currentFingerprint = buildSemanticBoardFingerprint({
			graph: analysis.graph,
			contexts: analysis.contexts,
		});
		if (
			currentFingerprint !== session.boardFingerprint
			|| currentFingerprint !== snapshot.boardFingerprint
		) {
			throw new Error('PCB 语义状态已经变化，旧证据不能继续用于 Owner 确认。');
		}

		await upsertStoredHumanOwnershipDecision(
			createHumanOwnershipDecision({
				snapshotId: snapshot.id,
				componentId: session.subjectId,
				componentDesignator: session.subjectDesignator,
				ownerComponentId: session.ownerId,
				ownerDesignator: session.ownerDesignator,
			}),
		);

		await closeEvidenceReviewBarAndReturn();
	}
	catch (error) {
		status.textContent = String(error);
		setBusy(false);
	}
});

render();
