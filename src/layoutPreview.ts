import {
	layoutPlanAcceptanceMode,
	markLayoutPlanAccepted,
	markLayoutPlanRejected,
} from './domain/layoutPlan';
import { validateStoredLayoutPlanCurrent } from './eda/layoutPlanRuntime';
import {
	getStoredLayoutPlan,
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

function render(): void {
	const plan = getStoredLayoutPlan();
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
	const blockerSummary = [...new Set(
		plan.items.flatMap(item => item.executionBlockers),
	)];
	title.textContent = acceptanceMode === 'reference-only'
		? `参考布局建议 · ${plan.id}`
		: `布局预览 · ${plan.id}`;
	meta.innerHTML = [
		`${plan.items.length} 个器件`,
		`${plan.items.length - blocked} 个当前可进入物理预检`,
		blocked ? `${blocked} 个仅预览` : '',
		acceptanceMode === 'reference-only'
			? '<strong class="reference-note">当前方案不会修改 PCB</strong>'
			: '',
		'<span class="legend"><span><i class="swatch blue"></i>可预检</span><span><i class="swatch amber"></i>仅预览</span></span>',
	].filter(Boolean).join(' · ');
	items.textContent = [
		...plan.items.map(item =>
			`${item.subjectDesignator} → near(${item.ownerDesignator}) · 移动 ${item.movementMil.toFixed(1)} mil`
		),
		...(acceptanceMode === 'reference-only'
			? blockerSummary.slice(0, 2).map(reason => `仅参考：${reason}`)
			: []),
	].join('   |   ');
	acceptBtn.textContent = acceptanceMode === 'reference-only'
		? '保存参考方案'
		: acceptanceMode === 'mixed'
			? '接受可执行项'
			: '接受并进入预检';
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
		const plan = getStoredLayoutPlan();
		if (plan) {
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

		await setStoredLayoutPlan(markLayoutPlanAccepted(validation.plan));
		await closeLayoutPreviewBarAndReturn();
	}
	catch (error) {
		status.textContent = String(error);
		setBusy(false);
	}
});

render();
