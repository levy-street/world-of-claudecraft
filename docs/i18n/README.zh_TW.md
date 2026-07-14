<div align="center">

# World of ClaudeCraft

**在瀏覽器中免費探索一個純手工打造的世界：接任務、組隊、打團。開放原始碼、web3，現在就能上線遊玩。**

**官方網站：https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.25.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.zh_TW.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/GjhnUsBtw)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · **繁體中文** · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[立即遊玩](https://worldofclaudecraft.com/) · [架設你自己的世界](#host-your-own-world-one-command) · [訓練一個代理](#train-an-agent-headless-rl) · [Web3](#web3) · [參與貢獻](CONTRIBUTING.zh_TW.md) · [Discord](https://discord.gg/GjhnUsBtw)

![World of ClaudeCraft 標題畫面](../../docs/screenshots/title-screen.jpg)

</div>

## 這是什麼

World of ClaudeCraft 是一款完整的經典時代 MMO，你現在就能直接在瀏覽器裡遊玩，用一行指令自行架設，甚至還能訓練 AI 代理來遊玩。它免費、開放原始碼，並在 [worldofclaudecraft.com](https://worldofclaudecraft.com/) 上線運作中。

同一個共用世界在三個地方運行，全都來自同一套遊戲核心：

- **離線瀏覽器世界**，點擊 Play Offline 就能直接進入，
- **權威多人伺服器**，由 Postgres 支撐的帳號共享同一個即時世界，
- **無頭 RL 環境**，Python 透過 Gym 介面驅動真正的遊戲。

無論在哪裡，相同的種子就會產生相同的世界。而且幾乎沒有任何隨包附帶的素材：城鎮、生物、法術圖示與音效全都在執行時生成。

## 重點特色

- **九個經典職業**，每個都擁有真正的傳統風格技能組，會隨等級提升而升階，外加完整的**天賦系統**（每個職業三個專精，共 27 個專精）。
- **三個開放世界區域**，從 1 級到 20 級，將近 80 個任務，以及一條圍繞 Gravecaller 陰謀的連貫劇情主線。
- **五個副本實例**，其中四個是五人精英團，一個是單人地穴，具備精英等級縮放、AoE 王機制與職業原型專屬掉落。
- **可縮放的 delves**，一種供一到兩名玩家加上一個 AI 同伴的小隊模式，每次進入都會從隨機房間重新組建，分為 Normal 與 Heroic 兩種難度。
- **the Ashen Coliseum**，一個排名制 PvP 競技場，提供 1v1 與 2v2 天梯，外加 2v2 Fiesta 模式（拾取增益、不斷縮小的圈、率先達成十五次擊殺者獲勝）。
- **真正的多人遊戲**：隊伍、交易、決鬥、採集權、隊伍分配經驗、密語、離開狀態，以及一個掌管每一次戰鬥擲骰的伺服器。
- **一切皆程序生成**：木構架城鎮、綁定骨架的生物家族、在畫布上繪製的法術圖示、WebAudio 音效、生態天氣與即時陰影。世界裡沒有任何 3D 模型檔案。
- **本地化為 21 種語系**，透過一條確定性的、由 sim 發送鍵值的流程完成。
- **無頭 RL 環境**，附帶 Gymnasium 綁定、獎勵塑形與基準測試模式。
- **原生 web3**：連結一個 Solana 錢包即可顯示你的 $WOC 餘額與一枚裝飾性持有者徽章，完全可選且非託管。

## 螢幕截圖

![一支隊伍聚集在 Eastbrook 藥劑師店外](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Eastbrook 營火旁的黃昏](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Eastbrook 營火旁的黃昏* | ![the Hollow Crypt 中的精英拉怪](../../docs/screenshots/hollow-crypt.jpg)<br>*the Hollow Crypt 中火把照明下的精英拉怪* |
| ![荒廢禮拜堂的不安亡者](../../docs/screenshots/restless-dead.jpg)<br>*荒廢禮拜堂的不安亡者* | ![與 Vale Bandits 的混戰](../../docs/screenshots/vale-bandits.jpg)<br>*在盜匪營地寡不敵眾* |
| ![Old Greyjaw 在北方道路上被追殺](../../docs/screenshots/old-greyjaw.jpg)<br>*稀有刷新怪 Old Greyjaw，在北方道路上被追殺* | ![商人與背包介面](../../docs/screenshots/vendor-and-bags.jpg)<br>*在 Smith Haldren 處整備裝備，附帶提示框、背包與金錢* |
| ![Glimmermere 岸邊的月門](../../docs/screenshots/glimmermere-moongate.jpg)<br>*溺亡者從 Glimmermere 月門爬出* | ![the Drowned Temple 祭壇上的 Ysolei](../../docs/screenshots/drowned-temple-altar.jpg)<br>*月炎與 the Drowned Temple 的祭壇* |

天氣由生態驅動且僅作渲染用途，因此永遠不會觸及確定性的 sim：

| | | |
|:---:|:---:|:---:|
| ![Eastbrook Vale 上空的晴朗天空](../../docs/screenshots/weather-vale_clear.jpg)<br>*Vale 上空的晴朗* | ![Mirefen Marsh 上空的雨](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mirefen Marsh 上空的雨* | ![Thornpeak Heights 上的雪](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Thornpeak Heights 上的雪* |

## 開始遊玩

你有兩種進入方式，而它們運行的是同一個世界。

### 離線，在你的瀏覽器中

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

為你的角色命名，從九個職業中任選一個，你就會從 **Eastbrook Vale**（1 到 7 級）出發，這是一座被六個樞紐環繞的集市城鎮：北邊是狼群出沒處，東邊是野豬草甸，西邊是 the Webwood，西北是 Mirror Lake，西南是狗頭人銅礦坑，東北是一座住著不安亡者的荒廢禮拜堂，東南則有 Gorrak 的盜匪營地。北方道路爬上一處山口，通往 **Mirefen Marsh**（6 到 13 級，樞紐 Fenbridge），再往上到 **Thornpeak Heights**（13 到 20 級，樞紐 Highwatch）。世界種子固定寫在 `src/main.ts` 裡，所以每次造訪都是同一個地方。

### 連線，與其他玩家一起

請見下方的[架設你自己的世界](#host-your-own-world-one-command)，搭建起具備帳號與持久化角色的真正客戶端/伺服器遊戲。

<a id="host-your-own-world-one-command"></a>

## 架設你自己的世界（一行指令）

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

若要**遠端架設**，把這套 compose 堆疊放到任意 VPS 上，在環境中設定一個真正的 `POSTGRES_PASSWORD`，並用一個 TLS 反向代理擋在 8787 連接埠前面。用 Caddy 只需兩行（`your.domain { reverse_proxy localhost:8787 }`）；WebSockets 會自動被代理，客戶端在 https 頁面上會自動選用 `wss://`。驗證端點按 IP 做速率限制，密碼以 scrypt 雜湊，權杖在 7 天後過期。切勿在生產環境中設定 `ALLOW_DEV_COMMANDS=1`，因為它會啟用測試機器人所用的等級與傳送作弊。完整的生產指南請見 [DEPLOY.md](../../DEPLOY.md)。

<a id="develop-online-with-hot-reload"></a>

### 帶熱重載的連線開發

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

開啟 http://localhost:5173，選擇 **Play Online**，建立帳號，建立角色，然後 Enter World。開啟第二個分頁再次登入，就能在城鎮裡看到彼此。`Enter` 開啟聊天。一個真正的 MediaWiki 玩家百科會隨 Docker Compose 堆疊一起啟動，位於 http://localhost:8080/wiki/；它的初始頁面由當前遊戲內容透過 `npm run wiki:seed` 生成。

哪些東西會被持久化，以及伺服器如何保持主導權：

- **帳號**：scrypt 雜湊的密碼與 7 天有效的 bearer 權杖（`auth_tokens`）。
- **角色**：每個帳號最多 10 個；等級、裝備、背包、任務、天賦、位置與金錢以 JSONB 形式持久化在 Postgres 裡，每 30 秒、登出時以及伺服器關閉時都會儲存。名稱全域唯一、僅限字母、經典風格。
- **伺服器具有權威性**：客戶端以 20 Hz 串流移動意圖與指令；伺服器運行那一個共用的 `Sim`，並回傳興趣範圍內（約 120 yd）的快照外加各玩家專屬事件。每一次戰鬥擲骰、戰利品掉落、任務進度與商人交易都在伺服器端解算。客戶端只是一個渲染器。

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **觀測空間與動作空間皆由內容衍生。** 啟動時請從環境的 `info` 回覆查詢，而不要寫死；它們會隨遊戲一起成長。如今動作空間是 `Discrete(44)`（移動、選目標、攻擊、完整技能組、互動、進食/飲水），觀測則是一個包含 276 個浮點數的 `Box`（自身、技能、目標、附近怪物、最近的可互動物、任務進度）。
- **獎勵**是每一 tick 計數器差值（經驗、造成與承受的傷害、擊殺、死亡、任務進度、升級）的加權總和，每次重置時可調。每個 `step` 套用一個動作並預設推進五個 sim tick，因此大約每個模擬秒做出四個決策。
- **本質上即確定性。** 沒有牆上時鐘，沒有 `Math.random`。為 reset 設定種子，整局就會精確地重播。

協議與綁定的說明文件位於 `headless/CLAUDE.md` 與 `python/CLAUDE.md`。

<a id="web3"></a>

## Web3

World of ClaudeCraft 圍繞 **$WOC**（我們在 Solana 上的社群代幣）打造原生 web3 體驗。連結一個 Solana 錢包，用一次簽署把它連結到你的帳號（非託管，無需核准任何交易），你那唯讀的 $WOC 餘額就會顯示在 HUD 上，旁邊還有一枚裝飾性的持有者等級徽章。

它純屬裝飾，遊玩並不需要。遊戲內不會花費或賺取任何東西，沒有付費致勝，整款遊戲在完全不連結錢包的情況下也能順暢遊玩。

**$WOC 合約位址（Solana）：**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

關於代幣的更多資訊請見 [worldofclaudecraft.com](https://worldofclaudecraft.com/)。

## 世界巡禮

### 九個職業

每個職業都使用真正的傳統風格機制，並在 1 到 20 級期間學習升階法術（Lightning Bolt R2 於 8 級，R3 於 14 級，R4 於 20 級，而像 Execute、Kidney Shot、Flash Heal、Stormstrike 與 Starfire 這類高段位技能會在其經典等級獲得）。

- **Warrior**：怒氣、Heroic Strike（下一次揮擊觸發、不佔 GCD）、Battle Shout、Charge、Rend、Thunder Clap、Hamstring、Bloodrage、Overpower（閃避觸發）。
- **Paladin**：由 Judgement 釋放的 Seal of Righteousness、Holy Light、Devotion Aura、Blessing of Might、Divine Protection（吸收）、Hammer of Justice（昏迷）、Lay on Hands。
- **Hunter**：遠程 Auto Shot（8 到 35 yd，帶經典的死區）、Raptor Strike、Aspect of the Hawk、Serpent Sting、Arcane Shot、Concussive Shot、Mongoose Bite、Wing Clip，並可從 10 級起馴服一隻寵物。
- **Rogue**：能量與連擊點、Sinister Strike、Eviscerate、Backstab（背後、匕首）、Gouge、Evasion、Slice and Dice、Sprint。
- **Priest**：Smite、Lesser Heal、Power Word: Fortitude、Shadow Word: Pain、Power Word: Shield（吸收）、Renew（HoT）、Mind Blast。
- **Shaman**：Lightning Bolt、Rockbiter Weapon（附魔）、Healing Wave、Earth Shock、Lightning Shield（荊棘）、Flame Shock。
- **Mage**：Fireball、Frost Armor、Arcane Intellect、Frostbolt、Conjure Water、Fire Blast、Arcane Missiles（引導）、Polymorph、Frost Nova。
- **Warlock**：Shadow Bolt、Demon Skin、Immolate、Corruption、Life Tap、Curse of Agony、Drain Life，以及從 Imp 到 Doomguard 共七種可召喚的惡魔。
- **Druid**：Wrath、Healing Touch、Mark of the Wild、Moonfire、Rejuvenation、Thorns、Entangling Roots，並於 10 級獲得 Bear Form。

治療與增益會作用在隊伍成員身上，治療可以爆擊，吸收護盾會在血量之前承受傷害。把點數分配到**每個職業的三個天賦專精**（Arms/Fury/Protection、Balance/Feral/Restoration 等等）；分配由伺服器驗證，並可匯出成一串配點字串。

### 副本

Gravecaller 劇情線貫穿四個五人精英實例，另有一個單人地穴供探索者在一旁深入。

- **the Hollow Crypt**（5 人），位於 the Fallen Chapel 之下：成對的精英雜兵、Sexton Marrow 小王，以及 Morthen the Gravecaller，他每十秒釋放一次 Shadow Pulse AoE。地穴門會把你的隊伍傳送進一個私人實例副本，空置五分鐘後重置。
- **the Sunken Bastion**（5 人，約 13 級，Mirefen 東南）：Vael the Mistcaller 會在血量 60% 與 30% 時召喚一波波 Drowned Thralls。
- **Gravewyrm Sanctum**（5 人，20 級，Thornpeak 之下）：三間滿是精英 boneguard 與 drakonid 的房間、Korgath the Bound（血量低於 30% 時狂暴）、Grand Necromancer Velkhar，以及掉落史詩武器的 Korzul the Gravewyrm。
- **the Drowned Temple**（5 人），穿過 Glimmermere 月門：一個慘白、月色紫羅蘭的實例，通往 Choirmother Selthe，接著是 Ysolei, Avatar of the Drowned Moon，她每九秒搏動一次 Lunar Tide，並在 60% 與 30% 時召喚 Moonspawn。
- **the Abandoned Crypt**（單人），位於 Thornpeak：一場安靜的拱心石與日記探索，供一人進行，其線索會解封通往 **Nythraxis, Scourge of Thornpeak** 的皇家之門，這是一場橫跨三塊靈魂守護石的十人團隊終局戰。

前置任務鏈都可單人完成，所以劇情永遠不會被「得先找到隊伍」所阻擋。我們的自動化五機器人團隊（warrior、paladin、priest、mage、hunter，具備集火與治療 AI）大約五分鐘就能清掉 the Hollow Crypt（`node scripts/crypt_raid.mjs`，需要 `ALLOW_DEV_COMMANDS=1`）。

### Delves

Delves 是一種獨立、可縮放的小隊模式，供一到兩名玩家進行。**The Collapsed Reliquary**（7 級以上）是一座每次進入都會從隨機房間重新組建的地穴，終點為 Deacon Varric。單人挑戰時，一個 AI 同伴 Tessa 會在你身邊作戰。聖物廢墟處的 Brother Halven 主持 delve 看板，Normal 或 Heroic 由你決定：Heroic 會提升敵人等級並加上一個隨機詞綴，以換取更豐厚的獎勵。

### the Ashen Coliseum（排名制 PvP）

按 `G` 或競技場按鈕排隊。配對系統會把鬥士傳送進一個私人的、火把照明的鬥坑，一段短暫倒數會治療並重置所有人以求公平開局，當一方在 1 hp 認輸時對戰結束。沒有人會死亡，而你會回到你排隊的確切位置。

- **1v1 與 2v2 排名天梯**，各有一個持久化的 Elo 式評分（所有人從 1500 起算）以及一個歷來排行榜（`GET /api/arena/leaderboard`）。
- **2v2 Fiesta**，一種更熱鬧的小隊模式：在六分鐘上限內，率先達成十五次擊殺的隊伍獲勝，玩家以遞增的計時器復活，增益拾取在三波中散落各處提供力量，而一個收束的圈會迫使戰鬥聚到一起。

### 一起遊玩

- **隊伍**最多 5 人：右鍵點擊一名玩家並 Invite to Party。成員共享採集權與任務進度，依真正的傳統組隊加成分配經驗（3/4/5 人為 1.166 / 1.3 / 1.43），並在小地圖上顯示為光點。`/p` 用於隊伍聊天，`/roll` 用於決定戰利品歸屬。
- **交易**：右鍵點擊並 Trade。雙方擺上物品與金錢，雙方都必須接受，交換是原子化且由伺服器驗證的。任務物品無法交易，走遠則取消。
- **決鬥**：右鍵點擊並 Challenge to a Duel。倒數 3 秒，然後戰至一方達 1 hp；勝者會在全區公告，而跑離 60 碼即判定棄權。
- **採集權與離開狀態**：第一個對怪物造成傷害的玩家擁有其戰利品、經驗與任務進度；`/afk` 與 `/dnd` 把你標記為離開，並對密語自動回覆。

### 世界與系統

- **進食與飲水**：坐下以在 18 秒內恢復，受到傷害或站起會中斷，而且沒錯，你可以同時進食與飲水。
- **商人**會收購食物與水，並販售貨真價實的白色裝備，金錢以金、銀、銅顯示。
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
| `C` `P` `L` `M` `B` `G` | 角色、法術書、任務日誌、世界地圖、背包、競技場 |
| `V` / `R` / `Esc` | 名條、自動奔跑、關閉視窗或清除目標 |

觸控操作（一個移動搖桿、攝影機拖曳與螢幕上的動作按鈕）會在行動裝置上自動出現。

## 架構（一個 sim，三個宿主）

三個理念把整個專案凝聚在一起：

- **一個 sim，三個宿主。** 同一套 `src/sim/` 程式碼運行離線瀏覽器世界、連線伺服器與 RL 環境。行為在各處都必須完全一致，而那些測試正是為了保持這一點而存在。
- **`IWorld` 是唯一的接縫。** `src/world_api.ts` 定義了 `IWorld`。離線的 `Sim` 在結構上滿足它，而連線的 `ClientWorld` 透過鏡像伺服器快照來實作它。渲染器與 HUD 只與 `IWorld` 對話，從不與某個具體世界對話，因此一項新功能會先擴充介面，然後再讓兩個世界實作。
- **伺服器具有權威性。** 客戶端傳送意圖；伺服器決定結果。客戶端從不自行解算戰鬥、戰利品或經濟。

sim 是固定的 20 Hz tick（`DT = 1/20`），所有隨機性都流經一個帶種子的 `Rng`，而 `src/sim/` 不含任何 DOM、瀏覽器或 Three.js 匯入。正是這一點讓同一套程式碼能夠不改一行就打包成一個 Node 環境伺服器、一個權威遊戲迴圈與一個瀏覽器分頁。

### 專案結構

| 路徑 | 它是什麼 |
|---|---|
| `src/sim/` | 確定性遊戲核心，真相的來源。不依賴 DOM 或 Three。 |
| `src/sim/content/` | 資料即程式碼：九個職業、技能、區域、副本、物品、天賦。 |
| `src/render/` | Three.js 渲染器（程序生成的幾何、貼圖、VFX）。讀取世界，從不變更它。 |
| `src/game/` | 本地輸入、攝影機、按鍵綁定、行動裝置操作、程序化 WebAudio。 |
| `src/ui/` | 經典 HUD（框架、視窗、提示框、地圖、浮動戰鬥文字）、程序化圖示、i18n。 |
| `src/net/` | 連線客戶端：REST 驗證外加一個 WebSocket 世界鏡像（`ClientWorld`）。 |
| `src/admin/` | 管理儀表板 SPA（獨立的 `admin.html` 入口）。 |
| `server/` | 權威伺服器：HTTP 與 WS、世界迴圈、Postgres、驗證、社交、審核。 |
| `headless/` + `python/` | RL 環境伺服器（`env_server.ts`）與 Python Gym 綁定。 |
| `tests/` | Vitest 測試套件。 |
| `scripts/` | 素材建置外加瀏覽器 E2E、截圖與整合腳本。 |
| `public/` · `docs/` | 靜態素材（GLB 模型、貼圖、HDRI）與設計文件。 |

大多數目錄都帶有自己的 `CLAUDE.md`，記載在地慣例。完整的專案不變量集合位於根目錄的 [`CLAUDE.md`](../../CLAUDE.md)。

## 像經典那樣打造

戰鬥、升級與威脅全都建立在真正的經典時代規則上：怒氣與能量、命中與閃避表、護甲減免、真實的經驗曲線、揮擊計時器與全域冷卻。它的手感如你記憶中那般，而不是去近似它。確切的數值就放在 `src/sim/` 裡，想看就能去讀。

而且其中幾乎沒有任何隨包附帶的素材。世界是由程式碼繪製的：

- 程序生成的城鎮、生物、地形、水、天氣與即時陰影，世界裡沒有任何 3D 模型檔案。
- 十二個綁定骨架的生物家族，具備完整的行走、攻擊、施法、坐下與死亡動畫。
- 在執行時於畫布上繪製的法術、物品與增益圖示。
- 一套完整的經典 HUD（單位框、動作列、提示框、任務日誌、世界地圖、小地圖、浮動戰鬥文字），以及每一種音效的程序化 WebAudio。

## 開發

```bash
npm test                        # vitest: formulas, combat, AI, quests, all 9 classes, parties, duels, trades, dungeons
npm run build                   # production web build
node scripts/smoke_browser.mjs  # warrior end-to-end (needs npm run dev)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure and drink, death and release
node scripts/visual_tour.mjs    # screenshot tour of the zone and UI into tmp/
node scripts/tour_temple.mjs    # screenshot tour of the Glimmermere and Drowned Temple into tmp/
node scripts/mp_integration.mjs # API, WS, and persistence checks (server running)
node scripts/social_e2e.mjs     # trade and duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue and fight a ranked 1v1
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

邏輯與單元測試使用 Vitest。在反覆迭代時，請只跑單一檔案：`npx vitest run tests/sim.test.ts`。E2E 與視覺腳本透過 `puppeteer-core` 驅動真正的瀏覽器，需要 `npm run dev` 運行中（通常也要 `npm run server`）。瀏覽器代理可以透過 `window.__game.controller` 驅動移動，而不必模擬按住按鍵，例如 `controller.move({ forward: true }, facingRadians)` 或像 `{ f: 1, sr: 1 }` 這樣的精簡旗標。

伺服器指令請見上方的[連線開發](#develop-online-with-hot-reload)，生產相關請見 [DEPLOY.md](../../DEPLOY.md)，素材授權請見 [CREDITS.md](../../CREDITS.md)。

## 本地化

每一個玩家可見的字串都透過 `t()` 解析，而遊戲提供 **21 種語系**（英文、兩種西班牙文、兩種法文、加拿大英文、義大利文、德文、簡體與繁體中文、韓文、日文、巴西葡萄牙文、俄文、荷蘭文、波蘭文、印尼文、土耳其文、瑞典文、越南文與丹麥文）。sim 與伺服器保持語言無關：它們發送穩定的鍵值，或發送由客戶端在邊界處重新本地化的英文，這讓確定性得以完整保持。貢獻者只新增英文；維護者會在每次發布前批次填入其他語系。此工作流程的說明文件位於 `docs/i18n-scaling/translation-workflow.md`。

## 參與貢獻

歡迎各式各樣的貢獻：程式碼、翻譯、錯誤回報與文件。先從 [CONTRIBUTING.zh_TW.md](CONTRIBUTING.zh_TW.md) 開始進行設定，閱讀[行為準則](../../CODE_OF_CONDUCT.md)，並在回報漏洞前查看 [SECURITY.md](../../SECURITY.md)。新來的嗎？找找標記為 [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue) 的議題，開一個[議題](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)，或在 [Discord](https://discord.gg/GjhnUsBtw) 上打聲招呼。

<div align="center">

![World of Claude](../../worldofclaude.png)

![World of ClaudeCraft 社群](../../woc_community.png)

</div>

## 授權

程式碼採用 [MIT 授權](../../LICENSE)，所以儘管去 fork 它、改作它，並架設你自己的世界。

隨包附帶的第三方美術素材（模型、貼圖、HDRI）保有各自的授權，除了 MIT 授權的水面法線貼圖外全部為 CC0 公有領域，逐套記載於 [CREDITS.md](../../CREDITS.md)。
