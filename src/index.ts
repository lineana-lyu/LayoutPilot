import { extractStructuralFeatures, type ComponentMetadata } from './domain/componentFeatures';
import { coreLevelZh, groupEvidenceZh, layoutConstraintTypeZh, lockedZh, netGroupingClassZh, ownershipRelationZh, semanticConfidenceZh, semanticMissingEvidenceZh, semanticRoleZh, structuralEvidenceZh } from './i18n/zhCN';
import { buildCandidateGroups } from './domain/candidateGrouping';
import { buildSemanticContexts, resolveComponentDisplayName, type SemanticComponentContext, type SemanticComponentMetadata } from './domain/semanticContext';
import { allowedSemanticRolesForPrefix, buildSemanticEvidenceCatalog, validateSemanticInference } from './domain/semanticInference';
import { buildSemanticGatewayRequest, normalizeGatewayBaseUrl, parseSemanticGatewayResponse } from './ai/gatewayClient';
import { buildConstraintEvaluation } from './application/constraintEvaluation';
import { executePlacementTransaction } from './application/placementTransaction';
import { resolveAmbiguousCoreAssociations } from './domain/coreAssociation';
import { resolveOwnershipRelations } from './domain/ownershipRelation';
import { createHumanOwnershipDecision } from './domain/humanOwnershipDecision';
import { buildSemanticBoardFingerprint, createSemanticSnapshot, semanticSnapshotMatchesBoard, type SemanticSnapshot, type SemanticSnapshotEntry } from './domain/semanticSnapshot';
import { placementPlansEquivalent, planDecouplingPlacement, validatePlacementTarget } from './domain/physicalPlacement';
import { createPlacementCommand, markPlacementCommandApplied, markPlacementCommandSuperseded, markPlacementCommandUndone } from './domain/placementCommand';
import { filterOwnershipPropertyNames, findOwnershipFields, findOwnershipMemberNames } from './domain/ownershipCapabilityProbe';
import { collectPhysicalComponents, collectSimpleBoardBoundary, collectSimpleComponentKeepouts, moveComponentAndVerify, readComponentPhysicalState } from './eda/pcbPhysicalAdapter';
import { collectAnalysisState } from './eda/analysisAdapter';
import { openLayoutPilotWorkbench } from './ui/workbenchWindow';
import { clearStoredSemanticSnapshot, getStoredHumanOwnershipDecisions, getStoredLastPlacementCommand, getStoredSemanticSnapshot, removeStoredHumanOwnershipDecision, replaceStoredSemanticSnapshot, setStoredLastPlacementCommand, upsertStoredHumanOwnershipDecision } from './eda/workflowStore';
import extensionConfig from '../extension.json' with { type: 'json' };

export function activate(status?: 'onStartupFinished', arg?: string): void {
  console.log('[LayoutPilot] activated', { status, arg });
}

export async function openWorkbench(): Promise<void> {
  await openLayoutPilotWorkbench();
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

      const hosts = context.ownership.hostDesignators.length
        ? context.ownership.hostDesignators.join('、')
        : '无';
      const owner = context.ownership.ownerDesignator ?? '无唯一 owner';
      const sharedSignals = context.ownership.sharedSignalNets.length
        ? context.ownership.sharedSignalNets.join('、')
        : '无';
      const rails = context.ownership.railNets.length
        ? context.ownership.railNets.join('、')
        : '无';

      const missing = context.missingEvidence.length
        ? context.missingEvidence.map(semanticMissingEvidenceZh).join('；')
        : '无明显缺失';

      return [
        `${context.designator} · 待语义分析`,
        `器件名称：${context.name || '未知'}`,
        `器件值：${context.value || '未知'}`,
        `制造商型号：${context.manufacturerPart || '未知'}`,
        `封装：${context.footprintName || '未知'}`,
        `确定性关系：${ownershipRelationZh(context.ownership.relation)}`,
        `唯一 owner：${owner}`,
        `Host：${hosts}`,
        `共享信号：${sharedSignals}`,
        `电源域：${rails}`,
        `网络：${nets}`,
        `缺失证据：${missing}`,
      ].join('\n');
    }).join('\n\n');

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 已生成语义上下文。',
        '',
        '注意：归属关系由确定性规则先计算；AI 只负责判断器件角色，不再决定 owner。',
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


export async function inspectOwnershipRelations(): Promise<void> {
  try {
    const {
      graph,
      features,
      grouping,
    } = await collectAnalysisState();

    const results = resolveOwnershipRelations(
      graph,
      features,
      grouping.ambiguousComponentIds,
    );

    console.log('[LayoutPilot] ownership relation results', results);
    console.table(results.map(result => ({
      component: result.designator,
      relation: result.relation,
      owner: result.ownerDesignator ?? '',
      hosts: result.hostDesignators.join(', '),
      sharedSignals: result.sharedSignalNets.join(', '),
      rails: result.railNets.join(', '),
    })));

    const counts = new Map<string, number>();
    for (const result of results) {
      counts.set(
        result.relation,
        (counts.get(result.relation) ?? 0) + 1,
      );
    }

    const rows = results.map((result) => {
      const owner = result.ownerDesignator
        ? ` · owner=${result.ownerDesignator}`
        : '';
      const hosts = result.hostDesignators.length
        ? ` · hosts=${result.hostDesignators.join('、')}`
        : '';
      const buses = result.sharedSignalNets.length
        ? ` · shared=${result.sharedSignalNets.join('、')}`
        : '';
      const rails = result.railNets.length
        ? ` · rail=${result.railNets.join('、')}`
        : '';

      return [
        `${result.designator}：${ownershipRelationZh(result.relation)}`,
        owner,
        hosts,
        buses,
        rails,
        `\n  ${result.explanation}`,
      ].join('');
    });

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 归属关系诊断完成。',
        '',
        `歧义器件：${results.length}`,
        `显式归属：${counts.get('explicit-owner') ?? 0}`,
        `单核心归属：${counts.get('single-core') ?? 0}`,
        `跨核心桥接：${counts.get('bridge') ?? 0}`,
        `共享信号/多 Host：${counts.get('shared-signal') ?? 0}`,
        `电源域关系：${counts.get('rail-domain') ?? 0}`,
        `未知关系：${counts.get('unknown') ?? 0}`,
        '',
        ...rows,
        '',
        '说明：',
        '• 先判断关系类型，再决定是否存在唯一 owner；',
        '• 共享信号、桥接、电源域不会被强行压成单核心归属；',
        '• 显式归属接口已预留，但当前尚未从嘉立创工程读取复用模块/分组元数据；',
        '• 当前结果只用于诊断，不会改写 Semantic Context、Constraint Policy 或 PCB。',
      ].join('\n'),
      'LayoutPilot · 归属关系诊断',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Ownership Relation Resolver failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `归属关系诊断失败。\n\n${String(error)}\n\nPCB 未发生任何修改。`,
      'LayoutPilot · Phase 3A.2',
    );
  }
}


export async function inspectExplicitOwnershipCapability(): Promise<void> {
  try {
    const components = await eda.pcb_PrimitiveComponent.getAll();
    const propertyNames = await eda.pcb_PrimitiveComponent.getAllPropertyNames();
    const ownershipPropertyNames = filterOwnershipPropertyNames(
      propertyNames ?? [],
    );

    const fieldHits = components.flatMap((component) => {
      const designator = component.getState_Designator()
        ?? component.getState_Name()
        ?? component.getState_PrimitiveId();

      return [
        ...findOwnershipFields(
          component.getState_OtherProperty(),
          `${designator}.otherProperty`,
        ),
        ...findOwnershipFields(
          component.getState_Footprint(),
          `${designator}.footprint`,
        ),
      ];
    });

    const runtimeMemberHits = components.length
      ? findOwnershipMemberNames(
          components[0],
          'PCB component runtime object',
        )
      : [];

    console.log('[LayoutPilot] explicit ownership capability probe', {
      ownershipPropertyNames,
      fieldHits,
      runtimeMemberHits,
    });

    const propertyText = ownershipPropertyNames.length
      ? ownershipPropertyNames.join('、')
      : '未发现';

    const fieldText = fieldHits.length
      ? fieldHits
          .slice(0, 20)
          .map(hit =>
            `${hit.source} → ${hit.path}`
            + (hit.valuePreview !== undefined
              ? ` = ${hit.valuePreview}`
              : ''),
          )
          .join('\n')
      : '未发现';

    const runtimeText = runtimeMemberHits.length
      ? runtimeMemberHits.map(hit => hit.path).join('、')
      : '未发现';

    const conclusion = fieldHits.length
      ? [
          '发现了可读取的“显式归属候选字段”。',
          '下一步只能先验证这些字段是否真的是稳定的分组/复用模块语义；',
          '本版本不会自动把它们写入 owner。',
        ].join('')
      : ownershipPropertyNames.length
        ? [
            '官方属性目录中出现了疑似分组/复用相关名称，',
            '但当前 PCB 器件的可读取扩展属性里还没有找到对应值。',
          ].join('')
        : runtimeMemberHits.length
          ? [
              '运行时对象中发现了疑似相关成员名，',
              '但它们尚未被确认是公开、稳定的插件 API，因此不会使用。',
            ].join('')
          : [
              '当前公开可读取的器件属性中没有发现可直接消费的显式归属信息。',
              '这不代表工程文件里不存在 groupId/REUSE_BLOCK，只代表当前插件 API 路径没有直接暴露给我们。',
            ].join('');

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 显式归属能力探测完成。',
        '',
        `器件数量：${components.length}`,
        '',
        '① 官方器件属性名中的候选：',
        propertyText,
        '',
        '② 当前器件扩展属性/封装中实际读到的候选字段：',
        fieldText,
        '',
        '③ 运行时对象中疑似相关成员名（仅诊断，不作为正式 API）：',
        runtimeText,
        '',
        '结论：',
        conclusion,
        '',
        '安全边界：',
        '• 只读取，不修改 PCB；',
        '• 不会把疑似字段自动当成 owner；',
        '• 不会改变 Semantic Context、Constraint Policy 或布局结果。',
      ].join('\n'),
      'LayoutPilot · 显式归属能力探测',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Explicit ownership capability probe failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `显式归属能力探测失败。\n\n${String(error)}\n\nPCB 未发生任何修改。`,
      'LayoutPilot · Phase 3A.3',
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

export interface SemanticAnalysisRunResult {
  snapshot: SemanticSnapshot;
  total: number;
  passed: number;
  blocked: number;
  failed: number;
  providerLabel: string;
}

export async function runSemanticAnalysis(): Promise<
  SemanticAnalysisRunResult | undefined
> {
  const gatewayBaseUrl = await getConfiguredGatewayBaseUrl();
  if (!gatewayBaseUrl) {
    return undefined;
  }

  const analysisState = await collectAnalysisState();
  const contexts = analysisState.contexts;
  const boardFingerprint = buildSemanticBoardFingerprint({
    graph: analysisState.graph,
    contexts,
  });

  if (!contexts.length) {
    await clearStoredSemanticSnapshot();
    return undefined;
  }

  const snapshotEntries: SemanticSnapshotEntry[] = [];
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

      const entryBase = {
        componentId: context.componentId,
        designator: context.designator,
        context,
        inference: gatewayResponse.inference,
        validationErrors: [...validation.errors],
        provider,
        model,
      };

      if (provider === 'mock') {
        snapshotEntries.push({
          ...entryBase,
          status: 'mock',
        });
        continue;
      }

      if (!validation.valid) {
        blocked += 1;
        snapshotEntries.push({
          ...entryBase,
          status: 'blocked',
        });
        continue;
      }

      passed += 1;
      snapshotEntries.push({
        ...entryBase,
        status: 'valid',
      });
    }
    catch (error) {
      failed += 1;
      console.error(
        `[LayoutPilot] AI semantic analysis failed for ${context.designator}`,
        error,
      );
      snapshotEntries.push({
        componentId: context.componentId,
        designator: context.designator,
        context,
        status: 'failed',
        validationErrors: [],
        error: String(error),
      });
    }
  }

  const snapshot = createSemanticSnapshot(
    boardFingerprint,
    snapshotEntries,
  );
  await replaceStoredSemanticSnapshot(snapshot);
  console.log('[LayoutPilot] semantic snapshot frozen', snapshot);

  return {
    snapshot,
    total: contexts.length,
    passed,
    blocked,
    failed,
    providerLabel,
  };
}

export async function analyzeAmbiguousWithAi(): Promise<void> {
  try {
    const result = await runSemanticAnalysis();
    if (!result) {
      await eda.sys_Dialog.showInformationMessage(
        '当前 PCB 没有需要 AI 补全语义的歧义器件，或尚未配置 AI Gateway。',
        'LayoutPilot · AI 语义分析',
      );
      return;
    }

    await openLayoutPilotWorkbench();
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
      'LayoutPilot · AI 语义分析',
    );
  }
}


function showSingleSelectDialog(
  options: Array<{ value: string; displayContent: string }>,
  beforeContent: string,
  afterContent: string,
  title: string,
  defaultOption?: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    eda.sys_Dialog.showSelectDialog(
      options,
      beforeContent,
      afterContent,
      title,
      defaultOption,
      false,
      (value) => resolve(typeof value === 'string' ? value : undefined),
    );
  });
}

export async function confirmAmbiguousOwnership(): Promise<void> {
  try {
    const snapshot = getStoredSemanticSnapshot();
    if (!snapshot) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '当前没有可复用的 Semantic Snapshot。',
          '',
          '请先运行“AI 分析全部歧义器件（只读）”。',
        ].join('\n'),
        'LayoutPilot · 人工确认 Owner',
      );
      return;
    }

    const analysisState = await collectAnalysisState();
    const boardFingerprint = buildSemanticBoardFingerprint({
      graph: analysisState.graph,
      contexts: analysisState.contexts,
    });

    if (!semanticSnapshotMatchesBoard(snapshot, boardFingerprint)) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '当前 PCB 的语义输入已经变化，旧 Snapshot 已过期。',
          '',
          '请先重新运行 AI 语义分析，再进行人工确认。',
        ].join('\n'),
        'LayoutPilot · 人工确认 Owner',
      );
      return;
    }

    const nodeByDesignator = new Map(
      analysisState.graph.nodes.map(node => [node.designator, node]),
    );
    const metadataById = new Map(
      analysisState.semanticMetadata.map(item => [item.id, item]),
    );
    const eligible = snapshot.entries.filter(entry =>
      entry.status === 'valid'
      && entry.inference?.role === 'decoupling-capacitor'
      && entry.context.ownership.relation === 'rail-domain'
      && entry.context.ownership.hostDesignators.length > 0
    );

    if (!eligible.length) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '当前 Snapshot 中没有需要人工确认 owner 的去耦电容。',
          '',
          '本步骤只处理：AI 已确认去耦角色，但确定性关系仍是 rail-domain 的器件。',
        ].join('\n'),
        'LayoutPilot · 人工确认 Owner',
      );
      return;
    }

    const currentDecisions = getStoredHumanOwnershipDecisions(snapshot.id);
    const decisionByComponentId = new Map(
      currentDecisions.map(decision => [decision.componentId, decision]),
    );
    const selectable = eligible
      .map(entry => ({
        entry,
        candidates: entry.context.ownership.hostDesignators
          .map(designator => nodeByDesignator.get(designator))
          .filter((node): node is NonNullable<typeof node> => Boolean(node)),
      }))
      .filter(item => item.candidates.length > 0);

    if (!selectable.length) {
      await eda.sys_Dialog.showInformationMessage(
        '当前没有可供人工确认的确定性 Host 候选。',
        'LayoutPilot · 人工确认 Owner',
      );
      return;
    }

    let selectedItem = selectable[0];
    if (selectable.length > 1) {
      const pendingFirst = [...selectable].sort((a, b) => {
        const aConfirmed = decisionByComponentId.has(a.entry.componentId) ? 1 : 0;
        const bConfirmed = decisionByComponentId.has(b.entry.componentId) ? 1 : 0;
        const confidenceRank = (value: string | undefined) =>
          value === 'high' ? 0 : value === 'medium' ? 1 : 2;
        return aConfirmed - bConfirmed
          || confidenceRank(a.entry.inference?.confidence)
            - confidenceRank(b.entry.inference?.confidence)
          || a.candidates.length - b.candidates.length
          || a.entry.designator.localeCompare(b.entry.designator);
      });
      const selectedComponentId = await showSingleSelectDialog(
        pendingFirst.map(item => {
          const existing = decisionByComponentId.get(item.entry.componentId);
          const rails = item.entry.context.ownership.railNets.length
            ? item.entry.context.ownership.railNets.join('、')
            : '未知电源域';
          return {
            value: item.entry.componentId,
            displayContent: existing
              ? `${item.entry.designator} · ${rails} · 已确认 → ${existing.ownerDesignator}`
              : `${item.entry.designator} · ${rails} · 待确认`,
          };
        }),
        [
          `当前有 ${selectable.length} 个去耦电容存在 rail-domain 歧义。`,
          '',
          '每次只处理一个高价值问题，避免连续弹窗和误确认。',
        ].join('\n'),
        '请选择本次要确认的器件。',
        'LayoutPilot · 选择待决器件',
        pendingFirst[0].entry.componentId,
      );
      if (!selectedComponentId) return;
      const matched = selectable.find(
        item => item.entry.componentId === selectedComponentId,
      );
      if (!matched) return;
      selectedItem = matched;
    }

    const { entry, candidates } = selectedItem;
    const existing = decisionByComponentId.get(entry.componentId);
    const clearValue = '__layoutpilot_unconfirmed__';
    const rails = entry.context.ownership.railNets.length
      ? entry.context.ownership.railNets.join('、')
      : '未知';
    const options = [
      ...candidates.map(node => {
        const metadata = metadataById.get(node.id);
        const resolvedName = resolveComponentDisplayName(
          metadata?.name,
          metadata?.otherProperty,
        );
        const details = [
          resolvedName && resolvedName !== node.designator
            ? resolvedName
            : undefined,
          metadata?.manufacturer,
          metadata?.footprintName,
          rails,
        ].filter(Boolean).join(' · ');
        return {
          value: node.id,
          displayContent: details
            ? `${node.designator} · ${details}`
            : `${node.designator} · ${rails}`,
        };
      }),
      {
        value: clearValue,
        displayContent: existing ? '清除已确认 owner' : '暂不处理',
      },
    ];
    const selected = await showSingleSelectDialog(
      options,
      [
        `${entry.designator} · ${semanticRoleZh(entry.inference!.role)}`,
        `AI 置信：${semanticConfidenceZh(entry.inference!.confidence)}`,
        `确定性关系：${ownershipRelationZh(entry.context.ownership.relation)}`,
        `电源域：${rails}`,
        '',
        'LayoutPilot 无法仅凭电源域安全确定唯一 owner。',
        '请选择你确认的 Host；该选择会作为“人工证据”，不会改写 AI 结论。',
      ].join('\n'),
      '默认保持“暂不处理”；只有你明确知道归属时才选择 Host。',
      `LayoutPilot · 确认 ${entry.designator} 的 Owner`,
      existing?.ownerComponentId ?? clearValue,
    );

    let confirmed = 0;
    let cleared = 0;
    let skipped = 0;

    if (!selected || selected === clearValue) {
      if (existing && selected === clearValue) {
        await removeStoredHumanOwnershipDecision(snapshot.id, entry.componentId);
        cleared = 1;
      }
      else {
        skipped = 1;
      }
    }
    else {
      const owner = candidates.find(candidate => candidate.id === selected);
      if (!owner) {
        skipped = 1;
      }
      else {
        await upsertStoredHumanOwnershipDecision(
          createHumanOwnershipDecision({
            snapshotId: snapshot.id,
            componentId: entry.componentId,
            componentDesignator: entry.designator,
            ownerComponentId: owner.id,
            ownerDesignator: owner.designator,
          }),
        );
        confirmed = 1;
      }
    }

    const current = getStoredHumanOwnershipDecisions(snapshot.id);
    const summary = current.length
      ? current
          .map(item => `${item.componentDesignator} → ${item.ownerDesignator}`)
          .join('\n')
      : '无';

    await eda.sys_Dialog.showInformationMessage(
      [
        '人工 Owner 确认完成。',
        '',
        `Semantic Snapshot：${snapshot.id}`,
        `本次确认/更新：${confirmed}`,
        `本次清除：${cleared}`,
        `暂不处理：${skipped}`,
        '',
        '当前人工确认：',
        summary,
        '',
        '这些选择会在 Constraint Preview 中转换为 ExplicitOwnershipHint，再交给原有确定性 Ownership Resolver。',
        confirmed === 0
          ? '本次没有新增唯一 owner，因此如果此前也没有人工确认，Constraint Preview 仍会保持 0 条可执行约束。'
          : '本次已经新增人工证据，可以继续运行“查看布局建议”。',
        'AI Semantic Snapshot 本身没有被修改，也不会重新调用模型。',
      ].join('\n'),
      'LayoutPilot · 人工确认 Owner',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Human ownership confirmation failed', error);
    await eda.sys_Dialog.showInformationMessage(
      `人工确认 owner 失败。\n\n${String(error)}\n\nPCB 未发生任何修改。`,
      'LayoutPilot · 人工确认 Owner',
    );
  }
}


interface CurrentConstraintSession {
  analysisState: Awaited<ReturnType<typeof collectAnalysisState>>;
  snapshot: SemanticSnapshot;
  boardFingerprint: string;
  evaluation: ReturnType<typeof buildConstraintEvaluation>;
}

async function collectCurrentConstraintSession(): Promise<
  | { ok: true; value: CurrentConstraintSession }
  | { ok: false; reason: 'missing-snapshot' | 'stale-snapshot'; message: string }
> {
  const analysisState = await collectAnalysisState();
  const boardFingerprint = buildSemanticBoardFingerprint({
    graph: analysisState.graph,
    contexts: analysisState.contexts,
  });
  const snapshot = getStoredSemanticSnapshot();

  if (!snapshot) {
    return {
      ok: false,
      reason: 'missing-snapshot',
      message: '当前没有可复用的 Semantic Snapshot。请先运行 AI 语义分析。',
    };
  }

  if (!semanticSnapshotMatchesBoard(snapshot, boardFingerprint)) {
    return {
      ok: false,
      reason: 'stale-snapshot',
      message: [
        '当前 PCB 的语义输入已经变化，旧 Snapshot 已过期。',
        `Snapshot：${snapshot.id}`,
        `旧 Fingerprint：${snapshot.boardFingerprint}`,
        `当前 Fingerprint：${boardFingerprint}`,
      ].join('\n'),
    };
  }

  const evaluation = buildConstraintEvaluation({
    snapshot,
    graph: analysisState.graph,
    features: analysisState.features,
    grouping: analysisState.grouping,
    semanticMetadata: analysisState.semanticMetadata,
    humanOwnershipDecisions: getStoredHumanOwnershipDecisions(snapshot.id),
  });

  return {
    ok: true,
    value: {
      analysisState,
      snapshot,
      boardFingerprint,
      evaluation,
    },
  };
}

function showConfirmationDialog(
  content: string,
  title: string,
  confirmTitle: string,
): Promise<boolean> {
  return new Promise(resolve => {
    eda.sys_Dialog.showConfirmationMessage(
      content,
      title,
      confirmTitle,
      '取消',
      clicked => resolve(clicked),
    );
  });
}

function closeEnough(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}

export async function previewLayoutConstraints(): Promise<void> {
  try {
    const current = await collectCurrentConstraintSession();
    if (!current.ok) {
      await eda.sys_Dialog.showInformationMessage(
        [
          current.message,
          '',
          '布局约束预览不会为了补结果而重新调用 AI。',
        ].join('\n'),
        current.reason === 'stale-snapshot'
          ? 'LayoutPilot · Snapshot 已过期'
          : 'LayoutPilot · 布局约束预览',
      );
      return;
    }

    const {
      snapshot,
      boardFingerprint,
      evaluation,
    } = current.value;
    const rows: string[] = [];
    let blocked = 0;
    let failed = 0;
    let providerLabel = '';

    for (const item of evaluation.entries) {
      const { entry, context, humanOwnershipDecision, result } = item;
      const provider = entry.provider ?? 'unknown';
      const model = entry.model ?? 'unknown';
      if (entry.provider || entry.model) {
        providerLabel ||= `${provider} / ${model}`;
      }

      if (entry.status === 'mock') {
        rows.push(`${context.designator}：Mock 模式不生成真实布局约束`);
        continue;
      }
      if (entry.status === 'blocked') {
        blocked += 1;
        rows.push(
          `${context.designator}：Snapshot 中的 AI 结果被 Validator 拦截 · ${entry.validationErrors.join('；') || '无具体原因'}`,
        );
        continue;
      }
      if (entry.status === 'failed' || !entry.inference || !result) {
        failed += 1;
        rows.push(
          `${context.designator}：Snapshot 无可用推理结果 · ${entry.error ?? '未知错误'}`,
        );
        continue;
      }

      if (result.proposals.length) {
        for (const proposal of result.proposals) {
          const level = proposal.strength === 'advisory' ? '提示级' : '软约束';
          const execution = proposal.execution === 'review-only'
            ? '仅人工复核，不参与布局计算'
            : '可进入后续布局方案计算';
          const target = proposal.target ? ` → ${proposal.target}` : '';
          const ownershipSource = humanOwnershipDecision
            ? ` · owner来源=人工确认(${humanOwnershipDecision.ownerDesignator})`
            : '';
          rows.push(
            `${proposal.subject}：[${level}] ${layoutConstraintTypeZh(proposal.type)}${target} · 置信=${semanticConfidenceZh(proposal.confidence)} · ${execution}${ownershipSource}`,
          );
        }
        continue;
      }

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
        .flatMap(diagnostic => [
          `  Policy：${diagnostic.policyId}`,
          ...diagnostic.checks.map(check => {
            const status = check.status === 'pass'
              ? '✓'
              : check.status === 'fail'
                ? '✗'
                : '·';
            const detail = check.detail ? `：${check.detail}` : '';
            return `    ${status} ${check.label}${detail}`;
          }),
        ]);

      rows.push(
        [
          `${context.designator}：跳过 · ${reasonText}`,
          ...diagnosticLines,
        ].join('\n'),
      );
    }

    const merged = evaluation.merged;
    console.log('[LayoutPilot] constraint preview from semantic snapshot', {
      snapshotId: snapshot.id,
      result: merged,
    });
    console.log('[LayoutPilot] constraint evaluation detail', evaluation);

    const pendingOwnerEntries = evaluation.entries.filter(item =>
      item.entry.status === 'valid'
      && item.entry.inference?.role === 'decoupling-capacitor'
      && item.context.ownership.relation === 'rail-domain'
      && !item.humanOwnershipDecision
    );
    const sharedSignalDecouplingCount = evaluation.entries.filter(item =>
      item.entry.status === 'valid'
      && item.entry.inference?.role === 'decoupling-capacitor'
      && item.context.ownership.relation === 'shared-signal'
    ).length;
    const unsupportedRoleCount = evaluation.entries.filter(item =>
      item.result?.skipped[0]?.reason === 'no-policy-for-role'
    ).length;
    const insufficientSemanticCount = evaluation.entries.filter(item => {
      const reason = item.result?.skipped[0]?.reason;
      return reason === 'semantic-not-inferred'
        || reason === 'unknown-semantic-role';
    }).length;

    const conciseZeroConstraintRows = [
      '当前没有生成可执行布局约束。',
      '',
      evaluation.explicitOwnershipHints.length === 0 && pendingOwnerEntries.length
        ? `主要阻塞：${pendingOwnerEntries.length} 个去耦电容只有 rail-domain 证据，但没有人工确认唯一 owner。`
        : '主要阻塞：当前证据尚不足以满足已有 Constraint Policy。',
      pendingOwnerEntries.length
        ? `待确认示例：${pendingOwnerEntries.slice(0, 8).map(item => item.context.designator).join('、')}${pendingOwnerEntries.length > 8 ? '…' : ''}`
        : '',
      sharedSignalDecouplingCount
        ? `共享信号/多 Host 去耦：${sharedSignalDecouplingCount} 个，当前不会强制归属。`
        : '',
      unsupportedRoleCount
        ? `尚未建立布局策略的角色：${unsupportedRoleCount} 个。`
        : '',
      insufficientSemanticCount
        ? `语义证据不足：${insufficientSemanticCount} 个。`
        : '',
      '',
      pendingOwnerEntries.length
        ? '下一步：回到“确认待决 Owner（人工）”，只选择你能明确确认归属的一个器件；不确定就继续暂不处理。'
        : '下一步：检查高级诊断中的 Policy 证据，不要为了得到结果而降低安全门槛。',
      '',
      '完整逐器件 Policy 诊断已输出到开发者控制台。',
    ].filter(Boolean);

    const displayRows = merged.proposals.length === 0
      ? conciseZeroConstraintRows
      : rows;

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 布局约束预览已生成。',
        '',
        `Semantic Snapshot：${snapshot.id}`,
        `PCB Fingerprint：${boardFingerprint}`,
        '语义来源：复用已冻结 Snapshot（本步骤未调用 AI）',
        `人工 Owner 确认：${evaluation.explicitOwnershipHints.length}`,
        `生成约束：${merged.proposals.length}`,
        `软约束：${merged.softCount}`,
        `提示级约束：${merged.advisoryCount}`,
        `可进入后续布局方案：${merged.previewEligibleCount}`,
        `仅人工复核：${merged.reviewOnlyCount}`,
        `AI 结果被拦截：${blocked}`,
        `调用失败：${failed}`,
        `模型：${providerLabel || '未获得真实模型结果'}`,
        '',
        ...displayRows,
        '',
        '安全边界：',
        '• Preview 与 Apply 消费同一个 Constraint Evaluation，不复制两套业务逻辑；',
        '• Constraint Preview 不重新调用 AI；',
        '• 人工 Owner 选择作为 ExplicitOwnershipHint 单独叠加；',
        '• 当前预览不会移动任何 PCB 器件。',
      ].join('\n'),
      'LayoutPilot · 布局约束预览',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Layout constraint preview failed', error);
    await eda.sys_Dialog.showInformationMessage(
      `生成布局约束预览失败。\n\n${String(error)}\n\nPCB 未发生任何修改。`,
      'LayoutPilot · 布局约束预览',
    );
  }
}

export async function applyDemoPlacement(): Promise<void> {
  try {
    const current = await collectCurrentConstraintSession();
    if (!current.ok) {
      await eda.sys_Dialog.showInformationMessage(
        current.message,
        'LayoutPilot · 受控布局执行',
      );
      return;
    }

    const {
      snapshot,
      evaluation,
      boardFingerprint,
    } = current.value;

    const outstanding = getStoredLastPlacementCommand();
    if (
      outstanding?.status === 'applied'
      && outstanding.boardFingerprint === boardFingerprint
    ) {
      const component = await eda.pcb_PrimitiveComponent.get(outstanding.componentId);
      if (!component) {
        await eda.sys_Dialog.showInformationMessage(
          [
            `上一次 LayoutPilot Command ${outstanding.id} 仍标记为 applied，`,
            `但当前 PCB 已找不到 ${outstanding.componentDesignator}。`,
            '',
            '无法证明上一事务的最终状态，本次拒绝继续执行新的布局动作。',
          ].join('\n'),
          'LayoutPilot · 上一事务状态未知',
        );
        return;
      }

      const stillAtCommandTarget =
        closeEnough(component.getState_X(), outstanding.to.x)
        && closeEnough(component.getState_Y(), outstanding.to.y);

      if (stillAtCommandTarget) {
        await eda.sys_Dialog.showInformationMessage(
          [
            `仍有一条未关闭的受控布局 Command：${outstanding.id}`,
            `${outstanding.componentDesignator} 仍位于该 Command 的目标位置。`,
            '',
            'v0.7 只维护一个 outstanding command。',
            '请先“撤销上次受控布局”，再执行下一条建议。',
          ].join('\n'),
          'LayoutPilot · 请先关闭上一事务',
        );
        return;
      }

      await setStoredLastPlacementCommand(
        markPlacementCommandSuperseded(outstanding),
      );
      console.warn('[LayoutPilot] previous placement command superseded by later PCB edit', {
        commandId: outstanding.id,
        componentId: outstanding.componentId,
      });
    }

    const executable = evaluation.entries.flatMap(item => {
      if (!item.result || !item.humanOwnershipDecision) return [];
      return item.result.proposals
        .filter(proposal =>
          proposal.type === 'near'
          && proposal.execution === 'preview-eligible'
          && proposal.role === 'decoupling-capacitor'
        )
        .map(proposal => ({ item, proposal }));
    });

    if (!executable.length) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '当前没有满足 v0.7 执行门槛的布局建议。',
          '',
          '受控执行要求：',
          '• 去耦电容 near(owner) 约束；',
          '• medium/high 置信，属于 preview-eligible；',
          '• owner 已由用户显式确认；',
          '• 后续物理检查全部通过。',
        ].join('\n'),
        'LayoutPilot · 受控布局执行',
      );
      return;
    }

    let chosen = executable[0];
    if (executable.length > 1) {
      const selected = await showSingleSelectDialog(
        executable.map((candidate, index) => ({
          value: String(index),
          displayContent: `${candidate.proposal.subject} → ${candidate.proposal.target}`,
        })),
        '请选择本次只执行的一条布局建议。',
        'v0.7 每次只移动一个器件，避免批量变更扩大风险。',
        'LayoutPilot · 选择执行建议',
        '0',
      );
      if (selected === undefined) return;
      const index = Number(selected);
      if (!Number.isInteger(index) || !executable[index]) return;
      chosen = executable[index];
    }

    const { item, proposal } = chosen;
    const decision = item.humanOwnershipDecision;
    if (!decision || !proposal.target) {
      throw new Error('执行建议缺少人工 owner 证据。');
    }

    const physical = await collectPhysicalComponents(item.entry.componentId);
    const subject = physical.find(component => component.id === item.entry.componentId);
    const owner = physical.find(component => component.id === decision.ownerComponentId);
    if (!subject || !owner) {
      throw new Error('无法在 PCB 物理对象中定位 subject 或 owner。');
    }

    const powerNet = item.context.connectedNets.find(net =>
      net.classification === 'global-power'
      && net.coreDesignators.includes(owner.designator)
    )?.netName;
    const groundNet = item.context.connectedNets.find(net =>
      net.classification === 'global-ground'
      && net.coreDesignators.includes(owner.designator)
    )?.netName;

    if (!powerNet || !groundNet) {
      throw new Error('缺少 owner 共享的电源/地物理网络，拒绝执行。');
    }

    const boardBoundary = await collectSimpleBoardBoundary();
    if (!boardBoundary.ok) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '当前 PCB 板框不能被 v0.7 安全解析。',
          '',
          boardBoundary.reason,
          '',
          '系统采用失败关闭策略：不能证明候选位置位于有效板内时，不执行移动。',
        ].join('\n'),
        'LayoutPilot · 板框校验未通过',
      );
      return;
    }

    const componentKeepouts = await collectSimpleComponentKeepouts();
    if (!componentKeepouts.ok) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '当前 PCB 的器件 keepout 不能被 v0.7 安全解析。',
          '',
          componentKeepouts.reason,
          '',
          '不能证明候选位置避开 NO_COMPONENTS 区域时，不执行移动。',
        ].join('\n'),
        'LayoutPilot · Keepout 校验未通过',
      );
      return;
    }

    const readiness = planDecouplingPlacement({
      subject,
      owner,
      obstacles: physical,
      board: boardBoundary.polygon,
      componentKeepouts: componentKeepouts.polygons,
      powerNet,
      groundNet,
    });

    if (!readiness.ready || !readiness.plan) {
      await eda.sys_Dialog.showInformationMessage(
        [
          `${subject.designator} 当前不满足安全执行条件。`,
          '',
          ...readiness.reasons.map(reason => `• ${reason}`),
          '',
          '系统不会为了演示效果绕过这些检查。',
        ].join('\n'),
        'LayoutPilot · 物理执行被阻止',
      );
      return;
    }

    const plan = readiness.plan;
    const confirmed = await showConfirmationDialog(
      [
        `即将移动：${plan.subjectDesignator}`,
        `目标 owner：${plan.ownerDesignator}`,
        `电源锚点：${plan.ownerDesignator}.${plan.ownerPowerPadNumber} / ${plan.powerNet}`,
        `GND 参考：${plan.ownerDesignator}.${plan.ownerGroundPadNumber} / ${plan.groundNet}`,
        `回路几何代理：${plan.estimatedLoopProxyMil.toFixed(2)} mil（仅用于候选排序）`,
        `原坐标：(${plan.from.x.toFixed(2)}, ${plan.from.y.toFixed(2)}) mil`,
        `目标坐标：(${plan.to.x.toFixed(2)}, ${plan.to.y.toFixed(2)}) mil`,
        `近似避让：${plan.clearanceMil} mil`,
        '',
        '执行后 LayoutPilot 会重新读取坐标并运行 DRC；若 DRC 失败，将自动回滚。',
        '这仍是受控 Placement PoC，不等同于生产级自动布局器。',
      ].join('\n'),
      'LayoutPilot · 确认受控移动',
      '移动并校验',
    );
    if (!confirmed) return;

    const refreshedConstraintSession = await collectCurrentConstraintSession();
    if (
      !refreshedConstraintSession.ok
      || refreshedConstraintSession.value.snapshot.id !== snapshot.id
    ) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '确认期间 PCB 的语义输入发生了变化，当前 Semantic Snapshot 已不能作为执行依据。',
          '',
          refreshedConstraintSession.ok
            ? 'Snapshot 标识发生变化。'
            : refreshedConstraintSession.message,
          '',
          '请重新运行分析/确认/预览后再执行。',
        ].join('\n'),
        'LayoutPilot · 语义计划已过期',
      );
      return;
    }

    const refreshedConstraintEntry = refreshedConstraintSession.value.evaluation.entries
      .find(entry => entry.entry.componentId === item.entry.componentId);
    const refreshedProposal = refreshedConstraintEntry?.result?.proposals
      .find(candidate => candidate.id === proposal.id);
    const refreshedDecision = refreshedConstraintEntry?.humanOwnershipDecision;
    if (
      !refreshedProposal
      || refreshedProposal.execution !== 'preview-eligible'
      || refreshedDecision?.ownerComponentId !== decision.ownerComponentId
    ) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '确认期间约束证据或人工 Owner 决策发生了变化。',
          '',
          '旧的 Constraint Proposal 不再满足执行条件，本次移动已取消。',
        ].join('\n'),
        'LayoutPilot · 约束计划已过期',
      );
      return;
    }

    const refreshedPhysical = await collectPhysicalComponents(plan.subjectId);
    const refreshedSubject = refreshedPhysical.find(
      component => component.id === plan.subjectId,
    );
    const refreshedOwner = refreshedPhysical.find(
      component => component.id === plan.ownerId,
    );
    if (!refreshedSubject || !refreshedOwner) {
      await eda.sys_Dialog.showInformationMessage(
        '确认后无法重新定位 subject 或 owner，本次执行已取消。',
        'LayoutPilot · 物理计划已过期',
      );
      return;
    }

    const refreshedBoardBoundary = await collectSimpleBoardBoundary();
    if (!refreshedBoardBoundary.ok) {
      await eda.sys_Dialog.showInformationMessage(
        refreshedBoardBoundary.reason,
        'LayoutPilot · 确认后板框状态不可验证',
      );
      return;
    }

    const refreshedKeepouts = await collectSimpleComponentKeepouts();
    if (!refreshedKeepouts.ok) {
      await eda.sys_Dialog.showInformationMessage(
        refreshedKeepouts.reason,
        'LayoutPilot · 确认后 Keepout 状态不可验证',
      );
      return;
    }

    const refreshedReadiness = planDecouplingPlacement({
      subject: refreshedSubject,
      owner: refreshedOwner,
      obstacles: refreshedPhysical,
      board: refreshedBoardBoundary.polygon,
      componentKeepouts: refreshedKeepouts.polygons,
      powerNet,
      groundNet,
    });

    if (
      !refreshedReadiness.ready
      || !refreshedReadiness.plan
      || !placementPlansEquivalent(plan, refreshedReadiness.plan)
    ) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '确认窗口打开期间，PCB 的物理上下文发生了变化，或最佳合法候选已经改变。',
          '',
          'LayoutPilot 已重新读取器件 BBox、走线状态、板框和 keepout。',
          '为避免执行过期计划，本次移动已取消。',
          '',
          '请重新点击“应用受控布局建议”查看新的候选位置。',
        ].join('\n'),
        'LayoutPilot · 物理计划已过期',
      );
      return;
    }

    const baselineDrcPassed = await eda.pcb_Drc.check(true, false, false);
    if (!baselineDrcPassed) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '确认后重新检查发现当前 PCB 未通过 DRC。',
          '',
          '写入前必须存在干净 DRC 基线，本次不会移动器件。',
        ].join('\n'),
        'LayoutPilot · DRC 基线未通过',
      );
      return;
    }

    const executionPlan = refreshedReadiness.plan;

    const command = createPlacementCommand({
      snapshotId: snapshot.id,
      boardFingerprint,
      constraintId: proposal.id,
      componentId: executionPlan.subjectId,
      componentDesignator: executionPlan.subjectDesignator,
      from: executionPlan.from,
      to: executionPlan.to,
    });

    const transaction = await executePlacementTransaction(
      {
        componentId: executionPlan.subjectId,
        from: executionPlan.from,
        to: executionPlan.to,
      },
      {
        moveAndVerify: async (componentId, point) => {
          await moveComponentAndVerify(componentId, point.x, point.y);
        },
        checkDrc: () => eda.pcb_Drc.check(true, false, false),
      },
    );

    if (!transaction.ok) {
      await setStoredLastPlacementCommand(undefined);
      await eda.sys_Dialog.showInformationMessage(
        [
          '受控移动没有提交。',
          '',
          `原因：${transaction.error}`,
          `已尝试回滚：${transaction.rollbackAttempted ? '是' : '否'}`,
          `坐标回滚校验：${transaction.rollbackVerified ? 'PASS' : 'FAIL / 未执行'}`,
          transaction.rollbackDrcPassed === undefined
            ? '回滚 DRC：未执行'
            : `回滚 DRC：${transaction.rollbackDrcPassed ? 'PASS' : 'FAIL'}`,
          '',
          transaction.rollbackVerified
            ? 'PCB 已恢复到执行前坐标，本次不记录成功 Command。'
            : '无法证明 PCB 已恢复，请立即人工检查当前器件位置。',
        ].join('\n'),
        transaction.rollbackVerified
          ? 'LayoutPilot · 已自动回滚'
          : 'LayoutPilot · 回滚需要人工检查',
      );
      return;
    }

    const applied = markPlacementCommandApplied(command);
    await setStoredLastPlacementCommand(applied);

    await eda.sys_Dialog.showInformationMessage(
      [
        '受控布局动作已完成并通过校验。',
        '',
        `Command：${applied.id}`,
        `${plan.subjectDesignator} → near(${plan.ownerDesignator})`,
        `电源/GND 参考：${plan.ownerPowerPadNumber} / ${plan.ownerGroundPadNumber}`,
        `回路几何代理：${plan.estimatedLoopProxyMil.toFixed(2)} mil`,
        `坐标：(${plan.from.x.toFixed(2)}, ${plan.from.y.toFixed(2)}) → (${plan.to.x.toFixed(2)}, ${plan.to.y.toFixed(2)}) mil`,
        '坐标回读：PASS',
        '移动后 DRC：PASS',
        '',
        '可使用“撤销上次受控布局”恢复原坐标。',
      ].join('\n'),
      'LayoutPilot · 受控布局执行',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Controlled placement failed', error);
    await eda.sys_Dialog.showInformationMessage(
      `受控布局执行失败。\n\n${String(error)}\n\n请检查当前 PCB；系统不会继续执行后续动作。`,
      'LayoutPilot · 受控布局执行',
    );
  }
}

export async function undoLastDemoPlacement(): Promise<void> {
  try {
    const command = getStoredLastPlacementCommand();
    if (!command || command.status !== 'applied') {
      await eda.sys_Dialog.showInformationMessage(
        '当前没有可撤销的 LayoutPilot 受控布局动作。',
        'LayoutPilot · 撤销',
      );
      return;
    }

    const analysisState = await collectAnalysisState();
    const currentBoardFingerprint = buildSemanticBoardFingerprint({
      graph: analysisState.graph,
      contexts: analysisState.contexts,
    });
    if (command.boardFingerprint !== currentBoardFingerprint) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '上一次 LayoutPilot Command 属于另一份 PCB 语义状态。',
          '',
          `Command Fingerprint：${command.boardFingerprint}`,
          `当前 PCB Fingerprint：${currentBoardFingerprint}`,
          '',
          '为避免跨 PCB 恢复坐标，本次 Undo 被阻止。',
          '切回原 PCB 后仍可继续处理这条 Command；当前 PCB 不会发生修改。',
        ].join('\n'),
        'LayoutPilot · Undo PCB 不匹配',
      );
      return;
    }

    const component = await eda.pcb_PrimitiveComponent.get(command.componentId);
    if (!component) {
      throw new Error(`找不到器件 ${command.componentDesignator}`);
    }

    const current = {
      x: component.getState_X(),
      y: component.getState_Y(),
    };
    if (
      !closeEnough(current.x, command.to.x)
      || !closeEnough(current.y, command.to.y)
    ) {
      await setStoredLastPlacementCommand(
        markPlacementCommandSuperseded(command),
      );
      await eda.sys_Dialog.showInformationMessage(
        [
          `${command.componentDesignator} 在 LayoutPilot 执行后又被移动过。`,
          '',
          `记录位置：(${command.to.x.toFixed(2)}, ${command.to.y.toFixed(2)}) mil`,
          `当前位置：(${current.x.toFixed(2)}, ${current.y.toFixed(2)}) mil`,
          '',
          '为避免覆盖用户的新修改，本次拒绝自动 Undo。',
          '旧 Command 已标记为 superseded，不会继续阻塞后续受控布局。',
        ].join('\n'),
        'LayoutPilot · 撤销被阻止',
      );
      return;
    }

    const confirmed = await showConfirmationDialog(
      [
        `恢复 ${command.componentDesignator} 到执行前位置？`,
        `当前：(${command.to.x.toFixed(2)}, ${command.to.y.toFixed(2)}) mil`,
        `恢复：(${command.from.x.toFixed(2)}, ${command.from.y.toFixed(2)}) mil`,
        '',
        '确认后会重新检查走线、BBox、板框、keepout 与 DRC，再决定是否执行。',
      ].join('\n'),
      'LayoutPilot · 撤销上次受控布局',
      '恢复原位置',
    );
    if (!confirmed) return;

    const physical = await collectPhysicalComponents(command.componentId);
    const subject = physical.find(item => item.id === command.componentId);
    if (!subject) {
      throw new Error(`无法重新读取器件 ${command.componentDesignator}`);
    }

    if (
      !closeEnough(subject.x, command.to.x)
      || !closeEnough(subject.y, command.to.y)
    ) {
      await setStoredLastPlacementCommand(markPlacementCommandSuperseded(command));
      await eda.sys_Dialog.showInformationMessage(
        '确认期间器件位置发生变化，旧 Command 已标记 superseded，本次不再自动 Undo。',
        'LayoutPilot · 撤销被阻止',
      );
      return;
    }

    if (subject.locked) {
      await eda.sys_Dialog.showInformationMessage(
        `${command.componentDesignator} 当前已锁定。请先确认锁定意图；LayoutPilot 不会自动解锁后移动。`,
        'LayoutPilot · 撤销被阻止',
      );
      return;
    }

    const routingUnknown = subject.pads.some(
      pad => pad.connectedPrimitiveCount === undefined,
    );
    const routed = subject.pads.some(
      pad => (pad.connectedPrimitiveCount ?? 0) > 0,
    );
    if (routingUnknown || routed) {
      if (routed) {
        await setStoredLastPlacementCommand(markPlacementCommandSuperseded(command));
      }
      await eda.sys_Dialog.showInformationMessage(
        [
          routingUnknown
            ? '无法确认当前器件是否已有铜连接。'
            : `${command.componentDesignator} 在 LayoutPilot 移动后已经产生走线/铜连接。`,
          '',
          '移动已布线器件可能拉伸或破坏现有连接，因此本次 Undo 被阻止。',
          routed
            ? '该 Command 已标记 superseded，不再作为可自动撤销事务。'
            : '当前状态保持不变，请人工检查。',
        ].join('\n'),
        'LayoutPilot · 撤销被阻止',
      );
      return;
    }

    const boardBoundary = await collectSimpleBoardBoundary();
    if (!boardBoundary.ok) {
      await eda.sys_Dialog.showInformationMessage(
        boardBoundary.reason,
        'LayoutPilot · Undo 板框状态不可验证',
      );
      return;
    }

    const componentKeepouts = await collectSimpleComponentKeepouts();
    if (!componentKeepouts.ok) {
      await eda.sys_Dialog.showInformationMessage(
        componentKeepouts.reason,
        'LayoutPilot · Undo Keepout 状态不可验证',
      );
      return;
    }

    const targetValidation = validatePlacementTarget({
      subject,
      obstacles: physical,
      board: boardBoundary.polygon,
      componentKeepouts: componentKeepouts.polygons,
      target: command.from,
    });
    if (!targetValidation.valid) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '执行前的原位置在当前 PCB 上已经不能被证明安全。',
          '',
          ...targetValidation.reasons.map(reason => `• ${reason}`),
          '',
          'LayoutPilot 不会机械地把历史坐标覆盖到新的板状态上。',
        ].join('\n'),
        'LayoutPilot · Undo 目标位置不再安全',
      );
      return;
    }

    const baselineDrcPassed = await eda.pcb_Drc.check(true, false, false);
    if (!baselineDrcPassed) {
      await eda.sys_Dialog.showInformationMessage(
        [
          '当前 PCB 在 Undo 前没有通过 DRC。',
          '',
          '无法建立干净基线，本次不执行自动恢复。',
        ].join('\n'),
        'LayoutPilot · Undo DRC 基线未通过',
      );
      return;
    }

    const transaction = await executePlacementTransaction(
      {
        componentId: command.componentId,
        from: command.to,
        to: command.from,
      },
      {
        moveAndVerify: async (componentId, point) => {
          await moveComponentAndVerify(componentId, point.x, point.y);
        },
        checkDrc: () => eda.pcb_Drc.check(true, false, false),
      },
    );

    if (!transaction.ok) {
      await eda.sys_Dialog.showInformationMessage(
        [
          'Undo 没有提交。',
          '',
          `原因：${transaction.error}`,
          `已回到 LayoutPilot 目标位：${transaction.rollbackVerified ? 'PASS' : '无法确认'}`,
          transaction.rollbackDrcPassed === undefined
            ? '回滚 DRC：未执行'
            : `回滚 DRC：${transaction.rollbackDrcPassed ? 'PASS' : 'FAIL'}`,
          '',
          transaction.rollbackVerified
            ? '原 Command 仍保持 applied，可在问题消除后再次尝试 Undo。'
            : '最终状态无法证明，请立即人工检查。',
        ].join('\n'),
        transaction.rollbackVerified
          ? 'LayoutPilot · Undo 已回滚'
          : 'LayoutPilot · Undo 需要人工检查',
      );
      return;
    }

    const undone = markPlacementCommandUndone(command);
    await setStoredLastPlacementCommand(undone);

    await eda.sys_Dialog.showInformationMessage(
      [
        '已安全恢复执行前坐标。',
        '',
        `Command：${command.id}`,
        '坐标回读：PASS',
        '恢复后 DRC：PASS',
      ].join('\n'),
      'LayoutPilot · 撤销完成',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Undo placement failed', error);
    await eda.sys_Dialog.showInformationMessage(
      `撤销失败。\n\n${String(error)}`,
      'LayoutPilot · 撤销',
    );
  }
}

export async function about(): Promise<void> {
  await eda.sys_Dialog.showInformationMessage(
    [
      `LayoutPilot v${extensionConfig.version}`,
      '',
      '定位：面向 PCB 布局阶段的人机协同助手，不是黑盒一键自动布局。',
      '',
      '当前闭环：',
      '真实 PCB → 确定性结构/归属 → AI 语义 Snapshot → 人工补充关键证据 → Constraint Policy → Pad-aware Physical Planner → 用户确认 → 单器件受控移动 → 坐标回读 / DRC → 回滚或 Undo。',
      '',
      'v0.8 工作台 / 执行边界：',
      '• 主流程集中在持久化 Workbench，不再用连续弹窗展示分析结果；',
      '• 仅执行满足严格证据门槛的去耦电容 near(owner) 建议；',
      '• owner 必须由用户显式确认；',
      '• 已锁定、已有布线、物理几何不完整或基线 DRC 未通过时拒绝执行；',
      '• 每次只移动一个器件；',
      '• 执行失败会尝试恢复 before-state；',
      '• Undo 不会覆盖工程师后续的手工移动。',
      '',
      '这是一条可审计、可验证、可回退的 Placement PoC；尚不等同于生产级全局布局优化器。',
    ].join('\n'),
    '关于 LayoutPilot',
  );
}
