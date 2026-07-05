# woc_spin_vault: devnet deployment record

Live deployment of the daily-spinner SOL prize vault
(`programs/woc-spin-vault`) on Solana **devnet**, with every instruction
exercised end to end through the IDL-free encoders
(`server/woc_spin_vault_client.ts`).

- Cluster: devnet
- Program Id: `9TPiQxpBkjUoxKtkqH1qQrG92aUaKQJj96uyZddAwRZ9`
- Upgrade authority / fee payer (deployer): `HBabiEx3GXjwpc4YX822WwX4WqT6vhgUdMNQNZ422vLY`
- Reproduce: `RUN_DEVNET=1 npx vitest run tests/spin_vault_devnet.test.ts`

## Accounts

| Account | Address |
|---|---|
| Program | [`9TPiQxpB…AwRZ9`](https://solscan.io/account/9TPiQxpBkjUoxKtkqH1qQrG92aUaKQJj96uyZddAwRZ9?cluster=devnet) |
| Vault config PDA `["spin_vault"]` | [`AvXnYGWW…iy4mz`](https://solscan.io/account/AvXnYGWWctYL7oTqHokEvYNXk9zk1sghHqGXa1Viy4mz?cluster=devnet) |
| Wallet registry PDA `["wallet", account_id]` | [`BeiYqy21…QcSR`](https://solscan.io/account/BeiYqy21YVbbR8pfmVd1EcVs4K6GkzvkCtuM7YetQcSR?cluster=devnet) |
| Spin receipt PDA `["payout", day, account_id]` | [`4tqQg9nv…JvnF`](https://solscan.io/account/4tqQg9nvr9QAcpFGM7RbKoq8KWMUtetgJHMH1UuMJvnF?cluster=devnet) |
| Registered winner wallet | [`3vrfHzFX…eUX2`](https://solscan.io/account/3vrfHzFXHyQ5yoW1TUJScCoYycb3WavmfvpUwTgBeUX2?cluster=devnet) |

## Transactions (all confirmed Success)

| Instruction | Signature (Solscan devnet) |
|---|---|
| deploy | [`4MUjfo8z…2vwJW`](https://solscan.io/tx/4MUjfo8zu9fGVUPrsGNmHenSqRwsVRMiaxGqNbdzKG2CJQaVpLqjP8cdsQQQ4nMgG59qgd13ikT6Urmht9z2vwJW?cluster=devnet) |
| initialize | [`4u1G33Ny…286yZ`](https://solscan.io/tx/4u1G33NyBxTnVj3gVgA6hLo97EanvTb3gAeBHkKEGYngcP1xasMLg8oq8oFp9NimZ3pcme5cimHMS1WXLce286yZ?cluster=devnet) |
| configure | [`2Y18y8eW…TFXwf`](https://solscan.io/tx/2Y18y8eW82r5RPmMBzZQs8gEJuy9tPStAXAF6EfSYHQT1NQRdQNFWF1svhBwxeHkGaxa1eVBGeryDbAMAk8TFXwf?cluster=devnet) |
| register_wallet | [`67mHWxpR…aaaj7`](https://solscan.io/tx/67mHWxpR695a3GMq9MnvDpuVDT1pjnsvxrnKwyKYKChdvdictFwkiKR99gUMDQhvihTGgLfjcNGYnKH5iQGaaaj7?cluster=devnet) |
| fund | [`2AfymReb…BUAJu7`](https://solscan.io/tx/2AfymRebH7QNaGopJQFx19Ezoi1ozhq9kVAFUEGWeBgtvscGggbDBr1WrjWfosKxMhS8GeHsEJEJWx9YEyBUAJu7?cluster=devnet) |
| payout (0.01 SOL to the registered winner) | [`4mAmzPjS…suXCE`](https://solscan.io/tx/4mAmzPjSnuSvTzm6RAVL5VbEmBTbe9PVDou5L8JNQtQmka3LWkpVuqnf6eGvrJySCoNgoKU9LYpBkR6KQ5usuXCE?cluster=devnet) |
| pause (configure paused=true) | [`3YFxzxDL…QWfMk`](https://solscan.io/tx/3YFxzxDLjvmX6PzMF7ELo7XWxBiaeUcKSvV8dVaiq8nETMVGPXVqgbLkKantmfh2o9mMC58rzFNjH8dC9fuQWfMk?cluster=devnet) |
| unpause | [`5JSVR1YG…WccQaZv`](https://solscan.io/tx/5JSVR1YG3zRfrg2uUn42d5N9V1v1YASeaKxe6xgXxHcDz3wpJX3yCJhXpw4eEDUpk4Yw4CKLntAVBYKb1WccQaZv?cluster=devnet) |
| withdraw (0.02 SOL back to authority) | [`4KiGZc4R…bksTMQ`](https://solscan.io/tx/4KiGZc4RJnEmQiimh7Ni8g9X3g8Yad2ncb6xwceWDTfQ8RTfUGik49tGdkLL7tSmkeeLZhrZMJhEpLsqSPbksTMQ?cluster=devnet) |

## On-chain guards (all correctly rejected, so no signature)

The devnet test asserts each of these reverts:

- **Replay**: a second `payout` for the same `(day, account_id)` fails (the receipt PDA is already initialized).
- **Over-cap**: `payout` with `amount > max_payout` fails (`OverCap`).
- **Wrong winner**: `payout` to any address other than the account's registered wallet fails (`WrongWinner`) -- the security fix in action.
- **Paused**: `payout` while paused fails (`Paused`).

## Screenshots

Solscan blocks headless screenshots (Cloudflare), so the images below are the
Solana Explorer view of the same on-chain transactions. The Solscan links above
are the canonical references.

- `program-account.png` -- the deployed program (Executable: Yes) with its full transaction history.
- `deploy-tx.png` -- the program deployment (BPF Upgradeable Loader: Deploy).
- `payout-tx.png` -- the SOL payout: balance moves to the registered winner, with the `Payout` program log.
- `register-wallet-tx.png` -- binding the account to its payout wallet.
