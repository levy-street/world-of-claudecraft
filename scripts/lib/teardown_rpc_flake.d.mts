export const TEARDOWN_RPC_TAIL_BYTES: number;

export const TEARDOWN_RPC_MESSAGE: string;

export function isTeardownRpcFlake(result: { status: number | null; tail: string }): boolean;
