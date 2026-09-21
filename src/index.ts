import extensionConfig from '../extension.json' with { type: 'json' };

export function activate(status?: 'onStartupFinished', arg?: string): void {
  console.log('[LayoutPilot] activated', { status, arg });
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
    const components = await eda.pcb_PrimitiveComponent.getAll();
    const target = components.find(
      (component) => component.getState_Designator()?.toUpperCase() === 'U1',
    );

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

export async function about(): Promise<void> {
  await eda.sys_Dialog.showInformationMessage(
    `LayoutPilot v${extensionConfig.version}\n\nPhase 0: JLCEDA Extension API feasibility PoC.\nCurrent build is read-only and does not modify the PCB.`,
    'About LayoutPilot',
  );
}
