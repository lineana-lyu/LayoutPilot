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
	},
	required: [
		'status',
		'role',
		'confidence',
		'evidenceRefs',
		'explanation',
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
	const ids = evidenceIds(request);
	const fallbackRefs = Array.from(ids).slice(0, 4);

	return {
		status: 'insufficient-evidence',
		role: 'unknown',
		confidence: 'low',
		evidenceRefs: fallbackRefs,
		explanation: 'Mock 模式只验证传输、解析和校验链路，不模拟真实语义判断。',
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
	return structuredClone(inference);
}


async function inferWithDeepSeek(request) {
	const apiKey = process.env.DEEPSEEK_API_KEY;
	const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
	const baseUrl = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com')
		.replace(/\/+$/, '');

	if (!apiKey) {
		throw new Error('缺少 DEEPSEEK_API_KEY。');
	}

	const allowedRoles = Array.isArray(request.allowedRoles)
		? request.allowedRoles
		: ['unknown'];
	const validationFeedback = Array.isArray(request.validationFeedback)
		? request.validationFeedback
		: [];

	const exampleRole = allowedRoles.find(role => role !== 'unknown') || 'unknown';
	const outputExample = {
		status: exampleRole === 'unknown' ? 'insufficient-evidence' : 'inferred',
		role: exampleRole,
		confidence: 'medium',
		evidenceRefs: [],
		explanation: '示例说明。',
	};

	const messages = [
		{
			role: 'system',
			content: [
				'你是 LayoutPilot 的 PCB 语义分析器。',
				'你只能根据输入 JSON 中的 context 和 evidenceCatalog 推理，禁止创造新的 PCB 事实。',
				'你的最终回答必须是一个 JSON object，不要输出 Markdown、代码块或额外文本。',
				'evidenceRefs 只能引用 evidenceCatalog 中存在的 id。',
				'器件归属关系已经由确定性规则写入 context.ownership；禁止你重新选择、发明或输出 associatedCore。',
				'status 只允许 inferred 或 insufficient-evidence。',
				'role 必须严格从输入中的 allowedRoles 数组中选择，禁止输出 allowedRoles 之外的角色。',
				'confidence 只允许 low, medium, high。',
				'allowedRoles 已由确定性规则层根据器件类型生成；不要自行扩展角色集合。',
				'如果证据不足：status=insufficient-evidence，role=unknown。',
				'不要输出百分比置信度。',
				'JSON 格式示例：',
				JSON.stringify(outputExample),
			].join('\n'),
		},
		{
			role: 'user',
			content: JSON.stringify({
				task: validationFeedback.length
					? '上一次输出被 Validator 拒绝。请根据 validationFeedback 修正，并只返回新的合法 JSON。'
					: '请判断这个歧义 PCB 器件最可能的电路角色。归属关系已经由确定性规则提供，不要重新决定 owner。只返回 JSON。',
				context: request.context,
				evidenceCatalog: request.evidenceCatalog,
				allowedRoles,
				validationFeedback,
			}),
		},
	];

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${apiKey}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			model,
			messages,
			thinking: { type: 'disabled' },
			temperature: 0,
			stream: false,
			max_tokens: 2000,
			response_format: { type: 'json_object' },
		}),
	});

	const raw = await response.text();
	if (!response.ok) {
		throw new Error(`DeepSeek API ${response.status}: ${raw.slice(0, 500)}`);
	}

	const data = JSON.parse(raw);
	const content = data?.choices?.[0]?.message?.content;

	if (typeof content !== 'string' || !content.trim()) {
		throw new Error('DeepSeek 返回了空的 message.content。');
	}

	const inference = JSON.parse(content);

	return {
		inference: normalizeInference(inference),
		provider: 'deepseek',
		model,
	};
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
			'evidenceRefs 只能引用 evidenceCatalog 中存在的 id。',
			'器件归属关系已经由确定性规则写入 context.ownership；禁止重新选择、发明或输出 associatedCore。',
			'如果证据不足，status 必须为 insufficient-evidence，role 必须为 unknown。',
			'role 必须严格从输入 allowedRoles 中选择。',
			'如果 validationFeedback 非空，必须优先修复其中指出的问题。',
			'置信度只允许 low / medium / high，不要输出百分比。',
		].join('\n'),
		input: JSON.stringify({
			task: 'Infer only the likely circuit role for this ambiguous PCB component. Ownership relation is deterministic input and must not be changed.',
			context: request.context,
			evidenceCatalog: request.evidenceCatalog,
			allowedRoles: request.allowedRoles,
			validationFeedback: request.validationFeedback ?? [],
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
	if (!request || request.version !== '2' || !request.context) {
		throw new Error('请求格式错误。');
	}

	if (mode === 'mock') {
		return {
			inference: normalizeInference(buildMockInference(request)),
			provider: 'mock',
			model: 'deterministic-contract-mock',
		};
	}

	if (mode === 'openai') {
		return inferWithOpenAI(request);
	}

	if (mode === 'deepseek') {
		return inferWithDeepSeek(request);
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
