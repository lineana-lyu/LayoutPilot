import type { CanvasRegion } from '../domain/canvasRegion';

export interface NativePcbReviewSnapshot {
	documentTabId: string;
	viewport: CanvasRegion;
	blob: Blob;
}

function toCanvasRegion(input: {
	left: number;
	right: number;
	top: number;
	bottom: number;
}): CanvasRegion {
	return {
		left: input.left,
		right: input.right,
		top: input.top,
		bottom: input.bottom,
	};
}

export async function captureNativePcbReviewSnapshot(
	reviewRegion: CanvasRegion,
): Promise<NativePcbReviewSnapshot> {
	const document = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (!document) {
		throw new Error('无法获取当前 PCB 文档信息。');
	}
	if (document.documentType !== EDMT_EditorDocumentType.PCB) {
		throw new Error('当前活动文档不是 PCB，无法获取原生布局预览。');
	}

	const originalViewport = await eda.dmt_EditorControl.zoomTo(
		undefined,
		undefined,
		undefined,
		document.tabId,
	);
	if (!originalViewport) {
		throw new Error('嘉立创EDA无法读取当前 PCB 视口。');
	}

	try {
		const zoomed = await eda.dmt_EditorControl.zoomToRegion(
			reviewRegion.left,
			reviewRegion.right,
			reviewRegion.top,
			reviewRegion.bottom,
			document.tabId,
		);
		if (!zoomed) {
			throw new Error('嘉立创EDA无法定位布局审查区域。');
		}

		// Read the actual fitted viewport after zoomToRegion instead of assuming
		// the requested rectangle maps 1:1 to the rendered canvas aspect ratio.
		const capturedViewport = await eda.dmt_EditorControl.zoomTo(
			undefined,
			undefined,
			undefined,
			document.tabId,
		);
		if (!capturedViewport) {
			throw new Error('嘉立创EDA无法读取布局审查视口。');
		}

		const blob = await eda.dmt_EditorControl.getCurrentRenderedAreaImage(
			document.tabId,
		);
		if (!blob || blob.size <= 0) {
			throw new Error('嘉立创EDA未返回可用的 PCB 原生渲染图像。');
		}

		return {
			documentTabId: document.tabId,
			viewport: toCanvasRegion(capturedViewport),
			blob,
		};
	}
	finally {
		try {
			await eda.dmt_EditorControl.zoomToRegion(
				originalViewport.left,
				originalViewport.right,
				originalViewport.top,
				originalViewport.bottom,
				document.tabId,
			);
		}
		catch (error) {
			console.warn('[LayoutPilot] unable to restore PCB viewport after native review capture', {
				documentTabId: document.tabId,
				error,
			});
		}
	}
}
