import {
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
	title.textContent = `布局预览 · ${plan.id}`;
	meta.innerHTML = [
		`${plan.items.length} 个器件`,
		`${plan.items.length - blocked} 个当前可进入物理预检`,
		blocked ? `${blocked} 个仅预览` : '',
		'<span class="legend"><span><i class="swatch blue"></i>可预检</span><span><i class="swatch amber"></i>仅预览</span></span>',
	].filter(Boolean).join(' · ');
	items.textContent = plan.items
		.map(item =>
			`${item.subjectDesignator} → near(${item.ownerDesignator}) · ${item.movementMil.toFixed(1)} mil`
		)
		.join('   |   ');
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
