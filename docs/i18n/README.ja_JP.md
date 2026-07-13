<div align="center">

# World of ClaudeCraft

**手作りの世界でクエストを進め、パーティを組み、レイドに挑もう。ブラウザで無料、オープンソース、web3対応、そして今すぐオンラインでプレイできます。**

**公式サイト: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.25.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.ja_JP.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/GjhnUsBtw)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · **日本語** · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[今すぐプレイ](https://worldofclaudecraft.com/) · [自分の世界をホストする](#host-your-own-world-one-command) · [エージェントを訓練する](#train-an-agent-headless-rl) · [Web3](#web3) · [コントリビュート](CONTRIBUTING.ja_JP.md) · [Discord](https://discord.gg/GjhnUsBtw)

![World of ClaudeCraft タイトル画面](../../docs/screenshots/title-screen.jpg)

</div>

## これは何か

World of ClaudeCraft は、今すぐブラウザでプレイでき、コマンド一つで自分でホストでき、さらにはAIエージェントにプレイを学習させることもできる、完全なクラシック時代のMMOです。無料でオープンソース、[worldofclaudecraft.com](https://worldofclaudecraft.com/) で稼働中です。

一つの共有された世界が、同じゲームコアから三つの場所で動きます。

- **オフラインのブラウザ世界**。Play Offline をクリックすればすぐに入れます。
- **権威ある（オーソリタティブな）マルチプレイヤーサーバー**。Postgres を背後に持つアカウントがライブな世界を共有します。
- **ヘッドレスのRL環境**。Python が Gym インターフェース越しに本物のゲームを動かします。

同じシードなら、どこでも同じ世界。そしてほとんど何一つ出荷済みアセットではありません。町も、クリーチャーも、呪文アイコンも、サウンドも、すべて実行時に生成されます。

## 主な特徴

- **9つのクラシッククラス**。それぞれにレベルアップで階位（ランク）を得る本格的なバニラ風のキットを備え、さらに完全な**タレントシステム**（クラスごとに3スペック、全27スペック）があります。
- **レベル1から20までの3つのオープンワールドゾーン**、80近いクエスト、そして Gravecaller の陰謀をめぐる一本につながったストーリーライン。
- **5つのインスタンスダンジョン**。うち4つは5人パーティのエリートレイド、1つはソロの納骨堂で、エリートスケーリング、AoEのボスメカニクス、クラスアーキタイプに応じた戦利品を備えています。
- **スケーラブルな delve**。1人または2人のプレイヤーとAIの相棒のための小規模パーティモードで、Normal と Heroic のティアにわたり、毎回ランダム化された部屋から組み直されます。
- **the Ashen Coliseum**。1v1と2v2のラダーを備えたランク制PvPアリーナに加え、2v2 Fiesta モード（強化アイテムの取得、縮小するリング、先に15キル）。
- **本物のマルチプレイヤー**。パーティ、トレード、決闘、タップ権、パーティ分配XP、ウィスパー、離席ステータス、そしてすべての戦闘判定を握るサーバー。
- **すべてが手続き的生成**。木組みの町、リグ付きのクリーチャー一族、キャンバスに描かれた呪文アイコン、WebAudio のサウンド、バイオームの天候、リアルタイムの影。世界に3Dモデルファイルはありません。
- **21のロケールにローカライズ**。決定論的な「simがキーを発する」パイプラインを通じて。
- **ヘッドレスのRL環境**。Gymnasium バインディング、報酬整形、ベンチマークモードを備えています。
- **web3ネイティブ**。Solana ウォレットをリンクして $WOC 残高とコスメティックなホルダーバッジを表示できます。完全に任意で、ノンカストディアルです。

## スクリーンショット

![Eastbrook の薬屋の外に集まるパーティ](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Eastbrook のキャンプファイアの夕暮れ](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Eastbrook のキャンプファイアの夕暮れ* | ![the Hollow Crypt でのエリートプル](../../docs/screenshots/hollow-crypt.jpg)<br>*the Hollow Crypt の松明に照らされたエリートプル* |
| ![崩れた礼拝堂の安らげぬ死者](../../docs/screenshots/restless-dead.jpg)<br>*崩れた礼拝堂の安らげぬ死者* | ![Vale Bandits との乱闘](../../docs/screenshots/vale-bandits.jpg)<br>*盗賊のキャンプで多勢に無勢* |
| ![北の街道で討たれた Old Greyjaw](../../docs/screenshots/old-greyjaw.jpg)<br>*レアスポーンの Old Greyjaw、北の街道で討ち取られる* | ![ベンダーとバッグのUI](../../docs/screenshots/vendor-and-bags.jpg)<br>*Smith Haldren の店で装備を整える。ツールチップ、バッグ、コインつき* |
| ![Glimmermere の岸辺のムーンゲート](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Glimmermere のムーンゲートから這い上がる溺死者たち* | ![the Drowned Temple の祭壇上の Ysolei](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire と the Drowned Temple の祭壇* |

天候はバイオーム駆動かつレンダリングのみで、決定論的なsimには一切触れません。

| | | |
|:---:|:---:|:---:|
| ![Eastbrook Vale の晴天](../../docs/screenshots/weather-vale_clear.jpg)<br>*Vale の晴れ* | ![Mirefen Marsh の雨](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mirefen Marsh の雨* | ![Thornpeak Heights の雪](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Thornpeak Heights の雪* |

## プレイする

入り口は二つあり、どちらも同じ世界が動きます。

### オフライン、ブラウザで

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

キャラクターに名前をつけ、9つのクラスのいずれかを選ぶと、**Eastbrook Vale**（レベル1から7）からスタートします。ここは6つの拠点に囲まれた市場町です。北には狼の通り道、東にはイノシシの草原、西には the Webwood、北西には Mirror Lake、南西にはコボルドの銅鉱の採掘場、北東には安らげぬ死者の崩れた礼拝堂、そして南東には Gorrak の盗賊キャンプがあります。北の街道は山道を登って **Mirefen Marsh**（6から13、拠点 Fenbridge）へ、さらに **Thornpeak Heights**（13から20、拠点 Highwatch）へと続きます。世界のシードは `src/main.ts` で固定されているので、訪れるたびに同じ場所です。

### オンライン、他のプレイヤーと

アカウントと永続キャラクターを備えた本物のクライアント/サーバーゲームを立ち上げるには、下の [自分の世界をホストする](#host-your-own-world-one-command) を参照してください。

<a id="host-your-own-world-one-command"></a>

## 自分の世界をホストする（コマンド一つ）

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

**リモートホスティング**の場合は、compose スタックを任意のVPSに置き、環境に本物の `POSTGRES_PASSWORD` を設定し、ポート8787の前段にTLSのリバースプロキシを立てます。Caddy なら2行で済みます（`your.domain { reverse_proxy localhost:8787 }`）。WebSocket は自動でプロキシされ、クライアントは https ページで `wss://` を自動選択します。認証エンドポイントはIPごとにレート制限され、パスワードは scrypt でハッシュ化され、トークンは7日で失効します。本番では決して `ALLOW_DEV_COMMANDS=1` を設定しないでください。テストボットが使うレベルアップやテレポートのチートが有効になってしまうからです。本番運用の完全ガイドは [DEPLOY.md](../../DEPLOY.md) を参照してください。

<a id="develop-online-with-hot-reload"></a>

### ホットリロードでオンライン開発

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

http://localhost:5173 を開き、**Play Online** を選び、アカウントを作成し、キャラクターを作成して Enter World を押します。2つ目のタブを開いて再度ログインすると、町でお互いの姿が見えます。`Enter` でチャットが開きます。Docker Compose スタックと並んで、本物の MediaWiki プレイヤーwiki が http://localhost:8080/wiki/ で立ち上がります。そのシードページは現在のゲームコンテンツから `npm run wiki:seed` で生成されます。

何が永続化され、サーバーがどのように主導権を保つか。

- **アカウント**: scrypt でハッシュ化されたパスワードと7日間のベアラートークン（`auth_tokens`）。
- **キャラクター**: アカウントごとに最大10体。レベル、装備、バッグ、クエスト、タレント、位置、所持金は Postgres に JSONB として永続化され、30秒ごと、ログアウト時、サーバー停止時に保存されます。名前はグローバルに一意で、英字のみ、クラシックなスタイルです。
- **サーバーが権威を持つ**: クライアントは移動の意図とコマンドを20 Hzでストリーミングし、サーバーは一つの共有 `Sim` を動かして関心スコープ（~120 yd）のスナップショットとプレイヤーごとのイベントを返します。すべての戦闘判定、戦利品のドロップ、クエストの達成、ベンダー取引はサーバー側で解決されます。クライアントはレンダラーです。

<a id="train-an-agent-headless-rl"></a>

## エージェントを訓練する（ヘッドレスRL）

同じ決定論的コアが [Gymnasium](https://gymnasium.farama.org/) 環境として動くので、エージェントはその再実装ではなく実際のゲームに対して学習します。env サーバー（`headless/env_server.ts`）は一つの `Sim` をラップし、stdio 越しに改行区切りのJSONで通信します。`python/` 内の Python バインディングがそれをサブプロセスとして起動し、おなじみの `reset` / `step` / `close` ループを公開します。

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

- **観測空間とアクション空間はコンテンツ由来です。** 起動時に env の `info` 応答から問い合わせて取得し、ハードコードしないでください。これらはゲームとともに成長します。現在のアクション空間は `Discrete(44)`（移動、ターゲット、攻撃、アビリティキット一式、インタラクト、飲食）、観測は276個のfloatの `Box`（自己、アビリティ、ターゲット、近くのモブ、最寄りのインタラクト対象、クエスト進捗）です。
- **報酬**はティックごとのカウンター差分（XP、与ダメージと被ダメージ、キル、デス、クエスト進捗、レベルアップ）の加重和で、リセットごとに調整できます。各 `step` は1つのアクションを適用し、デフォルトでsimを5ティック進めるので、シミュレートされた1秒あたりおおよそ4回の意思決定になります。
- **構造的に決定論的。** 壁時計もなく、`Math.random` もありません。リセットにシードを与えれば、エピソードはそのまま再生されます。

プロトコルとバインディングは `headless/CLAUDE.md` と `python/CLAUDE.md` に文書化されています。

<a id="web3"></a>

## Web3

World of ClaudeCraft は、Solana 上のコミュニティトークン **$WOC** を中心とした web3 ネイティブです。Solana ウォレットを接続し、署名一つでアカウントにリンクすると（ノンカストディアル、承認すべきトランザクションなし）、読み取り専用の $WOC 残高がコスメティックなホルダーティアバッジとともにHUDに表示されます。

これはコスメティックのみで、プレイに必要ではありません。ゲーム内で消費したり獲得したりするものは何もなく、pay-to-win はなく、ウォレットを一度も接続しなくてもゲームは問題なく遊べます。

**$WOC コントラクトアドレス（Solana）:**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

トークンの詳細は [worldofclaudecraft.com](https://worldofclaudecraft.com/) で。

## 世界をめぐる

### 9つのクラス

どのクラスも本物のバニラ風メカニクスを使い、レベル1から20を通じてランク付きの呪文を習得します（Lightning Bolt の R2 がレベル8、R3 がレベル14、R4 がレベル20で、Execute、Kidney Shot、Flash Heal、Stormstrike、Starfire のような高帯域のアビリティはそれぞれのクラシックなレベルで手に入ります）。

- **Warrior**: rage、Heroic Strike（次の一振りで発動、GCD外）、Battle Shout、Charge、Rend、Thunder Clap、Hamstring、Bloodrage、Overpower（回避時のプロック）。
- **Paladin**: Judgement で解き放つ Seal of Righteousness、Holy Light、Devotion Aura、Blessing of Might、Divine Protection（吸収）、Hammer of Justice（スタン）、Lay on Hands。
- **Hunter**: 遠隔の Auto Shot（クラシックなデッドゾーンつきで8から35 yd）、Raptor Strike、Aspect of the Hawk、Serpent Sting、Arcane Shot、Concussive Shot、Mongoose Bite、Wing Clip、そしてレベル10からテイム可能なペット。
- **Rogue**: energy とコンボポイント、Sinister Strike、Eviscerate、Backstab（背後、ダガー）、Gouge、Evasion、Slice and Dice、Sprint。
- **Priest**: Smite、Lesser Heal、Power Word: Fortitude、Shadow Word: Pain、Power Word: Shield（吸収）、Renew（HoT）、Mind Blast。
- **Shaman**: Lightning Bolt、Rockbiter Weapon（付呪）、Healing Wave、Earth Shock、Lightning Shield（とげ）、Flame Shock。
- **Mage**: Fireball、Frost Armor、Arcane Intellect、Frostbolt、Conjure Water、Fire Blast、Arcane Missiles（チャネル）、Polymorph、Frost Nova。
- **Warlock**: Shadow Bolt、Demon Skin、Immolate、Corruption、Life Tap、Curse of Agony、Drain Life、そして Imp から Doomguard まで召喚可能な7体の悪魔。
- **Druid**: Wrath、Healing Touch、Mark of the Wild、Moonfire、Rejuvenation、Thorns、Entangling Roots、レベル10で Bear Form。

ヒールとバフはパーティメンバーに届き、ヒールはクリティカルが出ることがあり、吸収シールドは体力より先にダメージを受け止めます。**クラスごとに3つのタレントスペック**（Arms/Fury/Protection、Balance/Feral/Restoration、など）にポイントを振り分けます。割り振りはサーバー検証され、ビルド文字列としてエクスポートできます。

### ダンジョン

Gravecaller のストーリーラインは4つの5人エリートインスタンスを貫き、探検者のためのソロの納骨堂が脇にひっそりと控えています。

- **the Hollow Crypt**（5人）は the Fallen Chapel の地下にあります。対になったエリートのトラッシュ、Sexton Marrow のミニボス、そして10秒ごとに Shadow Pulse の AoE を落とす Morthen the Gravecaller。納骨堂の扉はパーティをプライベートなインスタンスのコピーへとテレポートさせ、無人になって5分後にリセットします。
- **the Sunken Bastion**（5人、レベル13前後、Mirefen 南東）: Vael the Mistcaller が体力60%と30%で Drowned Thralls の波を召喚します。
- **Gravewyrm Sanctum**（5人、レベル20、Thornpeak の地下）: エリートの骨衛兵とドラコニッドの3つの部屋、Korgath the Bound（30%未満で激昂）、Grand Necromancer Velkhar、そしてエピック武器がドロップする Korzul the Gravewyrm。
- **the Drowned Temple**（5人）は Glimmermere のムーンゲートを抜けた先にあります。青白い月紫のインスタンスで、Choirmother Selthe を経て Ysolei, Avatar of the Drowned Moon へと続きます。彼女は9秒ごとに Lunar Tide を放ち、60%と30%で Moonspawn を召喚します。
- **the Abandoned Crypt**（ソロ）は Thornpeak にあります。一人のための静かなキーストーンと日誌の探索で、その足跡が **Nythraxis, Scourge of Thornpeak** への王室の扉を解錠します。これは3つの魂のワードストーンにまたがって戦う10人レイドのフィナーレです。

導入のクエストチェーンはソロで進められるので、ストーリーがグループ探しの壁の向こうに閉ざされることはありません。私たちの自動化された5体ボットのレイド（warrior、paladin、priest、mage、hunter、フォーカスファイアとヒーラーAIつき）は、the Hollow Crypt を約5分でクリアします（`node scripts/crypt_raid.mjs`、`ALLOW_DEV_COMMANDS=1` が必要）。

### Delve

Delve は1人または2人のプレイヤーのための、独立したスケーラブルな小規模パーティモードです。**The Collapsed Reliquary**（レベル7以上）は、毎回ランダム化された部屋から組み直される納骨堂で、Deacon Varric で終わります。ソロでこなすと、AIの相棒 Tessa があなたの隣で戦います。聖遺物庫の遺跡にいる Brother Halven が delve ボードを運営しており、Normal か Heroic かはあなた次第です。Heroic は敵のレベルを上げ、ランダムなアフィックスを加えて、より豊かな報酬をもたらします。

### the Ashen Coliseum（ランク制PvP）

`G` かアリーナボタンを押してキューに入ります。マッチメイキングが戦士たちをプライベートな松明の灯る闘技場へとテレポートさせ、短いカウントダウンで全員を回復・リセットして公平なスタートを切り、一方が1 hpで降参すると勝負が終わります。誰も死なず、キューに入ったまさにその場所に戻ります。

- **1v1と2v2のランクラダー**。それぞれに永続的なElo風レーティング（全員1500からスタート）と歴代リーダーボード（`GET /api/arena/leaderboard`）を備えています。
- **2v2 Fiesta**。より賑やかなパーティモードです。6分のキャップ内で先に15キルしたチームが勝ち、プレイヤーは伸びていくタイマーでリスポーンし、強化アイテムの取得が3つの波にわたって力をばらまき、閉じていくリングが戦いを一つに押し込めます。

### 一緒に遊ぶ

- **最大5人のパーティ**: プレイヤーを右クリックして Invite to Party。メンバーはタップ権とクエストの達成を共有し、本物のバニラのグループボーナス（3/4/5人で 1.166 / 1.3 / 1.43）でXPを分配し、ミニマップ上に点として表示されます。`/p` でパーティチャット、`/roll` で戦利品の決着。
- **トレード**: 右クリックして Trade。両者がアイテムと所持金を出し合い、両者が承認しなければならず、交換はアトミックでサーバー検証されます。クエストアイテムはトレードできず、離れて歩くとキャンセルされます。
- **決闘**: 右クリックして Challenge to a Duel。3秒のカウントダウンののち、一方が1 hpになるまで戦います。勝者はゾーン全体に告知され、60ヤード逃げると棄権になります。
- **タップ権と離席ステータス**: モブに最初にダメージを与えたプレイヤーがその戦利品、XP、クエストの達成を所有します。`/afk` と `/dnd` であなたを離席状態にし、ウィスパーに自動返信します。

### 世界とシステム

- **飲食**: 座ると18秒かけて回復し、ダメージや立ち上がりで中断されます。そう、飲み食いは同時にできます。
- **ベンダー**: 食料と水を買い取り、正直な白い装備を売ってくれます。コインはゴールド、シルバー、カッパーで表示されます。
- **モブAI**: 徘徊、レベル差による近接アグロ、ソーシャルプル、追跡、リーシュとリセット、死体の戦利品、リスポーン、そして長いタイマーのレアスポーン（Old Greyjaw）。
- **釣り**スポット。独自の戦利品テーブルとレアな釣果を備えています。
- **コスメティックスキン**。アンコモン、レア、エピックのレアリティで抽選され、純粋に見た目のためのものです。
- **死と復帰**: 魂を墓地に解き放ち、落下ダメージを受け、泳いでいる間は減速します。
- **バイオーム天候**: Vale は晴れ、Marsh は雨、Peaks は雪で、ゾーン間を移動するとクロスフェードします。

### 操作（クラシックレイアウト）

| 入力 | アクション |
|---|---|
| `W` / `S` | 前進 / 後退。`A`/`D` で旋回（右マウス押下中はストレイフ）、`Q`/`E` でストレイフ |
| 右ドラッグ / 左ドラッグ | マウスルック / カメラ周回。ホイールでズーム、`Space` でジャンプ |
| `Tab` | 最寄りの敵を順に選択。左クリックでターゲット、右クリックで攻撃、戦利品入手、会話 |
| `1`-`9`、`0`、`-`、`=` | アクションバー |
| `F` | インタラクト（死体の戦利品入手、オブジェクトの拾得、会話） |
| `C` `P` `L` `M` `B` `G` | キャラクター、呪文書、クエストログ、ワールドマップ、バッグ、アリーナ |
| `V` / `R` / `Esc` | ネームプレート、オートラン、ウィンドウを閉じる、またはターゲット解除 |

タッチ操作（移動スティック、カメラドラッグ、画面上のアクションボタン）はモバイルで自動的に表示されます。

## アーキテクチャ（一つのsim、三つのホスト）

このプロジェクトを結びつけている考え方は三つあります。

- **一つのsim、三つのホスト。** 同じ `src/sim/` のコードが、オフラインのブラウザ世界、オンラインサーバー、RL環境を動かします。挙動はどこでも同一でなければならず、テストはそれを保つために存在します。
- **`IWorld` が唯一の継ぎ目。** `src/world_api.ts` が `IWorld` を定義します。オフラインの `Sim` は構造的にそれを満たし、オンラインの `ClientWorld` はサーバースナップショットをミラーリングして実装します。レンダラーとHUDは `IWorld` だけと話し、具体的な世界とは決して話さないので、新機能はまずインターフェースを拡張し、それから両方の世界を実装します。
- **サーバーが権威を持つ。** クライアントは意図を送り、サーバーが結果を決めます。クライアントは戦闘、戦利品、経済を自分で解決することはありません。

simは固定20 Hzのティック（`DT = 1/20`）で、すべてのランダム性は一つのシード付き `Rng` を通って流れ、`src/sim/` はDOM、ブラウザ、Three.js のインポートを一切持ちません。それこそが、同じコードを Node の env サーバー、権威あるゲームループ、ブラウザのタブへと一行も変えずにバンドルできる理由です。

### プロジェクト構成

| パス | 内容 |
|---|---|
| `src/sim/` | 決定論的なゲームコア、真実の源。DOMもThreeの依存もなし。 |
| `src/sim/content/` | コードとしてのデータ: 9つのクラス、アビリティ、ゾーン、ダンジョン、アイテム、タレント。 |
| `src/render/` | Three.js レンダラー（手続き的なジオメトリ、テクスチャ、VFX）。世界を読むだけで、決して書き換えない。 |
| `src/game/` | ローカル入力、カメラ、キーバインド、モバイル操作、手続き的な WebAudio。 |
| `src/ui/` | クラシックHUD（フレーム、ウィンドウ、ツールチップ、マップ、フローティングコンバットテキスト）、手続き的アイコン、i18n。 |
| `src/net/` | オンラインクライアント: REST認証に加え WebSocket の世界ミラー（`ClientWorld`）。 |
| `src/admin/` | 管理ダッシュボードSPA（別の `admin.html` エントリ）。 |
| `server/` | 権威あるサーバー: HTTPとWS、世界ループ、Postgres、認証、ソーシャル、モデレーション。 |
| `headless/` + `python/` | RL env サーバー（`env_server.ts`）と Python Gym バインディング。 |
| `tests/` | Vitest スイート。 |
| `scripts/` | アセットビルドに加え、ブラウザE2E、スクリーンショット、統合スクリプト。 |
| `public/` · `docs/` | 静的アセット（GLBモデル、テクスチャ、HDRI）と設計ドキュメント。 |

ほとんどのディレクトリは独自の `CLAUDE.md` にローカルの慣習を備えています。プロジェクトの不変条件の全集合はルートの [`CLAUDE.md`](../../CLAUDE.md) にあります。

## クラシックそのままに作られている

戦闘、レベリング、脅威（threat）はすべて本物のクラシック時代のルールで動きます。rage と energy、命中と回避のテーブル、防具による軽減、本物のXPカーブ、スイングタイマー、グローバルクールダウン。近似ではなく、あなたの記憶のままに感じられます。正確な数値を読みたければ `src/sim/` にあります。

そしてそのほとんど何一つ出荷済みアセットではありません。世界はコードから描かれます。

- 手続き的な町、クリーチャー、地形、水、天候、リアルタイムの影。世界に3Dモデルファイルはありません。
- 12のリグ付きクリーチャー一族。歩行、攻撃、詠唱、着座、死亡のフルアニメーションつき。
- 呪文、アイテム、バフのアイコンは実行時にキャンバスに描かれます。
- 完全なクラシックHUD（ユニットフレーム、アクションバー、ツールチップ、クエストログ、ワールドマップ、ミニマップ、フローティングコンバットテキスト）と、あらゆるサウンドのための手続き的 WebAudio。

## 開発

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

ロジックとユニットのテストは Vitest を使います。イテレーション中は単一ファイルを実行してください: `npx vitest run tests/sim.test.ts`。E2Eとビジュアルのスクリプトは `puppeteer-core` で本物のブラウザを動かし、`npm run dev` が動いている必要があります（しばしば `npm run server` も）。ブラウザエージェントは、押しっぱなしのキーをシミュレートする代わりに `window.__game.controller` 経由で移動を駆動できます。たとえば `controller.move({ forward: true }, facingRadians)` や `{ f: 1, sr: 1 }` のようなコンパクトなフラグです。

サーバーコマンドについては上記の [オンライン開発](#develop-online-with-hot-reload) を、本番については [DEPLOY.md](../../DEPLOY.md) を、アセットライセンスについては [CREDITS.md](../../CREDITS.md) を参照してください。

## ローカライゼーション

プレイヤーに見えるすべての文字列は `t()` を通して解決され、ゲームは**21のロケール**で出荷されます（英語、2つのスペイン語、2つのフランス語、カナダ英語、イタリア語、ドイツ語、簡体字と繁体字の中国語、韓国語、日本語、ブラジルポルトガル語、ロシア語、オランダ語、ポーランド語、インドネシア語、トルコ語、スウェーデン語、ベトナム語、デンマーク語）。simとサーバーは言語非依存を保ちます。安定したキーか英語を発し、クライアントが境界で再ローカライズすることで、決定論を保ったままにします。コントリビューターは英語だけを追加し、メンテナーが各リリース前に他のロケールを一括で埋めます。ワークフローは `docs/i18n-scaling/translation-workflow.md` に文書化されています。

## コントリビュート

あらゆる種類の貢献を歓迎します。コード、翻訳、バグ報告、ドキュメント。まずはセットアップについて [CONTRIBUTING.ja_JP.md](CONTRIBUTING.ja_JP.md) から始め、[行動規範](../../CODE_OF_CONDUCT.md) を読み、脆弱性を報告する前に [SECURITY.md](../../SECURITY.md) を確認してください。初めてですか? [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue) のラベルが付いた issue を探すか、[issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) を立てるか、[Discord](https://discord.gg/GjhnUsBtw) で挨拶してください。

<div align="center">

![World of Claude](../../worldofclaude.png)

![World of ClaudeCraft community](../../woc_community.png)

</div>

## ライセンス

コードは [MITライセンス](../../LICENSE) です。フォークし、リミックスし、自分の世界をホストしてください。

同梱されているサードパーティのアートアセット（モデル、テクスチャ、HDRI）はそれぞれのライセンスを保ちます。MITの水のノーマルマップを除き、すべてCC0パブリックドメインで、パックごとに [CREDITS.md](../../CREDITS.md) に文書化されています。
