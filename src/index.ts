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
      `LayoutPilot successfully read ${components.length} PCB components.\n\nFirst components: ${references || 'No components found.'}\n\nOpen the developer console for structured details.`,
      'LayoutPilot · Inspect PCB',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Inspect PCB failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `Failed to inspect the current PCB.\n\n${String(error)}`,
      'LayoutPilot · API PoC',
    );
  }
}

export async function inspectTestComponent(): Promise<void> {
  try {
    const target = await getTestComponent();

    if (!target) {
      await eda.sys_Dialog.showInformationMessage(
        'U1 was not found on the current PCB. This Phase 0 command expects the LayoutPilot test board.',
        'LayoutPilot · Inspect U1',
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
        'LayoutPilot successfully inspected U1.',
        '',
        `Position: X=${details.x}, Y=${details.y}`,
        `Rotation: ${details.rotation}°`,
        `Locked: ${details.locked ? 'Yes' : 'No'}`,
        `Pads: ${details.padCount}`,
        `Named nets: ${nets.length}`,
        '',
        'Open the developer console for full properties and pad details.',
      ].join('\n'),
      'LayoutPilot · Inspect U1',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Inspect U1 failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `Failed to inspect U1.\n\n${String(error)}`,
      'LayoutPilot · API PoC',
    );
  }
}

export async function moveTestComponent(): Promise<void> {
  try {
    const target = await getTestComponent();

    if (!target) {
      await eda.sys_Dialog.showInformationMessage(
        'U1 was not found on the current PCB.',
        'LayoutPilot · Move U1',
      );
      return;
    }

    if (target.getState_PrimitiveLock()) {
      await eda.sys_Dialog.showInformationMessage(
        'U1 is currently locked. Unlock it before running the move test.',
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
      throw new Error('U1 could not be read back after the move operation.');
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
        passed ? 'PASS: U1 move + read-back verified.' : 'WARNING: U1 moved, but read-back did not match the requested coordinate.',
        '',
        `Before: X=${beforeX}, Y=${beforeY}`,
        `Requested: X=${requestedX}, Y=${beforeY}`,
        `Read-back: X=${afterX}, Y=${afterY}`,
      ].join('\n'),
      'LayoutPilot · Move U1',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Move U1 failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `Failed to move U1.\n\n${String(error)}`,
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
        'LayoutPilot · Toggle U1 Lock',
      );
      return;
    }

    const primitiveId = target.getState_PrimitiveId();
    const before = target.getState_PrimitiveLock();
    const requested = !before;

    await eda.pcb_PrimitiveComponent.modify(primitiveId, { primitiveLock: requested });

    const readBack = await eda.pcb_PrimitiveComponent.get(primitiveId);
    if (!readBack) {
      throw new Error('U1 could not be read back after the lock operation.');
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
        passed ? 'PASS: U1 lock state + read-back verified.' : 'WARNING: U1 lock read-back did not match the requested state.',
        '',
        `Before: ${before ? 'Locked' : 'Unlocked'}`,
        `Requested: ${requested ? 'Locked' : 'Unlocked'}`,
        `Read-back: ${after ? 'Locked' : 'Unlocked'}`,
      ].join('\n'),
      'LayoutPilot · Toggle U1 Lock',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Toggle U1 lock failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `Failed to toggle U1 lock.\n\n${String(error)}`,
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
        'LayoutPilot connectivity inspection complete.',
        '',
        `Components: ${components.length}`,
        `Pads: ${totalPads}`,
        `Pads with named nets: ${namedPads}`,
        `Named networks: ${networks.length}`,
        '',
        preview || 'No named networks found.',
        '',
        'Open the developer console for the complete connectivity map.',
      ].join('\n'),
      'LayoutPilot · Inspect Connectivity',
    );
  }
  catch (error) {
    console.error('[LayoutPilot] Inspect Connectivity failed', error);

    await eda.sys_Dialog.showInformationMessage(
      `Failed to inspect connectivity.\n\n${String(error)}`,
      'LayoutPilot · API PoC',
    );
  }
}

export async function about(): Promise<void> {
  await eda.sys_Dialog.showInformationMessage(
    `LayoutPilot v${extensionConfig.version}\n\nPhase 0: JLCEDA Extension API feasibility PoC.\nWrite tests only run when explicitly selected from the LayoutPilot menu and target U1 only.`,
    'About LayoutPilot',
  );
}
