<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · **繁體中文** · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# 為 World of ClaudeCraft 做出貢獻

首先，謝謝你來到這裡。World of ClaudeCraft 是由一群熱愛經典 MMO 的人共同打造的，每一份貢獻，無論大小，都讓它變得更好。修正一個錯字、翻譯遊戲、回報一個錯誤、打造一整座全新的地城：這些全都很有意義，我們很歡迎你。

這份指南會協助你完成環境設定，並讓你的第一次貢獻順利進行。你不需要是專家。如果有任何不清楚的地方，歡迎到 [Discord](https://discord.com/invite/worldofclaudecraft) 提問，會有人很樂意幫你。

只要參與其中，就代表你同意遵守我們的[行為準則](../../CODE_OF_CONDUCT.md)。

## 貢獻的方式

這裡有適合每一個人的位置：

- **程式碼。** 修正錯誤、新增功能，或改善效能。標記為
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  和 [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  的議題是不錯的起點。
- **翻譯。** 透過改善或補完某個語言，幫助世界各地的玩家。請參考下方的[翻譯遊戲](#translating-the-game)。這是入門最容易、影響也最大的方式之一。
- **錯誤回報與功能點子。** 開一個[議題](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)。
  一份清楚的錯誤回報就是實實在在的貢獻。
- **文件。** 像這份一樣的指南、README，以及 `docs/` 裡的設計文件，永遠都有改善的空間。
- **遊玩測試與意見回饋。** 玩玩看這款遊戲，告訴我們哪裡感覺不對勁，並在 Discord 上分享你的想法。

## 開始上手

你需要 [Node.js 26](https://nodejs.org/) 與 **pnpm 10.34.x**（精確版本寫在 `package.json` 的 `packageManager`，目前是 `pnpm@10.34.5`）。更舊的 Node 主版本未經驗證。若要跑多人遊戲伺服器，還需要 [Docker](https://www.docker.com/) 來執行 Postgres。

**不強制使用 Corepack。** 用 Node 內建的 npm 全域安裝一次 pnpm 即可。macOS、Linux、Windows 路徑相同。

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install pnpm once (same command on macOS, Linux, Windows)
#    Match the packageManager pin in package.json (today: 10.34.5).
npm install -g pnpm@10.34.5
pnpm --version   # should print 10.34.5 (or the pin in package.json)

# 3. Install dependencies (uses the global content-addressable store)
pnpm install --frozen-lockfile

# 4. Point git at the repository hooks (once per clone)
git config core.hooksPath .githooks

# 5. Run the offline client (no server or database needed)
pnpm run dev         # open the URL it prints (usually http://localhost:5173)
```

用 pnpm 裝好依賴之後，`npm run <script>` 仍然可用（Node 內建 npm），但 **安裝依賴與更新 lockfile 必須走 pnpm**。不要提交 `package-lock.json`；唯一權威是 `pnpm-lock.yaml`。

這樣就足以遊玩離線世界，也能處理大部分的工作。若要執行完整的線上環境，你得先在環境變數中設定資料庫密碼：

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
pnpm run db:up       # start Postgres 16 in Docker (dev DB on port 5433)
pnpm run server      # build and run the authoritative game server on :8787
pnpm run dev         # in another terminal; the client proxies to the server
```

如果你打算執行下方的完整檢查關卡，請先安裝它會驅動的瀏覽器（只需一次）：`pnpm exec playwright install chromium`。

[README](README.zh_TW.md) 提供了完整的架設、開發與遊玩指南，而散布在整個 repo 中的 `CLAUDE.md` 檔案則記錄了各個區塊的慣例。

### TypeScript 工具鏈

型別檢查跑在 TypeScript 7，也就是原生編譯器上：`npx tsc --noEmit` 的用法與過去完全相同，而整個 repo 的完整檢查現在只要幾秒，而不是數十秒。安裝方式是官方的雙別名做法：`typescript` 套件解析到 TypeScript 6 的 JS API（透過 `@typescript/typescript6` 包裝層），因為 `svelte-check` 仍然使用該 API，而 `@typescript/native` 則提供 `tsc` 執行檔。以下是需要知道的事：

- **編輯器。** 在內建支援推出之前，VS Code 需要 marketplace 上的「TypeScript 7」擴充套件（`TypeScriptTeam.native-preview`）才能取得原生語言服務支援；它透過 `js/ts.experimental.useTsgo` 設定切換，而它的「Disable TypeScript 7 Language Server」指令是回退到 TypeScript 6 tsserver 的官方認可做法。JetBrains 系列 IDE 只有在套件名稱為 `@typescript/native-preview` 時才會自動偵測到原生伺服器，所以它們不會從本 repo 的 `@typescript/native` 別名認出它；它們內建的 TypeScript 6 支援可以正常運作。
- **好用的 tsc 參數。** `--checkers N` 設定平行型別檢查的工作程序數量（預設為 4；不論設定多少，結果都相同）：在資源吃緊的 runner 上調低它以限制記憶體用量，在多核心機器上調高它，兩種情況都請實際量測，因為更多不見得更快。`--singleThreaded` 會關閉所有平行處理。臨時檢查單一檔案（`npx tsc somefile.ts`）在目錄裡有 `tsconfig.json` 時會出錯；加上 `--ignoreConfig` 可以取得舊有行為。
- **鎖定檔。** 鎖定檔是 `pnpm-lock.yaml`（pnpm 10 / lockfileVersion 9）。只能在倉庫根目錄用 `pnpm install`、`pnpm add` 或 `pnpm update` 更新（禁止手改）。把 `pnpm-lock.yaml` 與 `package.json` 的變更一起提交。CI 使用 `pnpm install --frozen-lockfile`；過期的 lockfile 會直接失敗。不要再引入第二份鎖定檔（`package-lock.json` / yarn.lock）：雙鎖定檔會靜默分叉，倉庫禁止。可選 wallet/solana 樹帶來的 peer 雜訊透過 `.npmrc` 的 `strict-peer-dependencies=false` 容忍；沒有測量就不要再放寬。
- **何時該重新檢視。** 只有在以下兩件事「同時」成立時，才把雙別名收攏回單一的 `typescript` 相依套件：TypeScript 7.1 穩定版的 JS API 已經推出（TypeScript 7.0 完全不提供 JS API；替代方案追蹤在 microsoft/typescript-go 議題 2824），以及 sveltejs/language-tools 議題 3063 已經隨著採用它的 `svelte-check` 正式版一起關閉。svelte-check 的實驗性 `--tsgo` 模式並不會解除它對 TypeScript 6 API 的需求，而它進行中的 TypeScript 7 載入支援（language-tools PR 3073）讀取的正是本 repo 已經在用的 `@typescript/native` 別名，所以不需要任何改名。

## 進行你的修改

1. **從最新的 release 分支開始，絕不要從 `main` 開始。** 進行中的工作都整合在 `release/vX.Y.Z` 分支上；`main` 落後於它，並不是貢獻的基底。找出最新的那一條，並從它開出分支：

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   請務必實際執行上面的查詢，不要從本指南裡照抄某個版本號：release 分支更替頻繁，最新的那一條會隨著每次發布而變動。分支命名為 `feature/<short-slug>` 或 `fix/<short-slug>`。
2. **做出聚焦的 commit。** 小而獨立的修改比起大幅變動，更容易審查與合併。
3. 對於你在 `src/sim/` 或 `server/` 中改動的任何行為，**新增或更新測試**。
4. **讓玩家可見的文字保持可翻譯。** 請參考[在地化](#localization)與[翻譯遊戲](#translating-the-game)。

### 需要放在心上的事

以下是這份程式碼庫中關鍵的規則。完整的細節收錄在根目錄的 [`CLAUDE.md`](../../CLAUDE.md) 中，這裡是精簡版：

- **模擬核心（`src/sim/`）是唯一的真實來源**，而且它保持純淨，不引入任何 DOM、瀏覽器或 Three.js 的模組，因此完全相同的程式碼可以在離線、伺服器，以及無頭 RL 環境中執行。
- **模擬是確定性的。** 它以固定的 20 Hz tick 執行，所有隨機性都透過 `Rng` 處理，sim 邏輯中絕不使用 `Math.random`、`Date.now` 或 `performance.now`。相同的種子永遠產生相同的世界。
- **遊戲數值遵循經典時代的 MMO 公式**（怒氣、命中表、護甲、經驗值曲線）。請不要自行發明平衡數值。請改為引用公式。
- **新的邏輯會以自己的小型、有測試的模組，落在既有的接縫之後**，而不是往其中一個龐大的協調者檔案裡追加。算繪器或 HUD 讀取的資料要跨越 `IWorld` 介面（`src/world_api/`），並且在離線世界與線上世界中都要實作；新的模擬系統放在 `SimContext` 之後；新的 REST 端點是一個路由模組，你可以用 `pnpm run new:endpoint` 產生它的骨架。
- **不要手動編輯產生出來的檔案**，例如 `*.generated.ts`。請透過建置流程重新產生它們。
- **專案文案風格：任何地方都不使用長破折號、短破折號或表情符號**，包含程式碼、註解、文件、commit 訊息、PR 內文，以及玩家看得到的文案。請改用逗號、冒號、括號，範圍則用「to」。推送前的檢查會掃描你的 diff，一旦命中就擋下推送。
- **絕不提交密鑰**或 `.env` 檔案，也絕不在正式環境路徑中啟用 `ALLOW_DEV_COMMANDS`，因為它會解鎖作弊功能。

### 程式碼風格

格式化交由 [Biome](https://biomejs.dev/) 處理，設定在 `biome.json`：2 空格縮排、100 欄行寬、單引號、結尾逗號。只格式化你動過的檔案（`npx @biomejs/biome check --write <your-file.ts>`），並用 `pnpm run ci:changed` 檢查它們。CI 只針對變更過的檔案把關，所以請不要重新格式化整個檔案樹：全 repo 的執行會翻出長年累積、不該由你來修的技術債。

## 在你開 pull request 之前

請在本機執行 repo 的檢查關卡。它和 CI 所強制執行的契約完全相同：

```bash
pnpm run gate
```

在反覆修改的過程中，可以只跑單一套件（`npx vitest run tests/sim.test.ts`），並用 `pnpm run ci:changed` 檢查格式；`pnpm test` 會跑完全部，套件對照表在 `tests/CLAUDE.md`。完整的 `pnpm run gate` 涵蓋產生出來的成品是否為最新、惡意程式碼掃描、變更檔案的格式化、音效一致性檢查、整套測試、真實瀏覽器的回歸測試、嚴格型別檢查，以及用戶端、伺服器與無頭版本的建置。從推送前的最低門檻往上的分層檢查，說明在 [`docs/qa-gate.md`](../qa-gate.md)。

接著，如果你的修改觸及任何玩家會看到的部分，請同時在桌機與行動裝置上測試你的改動，包括手機尺寸的視窗在直向與橫向下的呈現。觸控目標應維持至少 40x40px，表單輸入欄位的字級應至少 16px。UI 標準記錄在 [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) 中。

## 開啟 pull request

推送你的分支，並**針對你當初出發的那條最新 `release/vX.Y.Z` 分支開 PR。絕不要以 `main` 為目標**，它是發行時的整合分支，而不是貢獻的基底。GitHub 常常會替你預先選好 `main`，所以在送出之前請先改掉基底分支。[pull request 範本](../../.github/PULL_REQUEST_TEMPLATE.md)會帶你走完一份簡短的檢查清單。請填寫它：

- 描述**改了什麼**，以及**為什麼**。
- 連結任何相關的議題（例如「Closes #123」）。
- 為 **UI 改動附上截圖或短片**，桌機與行動裝置都要。
- 確認 `pnpm run gate` 通過，且新的玩家可見字串遵循下方的「英文優先」貢獻者原則。

在你的 PR 上，CI 會針對你變更過的檔案執行格式化與 lint、以四個平行分片跑完整套測試、進行一次瀏覽器回歸測試，並執行型別檢查以及用戶端、伺服器與無頭版本的建置。這和 `pnpm run gate` 在本機跑的內容一致，所以本機關卡亮綠燈，通常也能預測 PR 會是綠的。

CI 跑出綠燈，加上一份完整的檢查清單，就是我們合併前所要看的。維護者可能會提出修改建議。這是流程中正常且具有協作精神的一部分，並不是被退回。我們努力在審查中保持友善與建設性，也請你以同樣的方式對待我們。

> Commit 訊息與 PR 標題遵循 [Conventional Commits](https://www.conventionalcommits.org/)，並帶上 scope（`feat(talents): ...`、`fix(net): ...`）。每一個 commit 也都要有內文：空一行之後，用一到四句平實的句子說明改了什麼以及為什麼，行寬接近 72 欄。只有標題是不夠的。

<a id="localization"></a>

## 在地化

World of ClaudeCraft 以多種語言發行。每一段玩家可見的字串都必須是翻譯 key，而功能的貢獻者通常只需要加入英文原文。

- 所有面向使用者的文字都是 `t()` key。請把新的英文文案加到 [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) 底下對應的分領域模組（新的 HUD 外框元素放在 `hud_chrome.ts`），然後用 `t('dotted.key', values)` 算繪它。對功能型 PR 來說，只有英文正是正確的做法：維護者會在發行時補上其他語系，所以你不需要編輯 `src/ui/i18n.locales/` 的覆蓋檔，也絕不要在裡面留下英文佔位字串或 `// TODO`。M16 例外是新增一個字數較多的英文值，它還需要 [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) 中所述的五個非拉丁語系填寫。
- 數字、金錢、日期、單位與百分比都要透過格式化工具處理（`formatNumber`、`formatMoney`、`formatDateTime`、`Intl`），而不是手動拼接字串。
- 從 `src/sim/` 或 `server/` 發出的、面向玩家的文字（這些區塊保持與語言無關），必須在同一次改動中於用戶端邊界重新在地化。守門測試 `npx vitest run tests/localization_fixes.test.ts` 會強制執行這一點。
- 新增或修改任何字串之後，請執行 `pnpm run i18n:gen`，並在同一次改動中提交重新產生的 bundle。本機關卡與 CI 都會把已提交的成品和重新產生的結果做比對，所以過時的 bundle 會讓建置失敗。

所以，用英文加入你的字串然後開 PR 就好；你不需要自己翻譯它們。如果你想幫忙翻譯，請看下一節。

<a id="translating-the-game"></a>

## 翻譯遊戲

想改善某個語言，或幫忙把遊戲帶到一個新語言嗎？你不需要寫任何遊戲程式碼就能做到：

1. 大部分玩家可見的翻譯都放在 [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) 底下的各語系覆蓋檔（每個語系一個），對應 [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) 中的英文 key。由模擬與伺服器發出的文字在 `src/ui/sim_i18n.ts` 和 `src/ui/server_i18n.ts` 中翻譯，天賦文案在 `talent_i18n` 模組中，而管理後台則有自己的一套，位於 `src/admin/i18n.locales/`。
2. 改善既有的翻譯，或補上任何讀起來彆扭的部分。
3. 執行 `pnpm run i18n:gen`，把重新產生的 bundle 和你的覆蓋檔一起提交，接著執行在地化測試套件（`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`）並開一個 PR。光靠型別檢查無法告訴你是否漏了某個 key，因為覆蓋檔本來就是刻意稀疏的。

若要提議一個全新的語系，或想討論語氣與用語，請到 [Discord](https://discord.com/invite/worldofclaudecraft) 開一個討論串，我們會協助你把它接上去。我們特別歡迎母語者與流利的使用者。好的翻譯會讓世界各地的玩家覺得這款遊戲就像回到家一樣。

## 回報錯誤與提出功能需求

請使用[議題範本](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)：

- **錯誤回報。** 請先搜尋[既有的議題](https://github.com/levy-street/world-of-claudecraft/issues)以避免重複，接著附上重現步驟、你預期的結果、實際發生的狀況，以及你的環境（離線或線上、瀏覽器、桌機或行動裝置）。
- **功能需求。** 請描述你想解決的問題，而不只是解決方案。脈絡能幫助我們設計出對的東西。
- **安全性漏洞。** 請不要開公開議題。請依照 [SECURITY.md](../../SECURITY.md) 私下回報，我們會和你一起處理修正與揭露事宜。

## 取得協助

卡住了，或只是想打聲招呼？歡迎加入[社群 Discord](https://discord.com/invite/worldofclaudecraft)。沒有任何問題太小，我們永遠歡迎新的貢獻者。

## 授權

只要貢獻程式碼，就代表你同意你的程式碼貢獻將以本專案的 [MIT License](../../LICENSE) 授權，與涵蓋整個專案的授權相同。

MIT License 的意思就如同字面：任何人都可以使用、修改與再散布這些程式碼，商用或非商用皆可。我們的[服務條款](https://worldofclaudecraft.com/terms)規範的是我們在 worldofclaudecraft.com 營運的託管遊戲（帳號、行為規範、虛擬物品），並不會限制 MIT License 賦予你或任何人對這份程式碼的權利。「World of ClaudeCraft」與「Levy Street」的名稱和品牌識別不在 MIT License 的涵蓋範圍內。

原創的創作素材（錄音、音樂、美術，以及類似的著作）是例外。如果你貢獻的是由你自己創作的原創素材，你可以選擇保留著作權，並以你選擇的授權方式提供（例如 CC BY-NC 4.0），前提是：

- 該授權、它所涵蓋的素材路徑，以及你的姓名標示，都在同一個 pull
  request 中記錄到 [CREDITS.md](../../CREDITS.md) 的授權表格裡，而且
- 它至少包含一項永久、免權利金的授權，允許 Levy Street 在 World of ClaudeCraft 中商業使用這些素材，包括官方發行版本與遊戲內商店。

對於列在 CREDITS.md 表格中的素材，該筆記錄的授權優先於專案預設的 MIT 授權。

**在 CREDITS.md 中沒有對應紀錄的媒體素材，不以 MIT 授權。** 這份登錄表仍在補完中，所以缺少紀錄代表條款尚未被記錄，而不是代表這份素材可以任意取用。這是刻意的：它能避免未登錄的貢獻在預設情況下被送出去。程式碼則相反，凡是沒有在 CREDITS.md 中另行載明的，都是 MIT。

正因如此，登錄表上的紀錄並不是可有可無的文書作業。如果你貢獻了素材卻沒有留下 CREDITS.md 的一列，下游就沒有人能使用它，我們也沒有紀錄可以說明你授權了什麼。**Redistribution** 欄位也請誠實填寫。它會告訴 fork 這個專案的人能不能再把你的素材傳下去，而有些列被標記為「No, permission required」，正是因為不能。

---

謝謝你為 World of ClaudeCraft 做出貢獻。我們迫不及待想看看你和我們一起打造出什麼。
