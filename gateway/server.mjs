import http from 'node:http';

const port = Number(process.env.LAYOUTPILOT_GATEWAY_PORT || 8787);
const mode = process.env.LAYOUTPILOT_GATEWAY_MODE || 'mock';

const semanticSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		status: {
			type: 'string',
			enum: ['inferred', 'insufficient-evidence'],
		},
		role: {
			type: 'string',
			enum: [
				'decoupling-capacitor',
				'bulk-capacitor',
				'filter-capacitor',
				'power-path-inductor',
				'power-switch',
				'protection-device',
				'reset-network',
				'timing-device',
				'connector-interface',
				'other',
				'unknown',
			],
		},
		associatedCore: {
			type: ['string', 'null'],
		},
		confidence: {
			type: 'string',
			enum: ['low', 'medium', 'high'],
		},
		evidenceRefs: {
			type: 'array',
			items: { type: 'string' },
		},
		explanation: {
			type: 'string',
		},
		constraints: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					type: {
						type: 'string',
						enum: [
							'near',
							'group-with',
							'keep-short',
							'edge',
							'keepout',
							'no-constraint',
						],
					},
					target: {
						type: ['string', 'null'],
					},
					evidenceRefs: {
						type: 'array',
						items: { type: 'string' },
					},
				},
				required: ['type', 'target', 'evidenceRefs'],
			},
		},
	},
	required: [
		'status',
		'role',
		'associatedCore',
		'confidence',
		'evidenceRefs',
		'explanation',
		'constraints',
	],
};

function json(res, status, body) {
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'access-control-allow-origin': '*',
		'access-control-allow-headers': 'content-type',
		'access-control-allow-methods': 'GET,POST,OPTIONS',
	});
	res.end(JSON.stringify(body));
}

async function readJson(req) {
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(chunk);
	}
	const raw = Buffer.concat(chunks).toString('utf8');
	return raw ? JSON.parse(raw) : {};
}

function evidenceIds(request) {
	return new Set(
		Array.isArray(request.evidenceCatalog)
			? request.evidenceCatalog.map(item => item.id).filter(Boolean)
			: [],
	);
}

function buildMockInference(request) {
	const context = request.context ?? {};
	const ids = evidenceIds(request);

	const refs = [
		'component:value',
		'net:VDD',
		'net:GND',
		'core:U1',
	].filter(id => ids.has(id));

	if (
		context.designator === 'C6'
		&& String(context.value ?? '').toLowerCase() === '100nf'
		&& ids.has('net:VDD')
		&& ids.has('net:GND')
		&& ids.has('core:U1')
	) {
		return {
			status: 'inferred',
			role: 'decoupling-capacitor',
			associatedCore: 'U1',
			confidence: 'medium',
			evidenceRefs: refs,
			explanation: 'C6 为 100nF 电容，跨接 VDD 与 GND，并与候选核心 U1 共享电源域；这些证据支持“去耦电容”候选，但缺少芯片引脚语义/数据手册证据，因此不提升为高置信。',
			constraints: [
				{
					type: 'near',
					target: 'U1',
					evidenceRefs: refs,
				},
			],
		};
	}

	const fallbackRefs = Array.from(ids).slice(0, 4);
	return {
		status: 'insufficient-evidence',
		role: 'unknown',
		associatedCore: null,
		confidence: 'low',
		evidenceRefs: fallbackRefs,
		explanation: '当前证据不足以形成可靠语义判断。',
		constraints: [
			{
				type: 'no-constraint',
				target: null,
				evidenceRefs: fallbackRefs,
			},
		],
	};
}

function extractOutputText(response) {
	if (typeof response.output_text === 'string' && response.output_text) {
		return response.output_text;
	}

	for (const item of response.output ?? []) {
		for (const content of item.content ?? []) {
			if (content.type === 'output_text' && typeof content.text === 'string') {
				return content.text;
			}
		}
	}

	throw new Error('模型响应中没有可解析的 output_text。');
}

function normalizeInference(inference) {
	const normalized = structuredClone(inference);
	if (normalized.associatedCore === null) {
		delete normalized.associatedCore;
	}
	for (const constraint of normalized.constraints ?? []) {
		if (constraint.target === null) {
			delete constraint.target;
		}
	}
	return normalized;
}

async function inferWithOpenAI(request) {
	const apiKey = process.env.OPENAI_API_KEY;
	const model = process.env.OPENAI_MODEL;
	const baseUrl = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1')
		.replace(/\/+$/, '');

	if (!apiKey) {
		throw new Error('缺少 OPENAI_API_KEY。');
	}
	if (!model) {
		throw new Error('缺少 OPENAI_MODEL。');
	}

	const payload = {
		model,
		instructions: [
			'你是 LayoutPilot 的 PCB 语义分析器。',
			'你只能根据输入中的 context 和 evidenceCatalog 推理，禁止创造新的 PCB 事实。',
			'evidenceRefs 和 constraint.evidenceRefs 只能引用 evidenceCatalog 中存在的 id。',
			'associatedCore 只能从 context.relatedCoreDesignators 中选择；不能确定时设为 null。',
			'如果证据不足，status 必须为 insufficient-evidence，role 必须为 unknown，并且只能输出 no-constraint。',
			'置信度只允许 low / medium / high，不要输出百分比。',
			'布局建议应保守；缺少 Pin 语义时，不要声称靠近某个具体 Pin。',
		].join('\n'),
		input: JSON.stringify({
			task: 'Infer the likely circuit role and conservative layout constraints for this ambiguous PCB component. Return only the requested structured result.',
			context: request.context,
			evidenceCatalog: request.evidenceCatalog,
		}),
		text: {
			format: {
				type: 'json_schema',
				name: 'layoutpilot_semantic_inference',
				strict: true,
				schema: semanticSchema,
			},
		},
	};

	const response = await fetch(`${baseUrl}/responses`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${apiKey}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify(payload),
	});

	const raw = await response.text();
	if (!response.ok) {
		throw new Error(`OpenAI API ${response.status}: ${raw.slice(0, 500)}`);
	}

	const data = JSON.parse(raw);
	const inference = JSON.parse(extractOutputText(data));

	return {
		inference: normalizeInference(inference),
		provider: 'openai',
		model,
	};
}

async function handleSemanticInfer(request) {
	if (!request || request.version !== '1' || !request.context) {
		throw new Error('请求格式错误。');
	}

	if (mode === 'mock') {
		return {
			inference: normalizeInference(buildMockInference(request)),
			provider: 'mock',
			model: 'deterministic-c6-demo',
		};
	}

	if (mode === 'openai') {
		return inferWithOpenAI(request);
	}

	throw new Error(`未知 LAYOUTPILOT_GATEWAY_MODE: ${mode}`);
}

const server = http.createServer(async (req, res) => {
	if (req.method === 'OPTIONS') {
		json(res, 204, {});
		return;
	}

	try {
		if (req.method === 'GET' && req.url === '/health') {
			json(res, 200, {
				ok: true,
				service: 'layoutpilot-ai-gateway',
				mode,
			});
			return;
		}

		if (req.method === 'POST' && req.url === '/semantic-infer') {
			const request = await readJson(req);
			const result = await handleSemanticInfer(request);
			json(res, 200, result);
			return;
		}

		json(res, 404, { error: 'not-found' });
	}
	catch (error) {
		json(res, 500, {
			error: error instanceof Error ? error.message : String(error),
		});
	}
});

server.listen(port, '127.0.0.1', () => {
	console.log(`LayoutPilot AI Gateway listening on http://127.0.0.1:${port}`);
	console.log(`mode=${mode}`);
});
