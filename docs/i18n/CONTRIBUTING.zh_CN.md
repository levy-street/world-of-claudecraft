<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · **简体中文** · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# 为 World of ClaudeCraft 做贡献

首先，感谢你的到来。World of ClaudeCraft 由一群热爱经典 MMO 的人共同打造，每一份贡献，无论大小，都让它变得更好。修正一个错别字、翻译游戏、报告一个 bug、搭建一座全新的副本：这些都很重要，我们欢迎你的加入。

本指南会帮你完成环境搭建，让你的第一次贡献顺顺利利。你不需要是专家。如果有任何不清楚的地方，欢迎到 [Discord](https://discord.gg/GjhnUsBtw) 上提问，会有人乐意帮你。

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

你需要 [Node.js 22+](https://nodejs.org/) 和 npm。如果要运行多人游戏服务器，还需要 [Docker](https://www.docker.com/) 来跑 Postgres。

```bash
# 1. 在 GitHub 上 fork 仓库，然后克隆你的 fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. 安装依赖
npm ci

# 3. 运行离线客户端（无需服务器或数据库）
npm run dev          # 打开它打印出的网址（通常是 http://localhost:5173）
```

这样就足以玩离线世界，也能完成大部分工作。要运行完整的在线环境：

```bash
npm run db:up        # 在 Docker 中启动 Postgres 16（开发数据库在 port 5433）
npm run server       # 构建并在 :8787 上运行权威游戏服务器
npm run dev          # 在另一个终端中运行；客户端会代理到服务器
```

[README](../../README.md) 里有完整的搭建、开发与游玩指南，而仓库中各处的 `CLAUDE.md` 文件则记录了每个区域的约定。

## 进行你的改动

1. **从 `main` 切出一个分支**：`feature/<short-slug>` 或 `fix/<short-slug>`。
2. **提交要聚焦。** 较小、自成一体的改动比大块的改动更容易审查和合并。
3. **为改动补充或更新测试**，凡是你改动了 `src/sim/` 或 `server/` 中的行为。
4. **保持玩家可见文本可翻译。** 请看[本地化](#localization)和[翻译游戏](#translating-the-game)。

### 需要记住的事项

以下是代码库中那些起支撑作用的规则。完整细节在根目录的 [`CLAUDE.md`](../../CLAUDE.md) 里，简短版是：

- **模拟核心（`src/sim/`）是唯一的事实来源**，它保持纯粹，没有任何 DOM、浏览器或 Three.js 的导入，因此完全相同的代码可以在离线、服务器以及无头 RL 环境中运行。
- **模拟是确定性的。** 它以固定的 20 Hz 节拍运行，所有随机性都经由 `Rng`，在 sim 逻辑中绝不使用 `Math.random`、`Date.now` 或 `performance.now`。相同的种子总会产生相同的世界。
- **玩法数值遵循经典时代的 MMO 公式**（怒气、命中表、护甲、经验曲线）。请不要凭空发明平衡数值，而是引用对应的公式。
- **不要手动编辑生成的文件**，例如 `*.generated.ts`。请通过构建重新生成它们。
- **绝不提交机密信息**或 `.env` 文件，也绝不在生产路径中启用 `ALLOW_DEV_COMMANDS`，因为它会解锁作弊功能。

## 在提交 pull request 之前

请在本地运行下面这些命令。它们和 CI 跑的检查是一样的：

```bash
npm test                    # Vitest 测试套件
npx tsc --noEmit            # TypeScript 类型检查（项目开启了 strict）
npm run build               # 生产环境客户端构建
```

如果你改动了服务器或无头代码，还要运行 `npm run build:server` 和 `npm run build:env`。

然后，如果改动涉及任何玩家能看到的内容，请在桌面端和移动端都测试一遍，包括手机尺寸视口的竖屏和横屏。触控目标应至少保持 40x40px，表单输入的字号应至少为 16px。UI 标准记录在 [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) 中。

## 提交 pull request

推送你的分支，并向 `main` 发起一个 PR。[pull request 模板](../../.github/PULL_REQUEST_TEMPLATE.md)会引导你完成一份简短的清单。请认真填写：

- 描述**改了什么**以及**为什么改**。
- 关联任何相关的 issue（例如 "Closes #123"）。
- **为 UI 改动附上截图或短片**，桌面端和移动端都要有。
- 确认测试、类型检查和构建都通过，并且新增的字符串都已翻译。

CI 全绿加上一份完整的清单，是我们合并前所看重的。维护者可能会提出修改建议。这是协作过程中正常的一环，并不是拒绝。我们在审查中力求友善而有建设性，也希望你同样如此。

> 提交信息和 PR 标题遵循 [Conventional Commits](https://www.conventionalcommits.org/)，在合适的地方带上 scope（`feat(talents): ...`、`fix(net): ...`）。这是我们喜欢的一种约定，而非硬性要求。清晰、有描述性的信息比完美的格式更重要。

<a id="localization"></a>

## 本地化

World of ClaudeCraft 支持多种语言，并且随着游戏的发展，我们会一直保持这一点。每一条玩家可见的字符串都会被翻译成每一种受支持的语言。

- 所有面向用户的文本都是定义在 [`src/ui/i18n.ts`](../../src/ui/i18n.ts) 中的 `t()` 键。请先把新字符串加到 `en` 语言里，然后在 `supportedLanguages` 中的每一种其他语言里都提供真正的翻译。不要留英文占位符，也不要留 `// TODO`。
- 数字、金额、日期、单位和百分比要经过格式化函数（`formatNumber`、`formatMoney`、`formatDateTime`、`Intl`），而不是手动拼接字符串。
- 从 `src/sim/` 或 `server/` 发出的、面向玩家的文本（它们保持与语言无关）必须在同一次改动中于客户端边界处重新本地化。守卫测试 `npx vitest run tests/localization_fixes.test.ts` 会强制执行这一点。

如果你的改动新增了某个字符串，而你只能用部分语言把它写出来，那也没关系。照样提交 PR，并在描述里请求大家帮忙补全其余部分。比起让你因此停手，我们更愿意帮你把它完成。

<a id="translating-the-game"></a>

## 翻译游戏

想改进某种语言，或者帮忙把游戏带到一门新语言里？做这件事不需要写任何游戏代码：

1. 打开 [`src/ui/i18n.ts`](../../src/ui/i18n.ts)，找到你想处理的语言。每个语言对象都列着和 `en` 相同的键。
2. 改进现有的翻译，或者补全任何读起来别扭的地方。
3. 运行 `npx tsc --noEmit` 确认没有遗漏，然后提交 PR。

要提议一门全新的语言，或者讨论语气和术语，请到 [Discord](https://discord.gg/GjhnUsBtw) 上开个话题，我们会帮你把它接进来。尤其欢迎母语者和流利使用者。好的翻译能让各地玩家都觉得游戏像家一样亲切。

## 报告 bug 与请求功能

请使用 [issue 模板](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)：

- **bug 报告。** 请先搜索[现有的 issue](https://github.com/levy-street/world-of-claudecraft/issues) 以避免重复，然后写明复现步骤、你的预期、实际发生了什么，以及你的环境（离线还是在线、浏览器、桌面端还是移动端）。
- **功能请求。** 描述你想解决的问题，而不只是解决方案。背景信息能帮我们设计出真正合适的东西。

## 获取帮助

卡住了，或者只是想打个招呼？欢迎加入[社区 Discord](https://discord.gg/GjhnUsBtw)。没有什么问题是太小的，我们始终欢迎新的贡献者。

## 许可证

通过贡献，你同意你的贡献将依据项目的 [MIT 许可证](../../LICENSE)进行授权，与覆盖整个项目的许可证相同。

---

感谢你为 World of ClaudeCraft 做出贡献。我们迫不及待想看到你和我们一起创造出什么。
