<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · **简体中文** · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# 为 World of ClaudeCraft 做贡献

首先，感谢你的到来。World of ClaudeCraft 由一群热爱经典 MMO 的人共同打造，每一份贡献，无论大小，都让它变得更好。修正一个错别字、翻译游戏、报告一个 bug、搭建一座全新的副本：这些都很重要，我们欢迎你的加入。

本指南会帮你完成环境搭建，让你的第一次贡献顺顺利利。你不需要是专家。如果有任何不清楚的地方，欢迎到 [Discord](https://discord.com/invite/worldofclaudecraft) 上提问，会有人乐意帮你。

参与即表示你同意遵守我们的[行为准则](../../CODE_OF_CONDUCT.md)。

## 贡献的方式

这里人人都有用武之地：

- **代码。** 修复 bug、增加功能，或者提升性能。带有
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  和 [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  标签的 issue 是不错的起点。
- **翻译。** 通过改进或补全某种语言，帮助世界各地的玩家。请看下方的[翻译游戏](#translating-the-game)。这是最容易上手、也最有影响力的入门方式之一。
- **bug 报告与功能想法。** 提交一个 [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)。一份清晰的 bug 报告本身就是实打实的贡献。
- **文档。** 像这份指南、README，以及 `docs/` 里的设计文档，都还有改进的空间。
- **试玩与反馈。** 玩玩这个游戏，告诉我们哪里感觉不对劲，并在 Discord 上分享你的想法。

## 开始上手

你需要 [Node.js 26](https://nodejs.org/) 和 npm，这也是 CI 与生产镜像所使用的版本。更老的大版本未经验证。如果要运行多人游戏服务器，还需要 [Docker](https://www.docker.com/) 来跑 Postgres。

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Point git at the repository hooks (once per clone)
git config core.hooksPath .githooks

# 4. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

这样就足以玩离线世界，也能完成大部分工作。要运行完整的在线环境，你需要先在环境变量里设置一个数据库密码：

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

如果你打算运行下面那道完整的 gate，请先把它所驱动的浏览器安装一次：`npx playwright install chromium`。

[README](../../README.md) 里有完整的搭建、开发与游玩指南，而仓库中各处的 `CLAUDE.md` 文件则记录了每个区域的约定。

### TypeScript 工具链

类型检查跑在 TypeScript 7 这个原生编译器上：`npx tsc --noEmit` 的用法和以前完全一样，而整个仓库的一次检查现在只要几秒，而不是几十秒。安装方式是官方的双别名：`typescript` 包解析到 TypeScript 6 的 JS API（通过 `@typescript/typescript6` 包装层），因为 `svelte-check` 仍然依赖那套 API；而 `tsc` 二进制则由 `@typescript/native` 提供。有几点需要知道：

- **编辑器。** 在内置支持发布之前，VS Code 需要安装 "TypeScript 7" 市场扩展（`TypeScriptTeam.native-preview`）才能获得原生语言服务支持；它通过 `js/ts.experimental.useTsgo` 设置开关，而它的 "Disable TypeScript 7 Language Server" 命令是回退到 TypeScript 6 tsserver 的官方途径。JetBrains 系 IDE 只有在 `@typescript/native-preview` 这个包名下才会自动识别原生服务，因此它们不会从本仓库的 `@typescript/native` 别名中识别出来；IDE 自带的 TypeScript 6 支持可以正常工作。
- **实用的 tsc 参数。** `--checkers N` 设置并行类型检查工作进程的数量（默认是 4；无论设成多少，结果都完全一致）：在资源受限的 runner 上调低它以限制内存，在多核机器上调高它，两种情况都要实测，因为并不是越多越快。`--singleThreaded` 会关闭所有并行。临时检查单个文件（`npx tsc somefile.ts`）时，如果该目录下存在 `tsconfig.json` 就会报错；传入 `--ignoreConfig` 可以恢复旧的行为。
- **锁文件。** 重新生成 `package-lock.json` 只能用 `npx npm@10 install --package-lock-only`：这个文件采用 npm 10 的语义，而更新的 npm 大版本（包括 CI 的 Node 26 所自带的 npm 11）会悄悄丢掉 `svelte-check` 的嵌套 optional peer 条目，从而让 CI 里的 `npm ci` 失去同步。普通的 `npm ci` 在任何 npm 大版本下都是安全的。重新生成之后，请确认在 npm 10 和你自己工作机的 npm 下，`npm ci --dry-run` 都处于同步状态。
- **何时重新评估。** 只有当下面两个条件同时成立时，才把双别名收敛回单一的 `typescript` 依赖：TypeScript 7.1 的稳定版 JS API 已经发布（TypeScript 7.0 完全不提供 JS API，其替代方案在 microsoft/typescript-go 的 issue 2824 中跟踪），并且 sveltejs/language-tools 的 issue 3063 已关闭，且发布了采用它的 `svelte-check`。svelte-check 的实验性 `--tsgo` 模式并不能解除它对 TypeScript 6 API 的依赖；而它正在进行中的 TypeScript 7 加载支持（language-tools 的 PR 3073）读取的正是本仓库已经在用的 `@typescript/native` 别名，所以不需要改名。

## 进行你的改动

1. **从最新的发布分支开始，绝不要从 `main` 开始。** 进行中的工作都集成在 `release/vX.Y.Z` 分支上；`main` 落后于它，并不是贡献的基线。找到最新的那一个，然后从它切出分支：

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   请始终自己跑一遍这条查找命令，而不是从这份指南里照抄某个版本号：发布分支更替频繁，最新的那一个会随着每次发布而变化。分支命名是 `feature/<short-slug>` 或 `fix/<short-slug>`。
2. **提交要聚焦。** 较小、自成一体的改动比大块的改动更容易审查和合并。
3. **为改动补充或更新测试**，凡是你改动了 `src/sim/` 或 `server/` 中的行为。
4. **保持玩家可见文本可翻译。** 请看[本地化](#localization)和[翻译游戏](#translating-the-game)。

### 需要记住的事项

以下是代码库中那些起支撑作用的规则。完整细节在根目录的 [`CLAUDE.md`](../../CLAUDE.md) 里，简短版是：

- **模拟核心（`src/sim/`）是唯一的事实来源**，它保持纯粹，没有任何 DOM、浏览器或 Three.js 的导入，因此完全相同的代码可以在离线、服务器以及无头 RL 环境中运行。
- **模拟是确定性的。** 它以固定的 20 Hz 节拍运行，所有随机性都经由 `Rng`，在 sim 逻辑中绝不使用 `Math.random`、`Date.now` 或 `performance.now`。相同的种子总会产生相同的世界。
- **玩法数值遵循经典时代的 MMO 公式**（怒气、命中表、护甲、经验曲线）。请不要凭空发明平衡数值，而是引用对应的公式。
- **新的逻辑要作为一个自成一体、带测试的小模块，落在既有的接缝之后**，而不是被追加到某个大型协调者文件里。渲染器或 HUD 读取的数据要跨过 `IWorld` 接口（`src/world_api/`），并在离线世界和在线世界中都实现；新的模拟系统放在 `SimContext` 之后；新的 REST 端点是一个路由模块，你可以用 `npm run new:endpoint` 生成脚手架。
- **不要手动编辑生成的文件**，例如 `*.generated.ts`。请通过构建重新生成它们。
- **文案风格规定：任何地方都不得使用 em dash、en dash 或 emoji**，代码、注释、文档、提交信息、PR 文字或面向玩家的文案，一律如此。请改用逗号、冒号、圆括号，范围则用 "to"。推送前的检查会扫描你的 diff，一旦命中就会拦下这次推送。
- **绝不提交机密信息**或 `.env` 文件，也绝不在生产路径中启用 `ALLOW_DEV_COMMANDS`，因为它会解锁作弊功能。

### 代码风格

格式化使用 [Biome](https://biomejs.dev/)，配置在 `biome.json` 中：2 空格缩进、100 列行宽、单引号、尾随逗号。只格式化你改动过的文件（`npx @biomejs/biome check --write <your-file.ts>`），并用 `npm run ci:changed` 检查它们。CI 只对改动过的文件把关，所以请不要重新格式化整棵代码树：全仓库跑一遍会翻出长期积累的历史债务，那并不是该由你来修的东西。

## 在提交 pull request 之前

请在本地运行仓库的 gate。它和 CI 强制执行的是同一份契约：

```bash
npm run gate
```

在迭代过程中，可以只跑单个套件（`npx vitest run tests/sim.test.ts`），并用 `npm run ci:changed` 检查格式；`npm test` 会跑全部，套件分布图在 `tests/CLAUDE.md` 里。完整的 `npm run gate` 覆盖生成产物的新鲜度、恶意代码扫描、改动文件的格式化、音效一致性检查、整个测试套件、一轮真实浏览器回归、严格类型检查，以及客户端、服务器和无头三种构建。从推送前的底线开始逐层叠加的检查，记录在 [`docs/qa-gate.md`](../qa-gate.md) 中。

然后，如果改动涉及任何玩家能看到的内容，请在桌面端和移动端都测试一遍，包括手机尺寸视口的竖屏和横屏。触控目标应至少保持 40x40px，表单输入的字号应至少为 16px。UI 标准记录在 [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) 中。

## 提交 pull request

推送你的分支，并把 PR **提交到你起步时所用的那个最新的 `release/vX.Y.Z` 分支。绝不要以 `main` 为目标**，它是发布时的集成分支，而不是贡献的基线。GitHub 常常会替你预选 `main`，所以提交之前请先改掉基线分支。[pull request 模板](../../.github/PULL_REQUEST_TEMPLATE.md)会引导你完成一份简短的清单。请认真填写：

- 描述**改了什么**以及**为什么改**。
- 关联任何相关的 issue（例如 "Closes #123"）。
- **为 UI 改动附上截图或短片**，桌面端和移动端都要有。
- 确认 `npm run gate` 通过，并且新增的玩家可见字符串遵循下文的英文优先贡献者政策。

在你的 PR 上，CI 会对改动过的文件跑格式化和 lint，在四个并行分片上跑完整测试套件，跑一轮浏览器回归，再加上类型检查以及客户端、服务器和无头构建。这和 `npm run gate` 在本地跑的内容一致，所以 gate 全绿是 PR 全绿的一个不错的预示。

CI 全绿加上一份完整的清单，是我们合并前所看重的。维护者可能会提出修改建议。这是协作过程中正常的一环，并不是拒绝。我们在审查中力求友善而有建设性，也希望你同样如此。

> 提交信息和 PR 标题遵循 [Conventional Commits](https://www.conventionalcommits.org/)，并带上 scope（`feat(talents): ...`、`fix(net): ...`）。每一条提交还必须带正文：空一行之后，用一到四句平实的话说明改了什么以及为什么改，在 72 列附近折行。只有标题是不够的。

<a id="localization"></a>

## 本地化

World of ClaudeCraft 以多种语言发行。每一条玩家可见的字符串都必须是一个翻译键，而功能贡献者通常只需要添加英文原文。

- 所有面向用户的文本都是 `t()` 键。请把新的英文文案加到 [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) 下对应的分域模块里（新的 HUD 外框相关文案放在 `hud_chrome.ts`），然后用 `t('dotted.key', values)` 渲染。对于功能类 PR，只提供英文正是正确的做法：其他语言由维护者在发布时补齐，所以你不需要改动 `src/ui/i18n.locales/` 中的 overlay，也绝不要在里面留下英文占位符或 `// TODO`。唯一的例外是 M16，即新增一条文字量较大的英文值时，还需要在同一次改动中补上 [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) 里说明的五种非拉丁语言翻译。
- 数字、金额、日期、单位和百分比要经过格式化函数（`formatNumber`、`formatMoney`、`formatDateTime`、`Intl`），而不是手动拼接字符串。
- 从 `src/sim/` 或 `server/` 发出的、面向玩家的文本（它们保持与语言无关）必须在同一次改动中于客户端边界处重新本地化。守卫测试 `npx vitest run tests/localization_fixes.test.ts` 会强制执行这一点。
- 新增或修改任何字符串之后，请运行 `npm run i18n:gen`，并把重新生成的 bundle 放在同一次改动里一起提交。gate 和 CI 都会把已提交的产物和一次全新的重新生成结果做比对，所以过期的 bundle 会导致构建失败。

所以，用英文加上你的字符串然后提 PR 就好；你不需要自己去翻译它们。如果你愿意帮忙做翻译，请看下一节。

<a id="translating-the-game"></a>

## 翻译游戏

想改进某种语言，或者帮忙把游戏带到一门新语言里？做这件事不需要写任何游戏代码：

1. 大部分面向玩家的翻译都在 [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) 下的分语言 overlay 文件里（每种语言一个），结构对应 [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) 中的英文键。模拟层和服务器发出的文本在 `src/ui/sim_i18n.ts` 和 `src/ui/server_i18n.ts` 中翻译，天赋文案在 `talent_i18n` 系列模块中，管理后台则在 `src/admin/i18n.locales/` 下有自己的一套。
2. 改进现有的翻译，或者补全任何读起来别扭的地方。
3. 运行 `npm run i18n:gen`，把重新生成的 bundle 和你的 overlay 改动一起提交，然后跑本地化套件（`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`）并提交 PR。只做类型检查是看不出某个键有没有遗漏的，因为 overlay 本来就是有意稀疏的。

要提议一门全新的语言，或者讨论语气和术语，请到 [Discord](https://discord.com/invite/worldofclaudecraft) 上开个话题，我们会帮你把它接进来。尤其欢迎母语者和流利使用者。好的翻译能让各地玩家都觉得游戏像家一样亲切。

## 报告 bug 与请求功能

请使用 [issue 模板](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)：

- **bug 报告。** 请先搜索[现有的 issue](https://github.com/levy-street/world-of-claudecraft/issues) 以避免重复，然后写明复现步骤、你的预期、实际发生了什么，以及你的环境（离线还是在线、浏览器、桌面端还是移动端）。
- **功能请求。** 描述你想解决的问题，而不只是解决方案。背景信息能帮我们设计出真正合适的东西。
- **安全漏洞。** 请不要提交公开 issue。请按照 [SECURITY.md](../../SECURITY.md) 的说明私下报告，我们会和你一起推进修复与披露。

## 获取帮助

卡住了，或者只是想打个招呼？欢迎加入[社区 Discord](https://discord.com/invite/worldofclaudecraft)。没有什么问题是太小的，我们始终欢迎新的贡献者。

## 许可证

贡献代码即表示，你同意你的代码贡献将依据项目的 [MIT 许可证](../../LICENSE)进行授权，与覆盖整个项目的许可证相同。

MIT 许可证就是字面意思：任何人都可以使用、修改和再分发这些代码，无论商用与否。我们的[服务条款](https://worldofclaudecraft.com/terms)约束的是我们在 worldofclaudecraft.com 上运营的托管版游戏（账号、行为、虚拟物品），并不限制 MIT 许可证赋予你或其他任何人对这些代码的权利。"World of ClaudeCraft" 和 "Levy Street" 这两个名称及其品牌标识不在 MIT 许可证的覆盖范围内。

原创的创作素材（录音、音乐、美术及类似的著作作品）是个例外。如果你贡献一份自己创作的原创素材，你可以选择保留版权，并按你选定的许可证（例如 CC BY-NC 4.0）来贡献它，但需要满足以下条件：

- 该许可证、它所覆盖的素材路径，以及对你的署名，要在同一个 pull request 中记录到 [CREDITS.md](../../CREDITS.md) 的许可证表格里；并且
- 它至少包含一项永久、免版税的授权，允许 Levy Street 在 World of ClaudeCraft 中商业性地使用这些素材，包括官方发行版本和游戏内商店。

对于列在 CREDITS.md 表格中的素材，那里记录的许可证优先于项目默认的 MIT 许可证。

**在 CREDITS.md 中没有条目的媒体素材不按 MIT 授权。** 这份登记表仍在完善之中，所以缺少条目意味着条款尚未记录，而不是这份素材可以随意取用。这是有意为之：它避免了未登记的贡献在默认情况下被拱手让出。代码则正好相反，凡是没有在 CREDITS.md 中单独划出的部分一律是 MIT。

这也正是为什么登记条目不是可有可无的例行文书。如果你贡献了素材却没有留下 CREDITS.md 中的一行，下游就没有人能使用它，我们也没有关于你授予了什么的记录。**Redistribution** 那一列也请如实填写。它告诉 fork 这个项目的人是否可以把你的素材再传下去，而某些行之所以标着 "No, permission required"，正是因为不可以。

---

感谢你为 World of ClaudeCraft 做出贡献。我们迫不及待想看到你和我们一起创造出什么。
