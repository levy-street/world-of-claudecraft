<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · **Português (Brasil)** · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

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

Você vai precisar do [Node.js 22+](https://nodejs.org/) e do npm. Para o servidor
multiplayer, também é bom ter o [Docker](https://www.docker.com/) para rodar o
Postgres.

```bash
# 1. Faça um fork do repositório no GitHub e clone o seu fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Instale as dependencias
npm ci

# 3. Rode o cliente offline (sem servidor ou banco de dados)
npm run dev          # abra a URL que aparecer (geralmente http://localhost:5173)
```

Isso já é o suficiente para jogar o mundo offline e trabalhar na maior parte das
coisas. Para rodar a stack online completa:

```bash
npm run db:up        # sobe o Postgres 16 no Docker (banco de dev na porta 5433)
npm run server       # compila e roda o servidor autoritativo do jogo na :8787
npm run dev          # em outro terminal; o cliente faz proxy para o servidor
```

O [README](../../README.md) traz o guia completo de hospedar, desenvolver e jogar, e os
arquivos `CLAUDE.md` espalhados pelo repositório documentam as convenções de cada
área.

## Fazendo a sua alteração

1. **Crie um branch** a partir do `main`: `feature/<short-slug>` ou `fix/<short-slug>`.
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
- **Não edite à mão os arquivos gerados** como os `*.generated.ts`. Gere-os
  novamente pelo build.
- **Nunca faça commit de segredos** nem de um arquivo `.env`, e nunca ative o
  `ALLOW_DEV_COMMANDS` em um caminho de produção, já que ele libera cheats.

## Antes de abrir um pull request

Por favor, rode estes comandos localmente. São as mesmas verificações que o CI
executa:

```bash
npm test                    # suite do Vitest
npx tsc --noEmit            # checagem de tipos do TypeScript (o projeto é strict)
npm run build               # build de producao do cliente
```

Se você alterou código do servidor ou headless, rode também `npm run build:server`
e `npm run build:env`.

Depois, teste sua alteração tanto no desktop quanto no mobile, incluindo uma
viewport do tamanho de um celular em retrato e paisagem, se ela mexer em qualquer
coisa que os jogadores vejam. Os alvos de toque devem ter pelo menos 40x40px e as
entradas de formulário pelo menos 16px de fonte. Os padrões de UI estão
documentados em [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Abrindo o pull request

Suba o seu branch e abra um PR contra o `main`. O
[modelo de pull request](../../.github/PULL_REQUEST_TEMPLATE.md) vai te guiar por uma
checklist curta. Por favor, preencha-a:

- Descreva **o que** mudou e **por quê**.
- Vincule qualquer issue relacionada (por exemplo, "Closes #123").
- Adicione **capturas de tela ou um clipe para alterações de UI**, no desktop e no
  mobile.
- Confirme que os testes, a checagem de tipos e o build passam, e que as novas
  strings estão traduzidas.

Uma execução verde do CI e uma checklist completa são o que procuramos antes de
integrar. Um mantenedor pode sugerir mudanças. Isso é uma parte normal e
colaborativa do processo, não uma rejeição. Buscamos ser gentis e construtivos na
revisão, e pedimos o mesmo de você.

> As mensagens de commit e os títulos de PR seguem o padrão
> [Conventional Commits](https://www.conventionalcommits.org/) com um escopo
> quando faz sentido (`feat(talents): ...`, `fix(net): ...`). É uma convenção de
> que gostamos, mais do que uma exigência rígida. Mensagens claras e descritivas
> importam mais do que formatação perfeita.

<a id="localization"></a>

## Localização

O World of ClaudeCraft está disponível em vários idiomas, e nós mantemos as coisas
assim conforme o jogo cresce. Cada string visível ao jogador é traduzida para
todos os locales suportados.

- Todo texto voltado ao usuário é uma chave `t()` definida em
  [`src/ui/i18n.ts`](../../src/ui/i18n.ts). Adicione uma nova string ao locale `en`
  primeiro e, depois, forneça uma tradução de verdade em todos os outros locales
  em `supportedLanguages`. Nada de placeholders em inglês, e nada de `// TODO`.
- Números, dinheiro, datas, unidades e porcentagens passam pelos formatadores
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) em vez de montagem
  manual de string.
- Texto voltado ao jogador emitido por `src/sim/` ou `server/`, que permanecem
  agnósticos a idioma, precisa ser relocalizado na fronteira do cliente, na mesma
  alteração. O teste de guarda `npx vitest run tests/localization_fixes.test.ts`
  garante isso.

Se a sua alteração adiciona uma string e você só consegue escrevê-la em alguns
idiomas, tudo bem. Abra o PR e peça ajuda com o resto na descrição. Preferimos
muito mais te ajudar a terminar do que ver você se segurar.

<a id="translating-the-game"></a>

## Traduzindo o jogo

Quer melhorar um idioma ou ajudar a levar o jogo para um novo? Você não precisa
escrever nenhum código de jogo para isso:

1. Abra [`src/ui/i18n.ts`](../../src/ui/i18n.ts) e encontre o locale em que você quer
   trabalhar. Cada objeto de locale lista as mesmas chaves que o `en`.
2. Melhore as traduções existentes ou ajuste as que soam estranhas.
3. Rode `npx tsc --noEmit` para confirmar que nada está faltando e depois abra um
   PR.

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

## Conseguindo ajuda

Travou ou só quer dar um oi? Entre no
[Discord da comunidade](https://discord.com/invite/worldofclaudecraft). Nenhuma pergunta é pequena
demais, e novos contribuidores são sempre bem-vindos.

## Licença

Ao contribuir, você concorda que suas contribuições serão licenciadas sob a
[Licença MIT](../../LICENSE) do projeto, a mesma licença que cobre o projeto.

---

Obrigado por contribuir com o World of ClaudeCraft. Mal podemos esperar para ver o
que você vai construir com a gente.
