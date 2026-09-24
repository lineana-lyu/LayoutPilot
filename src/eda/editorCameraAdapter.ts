import type { CanvasRegion } from '../domain/canvasRegion';
import type { EditorCameraPort } from '../application/editorCameraFocus';

export const easyEdaEditorCameraPort: EditorCameraPort = {
	fitRegion: async (documentTabId, region) =>
		await eda.dmt_EditorControl.zoomToRegion(
			region.left,
			region.right,
			region.top,
			region.bottom,
			documentTabId,
		),

	centerAt: async (
		documentTabId: string,
		x: number,
		y: number,
	): Promise<CanvasRegion | false> =>
		await eda.dmt_EditorControl.zoomTo(
			x,
			y,
			undefined,
			documentTabId,
		),
};
