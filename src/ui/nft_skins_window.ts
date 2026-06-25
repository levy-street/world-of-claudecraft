// NFT-PFP skins picker (docs/prd/woc/nft-pfp-skins.md). A self-contained modal the
// HUD composes (it does not live in hud.ts): connect an Ethereum/Solana wallet,
// pick a supported collection, enter the token id, and claim it. Ownership is
// verified + traits inferred server-side; on success the skin appears in the
// registry and can be equipped from the normal skins UI.
//
// Boundary-clean: it imports only the ui surface (t/esc) and takes the network
// actions as injected deps, so it never reaches into src/net itself (main.ts wires
// the Api + wallet-link closures).
import { t } from './i18n';
import { esc } from './esc';

export interface NftEligible {
  wallets: { ethereum: string | null; solana: string | null };
  collections: Array<{ chain: string; contract: string; name: string; standard: string }>;
}

export interface NftSkinsWindowDeps {
  eligible(): Promise<NftEligible>;
  claim(chain: string, contract: string, tokenId: string): Promise<{ id: string }>;
  /** Connect + sign + link an Ethereum wallet; resolves the linked address or null. */
  linkEthereum(): Promise<string | null>;
  /** Connect + sign + link a Solana wallet; resolves the linked address or null. */
  linkSolana(): Promise<string | null>;
  /** Called after a successful claim so the host can refresh the skin registry. */
  onClaimed(skinId: string): void;
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function claimErrorMessage(reason: string): string {
  switch (reason) {
    case 'not_owner': return t('hudChrome.nftSkins.errorNotOwner');
    case 'ownership_unverified': return t('hudChrome.nftSkins.errorUnverified');
    case 'collection_not_supported': return t('hudChrome.nftSkins.errorCollection');
    case 'too_many_nft_skins': return t('hudChrome.nftSkins.errorTooMany');
    case 'metadata_unavailable': return t('hudChrome.nftSkins.errorMetadata');
    case 'link_evm_wallet_first':
    case 'link_solana_wallet_first': return t('hudChrome.nftSkins.needWallet');
    default: return t('hudChrome.nftSkins.errorGeneric');
  }
}

/** Open the NFT-skins picker modal. Resolves when the modal is closed. */
export async function openNftSkinsWindow(deps: NftSkinsWindowDeps): Promise<void> {
  let eligible: NftEligible;
  try {
    eligible = await deps.eligible();
  } catch {
    eligible = { wallets: { ethereum: null, solana: null }, collections: [] };
  }

  const overlay = document.createElement('div');
  overlay.className = 'nft-skins-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('hudChrome.nftSkins.title'));
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';

  const panel = document.createElement('div');
  panel.className = 'nft-skins-panel';
  panel.style.cssText = 'width:100%;max-width:520px;max-height:86vh;overflow:auto;background:#171019;border:1px solid #5a4326;border-radius:10px;padding:20px;color:#e8dcc0;box-shadow:0 10px 40px rgba(0,0,0,0.6);';
  overlay.appendChild(panel);

  const wallets = eligible.wallets;

  function statusLine(): string {
    const eth = wallets.ethereum
      ? esc(t('hudChrome.nftSkins.ethereumLinked').replace('{address}', shortAddr(wallets.ethereum)))
      : `${t('hudChrome.nftSkins.ethereumLinked').replace('{address}', t('hudChrome.nftSkins.notLinked'))}`;
    const sol = wallets.solana
      ? esc(t('hudChrome.nftSkins.solanaLinked').replace('{address}', shortAddr(wallets.solana)))
      : `${t('hudChrome.nftSkins.solanaLinked').replace('{address}', t('hudChrome.nftSkins.notLinked'))}`;
    return `<div class="nft-wallet-status" style="font-size:13px;opacity:0.85;margin:8px 0;line-height:1.6">${eth}<br>${sol}</div>`;
  }

  function render(): void {
    const hasEth = !!wallets.ethereum;
    const hasSol = !!wallets.solana;
    const rows = eligible.collections.map((c) => {
      const linked = c.chain === 'ethereum' ? hasEth : hasSol;
      const placeholder = c.chain === 'ethereum'
        ? t('hudChrome.nftSkins.tokenIdPlaceholder')
        : t('hudChrome.nftSkins.mintPlaceholder');
      return `<div class="nft-collection-row" data-chain="${esc(c.chain)}" data-contract="${esc(c.contract)}"
          style="display:flex;gap:8px;align-items:center;padding:10px 0;border-top:1px solid #34281c">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${esc(c.name || c.contract)}</div>
          <div style="font-size:12px;opacity:0.7;text-transform:capitalize">${esc(c.chain)}</div>
        </div>
        <input class="nft-token-input" type="text" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"
          style="flex:1;min-width:0;font-size:16px;padding:8px;background:#0e0a10;border:1px solid #4a3a26;border-radius:6px;color:#e8dcc0"${linked ? '' : ' disabled'}>
        <button class="nft-claim-btn" type="button"${linked ? '' : ' disabled'}
          style="min-height:40px;min-width:72px;padding:0 14px;border-radius:6px;border:1px solid #6b5226;background:${linked ? '#caa84b' : '#3a3026'};color:${linked ? '#1a120a' : '#7a6f5a'};font-weight:600;cursor:${linked ? 'pointer' : 'not-allowed'}">${esc(t('hudChrome.nftSkins.claim'))}</button>
      </div>`;
    }).join('');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <h2 style="margin:0;font-size:20px;color:#caa84b">${esc(t('hudChrome.nftSkins.title'))}</h2>
        <button class="nft-close-btn" type="button" aria-label="${esc(t('hudChrome.nftSkins.close'))}"
          style="min-height:40px;min-width:40px;border:1px solid #4a3a26;background:#241a14;color:#e8dcc0;border-radius:6px;cursor:pointer;font-size:18px">×</button>
      </div>
      <p style="font-size:13px;opacity:0.85;line-height:1.5">${esc(t('hudChrome.nftSkins.intro'))}</p>
      ${statusLine()}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
        <button class="nft-link-eth" type="button" style="min-height:40px;padding:0 14px;border-radius:6px;border:1px solid #4a3a26;background:#241a14;color:#e8dcc0;cursor:pointer">${esc(t('hudChrome.nftSkins.connectEthereum'))}</button>
        <button class="nft-link-sol" type="button" style="min-height:40px;padding:0 14px;border-radius:6px;border:1px solid #4a3a26;background:#241a14;color:#e8dcc0;cursor:pointer">${esc(t('hudChrome.nftSkins.connectSolana'))}</button>
      </div>
      <h3 style="font-size:15px;margin:14px 0 4px;color:#caa84b">${esc(t('hudChrome.nftSkins.collectionsTitle'))}</h3>
      ${eligible.collections.length === 0 ? `<p style="font-size:13px;opacity:0.7">${esc(t('hudChrome.nftSkins.noCollections'))}</p>` : rows}
      <div class="nft-status" role="status" aria-live="polite" style="min-height:20px;margin-top:12px;font-size:13px"></div>
    `;
    wire();
  }

  function setStatus(message: string, kind: 'ok' | 'error' | 'info'): void {
    const el = panel.querySelector<HTMLElement>('.nft-status');
    if (!el) return;
    el.textContent = message;
    el.style.color = kind === 'error' ? '#e6786a' : kind === 'ok' ? '#86d07a' : '#caa84b';
  }

  async function refreshWallets(): Promise<void> {
    try {
      eligible = await deps.eligible();
      wallets.ethereum = eligible.wallets.ethereum;
      wallets.solana = eligible.wallets.solana;
    } catch {
      /* keep last known */
    }
    render();
  }

  function wire(): void {
    panel.querySelector<HTMLButtonElement>('.nft-close-btn')?.addEventListener('click', close);
    panel.querySelector<HTMLButtonElement>('.nft-link-eth')?.addEventListener('click', async () => {
      setStatus('', 'info');
      try {
        const addr = await deps.linkEthereum();
        if (addr) { await refreshWallets(); } else { setStatus(t('hudChrome.nftSkins.walletError'), 'error'); }
      } catch {
        setStatus(t('hudChrome.nftSkins.walletError'), 'error');
      }
    });
    panel.querySelector<HTMLButtonElement>('.nft-link-sol')?.addEventListener('click', async () => {
      setStatus('', 'info');
      try {
        const addr = await deps.linkSolana();
        if (addr) { await refreshWallets(); } else { setStatus(t('hudChrome.nftSkins.walletError'), 'error'); }
      } catch {
        setStatus(t('hudChrome.nftSkins.walletError'), 'error');
      }
    });
    for (const row of panel.querySelectorAll<HTMLElement>('.nft-collection-row')) {
      const btn = row.querySelector<HTMLButtonElement>('.nft-claim-btn');
      const input = row.querySelector<HTMLInputElement>('.nft-token-input');
      btn?.addEventListener('click', async () => {
        const tokenId = input?.value.trim() ?? '';
        if (!tokenId) return;
        const chain = row.dataset.chain ?? '';
        const contract = row.dataset.contract ?? '';
        btn.disabled = true;
        btn.textContent = t('hudChrome.nftSkins.claiming');
        try {
          const { id } = await deps.claim(chain, contract, tokenId);
          setStatus(t('hudChrome.nftSkins.claimed'), 'ok');
          deps.onClaimed(id);
        } catch (err) {
          setStatus(claimErrorMessage(err instanceof Error ? err.message : ''), 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = t('hudChrome.nftSkins.claim');
        }
      });
    }
  }

  function close(): void {
    overlay.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', onKey);

  render();
  document.body.appendChild(overlay);
  panel.querySelector<HTMLButtonElement>('.nft-close-btn')?.focus();
}
