<div align="center">

# World of ClaudeCraft

**在浏览器里免费畅玩一个纯手工打造的世界：做任务、组队、打团。开源、web3，现在就能在线游玩。**

**官方网站：https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.27.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.zh_CN.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · **简体中文** · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[立即游玩](https://worldofclaudecraft.com/) · [搭建你自己的世界](#host-your-own-world-one-command) · [训练智能体](#train-an-agent-headless-rl) · [Web3](#web3) · [参与贡献](CONTRIBUTING.zh_CN.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft 标题画面](../../docs/screenshots/title-screen.jpg)

</div>

## 这是什么

World of ClaudeCraft 是一款完整的经典时代 MMO：你现在就能在浏览器里直接游玩，用一条命令自行搭建，甚至还能训练 AI 智能体来玩它。它免费、开源，并已在 [worldofclaudecraft.com](https://worldofclaudecraft.com/) 上线运行。

同一个共享世界在三个地方运行，全部出自同一份游戏核心：

- **离线浏览器世界**，点击 Play Offline 即可进入，
- **权威多人服务器**，由 Postgres 支撑的账号共享一个实时世界，
- **无头 RL 环境**，Python 通过 Gym 接口驱动真正的游戏。

同样的种子，同样的世界，处处一致。而且几乎没有任何内容是随包发布的素材：城镇、生物、法术图标和音效全部在运行时生成。

## 亮点

- **九大经典职业**，每个都配有真正的传统风格技能组，随等级解锁等级阶位，外加完整的**天赋系统**（每个职业三系专精，共 27 个专精）。
- **三大开放世界区域**，从 1 级到 20 级，近 80 个任务，以及一条围绕 Gravecaller 的阴谋展开、彼此相连的主线剧情。
- **五个副本**，其中四个是五人精英团队副本，另有一个单人地穴，配有精英缩放、范围 Boss 机制和职业原型战利品。
- **可缩放的 Delves**，一种供一到两名玩家加一个 AI 同伴的小队模式，每次进入都会从随机房间重新生成，分为普通和英雄两个层级。
- **the Ashen Coliseum**，一座排名制 PvP 竞技场，设有 1v1 和 2v2 天梯，外加 2v2 Fiesta 模式（拾取强化、不断收缩的环形场地、率先达成十五次击杀者获胜）。
- **真正的多人玩法**：队伍、交易、决斗、采集权、队伍经验分配、密语、离开状态，以及一个掌控每一次战斗判定的服务器。
- **一切皆程序生成**：木构城镇、绑定骨骼的生物族群、在画布上绘制的手绘法术图标、WebAudio 音效、生物群系天气，以及实时阴影。世界没有任何 3D 模型文件。
- **本地化为 21 种语言**，通过一条确定性的、由 sim 发出键名的流水线实现。
- **无头 RL 环境**，提供 Gymnasium 绑定、奖励塑形和基准测试模式。
- **web3 原生**：链接一个 Solana 钱包即可展示你的 $WOC 余额和一枚装饰性的持有者徽章，完全可选且非托管。

## 截图

![一支队伍聚集在 Eastbrook 药剂师铺外](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Eastbrook 营火旁的黄昏](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Eastbrook 营火旁的黄昏* | ![the Hollow Crypt 中的精英怪](../../docs/screenshots/hollow-crypt.jpg)<br>*the Hollow Crypt 中火把映照下的精英怪* |
| ![废弃礼拜堂里不安息的亡者](../../docs/screenshots/restless-dead.jpg)<br>*废弃礼拜堂里不安息的亡者* | ![与 Vale Bandits 的混战](../../docs/screenshots/vale-bandits.jpg)<br>*在强盗营地以寡敌众* |
| ![Old Greyjaw 在北路上被追击](../../docs/screenshots/old-greyjaw.jpg)<br>*稀有刷新怪 Old Greyjaw 在北路上被追杀* | ![商人与背包界面](../../docs/screenshots/vendor-and-bags.jpg)<br>*在 Smith Haldren 处备战，配有提示框、背包与钱币* |
| ![Glimmermere 岸边的月门](../../docs/screenshots/glimmermere-moongate.jpg)<br>*溺亡者从 Glimmermere 月门处爬出* | ![Ysolei 立于 the Drowned Temple 的祭坛上](../../docs/screenshots/drowned-temple-altar.jpg)<br>*月火与 the Drowned Temple 的祭坛* |

天气由生物群系驱动，仅用于渲染，因此从不触及确定性的 sim：

| | | |
|:---:|:---:|:---:|
| ![Eastbrook Vale 上空晴朗](../../docs/screenshots/weather-vale_clear.jpg)<br>*Vale 上空晴朗* | ![Mirefen Marsh 上空降雨](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mirefen Marsh 上空降雨* | ![Thornpeak Heights 上的飞雪](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Thornpeak Heights 上的飞雪* |

## 开始游玩

你有两种进入方式，它们运行的是同一个世界。

### 离线，在你的浏览器里

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

为你的角色命名，从九个职业中任选其一，你将从 **Eastbrook Vale**（1 至 7 级）开始，这是一座集市镇，周围环绕着六处据点：北面是狼群出没地，东面是野猪草甸，西面是 the Webwood，西北是 Mirror Lake，西南是一处狗头人铜矿坑，东北是一座栖息着不安息亡者的废弃礼拜堂，东南则是 Gorrak 的强盗营地。北路翻越一道山口进入 **Mirefen Marsh**（6 至 13 级，据点 Fenbridge），再向上通往 **Thornpeak Heights**（13 至 20 级，据点 Highwatch）。世界种子在 `src/main.ts` 中固定，所以每次造访都是同一个地方。

### 在线，与其他玩家一起

请参阅下方的 [搭建你自己的世界](#host-your-own-world-one-command)，搭建带有账号和持久化角色的真正客户端/服务器游戏。

<a id="host-your-own-world-one-command"></a>

## 搭建你自己的世界（一条命令）

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

如需**远程托管**，把这套 compose 栈放到任意 VPS 上，在环境中设置一个真正的 `POSTGRES_PASSWORD`，并用一个 TLS 反向代理转发 8787 端口。用 Caddy 只需两行（`your.domain { reverse_proxy localhost:8787 }`）；WebSocket 会被自动代理，客户端在 https 页面上会自动选用 `wss://`。鉴权端点按 IP 做了限流，密码用 scrypt 哈希，令牌 7 天后过期。在生产环境中切勿设置 `ALLOW_DEV_COMMANDS=1`，因为它会启用测试机器人所用的升级和传送作弊。完整的生产指南见 [DEPLOY.md](../../DEPLOY.md)。

<a id="develop-online-with-hot-reload"></a>

### 在线开发并热重载

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

打开 http://localhost:5173，选择 **Play Online**，创建一个账号，创建一个角色，然后 Enter World。再打开第二个标签页重新登录，就能在城里看到彼此。`Enter` 打开聊天。一个真正的 MediaWiki 玩家百科会随 Docker Compose 栈一同启动，地址为 http://localhost:8080/wiki/；它的初始页面由当前游戏内容通过 `npm run wiki:seed` 生成。

哪些内容会持久化，以及服务器如何保持掌控：

- **账号**：scrypt 哈希的密码和 7 天有效的承载令牌（`auth_tokens`）。
- **角色**：每个账号最多 10 个；等级、装备、背包、任务、天赋、位置和金钱以 JSONB 形式持久化在 Postgres 中，每 30 秒、登出时以及服务器关闭时保存。名字全局唯一，只能用字母，经典风格。
- **服务器是权威**：客户端以 20 Hz 流式发送移动意图和指令；服务器运行那一个共享的 `Sim`，并返回按兴趣范围裁剪的快照（约 120 yd）以及每位玩家的事件。每一次战斗判定、战利品掉落、任务记功和商人交易都在服务器端裁决。客户端只是一个渲染器。

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **观测空间和动作空间由内容推导而来。** 请在启动时从环境的 `info` 响应中查询，而不要硬编码；它们会随游戏一同增长。如今动作空间是 `Discrete(44)`（移动、选取目标、攻击、完整的技能组、交互、进食/饮水），观测则是一个含 276 个浮点数的 `Box`（自身、技能、目标、附近的怪物、最近的可交互物、任务进度）。
- **奖励**是每个 tick 计数器增量的加权和（经验、造成和承受的伤害、击杀、死亡、任务进度、升级），可在每次 reset 时调参。每个 `step` 应用一个动作并默认推进五个 sim tick，因此大约每模拟一秒做四次决策。
- **构造上即确定性。** 没有挂钟时间，没有 `Math.random`。为 reset 设定种子，回合就会精确重放。

协议和绑定的文档见 `headless/CLAUDE.md` 和 `python/CLAUDE.md`。

<a id="web3"></a>

## Web3

World of ClaudeCraft 以 **$WOC**（我们在 Solana 上的社区代币）为核心，是 web3 原生的。连接一个 Solana 钱包，用一次签名把它链接到你的账号（非托管，无需批准任何交易），你只读的 $WOC 余额便会显示在 HUD 中，旁边还有一枚装饰性的持有者层级徽章。

它纯属装饰，游玩时并不需要。游戏内不消耗也不赚取任何东西，没有付费变强，整个游戏即便从不连接钱包也能正常游玩。

**$WOC 合约地址（Solana）：**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

关于代币的更多信息见 [worldofclaudecraft.com](https://worldofclaudecraft.com/)。

## 世界巡礼

### 九大职业

每个职业都采用真正的传统风格机制，并在 1 至 20 级期间学习等级阶位的法术（Lightning Bolt R2 在 8 级，R3 在 14 级，R4 在 20 级，而 Execute、Kidney Shot、Flash Heal、Stormstrike 和 Starfire 等高阶段技能在各自的经典等级解锁）。

- **Warrior**：怒气、Heroic Strike（下次挥击触发，不占 GCD）、Battle Shout、Charge、Rend、Thunder Clap、Hamstring、Bloodrage、Overpower（闪避触发）。
- **Paladin**：由 Judgement 释放的 Seal of Righteousness、Holy Light、Devotion Aura、Blessing of Might、Divine Protection（吸收）、Hammer of Justice（眩晕）、Lay on Hands。
- **Hunter**：远程 Auto Shot（8 至 35 yd，带经典近战盲区）、Raptor Strike、Aspect of the Hawk、Serpent Sting、Arcane Shot、Concussive Shot、Mongoose Bite、Wing Clip，以及从 10 级起可驯服的宠物。
- **Rogue**：能量与连击点、Sinister Strike、Eviscerate、Backstab（背后，匕首）、Gouge、Evasion、Slice and Dice、Sprint。
- **Priest**：Smite、Lesser Heal、Power Word: Fortitude、Shadow Word: Pain、Power Word: Shield（吸收）、Renew（持续治疗）、Mind Blast。
- **Shaman**：Lightning Bolt、Rockbiter Weapon（附魔）、Healing Wave、Earth Shock、Lightning Shield（荆棘）、Flame Shock。
- **Mage**：Fireball、Frost Armor、Arcane Intellect、Frostbolt、Conjure Water、Fire Blast、Arcane Missiles（引导）、Polymorph、Frost Nova。
- **Warlock**：Shadow Bolt、Demon Skin、Immolate、Corruption、Life Tap、Curse of Agony、Drain Life，以及从 Imp 到 Doomguard 共七只可召唤的恶魔。
- **Druid**：Wrath、Healing Touch、Mark of the Wild、Moonfire、Rejuvenation、Thorns、Entangling Roots，10 级的 Bear Form。

治疗和增益会作用于队友，治疗可以暴击，吸收护盾会在生命值之前承受伤害。在**每个职业的三个天赋专精**之间分配点数（Arms/Fury/Protection、Balance/Feral/Restoration 等等）；分配由服务器校验，并可导出为一段构筑字符串。

### 副本

Gravecaller 主线贯穿四个五人精英副本，另有一个单人地穴供探险者顺道一探。

- **the Hollow Crypt**（5 人），位于 the Fallen Chapel 之下：成对的精英杂兵、Sexton Marrow 小 Boss，以及 Morthen the Gravecaller，他每十秒释放一次 Shadow Pulse 范围伤害。地穴之门会把你的队伍传送进一个私有的副本拷贝，空置五分钟后重置。
- **the Sunken Bastion**（5 人，约 13 级，Mirefen 东南）：Vael the Mistcaller 在 60% 和 30% 生命值时召唤一波波 Drowned Thralls。
- **Gravewyrm Sanctum**（5 人，20 级，Thornpeak 之下）：三个房间的精英骸骨卫士和龙人、Korgath the Bound（生命值低于 30% 时狂暴）、Grand Necromancer Velkhar，以及 Korzul the Gravewyrm，史诗武器在此掉落。
- **the Drowned Temple**（5 人），经由 Glimmermere 月门进入：一个苍白、月紫色的副本，通向 Choirmother Selthe，然后是 Ysolei, Avatar of the Drowned Moon，她每九秒脉冲一次 Lunar Tide，并在 60% 和 30% 时召唤 Moonspawn。
- **the Abandoned Crypt**（单人），位于 Thornpeak：一段静谧的、靠钥石与日记推进的单人探索，其线索会解封通往 **Nythraxis, Scourge of Thornpeak** 的皇家之门，那是一场跨越三块灵魂守护石的十人团队收尾战。

铺垫的任务链都可单人完成，所以剧情绝不会被"必须找到队伍"卡住。我们的自动化五人机器人团队（warrior、paladin、priest、mage、hunter，带集火和治疗 AI）能在约五分钟内通关 the Hollow Crypt（`node scripts/crypt_raid.mjs`，需要 `ALLOW_DEV_COMMANDS=1`）。

### Delves

Delves 是一种独立的、可缩放的小队模式，供一到两名玩家游玩。**The Collapsed Reliquary**（7 级及以上）是一座每次进入都会从随机房间重建的地穴，终点是 Deacon Varric。单人挑战时，会有一位 AI 同伴 Tessa 与你并肩作战。圣物废墟处的 Brother Halven 经营着 delve 公告板，普通还是英雄由你决定：英雄会提升敌人等级并加入一条随机词缀，以换取更丰厚的奖励。

### the Ashen Coliseum（排名制 PvP）

按 `G` 或竞技场按钮排队。匹配会把斗士们传送进一个私密、火把映照的斗坑，一段短暂的倒计时会治疗并重置所有人以求公平开局，当一方在 1 点生命值时认输，对局结束。无人会死亡，你会准确回到排队的地点。

- **1v1 和 2v2 排名天梯**，各有一套持久的 Elo 式评分（人人从 1500 起步）和一份历史排行榜（`GET /api/arena/leaderboard`）。
- **2v2 Fiesta**，一种更热闹的派对模式：在六分钟上限内，率先达成十五次击杀的队伍获胜，玩家以递增的计时重生，强化拾取在三波中掉落力量，而一道收缩的环形场地会迫使战斗汇聚。

### 一起游玩

- **队伍**最多 5 人：右键点击一名玩家，选择邀请入队。成员共享采集权和任务记功，按真正的传统组队加成分配经验（3/4/5 人为 1.166 / 1.3 / 1.43），并以光点形式显示在小地图上。`/p` 用于队伍聊天，`/roll` 用于裁定战利品归属。
- **交易**：右键并选择交易。双方各自摆上物品和金钱，双方都须确认，交换是原子的并由服务器校验。任务物品无法交易，走开即取消。
- **决斗**：右键并发起决斗挑战。3 秒倒计时后开打，直到一方降到 1 点生命值；胜者会在全区域公告，跑出 60 码外即判负。
- **采集权与离开状态**：第一个对怪物造成伤害的玩家拥有它的战利品、经验和任务记功；`/afk` 和 `/dnd` 会把你标记为离开，并对密语自动回复。

### 世界与系统

- **进食与饮水**：坐下可在 18 秒内恢复，受到伤害或站起会打断，而且没错，你可以一边吃一边喝。
- **商人**会收购食物和饮水，并出售货真价实的白色装备，钱币以金、银、铜显示。
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
| `C` `P` `L` `M` `B` `G` | 角色、法术书、任务日志、世界地图、背包、竞技场 |
| `V` / `R` / `Esc` | 姓名板、自动跑、关闭窗口或清除目标 |

触屏操作（一个移动摇杆、镜头拖拽和屏幕上的动作按钮）会在移动端自动出现。

## 架构（一个 sim，三个宿主）

三个理念把整个项目串在一起：

- **一个 sim，三个宿主。** 同一份 `src/sim/` 代码同时运行离线浏览器世界、在线服务器和 RL 环境。行为必须处处一致，测试的存在正是为了守住这一点。
- **`IWorld` 是唯一的接缝。** `src/world_api.ts` 定义了 `IWorld`。离线的 `Sim` 在结构上满足它，在线的 `ClientWorld` 通过镜像服务器快照来实现它。渲染器和 HUD 只与 `IWorld` 对话，从不与某个具体世界对话，所以新功能要先扩展接口，再在两个世界中实现。
- **服务器是权威。** 客户端发送意图；服务器决定结果。客户端从不自行裁决战斗、战利品或经济。

sim 是固定的 20 Hz tick（`DT = 1/20`），所有随机都流经一个带种子的 `Rng`，而 `src/sim/` 不携带任何 DOM、浏览器或 Three.js 导入。正是这一点，让同一份代码无需改动一行，就能打包成一个 Node 环境服务器、一个权威游戏循环和一个浏览器标签页。

### 项目布局

| 路径 | 它是什么 |
|---|---|
| `src/sim/` | 确定性游戏核心，唯一的真相来源。没有 DOM 或 Three 依赖。 |
| `src/sim/content/` | 数据即代码：九大职业、技能、区域、副本、物品、天赋。 |
| `src/render/` | Three.js 渲染器（程序化几何、纹理、特效）。读取世界，从不修改它。 |
| `src/game/` | 本地输入、镜头、按键绑定、移动端操作、程序化 WebAudio。 |
| `src/ui/` | 经典 HUD（框体、窗口、提示框、地图、漂浮战斗文字）、程序化图标、i18n。 |
| `src/net/` | 在线客户端：REST 鉴权加一个 WebSocket 世界镜像（`ClientWorld`）。 |
| `src/admin/` | 管理后台 SPA（独立的 `admin.html` 入口）。 |
| `server/` | 权威服务器：HTTP 和 WS、世界循环、Postgres、鉴权、社交、审核。 |
| `headless/` + `python/` | RL 环境服务器（`env_server.ts`）和 Python Gym 绑定。 |
| `tests/` | Vitest 测试套件。 |
| `scripts/` | 素材构建以及浏览器 E2E、截图和集成脚本。 |
| `public/` · `docs/` | 静态素材（GLB 模型、纹理、HDRI）和设计文档。 |

大多数目录都带有自己的 `CLAUDE.md`，记录本地约定。完整的项目不变量集合见根目录的 [`CLAUDE.md`](../../CLAUDE.md)。

## 像经典作品那样打造

战斗、升级和威胁全都跑在货真价实的经典时代规则上：怒气与能量、命中与闪避表、护甲减免、真实的经验曲线、挥击计时器和全局冷却。它带来的是你记忆中的手感，而非一种近似。如果你想读，确切的数字就在 `src/sim/` 里。

而其中几乎没有一样是随包发布的素材。世界是用代码绘制的：

- 程序化的城镇、生物、地形、水体、天气和实时阴影，世界没有任何 3D 模型文件。
- 十二个绑定骨骼的生物族群，配有完整的行走、攻击、施法、坐下和死亡动画。
- 在运行时于画布上绘制的法术、物品和增益图标。
- 一套完整的经典 HUD（单位框体、动作条、提示框、任务日志、世界地图、小地图、漂浮战斗文字），以及为每一种音效准备的程序化 WebAudio。

## 开发

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

逻辑和单元测试使用 Vitest。迭代时，运行单个文件：`npx vitest run tests/sim.test.ts`。E2E 和视觉脚本通过 `puppeteer-core` 驱动真实浏览器，需要 `npm run dev` 正在运行（往往还需要 `npm run server`）。浏览器智能体可以通过 `window.__game.controller` 来驱动移动，而无需模拟按住的按键，例如 `controller.move({ forward: true }, facingRadians)` 或像 `{ f: 1, sr: 1 }` 这样的紧凑标志。

服务器命令见上方的 [在线开发](#develop-online-with-hot-reload)，生产部署见 [DEPLOY.md](../../DEPLOY.md)，素材许可见 [CREDITS.md](../../CREDITS.md)。

## 本地化

每一个玩家可见的字符串都经由 `t()` 解析，游戏随包提供 **21 种语言**（英语、两种西班牙语、两种法语、加拿大英语、意大利语、德语、简体和繁体中文、韩语、日语、巴西葡萄牙语、俄语、荷兰语、波兰语、印尼语、土耳其语、瑞典语、越南语和丹麦语）。sim 和服务器保持语言无关：它们发出稳定的键名，或由客户端在边界处重新本地化的英语，这样既保证了确定性又不受影响。贡献者只添加英语；维护者在每次发布前批量填充其他语言。工作流的文档见 `docs/i18n-scaling/translation-workflow.md`。

## 参与贡献

我们欢迎各种形式的贡献：代码、翻译、错误报告和文档。先从 [CONTRIBUTING.zh_CN.md](CONTRIBUTING.zh_CN.md) 了解环境搭建，阅读[行为准则](../../CODE_OF_CONDUCT.md)，并在报告漏洞前查看 [SECURITY.md](../../SECURITY.md)。新来的？可以找带 [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue) 标签的议题，开一个[议题](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)，或者来 [Discord](https://discord.com/invite/worldofclaudecraft) 打个招呼。

<div align="center">

![World of Claude](../../worldofclaude.png)

![World of ClaudeCraft 社区](../../woc_community.png)

</div>

## 许可

代码采用 [MIT 许可](../../LICENSE)，所以尽管 fork 它、混搭它，搭建你自己的世界。

随包的第三方美术素材（模型、纹理、HDRI）保留各自的许可，除 MIT 许可的水面法线贴图外均为 CC0 公共领域，每个素材包的具体说明见 [CREDITS.md](../../CREDITS.md)。
