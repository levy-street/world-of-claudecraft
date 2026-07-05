<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · **日本語** · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# World of ClaudeCraft への貢献

まずは、ここに来てくれてありがとうございます。World of ClaudeCraft は、クラシックな MMO を愛する人々のコミュニティによって作られています。そして、大きなものでも小さなものでも、すべての貢献がこのゲームをより良くしてくれます。誤字の修正、ゲームの翻訳、バグの報告、まったく新しいダンジョンの構築。そのどれもが大切な貢献であり、あなたを心から歓迎します。

このガイドは、開発環境のセットアップと、最初の貢献をスムーズに進めるためのものです。専門家である必要はありません。わからないことがあれば、[Discord](https://discord.gg/GjhnUsBtw) で気軽に聞いてください。誰かが喜んで力になってくれます。

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

[Node.js 22 以上](https://nodejs.org/) と npm が必要です。マルチプレイヤーサーバーを動かすには、Postgres を実行するための [Docker](https://www.docker.com/) も用意してください。

```bash
# 1. GitHub でリポジトリをフォークしてから、自分のフォークをクローンします
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. 依存パッケージをインストールします
npm ci

# 3. オフラインクライアントを実行します（サーバーやデータベースは不要です）
npm run dev          # 表示された URL を開きます（通常は http://localhost:5173）
```

オフラインの世界で遊んだり、ほとんどの作業を進めたりするには、これだけで十分です。オンラインのフルスタックを実行するには、次のようにします。

```bash
npm run db:up        # Docker で Postgres 16 を起動します（開発用 DB は port 5433）
npm run server       # 権威サーバーをビルドして :8787 で実行します
npm run dev          # 別のターミナルで実行します。クライアントはサーバーへプロキシします
```

[README](../../README.md) には、ホスティング、開発、プレイの完全なガイドがあります。また、リポジトリ全体に置かれた `CLAUDE.md` ファイルが、各領域の慣習を説明しています。

## 変更を加える

1. **ブランチを作成します。** `main` から `feature/<short-slug>` または `fix/<short-slug>` を切ります。
2. **コミットは目的を絞ったものに。** 小さく、ひとまとまりになった変更は、大きなものよりもレビューやマージがしやすくなります。
3. **テストを追加または更新します。** `src/sim/` や `server/` で挙動を変えたときは、必ずテストも合わせて用意してください。
4. **プレイヤーに見える文字列は翻訳可能に保ちます。** [ローカライズ](#localization)と[ゲームの翻訳](#translating-the-game)を参照してください。

### 心に留めておきたいこと

これらはコードベースの根幹をなすルールです。詳細はルートの [`CLAUDE.md`](../../CLAUDE.md) にありますが、要点は次のとおりです。

- **シミュレーションコア（`src/sim/`）が信頼できる唯一の情報源です。** ここは純粋に保たれ、DOM、ブラウザ、Three.js のインポートを一切含みません。だからこそ、まったく同じコードがオフライン、サーバー、ヘッドレスの RL 環境で動きます。
- **シミュレーションは決定的です。** 固定された 20 Hz のティックで動き、すべての乱数は `Rng` を通します。シミュレーションのロジックでは `Math.random`、`Date.now`、`performance.now` を決して使いません。同じシードからは、常に同じ世界が生まれます。
- **ゲームプレイの計算はクラシック時代の MMO の公式に従います**（レイジ、ヒットテーブル、アーマー、XP カーブなど）。バランスの数値を勝手に作り出さないでください。代わりに公式を引用してください。
- **生成されたファイルを手で編集しないでください。** `*.generated.ts` などがそれにあたります。ビルドを通して再生成してください。
- **秘密情報や `.env` ファイルを決してコミットしないでください。** また、`ALLOW_DEV_COMMANDS` はチートを解放してしまうため、本番環境のパスでは決して有効にしないでください。

## プルリクエストを開く前に

次のコマンドをローカルで実行してください。CI が実行するのと同じチェックです。

```bash
npm test                    # Vitest スイート
npx tsc --noEmit            # TypeScript の型チェック（このプロジェクトは strict です）
npm run build               # 本番クライアントのビルド
```

サーバーやヘッドレスのコードを変更した場合は、`npm run build:server` と `npm run build:env` も実行してください。

そして、プレイヤーの目に触れる部分に手を入れたなら、その変更をデスクトップとモバイルの両方でテストしてください。スマートフォンサイズのビューポートで、縦向きと横向きの両方を確認することも含みます。タッチターゲットは少なくとも 40x40px、フォーム入力のフォントは少なくとも 16px を保つようにしてください。UI の基準は [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) に記載されています。

## プルリクエストを開く

ブランチをプッシュして、`main` に対して PR を開いてください。[プルリクエストのテンプレート](../../.github/PULL_REQUEST_TEMPLATE.md)が、短いチェックリストに沿って案内してくれます。次の項目を埋めてください。

- **何が**変わったのか、そして**なぜ**変えたのかを説明してください。
- 関連する issue があればリンクしてください（たとえば「Closes #123」）。
- **UI の変更には、スクリーンショットや短い動画**を、デスクトップとモバイルの両方で添えてください。
- テスト、型チェック、ビルドが通ること、そして新しい文字列が翻訳されていることを確認してください。

マージ前に私たちが見るのは、CI がグリーンであることと、チェックリストが埋まっていることです。メンテナーが変更を提案することもあります。それはこのプロセスの自然で協力的な一部であって、拒否ではありません。私たちはレビューにおいて親切で建設的であろうと努めていますし、あなたにも同じことをお願いします。

> コミットメッセージと PR のタイトルは、必要に応じてスコープを添えた [Conventional Commits](https://www.conventionalcommits.org/) に従います（`feat(talents): ...`、`fix(net): ...`）。これは厳密な決まりというより、私たちが好んでいる慣習です。完璧な書式よりも、わかりやすく説明的なメッセージのほうが大切です。

<a id="localization"></a>

## ローカライズ

World of ClaudeCraft は多くの言語で提供されており、ゲームが成長してもその状態を保ち続けています。プレイヤーに見えるすべての文字列は、対応しているすべてのロケールに翻訳されています。

- ユーザー向けのテキストはすべて、[`src/ui/i18n.ts`](../../src/ui/i18n.ts) で定義された `t()` キーです。新しい文字列はまず `en` ロケールに追加し、それから `supportedLanguages` にある他のすべてのロケールに本物の翻訳を用意してください。英語のプレースホルダーや `// TODO` は使わないでください。
- 数値、金額、日付、単位、パーセンテージは、手作業で文字列を組み立てるのではなく、フォーマッター（`formatNumber`、`formatMoney`、`formatDateTime`、`Intl`）を通してください。
- `src/sim/` や `server/`（これらは言語に依存しないまま保たれます）から発せられるプレイヤー向けのテキストは、同じ変更の中でクライアント境界において再ローカライズしなければなりません。ガードテスト `npx vitest run tests/localization_fixes.test.ts` がこれを強制します。

あなたの変更が文字列を追加するもので、一部の言語でしか書けない場合でも、それで構いません。PR を開いて、説明欄で残りの言語の手助けをお願いしてください。あなたを足踏みさせるよりも、最後まで仕上げる手助けをしたいのです。

<a id="translating-the-game"></a>

## ゲームの翻訳

ある言語を改善したい、あるいは新しい言語にゲームを広げる手助けがしたいですか。そのためにゲームのコードを書く必要はありません。

1. [`src/ui/i18n.ts`](../../src/ui/i18n.ts) を開いて、取り組みたいロケールを見つけます。どのロケールオブジェクトにも `en` と同じキーが並んでいます。
2. 既存の翻訳を改善したり、ぎこちなく感じる箇所を埋めたりします。
3. `npx tsc --noEmit` を実行して、漏れがないことを確認してから PR を開きます。

まったく新しいロケールを提案したい場合や、トーンや用語について相談したい場合は、[Discord](https://discord.gg/GjhnUsBtw) でスレッドを立ててください。設定のつなぎ込みをお手伝いします。ネイティブの方や流暢に話せる方は、とりわけ歓迎します。良い翻訳は、世界中のプレイヤーにとって、このゲームを我が家のように感じさせてくれます。

## バグの報告と機能のリクエスト

[issue テンプレート](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)を使ってください。

- **バグ報告。** まず[既存の issue](https://github.com/levy-street/world-of-claudecraft/issues) を検索して重複を避け、そのうえで再現手順、期待していた動作、実際に起きたこと、そして環境（オフラインかオンラインか、ブラウザ、デスクトップかモバイルか）を書いてください。
- **機能リクエスト。** 解決策そのものだけでなく、あなたが解決しようとしている問題を説明してください。背景がわかると、私たちは正しいものを設計しやすくなります。

## 助けが必要なとき

行き詰まったとき、あるいはただ挨拶したいときは、[コミュニティの Discord](https://discord.gg/GjhnUsBtw) に参加してください。どんなに小さな質問でも構いませんし、新しい貢献者はいつでも歓迎です。

## ライセンス

貢献することによって、あなたの貢献がプロジェクトの [MIT ライセンス](../../LICENSE)（プロジェクト全体を覆うものと同じライセンス）のもとでライセンスされることに同意したものとみなされます。

---

World of ClaudeCraft への貢献、ありがとうございます。あなたが私たちと一緒に何を作り上げてくれるのか、楽しみで仕方ありません。
