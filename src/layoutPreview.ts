import {
	layoutPlanAcceptanceMode,
	markLayoutPlanAccepted,
	markLayoutPlanRejected,
} from './domain/layoutPlan';
import { formatLayoutPlanItemReview } from './domain/layoutPlanReview';
import { validateStoredLayoutPlanCurrent } from './eda/layoutPlanRuntime';
import {
	archiveStoredReferencePlan,
	getStoredLayoutPlan,
	getStoredLayoutPlanById,
	getStoredLayoutPreviewSession,
	setStoredLayoutPlan,
} from './eda/workflowStore';
import { closeLayoutPreviewBarAndReturn } from './ui/layoutPreviewWindow';

const title = document.getElementById('title') as HTMLDivElement;
const meta = document.getElementById('meta') as HTMLDivElement;
const items = document.getElementById('items') as HTMLDivElement;
const status = document.getElementById('status') as HTMLDivElement;
const returnBtn = document.getElementById('returnBtn') as HTMLButtonElement;
const rejectBtn = document.getElementById('rejectBtn') as HTMLButtonElement;
const acceptBtn = document.getElementById('acceptBtn') as HTMLButtonElement;

function setBusy(value: boolean): void {
	returnBtn.disabled = value;
	rejectBtn.disabled = value;
	acceptBtn.disabled = value;
}

function currentPreviewPlan() {
	const session = getStoredLayoutPreviewSession();
	if (session) {
		return getStoredLayoutPlanById(session.planId);
	}
	return getStoredLayoutPlan();
}

function render(): void {
	const plan = currentPreviewPlan();
	if (!plan) {
		title.textContent = 'LayoutPlan 已不存在';
		meta.textContent = '';
		items.textContent = '';
		acceptBtn.disabled = true;
		rejectBtn.disabled = true;
		return;
	}

	const blocked = plan.items.filter(item => item.executionBlockers.length > 0).length;
	const acceptanceMode = layoutPlanAcceptanceMode(plan);
	const activePlan = getStoredLayoutPlan();
	const archived = activePlan?.id !== plan.id;
	const blockerSummary = [...new Set(
		plan.items.flatMap(item => item.executionBlockers),
	)];
	title.textContent = archived
		? `历史参考方案 · ${plan.id}`
		: acceptanceMode === 'reference-only'
			? `参考布局建议 · ${plan.id}`
			: `布局预览 · ${plan.id}`;
	meta.innerHTML = [
		`${plan.items.length} 个器件`,
		`${plan.items.length - blocked} 个当前可进入物理预检`,
		blocked ? `${blocked} 个仅预览` : '',
		archived ? '<strong class="reference-note">历史记录 · 不代表当前 Owner 决策</strong>' : '',
		acceptanceMode === 'reference-only'
			? '<strong class="reference-note">当前方案不会修改 PCB</strong>'
			: '',
		'<span class="legend"><span><i class="swatch current"></i>当前位置</span><span><i class="swatch owner"></i>Owner</span><span><i class="swatch blue"></i>可执行目标</span><span><i class="swatch amber"></i>参考目标</span></span>',
	].filter(Boolean).join(' · ');
	items.textContent = [
		...plan.items.map(item =>
			[
				`${item.subjectDesignator} → near(${item.ownerDesignator})`,
				`移动 ${item.movementMil.toFixed(1)} mil`,
				formatLayoutPlanItemReview(item),
			].join(' · ')
		),
		...(acceptanceMode === 'reference-only'
			? blockerSummary.slice(0, 2).map(reason => `仅参考：${reason}`)
			: []),
	].join('   |   ');
	if (plan.status !== 'preview') {
		acceptBtn.textContent = acceptanceMode === 'reference-only'
			? '参考方案已保存'
			: '方案已接受';
		acceptBtn.disabled = true;
		rejectBtn.disabled = true;
	}
	else {
		acceptBtn.textContent = acceptanceMode === 'reference-only'
			? '保存参考方案'
			: acceptanceMode === 'mixed'
				? '接受可执行项'
				: '接受并进入预检';
		rejectBtn.disabled = false;
	}
}

returnBtn.addEventListener('click', async () => {
	if (returnBtn.disabled) return;
	setBusy(true);
	try {
		await closeLayoutPreviewBarAndReturn();
	}
	catch (error) {
		status.textContent = `返回失败：${String(error)}`;
		setBusy(false);
	}
});

rejectBtn.addEventListener('click', async () => {
	if (rejectBtn.disabled) return;
	setBusy(true);
	try {
		const plan = currentPreviewPlan();
		if (plan?.status === 'preview') {
			await setStoredLayoutPlan(markLayoutPlanRejected(plan));
		}
		await closeLayoutPreviewBarAndReturn();
	}
	catch (error) {
		status.textContent = `放弃方案失败：${String(error)}`;
		setBusy(false);
	}
});

acceptBtn.addEventListener('click', async () => {
	if (acceptBtn.disabled) return;
	setBusy(true);
	status.textContent = '';
	try {
		const validation = await validateStoredLayoutPlanCurrent();
		if (!validation.ok) {
			throw new Error(validation.message);
		}

		const accepted = markLayoutPlanAccepted(validation.plan);
		await setStoredLayoutPlan(accepted);
		if (layoutPlanAcceptanceMode(accepted) === 'reference-only') {
			await archiveStoredReferencePlan(accepted);
		}
		await closeLayoutPreviewBarAndReturn();
	}
	catch (error) {
		status.textContent = String(error);
		setBusy(false);
	}
});

render();
