import path from 'node:path';
import fs from 'fs-extra';
import JSZip from 'jszip';

import * as extensionConfig from '../extension.json';

const PACKAGE_ROOT = path.join(__dirname, '../');
const RUNTIME_ROOT_FILES = ['extension.json'] as const;
const RUNTIME_DIRECTORIES = ['dist'] as const;

function testUuid(uuid?: string): uuid is string {
	const regExp = /^[a-z0-9]{32}$/;
	return Boolean(
		uuid
		&& uuid !== '00000000000000000000000000000000'
		&& regExp.test(uuid.trim()),
	);
}

function listFilesRecursively(directory: string): string[] {
	if (!fs.existsSync(directory)) {
		throw new Error(`Required package directory is missing: ${directory}`);
	}

	const result: string[] = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			result.push(...listFilesRecursively(absolute));
			continue;
		}
		if (entry.isFile()) {
			result.push(absolute);
		}
	}
	return result;
}

function toArchivePath(absolutePath: string): string {
	return path.relative(PACKAGE_ROOT, absolutePath).replace(/\\/g, '/');
}

async function main(): Promise<void> {
	if (!testUuid(extensionConfig.uuid)) {
		throw new Error(
			'extension.json must contain one stable non-zero 32-character lowercase UUID before packaging.',
		);
	}

	const runtimeFiles = [
		...RUNTIME_ROOT_FILES.map(file => path.join(PACKAGE_ROOT, file)),
		...RUNTIME_DIRECTORIES.flatMap(directory =>
			listFilesRecursively(path.join(PACKAGE_ROOT, directory)),
		),
	];

	for (const file of runtimeFiles) {
		if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
			throw new Error(`Required runtime file is missing: ${file}`);
		}
	}

	const zip = new JSZip();
	for (const file of runtimeFiles) {
		zip.file(toArchivePath(file), fs.createReadStream(file));
	}

	const outputDirectory = path.join(__dirname, 'dist');
	await fs.ensureDir(outputDirectory);
	const outputPath = path.join(
		outputDirectory,
		`${extensionConfig.name}_v${extensionConfig.version}.eext`,
	);
	const buffer = await zip.generateAsync({
		type: 'nodebuffer',
		compression: 'DEFLATE',
		compressionOptions: { level: 9 },
	});
	await fs.writeFile(outputPath, buffer);

	console.log('[LayoutPilot] packaged runtime allowlist', {
		outputPath,
		files: runtimeFiles.map(toArchivePath),
	});
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
