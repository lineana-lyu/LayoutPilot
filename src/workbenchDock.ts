import { restoreLayoutPilotWorkbenchFromDock } from './ui/workbenchWindow';

const restoreBtn = document.getElementById('restoreBtn') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLDivElement;

restoreBtn.addEventListener('click', async () => {
	if (restoreBtn.disabled) return;
	restoreBtn.disabled = true;
	status.textContent = '正在恢复…';
	try {
		await restoreLayoutPilotWorkbenchFromDock();
	}
	catch (error) {
		status.textContent = `恢复失败：${String(error)}`;
		restoreBtn.disabled = false;
	}
});
