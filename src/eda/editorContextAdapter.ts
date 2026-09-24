import type {
	EditorContextPort,
	EditorDocumentContext,
} from '../application/editorContextTransaction';

export const easyEdaEditorContextPort: EditorContextPort = {
	getSplitScreenIdByTabId: async tabId =>
		await eda.dmt_EditorControl.getSplitScreenIdByTabId(tabId),

	getTabsBySplitScreenId: async splitScreenId => {
		const tabs = await eda.dmt_EditorControl.getTabsBySplitScreenId(splitScreenId);
		return tabs.map(tab => ({
			tabId: tab.tabId,
			documentType: String(tab.documentType),
		}));
	},

	activateSplitScreen: async splitScreenId =>
		await eda.dmt_EditorControl.activateSplitScreen(splitScreenId),

	activateDocument: async tabId =>
		await eda.dmt_EditorControl.activateDocument(tabId),

	getCurrentDocumentInfo: async (): Promise<EditorDocumentContext | undefined> => {
		const document = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		return document
			? {
				tabId: document.tabId,
				documentType: String(document.documentType),
			}
			: undefined;
	},
};
