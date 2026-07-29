<div align="center">

# World of ClaudeCraft

**在浏览器里免费畅玩一个纯手工打造的世界：做任务、组队、打团。开源、web3，现在就能在线游玩。**

**官方网站：https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.31.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.zh_CN.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · **简体中文** · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[立即游玩](https://worldofclaudecraft.com/) · [搭建你自己的世界](#host-your-own-world-one-command) · [训练智能体](#train-an-agent-headless-rl) · [Web3](#web3) · [参与贡献](CONTRIBUTING.zh_CN.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft 标题画面](../../docs/screenshots/title-screen.jpg)

</div>

## 这是什么

World of ClaudeCraft 是一款完整的经典时代 MMO：你现在就能在浏览器里直接游玩，用一条命令自行搭建，甚至还能训练 AI 智能体来玩它。它免费、开源，并已在 [worldofclaudecraft.com](https://worldofclaudecraft.com/) 上线运行。

同一个共享世界在三个地方运行，全部出自同一份游戏核心：

- **权威多人服务器**，也就是你在 worldofclaudecraft.com 上游玩的实时世界，由 Postgres 支撑的账号共享同一个持久化服务器，
- **离线浏览器世界**，一个来自开发服务器的本地单人 Sim，既方便开发，也方便从头到尾通读游戏核心，
- **无头 RL 环境**，Python 通过 Gym 接口驱动真正的游戏。

同样的种子，同样的世界，处处一致。你看到的大部分内容仍然是在运行时由代码绘制的，其余则是随项目一同发布的一套精选素材，因此 fork 出来即可直接运行。

## 亮点

- **九大经典职业**，每个都配有完整的经典时代风格技能组，并随等级提升解锁等级阶位，外加完整的**天赋系统**（每个职业三系专精，共 27 个专精）。
- **三大开放世界区域**，从 1 级到 20 级，90 多个任务，以及一条围绕 Gravecaller 阴谋展开、彼此相连的主线剧情。
- **五个副本**，其中四个是五人精英团队副本，另有一个单人地穴，配有精英缩放、范围 Boss 机制、可凑成套装的职业原型战利品，以及奖励更丰厚的**英雄难度层级**，此外还有开放世界的世界 Boss 和一场十人团队收尾战。
- **两个可缩放的 Delves**，一种供一到两名玩家加一个 AI 同伴的小队模式，每次进入都会从随机房间重新生成，分为普通和英雄两个层级。
- **排名制 PvP**，横跨两张竞技场地图：1v1 和 2v2 天梯、更热闹的 2v2 Fiesta 模式，以及 **Protect Yumi**，一种 3v3 和 5v5 的目标争夺模式。排名对局会奖励 Honor，可用来兑换一套仅限 PvP 的装备，它在 PvE 中永远不会盖过副本战利品。
- **The Vale Cup**，一个在 Eastbrook 以南自有球场里进行的 boarball 联赛，以及 **Card Duel**，一款在城里举办的快节奏一对一卡牌游戏。
- **Book of Deeds**：一本成就日志，收录装饰性称号、徽章边框和 Renown，各区域的 Chronicles 由世界中的 Chronicler NPC 保管，另有一份历史排行榜。
- **深度的专业技能经济**：四种采集职业供养十种制造职业，从烹饪、炼金到珠宝加工、武器锻造和附魔，配有分层工具、城镇工作台、大师品质和委托订单，全部汇入玩家驱动的 **World Market** 和 **Ravenpost** 邮寄服务。
- **真正的多人玩法**：队伍与团队、公会、交易、决斗、采集权、队伍经验分配、密语、离开状态，以及带有职责队列和预组列表的 **Dungeon Finder**。
- **用代码创作，而非在 3D 编辑器里**：地形、水体、天气、城镇布局、实时阴影和特效都在运行时生成，而随包发布的模型也由程序化工厂和一套精选素材库构建，并非手工雕刻。
- **本地化为 22 种语言**，通过一条确定性的、由 sim 发出键名的流水线实现。
- **`/wiki` 上的配套百科**，直接由实时游戏内容生成，因此绝不会与它所记录的世界脱节。
- **全平台原生应用**：面向 Windows、Linux 和 macOS 的已签名桌面安装包，支持自动更新和可选的 Steam 成就同步，另有 iOS 和 Android 构建，全部共用同一个浏览器客户端和同一个在线世界。
- **适配你手上的机器**：画面预设和自动帧率调节器会用视觉丰富度换取流畅度，并受一条公平性规则约束，绝不会隐藏任何玩家需要据以反应的信息。
- **无头 RL 环境**，提供 Gymnasium 绑定、奖励塑形和基准测试模式。
- **$WOC 效用完全可选**：链接一个 Solana 钱包即可获得持有者标识、Daily Rewards，以及装饰商店里的折扣付款方式。游戏始终免费游玩且非托管。
- **Season 1 Armory**：通过 WOC Store 收集装饰性武器皮肤，使用以法币、SOL、USDC 或 $WOC 购买的 Claudium。装饰品从不提供战斗力。

## 截图

![Eastbrook 镇广场、营火与任务发布者](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Eastbrook 营火旁的黄昏](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Eastbrook 营火旁的黄昏* | ![the Hollow Crypt 中的精英怪](../../docs/screenshots/hollow-crypt.jpg)<br>*the Hollow Crypt 中火把映照下的精英怪* |
| ![废弃礼拜堂里不安息的亡者](../../docs/screenshots/restless-dead.jpg)<br>*废弃礼拜堂里不安息的亡者* | ![与 Vale Bandits 的混战](../../docs/screenshots/vale-bandits.jpg)<br>*在强盗营地以寡敌众* |
| ![Old Greyjaw 在北路上被追击](../../docs/screenshots/old-greyjaw.jpg)<br>*稀有刷新怪 Old Greyjaw 在北路上被追杀* | ![商人与背包界面](../../docs/screenshots/vendor-and-bags.jpg)<br>*在 Trader Wilkes 处备战，商人与背包界面均已打开* |
| ![Glimmermere 岸边的月门](../../docs/screenshots/glimmermere-moongate.jpg)<br>*溺亡者从 Glimmermere 月门处爬出* | ![Ysolei 立于 the Drowned Temple 的祭坛上](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest 与 the Drowned Temple 的祭坛* |

天气由生物群系驱动，仅用于渲染，因此从不触及确定性的 sim：

| | | |
|:---:|:---:|:---:|
| ![Eastbrook Vale 上空晴朗](../../docs/screenshots/weather-vale_clear.jpg)<br>*Vale 上空晴朗* | ![Mirefen Marsh 上空降雨](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mirefen Marsh 上空降雨* | ![Thornpeak Heights 上的飞雪](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Thornpeak Heights 上的飞雪* |

## 开始游玩

在浏览器中访问 [worldofclaudecraft.com](https://worldofclaudecraft.com/) 即可游玩，也可以安装 Windows、Linux、macOS、iOS 或 Android 的原生应用。所有客户端连接的都是同一个在线世界。

### 在线，与其他玩家一起

创建一个账号，创建一个角色，然后进入实时世界。若想自行运行同一套客户端/服务器栈，请参阅下方的[搭建你自己的世界](#host-your-own-world-one-command)。

### 离线，在开发服务器里

离线模式是一个没有账号、也没有服务器权威的本地单人世界，因此只随开发构建发布。运行开发服务器，它就会出现在模式选择器中：

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

为你的角色命名，从九个职业中任选其一，你将从 **Eastbrook Vale**（1 至 7 级）开始，这是一座集市镇，四周环绕着各处据点：北面是狼群出没地，东面是野猪草甸，西面是 Sableweb 林地，西北是 Mirror Lake，西南是一处遍布掘地怪的铜矿坑，东北是一座栖息着不安息亡者的废弃礼拜堂，东南则是 Gorrak 的强盗营地。北路翻越一道山口进入 **Mirefen Marsh**（6 至 13 级，据点 Fenbridge），再向上通往 **Thornpeak Heights**（13 至 20 级，据点 Highwatch）。世界种子在 `src/main.ts` 中固定，所以每次造访都是同一个地方。

### 面向 Windows、Linux 和 macOS 的桌面应用

World of ClaudeCraft 以完整桌面应用的形式在三大主流桌面平台上发布：已签名的 Windows 安装包、Linux 的 AppImage 与 deb 包，以及经过签名和公证的 macOS 通用构建。它们使用与浏览器相同的游戏客户端和在线世界，并带有原生打包和自动更新。

在线登录只支持 Discord 和邮箱，与网页流程完全一致：邮箱/密码在应用内登录，而“使用 Discord 继续”会在你的默认浏览器中打开 `/desktop-login` 页面，该页面通过 `worldofclaudecraft://` 深度链接把一次性代码交回应用，应用再用它换取一个普通的 World of ClaudeCraft 会话令牌。

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

用 `VITE_DESKTOP_API_ORIGIN` 把外壳指向另一个 API，例如一台本地服务器或一台预发布主机：

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

为预发布构建覆盖生产 API 源，请使用 `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com`（这是一个构建时取值：它会被打进产物并写入打包后的应用，已安装的构建会忽略它作为运行时环境变量）。Steam 是一条分发渠道（同一个 Electron 产物，通过 SteamPipe 上传），桌面玩家可以链接一个 Steam 账号，把自己赚取的 deeds 同步为 Steam 成就；登录本身仍然只用邮箱和 Discord。完整的发布手册（签名、公证、发布自动更新、SteamPipe 仓库、服务器部署）见 `docs/desktop-release.md`。iOS 和 Android 通过 Capacitor 发布，有各自的手册 `docs/mobile-store-release.md`。

<a id="host-your-own-world-one-command"></a>

## 搭建你自己的世界（一条命令）

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

如需**远程托管**，把这套 compose 栈放到任意 VPS 上，在环境中设置一个真正的 `POSTGRES_PASSWORD`，并用一个 TLS 反向代理转发 8787 端口。用 Caddy 只需寥寥几行；WebSocket 会被自动代理，客户端在 https 页面上会自动选用 `wss://`。鉴权端点做了限流，密码用 scrypt 哈希，登录会话会过期。在生产环境中切勿设置 `ALLOW_DEV_COMMANDS=1`，因为它会启用完整的 `/dev` 作弊指令集：测试机器人所用的升级和传送作弊，外加物品发放、怪物生成、副本传送，以及游戏内的开发指令界面。[DEPLOY.md](../../DEPLOY.md) 是完整的生产指南，其中包括让健康检查和指标端点不暴露在公网边缘的反向代理配置。

<a id="develop-online-with-hot-reload"></a>

### 在线开发并热重载

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

打开 http://localhost:5173，选择 **Play Online**，创建一个账号，创建一个角色，然后 Enter World。角色选择界面会在 News & Updates 面板中显示最新的版本资讯，并为你尚未看过的条目标上 NEW 徽章。再打开第二个标签页重新登录，就能在城里看到彼此。`Enter` 打开聊天。玩家百科就是仓库内的 Guide，本地地址为 http://localhost:5173/wiki，生产环境中位于 `/wiki`；它的内容由 `npm run wiki:content` 从当前游戏数据生成。

哪些内容会持久化，以及服务器如何保持掌控：

- **账号**：scrypt 哈希的密码和会过期的承载令牌。
- **角色**：每个账号在每个服务器上最多 10 个；等级、装备、背包、银行金库、任务、天赋、专业技能、PvP 与 deed 进度、位置和金钱以 JSONB 形式持久化在 Postgres 中，按定时器、登出时以及服务器关闭时保存。名字在每个服务器内唯一，且为经典风格。
- **服务器是权威**：客户端以 20 Hz 流式发送移动意图和指令；服务器运行那一个共享的 `Sim`，并返回按兴趣范围裁剪的快照以及每位玩家的事件。每一次战斗判定、战利品掉落、任务记功和商人交易都在服务器端裁决。客户端只是一个渲染器。

<a id="train-an-agent-headless-rl"></a>

## 训练一个智能体（无头 RL）

同一份确定性核心可作为 [Gymnasium](https://gymnasium.farama.org/) 环境运行，所以智能体面对的是真实游戏本身，而非它的某种重新实现。环境服务器（`headless/env_server.ts`）包裹了一个 `Sim`，通过 stdio 以换行分隔的 JSON 通信；`python/` 中的 Python 绑定将其作为子进程启动，并暴露常见的 `reset` / `step` / `close` 循环。

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

- **观测空间和动作空间由内容推导而来。** 请在启动时从环境的 `info` 响应中查询，而不要硬编码；它们会随游戏一同增长。动作空间是一个 `Discrete`，涵盖移动、选取目标、攻击、完整的技能组、交互以及进食/饮水；观测则是一个 `Box`，涵盖自身、技能、目标、附近的怪物、最近的可交互物和任务进度。
- **奖励**是每个 tick 计数器增量的加权和（经验、造成和承受的伤害、击杀、死亡、任务进度、升级），可在每次 reset 时调参。每个 `step` 应用一个动作并默认推进五个 sim tick，因此大约每模拟一秒做四次决策。
- **构造上即确定性。** 没有挂钟时间，没有 `Math.random`。为 reset 设定种子，回合就会精确重放。

协议和绑定的文档见 `headless/CLAUDE.md` 和 `python/CLAUDE.md`。

<a id="web3"></a>

## Web3

World of ClaudeCraft 以 **$WOC**（我们在 Solana 上的社区代币）为核心，是 web3 原生的。连接一个 Solana 钱包，用一次签名把它链接到你的账号（非托管，无需批准任何交易），你只读的 $WOC 余额便会显示在 HUD 中，旁边还有一枚装饰性的持有者层级徽章。

$WOC 在实时游戏中也有可选的效用：

- **WOC Store**：用法币、SOL、USDC 或 $WOC 购买 Claudium，这是一种单向的装饰货币。$WOC 支付通道相较其他方式有折扣。
- **Season 1 Armory**：花费 Claudium 购买装饰性武器皮肤收藏。商店购买不会增加属性或战斗力。
- **Daily Rewards**：通过验证的合格持有者可以在每日抽奖和轮换任务中赚取积分，然后争夺每日奖池的一份。

这些都不是游玩所必需的。钱包链接是可选且非托管的，没有付费变强，整个游戏即便从不连接钱包也能正常游玩。

**$WOC 合约地址（Solana）：**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

关于代币的更多信息见 [worldofclaudecraft.com](https://worldofclaudecraft.com/)。

## 世界巡礼

### 九大职业

每个职业都跑在从第一性原理实现的经典时代 MMO 机制上，并在 1 至 20 级期间学习分等级阶位的法术，Low Blow、Early Grave、Skyfall、Urgent Prayer 和 Ancestral Strike 等标志性技能会在升级历程的后半段陆续解锁。

- **Warrior**：怒气、Iron Bellow、Onrush、Quaking Blow、Maiming Strike、Gaping Wounds（一种附着在你打击上的流血）、Widening Arc、Hobbling Cut、Blood Toll、Redhand（闪避触发）。
- **Paladin**：由 Verdict 释放的 Oathbrand、Mending Light、Steadfast Aura、Oath of Iron、Ward of Faith（吸收）、Sundering Gavel（眩晕）、Last Rite。
- **Hunter**：远程自动攻击（8 至 35 yd，带经典风格的近战盲区）、Gutting Strike、Harrier's Guise、Venom Barb、Fell Shot、Rattling Shot、Counterfang、Fettering Slash，以及从 10 级起可驯服的宠物。
- **Rogue**：能量与连击点、Wicked Slash、Dirt Nap、Craven Thrust（背后，匕首）、Eye Jab、Ghostfoot、Cutthroat Tempo、Swift Heels。
- **Priest**：Smite、Whispered Prayer、Litany of Resolve、Dirge of Decay、Psalm of Warding（吸收）、Lingering Grace（持续治疗）、Mindfracture。
- **Shaman**：Arc Bolt、Stonebound Weapon（附魔）、Mending Waters、Earthen Jolt、Thunder Ward（荆棘）、Cinder Jolt。
- **Mage**：Cinderbolt、Hoarfrost Mantle、Aether Insight、Rimelance、Waterbind、Cinderfall、Aether Darts（引导）、Bewitch、Icebind，一只召唤的水元素，以及 Chronomancy，一个时间魔法治疗专精。
- **Warlock**：Gloom Bolt、Fiendhide、Burning Pact、Blackrot、Hard Bargain、Hex of Anguish、Consume，以及从 Emberkin 到 Wraithborn 共七只可召唤的恶魔。
- **Druid**：Wildbolt、Wildmend、Wildward、Lunar Tempest、Wildbloom、Briarguard、Gripping Roots，以及 5 级变形为 Wolf Form、8 级为 Bruin Form、10 级为 Moonwing Form。

治疗和增益会作用于队友，治疗可以暴击，吸收护盾会在生命值之前承受伤害。在**每个职业的三个天赋专精**之间分配点数（Battlecraft/Bloodrush/Ironguard、Moongrove/Wildfang/Groveheart 等等）；分配由服务器校验，并可导出为一段构筑字符串。

### 副本

Gravecaller 主线贯穿三个五人精英副本，第四个则守在一道月门之后，带着它自己那段溺亡传说，另有一个单人地穴在一旁等待探险者。

- **The Hollow Crypt**（5 人），位于 the Fallen Chapel 之下：成对的精英杂兵、Sexton Marrow 小 Boss，以及 Morthen the Gravecaller 和他反复释放的暗影范围伤害。地穴之门会把你的队伍传送进一个私有的副本拷贝，等它空下来后便会重置。
- **The Sunken Bastion**（5 人，约 13 级，Mirefen 东南）：随着战斗拖长，Vael the Fogbinder 会召唤一波波 Drowned Thralls。
- **Gravewyrm Sanctum**（5 人，20 级，Thornpeak 之下）：三个房间的精英骸骨卫士和鳞甲卫士、Korgath the Bound、Grand Necromancer Velkhar，以及 Korzul the Gravewyrm，史诗武器在此掉落。
- **The Drowned Temple**（5 人），经由 Glimmermere 月门进入：一个苍白、月紫色的副本，通向 Choirmother Selthe，然后是 Ysolei, Avatar of the Drowned Moon，她的月潮和召唤出的 Moonspawn 会惩罚原地不动的队伍。
- **The Abandoned Crypt**（单人），位于 Thornpeak：一段静谧的、靠钥石与日记推进的单人探索，其线索会解封通往 **Nythraxis, Scourge of Thornpeak** 的皇家之门，那是一场跨越三块灵魂守护石的十人团队收尾战。

每个副本还有**英雄**模式：更高等级的敌人、更凌厉的机制，以及专属的战利品和商人货币。铺垫的任务链都可单人完成，所以剧情绝不会被“必须找到队伍”卡住。我们的自动化五人机器人团队（warrior、paladin、priest、mage、hunter，带集火和治疗 AI）能在约五分钟内通关 the Hollow Crypt（`node scripts/crypt_raid.mjs`，需要 `ALLOW_DEV_COMMANDS=1`）。

### Delves

Delves 是一种独立的、可缩放的小队模式，供一到两名玩家游玩，每次进入都会从随机房间重建，终点是一只上锁的圣物箱，它靠开锁小游戏打开，而不是靠战利品掷骰。**The Collapsed Reliquary**（7 级及以上）终点是 Deacon Varric，单人挑战时会有一位 AI 同伴 Tessa 与你并肩作战。**The Drowned Litany**（12 级及以上）循着线索深入 Mirefen Marsh 边缘一座被水淹没的圣所。一块 delve 公告板用来设定层级：英雄会提升敌人等级并加入一条随机词缀，以换取更丰厚的奖励。

### 排名制 PvP（the Ashen Coliseum）

按 `G` 或竞技场按钮排队。匹配会把斗士们传送进一个私密斗坑，一段短暂的倒计时会治疗并重置所有人以求公平开局，当一方认输时对局结束。无人会死亡，你会准确回到排队的地点。Protect Yumi 在它自己的迷宫中进行，而不是在 Coliseum 斗坑里。

- **1v1 和 2v2 排名天梯**，各有一套持久的 Elo 式评分和一份历史排行榜。
- **2v2 Fiesta**，一种更热闹的派对模式：队伍竞相冲向击杀目标数，强化拾取会掉落力量，而一道不断收缩的环形场地会迫使战斗汇聚。
- **Protect Yumi**，一种不计分的 3v3 和 5v5 目标争夺模式，在一座迷宫中进行：每支队伍守护一只猫咪伙伴，同时设法击倒对方的那一只，所以护送和抓单比单纯的击杀更重要。

排名胜利和 Fiesta 击杀会奖励 **Honor**，城里的军需官可以用它兑换一套 Warfare 装备。Warfare 是一项仅在 PvP 生效的属性，所以这套装备能赢下对决，却永远不会在 PvE 中盖过同层级的副本战利品。

### 一起游玩

- **Dungeon Finder**：用 `Shift+I` 打开，浏览副本和团队本、查看 Boss 与战利品、加入自动的坦克/治疗/输出职责队列，或者创建一个预组列表。由 Finder 组成的队伍仍然要一起前往入口。
- **队伍**最多 5 人，人满之后可转为由两个小队组成的 10 人团队：右键点击一名玩家，选择邀请入队。成员共享采集权和任务记功，按经典时代的组队加成分配经验，并以光点形式显示在小地图上。`/p` 用于队伍聊天，`/roll` 用于裁定战利品归属。
- **交易**：右键并选择交易。双方各自摆上物品和金钱，双方都须确认，交换是原子的并由服务器校验。任务物品无法交易，走开即取消。
- **决斗**：右键并发起决斗挑战。3 秒倒计时后开打，直到一方降到 1 点生命值；胜者会在全区域公告，跑出 60 码外即判负。
- **采集权与离开状态**：第一个对怪物造成伤害的玩家拥有它的战利品、经验和任务记功；`/afk` 和 `/dnd` 会把你标记为离开，并对密语自动回复。

### 世界与系统

- **专业技能**（`Shift+P`）：四种采集职业（采矿、伐木、草药学、钓鱼）供养十种制造职业，从烹饪、炼金到武器锻造、珠宝加工和附魔。采集工具分层级，决定你能开采哪些资源点；制造在城镇工作台进行，有机会做出带有你制作者印记的大师品质，此外还有一套原型系统等你在专精的过程中发掘。
- **World Market**：一个玩家驱动的拍卖行，交易装备、材料和消耗品，可从各据点城镇浏览。
- **Ravenpost 邮件**：向其他角色寄送物品和金钱，附件会被安全保管直到被领取。
- **公会**：公会宪章、成员名册、等级和公会聊天。
- **Guide**：`/wiki` 上一个可搜索的站内百科，涵盖职业、生物、区域和 deeds，直接由实时游戏内容生成，因此绝不会与它所记录的世界脱节。
- **The Vale Cup 与 Card Duel**：在 Eastbrook 以南 Sowfield 球场进行的 boarball，赛制从 1v1 到 5v5，还有由城里的 Card Master 主持的快节奏一对一卡牌游戏。
- **Daily Rewards**：通过验证的 $WOC 持有者可以从每日抽奖和轮换任务中赚取排行榜积分，并从每日奖池自动获得派彩。
- **WOC Store 与 Season 1 Armory**：用法币、SOL、USDC 或 $WOC 购买 Claudium，再把它花在纯装饰性的武器皮肤上。
- **进食与饮水**：坐下即可恢复，受到伤害或站起会打断，而且没错，你可以一边吃一边喝。
- **商人**会收购食物和饮水，并出售货真价实的白色装备，钱币以金、银、铜显示。
- **个人银行**（the Gilded Strongbox）：每座据点城镇的银行管理员为每个角色保管一个金库，从 24 格起，用金钱扩容最多可达 96 格，另有在线验证邮箱、链接账号和推荐好友所赚取的额外格子。
- **The Book of Deeds**：一本成就日志（默认 `Shift+Z`），记录任务、击杀、通关和趣事，奖励可佩戴在姓名板、聊天和榜单上的装饰性称号，另有一个 HUD 追踪器显示你正在追逐的 deeds、由 Chronicler NPC 保管的各区域 Chronicles，以及一份历史 Renown 排行榜；公开列表位于 `/wiki/deeds`。
- **怪物 AI**：游荡、按等级差的临近仇恨、社交拉怪、追击、脱离与重置、尸体拾取和刷新，还有一只长计时的稀有刷新怪（Old Greyjaw）。
- **钓鱼**点拥有各自的战利品表和稀有渔获。
- **装饰皮肤**按优秀、稀有和史诗品质掉落，纯粹为了好看。
- **死亡与恢复**：释放灵魂回到墓地、承受坠落伤害，并在游泳时减速。
- **生物群系天气**：Vale 晴朗、Marsh 降雨、Peaks 飞雪，随你在区域之间移动而交叉淡入淡出。

### 操作（经典布局）

| 输入 | 动作 |
|---|---|
| `W` / `S` | 前进 / 后退。`A`/`D` 转向（按住右键时为横向移动），`Q`/`E` 横向移动 |
| 右键拖拽 / 左键拖拽 | 鼠标转视角 / 环绕镜头。滚轮缩放，`Space` 跳跃 |
| `Tab` | 在最近的敌人间循环切换。左键选取目标，右键攻击、拾取或交谈 |
| `1`-`9`、`0`、`-`、`=` | 动作条 |
| `F` | 交互（拾取尸体、捡起物体、交谈） |
| `C` `P` `L` `M` `B` `N` `T` | 角色、法术书、任务日志、世界地图、背包、天赋、制造 |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | 竞技场、好友与公会、排行榜、日历、Vale Cup、Dungeon Finder、专业技能、deeds |
| `Z` / `X` | 收起或拔出武器、表情轮盘 |
| `V` / `R` / `Esc` | 姓名板、自动跑、关闭最上层窗口（或打开游戏菜单） |

每一个按键绑定都可以在按键设置面板中重新映射。触屏操作（一个移动摇杆、镜头拖拽和屏幕上的动作按钮）会在移动端自动出现。

## 架构（一个 sim，三个宿主）

三个理念把整个项目串在一起：

- **一个 sim，三个宿主。** 同一份 `src/sim/` 代码同时运行离线浏览器世界、在线服务器和 RL 环境。行为必须处处一致，测试的存在正是为了守住这一点。
- **`IWorld` 是唯一的接缝。** `IWorld` 由 `src/world_api/` 下按领域划分的 facet 接口定义，并由 `src/world_api.ts` 聚合。离线的 `Sim` 在结构上满足它，在线的 `ClientWorld` 通过镜像服务器快照来实现它。渲染器和 HUD 只与 `IWorld` 对话，从不与某个具体世界对话，所以新功能要先扩展对应的 facet，再在两个世界中实现。
- **服务器是权威。** 客户端发送意图；服务器决定结果。客户端从不自行裁决战斗、战利品或经济。

sim 是固定的 20 Hz tick（`DT = 1/20`），所有随机都流经一个带种子的 `Rng`，而 `src/sim/` 不携带任何 DOM、浏览器或 Three.js 导入。正是这一点，让同一份代码无需改动一行，就能打包成一个 Node 环境服务器、一个权威游戏循环和一个浏览器标签页。

### 项目布局

| 路径 | 它是什么 |
|---|---|
| `src/sim/` | 确定性游戏核心，唯一的真相来源。没有 DOM 或 Three 依赖。 |
| `src/sim/content/` | 数据即代码：九大职业、技能、区域、副本、delves、物品、配方、附魔、天赋、专业技能、deeds。 |
| `src/world_api.ts` + `src/world_api/` | `IWorld`，渲染器和 HUD 所依赖的接缝：每个领域一个 facet 接口。 |
| `src/`（其余部分） | Three.js 渲染器、HUD 与样式、输入/音频、在线镜像，以及管理后台、Guide 和编辑器 SPA。 |
| `server/` | 权威服务器：HTTP 和 WS、世界循环、Postgres、鉴权、社交、审核。 |
| `server/http/` | REST 请求流水线：表驱动路由、中间件，以及按领域划分的路由定义。 |
| `headless/` + `python/` | RL 环境服务器（`env_server.ts`）和 Python Gym 绑定。 |
| `bot/` | Discord 机器人（角色、转发、动态信息流）。 |
| `electron/`、`android/`、`ios/` | 桌面（Steam）和原生移动端外壳。 |
| `tests/` | Vitest 测试套件。 |
| `scripts/` | 构建、素材、i18n、SFX、截图和浏览器 E2E 工具。 |
| `deploy/` · `mediawiki/` | 生产环境首次启动素材和玩家百科容器。 |
| `public/` · `docs/` | 静态素材（原样部署到站点）和设计文档。 |

这一切都不是靠自觉维持的：`tests/architecture.test.ts` 会扫描每一个 sim 文件，
查找被禁止的导入、DOM 全局对象，或是零散的时钟与 `Math.random` 调用，而
`tests/world_api_parity.test.ts` 会钉住这道接缝，使两个世界无法漂移。

大多数目录都带有自己的 `CLAUDE.md`，记录本地约定，而完整的项目不变量集合见根目录的
[`CLAUDE.md`](../../CLAUDE.md)。智能体贡献者从那里开始，然后取用各自运行时的入口：
Codex 用 [`AGENTS.md`](../../AGENTS.md) 加 [Codex 操作指南](../codex.md)，Gemini 用
[`GEMINI.md`](../../GEMINI.md)。它们最终都汇入同一份规范架构。

## 像经典作品那样打造

战斗、升级和威胁全都跑在货真价实的经典时代规则上：怒气与能量、命中与闪避表、护甲减免、真实的经验曲线、挥击计时器和全局冷却。它带来的是你记忆中的手感，而非一种近似。如果你想读，确切的数字就在 `src/sim/` 里。

世界是用代码创作的，而不是在 3D 编辑器里做出来的，这正是它保持小巧、
确定且易于 fork 的原因：

- 地形、水体、天气、天空、城镇布局、实时阴影和战斗特效都在运行时由 sim 自身的数据生成。
- 随包发布的模型也以同样的方式构建：`scripts/assets/` 下的程序化工厂通过项目的 image-to-GLB 流水线导出确定性的 GLB，此外还有一套精选的 CC0 模型包。绑定骨骼的生物和角色族群配有完整的行走、攻击、施法、坐下和死亡动画。
- 图标是一套分层绘制器，会为任何没有随包文件的对象合成美术，因此绝不会有图标缺失，技能、物品和 deeds 还额外叠加了精选的手绘美术。
- 一套完整的经典 HUD（单位框体、动作条、提示框、任务日志、世界地图、小地图、漂浮战斗文字、Book of Deeds）、采样的空间与界面音效，以及一份在仓库中程序化谱写、并以流式重制版发布的原声，它会在区域、城镇、副本和战斗之间交叉淡入淡出。

每一个随包发布的素材及其许可都记录在 [CREDITS.md](../../CREDITS.md) 中，捆绑的
第三方依赖则在 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) 中附有各自的声明。

## 开发

除游戏客户端之外，构建还会产出运营后台、位于 `/editor` 的世界编辑器，以及位于
`/wiki` 的公开 Guide，它们全部由同一个开发服务器提供。

门禁和音频测试所走的每一条 FFmpeg 路径都解析到随包的
`ffmpeg-static`/`ffprobe-static` npm 包，因此一次普通的贡献无需安装系统
FFmpeg。测量一致性的那些路径（`npm run sfx:check`、音频测试、Studio 的导出校验）
直接绑定到这些静态二进制文件，没有 `PATH` 回退：如果某次跳过脚本的安装让它们缺失，
请重新运行 `npm ci`。Studio 的播放与编码进程以及 `npm run gate` 的预检通过
`scripts/sfx/ffmpeg_paths.mjs` 解析，它确实会回退到 `PATH`。一些独立的音频生成脚本
（例如 `scripts/gen_ui_sfx.mjs`）仍然默认使用 `PATH` 中的 `ffmpeg`。

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

逻辑和单元测试使用 Vitest。迭代时，运行单个文件：`npx vitest run tests/sim.test.ts`。界面改动还有一套可选启用的真实浏览器测试套件，覆盖无障碍、键盘导航和触控目标：`npm run test:browser`。截图和冒烟脚本通过 `puppeteer-core` 驱动真实浏览器，需要 `npm run dev` 正在运行；线路层脚本（`mp_integration.mjs`、`social_e2e.mjs`、`crypt_raid.mjs`）直接与服务器通信，需要的是 `npm run server`。浏览器智能体可以通过 `window.__game.controller` 来驱动移动，而无需模拟按住的按键，例如 `controller.move({ forward: true }, facingRadians)` 或像 `{ f: 1, sr: 1 }` 这样的紧凑标志。

检查分层运行，详见 [docs/qa-gate.md](../qa-gate.md)：用
`git config core.hooksPath .githooks` 把你的克隆指向共享钩子，就会有一层快速底线
在任何东西离开你的机器之前先跑一遍。

服务器命令见上方的[在线开发](#develop-online-with-hot-reload)，贡献流程见
[CONTRIBUTING.zh_CN.md](CONTRIBUTING.zh_CN.md)，声音创作与产物导出见
[SFX Studio 教程](../sfx-studio-tutorial.md)，生产部署见 [DEPLOY.md](../../DEPLOY.md)，
素材许可见 [CREDITS.md](../../CREDITS.md)。

## 本地化

每一个玩家可见的字符串都经由 `t()` 解析，游戏随包提供 **22 种语言**（英语、两种西班牙语、两种法语、加拿大英语、意大利语、德语、简体和繁体中文、韩语、日语、巴西葡萄牙语、俄语、捷克语、荷兰语、波兰语、印尼语、土耳其语、瑞典语、越南语和丹麦语）。sim 和服务器保持语言无关：它们发出稳定的键名，或由客户端在边界处重新本地化的英语，这样确定性得以完好保持。贡献者只添加英语；维护者在每次发布前批量填充其他语言。工作流的文档见 `docs/i18n-scaling/translation-workflow.md`。

## 参与贡献

我们欢迎各种形式的贡献：代码、翻译、错误报告和文档。先从 [CONTRIBUTING.zh_CN.md](CONTRIBUTING.zh_CN.md) 了解环境搭建，阅读[行为准则](../../CODE_OF_CONDUCT.md)，并在报告漏洞前查看 [SECURITY.md](../../SECURITY.md)。新来的？可以找带 [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue) 标签的议题，开一个[议题](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)，或者来 [Discord](https://discord.com/invite/worldofclaudecraft) 打个招呼。

活跃开发在最新的 `release/vX.Y.Z` 分支上进行。请自己核对它是哪一个，而不是想当然，然后从它拉出新分支，并把你的拉取请求指向它。切勿从 `main` 拉出分支或以 `main` 为目标，它只有在某个版本正式发布时才会收到对应的发布分支。[CONTRIBUTING.md](CONTRIBUTING.zh_CN.md) 里有一行命令，可以找出当前最新的那一个。

## 许可

**代码采用 [MIT 许可](../../LICENSE)，所以尽管 fork 它、混搭它，搭建你自己的世界。** 这正是本项目的全部意义，本页面或我们网站上的任何其他内容都不会收回这一点。

有三样东西是分开授权的，值得花三十秒弄清楚各是哪一样：

| 是什么 | 许可 | 你可以再分发吗？ |
|---|---|---|
| **源代码**，指除下面单列出来的媒体素材之外的全部内容 | [MIT](../../LICENSE) | 可以，商用也可以。 |
| **媒体素材**：模型、纹理、HDRI、图标、音效、字体（大多在 `public/` 下） | 逐个素材而定，记录在 [CREDITS.md](../../CREDITS.md) 中 | 大多可以（多数为 CC0）。有些不行，见下文。 |
| **名称与品牌**：“World of ClaudeCraft”、“Levy Street”、各类标志 | 未授权 | 不可以。 |

**尽管 fork 它，搭建你自己的世界。这条路行得通，素材不会挡道。** 你看到的大部分内容都是 CC0 公共领域素材（KayKit、Quaternius、Kenney、ambientCG、Poly Haven），而我们自己生成的道具、生物、背景和界面音效也随项目一同发布，因此 fork 出来即可直接运行。你只是不能把它们单独抽出来，当作独立的美术作品出售。

在再分发之前，你需要移除或替换的内容：

- `public/ui/skills/` 下的 **CraftPix 职业技能图标**由 Levy Street 购买，**不得再分发**，如果你想随包发布，请自行购买许可；
- **@jamiecypher 音效**采用 CC BY-NC 4.0，可以在署名的前提下非商业分享，但商业授权仅限本项目；
- **商店与荣誉美术**（Season 1 Armory、Claudium 套装、专业技能美术集、Book of Deeds 图标、精英巨龙徽记）是委托制作的商业美术，**版权保留**；
- **第三方品牌标识**（Twitch、X、Kick、YouTube、Discord、Solana、USDC）是各自所有者的商标，我们无权代为授权；
- 少量**经许可使用的图标和录音**需要获得许可才能转交他人。

[CREDITS.md](../../CREDITS.md) 是权威清单，为每个素材列出了再分发一栏。凡是在那里列出的素材，其许可优先于项目的 MIT 许可。这份登记表仍在完善中，因此某个媒体素材若不在其中，只说明它尚未被记录，而不是可以自由使用：在依赖它之前请先询问。源代码则正好相反，凡是没有被单列出来的内容都属于 MIT。

我们的[服务条款](https://worldofclaudecraft.com/terms)适用于我们在 worldofclaudecraft.com 运营的托管游戏：账号、行为规范、虚拟物品。它们不会限制 MIT 许可赋予你在这份源代码上的权利。
