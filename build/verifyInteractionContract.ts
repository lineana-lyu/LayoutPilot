import fs from 'node:fs';
import path from 'node:path';

interface SourceRule {
	file: string;
	forbidden: string[];
	required?: string[];
}

const root = process.cwd();

const rules: SourceRule[] = [
	{
		file: 'src/workbench.ts',
		forbidden: [
			'hideLayoutPilotWorkbench',
			'collapseLayoutPilotWorkbench',
			'openEvidenceReviewBar',
			'retireEvidenceReviewBar',
			"mode: 'navigation'",
			'getLayoutPreviewBarContext',
		],
		required: [
			'navigateReviewToPcb',
			'focusPcbEvidence',
		],
	},
	{
		file: 'src/ui/workbenchWindow.ts',
		forbidden: [
			'hideIFrame(',
			'showIFrame(',
			'minimizeButton: true',
			'minimizeStyle:',
			'workbench-dock',
		],
		required: [
			'buildWorkbenchFrameLayout',
			'reopenLayoutPilotWorkbench',
		],
	},
	{
		file: 'iframe/workbench.html',
		forbidden: [
			'sizeCompactBtn',
			'sizeStandardBtn',
			'sizeWideBtn',
			'collapseWorkbenchBtn',
			'hideWorkbenchBtn',
		],
	},
	{
		file: 'config/esbuild.common.ts',
		forbidden: [
			"evidenceReview: './src/evidenceReview'",
			"workbenchDock: './src/workbenchDock'",
		],
	},
	{
		file: 'build/verifyPackage.ts',
		forbidden: [
			"Packaged extension is missing dist/evidenceReview.js",
			"Packaged extension is missing dist/workbenchDock.js",
		],
	},
];

const errors: string[] = [];

for (const rule of rules) {
	const absolute = path.join(root, rule.file);
	if (!fs.existsSync(absolute)) {
		errors.push(`${rule.file}: required contract source is missing`);
		continue;
	}

	const source = fs.readFileSync(absolute, 'utf8');
	for (const token of rule.forbidden) {
		if (source.includes(token)) {
			errors.push(
			`${rule.file}: forbidden interaction pattern reintroduced: ${token}`,
		);
		}
	}
	for (const token of rule.required ?? []) {
		if (!source.includes(token)) {
			errors.push(
			`${rule.file}: required interaction contract token is missing: ${token}`,
		);
		}
	}
}

const removedPopupFiles = [
	'src/ui/evidenceReviewWindow.ts',
	'src/evidenceReview.ts',
	'iframe/evidence-review.html',
	'src/workbenchDock.ts',
	'iframe/workbench-dock.html',
];
for (const file of removedPopupFiles) {
	if (fs.existsSync(path.join(root, file))) {
		errors.push(`${file}: obsolete popup surface must remain deleted`);
	}
}

if (errors.length) {
	throw new Error(
		['LayoutPilot interaction architecture verification failed:', ...errors]
			.join('\n- '),
	);
}

console.log('[LayoutPilot] interaction architecture verified');
