export interface EditorDocumentContext {
	tabId: string;
	documentType: string;
}

export interface EditorContextPort {
	getSplitScreenIdByTabId(tabId: string): Promise<string | undefined>;
	getTabsBySplitScreenId(splitScreenId: string): Promise<Array<{
		tabId: string;
		documentType: string;
	}>>;
	activateSplitScreen(splitScreenId: string): Promise<boolean>;
	activateDocument(tabId: string): Promise<boolean>;
	getCurrentDocumentInfo(): Promise<EditorDocumentContext | undefined>;
}

export interface EditorContextTransactionResult {
	documentTabId: string;
	splitScreenId: string;
}

export async function establishPcbEditorContext(input: {
	port: EditorContextPort;
	documentTabId: string;
	pcbDocumentType: string;
}): Promise<EditorContextTransactionResult> {
	const splitScreenId = await input.port.getSplitScreenIdByTabId(
		input.documentTabId,
	);
	if (!splitScreenId) {
		throw new Error('无法解析 PCB Tab 所属的编辑器分屏。');
	}

	const tabs = await input.port.getTabsBySplitScreenId(splitScreenId);
	const targetTab = tabs.find(tab => tab.tabId === input.documentTabId);
	if (!targetTab) {
		throw new Error('冻结的 PCB Tab 已不在原编辑器分屏中，请重新生成布局预览。');
	}
	if (targetTab.documentType !== input.pcbDocumentType) {
		throw new Error('冻结的目标 Tab 已不再是 PCB 文档。');
	}

	const splitActivated = await input.port.activateSplitScreen(splitScreenId);
	if (!splitActivated) {
		throw new Error('无法恢复 PCB 所在编辑器分屏的输入焦点。');
	}

	const documentActivated = await input.port.activateDocument(
		input.documentTabId,
	);
	if (!documentActivated) {
		throw new Error('无法激活冻结的 PCB 文档。');
	}

	const current = await input.port.getCurrentDocumentInfo();
	if (!current) {
		throw new Error('激活后无法读取当前编辑器文档。');
	}
	if (current.tabId !== input.documentTabId) {
		throw new Error('编辑器上下文恢复后，当前 Tab 与冻结 PCB Tab 不一致。');
	}
	if (current.documentType !== input.pcbDocumentType) {
		throw new Error('编辑器上下文恢复后，当前文档类型不是 PCB。');
	}

	return {
		documentTabId: input.documentTabId,
		splitScreenId,
	};
}
