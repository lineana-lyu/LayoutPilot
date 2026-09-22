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
		file !== 'extension.json' && !file.startsWith('dist/'),
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

	console.log('[LayoutPilot] package boundary verified', files);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
