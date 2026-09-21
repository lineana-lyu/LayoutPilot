import type { PlacementPoint } from '../domain/physicalPlacement';

export interface PlacementTransactionAdapter {
	moveAndVerify(
		componentId: string,
		point: PlacementPoint,
	): Promise<void>;
	checkDrc(): Promise<boolean>;
}

export interface PlacementTransactionInput {
	componentId: string;
	from: PlacementPoint;
	to: PlacementPoint;
}

export type PlacementTransactionResult =
	| { ok: true }
	| {
		ok: false;
		error: string;
		rollbackAttempted: boolean;
		rollbackVerified: boolean;
		rollbackDrcPassed?: boolean;
	};

export async function executePlacementTransaction(
	input: PlacementTransactionInput,
	adapter: PlacementTransactionAdapter,
): Promise<PlacementTransactionResult> {
	let mutationAttempted = false;

	try {
		mutationAttempted = true;
		await adapter.moveAndVerify(input.componentId, input.to);

		const postDrcPassed = await adapter.checkDrc();
		if (!postDrcPassed) {
			throw new Error('移动后 DRC 未通过');
		}

		return { ok: true };
	}
	catch (error) {
		if (!mutationAttempted) {
			return {
				ok: false,
				error: String(error),
				rollbackAttempted: false,
				rollbackVerified: false,
			};
		}

		try {
			await adapter.moveAndVerify(input.componentId, input.from);
			const rollbackDrcPassed = await adapter.checkDrc();
			return {
				ok: false,
				error: String(error),
				rollbackAttempted: true,
				rollbackVerified: true,
				rollbackDrcPassed,
			};
		}
		catch (rollbackError) {
			return {
				ok: false,
				error: `${String(error)}；回滚失败：${String(rollbackError)}`,
				rollbackAttempted: true,
				rollbackVerified: false,
			};
		}
	}
}
