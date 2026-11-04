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

`npm run build` compila o servidor Node e aplica as migrações quando `DATABASE_URL` está definida. `npm start` executa o artefato compilado em `.output/server/index.mjs`.

## Deploy no Render

1. Crie um novo repositório GitHub usando esta pasta como raiz e envie a branch principal.
2. No Render, escolha **New → Blueprint** e conecte o novo repositório.
3. Revise e aplique `render.yaml`. O Blueprint configura Node 22.16.0, `npm ci`, TypeScript, testes, build, `npm start`, `0.0.0.0`, PostgreSQL e o health check `/health`.
4. Aguarde o deploy. O health check consulta o banco; indisponibilidade do PostgreSQL retorna HTTP 503.

O Blueprint escolhe instâncias gratuitas para não criar cobrança sem autorização. **O PostgreSQL gratuito do Render expira 30 dias após sua criação e não serve para persistência de produção em longo prazo.** Antes de depender de dados reais, altere o banco para um plano PostgreSQL pago no Render e confirme o custo vigente. O web service gratuito também pode dormir quando ocioso e apresentar inicialização fria.

As chamadas multiplayer usam as funções HTTP do mesmo domínio com polling de um segundo; não há configuração CORS ou WebSocket separada. Links antigos com `?room=CODIGO` e o formato atual `?sala=CODIGO` preenchem o código de convite.

## O que foi consolidado

- Modos solo e dois jogadores no mesmo aparelho, categorias, teclado físico/virtual, placar local, áudio e Canvas tradicional da forca.
- Multiplayer autoritativo no servidor: salas de cinco caracteres, até oito participantes, escolha rotativa, bloqueio do autor da palavra, turnos, reconexão com token rotativo, saída, transferência de anfitrião, placar, classificação e medalhas.
- O mesmo Canvas é usado nos três modos. Cada erro confirmado no estado da sala atualiza o número de partes da forca renderizadas para todos os participantes.
- Banco PostgreSQL para salas e pontuação no deploy, com PGlite apenas como fallback de desenvolvimento.

As fontes V0.3.0, MVP e ZIP de origem não são dependências deste projeto; a interface HTML antiga e os servidores Express/Socket.IO redundantes não foram copiados. O código independente contém o motor de regras, o fluxo online e a experiência visual mais completa da base recente.
