<div align="center">

# World of ClaudeCraft

**手作りの世界でクエストを進め、パーティを組み、レイドに挑もう。ブラウザで無料、オープンソース、web3対応、そして今すぐオンラインでプレイできます。**

**公式サイト: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.34.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.ja_JP.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · **日本語** · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[今すぐプレイ](https://worldofclaudecraft.com/) · [自分の世界をホストする](#host-your-own-world-one-command) · [エージェントを訓練する](#train-an-agent-headless-rl) · [Web3](#web3) · [コントリビュート](CONTRIBUTING.ja_JP.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft タイトル画面](../../docs/screenshots/title-screen.jpg)

</div>

## これは何か

World of ClaudeCraft は、今すぐブラウザでプレイでき、コマンド一つで自分でホストでき、さらにはAIエージェントにプレイを学習させることもできる、完全なクラシック時代のMMOです。無料でオープンソース、[worldofclaudecraft.com](https://worldofclaudecraft.com/) で稼働中です。

一つの共有された世界が、同じゲームコアから三つの場所で動きます。

- **権威ある（オーソリタティブな）マルチプレイヤーサーバー**。worldofclaudecraft.com で実際に遊べるライブな世界で、Postgres を背後に持つアカウントが一つの永続的なレルムを共有します。
- **オフラインのブラウザ世界**。開発サーバーから入れるローカルのシングルプレイヤー `Sim` で、開発にも、ゲームコアを端から端まで読むのにも役立ちます。
- **ヘッドレスのRL環境**。Python が Gym インターフェース越しに本物のゲームを動かします。

同じシードなら、どこでも同じ世界。目に見えるものの多くは今なお実行時にコードから描かれ、残りはプロジェクトに同梱される厳選済みのアセットセットなので、フォークしてもそのまま動きます。

## 主な特徴

- **9つのクラシッククラス**。それぞれにレベルアップで階位（ランク）を得る本格的なクラシック時代風のキットを備え、さらに完全な**タレントシステム**（クラスごとに3スペック、全27スペック）があります。
- **レベル1から20までの3つのオープンワールドゾーン**、90を超えるクエスト、そして Gravecaller の陰謀をめぐる一本につながったストーリーライン。
- **5つのインスタンスダンジョン**。うち4つは5人パーティのエリートレイド、1つはソロの納骨堂で、エリートスケーリング、AoEのボスメカニクス、ティアセットへとまとまるクラスアーキタイプ別の戦利品、そしてより豊かな報酬を持つ **Heroic 難易度ティア**を備えています。さらにオープンワールドの**ワールドボス**と10人レイドのフィナーレもあります。
- **2つのスケーラブルな delve**。1人または2人のプレイヤーとAIの相棒のための小規模パーティモードで、Normal と Heroic のティアにわたり、毎回ランダム化された部屋から組み直されます。
- **2つのアリーナマップにまたがるランク制PvP**。1v1と2v2のラダー、より賑やかな 2v2 Fiesta モード、そして3v3と5v5の objective モードである **Protect Yumi**。ランク戦は Honor を支払い、Honor は PvE でダンジョン装備を上回ることのない PvP 専用の装備セットと交換できます。
- **The Vale Cup**。Eastbrook の南にある専用スタジアムで行われる boarball リーグです。加えて **Card Duel**、町で開かれる手軽な一対一のカードゲーム。
- **A Book of Deeds**。コスメティックな称号、バッジの縁取り、Renown を集める実績ジャーナルで、ゲーム内の Chronicler NPC が保管するゾーンごとの Chronicles と、生涯リーダーボードを備えています。
- **奥深い専門技能の経済圏**。4つの採集技能が10の製作技能を支えます。料理や錬金術から、宝石細工、武器製作、エンチャントまで。段階的な道具、町の作業台、名匠品質、受注生産があり、そのすべてがプレイヤー主導の **World Market** と **Ravenpost** メールサービスへとつながります。
- **本物のマルチプレイヤー**。パーティとレイド、ギルド、トレード、決闘、タップ権、パーティ分配XP、ウィスパー、離席ステータス、そしてロールキューと事前編成の募集リストを備えた **Dungeon Finder**。
- **3Dエディタではなくコードで作られている**。地形、水、天候、町の配置、リアルタイムの影、エフェクトは実行時に生成され、同梱されるモデルも手作業の造形ではなく、手続き的なファクトリと厳選済みのアセットライブラリから作られています。
- **22のロケールにローカライズ**。決定論的な「simがキーを発する」パイプラインを通じて。
- **`/wiki` の付属wiki**。稼働中のゲームコンテンツから直接生成されるので、記述している世界とずれることがありません。
- **あらゆるプラットフォーム向けのネイティブアプリ**。Windows、Linux、macOS 向けの署名済みデスクトップインストーラーは自動更新と任意の Steam 実績ミラーリングに対応し、iOS と Android のビルドもあります。すべてがブラウザクライアントと同じオンライン世界を共有します。
- **手元のマシンに合わせてスケール**。グラフィックプリセットと自動フレームレートガバナーが、映像の豊かさと滑らかさを引き換えにします。ただし、プレイヤーが反応する情報を隠すことは決してない、という公平性ルールに縛られています。
- **ヘッドレスのRL環境**。Gymnasium バインディング、報酬整形、ベンチマークモードを備えています。
- **$WOC のユーティリティは完全に任意**。Solana ウォレットをリンクすると、ホルダー向けの装飾、Daily Rewards、コスメティックストアでの割引支払い手段が利用できます。ゲームは無料でプレイでき、ノンカストディアルのままです。
- **Season 1 Armory**。法定通貨、SOL、USDC、$WOC で購入した Claudium を使い、WOC Store でコスメティックな武器スキンを集められます。コスメティックが戦闘力をもたらすことはありません。

## スクリーンショット

![Eastbrook の町の広場、キャンプファイアとクエスト提供者](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Eastbrook のキャンプファイアの夕暮れ](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Eastbrook のキャンプファイアの夕暮れ* | ![the Hollow Crypt でのエリートプル](../../docs/screenshots/hollow-crypt.jpg)<br>*the Hollow Crypt の松明に照らされたエリートプル* |
| ![崩れた礼拝堂の安らげぬ死者](../../docs/screenshots/restless-dead.jpg)<br>*崩れた礼拝堂の安らげぬ死者* | ![Vale Bandits との乱闘](../../docs/screenshots/vale-bandits.jpg)<br>*盗賊のキャンプで多勢に無勢* |
| ![北の街道で討たれた Old Greyjaw](../../docs/screenshots/old-greyjaw.jpg)<br>*レアスポーンの Old Greyjaw、北の街道で討ち取られる* | ![ベンダーとバッグのUI](../../docs/screenshots/vendor-and-bags.jpg)<br>*Trader Wilkes の店で、ベンダーとバッグを開いて装備を整える* |
| ![Glimmermere の岸辺のムーンゲート](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Glimmermere のムーンゲートから這い上がる溺死者たち* | ![the Drowned Temple の祭壇上の Ysolei](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest と the Drowned Temple の祭壇* |

天候はバイオーム駆動かつレンダリングのみで、決定論的なsimには一切触れません。

| | | |
|:---:|:---:|:---:|
| ![Eastbrook Vale の晴天](../../docs/screenshots/weather-vale_clear.jpg)<br>*Vale の晴れ* | ![Mirefen Marsh の雨](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mirefen Marsh の雨* | ![Thornpeak Heights の雪](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Thornpeak Heights の雪* |

## プレイする

[worldofclaudecraft.com](https://worldofclaudecraft.com/) のブラウザで遊ぶか、Windows、Linux、macOS、iOS、Android 向けのネイティブアプリをインストールしてください。どのクライアントも同じオンライン世界に接続します。

### オンライン、他のプレイヤーと

アカウントを作成し、キャラクターを作成して、ライブな世界に入ります。同じクライアント/サーバー構成を自分で動かすには、下の [自分の世界をホストする](#host-your-own-world-one-command) を参照してください。

### オフライン、開発サーバーで

オフラインモードはアカウントもサーバー権威も持たないローカルのシングルプレイヤー世界なので、開発ビルドにのみ同梱されます。開発サーバーを起動すると、モード選択に現れます。

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

キャラクターに名前をつけ、9つのクラスのいずれかを選ぶと、**Eastbrook Vale**（レベル1から7）からスタートします。ここは複数の拠点に囲まれた市場町です。北には狼の通り道、東にはイノシシの草原、西には the Sableweb の森、北西には Mirror Lake、南西には穴掘りだらけの銅鉱の採掘場、北東には安らげぬ死者の崩れた礼拝堂、そして南東には Gorrak の盗賊キャンプがあります。北の街道は山道を登って **Mirefen Marsh**（6から13、拠点 Fenbridge）へ、さらに **Thornpeak Heights**（13から20、拠点 Highwatch）へと続きます。世界のシードは `src/main.ts` で固定されているので、訪れるたびに同じ場所です。

### Windows、Linux、macOS 向けデスクトップアプリ

World of ClaudeCraft は、主要な3つのデスクトッププラットフォームすべてに向けた完全なデスクトップアプリとして出荷されます。署名済みの Windows インストーラー、Linux の AppImage と deb パッケージ、そして署名と公証を済ませた macOS のユニバーサルビルドです。ブラウザと同じゲームクライアントとオンライン世界を、ネイティブのパッケージングと自動更新つきで使えます。

オンラインのサインインは Discord とメールのみで、まさにウェブと同じ流れです。メールとパスワードはアプリ内でログインし、「Continue with Discord」は既定のブラウザで `/desktop-login` ページを開きます。このページがワンタイムコードを `worldofclaudecraft://` のディープリンク経由でアプリに返し、アプリはそれを通常の World of ClaudeCraft のセッショントークンと交換します。

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

`VITE_DESKTOP_API_ORIGIN` でシェルを別のAPIに向けられます。たとえばローカルサーバーやステージングホストです。

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

ステージングビルドで本番のAPIオリジンを上書きするには `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` を使います（これはビルド時の値です。バンドルに焼き込まれてパッケージ済みアプリに刻まれるので、インストール済みビルドは実行時の環境変数としては無視します）。Steam は配布チャネルであり（同じ Electron バンドルを SteamPipe 経由でアップロードします）、デスクトッププレイヤーは Steam アカウントをリンクして、獲得した deed を Steam 実績にミラーリングできます。サインイン自体はメールと Discord のままです。リリースの完全な手順書（署名、公証、自動更新の公開、SteamPipe の depot、サーバーのデプロイ）は `docs/desktop-release.md` にあります。iOS と Android は Capacitor 経由で出荷され、専用の手順書が `docs/mobile-store-release.md` にあります。

<a id="host-your-own-world-one-command"></a>

## 自分の世界をホストする（コマンド一つ）

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

**リモートホスティング**の場合は、compose スタックを任意のVPSに置き、環境に本物の `POSTGRES_PASSWORD` を設定し、ポート8787の前段にTLSのリバースプロキシを立てます。Caddy なら数行で済みます。WebSocket は自動でプロキシされ、クライアントは https ページで `wss://` を自動選択します。認証エンドポイントはレート制限され、パスワードは scrypt でハッシュ化され、ログインセッションは失効します。本番では決して `ALLOW_DEV_COMMANDS=1` を設定しないでください。設定すると `/dev` のチート一式が有効になります。テストボットが使うレベルアップとテレポートのチートに加え、アイテムの付与、モブのスポーン、インスタンスへのテレポート、ゲーム内の dev コマンドGUIまで含まれます。[DEPLOY.md](../../DEPLOY.md) が本番運用の完全ガイドで、ヘルスとメトリクスのエンドポイントを公開エッジから遠ざけるリバースプロキシ設定も含まれています。

<a id="develop-online-with-hot-reload"></a>

### ホットリロードでオンライン開発

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

http://localhost:5173 を開き、**Play Online** を選び、アカウントを作成し、キャラクターを作成して Enter World を押します。キャラクター選択画面は News & Updates パネルに最新のリリースニュースを表示し、まだ見ていないものには NEW バッジが付きます。2つ目のタブを開いて再度ログインすると、町でお互いの姿が見えます。`Enter` でチャットが開きます。プレイヤーwikiはリポジトリ内の Guide で、http://localhost:5173/wiki で、本番では `/wiki` で提供されます。その内容は `npm run wiki:content` によって現在のゲームデータから生成されます。

何が永続化され、サーバーがどのように主導権を保つか。

- **アカウント**: scrypt でハッシュ化されたパスワードと、失効するベアラートークン。
- **キャラクター**: レルムごと、アカウントごとに最大10体。レベル、装備、バッグ、銀行の保管庫、クエスト、タレント、専門技能、PvPとdeedの進捗、位置、所持金は Postgres に JSONB として永続化され、一定間隔で、ログアウト時に、そしてサーバー停止時に保存されます。名前はレルム内で一意で、クラシックなスタイルです。
- **サーバーが権威を持つ**: クライアントは移動の意図とコマンドを20 Hzでストリーミングし、サーバーは一つの共有 `Sim` を動かして関心スコープのスナップショットとプレイヤーごとのイベントを返します。すべての戦闘判定、戦利品のドロップ、クエストの達成、ベンダー取引はサーバー側で解決されます。クライアントはレンダラーです。

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

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **観測空間とアクション空間はコンテンツ由来です。** 起動時に env の `info` 応答から問い合わせて取得し、ハードコードしないでください。これらはゲームとともに成長します。アクション空間は移動、ターゲット、攻撃、アビリティキット一式、インタラクト、飲食をカバーする `Discrete` で、観測は自己、アビリティ、ターゲット、近くのモブ、最寄りのインタラクト対象、クエスト進捗をカバーする `Box` です。
- **報酬**はティックごとのカウンター差分（XP、与ダメージと被ダメージ、キル、デス、クエスト進捗、レベルアップ）の加重和で、リセットごとに調整できます。各 `step` は1つのアクションを適用し、デフォルトでsimを5ティック進めるので、シミュレートされた1秒あたりおおよそ4回の意思決定になります。
- **構造的に決定論的。** 壁時計もなく、`Math.random` もありません。リセットにシードを与えれば、エピソードはそのまま再生されます。

プロトコルとバインディングは `headless/CLAUDE.md` と `python/CLAUDE.md` に文書化されています。

<a id="web3"></a>

## Web3

World of ClaudeCraft は、Solana 上のコミュニティトークン **$WOC** を中心とした web3 ネイティブです。Solana ウォレットを接続し、署名一つでアカウントにリンクすると（ノンカストディアル、承認すべきトランザクションなし）、読み取り専用の $WOC 残高がコスメティックなホルダーティアバッジとともにHUDに表示されます。

$WOC はライブなゲーム内でも任意のユーティリティを持ちます。

- **WOC Store**: 一方向のコスメティック通貨 Claudium を、法定通貨、SOL、USDC、$WOC で購入できます。$WOC の支払い経路は他より割安です。
- **Season 1 Armory**: Claudium をコスメティックな武器スキンのコレクションに使えます。ストアでの購入がステータスや戦闘力を加えることはありません。
- **Daily Rewards**: 認証済みの適格なホルダーは、デイリースピンと入れ替わるタスクでポイントを獲得し、その日の賞金プールの分け前を競えます。

どれもプレイに必要ではありません。ウォレットのリンクは任意かつノンカストディアルで、pay-to-win はなく、ウォレットを一度も接続しなくてもゲームは問題なく遊べます。

**$WOC コントラクトアドレス（Solana）:**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

トークンの詳細は [worldofclaudecraft.com](https://worldofclaudecraft.com/) で。

## 世界をめぐる

### 9つのクラス

どのクラスも原理から実装されたクラシック時代のMMOメカニクスで動き、レベル1から20を通じてランク付きの呪文を習得します。Low Blow、Early Grave、Skyfall、Urgent Prayer、Ancestral Strike といった代表的なアビリティは、登りの後半にかけて解放されていきます。

- **Warrior**: rage、Iron Bellow、Onrush、Quaking Blow、Maiming Strike、Gaping Wounds（攻撃に乗る出血）、Widening Arc、Hobbling Cut、Blood Toll、Redhand（回避時のプロック）。
- **Paladin**: Verdict で解き放つ Oathbrand、Mending Light、Steadfast Aura、Oath of Iron、Ward of Faith（吸収）、Sundering Gavel（スタン）、Last Rite。
- **Hunter**: 遠隔の通常攻撃（クラシック風のデッドゾーンつきで8から35 yd）、Gutting Strike、Harrier's Guise、Venom Barb、Fell Shot、Rattling Shot、Counterfang、Fettering Slash、そしてレベル10からテイム可能なペット。
- **Rogue**: energy とコンボポイント、Wicked Slash、Dirt Nap、Craven Thrust（背後、ダガー）、Eye Jab、Ghostfoot、Cutthroat Tempo、Swift Heels。
- **Priest**: Smite、Whispered Prayer、Litany of Resolve、Dirge of Decay、Psalm of Warding（吸収）、Lingering Grace（HoT）、Mindfracture。
- **Shaman**: Arc Bolt、Stonebound Weapon（付呪）、Mending Waters、Earthen Jolt、Thunder Ward（とげ）、Cinder Jolt。
- **Mage**: Cinderbolt、Hoarfrost Mantle、Aether Insight、Rimelance、Waterbind、Cinderfall、Aether Darts（チャネル）、Bewitch、Icebind、召喚する水のエレメンタル、そして時間魔法のヒールスペックである Chronomancy。
- **Warlock**: Gloom Bolt、Fiendhide、Burning Pact、Blackrot、Hard Bargain、Hex of Anguish、Consume、そして Emberkin から Wraithborn まで召喚可能な7体の悪魔。
- **Druid**: Wildbolt、Wildmend、Wildward、Lunar Tempest、Wildbloom、Briarguard、Gripping Roots、そしてレベル5で Wolf Form、8で Bruin Form、10で Moonwing Form への変身。

ヒールとバフはパーティメンバーに届き、ヒールはクリティカルが出ることがあり、吸収シールドは体力より先にダメージを受け止めます。**クラスごとに3つのタレントスペック**（Battlecraft/Bloodrush/Ironguard、Moongrove/Wildfang/Groveheart、など）にポイントを振り分けます。割り振りはサーバー検証され、ビルド文字列としてエクスポートできます。

### ダンジョン

Gravecaller のストーリーラインは3つの5人エリートインスタンスを貫き、4つ目はムーンゲートの向こうで独自の溺死の伝承とともに待ち、探検者のためのソロの納骨堂が脇にひっそりと控えています。

- **the Hollow Crypt**（5人）は the Fallen Chapel の地下にあります。対になったエリートのトラッシュ、Sexton Marrow のミニボス、そして繰り返し影のAoEを落とす Morthen the Gravecaller。納骨堂の扉はパーティをプライベートなインスタンスのコピーへとテレポートさせ、無人になるとリセットします。
- **the Sunken Bastion**（5人、レベル13前後、Mirefen 南東）: Vael the Fogbinder が戦いの長期化とともに Drowned Thralls の波を召喚します。
- **Gravewyrm Sanctum**（5人、レベル20、Thornpeak の地下）: エリートの骨衛兵と鱗衛兵の3つの部屋、Korgath the Bound、Grand Necromancer Velkhar、そしてエピック武器がドロップする Korzul the Gravewyrm。
- **the Drowned Temple**（5人）は Glimmermere のムーンゲートを抜けた先にあります。青白い月紫のインスタンスで、Choirmother Selthe を経て Ysolei, Avatar of the Drowned Moon へと続きます。彼女の月の潮と召喚する Moonspawn は、立ち止まったグループを罰します。
- **the Abandoned Crypt**（ソロ）は Thornpeak にあります。一人のための静かなキーストーンと日誌の探索で、その足跡が **Nythraxis, Scourge of Thornpeak** への王室の扉を解錠します。これは3つの魂のワードストーンにまたがって戦う10人レイドのフィナーレです。

どのインスタンスも **Heroic** で動きます。より高レベルの敵、より鋭いメカニクス、そして独自の戦利品とベンダー通貨があります。導入のクエストチェーンはソロで進められるので、ストーリーがグループ探しの壁の向こうに閉ざされることはありません。私たちの自動化された5体ボットのレイド（warrior、paladin、priest、mage、hunter、フォーカスファイアとヒーラーAIつき）は、the Hollow Crypt を約5分でクリアします（`node scripts/crypt_raid.mjs`、`ALLOW_DEV_COMMANDS=1` が必要）。

### Delve

Delve は1人または2人のプレイヤーのための、独立したスケーラブルな小規模パーティモードです。毎回ランダム化された部屋から組み直され、戦利品の抽選ではなく鍵開けのミニゲームで開く、施錠された聖遺物箱で終わります。**The Collapsed Reliquary**（レベル7以上）は Deacon Varric で終わり、ソロでこなすと、AIの相棒 Tessa があなたの隣で戦います。**The Drowned Litany**（レベル12以上）は、その足跡をたどって Mirefen Marsh の縁にある水没した聖域へと向かいます。delve ボードがティアを決めます。Heroic は敵のレベルを上げ、ランダムなアフィックスを加えて、より豊かな報酬をもたらします。

### ランク制PvP（the Ashen Coliseum）

`G` かアリーナボタンを押してキューに入ります。マッチメイキングが戦士たちをプライベートな闘技場へとテレポートさせ、短いカウントダウンで全員を回復・リセットして公平なスタートを切り、一方が降参すると勝負が終わります。誰も死なず、キューに入ったまさにその場所に戻ります。Protect Yumi は Coliseum の闘技場ではなく、専用の迷路で戦われます。

- **1v1と2v2のランクラダー**。それぞれに永続的なElo風レーティングと歴代リーダーボードを備えています。
- **2v2 Fiesta**。より賑やかなパーティモードで、チームは撃破数の目標を目指して競い、強化アイテムの取得が力をばらまき、閉じていくリングが戦いを一つに押し込めます。
- **Protect Yumi**。迷路で戦われるレーティングなしの3v3と5v5の objective モードです。各チームは猫の使い魔を守りながら相手の使い魔を倒そうとするので、純粋なキル数よりも護衛と狙い撃ちが重要になります。

ランク戦の勝利と Fiesta の撃破は **Honor** を支払い、町の補給官が Honor を Warfare 装備一式と交換してくれます。Warfare は PvP 専用のステータスなので、この装備は決闘で勝ちつつ、PvE では同ティアのダンジョン装備を上回ることがありません。

### 一緒に遊ぶ

- **Dungeon Finder**: `Shift+I` で開いてダンジョンとレイドを見て回り、ボスと戦利品を調べ、自動のタンク/ヒーラー/DPSロールキューに参加するか、事前編成の募集を出します。Finder で組まれたグループも、入口までは一緒に移動します。
- **最大5人のパーティ**。満員になると2グループからなる10人レイドに変換されます。プレイヤーを右クリックして Invite to Party。メンバーはタップ権とクエストの達成を共有し、クラシック時代のグループボーナスでXPを分配し、ミニマップ上に点として表示されます。`/p` でパーティチャット、`/roll` で戦利品の決着。
- **トレード**: 右クリックして Trade。両者がアイテムと所持金を出し合い、両者が承認しなければならず、交換はアトミックでサーバー検証されます。クエストアイテムはトレードできず、離れて歩くとキャンセルされます。
- **決闘**: 右クリックして Challenge to a Duel。3秒のカウントダウンののち、一方が1 hpになるまで戦います。勝者はゾーン全体に告知され、60ヤード逃げると棄権になります。
- **タップ権と離席ステータス**: モブに最初にダメージを与えたプレイヤーがその戦利品、XP、クエストの達成を所有します。`/afk` と `/dnd` であなたを離席状態にし、ウィスパーに自動返信します。

### 世界とシステム

- **専門技能**（`Shift+P`）: 4つの採集技能（採掘、伐採、薬草学、釣り）が10の製作技能を支えます。料理や錬金術から、武器製作、宝石細工、エンチャントまで。採集道具にはどのノードを扱えるかを決めるティアがあり、製作は町の作業台で行われ、作り手の刻印を帯びた名匠品質になる可能性があります。さらに、専門化を進めるにつれて見つかるアーキタイプのシステムもあります。
- **The World Market**: 装備、素材、消耗品のためのプレイヤー主導のオークションハウスで、拠点の町から閲覧できます。
- **Ravenpost メール**: 他のキャラクターにアイテムやコインを送れます。添付は受け取られるまで安全に保管されます。
- **ギルド**: 憲章、名簿、階級、ギルドチャット。
- **The Guide**: `/wiki` にある検索可能なサイト内wikiで、クラス、クリーチャー、ゾーン、deed を扱います。稼働中のゲームコンテンツから直接生成されるので、記述している世界とずれることがありません。
- **The Vale Cup と Card Duel**: Eastbrook の南、Sowfield スタジアムでの boarball を 1v1 から 5v5 までの形式で。そして町の Card Master が開く、手軽な一対一のカードゲーム。
- **Daily Rewards**: 認証済みの $WOC ホルダーは、デイリースピンと入れ替わるタスクでリーダーボードのポイントを獲得でき、その日の賞金プールから自動で支払われます。
- **WOC Store と Season 1 Armory**: 法定通貨、SOL、USDC、$WOC で Claudium を購入し、純粋にコスメティックな武器スキンに使えます。
- **飲食**: 座って回復し、ダメージや立ち上がりで中断されます。そう、飲み食いは同時にできます。
- **ベンダー**: 食料と水を買い取り、正直な白い装備を売ってくれます。コインはゴールド、シルバー、カッパーで表示されます。
- **個人の銀行**（the Gilded Strongbox）: 各拠点の町の出納係がキャラクターごとに保管庫を預かります。24スロットから、コインで購入する拡張で96スロットまで。さらに、認証済みメール、アカウント連携、紹介によってオンラインで獲得できるボーナススロットもあります。
- **The Book of Deeds**: クエスト、討伐、クリア、そして小さな喜びの実績ジャーナル（既定は `Shift+Z`）で、ネームプレート、チャット、掲示板で身につけられるコスメティックな称号を支払います。追いかけている deed のためのHUDトラッカー、Chronicler NPC が保管するゾーンごとの Chronicles、生涯 Renown リーダーボードもあります。公開リストは `/wiki/deeds` にあります。
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
| `C` `P` `L` `M` `B` `N` `T` | キャラクター、呪文書、クエストログ、ワールドマップ、バッグ、タレント、製作 |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | アリーナ、フレンドとギルド、リーダーボード、カレンダー、Vale Cup、Dungeon Finder、専門技能、deed |
| `Z` / `X` | 武器の収納または抜刀、エモートホイール |
| `V` / `R` / `Esc` | ネームプレート、オートラン、最前面のウィンドウを閉じる（またはゲームメニューを開く） |

すべてのバインドはキーバインドパネルで再割り当てできます。タッチ操作（移動スティック、カメラドラッグ、画面上のアクションボタン）はモバイルで自動的に表示されます。

## アーキテクチャ（一つのsim、三つのホスト）

このプロジェクトを結びつけている考え方は三つあります。

- **一つのsim、三つのホスト。** 同じ `src/sim/` のコードが、オフラインのブラウザ世界、オンラインサーバー、RL環境を動かします。挙動はどこでも同一でなければならず、テストはそれを保つために存在します。
- **`IWorld` が唯一の継ぎ目。** `IWorld` は `src/world_api/` 配下のドメインごとのファセットインターフェースとして定義され、`src/world_api.ts` が集約します。オフラインの `Sim` は構造的にそれを満たし、オンラインの `ClientWorld` はサーバースナップショットをミラーリングして実装します。レンダラーとHUDは `IWorld` だけと話し、具体的な世界とは決して話さないので、新機能はまず対応するファセットを拡張し、それから両方の世界を実装します。
- **サーバーが権威を持つ。** クライアントは意図を送り、サーバーが結果を決めます。クライアントは戦闘、戦利品、経済を自分で解決することはありません。

simは固定20 Hzのティック（`DT = 1/20`）で、すべてのランダム性は一つのシード付き `Rng` を通って流れ、`src/sim/` はDOM、ブラウザ、Three.js のインポートを一切持ちません。それこそが、同じコードを Node の env サーバー、権威あるゲームループ、ブラウザのタブへと一行も変えずにバンドルできる理由です。

### プロジェクト構成

| パス | 内容 |
|---|---|
| `src/sim/` | 決定論的なゲームコア、真実の源。DOMもThreeの依存もなし。 |
| `src/sim/content/` | コードとしてのデータ: 9つのクラス、アビリティ、ゾーン、ダンジョン、delve、アイテム、レシピ、エンチャント、タレント、専門技能、deed。 |
| `src/world_api.ts` + `src/world_api/` | `IWorld`。レンダラーとHUDが依存する継ぎ目で、ドメインごとに1つのファセットインターフェース。 |
| `src/`（その他） | Three.js レンダラー、HUDとスタイル、入力と音声、オンラインミラー、そして管理、Guide、エディタのSPA。 |
| `server/` | 権威あるサーバー: HTTPとWS、世界ループ、Postgres、認証、ソーシャル、モデレーション。 |
| `server/http/` | RESTリクエストのパイプライン: テーブルルーター、ミドルウェア、ドメインごとのルート定義。 |
| `headless/` + `python/` | RL env サーバー（`env_server.ts`）と Python Gym バインディング。 |
| `bot/` | Discord ボット（ロール、リレー、アクティビティフィード）。 |
| `electron/`、`android/`、`ios/` | デスクトップ（Steam）とネイティブモバイルのシェル。 |
| `tests/` | Vitest スイート。 |
| `scripts/` | ビルド、アセット、i18n、SFX、スクリーンショット、ブラウザE2Eのツール群。 |
| `deploy/` · `mediawiki/` | 本番の初回起動アセットと、プレイヤーwikiのコンテナ。 |
| `public/` · `docs/` | 静的アセット（サイトへそのままデプロイされます）と設計ドキュメント。 |

これは自己申告制ではありません。`tests/architecture.test.ts` がすべてのsimファイルを走査して、禁じられたインポート、DOMのグローバル、紛れ込んだ時計や `Math.random` の呼び出しを探し、`tests/world_api_parity.test.ts` が継ぎ目を固定して二つの世界がずれないようにします。

ほとんどのディレクトリは独自の `CLAUDE.md` にローカルの慣習を備えており、プロジェクトの不変条件の全集合はルートの [`CLAUDE.md`](../../CLAUDE.md) にあります。エージェントのコントリビューターはそこから始め、それぞれのランタイムのエントリポイントを手に取ります。Codex なら [`AGENTS.md`](../../AGENTS.md) と [Codex オペレーターガイド](../codex.md)、Gemini なら [`GEMINI.md`](../../GEMINI.md) です。いずれも同じ正典のアーキテクチャへとつながります。

## クラシックそのままに作られている

戦闘、レベリング、脅威（threat）はすべて本物のクラシック時代のルールで動きます。rage と energy、命中と回避のテーブル、防具による軽減、本物のXPカーブ、スイングタイマー、グローバルクールダウン。近似ではなく、あなたの記憶のままに感じられます。正確な数値を読みたければ `src/sim/` にあります。

世界は3Dエディタではなくコードで作られており、それがこのプロジェクトを小さく、決定論的で、フォークしやすいものに保っています。

- 地形、水、天候、空、町の配置、リアルタイムの影、戦闘エフェクトは、simが持つデータから実行時に生成されます。
- 同梱されるモデルも同じやり方で作られます。`scripts/assets/` 配下の手続き的なファクトリが、プロジェクトの image-to-GLB パイプラインを通して決定論的なGLBを書き出し、そこに厳選されたCC0のモデルキットのライブラリが加わります。リグ付きのクリーチャーとキャラクターの一族には、歩行、攻撃、詠唱、着座、死亡のフルアニメーションが付いています。
- アイコンは層を重ねるペインターで、同梱ファイルがないものにも絵を組み立てるので、アイコンが欠けることは決してありません。アビリティ、アイテム、deed にはその上に厳選された描き下ろしのアートが重ねられます。
- 完全なクラシックHUD（ユニットフレーム、アクションバー、ツールチップ、クエストログ、ワールドマップ、ミニマップ、フローティングコンバットテキスト、The Book of Deeds）、サンプリングされた空間音と操作音、そしてリポジトリ内で手続き的に作曲され、ゾーン、町、ダンジョン、戦闘の間をクロスフェードするストリーミングのリマスターとして出荷されるサウンドトラック。

同梱されるすべてのアセットとそのライセンスは [CREDITS.md](../../CREDITS.md) に記録されており、同梱されるサードパーティの依存関係はその告知を [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) に持ちます。

## 開発

ゲームクライアントのほかに、ビルドはオペレーターダッシュボード、`/editor` のワールドエディタ、`/wiki` の公開 Guide を生成します。どれも同じ開発サーバーから提供されます。

ゲートと音声テストが通るFFmpegの経路はすべて、同梱の `ffmpeg-static`/`ffprobe-static` npm パッケージを解決するので、通常のコントリビュートにシステムのFFmpegインストールは不要です。適合性を測る経路（`npm run sfx:check`、音声テスト、Studio のエクスポート検証）は静的バイナリに直接バインドし、`PATH` へのフォールバックはありません。scripts をスキップしたインストールでそれらが欠けている場合は `npm ci` を再実行してください。Studio の再生とエンコードのプロセス生成、そして `npm run gate` のプリフライトは `scripts/sfx/ffmpeg_paths.mjs` 経由で解決し、こちらは `PATH` にフォールバックします。一部の単体の音声生成スクリプト（たとえば `scripts/gen_ui_sfx.mjs`）は今も既定で `PATH` の `ffmpeg` を使います。

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

ロジックとユニットのテストは Vitest を使います。イテレーション中は単一ファイルを実行してください: `npx vitest run tests/sim.test.ts`。インターフェースの変更には、アクセシビリティ、キーボードナビゲーション、タッチターゲットを対象とする任意参加の実ブラウザスイートもあります: `npm run test:browser`。スクリーンショットとスモークのスクリプトは `puppeteer-core` で本物のブラウザを動かし、`npm run dev` が動いている必要があります。ワイヤーレベルのスクリプト（`mp_integration.mjs`、`social_e2e.mjs`、`crypt_raid.mjs`）はサーバーと直接話すので、代わりに `npm run server` が必要です。ブラウザエージェントは、押しっぱなしのキーをシミュレートする代わりに `window.__game.controller` 経由で移動を駆動できます。たとえば `controller.move({ forward: true }, facingRadians)` や `{ f: 1, sr: 1 }` のようなコンパクトなフラグです。

チェックは層をなして実行されます。詳細は [docs/qa-gate.md](../qa-gate.md) にあります。`git config core.hooksPath .githooks` でクローンを共有フックに向ければ、何かがマシンを離れる前に高速な最低限のチェックが走ります。

サーバーコマンドについては上記の [オンライン開発](#develop-online-with-hot-reload) を、コントリビュートの流れについては [CONTRIBUTING.ja_JP.md](CONTRIBUTING.ja_JP.md) を、サウンドの制作と成果物のエクスポートについては [SFX Studio チュートリアル](../sfx-studio-tutorial.md) を、本番については [DEPLOY.md](../../DEPLOY.md) を、アセットライセンスについては [CREDITS.md](../../CREDITS.md) を参照してください。

## ローカライゼーション

プレイヤーに見えるすべての文字列は `t()` を通して解決され、ゲームは**22のロケール**で出荷されます（英語、2つのスペイン語、2つのフランス語、カナダ英語、イタリア語、ドイツ語、簡体字と繁体字の中国語、韓国語、日本語、ブラジルポルトガル語、ロシア語、チェコ語、オランダ語、ポーランド語、インドネシア語、トルコ語、スウェーデン語、ベトナム語、デンマーク語）。simとサーバーは言語非依存を保ちます。安定したキーか英語を発し、クライアントが境界で再ローカライズすることで、決定論を保ったままにします。コントリビューターは英語だけを追加し、メンテナーが各リリース前に他のロケールを一括で埋めます。ワークフローは `docs/i18n-scaling/translation-workflow.md` に文書化されています。

## コントリビュート

あらゆる種類の貢献を歓迎します。コード、翻訳、バグ報告、ドキュメント。まずはセットアップについて [CONTRIBUTING.ja_JP.md](CONTRIBUTING.ja_JP.md) から始め、[行動規範](../../CODE_OF_CONDUCT.md) を読み、脆弱性を報告する前に [SECURITY.md](../../SECURITY.md) を確認してください。初めてですか? [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue) のラベルが付いた issue を探すか、[issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) を立てるか、[Discord](https://discord.com/invite/worldofclaudecraft) で挨拶してください。

活発な開発は最新の `release/vX.Y.Z` ブランチで進みます。決め打ちにせず自分で確認したうえで、そのブランチから分岐し、プルリクエストもそこに向けてください。`main` から分岐したり `main` を対象にしたりは決してしないでください。`main` はそのバージョンが出荷されたときにリリースブランチを受け取るだけです。現在のブランチを見つける一行のコマンドは [CONTRIBUTING.md](CONTRIBUTING.ja_JP.md) にあります。

## ライセンス

**コードは [MITライセンス](../../LICENSE) です。フォークし、リミックスし、自分の世界をホストしてください。** それがこのプロジェクトの眼目であり、このページやウェブサイトの他のどこにも、それを取り消すものはありません。

3つのものは別々にライセンスされているので、どれがどれなのかを知るのに30秒かける価値があります。

| 対象 | ライセンス | 再配布できますか? |
|---|---|---|
| **ソースコード**。つまり、下で切り出されるメディアアセット以外のすべて | [MIT](../../LICENSE) | できます。商用でも。 |
| **メディアアセット**: モデル、テクスチャ、HDRI、アイコン、サウンド、フォント（主に `public/` 配下） | アセットごとに [CREDITS.md](../../CREDITS.md) に記録 | 多くはできます（ほとんどがCC0）。できないものもあります、下記参照。 |
| **名称とブランディング**: 「World of ClaudeCraft」、「Levy Street」、ロゴ | ライセンスされていません | できません。 |

**フォークして自分の世界をホストしてください。それは動きますし、アセットが邪魔をすることもありません。** 目に見えるもののほとんどはCC0のパブリックドメイン（KayKit、Quaternius、Kenney、ambientCG、Poly Haven）で、私たち自身が生成した小物、クリーチャー、背景、インターフェースのサウンドはプロジェクトに同梱されるので、フォークしてもそのまま動きます。ただし、それらを抜き出して単独のアートとして売ることはできません。

再配布の前に取り除くか差し替える必要があるものは次のとおりです。

- `public/ui/skills/` 配下の **CraftPix のクラスアビリティアイコン**は Levy Street が購入したもので、**再配布できません**。出荷したい場合は自分でライセンスを購入してください。
- **@jamiecypher のサウンドエフェクト**は CC BY-NC 4.0 なので、クレジットを付けて非商用で共有してください。商用の許諾はこのプロジェクトに限られます。
- **ストアと prestige のアート**（Season 1 Armory、Claudium のセット、専門技能のアートセット、The Book of Deeds のアイコン、エリートドラゴンの紋章）は委託された商用アートで、**権利は留保されています**。
- **サードパーティのブランドマーク**（Twitch、X、Kick、YouTube、Discord、Solana、USDC）はそれぞれの所有者の商標であり、私たちが再ライセンスできるものではありません。
- **許可を得て使用しているアイコンと録音**がいくつかあり、それらを渡すには許可が必要です。

[CREDITS.md](../../CREDITS.md) が正式な一覧で、アセットごとに再配布の列があります。あるアセットがそこに載っている場合、そのライセンスがプロジェクトのMITライセンスに優先します。この登録簿はまだ整備中なので、そこに見当たらないメディアアセットは自由なのではなく未記録なのです。頼りにする前に確認してください。ソースコードは逆で、切り出されていないものはすべてMITです。

私たちの [利用規約](https://worldofclaudecraft.com/terms) は、worldofclaudecraft.com で私たちが運営するホスト版のゲーム（アカウント、行為、仮想アイテム）を対象とします。このソースコードにおいてMITライセンスがあなたに与える権利を制限するものではありません。
