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
import { createLayoutPreviewSession } from './domain/layoutPreviewSession';
import {
	layoutPlanAcceptanceMode,
	type LayoutPlan,
} from './domain/layoutPlan';
import {
	formatLayoutPlanItemReview,
	layoutPlanItemReviewMetrics,
} from './domain/layoutPlanReview';
import {
	type LayoutDiffPreviewMode,
	type LayoutReviewScene,
} from './domain/layoutDiffPreview';
import { collectAnalysisState, type AnalysisState } from './eda/analysisAdapter';
import {
	generateCurrentLayoutPlan,
	validateLayoutPlanCurrent,
	validateStoredLayoutPlanCurrent,
} from './eda/layoutPlanRuntime';
import { collectLayoutReviewScene } from './eda/layoutDiffPreviewAdapter';
import { captureNativeBoardOverview } from './eda/nativeSnapshotReviewAdapter';
import { showLayoutPlanGhost } from './eda/layoutPreviewAdapter';
import { beginPcbEvidenceReview, collectPadEvidenceComponents, endPcbEvidenceReview } from './eda/pcbPhysicalAdapter';
import {
	getLayoutPilotWorkbenchSizeMode,
	hideLayoutPilotWorkbench,
	resizeLayoutPilotWorkbench,
	type LayoutPilotWorkbenchSizeMode,
} from './ui/workbenchWindow';
import { openEvidenceReviewBar, retireEvidenceReviewBar } from './ui/evidenceReviewWindow';
import { clearActiveLayoutPreviewCanvas, openLayoutPreviewBar } from './ui/layoutPreviewWindow';
import { renderFocusedLocalDetailCompare } from './ui/focusedPlacementDetail';
import {
	getStoredHumanOwnershipDecisions,
	inspectStoredWorkflowState,
	setStoredEvidenceReviewSession,
	setStoredLayoutPreviewSession,
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
	layoutPlan?: LayoutPlan;
	referencePlans: LayoutPlan[];
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
const previewPlanBtn = el<HTMLButtonElement>('previewPlanBtn');
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

interface InlineLayoutReviewState {
	plan: LayoutPlan;
	scene: LayoutReviewScene;
	mode: LayoutDiffPreviewMode;
	nativeOverview?: {
		imageUrl: string;
		documentTabId: string;
	};
	fallbackReason?: string;
}

let inlineLayoutReview: InlineLayoutReviewState | undefined;

function releaseInlineLayoutReview(): void {
	const imageUrl = inlineLayoutReview?.nativeOverview?.imageUrl;
	if (imageUrl) {
		URL.revokeObjectURL(imageUrl);
	}
	inlineLayoutReview = undefined;
}

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
				layoutPlan: workflow.layoutPlan,
				referencePlans: workflow.referencePlans,
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
				layoutPlan: workflow.layoutPlan,
				referencePlans: workflow.referencePlans,
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
			layoutPlan: workflow.layoutPlan,
			referencePlans: workflow.referencePlans,
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

function renderInlineLayoutReview(): void {
	const review = inlineLayoutReview;
	if (!review) return;

	const { plan, scene, mode } = review;
	const reviewVisual = renderFocusedLocalDetailCompare({
		scene,
		overviewUrl: review.nativeOverview?.imageUrl,
	});
	const visualSourceLabel = review.nativeOverview
		? 'EasyEDA 整板定位 + 结构化局部高对比'
		: '结构化局部高对比';
	const item = scene.item;
	const metrics = layoutPlanItemReviewMetrics(item);
	const reduction = metrics.reductionPercent;
	const reductionText = reduction === undefined
		? '—'
		: `${Math.abs(reduction).toFixed(1)}%`;
	const reductionLabel = metrics.outcome === 'improved'
		? '降低'
		: metrics.outcome === 'worse'
			? '增加'
			: '基本不变';
	const planMode = layoutPlanAcceptanceMode(plan);
	const planLabel = planMode === 'reference-only'
		? '参考方案'
		: planMode === 'mixed'
			? '混合方案'
			: '可执行方案';

	mainPanel.innerHTML = `
		<div class="layout-review">
			<div class="layout-review-head">
				<div>
					<div class="layout-review-title">布局差异预览 · ${escapeHtml(item.subjectDesignator)} → near(${escapeHtml(item.ownerDesignator)})</div>
					<div class="layout-review-sub">${escapeHtml(planLabel)} · ${escapeHtml(visualSourceLabel)} · 红色为当前位置，绿色为建议位置。</div>
				</div>
				<div class="layout-review-actions">
					<button class="btn" id="reviewBackBtn">返回决策</button>
					<button class="btn" id="reviewRealPcbBtn">在真实 PCB 中核对</button>
				</div>
			</div>

			<div class="layout-review-toolbar">
				<div class="focused-review-hint"><strong>红色 BEFORE，绿色 AFTER</strong><span>左右局部固定同一物理尺度；建议图会移除旧器件并在 Target 位置重建真实 Pad Footprint。</span></div>
				<div class="layout-review-legend">
					<span><i class="legend-chip current-red"></i>当前位置</span>
					<span><i class="legend-chip target-green"></i>建议位置 / Footprint Ghost</span>
					<span><i class="legend-chip muted"></i>原 PCB 上下文</span>
				</div>
			</div>

			<div class="layout-review-canvas">
				${reviewVisual}
			</div>

			<div class="layout-review-metrics">
				<div class="review-metric">
					<span>移动距离</span>
					<strong>${item.movementMil.toFixed(1)} mil</strong>
				</div>
				<div class="review-metric">
					<span>当前几何代理</span>
					<strong>${metrics.beforeLoopProxyMil.toFixed(1)} mil</strong>
				</div>
				<div class="review-metric">
					<span>建议后几何代理</span>
					<strong>${metrics.afterLoopProxyMil.toFixed(1)} mil</strong>
				</div>
				<div class="review-metric">
					<span>${escapeHtml(reductionLabel)}</span>
					<strong>${escapeHtml(reductionText)}</strong>
				</div>
			</div>

			<div class="layout-review-note">
				局部对比不再依赖 EasyEDA 的易缓存局部截图；它直接使用当前 PCB 的真实 Pad、Track、Via 与器件位号构建高清局部。
				${review.nativeOverview ? '上方整板定位仍来自 EasyEDA 原生渲染。' : '原生整板定位图不可用，局部对比仍可正常工作。'}
				建议侧仍是<strong>位置预览</strong>：原走线尚未重布、铺铜尚未重算；真正执行仍必须经过物理预检。
			</div>
		</div>
	`;

	for (const node of mainPanel.querySelectorAll<HTMLButtonElement>('[data-review-mode]')) {
		node.addEventListener('click', () => {
			if (!inlineLayoutReview) return;
			const nextMode = node.dataset.reviewMode as LayoutDiffPreviewMode;
			if (
				nextMode !== 'original'
				&& nextMode !== 'proposed'
				&& nextMode !== 'diff'
			) return;
			inlineLayoutReview = {
				...inlineLayoutReview,
				mode: nextMode,
			};
			renderInlineLayoutReview();
		});
	}

	document.getElementById('reviewBackBtn')?.addEventListener('click', () => {
		releaseInlineLayoutReview();
		void refresh();
	});

	document.getElementById('reviewRealPcbBtn')?.addEventListener('click', async () => {
		if (busy || !inlineLayoutReview) return;
		setBusy(true);
		try {
			const validation = await validateLayoutPlanCurrent(inlineLayoutReview.plan);
			if (!validation.ok) {
				showToast(validation.message);
				return;
			}
			await presentLayoutPlanPreview(inlineLayoutReview.plan);
		}
		catch (error) {
			console.error('[LayoutPilot Workbench] real PCB review failed', error);
			showToast(`真实 PCB 核对失败：${String(error)}`);
		}
		finally {
			setBusy(false);
		}
	});
}

async function openInlineLayoutReview(plan: LayoutPlan): Promise<void> {
	const validation = await validateLayoutPlanCurrent(plan);
	if (!validation.ok) {
		throw new Error(validation.message);
	}

	const scene = await collectLayoutReviewScene(plan, 0);
	let nativeOverview: InlineLayoutReviewState['nativeOverview'];
	let fallbackReason: string | undefined;

	try {
		const captured = await captureNativeBoardOverview(scene);
		const postCaptureValidation = await validateLayoutPlanCurrent(plan);
		if (!postCaptureValidation.ok) {
			throw new Error(postCaptureValidation.message);
		}
		nativeOverview = {
			imageUrl: URL.createObjectURL(captured.overview),
			documentTabId: captured.documentTabId,
		};
	}
	catch (error) {
		fallbackReason = String(error);
		console.warn(
			'[LayoutPilot Workbench] native board overview unavailable; local structured review remains active',
			error,
		);
	}

	releaseInlineLayoutReview();
	inlineLayoutReview = {
		plan,
		scene,
		mode: 'diff',
		nativeOverview,
		fallbackReason,
	};
	renderInlineLayoutReview();
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
			if (inlineLayoutReview) {
				releaseInlineLayoutReview();
			}
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

	const plan = model.layoutPlan;
	const planMode = plan ? layoutPlanAcceptanceMode(plan) : undefined;
	const planStatus = plan
		? plan.status === 'preview'
			? '待确认'
			: plan.status === 'accepted'
				? planMode === 'reference-only'
					? '参考方案已保存'
					: '已接受'
				: plan.status === 'rejected'
					? '已放弃'
					: plan.status === 'applied'
						? '已应用'
						: '已失效'
		: '未生成';
	const preflightEligibleItems = plan?.items.filter(
		item => item.executionBlockers.length === 0,
	).length ?? 0;
	const archivedReferences = model.referencePlans
		.filter(reference => reference.id !== plan?.id)
		.slice(0, 6);

	const planArtifact = plan
		? `
			<div class="constraint-area" style="border-bottom:1px solid var(--line)">
				<div class="constraint-summary">
					<span>当前 LayoutPlan · ${escapeHtml(planStatus)}</span>
					<span class="constraint-state">${plan.items.length} 个位置 · ${preflightEligibleItems} 个可预检</span>
				</div>
				<div class="constraint-list">
					${plan.items.map(item => `
						<div class="constraint-row">
							<div class="constraint-title">${escapeHtml(item.subjectDesignator)} → near(${escapeHtml(item.ownerDesignator)})</div>
							<div class="constraint-meta">
								移动 ${item.movementMil.toFixed(1)} mil ·
								${escapeHtml(formatLayoutPlanItemReview(item))} ·
								${item.executionBlockers.length
									? `仅预览：${escapeHtml(item.executionBlockers[0])}`
									: '可进入物理预检'}
							</div>
						</div>
					`).join('')}
				</div>
				${plan.status === 'preview' || plan.status === 'accepted'
					? '<div style="margin-top:7px"><button class="btn small" data-view-current-plan>工作台预览</button></div>'
					: ''}
			</div>`
		: '';

	const referenceHistory = archivedReferences.length
		? `
			<div class="constraint-area reference-history">
				<div class="constraint-summary">
					<span>已保存参考方案</span>
					<span class="constraint-state">${model.referencePlans.length} 条历史</span>
				</div>
				<div class="constraint-list">
					${archivedReferences.map(reference => {
						const first = reference.items[0];
						return `
							<div class="constraint-row">
								<div class="constraint-title">
									${escapeHtml(first?.subjectDesignator ?? 'Unknown')}
									→ near(${escapeHtml(first?.ownerDesignator ?? 'Unknown')})
								</div>
								<div class="constraint-meta">
									${first ? escapeHtml(formatLayoutPlanItemReview(first)) : '无可显示项'} ·
									${escapeHtml(new Date(reference.createdAt).toLocaleString())}
								</div>
								<div style="margin-top:6px">
									<button class="btn small" data-view-reference-plan="${escapeHtml(reference.id)}">
										工作台预览
									</button>
								</div>
							</div>`;
					}).join('')}
				</div>
			</div>`
		: '';

	planPanel.innerHTML = `
		<div class="plan-overview">
			<div class="plan-stat">
				<strong>${model.constraintCount}</strong>
				<span>已生成约束</span>
			</div>
			<div class="plan-stat">
				<strong>${plan?.items.length ?? 0}</strong>
				<span>当前布局位置</span>
			</div>
			<div class="plan-stat">
				<strong>${model.referencePlans.length}</strong>
				<span>参考方案历史</span>
			</div>
		</div>
		${planArtifact}
		${referenceHistory}
		${renderConstraintArea(model)}
	`;

	const currentPlanPreview = planPanel.querySelector<HTMLButtonElement>(
		'[data-view-current-plan]',
	);
	currentPlanPreview?.addEventListener('click', async () => {
		if (busy || !plan) return;
		setBusy(true);
		try {
			await openInlineLayoutReview(plan);
		}
		catch (error) {
			console.error('[LayoutPilot Workbench] inline current-plan preview failed', error);
			showToast(`工作台预览失败：${String(error)}`);
		}
		finally {
			setBusy(false);
		}
	});

	for (const node of planPanel.querySelectorAll<HTMLButtonElement>(
		'[data-view-reference-plan]',
	)) {
		node.addEventListener('click', async () => {
			if (busy) return;
			const planId = node.dataset.viewReferencePlan;
			const reference = model.referencePlans.find(item => item.id === planId);
			if (!reference) return;

			setBusy(true);
			try {
				await openInlineLayoutReview(reference);
			}
			catch (error) {
				console.error('[LayoutPilot Workbench] reference preview failed', error);
				showToast(`参考方案查看失败：${String(error)}`);
			}
			finally {
				setBusy(false);
			}
		});
	}
}

function renderCurrentTask(tasks: OwnerTask[], model?: RuntimeModel): void {
	const task = tasks.find(item => item.componentId === selectedComponentId);
	if (!task) {
		if (model?.evaluation) {
			mainPanel.innerHTML = `
				<div class="detail">
					<div class="detail-head">
						<div class="detail-copy">
							<div class="detail-title">当前没有待确认 Owner 的去耦器件</div>
							<div class="detail-sub">布局约束可在右侧查看；窄窗口时会显示在当前区域下方。</div>
						</div>
					</div>
					<div class="inline-plan">${renderConstraintArea(model)}</div>
				</div>`;
		}
		return;
	}

	mainPanel.innerHTML = `
		<div class="detail">
			<div class="detail-head">
				<div class="ref">${escapeHtml(task.designator)}</div>
				<div class="detail-copy">
					<div class="detail-title">${escapeHtml(semanticRoleZh(task.role))} · ${escapeHtml(semanticConfidenceZh(task.confidence))}</div>
					<div class="detail-sub">
						确定性关系：${escapeHtml(ownershipRelationZh(task.relation))} ·
						${task.selectedOwnerDesignator
							? `已确认 Owner：${escapeHtml(task.selectedOwnerDesignator)}`
							: '当前只有电源域证据，尚不能确定唯一 Owner。'}
					</div>
				</div>
				<span class="status-text ${task.selectedOwnerId ? 'ok' : ''}">
					${task.selectedOwnerId ? '已确认' : '需要人工证据'}
				</span>
			</div>

			<div class="property-grid">
				<div class="property">
					<div class="property-label">电源域</div>
					<div class="property-value">${escapeHtml(task.rail)}</div>
				</div>
				<div class="property">
					<div class="property-label">Host 候选</div>
					<div class="property-value">${task.candidates.length}</div>
				</div>
				<div class="property">
					<div class="property-label">AI 置信</div>
					<div class="property-value">${escapeHtml(semanticConfidenceZh(task.confidence))}</div>
				</div>
				<div class="property">
					<div class="property-label">当前 Owner</div>
					<div class="property-value">${escapeHtml(task.selectedOwnerDesignator ?? '未确认')}</div>
				</div>
			</div>

			<div class="block">
				<div class="block-heading">
					<div class="block-title">Host 候选</div>
					<div class="block-help">按共享电源 Pad 的当前直线距离排序，仅用于核对，不构成 Owner 推荐。</div>
				</div>
				<div class="note">
					${escapeHtml(task.ownershipExplanation)}
					距离是当前 PCB 几何证据，不是走线长度，也不是 SI/PI 指标。只有明确知道实际服务关系时才确认 Owner。
				</div>

				<div class="host-table">
					<div class="host-table-head">
						<div class="host-cell">Host</div>
						<div class="host-cell">器件 / 封装</div>
						<div class="host-cell">共享电源 Pad</div>
						<div class="host-cell">距离</div>
						<div class="host-cell host-topology">拓扑证据</div>
						<div class="host-cell">操作</div>
					</div>
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
							<div class="host-row ${selected ? 'selected' : ''}">
								<div class="host-cell host-ref-cell">
									<div class="host-ref">${escapeHtml(candidate.designator)}</div>
									${selected ? '<div class="status-text ok" style="margin-top:3px">当前 Owner</div>' : ''}
								</div>
								<div class="host-cell host-device-cell">
									<div class="host-name">${escapeHtml(primaryName)}</div>
									<div class="host-meta">${escapeHtml([candidate.manufacturer, candidate.footprint].filter(Boolean).join(' · ') || '制造商 / 封装信息不足')}</div>
								</div>
								<div class="host-cell host-pad-cell">
									${distance
										? `<div class="pad-evidence">${escapeHtml(distance.netName)} · ${escapeHtml(task.designator)}.${escapeHtml(distance.subjectPadNumber)} ↔ ${escapeHtml(candidate.designator)}.${escapeHtml(distance.ownerPadNumber)}</div>`
										: '<div class="host-meta">暂无可用 Pad 距离证据</div>'}
								</div>
								<div class="host-cell host-distance-cell">
									${distance
										? `<div class="distance-value">${distance.distanceMil.toFixed(1)}</div><div class="distance-unit">mil · 直线</div>`
										: '<div class="host-meta">—</div>'}
								</div>
								<div class="host-cell host-topology">
									<div class="topology">
										${evidenceLines.slice(0, 2).map(line => `<span class="topology-line">${escapeHtml(line)}</span>`).join('')}
									</div>
								</div>
								<div class="host-cell host-actions-cell">
									<div class="host-actions">
										<button class="btn small" data-locate-owner="${escapeHtml(candidate.id)}">定位核对</button>
										<button class="btn small ${selected ? '' : 'primary'}" data-confirm-owner="${escapeHtml(candidate.id)}" ${selected ? 'disabled' : ''}>${selected ? '已确认' : '确认 Owner'}</button>
									</div>
								</div>
							</div>`;
					}).join('')}
				</div>

				${task.selectedOwnerId
					? '<div style="margin-top:8px"><button class="btn danger" id="clearOwnerBtn">清除人工确认</button></div>'
					: ''}
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
			previewPlanBtn.disabled = true;
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
			previewPlanBtn.disabled = true;
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
		const activePlan = model.layoutPlan;
		const activePlanMode = activePlan
			? layoutPlanAcceptanceMode(activePlan)
			: undefined;
		el<HTMLDivElement>('stageConstraintMeta').textContent = activePlan
			? activePlan.status === 'accepted'
				? activePlanMode === 'reference-only'
					? `${activePlan.items.length} 个位置 · 参考方案已保存`
					: `${activePlan.items.length} 个位置 · 方案已接受`
				: activePlan.status === 'preview'
					? `${activePlan.items.length} 个位置 · 待确认`
					: activePlan.status === 'rejected'
						? '方案已放弃 · 可重新规划'
						: `${activePlan.items.length} 个位置 · ${activePlan.status}`
			: model.referencePlans.length
				? `${model.constraintCount} 条约束 · ${model.referencePlans.length} 条参考历史`
				: `${model.constraintCount} 条约束 · 待生成方案`;
		el<HTMLDivElement>('metricPending').textContent = String(pending);
		el<HTMLDivElement>('metricConstraints').textContent = String(model.constraintCount);
		renderTasks(model.tasks, model);
		if (inlineLayoutReview) {
			const reviewPlan = [
				model.layoutPlan,
				...model.referencePlans,
			].find(plan => plan?.id === inlineLayoutReview?.plan.id);
			if (reviewPlan) {
				inlineLayoutReview = {
					...inlineLayoutReview,
					plan: reviewPlan,
				};
				renderInlineLayoutReview();
			}
			else {
				inlineLayoutReview = undefined;
				renderCurrentTask(model.tasks, model);
			}
		}
		else {
			renderCurrentTask(model.tasks, model);
		}
		renderPlanPanel(model);

		setStage('stageAnalyze', 'done');

		const command = workflow.lastPlacementCommand;
		el<HTMLDivElement>('stageExecuteMeta').textContent = command?.status === 'applied'
			? `${command.componentDesignator} 已应用 · 可撤销`
			: command?.status === 'undone'
				? `${command.componentDesignator} 已撤销`
				: activePlan?.status === 'accepted'
					? activePlanMode === 'reference-only'
						? '仅参考 · 不会修改 PCB'
						: '等待物理预检'
					: '尚未进入';

		setStage('stageOwner', pending > 0 ? 'active' : 'done');

		if (command?.status === 'applied') {
			setStage('stageConstraint', 'done');
			setStage('stageExecute', 'done');
		}
		else if (activePlan?.status === 'accepted') {
			setStage('stageConstraint', 'done');
			setStage(
				'stageExecute',
				activePlanMode === 'reference-only' ? 'idle' : 'active',
			);
		}
		else if (activePlan?.status === 'preview') {
			setStage('stageConstraint', 'active');
			setStage('stageExecute', 'idle');
		}
		else {
			setStage(
				'stageConstraint',
				model.constraintCount > 0 ? 'active' : 'idle',
			);
			setStage('stageExecute', 'idle');
		}

		const plan = model.layoutPlan;
		const acceptedPlan = plan?.status === 'accepted';
		const planMode = plan ? layoutPlanAcceptanceMode(plan) : undefined;
		const planHasPreflightCandidate = plan?.items.some(
			item => item.executionBlockers.length === 0,
		) ?? false;

		previewPlanBtn.disabled = model.previewEligibleCount === 0;
		previewPlanBtn.textContent = plan
			? plan.status === 'preview'
				? '工作台预览'
				: plan.status === 'accepted'
					? planMode === 'reference-only'
						? '查看参考方案'
						: '工作台预览'
					: '重新生成布局预览'
			: '生成布局预览';

		applyBtn.disabled = !acceptedPlan || !planHasPreflightCandidate;
		applyBtn.textContent = planMode === 'reference-only'
			? '仅参考 · 不执行'
			: '物理预检并应用';
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

async function changeWorkbenchSize(
	mode: LayoutPilotWorkbenchSizeMode,
): Promise<void> {
	if (busy || getLayoutPilotWorkbenchSizeMode() === mode) return;
	setBusy(true);
	try {
		await resizeLayoutPilotWorkbench(mode);
	}
	catch (error) {
		console.error('[LayoutPilot Workbench] resize failed', error);
		showToast(`窗口切换失败：${String(error)}`);
		syncWindowSizeButtons();
		setBusy(false);
	}
}

sizeCompactBtn.addEventListener('click', () => {
	void changeWorkbenchSize('compact');
});
sizeStandardBtn.addEventListener('click', () => {
	void changeWorkbenchSize('standard');
});
sizeWideBtn.addEventListener('click', () => {
	void changeWorkbenchSize('wide');
});

async function presentLayoutPlanPreview(plan: LayoutPlan): Promise<void> {
	await clearActiveLayoutPreviewCanvas();
	const canvas = await showLayoutPlanGhost(plan);
	await setStoredLayoutPreviewSession(
		createLayoutPreviewSession({
			planId: plan.id,
			documentTabId: canvas.documentTabId,
		}),
	);

	try {
		await openLayoutPreviewBar();
		await hideLayoutPilotWorkbench();
	}
	catch (error) {
		await clearActiveLayoutPreviewCanvas();
		throw error;
	}
}

previewPlanBtn.addEventListener('click', async () => {
	if (busy || previewPlanBtn.disabled) return;
	setBusy(true);
	try {
		const workflow = inspectStoredWorkflowState();
		let plan = workflow.layoutPlan;

		if (
			!plan
			|| plan.status === 'rejected'
			|| plan.status === 'applied'
			|| plan.status === 'superseded'
		) {
			const result = await generateCurrentLayoutPlan(1);
			if (!result.ok) {
				showToast(result.message);
				return;
			}
			plan = result.plan;
		}
		else {
			const validation = await validateStoredLayoutPlanCurrent();
			if (!validation.ok) {
				const regenerated = await generateCurrentLayoutPlan(1);
				if (!regenerated.ok) {
					showToast(regenerated.message);
					return;
				}
				plan = regenerated.plan;
			}
		}

		await openInlineLayoutReview(plan);
	}
	catch (error) {
		console.error('[LayoutPilot Workbench] layout preview failed', error);
		showToast(`布局预览失败：${String(error)}`);
	}
	finally {
		setBusy(false);
	}
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

syncWindowSizeButtons();
void refresh();


window.addEventListener('beforeunload', () => {
	releaseInlineLayoutReview();
});
