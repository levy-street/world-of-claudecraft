// Pure wallet presentation state shared by the character screen, Store, and bag.
// Connection is temporary browser state. Linking is the durable server-verified
// account association, so the view must never treat those as interchangeable.

export type WalletConnectionKind =
  | 'disabled'
  | 'unlinked'
  | 'connected_unlinked'
  | 'linked_disconnected'
  | 'linked_connected'
  | 'mismatched';

export interface WalletConnectionView {
  kind: WalletConnectionKind;
  enabled: boolean;
  linkedAddress: string | null;
  connectedAddress: string | null;
  balance: number | null;
  balanceVerified: boolean;
  action: 'connect' | 'reconnect' | 'verify' | 'manage' | 'none';
}

export function buildWalletConnectionView(input: {
  enabled: boolean;
  linkedAddress: string | null;
  connectedAddress: string | null;
  linkedBalance: number | null;
  connectedBalance: number | null;
  externalSignerAvailable?: boolean;
}): WalletConnectionView {
  const {
    enabled,
    linkedAddress,
    connectedAddress,
    linkedBalance,
    connectedBalance,
    externalSignerAvailable = false,
  } = input;
  if (!enabled) {
    return {
      kind: 'disabled',
      enabled: false,
      linkedAddress,
      connectedAddress,
      balance: null,
      balanceVerified: false,
      action: 'none',
    };
  }
  if (linkedAddress) {
    if (!connectedAddress) {
      if (externalSignerAvailable) {
        return {
          kind: 'linked_connected',
          enabled: true,
          linkedAddress,
          connectedAddress: linkedAddress,
          balance: linkedBalance,
          balanceVerified: linkedBalance !== null,
          action: 'manage',
        };
      }
      return {
        kind: 'linked_disconnected',
        enabled: true,
        linkedAddress,
        connectedAddress: null,
        balance: linkedBalance,
        balanceVerified: linkedBalance !== null,
        action: 'reconnect',
      };
    }
    if (connectedAddress === linkedAddress) {
      const balance = linkedBalance ?? connectedBalance;
      return {
        kind: 'linked_connected',
        enabled: true,
        linkedAddress,
        connectedAddress,
        balance,
        balanceVerified: balance !== null,
        action: 'manage',
      };
    }
    return {
      kind: 'mismatched',
      enabled: true,
      linkedAddress,
      connectedAddress,
      balance: linkedBalance,
      balanceVerified: linkedBalance !== null,
      action: 'verify',
    };
  }
  if (connectedAddress) {
    return {
      kind: 'connected_unlinked',
      enabled: true,
      linkedAddress: null,
      connectedAddress,
      balance: connectedBalance,
      balanceVerified: false,
      action: 'verify',
    };
  }
  return {
    kind: 'unlinked',
    enabled: true,
    linkedAddress: null,
    connectedAddress: null,
    balance: null,
    balanceVerified: false,
    action: 'connect',
  };
}
