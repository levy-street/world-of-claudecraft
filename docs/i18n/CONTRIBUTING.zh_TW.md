<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · **繁體中文** · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

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

你會需要 [Node.js 22+](https://nodejs.org/) 和 npm。如果要跑多人連線伺服器，還會用到 [Docker](https://www.docker.com/) 來執行 Postgres。

```bash
# 1. 在 GitHub 上 fork 這個 repo，然後 clone 你的 fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. 安裝相依套件
npm ci

# 3. 執行離線用戶端（不需要伺服器或資料庫）
npm run dev          # 打開它印出的網址（通常是 http://localhost:5173）
```

這樣就足以遊玩離線世界，也能處理大部分的工作。若要執行完整的線上環境：

```bash
npm run db:up        # 在 Docker 中啟動 Postgres 16（開發資料庫在 port 5433）
npm run server       # 建置並執行權威遊戲伺服器，位於 :8787
npm run dev          # 在另一個終端機執行；用戶端會代理到伺服器
```

[README](../../README.md) 提供了完整的架設、開發與遊玩指南，而散布在整個 repo 中的 `CLAUDE.md` 檔案則記錄了各個區塊的慣例。

## 進行你的修改

1. **從 `main` 開出一條分支**：`feature/<short-slug>` 或 `fix/<short-slug>`。
2. **做出聚焦的 commit。** 小而獨立的修改比起大幅變動，更容易審查與合併。
3. 對於你在 `src/sim/` 或 `server/` 中改動的任何行為，**新增或更新測試**。
4. **讓玩家可見的文字保持可翻譯。** 請參考[在地化](#localization)與[翻譯遊戲](#translating-the-game)。

### 需要放在心上的事

以下是這份程式碼庫中關鍵的規則。完整的細節收錄在根目錄的 [`CLAUDE.md`](../../CLAUDE.md) 中，這裡是精簡版：

- **模擬核心（`src/sim/`）是唯一的真實來源**，而且它保持純淨，不引入任何 DOM、瀏覽器或 Three.js 的模組，因此完全相同的程式碼可以在離線、伺服器，以及無頭 RL 環境中執行。
- **模擬是確定性的。** 它以固定的 20 Hz tick 執行，所有隨機性都透過 `Rng` 處理，sim 邏輯中絕不使用 `Math.random`、`Date.now` 或 `performance.now`。相同的種子永遠產生相同的世界。
- **遊戲數值遵循經典時代的 MMO 公式**（怒氣、命中表、護甲、經驗值曲線）。請不要自行發明平衡數值。請改為引用公式。
- **不要手動編輯產生出來的檔案**，例如 `*.generated.ts`。請透過建置流程重新產生它們。
- **絕不提交密鑰**或 `.env` 檔案，也絕不在正式環境路徑中啟用 `ALLOW_DEV_COMMANDS`，因為它會解鎖作弊功能。

## 在你開 pull request 之前

請在本機執行這些指令。它們和 CI 跑的檢查完全相同：

```bash
npm test                    # Vitest 測試套件
npx tsc --noEmit            # TypeScript 型別檢查（本專案為 strict 模式）
npm run build               # 正式環境用戶端建置
```

如果你改動了伺服器或無頭的程式碼，也請執行 `npm run build:server` 和 `npm run build:env`。

接著，如果你的修改觸及任何玩家會看到的部分，請同時在桌機與行動裝置上測試你的改動，包括手機尺寸的視窗在直向與橫向下的呈現。觸控目標應維持至少 40x40px，表單輸入欄位的字級應至少 16px。UI 標準記錄在 [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) 中。

## 開啟 pull request

推送你的分支，並針對 `main` 開一個 PR。[pull request 範本](../../.github/PULL_REQUEST_TEMPLATE.md)會帶你走完一份簡短的檢查清單。請填寫它：

- 描述**改了什麼**，以及**為什麼**。
- 連結任何相關的議題（例如「Closes #123」）。
- 為 **UI 改動附上截圖或短片**，桌機與行動裝置都要。
- 確認測試、型別檢查與建置都通過，且新的字串都已翻譯。

CI 跑出綠燈，加上一份完整的檢查清單，就是我們合併前所要看的。維護者可能會提出修改建議。這是流程中正常且具有協作精神的一部分，並不是被退回。我們努力在審查中保持友善與建設性，也請你以同樣的方式對待我們。

> Commit 訊息與 PR 標題遵循 [Conventional Commits](https://www.conventionalcommits.org/)，並在合適時加上 scope（`feat(talents): ...`、`fix(net): ...`）。這是一個我們喜歡的慣例，而非嚴格的硬性要求。清楚、好懂的訊息，比起完美的格式更重要。

<a id="localization"></a>

## 在地化

World of ClaudeCraft 以多種語言發行，而且我們會在遊戲持續成長的同時維持這一點。每一段玩家可見的字串，都會翻譯成每一個支援的語系。

- 所有面向使用者的文字都是定義在 [`src/ui/i18n.ts`](../../src/ui/i18n.ts) 中的 `t()` key。先把新字串加入 `en` 語系，接著在 `supportedLanguages` 裡的每一個其他語系都提供真正的翻譯。不要留英文佔位字串，也不要留 `// TODO`。
- 數字、金錢、日期、單位與百分比都要透過格式化工具處理（`formatNumber`、`formatMoney`、`formatDateTime`、`Intl`），而不是手動拼接字串。
- 從 `src/sim/` 或 `server/` 發出的、面向玩家的文字（這些區塊保持與語言無關），必須在同一次改動中於用戶端邊界重新在地化。守門測試 `npx vitest run tests/localization_fixes.test.ts` 會強制執行這一點。

如果你的改動新增了字串，而你只能寫出其中部分語言，沒關係。儘管開 PR，並在描述中請大家幫忙補完其餘的部分。比起讓你卻步，我們更願意幫你完成。

<a id="translating-the-game"></a>

## 翻譯遊戲

想改善某個語言，或幫忙把遊戲帶到一個新語言嗎？你不需要寫任何遊戲程式碼就能做到：

1. 打開 [`src/ui/i18n.ts`](../../src/ui/i18n.ts)，找到你想處理的語系。每個語系物件列出的 key 都和 `en` 相同。
2. 改善既有的翻譯，或補上任何讀起來彆扭的部分。
3. 執行 `npx tsc --noEmit` 確認沒有遺漏，然後開一個 PR。

若要提議一個全新的語系，或想討論語氣與用語，請到 [Discord](https://discord.com/invite/worldofclaudecraft) 開一個討論串，我們會協助你把它接上去。我們特別歡迎母語者與流利的使用者。好的翻譯會讓世界各地的玩家覺得這款遊戲就像回到家一樣。

## 回報錯誤與提出功能需求

請使用[議題範本](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)：

- **錯誤回報。** 請先搜尋[既有的議題](https://github.com/levy-street/world-of-claudecraft/issues)以避免重複，接著附上重現步驟、你預期的結果、實際發生的狀況，以及你的環境（離線或線上、瀏覽器、桌機或行動裝置）。
- **功能需求。** 請描述你想解決的問題，而不只是解決方案。脈絡能幫助我們設計出對的東西。

## 取得協助

卡住了，或只是想打聲招呼？歡迎加入[社群 Discord](https://discord.com/invite/worldofclaudecraft)。沒有任何問題太小，我們永遠歡迎新的貢獻者。

## 授權

只要做出貢獻，就代表你同意你的貢獻將以本專案的 [MIT License](../../LICENSE) 授權，與涵蓋整個專案的授權相同。

---

謝謝你為 World of ClaudeCraft 做出貢獻。我們迫不及待想看看你和我們一起打造出什麼。
