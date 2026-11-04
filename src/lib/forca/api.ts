import { createServerFn } from "@tanstack/react-start";
import { RuleError } from "./rules";

type SessionOk = {
  ok: true;
  token: string;
  playerId: string;
  state: import("./rules").PublicRoom;
};

type StateOk = { ok: true; state: import("./rules").PublicRoom };
type LeftOk = { ok: true };
type Fail = { ok: false; error: string };

function fail(error: unknown): Fail {
  if (error instanceof RuleError) return { ok: false, error: error.message };
  console.error("[forca]", error);
  return { ok: false, error: "O servidor não conseguiu concluir a ação. Tente novamente." };
}

export const createRoomFn = createServerFn({ method: "POST" })
  .validator((input: { name: string }) => ({ name: String(input?.name ?? "") }))
  .handler(async ({ data }): Promise<SessionOk | Fail> => {
    try {
      const engine = await import("./engine.server");
      return { ok: true, ...(await engine.createRoom(data.name)) };
    } catch (error) {
      return fail(error);
    }
  });

export const joinRoomFn = createServerFn({ method: "POST" })
  .validator((input: { name: string; code: string }) => ({
    name: String(input?.name ?? ""),
    code: String(input?.code ?? ""),
  }))
  .handler(async ({ data }): Promise<SessionOk | Fail> => {
    try {
      const engine = await import("./engine.server");
      return { ok: true, ...(await engine.joinRoom(data.name, data.code)) };
    } catch (error) {
      return fail(error);
    }
  });

export const resumeRoomFn = createServerFn({ method: "POST" })
  .validator((input: { code: string; token: string }) => ({
    code: String(input?.code ?? ""),
    token: String(input?.token ?? ""),
  }))
  .handler(async ({ data }): Promise<SessionOk | Fail> => {
    try {
      const engine = await import("./engine.server");
      return { ok: true, ...(await engine.resumeRoom(data.code, data.token)) };
    } catch (error) {
      return fail(error);
    }
  });

export const syncRoomFn = createServerFn({ method: "POST" })
  .validator((input: { code: string; playerId: string; token: string }) => ({
    code: String(input?.code ?? ""),
    playerId: String(input?.playerId ?? ""),
    token: String(input?.token ?? ""),
  }))
  .handler(async ({ data }): Promise<StateOk | Fail> => {
    try {
      const engine = await import("./engine.server");
      return { ok: true, state: await engine.syncRoom(data.code, data.playerId, data.token) };
    } catch (error) {
      return fail(error);
    }
  });

export const beginMatchFn = createServerFn({ method: "POST" })
  .validator((input: { code: string; playerId: string; token: string }) => ({
    code: String(input?.code ?? ""),
    playerId: String(input?.playerId ?? ""),
    token: String(input?.token ?? ""),
  }))
  .handler(async ({ data }): Promise<StateOk | Fail> => {
    try {
      const engine = await import("./engine.server");
      return { ok: true, state: await engine.beginMatch(data.code, data.playerId, data.token) };
    } catch (error) {
      return fail(error);
    }
  });

export const submitWordFn = createServerFn({ method: "POST" })
  .validator((input: { code: string; playerId: string; token: string; word: string; category: string }) => ({
    code: String(input?.code ?? ""),
    playerId: String(input?.playerId ?? ""),
    token: String(input?.token ?? ""),
    word: String(input?.word ?? ""),
    category: String(input?.category ?? ""),
  }))
  .handler(async ({ data }): Promise<StateOk | Fail> => {
    try {
      const engine = await import("./engine.server");
      return {
        ok: true,
        state: await engine.submitWord(data.code, data.playerId, data.token, data.word, data.category),
      };
    } catch (error) {
      return fail(error);
    }
  });

export const submitGuessFn = createServerFn({ method: "POST" })
  .validator((input: { code: string; playerId: string; token: string; letter: string }) => ({
    code: String(input?.code ?? ""),
    playerId: String(input?.playerId ?? ""),
    token: String(input?.token ?? ""),
    letter: String(input?.letter ?? ""),
  }))
  .handler(async ({ data }): Promise<StateOk | Fail> => {
    try {
      const engine = await import("./engine.server");
      return { ok: true, state: await engine.submitGuess(data.code, data.playerId, data.token, data.letter) };
    } catch (error) {
      return fail(error);
    }
  });

export const leaveRoomFn = createServerFn({ method: "POST" })
  .validator((input: { code: string; playerId: string; token: string }) => ({
    code: String(input?.code ?? ""),
    playerId: String(input?.playerId ?? ""),
    token: String(input?.token ?? ""),
  }))
  .handler(async ({ data }): Promise<LeftOk | Fail> => {
    try {
      const engine = await import("./engine.server");
      await engine.leaveRoom(data.code, data.playerId, data.token);
      return { ok: true };
    } catch (error) {
      return fail(error);
    }
  });
