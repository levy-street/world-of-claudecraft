<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · **日本語** · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# World of ClaudeCraft への貢献

まずは、ここに来てくれてありがとうございます。World of ClaudeCraft は、クラシックな MMO を愛する人々のコミュニティによって作られています。そして、大きなものでも小さなものでも、すべての貢献がこのゲームをより良くしてくれます。誤字の修正、ゲームの翻訳、バグの報告、まったく新しいダンジョンの構築。そのどれもが大切な貢献であり、あなたを心から歓迎します。

このガイドは、開発環境のセットアップと、最初の貢献をスムーズに進めるためのものです。専門家である必要はありません。わからないことがあれば、[Discord](https://discord.com/invite/worldofclaudecraft) で気軽に聞いてください。誰かが喜んで力になってくれます。

参加にあたっては、[行動規範](../../CODE_OF_CONDUCT.md)に従うことに同意したものとみなされます。

## 貢献の方法

ここには、誰にでも活躍できる場所があります。

- **コード。** バグを直したり、機能を追加したり、パフォーマンスを改善したり。
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  や [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  のラベルが付いた issue は、始めるのにぴったりです。
- **翻訳。** ある言語を改善したり完成させたりして、世界中のプレイヤーの助けになりましょう。下の[ゲームの翻訳](#translating-the-game)を参照してください。これは最も手軽に始められ、しかも影響の大きい貢献のひとつです。
- **バグ報告や機能のアイデア。** [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) を立ててください。わかりやすいバグ報告は、それ自体が立派な貢献です。
- **ドキュメント。** このガイドのような文書、README、`docs/` にある設計ドキュメントは、いつでも改善の余地があります。
- **プレイテストとフィードバック。** 実際にゲームを遊んで、違和感のあるところを教えてください。アイデアは Discord で共有してください。

## はじめに

[Node.js 26](https://nodejs.org/) と **pnpm 10.34.x** が必要です（正確なピンは `package.json` の `packageManager`、現在は `pnpm@10.34.5`）。それより古い Node のメジャーバージョンは検証されていません。マルチプレイヤーサーバーを動かすには、Postgres を実行するための [Docker](https://www.docker.com/) も用意してください。

**Corepack は必須ではありません。** Node 同梱の npm で pnpm を一度だけインストールします。手順は macOS / Linux / Windows で同じです。

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

pnpm でインストールしたあとも `npm run <script>` は使えます（Node が npm を同梱するため）が、**依存関係のインストールと lockfile の更新は必ず pnpm 経由**にしてください。`package-lock.json` をコミットしないでください。唯一の正は `pnpm-lock.yaml` です。

オフラインの世界で遊んだり、ほとんどの作業を進めたりするには、これだけで十分です。オンラインのフルスタックを実行するには、まず環境変数にデータベースのパスワードを設定する必要があります。

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
pnpm run db:up       # start Postgres 16 in Docker (dev DB on port 5433)
pnpm run server      # build and run the authoritative game server on :8787
pnpm run dev         # in another terminal; the client proxies to the server
```

下記のゲートをすべて実行するつもりなら、そこで使われるブラウザを一度インストールしておいてください。`pnpm exec playwright install chromium` です。

[README](../../README.md) には、ホスティング、開発、プレイの完全なガイドがあります。また、リポジトリ全体に置かれた `CLAUDE.md` ファイルが、各領域の慣習を説明しています。

### TypeScript のツールチェーン

型チェックはネイティブコンパイラである TypeScript 7 で動きます。`npx tsc --noEmit` はこれまでとまったく同じように使え、リポジトリ全体のチェックは数十秒ではなく数秒で終わります。インストール構成は公式のデュアルエイリアスです。`svelte-check` が今も TypeScript 6 の JS API を必要とするため、`typescript` パッケージは（`@typescript/typescript6` ラッパー経由で）その API を解決し、`tsc` バイナリは `@typescript/native` が提供します。押さえておきたい点は次のとおりです。

- **エディター。** VS Code では、組み込みのサポートが出荷されるまでの間、ネイティブ言語サービスを使うために「TypeScript 7」マーケットプレイス拡張（`TypeScriptTeam.native-preview`）が必要です。切り替えは `js/ts.experimental.useTsgo` 設定で行い、その「Disable TypeScript 7 Language Server」コマンドが TypeScript 6 の tsserver へ戻る公式な手段です。JetBrains の IDE は `@typescript/native-preview` というパッケージ名でしかネイティブサーバーを自動検出しないため、このリポジトリの `@typescript/native` エイリアスからは認識しません。IDE に同梱された TypeScript 6 のサポートで問題なく動きます。
- **役に立つ tsc のフラグ。** `--checkers N` は型チェッカーの並列ワーカー数を指定します（既定は 4 で、いくつにしても結果は同一です）。制約の厳しいランナーではメモリを抑えるために下げ、コア数の多いマシンでは上げてください。ただし多いほど速いとは限らないので、どちらの場合も実測してください。`--singleThreaded` は並列処理をすべて無効にします。単一ファイルをその場でチェックする（`npx tsc somefile.ts`）と、そのディレクトリに `tsconfig.json` があるときはエラーになります。従来の挙動が必要なら `--ignoreConfig` を渡してください。
- **ロックファイル。** ロックファイルは `pnpm-lock.yaml` です（pnpm 10 / lockfileVersion 9）。更新はリポジトリルートで `pnpm install` / `pnpm add` / `pnpm update` のみ（手編集禁止）。`package.json` の変更と一緒に `pnpm-lock.yaml` をコミットしてください。CI は `pnpm install --frozen-lockfile` で入れます。古い lockfile は失敗します。第二の lockfile（`package-lock.json` / yarn.lock）を持ち込まないでください。二重 lockfile は静かに食い違い、禁止されています。任意の wallet/solana ツリー由来の peer 依存ノイズは `.npmrc` の `strict-peer-dependencies=false` で許容します。測定なしにさらに緩めないでください。
- **見直す時期。** デュアルエイリアスを単一の `typescript` 依存へ戻すのは、次の両方が満たされたときです。TypeScript 7.1 の安定版 JS API が出荷されること（TypeScript 7.0 は JS API をまったく提供せず、その代替は microsoft/typescript-go の issue 2824 で追跡されています）。そして sveltejs/language-tools の issue 3063 がクローズし、それを採用した `svelte-check` がリリースされること。svelte-check の実験的な `--tsgo` モードは TypeScript 6 API の要件を解消しません。また進行中の TypeScript 7 読み込み対応（language-tools の PR 3073）は、このリポジトリがすでに使っている `@typescript/native` エイリアスを読むため、名前の変更は不要です。

## 変更を加える

1. **最新のリリースブランチから始めてください。`main` からは決して始めないでください。** 作業は `release/vX.Y.Z` ブランチ上で統合されます。`main` はその後を追うブランチであり、貢献のベースではありません。最新のものを見つけて、そこから分岐してください。

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   このガイドからバージョン番号をそのまま写すのではなく、必ずこの確認を実行してください。リリースブランチは頻繁に入れ替わり、最新のものはリリースのたびに移り変わります。ブランチ名は `feature/<short-slug>` または `fix/<short-slug>` です。
2. **コミットは目的を絞ったものに。** 小さく、ひとまとまりになった変更は、大きなものよりもレビューやマージがしやすくなります。
3. **テストを追加または更新します。** `src/sim/` や `server/` で挙動を変えたときは、必ずテストも合わせて用意してください。
4. **プレイヤーに見える文字列は翻訳可能に保ちます。** [ローカライズ](#localization)と[ゲームの翻訳](#translating-the-game)を参照してください。

### 心に留めておきたいこと

これらはコードベースの根幹をなすルールです。詳細はルートの [`CLAUDE.md`](../../CLAUDE.md) にありますが、要点は次のとおりです。

- **シミュレーションコア（`src/sim/`）が信頼できる唯一の情報源です。** ここは純粋に保たれ、DOM、ブラウザ、Three.js のインポートを一切含みません。だからこそ、まったく同じコードがオフライン、サーバー、ヘッドレスの RL 環境で動きます。
- **シミュレーションは決定的です。** 固定された 20 Hz のティックで動き、すべての乱数は `Rng` を通します。シミュレーションのロジックでは `Math.random`、`Date.now`、`performance.now` を決して使いません。同じシードからは、常に同じ世界が生まれます。
- **ゲームプレイの計算はクラシック時代の MMO の公式に従います**（レイジ、ヒットテーブル、アーマー、XP カーブなど）。バランスの数値を勝手に作り出さないでください。代わりに公式を引用してください。
- **新しいロジックは、既存のシームの背後に置かれた、小さくテスト済みの独立したモジュールとして追加します。** 大きなコーディネーターファイルに書き足すのではありません。レンダラーや HUD が読むデータは `IWorld` インターフェース（`src/world_api/`）を通り、オフラインとオンラインの両方の世界で実装されます。新しいシミュレーションのシステムは `SimContext` の背後に置き、新しい REST エンドポイントは `pnpm run new:endpoint` で雛形を作れるルートモジュールにします。
- **生成されたファイルを手で編集しないでください。** `*.generated.ts` などがそれにあたります。ビルドを通して再生成してください。
- **文章スタイルの決まり。em ダッシュ、en ダッシュ、絵文字はどこでも使いません。** コード、コメント、ドキュメント、コミットメッセージ、PR の文章、プレイヤーに見えるテキストのいずれでも同じです。読点、コロン、丸括弧を使い、範囲には「to」を使ってください。プッシュ前のチェックが差分を走査し、見つかった時点でプッシュをブロックします。
- **秘密情報や `.env` ファイルを決してコミットしないでください。** また、`ALLOW_DEV_COMMANDS` はチートを解放してしまうため、本番環境のパスでは決して有効にしないでください。

### コードスタイル

フォーマットは [Biome](https://biomejs.dev/) で、設定は `biome.json` にあります。インデントは 2 スペース、1 行は 100 桁、シングルクォート、末尾カンマです。自分が触ったファイルだけをフォーマットし（`npx @biomejs/biome check --write <your-file.ts>`）、`pnpm run ci:changed` で確認してください。CI は変更されたファイルだけをチェックするので、ツリー全体を整形し直すのはやめてください。リポジトリ全体に対して実行すると、あなたが直すべきものではない長年の負債が表面化してしまいます。

## プルリクエストを開く前に

リポジトリのゲートをローカルで実行してください。CI が強制するのと同じ契約です。

```bash
pnpm run gate
```

作業の途中では、単一のスイート（`npx vitest run tests/sim.test.ts`）と、フォーマット確認のための `pnpm run ci:changed` を実行してください。`pnpm test` はすべてを実行し、スイートの一覧は `tests/CLAUDE.md` にあります。`pnpm run gate` の全体は、生成物の鮮度、マルウェアスキャン、変更ファイルのフォーマット、効果音の適合チェック、テストスイート全体、実ブラウザによるリグレッション、厳格な型チェック、そしてクライアント、サーバー、ヘッドレスのビルドを対象にします。プッシュ前の最低ラインから積み上がる階層的なチェックについては、[`docs/qa-gate.md`](../qa-gate.md) に説明があります。

そして、プレイヤーの目に触れる部分に手を入れたなら、その変更をデスクトップとモバイルの両方でテストしてください。スマートフォンサイズのビューポートで、縦向きと横向きの両方を確認することも含みます。タッチターゲットは少なくとも 40x40px、フォーム入力のフォントは少なくとも 16px を保つようにしてください。UI の基準は [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) に記載されています。

## プルリクエストを開く

ブランチをプッシュし、**自分が起点にしたのと同じ最新の `release/vX.Y.Z` ブランチに向けて** PR を開いてください。**`main` を対象にしてはいけません。** `main` は貢献のベースではなく、リリース時の統合ブランチです。GitHub はしばしば `main` をあらかじめ選択するので、送信する前にベースブランチを変更してください。[プルリクエストのテンプレート](../../.github/PULL_REQUEST_TEMPLATE.md)が、短いチェックリストに沿って案内してくれます。次の項目を埋めてください。

- **何が**変わったのか、そして**なぜ**変えたのかを説明してください。
- 関連する issue があればリンクしてください（たとえば「Closes #123」）。
- **UI の変更には、スクリーンショットや短い動画**を、デスクトップとモバイルの両方で添えてください。
- `pnpm run gate` が通ること、そしてプレイヤーに見える新しい文字列が、下記の英語優先の貢献者ポリシーに従っていることを確認してください。

あなたの PR では、CI が変更ファイルのフォーマットとリント、4 つの並列シャードにまたがるテストスイート全体、ブラウザのリグレッション、そして型チェックとクライアント、サーバー、ヘッドレスのビルドを実行します。これはローカルの `pnpm run gate` が実行する内容と一致するので、ゲートがグリーンなら PR もグリーンになる見込みが高いということです。

マージ前に私たちが見るのは、CI がグリーンであることと、チェックリストが埋まっていることです。メンテナーが変更を提案することもあります。それはこのプロセスの自然で協力的な一部であって、拒否ではありません。私たちはレビューにおいて親切で建設的であろうと努めていますし、あなたにも同じことをお願いします。

> コミットメッセージと PR のタイトルは、スコープを添えた [Conventional Commits](https://www.conventionalcommits.org/) に従います（`feat(talents): ...`、`fix(net): ...`）。すべてのコミットには本文も必要です。空行を 1 行はさんだあと、何をどう変えたのか、そしてなぜ変えたのかを、平易な文で 1 文から 4 文、およそ 72 桁で折り返して書いてください。タイトルだけでは足りません。

<a id="localization"></a>

## ローカライズ

World of ClaudeCraft は多くの言語で提供されています。プレイヤーに見えるすべての文字列は翻訳キーでなければなりませんが、機能を追加する貢献者は通常、英語の原文だけを追加します。

- ユーザー向けのテキストはすべて `t()` キーです。新しい英語のテキストは、[`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) 配下の該当するドメイン別モジュールに追加し（新しい HUD の枠回りは `hud_chrome.ts` です）、`t('dotted.key', values)` で描画してください。機能の PR では英語だけで完全に正しいやり方です。他のロケールはリリース時にメンテナーが埋めるので、`src/ui/i18n.locales/` のオーバーレイを編集する必要はなく、そこに英語のプレースホルダーや `// TODO` を残すこともありません。例外は M16 で、語数の多い新しい英語の値は、[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) に記載された 5 つの非ラテン言語の翻訳も同じ変更で必要になります。
- 数値、金額、日付、単位、パーセンテージは、手作業で文字列を組み立てるのではなく、フォーマッター（`formatNumber`、`formatMoney`、`formatDateTime`、`Intl`）を通してください。
- `src/sim/` や `server/`（これらは言語に依存しないまま保たれます）から発せられるプレイヤー向けのテキストは、同じ変更の中でクライアント境界において再ローカライズしなければなりません。ガードテスト `npx vitest run tests/localization_fixes.test.ts` がこれを強制します。
- 文字列を追加または変更したあとは `pnpm run i18n:gen` を実行し、再生成されたバンドルを同じ変更としてコミットしてください。ゲートと CI はどちらも、コミットされた生成物と新たに再生成したものを比較するので、古いバンドルのままだとビルドが失敗します。

というわけで、文字列は英語で追加して PR を開いてください。自分で翻訳する必要はありません。翻訳を手伝いたい場合は、次のセクションを参照してください。

<a id="translating-the-game"></a>

## ゲームの翻訳

ある言語を改善したい、あるいは新しい言語にゲームを広げる手助けがしたいですか。そのためにゲームのコードを書く必要はありません。

1. プレイヤー向けの翻訳のほとんどは、[`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) 配下の言語ごとのオーバーレイファイル（ロケールごとに 1 つ）にあり、[`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) の英語キーを写した構造になっています。シミュレーションとサーバーが発するテキストは `src/ui/sim_i18n.ts` と `src/ui/server_i18n.ts` で、タレントのテキストは `talent_i18n` モジュールで翻訳します。管理ダッシュボードには `src/admin/i18n.locales/` に独自の一式があります。
2. 既存の翻訳を改善したり、ぎこちなく感じる箇所を埋めたりします。
3. `pnpm run i18n:gen` を実行し、再生成されたバンドルをオーバーレイの編集と一緒にコミットしてから、ローカライズのスイート（`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`）を実行して PR を開いてください。オーバーレイは意図的に疎な構造になっているため、型チェックだけではキーの漏れはわかりません。

まったく新しいロケールを提案したい場合や、トーンや用語について相談したい場合は、[Discord](https://discord.com/invite/worldofclaudecraft) でスレッドを立ててください。設定のつなぎ込みをお手伝いします。ネイティブの方や流暢に話せる方は、とりわけ歓迎します。良い翻訳は、世界中のプレイヤーにとって、このゲームを我が家のように感じさせてくれます。

## バグの報告と機能のリクエスト

[issue テンプレート](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)を使ってください。

- **バグ報告。** まず[既存の issue](https://github.com/levy-street/world-of-claudecraft/issues) を検索して重複を避け、そのうえで再現手順、期待していた動作、実際に起きたこと、そして環境（オフラインかオンラインか、ブラウザ、デスクトップかモバイルか）を書いてください。
- **機能リクエスト。** 解決策そのものだけでなく、あなたが解決しようとしている問題を説明してください。背景がわかると、私たちは正しいものを設計しやすくなります。
- **セキュリティの脆弱性。** 公開の issue は立てないでください。[SECURITY.md](../../SECURITY.md) に従って非公開で報告していただければ、修正と公表について一緒に進めます。

## 助けが必要なとき

行き詰まったとき、あるいはただ挨拶したいときは、[コミュニティの Discord](https://discord.com/invite/worldofclaudecraft) に参加してください。どんなに小さな質問でも構いませんし、新しい貢献者はいつでも歓迎です。

## ライセンス

コードを提供することによって、あなたのコードの貢献がプロジェクトの [MIT ライセンス](../../LICENSE)（プロジェクト全体を覆うものと同じライセンス）のもとでライセンスされることに同意したものとみなされます。

MIT ライセンスは書かれているとおりの意味です。誰でも、商用かどうかを問わず、このコードを使用、改変、再配布できます。私たちの[利用規約](https://worldofclaudecraft.com/terms)は、worldofclaudecraft.com で私たちが運営するホスト版のゲーム（アカウント、行動、仮想アイテム）を対象とするものであり、MIT ライセンスがあなたや他の誰かにこのコードについて与える権利を制限するものではありません。「World of ClaudeCraft」および「Levy Street」の名称とブランドは MIT ライセンスの対象外です。

オリジナルの創作アセット（録音された音、音楽、アート、およびそれに類する著作物）は例外です。あなたが自分で制作したオリジナルのアセットを提供する場合、著作権を保持したまま、任意のライセンス（たとえば CC BY-NC 4.0）で提供することもできます。ただし、次の条件を満たす必要があります。

- ライセンス、それが対象とするアセットのパス、そしてあなたのクレジットが、同じプルリクエストの中で [CREDITS.md](../../CREDITS.md) のライセンス表に記録されること。
- 公式リリースやゲーム内ストアを含め、World of ClaudeCraft においてそのアセットを商用利用するための、恒久的かつロイヤリティ不要の許諾が、少なくとも Levy Street に与えられること。

CREDITS.md の表に記載されたアセットについては、そこに記録されたライセンスがプロジェクト既定の MIT ライセンスに優先します。

**CREDITS.md に記載のないメディアアセットは MIT ライセンスの対象ではありません。** 登録はまだ整備の途中であり、記載がないということは条件が未記録だという意味であって、そのアセットを自由に持ち出してよいという意味ではありません。これは意図的なものです。未登録の貢献が既定で譲り渡されてしまうのを防ぎます。コードはその逆で、CREDITS.md で切り出されていないものはすべて MIT です。

だからこそ、登録の記入は形式的な事務作業ではありません。CREDITS.md の行を伴わずにアセットを提供すると、下流の誰もそれを使えず、あなたが何を許諾したのかの記録も残りません。**Redistribution** の列も正直に記入してください。この列は、このプロジェクトをフォークする人があなたのアセットを再配布してよいかどうかを伝えるものであり、一部の行が「No, permission required」と記されているのは、まさに再配布できないからです。

---

World of ClaudeCraft への貢献、ありがとうございます。あなたが私たちと一緒に何を作り上げてくれるのか、楽しみで仕方ありません。
