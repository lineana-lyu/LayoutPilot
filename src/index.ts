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

export async function about(): Promise<void> {
  await eda.sys_Dialog.showInformationMessage(
    `LayoutPilot v${extensionConfig.version}\n\nPhase 0: JLCEDA Extension API feasibility PoC.\nCurrent build is read-only and does not modify the PCB.`,
    'About LayoutPilot',
  );
}
