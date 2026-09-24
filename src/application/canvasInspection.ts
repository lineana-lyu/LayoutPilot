import { retireEvidenceInspection } from './evidenceInspection';
import { retireLayoutPreviewSurface } from '../ui/layoutPreviewWindow';
import { openLayoutPilotWorkbench } from '../ui/workbenchWindow';

export const LAYOUTPILOT_RETURN_SHORTCUT: TSYS_ShortcutKeys = [
	'ALT',
	'SHIFT',
	'L',
];

export async function returnToLayoutPilotWorkbench(): Promise<void> {
	await retireEvidenceInspection();
	await retireLayoutPreviewSurface();
	await openLayoutPilotWorkbench();
}

export function showCanvasInspectionHint(message: string): void {
	eda.sys_Message.showToastMessage(
		`${message} · Alt+Shift+L 返回工作台`,
		ESYS_ToastMessageType.INFO,
		4500,
	);
}
