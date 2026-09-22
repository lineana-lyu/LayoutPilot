import { buildConstraintEvaluation } from './application/constraintEvaluation';
import { createHumanOwnershipDecision } from './domain/humanOwnershipDecision';
import {
	buildSemanticBoardFingerprint,
	semanticSnapshotMatchesBoard,
} from './domain/semanticSnapshot';
import { resolveComponentDisplayName } from './domain/semanticContext';
import { collectAnalysisState, type AnalysisState } from './eda/analysisAdapter';
import {
	getStoredHumanOwnershipDecisions,
	inspectStoredWorkflowState,
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
}

interface OwnerTask {
	componentId: string;
	designator: string;
	role: string;
	confidence: string;
	relation: string;
	rail: string;
	candidates: HostCandidate[];
	selectedOwnerId?: string;
	selectedOwnerDesignator?: string;
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
const loading = el<HTMLDivElement>('loading');
const toast = el<HTMLDivElement>('toast');
const analyzeBtn = el<HTMLButtonElement>('analyzeBtn');
const applyBtn = el<HTMLButtonElement>('applyBtn');
const undoBtn = el<HTMLButtonElement>('undoBtn');
const refreshBtn = el<HTMLButtonElement>('refreshBtn');
const gatewayBtn = el<HTMLButtonElement>('gatewayBtn');
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
}

function showToast(message: string): void {
	toast.textContent = message;
	toast.classList.add('show');
	window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function confidenceRank(value: string): number {
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

		const tasks: OwnerTask[] = snapshot.entries
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
						return {
							id: node.id,
							designator: node.designator,
							name: resolveComponentDisplayName(
								meta?.name,
								meta?.otherProperty,
							),
							manufacturer: meta?.manufacturer,
							footprint: meta?.footprintName,
						};
					});

				return {
					componentId: entry.componentId,
					designator: entry.designator,
					role: entry.inference!.role,
					confidence: entry.inference!.confidence,
					relation: entry.context.ownership.relation,
					rail: entry.context.ownership.railNets.join('、') || '未知电源域',
					candidates,
					selectedOwnerId: decision?.ownerComponentId,
					selectedOwnerDesignator: decision?.ownerDesignator,
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

function renderTasks(tasks: OwnerTask[]): void {
	const pending = tasks.filter(task => !task.selectedOwnerId).length;
	el<HTMLDivElement>('taskCount').textContent = `${pending} 待确认 / ${tasks.length}`;

	if (!tasks.length) {
		taskList.innerHTML = '<div style="padding:14px 10px;color:#7a8792;font-size:11px;line-height:1.5">当前没有 rail-domain 去耦器件需要人工确认。</div>';
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
					<span class="badge ${confirmed ? 'ok' : 'pending'}">${confirmed ? `→ ${escapeHtml(task.selectedOwnerDesignator)}` : '待确认'}</span>
				</div>
				<div class="task-rail">${escapeHtml(task.rail)} · ${escapeHtml(semanticConfidenceZh(task.confidence as never))}</div>
			</button>`;
	}).join('');

	for (const node of taskList.querySelectorAll<HTMLButtonElement>('[data-task]')) {
		node.addEventListener('click', () => {
			selectedComponentId = node.dataset.task;
			renderCurrentTask(tasks);
			renderTasks(tasks);
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
				<div class="block-title">布局约束</div>
				<div class="constraint-summary">
					<span class="badge ok">${proposals.length} 条已生成</span>
					<span class="badge info">${evaluation.merged.previewEligibleCount} 条可进入执行</span>
				</div>
				${proposals.map(({ proposal, humanDecision }) => `
					<div class="constraint-card">
						<div class="constraint-title">${escapeHtml(proposal.subject)} → ${escapeHtml(proposal.target ?? '—')}</div>
						<div class="constraint-meta">
							${escapeHtml(layoutConstraintTypeZh(proposal.type))} ·
							${escapeHtml(semanticConfidenceZh(proposal.confidence))} ·
							${proposal.execution === 'preview-eligible' ? '可进入受控执行' : '仅复核'}
							${humanDecision ? ` · Owner 来源：人工确认` : ''}
						</div>
					</div>
				`).join('')}
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
			<div class="block-title">布局约束</div>
			<div class="blocked">
				<strong>当前 0 条可执行约束</strong><br/>
				${pending ? `${pending} 个去耦电容只有 rail-domain 证据，还没有唯一 Owner。` : '现有证据尚未满足 Constraint Policy。'}
				${sharedSignal ? `<br/>${sharedSignal} 个去耦器件属于 shared-signal / 多 Host，系统不会强制归属。` : ''}
				${unsupported ? `<br/>${unsupported} 个语义角色尚未建立可执行布局策略。` : ''}
			</div>
			<details>
				<summary>查看完整策略诊断</summary>
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

function renderCurrentTask(tasks: OwnerTask[], model?: RuntimeModel): void {
	const task = tasks.find(item => item.componentId === selectedComponentId);
	if (!task) {
		if (model?.evaluation) {
			mainPanel.innerHTML = `
				<div class="detail">
					<div class="hero">
						<div class="hero-copy">
							<div class="hero-title">当前没有待确认 Owner 的去耦器件</div>
							<div class="hero-sub">可以直接查看 Constraint 结果；如果约束仍为 0，可展开策略诊断。</div>
						</div>
					</div>
					${renderConstraintArea(model)}
				</div>`;
		}
		return;
	}

	mainPanel.innerHTML = `
		<div class="detail">
			<div class="hero">
				<div class="ref">${escapeHtml(task.designator)}</div>
				<div class="hero-copy">
					<div class="hero-title">${escapeHtml(semanticRoleZh(task.role as never))} · ${escapeHtml(semanticConfidenceZh(task.confidence as never))}</div>
					<div class="hero-sub">
						确定性关系：${escapeHtml(ownershipRelationZh(task.relation as never))}<br/>
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
			</div>
			<div class="block">
				<div class="block-title">选择实际服务的 Host</div>
				<div class="note">这里的候选只表示“与该器件存在确定性的电源域关联”，不是 AI 推荐。只有你明确知道归属时才确认；不确定就保持待确认。</div>
				<div class="host-grid">
					${task.candidates.map(candidate => {
						const selected = candidate.id === task.selectedOwnerId;
						const primaryName = candidate.name && candidate.name !== candidate.designator
							? candidate.name
							: '器件名称未解析';
						return `
							<button class="host ${selected ? 'selected' : ''}" data-owner="${escapeHtml(candidate.id)}">
								<div class="host-top">
									<span class="host-ref">${escapeHtml(candidate.designator)}</span>
									<span class="host-name">${escapeHtml(primaryName)}</span>
									${selected ? '<span class="badge ok" style="margin-left:auto">当前 Owner</span>' : ''}
								</div>
								<div class="host-meta">${escapeHtml([candidate.manufacturer, candidate.footprint].filter(Boolean).join(' · ') || '制造商 / 封装信息不足')}</div>
								<div class="host-evidence">候选证据：与 ${escapeHtml(task.designator)} 处于 ${escapeHtml(task.rail)} rail-domain</div>
							</button>`;
					}).join('')}
				</div>
				${task.selectedOwnerId ? '<div style="margin-top:8px"><button class="btn danger" id="clearOwnerBtn">清除人工确认</button></div>' : ''}
			</div>
			${model ? renderConstraintArea(model) : ''}
		</div>`;

	for (const node of mainPanel.querySelectorAll<HTMLButtonElement>('[data-owner]')) {
		node.addEventListener('click', async () => {
			const ownerId = node.dataset.owner;
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
		el<HTMLDivElement>('metricPending').textContent = String(pending);
		el<HTMLDivElement>('metricConstraints').textContent = String(model.constraintCount);
		renderTasks(model.tasks);
		renderCurrentTask(model.tasks, model);

		setStage('stageAnalyze', 'done');
		setStage('stageOwner', pending > 0 ? 'active' : 'done');
		setStage(
			'stageConstraint',
			model.constraintCount > 0 ? 'done' : (pending > 0 ? 'blocked' : 'active'),
		);

		const command = workflow.lastPlacementCommand;
		setStage(
			'stageExecute',
			command?.status === 'applied'
				? 'active'
				: command?.status === 'undone'
					? 'done'
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
