# Lauher Games V2 — documentação técnica completa

**Projeto:** Lauher Games — Jogo da Forca
**Versão do projeto:** 2.0.0
**Pasta independente:** `LAUHER_GAMES_V2_RELEASE`
**Repositório GitHub:** `LuizLauher/lauher-games-v2`
**Última revisão desta documentação:** 9 de novembro de 2026

Este documento descreve a consolidação do jogo, a arquitetura atual, as
funcionalidades, as regras multiplayer, as tecnologias, os arquivos relevantes,
o banco de dados, o processo de execução e publicação e as validações feitas.
Ele complementa o `README.md`, que permanece como guia resumido de instalação e
deploy.

> **Estado importante:** os commits de configuração e diagnóstico do Render
> aparecem no histórico do repositório, mas as alterações recentes de pontuação,
> dica e fim de partida ainda estavam como mudanças locais não commitadas na
> última inspeção. Elas precisam ser commitadas e enviadas para `main` para que o
> Render as receba. A configuração presente no repositório não prova, por si só,
> que o banco do Render esteja provisionado, acessível ou corretamente ligado.

## 1. Resumo do produto

Lauher Games V2 é um jogo da forca para navegador. A aplicação contém:

- **Modo solo:** palavra sorteada de um banco local de palavras/categorias.
- **Modo no mesmo aparelho:** uma pessoa digita uma palavra secreta e outra
  tenta descobri-la.
- **Modo sala online:** jogadores em dispositivos diferentes entram numa sala
  por código, escolhem palavras por turnos e tentam adivinhar letras.
- **Desenho Canvas tradicional:** forca e boneco são desenhados progressivamente
  de acordo com os erros, inclusive nas salas online.
- **Teclado virtual e teclado físico**, apresentação da categoria, letras
  tentadas, vidas restantes, status da rodada e placar.
- **Efeitos sonoros e música** com controles independentes.
- **Placar local** para partidas locais e classificação multiplayer com
  posições, coroa e medalhas.
- **Persistência de salas e placares multiplayer em PostgreSQL** no deploy.

O cliente não é responsável pela verdade da partida online. O servidor guarda a
palavra secreta, valida as ações e expõe uma projeção pública sem revelar a
palavra durante a rodada.

## 2. Histórico da consolidação

### 2.1 Materiais comparados

O trabalho começou com a análise destes materiais:

1. Workspace Grok selecionado como base.
2. `LAUHER_GAMES_PROJECT_V0.3.0`.
3. `LAUHER_GAMES_MULTIPLAYER_MVP`.
4. ZIP da versão V0.3.0.

O ZIP da V0.3.0 foi comparado com a pasta extraída e identificado como cópia
idêntica do mesmo projeto, não como uma implementação separada com
funcionalidades adicionais.

As fontes antigas foram preservadas. A V2 é uma pasta própria e não depende dos
caminhos absolutos do computador onde foi desenvolvida.

### 2.2 Decisão de arquitetura

As versões antigas continham servidores e implementações multiplayer
concorrentes, incluindo um servidor Express/Socket.IO, enquanto a base recente já
tinha um app TanStack Start com funções de servidor e persistência SQL. A
consolidação manteve **uma única aplicação e um único servidor principal**:

- TanStack Start recebe as páginas e ações de servidor.
- Nitro compila/serve a aplicação como servidor Node.
- As ações multiplayer usam funções de servidor HTTP do mesmo domínio.
- O estado é compartilhado por leituras periódicas (polling); a V2 não inicia
  um segundo servidor Socket.IO.
- PostgreSQL é o armazenamento compartilhado de produção.
- PGlite é o banco embutido de desenvolvimento/teste, não a persistência de
  produção.

Essa escolha evita dois processos concorrentes, duas regras diferentes para a
mesma sala, conflitos de portas e a necessidade de configurar CORS/WebSocket
separadamente no Render.

### 2.3 Evolução do Render e do PostgreSQL

O primeiro erro de publicação relatado foi:

```text
npm error Missing script: "start"
```

O projeto V2 foi configurado com `npm start`, que executa as migrations antes
de abrir o servidor Node compilado. O Render Blueprint declara:

- um web service Node chamado `lauher-games-v2`;
- o build `npm ci && npm run typecheck && npm test && npm run build`;
- o start `npm start`;
- health check em `/health`;
- Node `22.16.0`;
- PostgreSQL `lauher-games-v2-db`;
- variável `DATABASE_URL` ligada à connection string do banco.

Em deploys posteriores surgiu o erro de sala persistente exigindo
`DATABASE_URL`. O código passou a falhar explicitamente em produção se essa
variável estiver ausente. Essa proteção foi mantida: não se usa PGlite ou
memória como substituto silencioso para o banco de produção.

O endpoint `/health` passou a verificar a conexão SQL com `SELECT 1`. HTTP 200
indica que o serviço consegue consultar o banco; HTTP 503 diferencia no JSON
entre `not_configured` (URL ausente) e `unavailable` (URL informada, mas banco
inacessível).

Foi configurada retenção de jogadores sem atividade por até 30 dias, em vez de
limpar após poucos minutos. Isso evita que um reinício comum do processo remova
salas e convites imediatamente. O banco PostgreSQL gratuito do Render expira
após 30 dias; para persistência de longo prazo, é necessário escolher um plano
que não expire e revisar o custo.

Em uma tentativa posterior, a interface mostrou uma mensagem genérica ao criar
uma sala, apesar de o serviço aparecer como ativo. Isso significa que o deploy
e a disponibilidade HTTP não comprovam que a migration, a conexão SQL e os
comandos de sala estejam todos funcionando em produção. A causa do erro
genérico dessa tentativa não foi comprovada por uma conexão real com o banco e
pelos logs completos do Render.

### 2.4 Atualização das regras multiplayer

Após a consolidação, o jogo recebeu estas alterações específicas:

- pontuação multiplayer: +15 por palavra descoberta e -5 por letra errada;
- saldo não pode ficar abaixo de zero;
- alvo de 100 pontos para vencer a partida;
- encerramento da partida se restarem menos de duas pessoas conectadas;
- reset do placar no fim da partida;
- “Poder Dica”, com opções para eliminar ou revelar uma letra;
- custo de 10 pontos por dica, no máximo uma por turno;
- usar a dica não passa a vez;
- áudio aumentado em 20%, com compressor para limitar picos;
- atualizações transacionais no banco para gravar a mutação da sala e os pontos
  como uma única operação;
- migration adicional para persistir os novos estados de partida/dica/aviso.

## 3. Tecnologias e bibliotecas

### 3.1 Linguagens e formato

- **TypeScript:** regras, servidor, funções de servidor e componentes tipados.
- **TSX/React:** interface e rotas com componentes React.
- **JavaScript ES modules:** scripts Node de migration e configuração/build.
- **SQL PostgreSQL:** schema das salas, índices e alterações de schema.
- **CSS:** estilo responsivo, com Tailwind CSS v4 e regras CSS próprias.
- **YAML:** Blueprint de deploy do Render.
- **JSON:** manifestos npm e configuração de ambiente de desenvolvimento.

### 3.2 Runtime e framework

- **Node.js:** faixa declarada `>=22.12.0 <27`; o Render fixa `22.16.0`.
- **npm:** instalação e execução de scripts.
- **React 19:** interface.
- **TanStack Start:** roteamento, SSR e server functions.
- **TanStack Router:** rotas tipadas da aplicação.
- **Vite 8:** desenvolvimento e build.
- **Nitro 3:** empacotamento e execução do servidor Node.
- **Tailwind CSS 4:** estilos utilitários e pipeline CSS.
- **TypeScript 5:** análise estática e verificação de tipos.

### 3.3 Bibliotecas principais

| Biblioteca | Uso no projeto |
|---|---|
| `@tanstack/react-start` | Aplicação full-stack, SSR e funções de servidor |
| `@tanstack/react-router` | Rotas, navegação e integração com Start |
| `react`, `react-dom` | Componentes e renderização da interface |
| `vite` | Servidor de desenvolvimento e build |
| `nitro` | Servidor de produção Node gerado pelo build |
| `tailwindcss`, `@tailwindcss/vite` | Processamento e utilitários de CSS |
| `pg` | Pool e consultas PostgreSQL no Node |
| `@electric-sql/pglite` | PostgreSQL embutido em WebAssembly para dev/testes |
| `lucide-react` | Ícones da interface |
| `lightningcss` | Transformação/minificação CSS |
| `typescript` | Verificação e compilação de tipos |

O `package.json` e o `package-lock.json` são a fonte para a lista e as versões
exatas das dependências instaladas.

### 3.4 Bibliotecas que não são usadas pelo fluxo de sala

- Não há um segundo servidor Express/Socket.IO iniciado pelo app V2.
- Não há CORS específico de jogo, pois UI e server functions usam o mesmo
  domínio.
- Não há WebSocket de jogo: a atualização de presença/estado usa polling HTTP.
- Não há autenticação por conta de usuário; as sessões de sala usam tokens
  aleatórios por jogador. O token não deve ser compartilhado publicamente.

## 4. Arquitetura e fluxo de dados

### 4.1 Visão geral

```text
Navegador React
    │
    ├── modos solo/dupla: estado local + localStorage para estatísticas
    │
    └── sala online: server functions TanStack no mesmo domínio
            │
            ├── engine.server.ts: valida ações, turnos e presença
            ├── rules.ts: regras puras, cálculo de pontos e projeção pública
            └── db.ts
                 ├── PostgreSQL via pg (Render / produção)
                 └── PGlite (desenvolvimento/testes)
```

### 4.2 Fluxo da sala online

1. O cliente pede criação de sala ou entrada em sala existente.
2. O servidor valida apelido e código, gera identidade/token e guarda somente o
   hash SHA-256 do token no banco.
3. A pessoa que cria a sala é anfitriã. O código tem cinco caracteres,
   excluindo caracteres ambíguos; o limite da sala é oito jogadores.
4. O anfitrião inicia uma partida quando há pelo menos duas pessoas conectadas.
5. Um jogador escolhe a palavra e a categoria. Quem escolhe não pode tentar
   letras naquela rodada.
6. Os demais jogadores alternam os palpites conforme a regra de turno.
7. O cliente sincroniza a sala periodicamente e exibe uma projeção pública.
8. Ao sair ou perder contato, a presença fica desatualizada; uma reconciliação
   pode transferir anfitrião/turno ou encerrar a partida.

O cliente envia o token junto das ações, mas o servidor verifica o hash no banco
antes de aceitar a ação. A palavra completa não é enviada durante uma rodada em
andamento. A projeção só revela a palavra após o término.

### 4.3 Concorrência e transações

O banco oferece uma interface SQL compartilhada por `pg` e PGlite. O método
`transaction()` é implementado para ambos:

- PostgreSQL: adquire uma conexão do pool, executa `BEGIN`, operações,
  `COMMIT`; em erro tenta `ROLLBACK` e relança o erro original.
- PGlite: usa sua transação nativa.

As mutações de partida leem e gravam estado/pontuação dentro da transação. A
gravação da sala usa `revision` como controle otimista (compare-and-swap): só
atualiza se a revisão ainda for a esperada. Conflitos concorrentes tentam
novamente um número limitado de vezes; se não resolver, o cliente recebe erro
explícito.

Os resultados de `pg` e PGlite são normalizados para reduzir divergências de
tipo entre produção e testes, especialmente valores `bigint`, `date` e
`interval`.

### 4.4 Presença, reconexão e expiração

- Um jogador é exibido como conectado se `last_seen` tiver menos de 20 segundos.
- O cliente envia sincronizações frequentes; a aba em segundo plano pode
  sincronizar mais lentamente.
- A limpeza definitiva de jogadores inativos ocorre após 30 dias.
- Se um apelido existente estiver desconectado, uma nova entrada com o mesmo
  nome pode retomar a vaga, com credencial nova e placar/histórico reiniciado
  conforme a regra de reentrada.
- A retomada da sessão por token rotaciona seu hash condicionalmente no banco;
  uma segunda retomada concorrente com o token antigo deve falhar.
- O estado da partida é reconciliado quando uma ação ou sincronização chega ao
  servidor. Não existe um worker independente que detecte ausência exatamente
  no instante em que um dispositivo se desconecta.

## 5. Funcionalidades e regras do jogo

### 5.1 Forca tradicional

- Seis vidas/erros.
- As letras são comparadas sem diferença de acento (por exemplo, `O` cobre
  `Ó`).
- Palavras aceitam letras, espaços e hífens, com tamanho limitado.
- Há teclado virtual A–Z e suporte a teclado físico.
- O componente `HangmanStage` desenha a forca e o boneco em Canvas em passos
  relacionados à quantidade de erros.
- Os modos solo, dupla e online alimentam o mesmo Canvas.
- No modo online, `displayedMistakes()` deriva os erros do estado sincronizado
  da sala; por isso a forca avança de forma igual para todos que recebem a
  atualização.

### 5.2 Solo e mesmo aparelho

- O modo solo escolhe palavra/categoria do banco local do jogo.
- O modo de duas pessoas no mesmo dispositivo permite que uma pessoa insira a
  palavra secreta e a outra adivinhe.
- O estado da rodada local fica no navegador.
- Vitórias, derrotas e sequência local usam `localStorage`; não exigem conta ou
  banco remoto.

### 5.3 Multiplayer online

- Código de sala com cinco caracteres.
- Até oito participantes.
- Entrada por código e link de convite; `?sala=CODIGO` é o parâmetro atual e
  `?room=CODIGO` também é reconhecido para compatibilidade.
- O anfitrião pode iniciar partidas; a palavra/categoria é escolhida por turno.
- O responsável pela palavra não pode dar palpites naquela rodada.
- Os palpites são validados no servidor quanto a jogador, turno, formato e
  repetição.
- O placar é gravado no PostgreSQL.
- Anfitrião pode ser transferido se sair/desconectar.
- Coroa/medalhas e posições são calculadas no ranking; empates compartilham a
  colocação e a medalha correspondente.
- A palavra é mantida privada durante a partida.
- Jogadores podem sair voluntariamente; salas sem jogadores são removidas.
- A partida termina quando restam menos de dois jogadores conectados.

### 5.4 Pontuação e fim de partida

- O placar começa em zero.
- Completar uma palavra: **+15 pontos** para quem completou.
- Cada letra errada: **−5 pontos** para quem tentou.
- O saldo individual tem piso zero; não se torna negativo.
- Letras corretas intermediárias não concedem pontos; os pontos da palavra são
  concedidos quando a palavra inteira é concluída.
- Ao chegar a **100 pontos**, o jogador vence a partida.
- Ao terminar a partida por meta ou por haver menos de dois participantes
  conectados, os pontos do match são zerados para preparar uma nova partida. O
  histórico de vitórias (`wins`) é mantido, salvo quando o jogador é removido e
  sua vaga é recriada.
- Uma rodada perdida após seis erros não concede a pontuação de vitória.

### 5.5 Poder Dica

Há duas ações:

- **Eliminar letra:** o servidor escolhe uma letra ainda não usada que não está
  na palavra e a adiciona aos erros.
- **Revelar letra:** o servidor escolhe uma letra ainda não usada que existe na
  palavra e a revela.

Regras:

- cada uso custa **10 pontos**;
- o jogador precisa ter ao menos 10 pontos antes da dica;
- só pode usar uma dica na sua vez atual;
- a dica não passa a vez; o jogador ainda pode tentar uma letra;
- o uso é validado no servidor, não só desativado na interface;
- se não houver letra elegível, o servidor recusa sem descontar pontos;
- uma dica que revele a última letra completa a palavra e concede +15 de vitória
  após descontar os 10 (efeito líquido de +5 pontos naquela ação).

### 5.6 Áudio e interface

- Música e efeitos têm controles separados e preferências locais.
- O ganho dos buses de música e efeitos foi aumentado em 20%, limitado para não
  ultrapassar o teto definido.
- Um compressor dinâmico limita picos de áudio e reduz o risco de clipping.
- A interface usa layout responsivo e os cartões dos modos se organizam em uma
  coluna em telas estreitas.
- Há mensagens/toasts de status de sala e de ações importantes.

## 6. Banco de dados e migrations

### 6.1 Tabelas

`migrations/0002_forca.sql` cria:

#### `forca_rooms`

Armazena código, anfitrião, fase, categoria, palavra secreta, letras erradas e
tentadas, resultado, participantes responsáveis por palavra/palpites e revisão
do estado, além de timestamps.

#### `forca_players`

Armazena jogador, sala, apelido, pontos, vitórias, hash de token, posição/assento
e último horário de atividade. A chave estrangeira remove jogadores quando a
sala é apagada.

Índices apoiam consultas de jogadores por sala e validação de token dentro de
uma sala.

`migrations/0003_forca_match_powers.sql` acrescenta à sala:

- `match_over`: se a partida foi encerrada;
- `hint_used`: se o jogador da vez já usou dica;
- `notice_id`, `notice_kind`, `notice_message`: aviso sincronizado;
- `winner_id`: vencedor associado ao aviso.

As migrations são ordenadas por nome de arquivo e registradas na tabela
`_migrations`. A migration de production é executada antes do servidor aceitar
tráfego. Os SQLs são idempotentes onde aplicável, mas devem ser aplicados pelo
runner do projeto, que também registra quais arquivos foram executados.

### 6.2 `DATABASE_URL`

- **Render:** deve referenciar o PostgreSQL provisionado pelo Blueprint. Se o
  web service e o banco estiverem na mesma região, usar a connection string
  interna fornecida pelo Render.
- **Local:** opcional; se omitida em desenvolvimento, usa PGlite em memória.
- **Produção:** obrigatória. Sem URL, `scripts/migrate.mjs` encerra o start e
  `getSql()` não permite fallback para PGlite.
- Nunca incluir a URL, usuário, senha ou credenciais reais em código, arquivos
  versionados, prints ou logs públicos.
- Conexões externas ao Render podem exigir TLS, por exemplo `sslmode=require`;
  não se deve acrescentar isso cegamente à URL interna sem necessidade.

### 6.3 Limites da persistência

As salas podem sobreviver a reinicializações do web service quando o PostgreSQL
está acessível e as migrations foram aplicadas. Isso não foi comprovado contra
o banco real do Render nesta sessão.

O PostgreSQL gratuito indicado no Blueprint tem limite de vida de 30 dias.
Persistência em produção por prazo maior exige migrar o banco para uma opção sem
expiração, conforme os planos/custos atuais do Render.

## 7. Arquivos do projeto

### 7.1 Entrada, interface e estilo

| Arquivo | Responsabilidade |
|---|---|
| `src/routes/index.tsx` | Rota inicial que monta o jogo |
| `src/routes/__root.tsx` | Documento HTML raiz, metadados, stylesheet e scripts |
| `src/routes/health.ts` | Health check HTTP e teste simples de conexão SQL |
| `src/router.tsx` | Criação/configuração do router TanStack |
| `src/routeTree.gen.ts` | Árvore de rotas gerada pelo TanStack |
| `src/components/forca/game-app.tsx` | UI, modos de jogo, estado do cliente, sala online e chamadas de servidor |
| `src/components/forca/hangman-stage.tsx` | Canvas do desenho tradicional da forca |
| `src/styles.css` | Tema, layout responsivo, botões, teclado, placar, hint e toasts |
| `public/` | Ícone e ativos públicos da aplicação |

### 7.2 Regras, servidor e persistência

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/forca/rules.ts` | Regras puras, validação, pontuação, turnos, dica, ranking e estado público |
| `src/lib/forca/engine.server.ts` | Operações de sala no servidor, autenticação por token, presença e SQL |
| `src/lib/forca/api.ts` | Funções de servidor que validam entrada e convertem erros em resposta da API |
| `src/lib/forca/bank.ts` | Palavras/categorias locais do modo solo |
| `src/lib/forca/audio.ts` | Música, efeitos, preferências e ganho de áudio |
| `src/lib/db.ts` | Interface SQL, pool PostgreSQL, transações e fallback PGlite |
| `migrations/0002_forca.sql` | Schema inicial das salas e jogadores |
| `migrations/0003_forca_match_powers.sql` | Campos de fim de partida, dica e avisos sincronizados |
| `scripts/migrate.mjs` | Aplicador de migrations no PostgreSQL |
| `scripts/migration-plan.mjs` | Ordenação/seleção de migrations pendentes |

### 7.3 Configuração, testes e documentação

| Arquivo | Responsabilidade |
|---|---|
| `package.json` | Scripts npm, metadados e dependências |
| `package-lock.json` | Versões resolvidas do npm |
| `vite.config.ts` | Vite, TanStack Start, Tailwind e preset Nitro Node |
| `render.yaml` | Blueprint do serviço web, banco, comandos, versão Node e health check |
| `.node-version` | Node local/alvo do deploy (`22.16.0`) |
| `.env.example` | Nomes de variáveis esperadas; sem credenciais |
| `.gitignore` | Exclusões de arquivos locais e build |
| `src/lib/forca/rules.test.ts` | Testes de regras, turnos, pontuação, meta, dicas e ranking |
| `src/lib/forca/game-app.test.ts` | Regressão para cálculo de erros/Canvas compartilhado |
| `scripts/migration-plan.test.mjs` | Testes da ordenação/seleção das migrations |
| `README.md` | Instruções resumidas de desenvolvimento e Render |
| `DOCUMENTACAO_TECNICA_COMPLETA.md` | Este documento detalhado |

## 8. Scripts e execução

### 8.1 Instalação e desenvolvimento

Na pasta `LAUHER_GAMES_V2_RELEASE`:

```sh
npm ci
npm run dev
```

O dev server usa a porta 8080 e atende em todas as interfaces locais. Para
desenvolvimento com persistência entre reinícios, configure uma URL PostgreSQL
num `.env` local (criado a partir de `.env.example`). Sem ela, o fallback PGlite
é volátil e apaga os dados ao reiniciar o processo.

### 8.2 Testes e build

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` gera a aplicação Nitro Node em `.output/`. O script de build não
precisa de uma conexão de produção; as migrations reais são executadas pelo
script `start`.

### 8.3 Inicialização de produção

```sh
npm start
```

O comando executa, na ordem:

1. `scripts/migrate.mjs`;
2. `.output/server/index.mjs`.

Se `NODE_ENV=production` e `DATABASE_URL` estiver ausente, o migrador sai com
erro e o servidor não deve iniciar. Se o banco estiver inacessível ou uma
migration falhar, o processo também deve falhar em vez de servir salas sem
persistência.

### 8.4 Verificar `/health`

Use o endereço público do Render no navegador ou num cliente HTTP:

```text
https://lauher-games-v2.onrender.com/health
```

Esperado quando serviço e banco estão acessíveis:

```json
{"ok":true,"service":"lauher-games-v2"}
```

Se o banco não estiver configurado/conectável, a rota responde HTTP 503, com
`database` igual a `not_configured` ou `unavailable`. O health check não testa
criação de sala nem migrations individuais; para isso também é preciso testar
as ações do jogo e verificar os logs de startup.

## 9. Publicação no Render

### 9.1 Blueprint

O `render.yaml` descreve:

- Web Service `lauher-games-v2`;
- runtime Node;
- plano free do serviço web;
- `buildCommand: npm ci && npm run typecheck && npm test && npm run build`;
- `startCommand: npm start`;
- `healthCheckPath: /health`;
- `NODE_VERSION=22.16.0`;
- `NODE_ENV=production`;
- `NITRO_HOST=0.0.0.0`;
- PostgreSQL `lauher-games-v2-db`, database `lauher_forca`;
- `DATABASE_URL` vinculada à propriedade `connectionString` do banco.

### 9.2 Checklist pós-deploy

1. Confirme no painel Render que o web service está vinculado ao banco correto.
2. Confirme que `DATABASE_URL` é uma referência ao banco, não uma string
   vazia. Não copie credenciais para conversas ou commits.
3. Veja nos logs a aplicação de `0002_forca.sql` e
   `0003_forca_match_powers.sql`, ou a indicação de que todas as migrations
   estão atualizadas.
4. Confirme que o servidor imprime a mensagem `Listening on`.
5. Abra `/health` e confirme HTTP 200.
6. Teste criar uma sala, entrar nela por outro navegador/dispositivo, iniciar
   partida, jogar uma rodada e sair.
7. Reinicie o web service e confirme que a sala/placar ainda existem.
8. Para uso por mais de 30 dias, confirme e ajuste o plano do PostgreSQL para
   evitar expiração e perda dos dados.

### 9.3 Diagnóstico rápido

| Sintoma | O que verificar |
|---|---|
| `Missing script: "start"` | O serviço pode apontar para repositório/branch antigo; conferir o `package.json` implantado e `startCommand` |
| `DATABASE_URL is required` | A variável/referência do banco está ausente no web service |
| `/health` retorna `not_configured` | `DATABASE_URL` vazia ou não vinculada |
| `/health` retorna `unavailable` | URL existe, mas DNS, região, permissão, TLS ou banco podem estar indisponíveis |
| `npm start` não chega a `Listening on` | Conferir primeiro o log do migrador, URL, conectividade e erros SQL |
| Erro genérico ao criar sala | Conferir a exceção `[forca]` nos logs próximos à hora da ação e testar `/health`; a mensagem da UI omite detalhes internos por segurança |
| Build sem CSS/estilo | Confirmar que o build publicado contém `/assets/styles.css` e que o servidor retorna esse ativo sem 404 |

Não publique logs contendo URI de banco, senha, token de sala ou dados privados.

## 10. Testes e evidências

### 10.1 Verificações da pasta V2

Na última validação disponível para a pasta independente:

- `npm run typecheck`: passou.
- `npm test`: **13 testes passaram, 0 falharam** (regras do jogo, contagem do
  Canvas e plano de migrations).
- `npm run build`: passou e gerou o servidor Nitro Node.
- Verificação do CSS de produção: build e HTML passaram a referenciar
  `/assets/styles.css`, caminho incluído no bundle, em vez de uma hash de CSS
  que causava 404.
- Teste de fluxo do engine sobre PGlite: migration 0003, criação/entrada de
  sala, início, seleção de palavras, pontuação, custo/limite da dica, saída e
  reset da partida foram exercitados.
- Teste local do `npm start` em modo produção sem `DATABASE_URL`: falhou
  explicitamente no migrador como esperado.
- Health check e página inicial do build compilado foram servidos localmente.
- Criação de sala pela UI foi testada no navegador; o canvas Browser conseguiu
  abrir a interface, inserir apelido e criar sala.

### 10.2 Limitações da evidência

- Não foi feito teste real de conexão ao PostgreSQL provisionado no Render.
- Não foi comprovada a execução da migration 0003 no banco remoto.
- Não foi concluído teste de sala e reinício de processo usando o PostgreSQL
  remoto.
- Não houve auditoria dos logs atuais do Render durante a tentativa que mostrou
  o erro genérico.
- Na pasta V2, o fluxo interativo completo entre dois navegadores não foi
  repetido após integrar as últimas regras; o teste fim-a-fim com dois contextos
  havia passado na base selecionada antes dessa integração. O engine V2 foi
  testado no PGlite, mas isso não substitui o teste de navegador/dispositivos
  contra o servidor publicado.
- Um `npm ci` limpo, desde cache/dependências removidas, não foi reexecutado
  após todas as alterações finais. O lockfile precisa ser mantido consistente
  com o manifest nas próximas instalações.
- Avisos de bundle do Nitro/Rolldown sobre diretivas React de dependências foram
  observados no build; o build terminou com sucesso.

### 10.3 Falhas históricas de outros workspaces

Na pasta-base Grok, o conjunto mais amplo de testes já falhou em verificações
de metadados OG e na criação de symlinks bloqueada por permissões Windows
(`EPERM`). Esses testes não fazem parte do conjunto enxuto da pasta V2 e não
foram declarados corrigidos por esta consolidação. O conjunto V2 de 13 testes
passou na última execução registrada.

## 11. Segurança, privacidade e confiabilidade

- O código usa consultas SQL parametrizadas (`$1`, `$2`, etc.) para valores
  vindos do cliente.
- Tokens de jogador são gerados aleatoriamente; o banco guarda o hash, não o
  token em texto claro.
- A palavra secreta é armazenada no servidor e omitida da projeção pública até
  o término da rodada.
- Regras de turno, pontos, dica, alvo e participação são verificadas no servidor.
- Há limitação de frequência de algumas ações multiplayer no processo.
- `revision` previne que uma atualização baseada em estado antigo sobrescreva
  silenciosamente uma alteração concorrente.
- Produção exige PostgreSQL para evitar perda de salas no restart.
- O `.env.example` não contém credenciais; `.env` real não deve ser incluído no
  Git.
- Mensagens de erro não expõem detalhes SQL ao navegador. A exceção completa é
  registrada nos logs do servidor e deve ser tratada como dado potencialmente
  sensível.

## 12. Itens pendentes antes de considerar produção comprovada

1. Confirmar no Render que `DATABASE_URL` está ligada ao Postgres correto e que
   o estado do banco não expirou.
2. Fazer deploy da versão que inclui todas as mudanças locais recentes. Na
   última inspeção, os arquivos de jogo e migration 0003 ainda apareciam como
   modificados/não commitados em `git status`; o Render não recebe essas
   alterações automaticamente.
3. Verificar os logs desde o início do `npm start` até `Listening on`, sem
   compartilhar credenciais.
4. Confirmar `/health` HTTP 200.
5. Confirmar nos logs a aplicação/estado atualizado das migrations 0002 e 0003.
6. Fazer um fluxo real: criar sala, entrar de outro dispositivo, jogar,
   pontuar, usar dica e encerrar.
7. Reiniciar o serviço e confirmar que dados permanecem no PostgreSQL.
8. Escolher plano de banco sem expiração para produção durável e confirmar seu
   custo.

Até esses passos serem feitos no serviço remoto, é correto dizer que o projeto
está **preparado** para o Render e que os fluxos passaram em validações locais,
mas não que o PostgreSQL de produção foi comprovado.

## 13. Glossário

- **Server function:** função executada no servidor por chamada do cliente,
  controlada pelo TanStack Start.
- **Polling:** consultas HTTP periódicas para obter atualizações, em vez de
  manter um WebSocket aberto.
- **PGlite:** implementação PostgreSQL embutida, executada via WebAssembly;
  útil em desenvolvimento/teste, volátil quando usada em memória.
- **Migration:** arquivo SQL versionado que cria ou altera o schema do banco.
- **Health check:** endpoint simples usado pelo Render para decidir se o serviço
  está respondendo e se a consulta básica ao banco funciona.
- **Nitro preset `node-server`:** formato de build para executar a aplicação
  como servidor Node tradicional.
- **Token de sala:** segredo aleatório que autoriza um jogador a retomar sua
  sessão; deve ser tratado como credencial.
