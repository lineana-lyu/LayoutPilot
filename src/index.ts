import { buildCircuitGraph, type CircuitComponentSnapshot } from './domain/circuitGraph';
import { extractStructuralFeatures, type ComponentMetadata } from './domain/componentFeatures';
import { coreLevelZh, lockedZh, structuralEvidenceZh } from './i18n/zhCN';
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
      'LayoutPilot · Inspect U1',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Inspect U1 failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `读取 U1 失败。\n\n${String(error)}`,
      'LayoutPilot · API PoC',
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
        'LayoutPilot · Move U1',
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
      'LayoutPilot · Move U1',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Move U1 failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `移动 U1 失败。\n\n${String(error)}`,
      'LayoutPilot · API PoC',
    );
  }
}

export async function toggleTestComponentLock(): Promise<void> {
  try {
    const target = await getTestComponent();

    if (!target) {
      await eda.sys_Dialog.showInformationMessage(
        'U1 was not found on the current PCB.',
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
      'LayoutPilot · Toggle U1 Lock',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Toggle U1 lock failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `切换 U1 锁定状态失败。\n\n${String(error)}`,
      'LayoutPilot · API PoC',
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
      'LayoutPilot · API PoC',
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
        netPreview || 'No named networks found.',
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
      boundary: feature.isBoundaryCandidate,
      coreScore: feature.coreScore,
      coreLevel: feature.coreLevel,
    })));

    const preview = features.slice(0, 8).map((feature) => {
      const evidence = feature.coreEvidence.length
        ? feature.coreEvidence.map(structuralEvidenceZh).join('；')
        : '暂无核心器件正向证据';
      return `${feature.designator}：核心候选=${coreLevelZh(feature.coreLevel)}（${feature.coreScore}/10），相邻器件=${feature.degree}，焊盘=${feature.padCount}\n  判断依据：${evidence}`;
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
      'LayoutPilot · Phase 1',
    );
  }
}

export async function about(): Promise<void> {
  await eda.sys_Dialog.showInformationMessage(
    `LayoutPilot v${extensionConfig.version}\n\n第 1 阶段：构建确定性的电路关系图与功能块候选。\n所有写入测试都必须由用户从 LayoutPilot 菜单主动触发，并且当前只作用于 U1。`,
    '关于 LayoutPilot',
  );
}
