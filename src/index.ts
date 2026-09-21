import { buildCircuitGraph, type CircuitComponentSnapshot } from './domain/circuitGraph';
import { extractStructuralFeatures, type ComponentMetadata } from './domain/componentFeatures';
import { coreLevelZh, groupEvidenceZh, layoutConstraintTypeZh, lockedZh, netGroupingClassZh, semanticConfidenceZh, semanticMissingEvidenceZh, semanticRoleZh, structuralEvidenceZh } from './i18n/zhCN';
import { buildCandidateGroups } from './domain/candidateGrouping';
import { buildSemanticContexts, type SemanticComponentContext, type SemanticComponentMetadata } from './domain/semanticContext';
import { buildSemanticEvidenceCatalog, validateSemanticInference } from './domain/semanticInference';
import { buildSemanticGatewayRequest, normalizeGatewayBaseUrl, parseSemanticGatewayResponse } from './ai/gatewayClient';
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

export async function inspectTestComponent(): Promise<void> {
  try {
    const target = await getTestComponent();

    if (!target) {
      await eda.sys_Dialog.showInformationMessage(
        '当前 PCB 中没有找到 U1。该测试命令需要使用 LayoutPilot 测试板。',
        'LayoutPilot · 检查 U1',
      );
      return;
    }

    const primitiveId = target.getState_PrimitiveId();
    const pads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
    const propertyNames = await eda.pcb_PrimitiveComponent.getAllPropertyNames();

    const padSummary = (pads ?? []).slice(0, 16).map((pad) => ({
      padNumber: pad.getState_PadNumber(),
      net: pad.getState_Net(),
    }));

    const details = {
      primitiveId,
      designator: target.getState_Designator(),
      name: target.getState_Name(),
      x: target.getState_X(),
      y: target.getState_Y(),
      rotation: target.getState_Rotation(),
      locked: target.getState_PrimitiveLock(),
      layer: target.getState_Layer(),
      manufacturer: target.getState_Manufacturer(),
      manufacturerId: target.getState_ManufacturerId(),
      supplier: target.getState_Supplier(),
      supplierId: target.getState_SupplierId(),
      footprint: target.getState_Footprint(),
      component: target.getState_Component(),
      otherProperty: target.getState_OtherProperty(),
      padCount: pads?.length ?? 0,
      propertyNameCount: propertyNames.length,
    };

    console.log('[LayoutPilot] U1 details', details);
    console.table(padSummary);
    console.log('[LayoutPilot] available component property names', propertyNames);

    const nets = Array.from(
      new Set(
        (pads ?? [])
          .map((pad) => pad.getState_Net())
          .filter((net): net is string => Boolean(net)),
      ),
    );

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot 已成功读取 U1。',
        '',
        `位置：X=${details.x}, Y=${details.y}`,
        `旋转角度：${details.rotation}°`,
        `锁定状态：${lockedZh(details.locked)}`,
        `焊盘数量：${details.padCount}`,
        `已命名网络：${nets.length}`,
        '',
        '如需查看完整属性和焊盘详情，请打开开发者控制台。',
      ].join('\n'),
      'LayoutPilot · 检查 U1',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Inspect U1 failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `读取 U1 失败。\n\n${String(error)}`,
      'LayoutPilot · API 可行性验证',
    );
  }
}

export async function moveTestComponent(): Promise<void> {
  try {
    const target = await getTestComponent();

    if (!target) {
      await eda.sys_Dialog.showInformationMessage(
        '当前 PCB 中没有找到 U1。',
        'LayoutPilot · 移动 U1',
      );
      return;
    }

    if (target.getState_PrimitiveLock()) {
      await eda.sys_Dialog.showInformationMessage(
        'U1 当前已锁定。请先解锁，再执行移动测试。',
        'LayoutPilot · 移动 U1',
      );
      return;
    }

    const primitiveId = target.getState_PrimitiveId();
    const beforeX = target.getState_X();
    const beforeY = target.getState_Y();
    const requestedX = beforeX + 100;

    await eda.pcb_PrimitiveComponent.modify(primitiveId, { x: requestedX });

    const readBack = await eda.pcb_PrimitiveComponent.get(primitiveId);
    if (!readBack) {
      throw new Error('移动后无法重新读取 U1 状态。');
    }

    const afterX = readBack.getState_X();
    const afterY = readBack.getState_Y();
    const passed = afterX === requestedX && afterY === beforeY;

    console.log('[LayoutPilot] U1 move test', {
      before: { x: beforeX, y: beforeY },
      requested: { x: requestedX, y: beforeY },
      after: { x: afterX, y: afterY },
      passed,
    });

    await eda.sys_Dialog.showInformationMessage(
      [
        passed ? '通过：U1 移动并回读验证成功。' : '警告：U1 已移动，但回读坐标与目标坐标不一致。',
        '',
        `移动前：X=${beforeX}, Y=${beforeY}`,
        `目标位置：X=${requestedX}, Y=${beforeY}`,
        `回读位置：X=${afterX}, Y=${afterY}`,
      ].join('\n'),
      'LayoutPilot · 移动 U1',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Move U1 failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `移动 U1 失败。\n\n${String(error)}`,
      'LayoutPilot · API 可行性验证',
    );
  }
}

export async function toggleTestComponentLock(): Promise<void> {
  try {
    const target = await getTestComponent();

    if (!target) {
      await eda.sys_Dialog.showInformationMessage(
        '当前 PCB 中没有找到 U1。',
        'LayoutPilot · 切换 U1 锁定状态',
      );
      return;
    }

    const primitiveId = target.getState_PrimitiveId();
    const before = target.getState_PrimitiveLock();
    const requested = !before;

    await eda.pcb_PrimitiveComponent.modify(primitiveId, { primitiveLock: requested });

    const readBack = await eda.pcb_PrimitiveComponent.get(primitiveId);
    if (!readBack) {
      throw new Error('修改锁定状态后无法重新读取 U1。');
    }

    const after = readBack.getState_PrimitiveLock();
    const passed = after === requested;

    console.log('[LayoutPilot] U1 lock test', {
      before,
      requested,
      after,
      passed,
    });

    await eda.sys_Dialog.showInformationMessage(
      [
        passed ? '通过：U1 锁定状态修改并回读验证成功。' : '警告：U1 锁定状态回读结果与目标状态不一致。',
        '',
        `修改前：${lockedZh(before)}`,
        `目标状态：${lockedZh(requested)}`,
        `回读状态：${lockedZh(after)}`,
      ].join('\n'),
      'LayoutPilot · 切换 U1 锁定状态',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Toggle U1 lock failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `切换 U1 锁定状态失败。\n\n${String(error)}`,
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
  return buildSemanticContexts(graph, features, grouping, semanticMetadata);
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

async function requestSemanticInference(
  context: SemanticComponentContext,
  gatewayBaseUrl: string,
) {
  const evidenceCatalog = buildSemanticEvidenceCatalog(context);
  const request = buildSemanticGatewayRequest(context, evidenceCatalog);

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

export async function analyzeC6WithAi(): Promise<void> {
  try {
    const gatewayBaseUrl = await getConfiguredGatewayBaseUrl();
    if (!gatewayBaseUrl) {
      return;
    }

    const contexts = await collectSemanticContexts();
    const context = contexts.find(
      item => item.designator.toUpperCase() === 'C6',
    );

    if (!context) {
      await eda.sys_Dialog.showInformationMessage(
        '当前 PCB 的歧义器件中没有找到 C6。该命令用于保留第一条真实 AI 闭环回归测试。',
        'LayoutPilot · AI 语义分析',
      );
      return;
    }

    const {
      evidenceCatalog,
      gatewayResponse,
      validation,
    } = await requestSemanticInference(context, gatewayBaseUrl);

    if (!validation.valid) {
      await eda.sys_Dialog.showInformationMessage(
        [
          'AI 返回结果已被 LayoutPilot 拦截。',
          '',
          ...validation.errors.map(error => `• ${error}`),
          '',
          'PCB 未发生任何修改。',
        ].join('\n'),
        'LayoutPilot · AI 结果校验失败',
      );
      return;
    }

    const inference = gatewayResponse.inference;
    const evidenceById = new Map(
      evidenceCatalog.map(item => [item.id, item.label]),
    );

    const evidenceText = inference.evidenceRefs.length
      ? inference.evidenceRefs
          .map(ref => `• ${evidenceById.get(ref) ?? ref}`)
          .join('\n')
      : '• 无';

    const constraintText = inference.constraints.length
      ? inference.constraints.map((constraint) => {
          const target = constraint.target ? ` → ${constraint.target}` : '';
          return `• ${layoutConstraintTypeZh(constraint.type)}${target}`;
        }).join('\n')
      : '• 无';

    const provider = gatewayResponse.provider ?? 'unknown';
    const model = gatewayResponse.model ?? 'unknown';

    if (provider === 'mock') {
      await eda.sys_Dialog.showInformationMessage(
        [
          'AI Gateway 通路测试通过。',
          '',
          '当前 provider=mock，这不是 AI 判断结果，只用于验证：',
          '扩展 → Gateway → 结构化返回 → Validator。',
          '',
          `测试角色：${semanticRoleZh(inference.role)}`,
          `测试置信状态：${semanticConfidenceZh(inference.confidence)}`,
          '',
          'PCB 未发生任何修改。',
        ].join('\n'),
        'LayoutPilot · Gateway 通路测试',
      );
      return;
    }

    await eda.sys_Dialog.showInformationMessage(
      [
        'LayoutPilot AI 语义分析完成，并通过证据校验。',
        '',
        `目标器件：${context.designator}`,
        `语义角色：${semanticRoleZh(inference.role)}`,
        `关联核心：${inference.associatedCore ?? '未确定'}`,
        `置信状态：${semanticConfidenceZh(inference.confidence)}`,
        `模型：${provider} / ${model}`,
        '',
        '证据：',
        evidenceText,
        '',
        `解释：${inference.explanation}`,
        '',
        '建议布局约束：',
        constraintText,
        '',
        '说明：当前仅生成建议，不会修改 PCB。',
      ].join('\n'),
      'LayoutPilot · AI 语义分析 C6',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] AI semantic analysis failed', error);

    await eda.sys_Dialog.showInformationMessage(
      [
        'AI 语义分析失败。',
        '',
        String(error),
        '',
        '请确认：',
        '1. 本机 AI Gateway 已启动；',
        '2. 已在扩展设置中配置正确地址；',
        '3. 已允许该扩展进行外部交互；',
        '4. Gateway 的模型配置/API Key 有效。',
        '',
        'PCB 未发生任何修改。',
      ].join('\n'),
      'LayoutPilot · AI 语义分析',
    );
  }
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
        const constraints = inference.constraints
          .filter(item => item.type !== 'no-constraint')
          .map(item => {
            const target = item.target ? `→${item.target}` : '';
            return `${layoutConstraintTypeZh(item.type)}${target}`;
          });

        rows.push(
          [
            `${context.designator}：${semanticRoleZh(inference.role)}`,
            `置信=${semanticConfidenceZh(inference.confidence)}${core}`,
            constraints.length ? `约束=${constraints.join('、')}` : '约束=暂不生成',
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
        '说明：当前只生成语义角色与布局约束建议，不会修改 PCB。',
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

export async function about(): Promise<void> {
  await eda.sys_Dialog.showInformationMessage(
    `LayoutPilot v${extensionConfig.version}\n\n第 2 阶段：为规则层无法确定的器件构建语义上下文，并逐步引入 AI 语义补全。\n当前不会自动修改 PCB。`,
    '关于 LayoutPilot',
  );
}
