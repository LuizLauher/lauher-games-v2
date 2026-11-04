# Lauher Games V2 — Jogo da Forca

Versão independente consolidada do jogo da forca, com partidas solo, dois jogadores no mesmo aparelho e salas multiplayer online. O frontend e as funções de sala são servidos pelo mesmo aplicativo TanStack Start/Nitro; não há um servidor Express/Socket.IO paralelo.

## Requisitos

- Node.js 22.12 ou superior (a configuração do Render fixa 22.16.0).
- npm.
- PostgreSQL para persistência entre reinicializações. Sem `DATABASE_URL`, o desenvolvimento usa PGlite em memória.

## Desenvolvimento local

```sh
npm ci
```

Opcionalmente, copie `.env.example` para `.env` e preencha `DATABASE_URL` com uma instância PostgreSQL. Sem isso, o banco PGlite é local e volátil.

```sh
npm run dev
```

O jogo fica disponível em `http://localhost:8080`. Para conferir o código:

```sh
npm test
npm run typecheck
npm run build
npm start
```

`npm run build` compila o servidor Node. Antes de servir tráfego, `npm start` aplica as migrações no banco conectado e só então executa `.output/server/index.mjs`. Em produção, a inicialização falha se `DATABASE_URL` estiver ausente; migrações concorrentes são serializadas no PostgreSQL.

## Deploy no Render

1. No Render, escolha **New → Blueprint** e conecte `LuizLauher/lauher-games-v2`. Revise e aplique `render.yaml`; ele declara o serviço web e um PostgreSQL (`lauher-games-v2-db`), e liga `DATABASE_URL` à connection string interna desse banco.
2. Se já existir um serviço web criado manualmente, confirme que ele está na mesma região do PostgreSQL. Em **Environment → Environment Variables**, crie `DATABASE_URL` como referência ao PostgreSQL e selecione a **Internal Database URL**; não cole uma senha no código nem use a URL externa entre serviços Render na mesma região. Salve com **Save, rebuild, and deploy**.
3. O build executa `npm ci`, typecheck, testes e compilação. Na inicialização do serviço, antes de abrir o servidor web, as migrations conectam ao banco pela rede privada do Render. Em produção, a inicialização falha explicitamente se `DATABASE_URL` estiver ausente ou se a conexão/migration falhar.
4. Após o deploy, confirme nos logs `[migrate] applied 0002_forca.sql` (ou `up to date`) antes de `Listening on`. Confirme também que `/health` retorna HTTP 200. Se o banco estiver em outra região ou exigir conexão externa, use a URL adequada; conexões externas do Render exigem TLS (`sslmode=require`).

O Blueprint escolhe instâncias gratuitas para não criar cobrança sem autorização. **O PostgreSQL gratuito do Render expira 30 dias após sua criação e não serve para persistência de produção em longo prazo.** Antes de depender de dados reais, altere o banco para um plano PostgreSQL pago no Render e confirme o custo vigente. O web service gratuito também pode dormir quando ocioso e apresentar inicialização fria.

As chamadas multiplayer usam as funções HTTP do mesmo domínio com polling de um segundo; não há configuração CORS ou WebSocket separada. Links antigos com `?room=CODIGO` e o formato atual `?sala=CODIGO` preenchem o código de convite.

## O que foi consolidado

- Modos solo e dois jogadores no mesmo aparelho, categorias, teclado físico/virtual, placar local, áudio e Canvas tradicional da forca.
- Multiplayer autoritativo no servidor: salas de cinco caracteres, até oito participantes, escolha rotativa, bloqueio do autor da palavra, turnos, reconexão com token rotativo, saída, transferência de anfitrião, placar, classificação e medalhas.
- Salas e placares ficam no PostgreSQL entre reinicializações; participantes sem atividade só são removidos após 30 dias, evitando que um restart ou hibernação normal apague convites e partidas.
- O mesmo Canvas é usado nos três modos. Cada erro confirmado no estado da sala atualiza o número de partes da forca renderizadas para todos os participantes.
- Banco PostgreSQL para salas e pontuação no deploy, com PGlite apenas como fallback de desenvolvimento.

As fontes V0.3.0, MVP e ZIP de origem não são dependências deste projeto; a interface HTML antiga e os servidores Express/Socket.IO redundantes não foram copiados. O código independente contém o motor de regras, o fluxo online e a experiência visual mais completa da base recente.
