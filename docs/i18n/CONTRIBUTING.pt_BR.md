<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · **Português (Brasil)** · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Contribuindo com o World of ClaudeCraft

Antes de tudo, obrigado por estar aqui. O World of ClaudeCraft é construído por
uma comunidade de pessoas que amam MMOs clássicos, e cada contribuição, grande ou
pequena, deixa o jogo melhor. Corrigir um erro de digitação, traduzir o jogo,
relatar um bug, criar uma masmorra inteira: tudo conta, e você é muito bem-vindo
aqui.

Este guia vai te ajudar a configurar o ambiente e tornar sua primeira contribuição
algo tranquilo. Você não precisa ser especialista. Se algo não estiver claro,
pergunte no [Discord](https://discord.com/invite/worldofclaudecraft) e alguém terá o maior prazer
em ajudar.

Ao participar, você concorda em seguir nosso [Código de Conduta](../../CODE_OF_CONDUCT.md).

## Formas de contribuir

Tem lugar para todo mundo aqui:

- **Código.** Corrija um bug, adicione um recurso ou melhore o desempenho. As
  issues com os rótulos
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  e [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  são bons pontos de partida.
- **Traduções.** Ajude jogadores do mundo todo melhorando ou completando um
  idioma. Veja [Traduzindo o jogo](#translating-the-game) mais abaixo. Esta é uma
  das formas mais fáceis e de maior impacto para começar.
- **Relatos de bug e ideias de recursos.** Abra uma [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Um relato de bug bem claro já é uma contribuição de verdade.
- **Documentação.** Guias como este, o README e os documentos de design em
  `docs/` sempre podem ser aprimorados.
- **Testes de jogabilidade e feedback.** Jogue, conte o que parece estranho e
  compartilhe ideias no Discord.

## Primeiros passos

Você vai precisar do [Node.js 26](https://nodejs.org/) e do **pnpm 10.34.x** (o pin exato está em `package.json` em `packageManager`, hoje `pnpm@10.34.5`). Majors mais antigas do Node não são testadas. Para o servidor multijogador você também vai querer [Docker](https://www.docker.com/) para rodar o Postgres.

**Corepack não é obrigatório.** Instale o pnpm uma vez com o npm que vem com o Node. O mesmo caminho vale em macOS, Linux e Windows.

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

`npm run <script>` ainda funciona depois de uma instalação com pnpm (o Node traz npm), mas **instalação e atualizações do lockfile devem passar pelo pnpm**. Não faça commit de um `package-lock.json`; a única fonte da verdade é o `pnpm-lock.yaml`.

Isso já é o suficiente para jogar o mundo offline e trabalhar na maior parte das
coisas. Para rodar a stack online completa, você precisa antes de uma senha de
banco de dados no seu ambiente:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
pnpm run db:up       # start Postgres 16 in Docker (dev DB on port 5433)
pnpm run server      # build and run the authoritative game server on :8787
pnpm run dev         # in another terminal; the client proxies to the server
```

Se você pretende rodar o gate completo descrito abaixo, instale uma vez o
navegador que ele usa: `pnpm exec playwright install chromium`.

O [README](README.pt_BR.md) traz o guia completo de hospedar, desenvolver e jogar, e os
arquivos `CLAUDE.md` espalhados pelo repositório documentam as convenções de cada
área.

### Toolchain do TypeScript

A checagem de tipos roda no TypeScript 7, o compilador nativo: `npx tsc --noEmit`
funciona exatamente como antes e uma checagem do repositório inteiro agora leva
poucos segundos, em vez de dezenas de segundos. A instalação usa o alias duplo
oficial: o pacote `typescript` resolve a API JS do TypeScript 6 (pelo wrapper
`@typescript/typescript6`), porque o `svelte-check` ainda consome essa API,
enquanto o `@typescript/native` fornece o binário `tsc`. Pontos importantes:

- **Editores.** O VS Code precisa da extensão "TypeScript 7" do marketplace
  (`TypeScriptTeam.native-preview`) para ter suporte ao serviço de linguagem
  nativo até que o suporte embutido seja lançado; ela é ativada pela configuração
  `js/ts.experimental.useTsgo`, e o comando "Disable TypeScript 7 Language
  Server" dela é o caminho sancionado de volta ao tsserver do TypeScript 6. As
  IDEs da JetBrains detectam o servidor nativo automaticamente apenas sob o nome
  de pacote `@typescript/native-preview`, então não vão reconhecê-lo pelo alias
  `@typescript/native` deste repositório; o suporte a TypeScript 6 que já vem com
  elas funciona bem.
- **Flags úteis do tsc.** `--checkers N` define a quantidade de workers paralelos
  de checagem de tipos (padrão 4; os resultados são idênticos em qualquer
  quantidade): reduza para limitar memória em um runner restrito, aumente em uma
  máquina com muitos núcleos e meça nos dois casos, já que mais nem sempre é mais
  rápido. `--singleThreaded` desliga todo o paralelismo. Checar um único arquivo
  de forma pontual (`npx tsc somefile.ts`) dá erro quando o diretório tem um
  `tsconfig.json`; passe `--ignoreConfig` para o comportamento antigo.
- **Lockfile.** O lockfile é o `pnpm-lock.yaml` (pnpm 10 / lockfileVersion 9). Atualize-o só com `pnpm install`, `pnpm add` ou `pnpm update` na raiz deste repositório (nunca à mão). Faça commit do `pnpm-lock.yaml` junto com as mudanças de `package.json`. O CI instala com `pnpm install --frozen-lockfile`; um lockfile desatualizado falha. Não introduza um segundo lockfile (`package-lock.json` / yarn.lock): lockfiles duplos divergem em silêncio e são proibidos. O ruído de peer dependencies das árvores opcionais de wallet/solana é tolerado via `.npmrc` (`strict-peer-dependencies=false`); não afrouxar mais sem medir.
- **Quando revisitar.** Unifique o alias duplo de volta em uma única dependência
  `typescript` quando AMBOS forem verdade: a API JS estável do TypeScript 7.1
  tiver sido lançada (o TypeScript 7.0 não traz API JS nenhuma; a substituição é
  acompanhada na issue 2824 do microsoft/typescript-go), e a issue 3063 do
  sveltejs/language-tools tiver sido fechada com uma versão publicada do
  `svelte-check` que a adote. Os modos experimentais `--tsgo` do svelte-check não
  eliminam a exigência da API do TypeScript 6, e o carregamento do TypeScript 7
  em andamento nele (PR 3073 do language-tools) lê o alias `@typescript/native`
  que este repositório já usa, então nenhuma renomeação será necessária.

## Fazendo a sua alteração

1. **Comece pelo branch de release mais recente, nunca pelo `main`.** O trabalho
   ativo é integrado em um branch `release/vX.Y.Z`; o `main` fica atrás dele e não é
   a base para contribuições. Encontre o mais novo e crie o seu branch a partir dele:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Sempre execute essa consulta em vez de copiar um número de versão deste guia:
   os branches de release se renovam com frequência, e o mais novo muda a cada
   release. Os branches são nomeados `feature/<short-slug>` ou `fix/<short-slug>`.
2. **Faça commits focados.** Alterações menores e autocontidas são mais fáceis de
   revisar e integrar do que as grandes.
3. **Adicione ou atualize testes** para qualquer comportamento que você mudar em
   `src/sim/` ou `server/`.
4. **Mantenha o texto visível ao jogador traduzível.** Veja
   [Localização](#localization) e [Traduzindo o jogo](#translating-the-game).

### Pontos para ter em mente

Estas são as regras estruturais da base de código. O detalhe completo está no
[`CLAUDE.md`](../../CLAUDE.md) da raiz, mas a versão curta é:

- **O núcleo da simulação (`src/sim/`) é a fonte da verdade**, e ele permanece
  puro, sem imports de DOM, navegador ou Three.js, para que exatamente o mesmo
  código rode offline, no servidor e no ambiente de RL headless.
- **A simulação é determinística.** Ela roda em um tick fixo de 20 Hz, e toda
  aleatoriedade passa pelo `Rng`, nunca por `Math.random`, `Date.now` ou
  `performance.now` na lógica da sim. A mesma seed sempre produz o mesmo mundo.
- **A matemática de jogabilidade segue as fórmulas clássicas de MMO** (rage,
  tabelas de acerto, armadura, curvas de XP). Por favor, não invente números de
  balanceamento. Cite a fórmula no lugar disso.
- **A lógica nova entra como um módulo próprio, pequeno e testado, atrás de uma
  costura existente**, em vez de ser anexada a um dos grandes arquivos
  coordenadores. Dados que o renderizador ou a HUD leem cruzam a interface
  `IWorld` (`src/world_api/`) e são implementados tanto no mundo offline quanto no
  online; um novo sistema de simulação fica atrás do `SimContext`; um novo
  endpoint REST é um módulo de rota que você pode gerar com
  `pnpm run new:endpoint`.
- **Não edite à mão os arquivos gerados** como os `*.generated.ts`. Gere-os
  novamente pelo build.
- **Estilo de texto da casa: nada de travessões, meios-traços ou emojis** em lugar
  nenhum, seja em código, comentários, documentação, mensagens de commit, texto de
  PR ou conteúdo voltado ao jogador. Use vírgulas, dois-pontos, parênteses ou "a"
  para intervalos. Uma verificação de pre-push examina o seu diff e bloqueia o push
  se encontrar algum.
- **Nunca faça commit de segredos** nem de um arquivo `.env`, e nunca ative o
  `ALLOW_DEV_COMMANDS` em um caminho de produção, já que ele libera cheats.

### Estilo de código

A formatação é feita pelo [Biome](https://biomejs.dev/), configurado no
`biome.json`: indentação de 2 espaços, linhas de 100 colunas, aspas simples,
vírgulas ao final. Formate apenas os arquivos que você tocou
(`npx @biomejs/biome check --write <your-file.ts>`) e verifique-os com
`pnpm run ci:changed`. O CI avalia somente os arquivos alterados, então, por favor,
não reformate a árvore inteira: uma execução no repositório todo traz à tona uma
dívida antiga que não cabe a você resolver.

## Antes de abrir um pull request

Rode o gate do repositório localmente. Ele é o mesmo contrato que o CI aplica:

```bash
pnpm run gate
```

Enquanto você itera, rode uma suite isolada (`npx vitest run tests/sim.test.ts`) e
o `pnpm run ci:changed` para formatação; o `pnpm test` roda tudo, e o mapa das
suites está no `tests/CLAUDE.md`. O `pnpm run gate` completo cobre a atualidade dos
artefatos gerados, o scan de malware, a formatação dos arquivos alterados, a
checagem de conformidade dos efeitos sonoros, toda a suite de testes, uma passada
de regressão em navegador real, a checagem estrita de tipos e os builds do
cliente, do servidor e do headless. As verificações em camadas, do piso de
pre-push para cima, estão descritas em [`docs/qa-gate.md`](../qa-gate.md).

Depois, teste sua alteração tanto no desktop quanto no mobile, incluindo uma
viewport do tamanho de um celular em retrato e paisagem, se ela mexer em qualquer
coisa que os jogadores vejam. Os alvos de toque devem ter pelo menos 40x40px e as
entradas de formulário pelo menos 16px de fonte. Os padrões de UI estão
documentados em [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Abrindo o pull request

Suba o seu branch e abra um PR **mirando o mesmo branch `release/vX.Y.Z` mais
recente de onde você começou. Nunca mire o `main`**, que é um branch de integração
de release, e não a base das contribuições. O GitHub costuma pré-selecionar o
`main` para você, então troque o branch base antes de enviar. O
[modelo de pull request](../../.github/PULL_REQUEST_TEMPLATE.md) vai te guiar por uma
checklist curta. Por favor, preencha-a:

- Descreva **o que** mudou e **por quê**.
- Vincule qualquer issue relacionada (por exemplo, "Closes #123").
- Adicione **capturas de tela ou um clipe para alterações de UI**, no desktop e no
  mobile.
- Confirme que o `pnpm run gate` passa e que as novas strings voltadas ao jogador
  seguem a política de contribuição English-first descrita abaixo.

No seu PR, o CI roda formatação e lint sobre os arquivos alterados, a suite de
testes completa em quatro shards paralelos, uma passada de regressão em navegador
e a checagem de tipos mais os builds do cliente, do servidor e do headless. Isso
corresponde ao que o `pnpm run gate` roda localmente, então um gate verde é um bom
indicador de um PR verde.

Uma execução verde do CI e uma checklist completa são o que procuramos antes de
integrar. Um mantenedor pode sugerir mudanças. Isso é uma parte normal e
colaborativa do processo, não uma rejeição. Buscamos ser gentis e construtivos na
revisão, e pedimos o mesmo de você.

> As mensagens de commit e os títulos de PR seguem o padrão
> [Conventional Commits](https://www.conventionalcommits.org/) com um escopo
> (`feat(talents): ...`, `fix(net): ...`). Todo commit também leva um corpo: depois
> de uma linha em branco, de uma a quatro frases simples dizendo o que mudou e por
> quê, quebradas por volta da coluna 72. Só um título não basta.

<a id="localization"></a>

## Localização

O World of ClaudeCraft é publicado em vários idiomas. Toda string visível ao
jogador precisa ser uma chave de tradução, enquanto quem contribui com recursos
normalmente adiciona apenas o texto em inglês.

- Todo texto voltado ao usuário é uma chave `t()`. Adicione o novo texto em inglês
  ao módulo por domínio correspondente em
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (elementos novos de HUD vão
  para o `hud_chrome.ts`) e depois renderize com `t('dotted.key', values)`. Só em
  inglês é exatamente o certo para um PR de recurso: o mantenedor preenche os
  outros locales no momento do release, então você não edita os overlays em
  `src/ui/i18n.locales/` e nunca deixa um placeholder em inglês ou um `// TODO`
  em um deles. A exceção M16 é um novo valor em inglês mais extenso, que também
  precisa dos cinco preenchimentos não latinos descritos em
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Números, dinheiro, datas, unidades e porcentagens passam pelos formatadores
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) em vez de montagem
  manual de string.
- Texto voltado ao jogador emitido por `src/sim/` ou `server/`, que permanecem
  agnósticos a idioma, precisa ser relocalizado na fronteira do cliente, na mesma
  alteração. O teste de guarda `npx vitest run tests/localization_fixes.test.ts`
  garante isso.
- Depois de adicionar ou alterar qualquer string, rode `pnpm run i18n:gen` e faça
  commit dos bundles regerados na mesma alteração. O gate e o CI comparam os
  artefatos commitados com uma regeração nova, então um bundle desatualizado
  quebra o build.

Então adicione suas strings em inglês e abra o PR; você não precisa traduzi-las
por conta própria. Se quiser ajudar com as traduções, veja a próxima seção.

<a id="translating-the-game"></a>

## Traduzindo o jogo

Quer melhorar um idioma ou ajudar a levar o jogo para um novo? Você não precisa
escrever nenhum código de jogo para isso:

1. A maior parte das traduções voltadas ao jogador fica nos arquivos de overlay
   por idioma em [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (um por
   locale), espelhando as chaves em inglês de
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). O texto emitido pela
   simulação e pelo servidor é traduzido em `src/ui/sim_i18n.ts` e
   `src/ui/server_i18n.ts`, o texto de talentos nos módulos `talent_i18n`, e o
   painel administrativo tem o conjunto próprio dele em
   `src/admin/i18n.locales/`.
2. Melhore as traduções existentes ou complete as que soam estranhas.
3. Rode `pnpm run i18n:gen`, faça commit dos bundles regerados junto com a sua
   edição de overlay, depois rode as suites de localização
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   e abra um PR. Só a checagem de tipos não vai te dizer se uma chave está
   faltando, já que os overlays são intencionalmente esparsos.

Para propor um locale totalmente novo, ou para conversar sobre tom e terminologia,
inicie uma thread no [Discord](https://discord.com/invite/worldofclaudecraft) e nós te ajudamos a
deixar tudo conectado. Falantes nativos e fluentes são especialmente bem-vindos.
Boas traduções fazem o jogo parecer um lar para jogadores de todos os lugares.

## Relatando bugs e pedindo recursos

Por favor, use os [modelos de issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Relato de bug.** Pesquise antes nas
  [issues existentes](https://github.com/levy-street/world-of-claudecraft/issues)
  para evitar duplicatas e inclua os passos para reproduzir, o que você esperava,
  o que aconteceu e o seu ambiente (offline ou online, navegador, desktop ou
  mobile).
- **Pedido de recurso.** Descreva o problema que você está tentando resolver, não
  apenas a solução. O contexto nos ajuda a projetar a coisa certa.
- **Vulnerabilidades de segurança.** Por favor, não abra uma issue pública.
  Relate-as em caráter privado seguindo o [SECURITY.md](../../SECURITY.md), e nós
  vamos trabalhar com você na correção e na divulgação.

## Conseguindo ajuda

Travou ou só quer dar um oi? Entre no
[Discord da comunidade](https://discord.com/invite/worldofclaudecraft). Nenhuma pergunta é pequena
demais, e novos contribuidores são sempre bem-vindos.

## Licença

Ao contribuir com código, você concorda que suas contribuições de código serão
licenciadas sob a [Licença MIT](../../LICENSE) do projeto, a mesma licença que
cobre o projeto.

A Licença MIT quer dizer exatamente o que está escrito: qualquer pessoa pode usar,
modificar e redistribuir o código, comercialmente ou não. Nossos
[Termos de Serviço](https://worldofclaudecraft.com/terms) regem o jogo hospedado
que operamos em worldofclaudecraft.com (contas, conduta, itens virtuais) e não
restringem os direitos que a Licença MIT dá a você ou a qualquer outra pessoa
sobre este código. Os nomes e a identidade visual "World of ClaudeCraft" e "Levy
Street" não são cobertos pela Licença MIT.

Os assets criativos originais (gravações de som, música, arte e obras autorais
semelhantes) são a exceção. Se você contribuir com um asset original criado por
você, pode em vez disso manter os direitos autorais e contribuí-lo sob uma licença
da sua escolha (por exemplo, CC BY-NC 4.0), desde que:

- a licença, os caminhos de asset que ela cobre e a sua atribuição sejam
  registrados na tabela de licenças em [CREDITS.md](../../CREDITS.md) como parte do
  mesmo pull request, e
- ela inclua, no mínimo, uma concessão perpétua e isenta de royalties à Levy
  Street para usar os assets comercialmente no World of ClaudeCraft, incluindo
  releases oficiais e a loja dentro do jogo.

Para os assets listados na tabela do CREDITS.md, a licença registrada ali
prevalece sobre a licença MIT padrão do projeto.

**Assets de mídia sem uma entrada no CREDITS.md não são licenciados sob MIT.** O
registro ainda está sendo completado, então uma entrada faltando significa que os
termos não foram registrados, não que o asset esteja livre para ser usado. Isso é
proposital: evita que uma contribuição não registrada seja cedida por padrão. Com
código é o contrário, e tudo que não estiver ressalvado no CREDITS.md é MIT.

É exatamente por isso que a entrada no registro não é uma papelada opcional. Se
você contribuir com um asset sem uma linha no CREDITS.md, ninguém rio abaixo pode
usá-lo e nós não temos registro do que você nos concedeu. Preencha a coluna
**Redistribution** com honestidade também. É ela que diz a quem for fazer um fork
deste projeto se pode ou não repassar o seu asset, e algumas linhas estão marcadas
como "No, permission required" justamente porque não podem.

---

Obrigado por contribuir com o World of ClaudeCraft. Mal podemos esperar para ver o
que você vai construir com a gente.
