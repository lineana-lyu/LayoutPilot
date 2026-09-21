import { buildCircuitGraph, type CircuitComponentSnapshot } from './domain/circuitGraph';
import { extractStructuralFeatures, type ComponentMetadata } from './domain/componentFeatures';
import { coreLevelZh, groupEvidenceZh, layoutConstraintTypeZh, lockedZh, netGroupingClassZh, semanticConfidenceZh, semanticMissingEvidenceZh, semanticRoleZh, structuralEvidenceZh } from './i18n/zhCN';
import { buildCandidateGroups } from './domain/candidateGrouping';
import { buildSemanticContexts, type SemanticComponentContext, type SemanticComponentMetadata } from './domain/semanticContext';
import { allowedSemanticRolesForPrefix, buildSemanticEvidenceCatalog, validateSemanticInference } from './domain/semanticInference';
import { buildSemanticGatewayRequest, normalizeGatewayBaseUrl, parseSemanticGatewayResponse } from './ai/gatewayClient';
import { buildConstraintPreview, mergeConstraintPreviewResults } from './domain/layoutConstraintEngine';
import { resolveAmbiguousCoreAssociations } from './domain/coreAssociation';
import extensionConfig from '../extension.json' with { type: 'json' };

export function activate(status?: 'onStartupFinished', arg?: string): void {
  console.log('[LayoutPilot] activated', { status, arg });
}

async function getTestComponent() {
  const components = await eda.pcb_PrimitiveComponent.getAll();
  return components.find(
    (component) => component.getState_Designator()?.toUpperCase() === 'U1',
  );
}

export async function inspectPcb(): Promise<void> {
  try {
    const components = await eda.pcb_PrimitiveComponent.getAll();

    const preview = components.slice(0, 12).map((component) => ({
      id: component.getState_PrimitiveId(),
      designator: component.getState_Designator(),
      name: component.getState_Name(),
      x: component.getState_X(),
      y: component.getState_Y(),
      rotation: component.getState_Rotation(),
      locked: component.getState_PrimitiveLock(),
    }));

    console.log('[LayoutPilot] PCB components', components);
    console.table(preview);

    const references = preview
      .map((item) => item.designator ?? item.name ?? item.id)
      .join(', ');

    await eda.sys_Dialog.showInformationMessage(
      `LayoutPilot 已成功读取 ${components.length} 个 PCB 器件。\n\n前几个器件：${references || '未发现器件'}\n\n如需查看结构化详情，请打开开发者控制台。`,
      'LayoutPilot · 检查当前 PCB',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Inspect PCB failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `读取当前 PCB 失败。\n\n${String(error)}`,
      'LayoutPilot · API 可行性验证',
    );
  }
}

export async function inspectConnectivity(): Promise<void> {
  try {
    const components = await eda.pcb_PrimitiveComponent.getAll();
    const netMap = new Map<string, Array<{ designator: string; padNumber: string }>>();
    let totalPads = 0;
    let namedPads = 0;

    for (const component of components) {
      const designator = component.getState_Designator() ?? component.getState_Name() ?? component.getState_PrimitiveId();
      const primitiveId = component.getState_PrimitiveId();
      const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);

      for (const pad of pads ?? []) {
        totalPads += 1;

        const rawNet = pad.getState_Net();
        const net = typeof rawNet === 'string' ? rawNet.trim() : '';
        if (!net || net.toLowerCase() === 'none') {
          continue;
        }

        namedPads += 1;
        const padNumber = String(pad.getState_PadNumber() ?? '?');
        const entries = netMap.get(net) ?? [];
        entries.push({ designator, padNumber });
        netMap.set(net, entries);
      }
    }

    const networks = Array.from(netMap.entries())
      .map(([net, endpoints]) => ({
        net,
        endpoints,
        endpointText: endpoints.map((endpoint) => `${endpoint.designator}.${endpoint.padNumber}`).join(' ↔ '),
      }))
      .sort((a, b) => b.endpoints.length - a.endpoints.length || a.net.localeCompare(b.net));

    console.log('[LayoutPilot] connectivity networks', networks);
    console.table(
      networks.slice(0, 20).map((item) => ({
        net: item.net,
        endpoints: item.endpointText,
        count: item.endpoints.length,
      })),
    );

    const preview = networks
      .slice(0, 5)
      .map((item) => `${item.net}: ${item.endpointText}`)
      .join('\n');

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 网络连接检查完成。',
        '',
        `器件数量：${components.length}`,
        `焊盘数量：${totalPads}`,
        `具有已命名网络的焊盘：${namedPads}`,
        `已命名网络数量：${networks.length}`,
        '',
        preview || '未发现已命名网络。',
        '',
        '如需查看完整连接关系，请打开开发者控制台。',
      ].join('\n'),
      'LayoutPilot · 检查网络连接',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Inspect Connectivity failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `检查网络连接失败。\n\n${String(error)}`,
      'LayoutPilot · API 可行性验证',
    );
  }
}


export async function inspectCircuitGraph(): Promise<void> {
  try {
    const components = await eda.pcb_PrimitiveComponent.getAll();
    const snapshots: CircuitComponentSnapshot[] = [];

    for (const component of components) {
      const primitiveId = component.getState_PrimitiveId();
      const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);

      snapshots.push({
        id: primitiveId,
        designator: component.getState_Designator() ?? component.getState_Name() ?? primitiveId,
        name: component.getState_Name(),
        padCount: pads?.length ?? 0,
        pads: (pads ?? []).map((pad) => ({
          padNumber: String(pad.getState_PadNumber() ?? '?'),
          net: pad.getState_Net(),
        })),
      });
    }

    const graph = buildCircuitGraph(snapshots);
    const idToDesignator = new Map(graph.nodes.map((node) => [node.id, node.designator]));

    const nodeSummary = graph.nodes.map((node) => ({
      component: node.designator,
      pads: node.padCount,
      nets: node.connectedNetCount,
      neighbors: node.neighborComponentIds
        .map((id) => idToDesignator.get(id) ?? id)
        .join(', '),
      isolated: node.isIsolated,
    }));

    const netSummary = graph.nets.map((net) => ({
      net: net.name,
      endpoints: net.endpoints
        .map((endpoint) => `${endpoint.designator}.${endpoint.padNumber}`)
        .join(' ↔ '),
      components: net.componentIds.length,
    }));

    console.log('[LayoutPilot] circuit graph', graph);
    console.table(nodeSummary);
    console.table(netSummary);

    const isolated = graph.nodes
      .filter((node) => node.isIsolated)
      .map((node) => node.designator);

    const connected = graph.nodes.length - isolated.length;
    const netPreview = graph.nets
      .slice(0, 5)
      .map((net) => `${net.name}: ${net.endpoints
        .map((endpoint) => `${endpoint.designator}.${endpoint.padNumber}`)
        .join(' ↔ ')}`)
      .join('\n');

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 已成功构建电路关系图。',
        '',
        `器件数量：${graph.nodes.length}`,
        `已连接器件：${connected}`,
        `孤立器件：${isolated.length}${isolated.length ? `（${isolated.join(', ')}）` : ''}`,
        `已命名网络：${graph.nets.length}`,
        '',
        netPreview || '未发现已命名网络。',
        '',
        '如需查看节点表和网络表，请打开开发者控制台。',
      ].join('\n'),
      'LayoutPilot · 电路关系图',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Circuit Graph failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `构建电路关系图失败。\n\n${String(error)}`,
      'LayoutPilot · 第 1 阶段',
    );
  }
}


export async function inspectStructuralFeatures(): Promise<void> {
  try {
    const components = await eda.pcb_PrimitiveComponent.getAll();
    const snapshots: CircuitComponentSnapshot[] = [];
    const metadata: ComponentMetadata[] = [];

    for (const component of components) {
      const primitiveId = component.getState_PrimitiveId();
      const designator = component.getState_Designator() ?? component.getState_Name() ?? primitiveId;
      const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
      const footprint = component.getState_Footprint();

      snapshots.push({
        id: primitiveId,
        designator,
        name: component.getState_Name(),
        padCount: pads?.length ?? 0,
        pads: (pads ?? []).map((pad) => ({
          padNumber: String(pad.getState_PadNumber() ?? '?'),
          net: pad.getState_Net(),
        })),
      });

      metadata.push({
        id: primitiveId,
        designator,
        manufacturer: component.getState_Manufacturer(),
        supplier: component.getState_Supplier(),
        footprintName: footprint?.name,
      });
    }

    const graph = buildCircuitGraph(snapshots);
    const features = extractStructuralFeatures(graph, metadata)
      .sort((a, b) => b.coreScore - a.coreScore || a.designator.localeCompare(b.designator));

    console.log('[LayoutPilot] structural features', features);
    console.table(features.map((feature) => ({
      component: feature.designator,
      prefix: feature.referencePrefix,
      pads: feature.padCount,
      degree: feature.degree,
      nets: feature.connectedNetCount,
      maxNetSize: feature.maxComponentsOnSharedNet,
      passive: feature.isPassiveCandidate,
      peripheral: feature.isPeripheralCandidate,
      boundary: feature.isBoundaryCandidate,
      coreScore: feature.coreScore,
      coreLevel: feature.coreLevel,
    })));

    const preview = features.slice(0, 8).map((feature) => {
      const evidence = feature.coreEvidence.length
        ? feature.coreEvidence.map(structuralEvidenceZh).join('；')
        : '暂无结构判断依据';

      const role = feature.isBoundaryCandidate
        ? '边界器件候选'
        : feature.isPeripheralCandidate
          ? '外围器件候选'
          : `核心候选=${coreLevelZh(feature.coreLevel)}（${feature.coreScore}/10）`;

      return `${feature.designator}：${role}，相邻器件=${feature.degree}，焊盘=${feature.padCount}\n  判断依据：${evidence}`;
    }).join('\n');

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 结构特征提取完成。',
        '',
        '说明：核心评分来自透明的结构规则，不是 AI 语义判断。',
        '',
        preview,
        '',
        '如需查看完整特征表，请打开开发者控制台。',
      ].join('\n'),
      'LayoutPilot · 结构特征',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Structural Features failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `提取结构特征失败。\n\n${String(error)}`,
      'LayoutPilot · 第 1 阶段',
    );
  }
}


export async function inspectCandidateGroups(): Promise<void> {
  try {
    const components = await eda.pcb_PrimitiveComponent.getAll();
    const snapshots: CircuitComponentSnapshot[] = [];
    const metadata: ComponentMetadata[] = [];

    for (const component of components) {
      const primitiveId = component.getState_PrimitiveId();
      const designator = component.getState_Designator() ?? component.getState_Name() ?? primitiveId;
      const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
      const footprint = component.getState_Footprint();

      snapshots.push({
        id: primitiveId,
        designator,
        name: component.getState_Name(),
        padCount: pads?.length ?? 0,
        pads: (pads ?? []).map((pad) => ({
          padNumber: String(pad.getState_PadNumber() ?? '?'),
          net: pad.getState_Net(),
        })),
      });

      metadata.push({
        id: primitiveId,
        designator,
        manufacturer: component.getState_Manufacturer(),
        supplier: component.getState_Supplier(),
        footprintName: footprint?.name,
      });
    }

    const graph = buildCircuitGraph(snapshots);
    const features = extractStructuralFeatures(graph, metadata);
    const grouping = buildCandidateGroups(graph, features);

    console.log('[LayoutPilot] candidate groups', grouping);

    const groupText = grouping.groups.length
      ? grouping.groups.map((group, index) => {
          const members = group.satelliteDesignators.length
            ? group.satelliteDesignators.join('、')
            : '暂无外围器件';
          const evidence = group.evidence.map(groupEvidenceZh).join('；');
          return [
            `候选功能块 ${index + 1}`,
            `核心器件：${group.coreDesignator}`,
            `外围器件：${members}`,
            `判断依据：${evidence}`,
          ].join('\n');
        }).join('\n\n')
      : '当前没有识别出候选功能块。';

    const ungroupedText = grouping.ungroupedDesignators.length
      ? grouping.ungroupedDesignators.join('、')
      : '无';

    const boundaryText = grouping.boundaryDesignators.length
      ? grouping.boundaryDesignators.join('、')
      : '无';

    const ambiguousText = grouping.ambiguousDesignators.length
      ? grouping.ambiguousDesignators.join('、')
      : '无';

    const ambiguityEvidenceText = grouping.ambiguityEvidence.length
      ? grouping.ambiguityEvidence.map(groupEvidenceZh).join('；')
      : '无';

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 候选功能块分析完成。',
        '',
        groupText,
        '',
        `存在歧义的器件：${ambiguousText}`,
        `歧义原因：${ambiguityEvidenceText}`,
        `未归组器件：${ungroupedText}`,
        `边界器件候选：${boundaryText}`,
        '',
        '说明：全局电源/地等低信息网络不会被当作强分组依据；存在歧义时系统会保留不确定性，而不是强行归组。',
      ].join('\n'),
      'LayoutPilot · 候选功能块',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Candidate Grouping failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `候选功能块分析失败。\n\n${String(error)}`,
      'LayoutPilot · 第 1 阶段',
    );
  }
}



async function collectAnalysisState() {
  const components = await eda.pcb_PrimitiveComponent.getAll();
  const snapshots: CircuitComponentSnapshot[] = [];
  const metadata: ComponentMetadata[] = [];
  const semanticMetadata: SemanticComponentMetadata[] = [];

  for (const component of components) {
    const primitiveId = component.getState_PrimitiveId();
    const designator = component.getState_Designator() ?? component.getState_Name() ?? primitiveId;
    const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
    const footprint = component.getState_Footprint();

    snapshots.push({
      id: primitiveId,
      designator,
      name: component.getState_Name(),
      padCount: pads?.length ?? 0,
      pads: (pads ?? []).map((pad) => ({
        padNumber: String(pad.getState_PadNumber() ?? '?'),
        net: pad.getState_Net(),
      })),
    });

    const commonMeta = {
      id: primitiveId,
      designator,
      manufacturer: component.getState_Manufacturer(),
      supplier: component.getState_Supplier(),
      footprintName: footprint?.name,
    };

    metadata.push(commonMeta);
    semanticMetadata.push({
      ...commonMeta,
      name: component.getState_Name(),
      otherProperty: component.getState_OtherProperty(),
    });
  }

  const graph = buildCircuitGraph(snapshots);
  const features = extractStructuralFeatures(graph, metadata);
  const grouping = buildCandidateGroups(graph, features);
  const contexts = buildSemanticContexts(
    graph,
    features,
    grouping,
    semanticMetadata,
  );

  return {
    graph,
    features,
    grouping,
    contexts,
  };
}

async function collectSemanticContexts(): Promise<SemanticComponentContext[]> {
  return (await collectAnalysisState()).contexts;
}

export async function inspectSemanticContext(): Promise<void> {
  try {
    const contexts = await collectSemanticContexts();

    console.log('[LayoutPilot] semantic contexts', contexts);

    if (!contexts.length) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '当前没有需要进入语义层的歧义器件。',
          '',
          '说明：该功能不会重新分析已被规则层确定的器件，只为不确定项准备 AI 输入上下文。',
        ].join('\n'),
        'LayoutPilot · 语义上下文',
      );
      return;
    }

    const preview = contexts.slice(0, 6).map((context) => {
      const nets = context.connectedNets.length
        ? context.connectedNets.map((net) => {
            const peers = net.peerEndpoints.length
              ? net.peerEndpoints
                  .slice(0, 6)
                  .map((endpoint) => `${endpoint.designator}.${endpoint.padNumber}`)
                  .join('、')
              : '无其他器件';

            return `${net.netName}[${netGroupingClassZh(net.classification)}] → ${peers}`;
          }).join('\n')
        : '无';

      const cores = context.relatedCoreDesignators.length
        ? context.relatedCoreDesignators.join('、')
        : '暂未找到直接核心关联';

      const missing = context.missingEvidence.length
        ? context.missingEvidence.map(semanticMissingEvidenceZh).join('；')
        : '无明显缺失';

      return [
        `${context.designator} · 待语义分析`,
        `器件名称：${context.name || '未知'}`,
        `器件值：${context.value || '未知'}`,
        `制造商型号：${context.manufacturerPart || '未知'}`,
        `封装：${context.footprintName || '未知'}`,
        `网络：${nets}`,
        `可能相关核心：${cores}`,
        `缺失证据：${missing}`,
      ].join('\n');
    }).join('\n\n');

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 已生成语义上下文。',
        '',
        '注意：下面只是准备给 AI 的结构化输入，目前还没有调用 AI。',
        '',
        preview,
        '',
        '完整结构化上下文已输出到开发者控制台。',
      ].join('\n'),
      'LayoutPilot · 语义上下文',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Semantic Context failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `生成语义上下文失败。\n\n${String(error)}`,
      'LayoutPilot · 第 2 阶段',
    );
  }
}


export async function inspectCoreAssociations(): Promise<void> {
  try {
    const {
      graph,
      features,
      grouping,
    } = await collectAnalysisState();

    const results = resolveAmbiguousCoreAssociations(
      graph,
      features,
      grouping,
    );

    console.log('[LayoutPilot] core association results', results);
    console.table(results.map(result => ({
      component: result.designator,
      status: result.status,
      resolvedCore: result.resolvedCoreDesignator ?? '',
      topScore: result.topScore.toFixed(3),
      margin: result.margin?.toFixed(3) ?? '',
      candidates: result.candidates
        .slice(0, 4)
        .map(candidate => `${candidate.designator}(${candidate.score.toFixed(3)})`)
        .join(', '),
    })));

    const resolved = results.filter(result => result.status === 'resolved');
    const ambiguous = results.filter(result => result.status === 'ambiguous');
    const insufficient = results.filter(
      result => result.status === 'insufficient-evidence',
    );

    const rows = results.map((result) => {
      const candidates = result.candidates
        .slice(0, 3)
        .map(candidate => {
          const evidence = candidate.evidence
            .filter(item => item.contribution > 0)
            .slice(0, 3)
            .map(item => `${item.netName ?? item.kind}:+${item.contribution.toFixed(3)}`)
            .join('、');
          return `${candidate.designator}=${candidate.score.toFixed(3)}${evidence ? `[${evidence}]` : ''}`;
        })
        .join('；');

      if (result.status === 'resolved') {
        return [
          `${result.designator}：已解析 → ${result.resolvedCoreDesignator}`,
          `score=${result.topScore.toFixed(3)}`,
          `margin=${result.margin?.toFixed(3) ?? '—'}`,
          candidates ? `候选：${candidates}` : '',
        ].filter(Boolean).join(' · ');
      }

      if (result.status === 'ambiguous') {
        return [
          `${result.designator}：保留歧义`,
          candidates ? `候选：${candidates}` : '无有效候选',
          `margin=${result.margin?.toFixed(3) ?? '—'}`,
        ].join(' · ');
      }

      return [
        `${result.designator}：证据不足`,
        candidates ? `候选：${candidates}` : '无有效候选',
        `top=${result.topScore.toFixed(3)}`,
      ].join(' · ');
    });

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 核心关联诊断完成。',
        '',
        `歧义器件：${results.length}`,
        `可解析：${resolved.length}`,
        `保留歧义：${ambiguous.length}`,
        `证据不足：${insufficient.length}`,
        '',
        ...rows,
        '',
        '说明：',
        '• GND 不参与 owner 选择；',
        '• 高扇出电源网只提供弱证据；',
        '• 多个候选接近时保留歧义；',
        '• 当前结果仅用于诊断，不会改写 AI 上下文、布局约束或 PCB。',
      ].join('\n'),
      'LayoutPilot · 核心关联诊断',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Core Association Resolver failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `核心关联诊断失败。\n\n${String(error)}\n\nPCB 未发生任何修改。`,
      'LayoutPilot · Phase 3A',
    );
  }
}


const AI_GATEWAY_CONFIG_KEY = 'aiGatewayBaseUrl';
const DEFAULT_AI_GATEWAY_URL = 'http://127.0.0.1:8787';

export function configureAiGateway(): void {
  const current = String(
    eda.sys_Storage.getExtensionUserConfig(AI_GATEWAY_CONFIG_KEY)
    ?? DEFAULT_AI_GATEWAY_URL,
  );

  eda.sys_Dialog.showInputDialog(
    '请输入 LayoutPilot AI Gateway 地址。',
    'API Key 不应填写在这里；它只保存在本机 Gateway 进程的环境变量中。',
    'LayoutPilot · 配置 AI Gateway',
    'url',
    current,
    {
      placeholder: DEFAULT_AI_GATEWAY_URL,
    },
    async (value) => {
      if (typeof value !== 'string' || !value.trim()) {
        return;
      }

      try {
        const normalized = normalizeGatewayBaseUrl(value);
        const saved = await eda.sys_Storage.setExtensionUserConfig(
          AI_GATEWAY_CONFIG_KEY,
          normalized,
        );

        await eda.sys_Dialog.showInformationMessage(
          saved
            ? `AI Gateway 已保存：\n${normalized}`
            : 'AI Gateway 地址保存失败。',
          'LayoutPilot · AI Gateway',
        );
      }
      catch (error) {
        await eda.sys_Dialog.showInformationMessage(
          `Gateway 地址无效。\n\n${String(error)}`,
          'LayoutPilot · AI Gateway',
        );
      }
    },
  );
}

async function getConfiguredGatewayBaseUrl(): Promise<string | null> {
  const configured = eda.sys_Storage.getExtensionUserConfig(AI_GATEWAY_CONFIG_KEY);

  if (typeof configured !== 'string' || !configured.trim()) {
    await eda.sys_Dialog.showInformationMessage(
      [
        '尚未配置 AI Gateway。',
        '',
        '请先运行“配置 AI Gateway”。',
        `推荐本地地址：${DEFAULT_AI_GATEWAY_URL}`,
        '',
        '注意：模型厂商 API Key 不应存入嘉立创扩展。',
      ].join('\n'),
      'LayoutPilot · AI 语义分析',
    );
    return null;
  }

  return normalizeGatewayBaseUrl(configured);
}

async function performSemanticGatewayRequest(
  context: SemanticComponentContext,
  gatewayBaseUrl: string,
  validationFeedback?: string[],
) {
  const evidenceCatalog = buildSemanticEvidenceCatalog(context);
  const request = buildSemanticGatewayRequest(
    context,
    evidenceCatalog,
    allowedSemanticRolesForPrefix(context.referencePrefix),
    validationFeedback,
  );

  console.log('[LayoutPilot] AI semantic request', request);

  const response = await eda.sys_ClientUrl.request(
    `${gatewayBaseUrl}/semantic-infer`,
    'POST',
    JSON.stringify(request),
    {
      headers: {
        'content-type': 'application/json',
      },
    },
  );

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Gateway HTTP ${response.status}: ${responseText.slice(0, 500)}`,
    );
  }

  const gatewayResponse = parseSemanticGatewayResponse(
    JSON.parse(responseText),
  );

  const validation = validateSemanticInference(
    context,
    gatewayResponse.inference,
  );

  console.log('[LayoutPilot] AI semantic response', gatewayResponse);
  console.log('[LayoutPilot] AI semantic validation', validation);

  return {
    evidenceCatalog,
    gatewayResponse,
    validation,
  };
}

async function requestSemanticInference(
  context: SemanticComponentContext,
  gatewayBaseUrl: string,
) {
  const first = await performSemanticGatewayRequest(
    context,
    gatewayBaseUrl,
  );

  if (
    first.validation.valid
    || first.gatewayResponse.provider === 'mock'
  ) {
    return {
      ...first,
      repaired: false,
    };
  }

  console.warn(
    '[LayoutPilot] AI result rejected, retrying once with validator feedback',
    {
      designator: context.designator,
      errors: first.validation.errors,
    },
  );

  const second = await performSemanticGatewayRequest(
    context,
    gatewayBaseUrl,
    first.validation.errors,
  );

  return {
    ...second,
    repaired: second.validation.valid,
  };
}

export async function analyzeAmbiguousWithAi(): Promise<void> {
  const gatewayBaseUrl = await getConfiguredGatewayBaseUrl();
  if (!gatewayBaseUrl) {
    return;
  }

  try {
    const contexts = await collectSemanticContexts();

    if (!contexts.length) {
      await eda.sys_Dialog.showInformationMessage(
        '当前 PCB 没有需要 AI 补全语义的歧义器件。',
        'LayoutPilot · AI 批量语义分析',
      );
      return;
    }

    const rows: string[] = [];
    let passed = 0;
    let blocked = 0;
    let failed = 0;
    let providerLabel = '';

    for (const context of contexts) {
      try {
        const { gatewayResponse, validation } = await requestSemanticInference(
          context,
          gatewayBaseUrl,
        );

        const provider = gatewayResponse.provider ?? 'unknown';
        const model = gatewayResponse.model ?? 'unknown';
        providerLabel ||= `${provider} / ${model}`;

        if (provider === 'mock') {
          rows.push(`${context.designator}：仅完成 Mock 通路测试，不作为 AI 结论`);
          continue;
        }

        if (!validation.valid) {
          blocked += 1;
          rows.push(
            `${context.designator}：已拦截 · ${validation.errors.join('；')}`,
          );
          continue;
        }

        passed += 1;
        const inference = gatewayResponse.inference;
        const core = inference.associatedCore
          ? ` · 关联 ${inference.associatedCore}`
          : '';
        rows.push(
          [
            `${context.designator}：${semanticRoleZh(inference.role)}`,
            `置信=${semanticConfidenceZh(inference.confidence)}${core}`,
            '布局动作=由 Constraint Policy 单独推导',
          ].join(' · '),
        );
      }
      catch (error) {
        failed += 1;
        console.error(
          `[LayoutPilot] AI semantic analysis failed for ${context.designator}`,
          error,
        );
        rows.push(`${context.designator}：调用失败 · ${String(error)}`);
      }
    }

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 歧义器件 AI 语义分析完成。',
        '',
        `待分析器件：${contexts.length}`,
        `通过校验：${passed}`,
        `被 Validator 拦截：${blocked}`,
        `调用失败：${failed}`,
        `模型：${providerLabel || '未获得真实模型结果'}`,
        '',
        ...rows,
        '',
        '说明：当前只生成语义角色与证据结论；不会直接生成或执行布局动作。',
      ].join('\n'),
      'LayoutPilot · AI 批量语义分析',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Batch AI semantic analysis failed', error);

    await eda.sys_Dialog.showInformationMessage(
      [
        'AI 批量语义分析失败。',
        '',
        String(error),
        '',
        'PCB 未发生任何修改。',
      ].join('\n'),
      'LayoutPilot · AI 批量语义分析',
    );
  }
}


export async function previewLayoutConstraints(): Promise<void> {
  const gatewayBaseUrl = await getConfiguredGatewayBaseUrl();
  if (!gatewayBaseUrl) return;

  try {
    const contexts = await collectSemanticContexts();
    const previewResults = [];
    const rows: string[] = [];
    let blocked = 0;
    let failed = 0;
    let providerLabel = '';

    for (const context of contexts) {
      try {
        const { gatewayResponse, validation } = await requestSemanticInference(
          context,
          gatewayBaseUrl,
        );

        const provider = gatewayResponse.provider ?? 'unknown';
        const model = gatewayResponse.model ?? 'unknown';
        providerLabel ||= `${provider} / ${model}`;

        if (provider === 'mock') {
          rows.push(`${context.designator}：Mock 模式不生成真实布局约束`);
          continue;
        }

        if (!validation.valid) {
          blocked += 1;
          const reason = validation.errors.length
            ? validation.errors.join('；')
            : '未返回具体校验原因';
          rows.push(
            `${context.designator}：AI 结果被 Validator 拦截 · ${reason}`,
          );
          continue;
        }

        const result = buildConstraintPreview(
          context,
          gatewayResponse.inference,
        );
        previewResults.push(result);

        if (result.proposals.length) {
          for (const proposal of result.proposals) {
            const level = proposal.strength === 'advisory' ? '提示级' : '软约束';
            const execution = proposal.execution === 'review-only'
              ? '仅人工复核，不参与布局计算'
              : '可进入后续布局方案计算';
            const target = proposal.target ? ` → ${proposal.target}` : '';
            rows.push(
              `${proposal.subject}：[${level}] ${layoutConstraintTypeZh(proposal.type)}${target} · 置信=${semanticConfidenceZh(proposal.confidence)} · ${execution}`,
            );
          }
        }
        else {
          const reason = result.skipped[0]?.reason;
          const reasonText = reason === 'semantic-not-inferred'
            ? '语义证据不足'
            : reason === 'unknown-semantic-role'
              ? '语义角色未知'
              : reason === 'no-policy-for-role'
                ? '当前语义角色尚未建立可执行布局策略'
                : reason === 'policy-evidence-insufficient'
                  ? '已有布局策略，但当前 PCB 事实证据不足'
                  : '没有可推导的布局约束';

          const diagnosticLines = (result.skipped[0]?.diagnostics ?? [])
            .flatMap(diagnostic => {
              const checks = diagnostic.checks.map(check => {
                const status = check.status === 'pass'
                  ? '✓'
                  : check.status === 'fail'
                    ? '✗'
                    : '·';
                const detail = check.detail ? `：${check.detail}` : '';
                return `    ${status} ${check.label}${detail}`;
              });
              return [
                `  Policy：${diagnostic.policyId}`,
                ...checks,
              ];
            });

          rows.push(
            [
              `${context.designator}：跳过 · ${reasonText}`,
              ...diagnosticLines,
            ].join('\n'),
          );
        }
      }
      catch (error) {
        failed += 1;
        console.error(
          `[LayoutPilot] Constraint preview failed for ${context.designator}`,
          error,
        );
        rows.push(`${context.designator}：生成失败 · ${String(error)}`);
      }
    }

    const merged = mergeConstraintPreviewResults(previewResults);
    console.log('[LayoutPilot] constraint preview', merged);

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 布局约束预览已生成。',
        '',
        `语义上下文器件：${contexts.length}`,
        `生成约束：${merged.proposals.length}`,
        `软约束：${merged.softCount}`,
        `提示级约束：${merged.advisoryCount}`,
        `可进入后续布局方案：${merged.previewEligibleCount}`,
        `仅人工复核：${merged.reviewOnlyCount}`,
        `AI 结果被拦截：${blocked}`,
        `调用失败：${failed}`,
        `模型：${providerLabel || '未获得真实模型结果'}`,
        '',
        ...rows,
        '',
        '安全边界：',
        '• AI 生成的约束不会成为硬约束；',
        '• 低置信结果不会参与布局计算；',
        '• 当前仅预览约束，不会移动任何 PCB 器件。',
      ].join('\n'),
      'LayoutPilot · 布局约束预览',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Layout constraint preview failed', error);
    await eda.sys_Dialog.showInformationMessage(
      `生成布局约束预览失败。\n\n${String(error)}\n\nPCB 未发生任何修改。`,
      'LayoutPilot · 第 3 阶段',
    );
  }
}

export async function about(): Promise<void> {
  await eda.sys_Dialog.showInformationMessage(
    `LayoutPilot v${extensionConfig.version}\n\n第 3 阶段：把已校验的语义结果转换为可解释、分级的布局约束。\n当前只生成约束预览，不会自动修改 PCB。`,
    '关于 LayoutPilot',
  );
}
