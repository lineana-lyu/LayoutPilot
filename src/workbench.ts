import { buildConstraintEvaluation } from './application/constraintEvaluation';
import { createHumanOwnershipDecision } from './domain/humanOwnershipDecision';
import {
	buildSemanticBoardFingerprint,
	semanticSnapshotMatchesBoard,
} from './domain/semanticSnapshot';
import { resolveComponentDisplayName } from './domain/semanticContext';
import type { OwnershipRelationType } from './domain/ownershipRelation';
import type { SemanticConfidence, SemanticRole } from './domain/semanticInference';
import { buildClosestSharedRailPadEvidence, type SharedRailPadEvidence } from './domain/physicalEvidence';
import { createEvidenceReviewSession } from './domain/evidenceReviewSession';
import { collectAnalysisState, type AnalysisState } from './eda/analysisAdapter';
import { beginPcbEvidenceReview, collectPadEvidenceComponents, endPcbEvidenceReview } from './eda/pcbPhysicalAdapter';
import {
	getLayoutPilotWorkbenchSizeMode,
	hideLayoutPilotWorkbench,
	resizeLayoutPilotWorkbench,
	type LayoutPilotWorkbenchSizeMode,
} from './ui/workbenchWindow';
import { openEvidenceReviewBar, retireEvidenceReviewBar } from './ui/evidenceReviewWindow';
import {
	getStoredHumanOwnershipDecisions,
	inspectStoredWorkflowState,
	setStoredEvidenceReviewSession,
	removeStoredHumanOwnershipDecision,
	upsertStoredHumanOwnershipDecision,
} from './eda/workflowStore';
import {
	layoutConstraintTypeZh,
	ownershipRelationZh,
	semanticConfidenceZh,
	semanticRoleZh,
} from './i18n/zhCN';
import {
	applyDemoPlacement,
	configureAiGateway,
	runSemanticAnalysis,
	undoLastDemoPlacement,
} from './index';

interface HostCandidate {
	id: string;
	designator: string;
	name?: string;
	manufacturer?: string;
	footprint?: string;
	evidenceLines: string[];
	powerPadEvidence?: SharedRailPadEvidence;
}

interface OwnerTask {
	componentId: string;
	designator: string;
	role: SemanticRole;
	confidence: SemanticConfidence;
	relation: OwnershipRelationType;
	rail: string;
	railNets: string[];
	candidates: HostCandidate[];
	selectedOwnerId?: string;
	selectedOwnerDesignator?: string;
	ownershipExplanation: string;
}

interface RuntimeModel {
	analysis?: AnalysisState;
	boardFingerprint?: string;
	stale: boolean;
	tasks: OwnerTask[];
	constraintCount: number;
	previewEligibleCount: number;
	evaluation?: ReturnType<typeof buildConstraintEvaluation>;
}

const el = <T extends HTMLElement>(id: string): T => {
	const node = document.getElementById(id);
	if (!node) {
		throw new Error(`Missing workbench element: ${id}`);
	}
	return node as T;
};

const taskList = el<HTMLDivElement>('taskList');
const mainPanel = el<HTMLElement>('mainPanel');
const planPanel = el<HTMLDivElement>('planPanel');
const loading = el<HTMLDivElement>('loading');
const toast = el<HTMLDivElement>('toast');
const analyzeBtn = el<HTMLButtonElement>('analyzeBtn');
const applyBtn = el<HTMLButtonElement>('applyBtn');
const undoBtn = el<HTMLButtonElement>('undoBtn');
const refreshBtn = el<HTMLButtonElement>('refreshBtn');
const gatewayBtn = el<HTMLButtonElement>('gatewayBtn');
const sizeCompactBtn = el<HTMLButtonElement>('sizeCompactBtn');
const sizeStandardBtn = el<HTMLButtonElement>('sizeStandardBtn');
const sizeWideBtn = el<HTMLButtonElement>('sizeWideBtn');
const footerNote = el<HTMLDivElement>('footerNote');

let selectedComponentId: string | undefined;
let lastWorkflowUpdatedAt = '';
let busy = false;

function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function setBusy(value: boolean): void {
	busy = value;
	loading.classList.toggle('show', value);
	analyzeBtn.disabled = value;
	refreshBtn.disabled = value;
	sizeCompactBtn.disabled = value;
	sizeStandardBtn.disabled = value;
	sizeWideBtn.disabled = value;
}

function syncWindowSizeButtons(): void {
	const mode = getLayoutPilotWorkbenchSizeMode();
	const entries: Array<[HTMLButtonElement, LayoutPilotWorkbenchSizeMode]> = [
		[sizeCompactBtn, 'compact'],
		[sizeStandardBtn, 'standard'],
		[sizeWideBtn, 'wide'],
	];
	for (const [button, candidate] of entries) {
		button.classList.toggle('active', mode === candidate);
		button.setAttribute('aria-pressed', String(mode === candidate));
	}
}

function showToast(message: string): void {
	toast.textContent = message;
	toast.classList.add('show');
	window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function confidenceRank(value: SemanticConfidence): number {
	return value === 'high' ? 0 : value === 'medium' ? 1 : 2;
}

function setStage(
	id: string,
	state: 'idle' | 'done' | 'active' | 'blocked',
): void {
	const node = el<HTMLDivElement>(id);
	node.classList.remove('done', 'active', 'blocked');
	if (state !== 'idle') node.classList.add(state);
}

async function hydrateTaskPowerEvidence(task: OwnerTask): Promise<void> {
	const evidenceIds = [
		task.componentId,
		...task.candidates.map(candidate => candidate.id),
	];
	const padEvidenceComponents = await collectPadEvidenceComponents(evidenceIds);
	const padEvidenceById = new Map(
		padEvidenceComponents.map(component => [component.id, component]),
	);
	const subjectPhysical = padEvidenceById.get(task.componentId);
	if (!subjectPhysical) {
		return;
	}

	for (const candidate of task.candidates) {
		const ownerPhysical = padEvidenceById.get(candidate.id);
		candidate.powerPadEvidence = ownerPhysical
			? buildClosestSharedRailPadEvidence(
				subjectPhysical,
				ownerPhysical,
				task.railNets,
			)
			: undefined;
	}

	task.candidates.sort((a, b) => {
		const aDistance = a.powerPadEvidence?.distanceMil
			?? Number.POSITIVE_INFINITY;
		const bDistance = b.powerPadEvidence?.distanceMil
			?? Number.POSITIVE_INFINITY;
		return aDistance - bDistance
			|| a.designator.localeCompare(b.designator);
	});
}

function buildRuntimeModel(): Promise<RuntimeModel> {
	return (async () => {
		const workflow = inspectStoredWorkflowState();
		const snapshot = workflow.semanticSnapshot;
		if (!snapshot) {
			return {
				stale: false,
				tasks: [],
				constraintCount: 0,
				previewEligibleCount: 0,
			};
		}

		const analysis = await collectAnalysisState();
		const boardFingerprint = buildSemanticBoardFingerprint({
			graph: analysis.graph,
			contexts: analysis.contexts,
		});
		const stale = !semanticSnapshotMatchesBoard(snapshot, boardFingerprint);
		if (stale) {
			return {
				analysis,
				boardFingerprint,
				stale: true,
				tasks: [],
				constraintCount: 0,
				previewEligibleCount: 0,
			};
		}

		const decisions = getStoredHumanOwnershipDecisions(snapshot.id);
		const evaluation = buildConstraintEvaluation({
			snapshot,
			graph: analysis.graph,
			features: analysis.features,
			grouping: analysis.grouping,
			semanticMetadata: analysis.semanticMetadata,
			humanOwnershipDecisions: decisions,
		});

		const metadataById = new Map(
			analysis.semanticMetadata.map(item => [item.id, item]),
		);
		const nodeByDesignator = new Map(
			analysis.graph.nodes.map(node => [node.designator, node]),
		);
		const decisionByComponentId = new Map(
			decisions.map(decision => [decision.componentId, decision]),
		);

		const eligibleEntries = snapshot.entries.filter(entry =>
			entry.status === 'valid'
				&& entry.inference?.role === 'decoupling-capacitor'
				&& entry.context.ownership.relation === 'rail-domain'
				&& entry.context.ownership.hostDesignators.length > 0,
		);
		const tasks: OwnerTask[] = eligibleEntries
			.filter(entry =>
				entry.status === 'valid'
				&& entry.inference?.role === 'decoupling-capacitor'
				&& entry.context.ownership.relation === 'rail-domain'
				&& entry.context.ownership.hostDesignators.length > 0,
			)
			.map(entry => {
				const decision = decisionByComponentId.get(entry.componentId);
				const candidates = entry.context.ownership.hostDesignators
					.map(designator => nodeByDesignator.get(designator))
					.filter((node): node is NonNullable<typeof node> => Boolean(node))
					.map(node => {
						const meta = metadataById.get(node.id);
						const connectedToCandidate = entry.context.connectedNets
							.filter(net =>
								net.peerEndpoints.some(
									peer => peer.designator === node.designator,
								),
							);
						const evidenceLines = connectedToCandidate
							.sort((a, b) => {
								const aRail = entry.context.ownership.railNets.includes(a.netName)
									? 0
									: a.classification === 'global-ground' ? 1 : 2;
								const bRail = entry.context.ownership.railNets.includes(b.netName)
									? 0
									: b.classification === 'global-ground' ? 1 : 2;
								return aRail - bRail || a.netName.localeCompare(b.netName);
							})
							.map(net => {
								const selfPads = net.selfPads.length
									? net.selfPads
										.slice(0, 2)
										.map(pad => `${entry.designator}.${pad}`)
										.join('/')
									: entry.designator;
								const peerEndpoints = net.peerEndpoints
									.filter(peer => peer.designator === node.designator);
								const visiblePeers = peerEndpoints
									.slice(0, 3)
									.map(peer => `${peer.designator}.${peer.padNumber}`);
								const hiddenCount = Math.max(0, peerEndpoints.length - visiblePeers.length);
								const peerPads = [
									...visiblePeers,
									hiddenCount ? `+${hiddenCount} pads` : '',
								].filter(Boolean).join('/');
								return `${net.netName}：${selfPads} ↔ ${peerPads || node.designator}`;
							})
							.slice(0, 3);

						return {
							id: node.id,
							designator: node.designator,
							name: resolveComponentDisplayName(
								meta?.name,
								meta?.otherProperty,
							),
							manufacturer: meta?.manufacturer,
							footprint: meta?.footprintName,
							evidenceLines,
						};
					})
					.sort((a, b) => a.designator.localeCompare(b.designator));

				return {
					componentId: entry.componentId,
					designator: entry.designator,
					role: entry.inference!.role,
					confidence: entry.inference!.confidence,
					relation: entry.context.ownership.relation,
					rail: entry.context.ownership.railNets.join('、') || '未知电源域',
					railNets: [...entry.context.ownership.railNets],
					candidates,
					selectedOwnerId: decision?.ownerComponentId,
					selectedOwnerDesignator: decision?.ownerDesignator,
					ownershipExplanation: entry.context.ownership.explanation,
				};
			})
			.sort((a, b) => {
				const aConfirmed = a.selectedOwnerId ? 1 : 0;
				const bConfirmed = b.selectedOwnerId ? 1 : 0;
				return aConfirmed - bConfirmed
					|| confidenceRank(a.confidence) - confidenceRank(b.confidence)
					|| a.candidates.length - b.candidates.length
					|| a.designator.localeCompare(b.designator);
			});

		const selectedTask = tasks.find(
			task => task.componentId === selectedComponentId,
		) ?? tasks.find(task => !task.selectedOwnerId) ?? tasks[0];

		if (selectedTask) {
			selectedComponentId = selectedTask.componentId;
			await hydrateTaskPowerEvidence(selectedTask);
		}

		return {
			analysis,
			boardFingerprint,
			stale: false,
			tasks,
			constraintCount: evaluation.merged.proposals.length,
			previewEligibleCount: evaluation.merged.previewEligibleCount,
			evaluation,
		};
	})();
}

function renderEmpty(
	title: string,
	body: string,
	action?: { label: string; id: string },
): void {
	mainPanel.innerHTML = `
		<div class="empty">
			<div>
				<strong>${escapeHtml(title)}</strong>
				<span>${escapeHtml(body)}</span>
				${action ? `<div style="margin-top:14px"><button class="btn primary" id="${action.id}">${escapeHtml(action.label)}</button></div>` : ''}
			</div>
		</div>`;
}

function renderTasks(
	tasks: OwnerTask[],
	model?: RuntimeModel,
): void {
	const pending = tasks.filter(task => !task.selectedOwnerId).length;
	el<HTMLDivElement>('taskCount').textContent = `${pending} 待确认 / ${tasks.length}`;

	if (!tasks.length) {
		taskList.innerHTML = '<div style="padding:12px 10px;color:#737d87;font-size:10px;line-height:1.55">当前没有 rail-domain 去耦器件需要人工确认。</div>';
		return;
	}

	if (!selectedComponentId || !tasks.some(task => task.componentId === selectedComponentId)) {
		selectedComponentId = tasks.find(task => !task.selectedOwnerId)?.componentId
			?? tasks[0].componentId;
	}

	taskList.innerHTML = tasks.map(task => {
		const active = task.componentId === selectedComponentId ? ' active' : '';
		const confirmed = Boolean(task.selectedOwnerId);
		return `
			<button class="task${active}" data-task="${escapeHtml(task.componentId)}">
				<div class="task-row">
					<span class="task-name">${escapeHtml(task.designator)}</span>
					<span class="task-state ${confirmed ? 'ok' : ''}">
						${confirmed ? `Owner ${escapeHtml(task.selectedOwnerDesignator)}` : '待确认'}
					</span>
				</div>
				<div class="task-rail">${escapeHtml(task.rail)} · ${escapeHtml(semanticConfidenceZh(task.confidence))}</div>
			</button>`;
	}).join('');

	for (const node of taskList.querySelectorAll<HTMLButtonElement>('[data-task]')) {
		node.addEventListener('click', async () => {
			selectedComponentId = node.dataset.task;
			const selectedTask = tasks.find(
				task => task.componentId === selectedComponentId,
			);
			if (!selectedTask) return;

			setBusy(true);
			try {
				await hydrateTaskPowerEvidence(selectedTask);
				renderCurrentTask(tasks, model);
				renderTasks(tasks, model);
			}
			finally {
				setBusy(false);
			}
		});
	}
}

function renderConstraintArea(model: RuntimeModel): string {
	const evaluation = model.evaluation;
	if (!evaluation) return '';

	const proposals = evaluation.entries.flatMap(item =>
		(item.result?.proposals ?? []).map(proposal => ({
			proposal,
			humanDecision: item.humanOwnershipDecision,
		})),
	);

	if (proposals.length) {
		return `
			<div class="constraint-area">
				<div class="constraint-summary">
					<span>${proposals.length} 条约束</span>
					<span class="constraint-state">${evaluation.merged.previewEligibleCount} 条可进入物理预检</span>
				</div>
				<div class="constraint-list">
					${proposals.map(({ proposal, humanDecision }) => `
						<div class="constraint-row">
							<div class="constraint-title">${escapeHtml(proposal.subject)} → ${escapeHtml(proposal.target ?? '—')}</div>
							<div class="constraint-meta">
								${escapeHtml(layoutConstraintTypeZh(proposal.type))} ·
								${escapeHtml(semanticConfidenceZh(proposal.confidence))} ·
								${proposal.execution === 'preview-eligible' ? '可进入物理预检' : '仅复核'}
								${humanDecision ? ' · Owner：人工确认' : ''}
							</div>
						</div>
					`).join('')}
				</div>
			</div>`;
	}

	const pending = model.tasks.filter(task => !task.selectedOwnerId).length;
	const sharedSignal = evaluation.entries.filter(item =>
		item.entry.status === 'valid'
			&& item.entry.inference?.role === 'decoupling-capacitor'
			&& item.context.ownership.relation === 'shared-signal',
	).length;
	const unsupported = evaluation.entries.filter(item =>
		item.result?.skipped[0]?.reason === 'no-policy-for-role',
	).length;

	return `
		<div class="constraint-area">
			<div class="blocked">
				<strong>尚无可进入物理预检的约束</strong><br/>
				${pending ? `${pending} 个去耦电容只有 rail-domain 证据，尚未确认唯一 Owner。` : '当前证据尚未满足 Constraint Policy。'}
				${sharedSignal ? `<br/>${sharedSignal} 个去耦器件属于 shared-signal / 多 Host，系统不会强制归属。` : ''}
				${unsupported ? `<br/>${unsupported} 个语义角色尚未建立可落地布局策略。` : ''}
			</div>
			<details>
				<summary>策略诊断</summary>
				<div class="diagnostics">${escapeHtml(
					evaluation.entries
						.filter(item => item.result?.skipped.length)
						.slice(0, 12)
						.map(item => {
							const reason = item.result?.skipped[0]?.reason ?? 'unknown';
							return `${item.context.designator}: ${reason}`;
						})
						.join('\n'),
				)}</div>
			</details>
		</div>`;
}

function renderPlanPanel(model?: RuntimeModel): void {
	if (!model?.evaluation) {
		planPanel.innerHTML = '<div class="empty"><div><strong>暂无布局约束</strong><span>完成必要的 Owner 确认后，这里会显示约束。</span></div></div>';
		return;
	}

	planPanel.innerHTML = `
		<div class="plan-overview">
			<div class="plan-stat">
				<strong>${model.constraintCount}</strong>
				<span>已生成约束</span>
			</div>
			<div class="plan-stat">
				<strong>${model.previewEligibleCount}</strong>
				<span>可进入物理预检</span>
			</div>
		</div>
		${renderConstraintArea(model)}
	`;
}

function renderCurrentTask(tasks: OwnerTask[], model?: RuntimeModel): void {
	const task = tasks.find(item => item.componentId === selectedComponentId);
	if (!task) {
		if (model?.evaluation) {
			mainPanel.innerHTML = `
				<div class="detail">
					<div class="hero">
						<div class="hero-copy">
							<div class="hero-title">当前没有待确认 Owner 的去耦器件</div>
							<div class="hero-sub">约束计划已移到右侧独立区域；窄屏时会显示在当前详情下方。</div>
						</div>
					</div>
					<div class="inline-plan">${renderConstraintArea(model)}</div>
				</div>`;
		}
		return;
	}

	mainPanel.innerHTML = `
		<div class="detail">
			<div class="hero">
				<div class="ref">${escapeHtml(task.designator)}</div>
				<div class="hero-copy">
					<div class="hero-title">${escapeHtml(semanticRoleZh(task.role))} · ${escapeHtml(semanticConfidenceZh(task.confidence))}</div>
					<div class="hero-sub">
						确定性关系：${escapeHtml(ownershipRelationZh(task.relation))}<br/>
						${task.selectedOwnerDesignator
							? `已确认 Owner：${escapeHtml(task.selectedOwnerDesignator)}`
							: '系统只能确认它属于一个电源域，不能从电源网本身推断唯一 Owner。'}
					</div>
				</div>
				<span class="badge ${task.selectedOwnerId ? 'ok' : 'pending'}">${task.selectedOwnerId ? '已确认' : '需要人工证据'}</span>
			</div>
			<div class="facts">
				<div class="fact"><div class="fact-label">电源域</div><div class="fact-value">${escapeHtml(task.rail)}</div></div>
				<div class="fact"><div class="fact-label">Host 候选</div><div class="fact-value">${task.candidates.length} 个</div></div>
				<div class="fact"><div class="fact-label">AI 置信</div><div class="fact-value">${escapeHtml(semanticConfidenceZh(task.confidence))}</div></div>
				<div class="fact"><div class="fact-label">当前 Owner</div><div class="fact-value">${escapeHtml(task.selectedOwnerDesignator ?? '未确认')}</div></div>
			</div>
			<div class="block">
				<div class="block-title">选择实际服务的 Host</div>
				<div class="note">候选来自确定性拓扑，不是 AI 推荐。${escapeHtml(task.ownershipExplanation)} 卡片按最近共享电源 Pad 的直线几何距离排列，仅用于核对顺序，不代表 Owner 推荐；该距离也不是走线长度或 SI/PI 指标。只有你能确认实际服务关系时才补充 Owner。</div>
				<div class="host-grid">
					${task.candidates.map(candidate => {
						const selected = candidate.id === task.selectedOwnerId;
						const primaryName = candidate.name && candidate.name !== candidate.designator
							? candidate.name
							: '器件名称未解析';
						const evidenceLines = candidate.evidenceLines.length
							? candidate.evidenceLines
							: [`${task.rail}：与 ${task.designator} 同处 rail-domain`];
						const distance = candidate.powerPadEvidence;
						return `
							<div class="host ${selected ? 'selected' : ''}">
								<div class="host-top">
									<span class="host-ref">${escapeHtml(candidate.designator)}</span>
									<span class="host-name">${escapeHtml(primaryName)}</span>
									${selected ? '<span class="badge ok" style="margin-left:auto">当前 Owner</span>' : ''}
								</div>
								<div class="host-meta">${escapeHtml([candidate.manufacturer, candidate.footprint].filter(Boolean).join(' · ') || '制造商 / 封装信息不足')}</div>
								${distance ? `
									<div class="host-distance">
										${escapeHtml(distance.netName)} ·
										${escapeHtml(task.designator)}.${escapeHtml(distance.subjectPadNumber)}
										↔
										${escapeHtml(candidate.designator)}.${escapeHtml(distance.ownerPadNumber)}
										· ${distance.distanceMil.toFixed(1)} mil 直线距离
									</div>` : ''}
								<div class="host-evidence">
									<strong>拓扑证据</strong>
									${evidenceLines.map(line => `<span class="evidence-line">${escapeHtml(line)}</span>`).join('')}
								</div>
								<div class="host-actions">
									<button class="btn small" data-locate-owner="${escapeHtml(candidate.id)}">定位核对（切回 PCB）</button>
									<button class="btn small ${selected ? '' : 'primary'}" data-confirm-owner="${escapeHtml(candidate.id)}">${selected ? '已确认 Owner' : '确认 Owner'}</button>
								</div>
							</div>`;
					}).join('')}
				</div>
				${task.selectedOwnerId ? '<div style="margin-top:8px"><button class="btn danger" id="clearOwnerBtn">清除人工确认</button></div>' : ''}
			</div>
			<div class="inline-plan">${model ? renderConstraintArea(model) : ''}</div>
		</div>`;

	for (const node of mainPanel.querySelectorAll<HTMLButtonElement>('[data-confirm-owner]')) {
		node.addEventListener('click', async () => {
			const ownerId = node.dataset.confirmOwner;
			const candidate = task.candidates.find(item => item.id === ownerId);
			const workflow = inspectStoredWorkflowState();
			const snapshot = workflow.semanticSnapshot;
			if (!candidate || !snapshot) return;

			await upsertStoredHumanOwnershipDecision(
				createHumanOwnershipDecision({
					snapshotId: snapshot.id,
					componentId: task.componentId,
					componentDesignator: task.designator,
					ownerComponentId: candidate.id,
					ownerDesignator: candidate.designator,
				}),
			);
			showToast(`${task.designator} → ${candidate.designator} 已记录为人工证据`);
			await refresh();
		});
	}

	for (const node of mainPanel.querySelectorAll<HTMLButtonElement>('[data-locate-owner]')) {
		node.addEventListener('click', async () => {
			const ownerId = node.dataset.locateOwner;
			const candidate = task.candidates.find(item => item.id === ownerId);
			const workflow = inspectStoredWorkflowState();
			const snapshot = workflow.semanticSnapshot;
			if (!candidate || !snapshot || !model?.boardFingerprint) return;

			setBusy(true);
			let reviewContext:
				| { documentTabId: string; originalSelectionIds: string[] }
				| undefined;
			try {
				await retireEvidenceReviewBar();
				reviewContext = await beginPcbEvidenceReview({
					subjectId: task.componentId,
					subjectDesignator: task.designator,
					ownerId: candidate.id,
					ownerDesignator: candidate.designator,
					powerEvidence: candidate.powerPadEvidence,
				});

				await setStoredEvidenceReviewSession(
					createEvidenceReviewSession({
						snapshotId: snapshot.id,
						boardFingerprint: model.boardFingerprint,
						subjectId: task.componentId,
						subjectDesignator: task.designator,
						ownerId: candidate.id,
						ownerDesignator: candidate.designator,
						railLabel: task.rail,
						powerEvidence: candidate.powerPadEvidence,
						documentTabId: reviewContext.documentTabId,
						originalSelectionIds: reviewContext.originalSelectionIds,
					}),
				);

				await openEvidenceReviewBar();
				await hideLayoutPilotWorkbench();
			}
			catch (error) {
				try {
					await retireEvidenceReviewBar();
				}
				catch (cleanupError) {
					console.warn(
						'[LayoutPilot Workbench] unable to retire failed evidence review',
						cleanupError,
					);
					if (reviewContext) {
						await endPcbEvidenceReview(reviewContext);
					}
					await setStoredEvidenceReviewSession(undefined);
				}
				console.error('[LayoutPilot Workbench] PCB evidence review failed', error);
				showToast(`PCB 定位失败：${String(error)}`);
			}
			finally {
				setBusy(false);
			}
		});
	}

	const clearBtn = document.getElementById('clearOwnerBtn');
	clearBtn?.addEventListener('click', async () => {
		const snapshot = inspectStoredWorkflowState().semanticSnapshot;
		if (!snapshot) return;
		await removeStoredHumanOwnershipDecision(snapshot.id, task.componentId);
		showToast(`${task.designator} 的人工 Owner 已清除`);
		await refresh();
	});
}
async function refresh(): Promise<void> {
	if (busy) return;
	setBusy(true);
	try {
		const workflow = inspectStoredWorkflowState();
		lastWorkflowUpdatedAt = workflow.updatedAt;

		el<HTMLDivElement>('metricAnalyzed').textContent =
			String(workflow.semanticSnapshot?.entries.length ?? 0);

		if (!workflow.semanticSnapshot) {
			el<HTMLDivElement>('stageAnalyzeMeta').textContent = '等待分析';
			el<HTMLDivElement>('stageOwnerMeta').textContent = '等待证据';
			el<HTMLDivElement>('stageConstraintMeta').textContent = '0 条约束';
			el<HTMLDivElement>('stageExecuteMeta').textContent = '尚未执行';
			planPanel.innerHTML = '<div class="empty"><div><strong>暂无布局计划</strong><span>先完成 PCB 语义分析。</span></div></div>';
			el<HTMLDivElement>('metricPending').textContent = '0';
			el<HTMLDivElement>('metricConstraints').textContent = '0';
			el<HTMLDivElement>('taskCount').textContent = '未分析';
			taskList.innerHTML = '';
			setStage('stageAnalyze', 'active');
			setStage('stageOwner', 'idle');
			setStage('stageConstraint', 'idle');
			setStage('stageExecute', 'idle');
			applyBtn.disabled = true;
			undoBtn.disabled = true;
			footerNote.textContent = '先运行 AI 语义分析，工作台会持续保留结果。';
			renderEmpty(
				'还没有 Semantic Snapshot',
				'点击“重新分析”读取当前 PCB，并冻结一份可复用的 AI 决策快照。',
				{ label: '开始分析', id: 'emptyAnalyzeBtn' },
			);
			document.getElementById('emptyAnalyzeBtn')?.addEventListener('click', () => analyzeBtn.click());
			return;
		}

		const model = await buildRuntimeModel();
		if (model.stale) {
			el<HTMLDivElement>('stageAnalyzeMeta').textContent = 'Snapshot 已过期';
			el<HTMLDivElement>('stageOwnerMeta').textContent = '等待重新分析';
			el<HTMLDivElement>('stageConstraintMeta').textContent = '不可复用';
			el<HTMLDivElement>('stageExecuteMeta').textContent = '执行已阻止';
			planPanel.innerHTML = '<div class="blocked"><strong>Semantic Snapshot 已过期</strong><br/>当前 PCB 语义发生变化，旧约束不能进入物理预检。</div>';
			el<HTMLDivElement>('metricPending').textContent = '—';
			el<HTMLDivElement>('metricConstraints').textContent = '—';
			el<HTMLDivElement>('taskCount').textContent = 'Snapshot 已过期';
			taskList.innerHTML = '';
			setStage('stageAnalyze', 'blocked');
			setStage('stageOwner', 'idle');
			setStage('stageConstraint', 'idle');
			setStage('stageExecute', 'idle');
			applyBtn.disabled = true;
			renderEmpty(
				'当前 PCB 已发生语义变化',
				'旧 Snapshot 不再作为执行依据。请重新分析当前 PCB。',
				{ label: '重新分析', id: 'staleAnalyzeBtn' },
			);
			document.getElementById('staleAnalyzeBtn')?.addEventListener('click', () => analyzeBtn.click());
			return;
		}

		const pending = model.tasks.filter(task => !task.selectedOwnerId).length;
		const confirmed = model.tasks.length - pending;
		el<HTMLDivElement>('stageAnalyzeMeta').textContent = `${workflow.semanticSnapshot.entries.length} 个语义器件`;
		el<HTMLDivElement>('stageOwnerMeta').textContent = `${confirmed}/${model.tasks.length} 已确认`;
		el<HTMLDivElement>('stageConstraintMeta').textContent = `${model.constraintCount} 条 · ${model.previewEligibleCount} 可预检`;
		el<HTMLDivElement>('metricPending').textContent = String(pending);
		el<HTMLDivElement>('metricConstraints').textContent = String(model.constraintCount);
		renderTasks(model.tasks, model);
		renderCurrentTask(model.tasks, model);
		renderPlanPanel(model);

		setStage('stageAnalyze', 'done');
		setStage('stageOwner', pending > 0 ? 'active' : 'done');
		setStage(
			'stageConstraint',
			model.constraintCount > 0 ? 'done' : (pending > 0 ? 'blocked' : 'active'),
		);

		const command = workflow.lastPlacementCommand;
		el<HTMLDivElement>('stageExecuteMeta').textContent = command?.status === 'applied'
			? `${command.componentDesignator} 已移动 · 可撤销`
			: command?.status === 'undone'
				? `${command.componentDesignator} 已撤销`
				: model.previewEligibleCount > 0
					? `${model.previewEligibleCount} 条建议待预检`
					: '尚无可预检建议';
		setStage(
			'stageExecute',
			command?.status === 'applied'
				? 'active'
				: command?.status === 'undone'
					? 'done'
					: model.previewEligibleCount > 0
						? 'active'
						: 'idle',
		);

		applyBtn.disabled = model.previewEligibleCount === 0;
		undoBtn.disabled = command?.status !== 'applied';

		const firstProvider = workflow.semanticSnapshot.entries
			.find(entry => entry.provider || entry.model);
		footerNote.textContent = [
			workflow.semanticSnapshot.id,
			firstProvider
				? `${firstProvider.provider ?? 'unknown'} / ${firstProvider.model ?? 'unknown'}`
				: '',
			model.boardFingerprint ?? '',
		].filter(Boolean).join(' · ');
	}
	catch (error) {
		console.error('[LayoutPilot Workbench] refresh failed', error);
		renderEmpty('工作台刷新失败', String(error));
	}
	finally {
		setBusy(false);
	}
}

analyzeBtn.addEventListener('click', async () => {
	if (busy) return;
	setBusy(true);
	try {
		const result = await runSemanticAnalysis();
		if (result) {
			selectedComponentId = undefined;
			showToast(`分析完成：${result.passed}/${result.total} 通过校验`);
		}
	}
	catch (error) {
		console.error('[LayoutPilot Workbench] analysis failed', error);
		showToast(`分析失败：${String(error)}`);
	}
	finally {
		setBusy(false);
		await refresh();
	}
});

refreshBtn.addEventListener('click', () => refresh());

gatewayBtn.addEventListener('click', () => {
	configureAiGateway();
});

applyBtn.addEventListener('click', async () => {
	if (busy || applyBtn.disabled) return;
	setBusy(true);
	try {
		await applyDemoPlacement();
	}
	finally {
		setBusy(false);
		await refresh();
	}
});

undoBtn.addEventListener('click', async () => {
	if (busy || undoBtn.disabled) return;
	setBusy(true);
	try {
		await undoLastDemoPlacement();
	}
	finally {
		setBusy(false);
		await refresh();
	}
});

window.setInterval(() => {
	if (busy) return;
	const workflow = inspectStoredWorkflowState();
	if (workflow.updatedAt !== lastWorkflowUpdatedAt) {
		void refresh();
	}
}, 1500);

void refresh();
