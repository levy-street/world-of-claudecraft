<div align="center">

# World of ClaudeCraft

**在瀏覽器中免費探索一個純手工打造的世界：接任務、組隊、打團。開放原始碼、web3，現在就能上線遊玩。**

**官方網站：https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.32.3-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.zh_TW.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · **繁體中文** · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[立即遊玩](https://worldofclaudecraft.com/) · [架設你自己的世界](#host-your-own-world-one-command) · [訓練一個代理](#train-an-agent-headless-rl) · [Web3](#web3) · [參與貢獻](CONTRIBUTING.zh_TW.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft 標題畫面](../../docs/screenshots/title-screen.jpg)

</div>

## 這是什麼

World of ClaudeCraft 是一款完整的經典時代 MMO，你現在就能直接在瀏覽器裡遊玩，用一行指令自行架設，甚至還能訓練 AI 代理來遊玩。它免費、開放原始碼，並在 [worldofclaudecraft.com](https://worldofclaudecraft.com/) 上線運作中。

同一個共用世界在三個地方運行，全都來自同一套遊戲核心：

- **權威多人伺服器**，也就是你在 worldofclaudecraft.com 上遊玩的即時世界，由 Postgres 支撐的帳號共享同一個持久化的國度，
- **離線瀏覽器世界**，一個由開發伺服器提供的本地單人 Sim，適合開發，也適合從頭到尾閱讀遊戲核心，
- **無頭 RL 環境**，Python 透過 Gym 介面驅動真正的遊戲。

無論在哪裡，相同的種子就會產生相同的世界。你看到的東西有很大一部分仍然是在執行時由程式碼繪製的，其餘則是隨專案一起發布的精選素材集，因此 fork 之後開箱即可運行。

## 重點特色

- **九個經典職業**，每個都擁有完整的經典時代風格技能組，會隨等級提升而升階，外加完整的**天賦系統**（每個職業三個專精，共 27 個專精）。
- **三個開放世界區域**，從 1 級到 20 級，超過 90 個任務，以及一條圍繞 Gravecaller 陰謀的連貫劇情主線。
- **五個副本實例**，其中四個是五人精英團，一個是單人地穴，具備精英等級縮放、AoE 王機制、會集成套裝的職業原型專屬掉落，以及一個獎勵更豐厚的 **Heroic 難度層級**，外加開放世界的世界王與一場十人團隊終局戰。
- **兩個可縮放的 delves**，一種供一到兩名玩家加上一個 AI 同伴的小隊模式，在 Normal 與 Heroic 兩種難度下，每次進入都會從隨機房間重新組建。
- **排名制 PvP**，橫跨兩張競技場地圖：1v1 與 2v2 天梯、更熱鬧的 2v2 Fiesta 模式，以及 **Protect Yumi** 這個 3v3 與 5v5 的目標制模式。排名對戰支付 Honor，可用來購買一套 PvP 專用裝備，它在 PvE 中永遠不會超越副本掉落。
- **The Vale Cup**，一個在 Eastbrook 南方專屬球場舉行的 boarball 聯賽，以及 **Card Duel**，一款在城鎮中舉辦的快節奏一對一卡牌遊戲。
- **一本 Book of Deeds**：一部成就日誌，收錄裝飾性頭銜、徽章邊框與 Renown，並有由世界中的 Chronicler NPC 保管的各區域 Chronicles，以及一份歷來排行榜。
- **深度的專業經濟**：四種採集專業供養十種製作專業，從烹飪與煉金到珠寶加工、武器製作與附魔，具備分級工具、城鎮工作站、傑作品質與委託訂單，全都匯入玩家驅動的 **World Market** 與 **Ravenpost** 郵件服務。
- **真正的多人遊戲**：隊伍與團隊、公會、交易、決鬥、採集權、隊伍分配經驗、密語、離開狀態，以及一個具備角色排隊與預組隊列表的 **Dungeon Finder**。
- **以程式碼撰寫，而非在 3D 編輯器中製作**：地形、水、天氣、城鎮布局、即時陰影與特效都在執行時生成，而隨包附帶的模型則由程序化工廠與一套精選素材庫產出，並非手工雕塑。
- **本地化為 22 種語系**，透過一條確定性的、由 sim 發送鍵值的流程完成。
- **位於 `/wiki` 的隨附百科**，直接由即時遊戲內容生成，因此不會與它所記載的世界脫節。
- **每個平台上的原生應用程式**：Windows、Linux 與 macOS 的簽章桌面安裝程式，具備自動更新與可選的 Steam 成就同步，外加 iOS 與 Android 版本，全都共用同一個瀏覽器客戶端與同一個線上世界。
- **依你手上的機器縮放**：圖形預設集與自動幀率調節器會以視覺豐富度換取流暢度，並受一條公平性規則約束，永遠不會隱藏玩家需要據以反應的資訊。
- **無頭 RL 環境**，附帶 Gymnasium 綁定、獎勵塑形與基準測試模式。
- **$WOC 效用，完全可選**：連結一個 Solana 錢包即可獲得持有者標識、Daily Rewards，以及裝飾商店中的折扣付款選項。遊戲維持免費遊玩且非託管。
- **Season 1 Armory**：透過 WOC Store 收集裝飾性武器外觀，使用以法幣、SOL、USDC 或 $WOC 購買的 Claudium。裝飾品永遠不會提供戰鬥力。

## 螢幕截圖

![Eastbrook 城鎮廣場、營火與任務發布者](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Eastbrook 營火旁的黃昏](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Eastbrook 營火旁的黃昏* | ![the Hollow Crypt 中的精英拉怪](../../docs/screenshots/hollow-crypt.jpg)<br>*the Hollow Crypt 中火把照明下的精英拉怪* |
| ![荒廢禮拜堂的不安亡者](../../docs/screenshots/restless-dead.jpg)<br>*荒廢禮拜堂的不安亡者* | ![與 Vale Bandits 的混戰](../../docs/screenshots/vale-bandits.jpg)<br>*在盜匪營地寡不敵眾* |
| ![Old Greyjaw 在北方道路上被追殺](../../docs/screenshots/old-greyjaw.jpg)<br>*稀有刷新怪 Old Greyjaw，在北方道路上被追殺* | ![商人與背包介面](../../docs/screenshots/vendor-and-bags.jpg)<br>*在 Trader Wilkes 處整備裝備，同時開著商人與背包介面* |
| ![Glimmermere 岸邊的月門](../../docs/screenshots/glimmermere-moongate.jpg)<br>*溺亡者從 Glimmermere 月門爬出* | ![the Drowned Temple 祭壇上的 Ysolei](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest 與 the Drowned Temple 的祭壇* |

天氣由生態驅動且僅作渲染用途，因此永遠不會觸及確定性的 sim：

| | | |
|:---:|:---:|:---:|
| ![Eastbrook Vale 上空的晴朗天空](../../docs/screenshots/weather-vale_clear.jpg)<br>*Vale 上空的晴朗* | ![Mirefen Marsh 上空的雨](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mirefen Marsh 上空的雨* | ![Thornpeak Heights 上的雪](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Thornpeak Heights 上的雪* |

## 開始遊玩

在 [worldofclaudecraft.com](https://worldofclaudecraft.com/) 用瀏覽器遊玩，或安裝 Windows、Linux、macOS、iOS 或 Android 的原生應用程式。每一個客戶端都連到同一個線上世界。

### 連線，與其他玩家一起

建立帳號、建立角色，然後進入即時世界。若要自行運行同一套客戶端/伺服器堆疊，請見下方的[架設你自己的世界](#host-your-own-world-one-command)。

### 離線，在開發伺服器中

離線模式是一個沒有帳號、也沒有伺服器權威的本地單人世界，因此僅隨開發版本一起發布。運行開發伺服器，它就會出現在模式選擇器裡：

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

為你的角色命名，從九個職業中任選一個，你就會從 **Eastbrook Vale**（1 到 7 級）出發，這是一座被眾多樞紐環繞的集市城鎮：北邊是狼群出沒處，東邊是野豬草甸，西邊是 the Sableweb 森林，西北是 Mirror Lake，西南是一處滿是穴居生物的銅礦坑，東北是一座住著不安亡者的荒廢禮拜堂，東南則有 Gorrak 的盜匪營地。北方道路爬上一處山口，通往 **Mirefen Marsh**（6 到 13 級，樞紐 Fenbridge），再往上到 **Thornpeak Heights**（13 到 20 級，樞紐 Highwatch）。世界種子固定寫在 `src/main.ts` 裡，所以每次造訪都是同一個地方。

### Windows、Linux 與 macOS 的桌面應用程式

World of ClaudeCraft 以完整的桌面應用程式形式發布，涵蓋三大桌面平台：簽章的 Windows 安裝程式、Linux AppImage 與 deb 套件，以及已簽章並公證的 macOS 通用版本。它們使用與瀏覽器相同的遊戲客戶端與線上世界，並帶有原生打包與自動更新。

線上登入僅有 Discord 與電子郵件兩種，與網頁流程完全相同：電子郵件加密碼在應用程式內登入，而「Continue with Discord」會在你的預設瀏覽器中開啟 `/desktop-login` 頁面，該頁面透過 `worldofclaudecraft://` 深層連結把一組一次性代碼交回應用程式，應用程式再用它換取一個一般的 World of ClaudeCraft 工作階段權杖。

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

用 `VITE_DESKTOP_API_ORIGIN` 讓外殼指向不同的 API，例如一台本地伺服器或一台預備主機：

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

以 `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` 覆寫預備版本的生產 API 來源（這是一個建置期的值：它會被烘焙進套件並蓋印到打包後的應用程式中，已安裝的版本會忽略它作為執行期環境變數）。Steam 是一個發行通道（同一個 Electron 套件，透過 SteamPipe 上傳），桌面玩家可以連結一個 Steam 帳號，把他們獲得的 deeds 同步成 Steam 成就；登入本身仍維持電子郵件與 Discord。完整的發布流程手冊（簽章、公證、發布自動更新、SteamPipe depot、伺服器部署）位於 `docs/desktop-release.md`。iOS 與 Android 透過 Capacitor 發布，並有自己的流程手冊 `docs/mobile-store-release.md`。

<a id="host-your-own-world-one-command"></a>

## 架設你自己的世界（一行指令）

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

若要**遠端架設**，把這套 compose 堆疊放到任意 VPS 上，在環境中設定一個真正的 `POSTGRES_PASSWORD`，並用一個 TLS 反向代理擋在 8787 連接埠前面。用 Caddy 只需幾行；WebSockets 會自動被代理，客戶端在 https 頁面上會自動選用 `wss://`。驗證端點有速率限制，密碼以 scrypt 雜湊，登入工作階段會過期。切勿在生產環境中設定 `ALLOW_DEV_COMMANDS=1`，因為它會啟用完整的 `/dev` 作弊指令集：測試機器人所用的等級與傳送作弊，外加物品發放、怪物生成、實例傳送與遊戲內的開發指令 GUI。[DEPLOY.md](../../DEPLOY.md) 是完整的生產指南，包含讓健康檢查與監控端點不暴露在公開邊緣的反向代理設定。

<a id="develop-online-with-hot-reload"></a>

### 帶熱重載的連線開發

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

開啟 http://localhost:5173，選擇 **Play Online**，建立帳號，建立角色，然後 Enter World。角色選擇畫面會在 News & Updates 面板中顯示最新的發布消息，並為你尚未看過的內容標上 NEW。開啟第二個分頁再次登入，就能在城鎮裡看到彼此。`Enter` 開啟聊天。玩家百科就是倉庫內的 Guide，位於 http://localhost:5173/wiki ，在生產環境中則位於 `/wiki`；它的內容由 `npm run wiki:content` 從當前遊戲資料生成。

哪些東西會被持久化，以及伺服器如何保持主導權：

- **帳號**：scrypt 雜湊的密碼與會過期的 bearer 權杖。
- **角色**：每個帳號在每個國度最多 10 個；等級、裝備、背包、銀行金庫、任務、天賦、專業、PvP 與 deed 進度、位置與金錢以 JSONB 形式持久化在 Postgres 裡，會定時儲存、登出時儲存，以及伺服器關閉時儲存。名稱在每個國度內唯一，且為經典風格。
- **伺服器具有權威性**：客戶端以 20 Hz 串流移動意圖與指令；伺服器運行那一個共用的 `Sim`，並回傳興趣範圍內的快照外加各玩家專屬事件。每一次戰鬥擲骰、戰利品掉落、任務進度與商人交易都在伺服器端解算。客戶端只是一個渲染器。

<a id="train-an-agent-headless-rl"></a>

## 訓練一個代理（無頭 RL）

同一套確定性核心可作為一個 [Gymnasium](https://gymnasium.farama.org/) 環境運行，因此代理是針對真正的遊戲學習，而不是它的某個重新實作版本。環境伺服器（`headless/env_server.ts`）包裝了一個 `Sim`，並透過 stdio 以換行分隔的 JSON 溝通；`python/` 裡的 Python 綁定會把它當作子行程啟動，並暴露常見的 `reset` / `step` / `close` 迴圈。

```bash
npm run build:env    # bundle the env server to dist-env/env_server.cjs
npm run env          # run it directly (NDJSON on stdio)
npm run bench        # in-process throughput benchmark (no IPC)

# drive it from Python
pip install gymnasium numpy
python python/example_random_agent.py
```

```python
from wow_env import WoWClassicEnv

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **觀測空間與動作空間皆由內容衍生。** 啟動時請從環境的 `info` 回覆查詢，而不要寫死；它們會隨遊戲一起成長。動作空間是一個 `Discrete`，涵蓋移動、選目標、攻擊、完整技能組、互動與進食/飲水；觀測則是一個 `Box`，涵蓋自身、技能、目標、附近怪物、最近的可互動物與任務進度。
- **獎勵**是每一 tick 計數器差值（經驗、造成與承受的傷害、擊殺、死亡、任務進度、升級）的加權總和，每次重置時可調。每個 `step` 套用一個動作並預設推進五個 sim tick，因此大約每個模擬秒做出四個決策。
- **本質上即確定性。** 沒有牆上時鐘，沒有 `Math.random`。為 reset 設定種子，整局就會精確地重播。

協議與綁定的說明文件位於 `headless/CLAUDE.md` 與 `python/CLAUDE.md`。

<a id="web3"></a>

## Web3

World of ClaudeCraft 圍繞 **$WOC**（我們在 Solana 上的社群代幣）打造原生 web3 體驗。連結一個 Solana 錢包，用一次簽署把它連結到你的帳號（非託管，無需核准任何交易），你那唯讀的 $WOC 餘額就會顯示在 HUD 上，旁邊還有一枚裝飾性的持有者等級徽章。

$WOC 在即時遊戲中也具備可選的效用：

- **WOC Store**：以法幣、SOL、USDC 或 $WOC 購買 Claudium，這是一種單向的裝飾貨幣。$WOC 付款管道相較於其他方式享有折扣。
- **Season 1 Armory**：把 Claudium 花在裝飾性的武器外觀收藏上。商店購買不會增加屬性或戰鬥力。
- **Daily Rewards**：符合資格的已驗證持有者可以透過每日轉盤與輪替任務賺取點數，接著爭奪每日獎池的一份。

這些都不是遊玩所必需。錢包連結是可選且非託管的，沒有付費致勝，整款遊戲在完全不連結錢包的情況下也能順暢遊玩。

**$WOC 合約位址（Solana）：**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

關於代幣的更多資訊請見 [worldofclaudecraft.com](https://worldofclaudecraft.com/)。

## 世界巡禮

### 九個職業

每個職業都從第一原理實作經典時代 MMO 機制，並在 1 到 20 級期間學習升階法術，像 Low Blow、Early Grave、Skyfall、Urgent Prayer 與 Ancestral Strike 這類招牌技能會在攀升的後半段陸續解鎖。

- **Warrior**：怒氣、Iron Bellow、Onrush、Quaking Blow、Maiming Strike、Gaping Wounds（一種隨你的揮擊附加的流血）、Widening Arc、Hobbling Cut、Blood Toll、Redhand（閃避觸發）。
- **Paladin**：由 Verdict 釋放的 Oathbrand、Mending Light、Steadfast Aura、Oath of Iron、Ward of Faith（吸收）、Sundering Gavel（昏迷）、Last Rite。
- **Hunter**：遠程自動攻擊（8 到 35 yd，帶經典風格的死區）、Gutting Strike、Harrier's Guise、Venom Barb、Fell Shot、Rattling Shot、Counterfang、Fettering Slash，並可從 10 級起馴服一隻寵物。
- **Rogue**：能量與連擊點、Wicked Slash、Dirt Nap、Craven Thrust（背後、匕首）、Eye Jab、Ghostfoot、Cutthroat Tempo、Swift Heels。
- **Priest**：Smite、Whispered Prayer、Litany of Resolve、Dirge of Decay、Psalm of Warding（吸收）、Lingering Grace（HoT）、Mindfracture。
- **Shaman**：Arc Bolt、Stonebound Weapon（附魔）、Mending Waters、Earthen Jolt、Thunder Ward（荊棘）、Cinder Jolt。
- **Mage**：Cinderbolt、Hoarfrost Mantle、Aether Insight、Rimelance、Waterbind、Cinderfall、Aether Darts（引導）、Bewitch、Icebind、一隻召喚的水元素，以及 Chronomancy，一個時間魔法治療專精。
- **Warlock**：Gloom Bolt、Fiendhide、Burning Pact、Blackrot、Hard Bargain、Hex of Anguish、Consume，以及從 Emberkin 到 Wraithborn 共七種可召喚的惡魔。
- **Druid**：Wildbolt、Wildmend、Wildward、Lunar Tempest、Wildbloom、Briarguard、Gripping Roots，並可在 5 級變身為 Wolf Form、8 級 Bruin Form、10 級 Moonwing Form。

治療與增益會作用在隊伍成員身上，治療可以爆擊，吸收護盾會在血量之前承受傷害。把點數分配到**每個職業的三個天賦專精**（Battlecraft/Bloodrush/Ironguard、Moongrove/Wildfang/Groveheart 等等）；分配由伺服器驗證，並可匯出成一串配點字串。

### 副本

Gravecaller 劇情線貫穿三個五人精英實例，第四個實例帶著自己的溺亡傳說在一道月門後等待，另有一個單人地穴在一旁供探索者深入。

- **the Hollow Crypt**（5 人），位於 the Fallen Chapel 之下：成對的精英雜兵、Sexton Marrow 小王，以及 Morthen the Gravecaller 和他反覆施放的暗影 AoE。地穴門會把你的隊伍傳送進一個私人實例副本，等它清空後就會重置。
- **the Sunken Bastion**（5 人，約 13 級，Mirefen 東南）：Vael the Fogbinder 會隨著戰鬥拖長而召喚一波波 Drowned Thralls。
- **Gravewyrm Sanctum**（5 人，20 級，Thornpeak 之下）：三間滿是精英 boneguard 與 scaleguard 的房間、Korgath the Bound、Grand Necromancer Velkhar，以及掉落史詩武器的 Korzul the Gravewyrm。
- **the Drowned Temple**（5 人），穿過 Glimmermere 月門：一個慘白、月色紫羅蘭的實例，通往 Choirmother Selthe，接著是 Ysolei, Avatar of the Drowned Moon，她的月潮與召喚出的 Moonspawn 會懲罰站著不動的隊伍。
- **the Abandoned Crypt**（單人），位於 Thornpeak：一場安靜的拱心石與日記探索，供一人進行，其線索會解封通往 **Nythraxis, Scourge of Thornpeak** 的皇家之門，這是一場橫跨三塊靈魂守護石的十人團隊終局戰。

每個實例也都能以 **Heroic** 運行：更高等級的敵人、更嚴苛的機制，以及專屬的掉落與商人貨幣。前置任務鏈都可單人完成，所以劇情永遠不會被「得先找到隊伍」所阻擋。我們的自動化五機器人團隊（warrior、paladin、priest、mage、hunter，具備集火與治療 AI）大約五分鐘就能清掉 the Hollow Crypt（`node scripts/crypt_raid.mjs`，需要 `ALLOW_DEV_COMMANDS=1`）。

### Delves

Delves 是一種獨立、可縮放的小隊模式，供一到兩名玩家進行，每次進入都會從隨機房間重新組建，並在一個上鎖的聖物箱前結束，那個箱子是透過一個開鎖小遊戲打開，而不是擲骰決定戰利品。**The Collapsed Reliquary**（7 級以上）的終點是 Deacon Varric，若你單人前往，AI 同伴 Tessa 會在你身邊作戰。**The Drowned Litany**（12 級以上）則沿著線索走進 Mirefen Marsh 邊緣一座淹沒的神殿。一個 delve 看板決定難度層級：Heroic 會提升敵人等級並加上一個隨機詞綴，以換取更豐厚的獎勵。

### 排名制 PvP（the Ashen Coliseum）

按 `G` 或競技場按鈕排隊。配對系統會把鬥士傳送進一個私人鬥坑，一段短暫倒數會治療並重置所有人以求公平開局，當一方認輸時對戰結束。沒有人會死亡，而你會回到你排隊的確切位置。Protect Yumi 是在它自己的迷宮中進行，而不是在 Coliseum 的鬥坑裡。

- **1v1 與 2v2 排名天梯**，各有一個持久化的 Elo 式評分與一份歷來排行榜。
- **2v2 Fiesta**，一種更熱鬧的小隊模式：各隊競相達成擊倒目標，增益拾取提供力量，而一個收束的圈會迫使戰鬥聚到一起。
- **Protect Yumi**，一種不計分的 3v3 與 5v5 目標制模式，在一座迷宮中進行：每隊守護一隻貓咪夥伴，同時設法擊倒對方的那一隻，因此護送與抓單比純粹的擊殺數更重要。

排名勝利與 Fiesta 擊倒會支付 **Honor**，城鎮裡的軍需官可以用它換取一套 Warfare 裝備。Warfare 是一種僅限 PvP 的屬性，因此這套裝備能贏得決鬥，卻永遠不會在 PvE 中超越同階的副本掉落。

### 一起遊玩

- **Dungeon Finder**：用 `Shift+I` 開啟，可以瀏覽副本與團隊本、查看王與掉落、加入自動的坦克/治療/輸出角色隊列，或建立一則預組隊列表。由 Finder 組成的隊伍仍然要一起前往入口。
- **隊伍**最多 5 人，滿員後可轉換成由兩個小隊組成的 10 人團隊：右鍵點擊一名玩家並 Invite to Party。成員共享採集權與任務進度，依經典時代的組隊加成分配經驗，並在小地圖上顯示為光點。`/p` 用於隊伍聊天，`/roll` 用於決定戰利品歸屬。
- **交易**：右鍵點擊並 Trade。雙方擺上物品與金錢，雙方都必須接受，交換是原子化且由伺服器驗證的。任務物品無法交易，走遠則取消。
- **決鬥**：右鍵點擊並 Challenge to a Duel。倒數 3 秒，然後戰至一方達 1 hp；勝者會在全區公告，而跑離 60 碼即判定棄權。
- **採集權與離開狀態**：第一個對怪物造成傷害的玩家擁有其戰利品、經驗與任務進度；`/afk` 與 `/dnd` 把你標記為離開，並對密語自動回覆。

### 世界與系統

- **專業**（`Shift+P`）：四種採集專業（採礦、伐木、草藥學、釣魚）供養十種製作專業，從烹飪與煉金到武器製作、珠寶加工與附魔。採集工具分級，決定你能開採哪些資源點；製作在城鎮工作站進行，有機會產出帶有你製作者印記的傑作品質，還有一套等你在專精過程中發掘的原型系統。
- **The World Market**：一個玩家驅動的拍賣場，交易裝備、材料與消耗品，可從樞紐城鎮瀏覽。
- **Ravenpost 郵件**：把物品與金錢寄給其他角色，附件會被安全保管到領取為止。
- **公會**：憲章、成員名冊、階級與公會聊天。
- **The Guide**：位於 `/wiki` 的站內可搜尋百科，涵蓋職業、生物、區域與 deeds，直接由即時遊戲內容生成，因此不會與它所記載的世界脫節。
- **The Vale Cup 與 Card Duel**：在 Eastbrook 南方 Sowfield 球場舉行的 boarball，賽制從 1v1 到 5v5，以及由城鎮中的 Card Master 主持的快節奏一對一卡牌遊戲。
- **Daily Rewards**：已驗證的 $WOC 持有者可以透過每日轉盤與輪替任務賺取排行榜點數，並自動從每日獎池獲得派彩。
- **WOC Store 與 Season 1 Armory**：以法幣、SOL、USDC 或 $WOC 購買 Claudium，再把它花在純裝飾性的武器外觀上。
- **進食與飲水**：坐下以恢復，受到傷害或站起會中斷，而且沒錯，你可以同時進食與飲水。
- **商人**會收購食物與水，並販售貨真價實的白色裝備，金錢以金、銀、銅顯示。
- **個人銀行**（the Gilded Strongbox）：每座樞紐城鎮的錢莊管事為每個角色保管一個金庫，從 24 格起，可用金錢擴充到 96 格，另有透過已驗證電子郵件、連結帳號與推薦在線上取得的額外格數。
- **The Book of Deeds**：一部成就日誌（預設 `Shift+Z`），記錄任務、擊殺、通關與各種樂事，發放可佩戴在名條上、聊天中與排行榜上的裝飾性頭銜，外加一個追蹤你正在追求的 deeds 的 HUD 追蹤器、由 Chronicler NPC 保管的各區域 Chronicles，以及一份歷來 Renown 排行榜；公開清單位於 `/wiki/deeds`。
- **怪物 AI**：遊蕩、依等級差的接近仇恨、社交拉怪、追擊、脫離與重置、屍體拾取與重生，還有一隻長計時器的稀有刷新怪（Old Greyjaw）。
- **釣魚**點各有自己的戰利品表與稀有漁獲。
- **裝飾外觀**以優良、稀有與史詩三種品質擲出，純粹用於外觀。
- **死亡與復原**：將靈魂釋放到墓地、承受墜落傷害，並在游泳時減速。
- **生態天氣**：Vale 晴朗、Marsh 下雨、Peaks 飄雪，在你於各區域之間移動時交叉淡化。

### 操作（經典配置）

| 輸入 | 動作 |
|---|---|
| `W` / `S` | 前進 / 後退。`A`/`D` 轉向（按住右鍵則平移），`Q`/`E` 平移 |
| 右鍵拖曳 / 左鍵拖曳 | 滑鼠視角 / 環繞攝影機。滾輪縮放，`Space` 跳躍 |
| `Tab` | 循環選取最近的敵人。左鍵選目標，右鍵攻擊、拾取或交談 |
| `1`-`9`、`0`、`-`、`=` | 動作列 |
| `F` | 互動（拾取屍體、撿起物件、交談） |
| `C` `P` `L` `M` `B` `N` `T` | 角色、法術書、任務日誌、世界地圖、背包、天賦、製作 |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | 競技場、好友與公會、排行榜、行事曆、Vale Cup、Dungeon Finder、專業、deeds |
| `Z` / `X` | 收起或拔出武器、表情輪盤 |
| `V` / `R` / `Esc` | 名條、自動奔跑、關閉最上層視窗（或開啟遊戲選單） |

每一個按鍵綁定都可以在按鍵設定面板中重新對應。觸控操作（一個移動搖桿、攝影機拖曳與螢幕上的動作按鈕）會在行動裝置上自動出現。

## 架構（一個 sim，三個宿主）

三個理念把整個專案凝聚在一起：

- **一個 sim，三個宿主。** 同一套 `src/sim/` 程式碼運行離線瀏覽器世界、連線伺服器與 RL 環境。行為在各處都必須完全一致，而那些測試正是為了保持這一點而存在。
- **`IWorld` 是唯一的接縫。** `IWorld` 以 `src/world_api/` 下逐一領域的切面介面定義，並由 `src/world_api.ts` 匯聚。離線的 `Sim` 在結構上滿足它，而連線的 `ClientWorld` 透過鏡像伺服器快照來實作它。渲染器與 HUD 只與 `IWorld` 對話，從不與某個具體世界對話，因此一項新功能會先擴充對應的切面，然後再讓兩個世界實作。
- **伺服器具有權威性。** 客戶端傳送意圖；伺服器決定結果。客戶端從不自行解算戰鬥、戰利品或經濟。

sim 是固定的 20 Hz tick（`DT = 1/20`），所有隨機性都流經一個帶種子的 `Rng`，而 `src/sim/` 不含任何 DOM、瀏覽器或 Three.js 匯入。正是這一點讓同一套程式碼能夠不改一行就打包成一個 Node 環境伺服器、一個權威遊戲迴圈與一個瀏覽器分頁。

### 專案結構

| 路徑 | 它是什麼 |
|---|---|
| `src/sim/` | 確定性遊戲核心，真相的來源。不依賴 DOM 或 Three。 |
| `src/sim/content/` | 資料即程式碼：九個職業、技能、區域、副本、delves、物品、配方、附魔、天賦、專業、deeds。 |
| `src/world_api.ts` + `src/world_api/` | `IWorld`，渲染器與 HUD 所依賴的接縫：每個領域一個切面介面。 |
| `src/`（其餘） | Three.js 渲染器、HUD 與樣式、輸入/音訊、連線鏡像，以及管理、Guide 與編輯器 SPA。 |
| `server/` | 權威伺服器：HTTP 與 WS、世界迴圈、Postgres、驗證、社交、審核。 |
| `server/http/` | REST 請求管線：表格式路由器、中介層，以及逐一領域的路由定義。 |
| `headless/` + `python/` | RL 環境伺服器（`env_server.ts`）與 Python Gym 綁定。 |
| `bot/` | Discord 機器人（角色、轉播、動態消息）。 |
| `electron/`、`android/`、`ios/` | 桌面（Steam）與原生行動外殼。 |
| `tests/` | Vitest 測試套件。 |
| `scripts/` | 建置、素材、i18n、SFX、截圖與瀏覽器 E2E 工具。 |
| `deploy/` · `mediawiki/` | 生產環境首次啟動素材與玩家百科容器。 |
| `public/` · `docs/` | 靜態素材（逐字部署到網站）與設計文件。 |

這些都不是靠自律維持的：`tests/architecture.test.ts` 會掃描每一個 sim 檔案，尋找被禁止的匯入、DOM 全域變數，或走漏的時鐘與 `Math.random` 呼叫，而
`tests/world_api_parity.test.ts` 則釘住那道接縫，讓兩個世界無法脫節。

大多數目錄都帶有自己的 `CLAUDE.md`，記載在地慣例，而完整的專案不變量集合位於根目錄的
[`CLAUDE.md`](../../CLAUDE.md)。代理貢獻者從那裡開始，再取用自己運行環境的入口：Codex 用
[`AGENTS.md`](../../AGENTS.md) 外加 [Codex 操作指南](../codex.md)，Gemini 用
[`GEMINI.md`](../../GEMINI.md)。它們全都導向同一套標準架構。

## 像經典那樣打造

戰鬥、升級與威脅全都建立在真正的經典時代規則上：怒氣與能量、命中與閃避表、護甲減免、真實的經驗曲線、揮擊計時器與全域冷卻。它的手感如你記憶中那般，而不是去近似它。確切的數值就放在 `src/sim/` 裡，想看就能去讀。

這個世界是以程式碼撰寫，而非在 3D 編輯器中製作，正是這一點讓它保持小巧、
確定，並且容易 fork：

- 地形、水、天氣、天空、城鎮布局、即時陰影與戰鬥特效，都在執行時從 sim 自己的資料生成。
- 隨包附帶的模型也以同樣方式產出：`scripts/assets/` 下的程序化工廠透過專案的 image-to-GLB 流程匯出確定性的 GLB，旁邊還有一套精選的 CC0 模型套件庫。綁定骨架的生物與角色家族具備完整的行走、攻擊、施法、坐下與死亡動畫。
- 圖示由一套分層繪製器組成，能為任何沒有現成檔案的東西合成美術，所以永遠不會有東西缺圖示，並在其上疊加為技能、物品與 deeds 精心繪製的美術。
- 一套完整的經典 HUD（單位框、動作列、提示框、任務日誌、世界地圖、小地圖、浮動戰鬥文字、the Book of Deeds）、取樣的空間與介面音效，以及一份在倉庫內程序化譜寫、以串流重製版發布的原聲帶，會在區域、城鎮、副本與戰鬥之間交叉淡化。

每一件隨包發布的素材及其授權都記載在 [CREDITS.md](../../CREDITS.md) 中，而隨包附帶的
第三方相依套件則在 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) 中附上各自的聲明。

## 開發

除了遊戲客戶端之外，這套建置還會產出營運儀表板、位於 `/editor` 的世界編輯器，
以及位於 `/wiki` 的公開 Guide，全都由同一個開發伺服器提供。

閘門與音訊測試所走的每一條 FFmpeg 路徑，都解析到隨包附帶的
`ffmpeg-static`/`ffprobe-static` npm 套件，因此一般的貢獻不需要安裝系統層級的
FFmpeg。測量一致性的路徑（`npm run sfx:check`、音訊測試、Studio 的匯出驗證）
會直接綁定到那些靜態執行檔，沒有 `PATH` 備援：如果某次跳過 scripts 的安裝讓它們缺席，
請重新執行 `npm ci`。Studio 的播放與編碼行程，以及 `npm run gate` 的前置檢查，會透過
`scripts/sfx/ffmpeg_paths.mjs` 解析，而它確實會退回 `PATH`。有些獨立的音訊生成腳本
（例如 `scripts/gen_ui_sfx.mjs`）仍然預設使用 `PATH` 上的 `ffmpeg`。

```bash
npm test                        # vitest: formulas, combat, AI, quests, all 9 classes, parties, duels, trades, dungeons
npm run gate                    # complete CI-equivalent contribution gate
npm run build                   # production web build
npm run sfx:studio              # local SFX authoring, runtime mix, and production export
node scripts/smoke_browser.mjs  # warrior end-to-end (needs npm run dev)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure and drink, death and release
node scripts/visual_tour.mjs    # screenshot tour of the zone and UI into tmp/
node scripts/tour_temple.mjs    # screenshot tour of the Glimmermere and Drowned Temple into tmp/
node scripts/mp_integration.mjs # API, WS, and persistence checks (server running)
node scripts/social_e2e.mjs     # trade and duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue and fight a ranked 1v1
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

邏輯與單元測試使用 Vitest。在反覆迭代時，請只跑單一檔案：`npx vitest run tests/sim.test.ts`。介面變更另有一套可選用的真實瀏覽器測試套件，涵蓋無障礙、鍵盤導覽與觸控目標：`npm run test:browser`。截圖與冒煙腳本透過 `puppeteer-core` 驅動真正的瀏覽器，需要 `npm run dev` 運行中；線路層級的腳本（`mp_integration.mjs`、`social_e2e.mjs`、`crypt_raid.mjs`）則直接與伺服器對話，需要的是 `npm run server`。瀏覽器代理可以透過 `window.__game.controller` 驅動移動，而不必模擬按住按鍵，例如 `controller.move({ forward: true }, facingRadians)` 或像 `{ f: 1, sr: 1 }` 這樣的精簡旗標。

檢查是分層執行的，說明見 [docs/qa-gate.md](../qa-gate.md)：用
`git config core.hooksPath .githooks` 讓你的複本指向共用的 hooks，
在任何東西離開你的機器之前就會先跑過一道快速的底線檢查。

伺服器指令請見上方的[連線開發](#develop-online-with-hot-reload)，貢獻流程請見
[CONTRIBUTING.zh_TW.md](CONTRIBUTING.zh_TW.md)，音效製作與產出匯出請見
[SFX Studio 教學](../sfx-studio-tutorial.md)，生產相關請見 [DEPLOY.md](../../DEPLOY.md)，
素材授權請見 [CREDITS.md](../../CREDITS.md)。

## 本地化

每一個玩家可見的字串都透過 `t()` 解析，而遊戲提供 **22 種語系**（英文、兩種西班牙文、兩種法文、加拿大英文、義大利文、德文、簡體與繁體中文、韓文、日文、巴西葡萄牙文、俄文、捷克文、荷蘭文、波蘭文、印尼文、土耳其文、瑞典文、越南文與丹麥文）。sim 與伺服器保持語言無關：它們發送穩定的鍵值，或發送由客戶端在邊界處重新本地化的英文，這讓確定性得以完整保持。貢獻者只新增英文；維護者會在每次發布前批次填入其他語系。此工作流程的說明文件位於 `docs/i18n-scaling/translation-workflow.md`。

## 參與貢獻

歡迎各式各樣的貢獻：程式碼、翻譯、錯誤回報與文件。先從 [CONTRIBUTING.zh_TW.md](CONTRIBUTING.zh_TW.md) 開始進行設定，閱讀[行為準則](../../CODE_OF_CONDUCT.md)，並在回報漏洞前查看 [SECURITY.md](../../SECURITY.md)。新來的嗎？找找標記為 [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue) 的議題，開一個[議題](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)，或在 [Discord](https://discord.com/invite/worldofclaudecraft) 上打聲招呼。

活躍開發在最新的 `release/vX.Y.Z` 分支上進行。請自行查出那一條，不要憑臆測，然後從它開出你的分支，並讓你的拉取請求以它為目標。切勿從 `main` 開分支或以它為目標，`main` 只會在某個版本正式發布時才接收該發布分支。[CONTRIBUTING.md](CONTRIBUTING.zh_TW.md) 附有一行指令，可以找出目前最新的那一條。

## 授權

**程式碼採用 [MIT 授權](../../LICENSE)，所以儘管去 fork 它、改作它，並架設你自己的世界。** 這正是整件事的重點，本頁或我們網站上的其他內容都不會把它收回去。

有三樣東西是分開授權的，所以值得花三十秒搞清楚哪個是哪個：

| 是什麼 | 授權 | 可以再散布嗎？ |
|---|---|---|
| **原始碼**，意指除了下方劃分出來的媒體素材以外的全部內容 | [MIT](../../LICENSE) | 可以。商業用途也可以。 |
| **媒體素材**：模型、貼圖、HDRI、圖示、音效、字型（大多位於 `public/` 之下） | 逐一素材而定，記載於 [CREDITS.md](../../CREDITS.md) | 大多可以（大部分是 CC0）。有些不行，見下方。 |
| **名稱與品牌**：「World of ClaudeCraft」、「Levy Street」、標誌 | 未授權 | 不行。 |

**去 fork 它，架設你自己的世界。那是行得通的，素材也不會擋你的路。** 你看到的東西大多是 CC0 公有領域（KayKit、Quaternius、Kenney、ambientCG、Poly Haven），而我們自己生成的道具、生物、背景與介面音效都隨專案一起發布，因此 fork 之後開箱即可運行。你只是不能把那些東西抽出來，當成獨立的美術作品販售。

在再散布之前，你需要移除或替換的東西：

- `public/ui/skills/` 下的 **CraftPix 職業技能圖示**由 Levy Street 購買，**不得再散布**，若你想隨包發布，請自行購買授權；
- **@jamiecypher 的音效**採用 CC BY-NC 4.0，因此可以在標註來源的前提下非商業分享，但商業授權僅及於本專案；
- **商店與威望美術**（Season 1 Armory、Claudium 套組、專業美術集、Book of Deeds 圖示、精英巨龍徽記）是委託製作的商業美術，**權利保留**；
- **第三方品牌標誌**（Twitch、X、Kick、YouTube、Discord、Solana、USDC）是各自所有者的商標，不是我們能轉授的；
- 少數**經許可使用的圖示與錄音**需要取得許可才能轉交他人。

[CREDITS.md](../../CREDITS.md) 是權威清單，並為每一件素材列出再散布欄位。凡是列在那裡的素材，其授權優先於本專案的 MIT 授權。那份登錄表仍在補齊中，所以一件未列於其中的媒體素材是尚未記錄，而非可自由使用：在依賴它之前請先詢問。原始碼則相反，凡是未被劃分出去的內容都是 MIT。

我們的[服務條款](https://worldofclaudecraft.com/terms)涵蓋我們在 worldofclaudecraft.com 上運營的託管遊戲：帳號、行為規範、虛擬物品。它們不會限制 MIT 授權在這份原始碼上賦予你的權利。
