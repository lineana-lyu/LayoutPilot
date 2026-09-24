import path from 'node:path';
import fs from 'fs-extra';
import JSZip from 'jszip';

import * as extensionConfig from '../extension.json';

async function main(): Promise<void> {
	const packagePath = path.join(
		__dirname,
		'dist',
		`${extensionConfig.name}_v${extensionConfig.version}.eext`,
	);
	if (!fs.existsSync(packagePath)) {
		throw new Error(`Extension package not found: ${packagePath}`);
	}

	const zip = await JSZip.loadAsync(await fs.readFile(packagePath));
	const files = Object.values(zip.files)
		.filter(entry => !entry.dir)
		.map(entry => entry.name)
		.sort();

	const unexpected = files.filter(file =>
		file !== 'extension.json'
			&& !file.startsWith('dist/')
			&& !file.startsWith('iframe/'),
	);
	if (unexpected.length) {
		throw new Error(
			`Unexpected non-runtime files in .eext: ${unexpected.join(', ')}`,
		);
	}
	if (!files.includes('extension.json')) {
		throw new Error('Packaged extension is missing extension.json');
	}
	if (!files.includes('dist/index.js')) {
		throw new Error('Packaged extension is missing dist/index.js');
	}
	if (!files.includes('dist/workbench.js')) {
		throw new Error('Packaged extension is missing dist/workbench.js');
	}
	if (!files.includes('dist/layoutPreview.js')) {
		throw new Error('Packaged extension is missing dist/layoutPreview.js');
	}
	if (!files.includes('iframe/workbench.html')) {
		throw new Error('Packaged extension is missing iframe/workbench.html');
	}
	if (!files.includes('iframe/layout-preview.html')) {
		throw new Error('Packaged extension is missing iframe/layout-preview.html');
	}

	const forbiddenInspectionPopups = [
		'dist/evidenceReview.js',
		'dist/workbenchDock.js',
		'iframe/evidence-review.html',
		'iframe/workbench-dock.html',
	];
	const leakedInspectionPopups = forbiddenInspectionPopups.filter(file =>
		files.includes(file),
	);
	if (leakedInspectionPopups.length) {
		throw new Error(
			'Popup-free inspection contract violated by packaged files: '
				+ leakedInspectionPopups.join(', '),
		);
	}

	console.log('[LayoutPilot] package boundary verified', files);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
