import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import {
  MAX_PLAYERS,
  RuleError,
  afterLeave,
  chooseWord,
  guessLetter,
  projectRoom,
  reconcile,
  startMatch,
  cleanName,
  type Phase,
  type HintMode,
  type PlayerState,
  type PublicRoom,
  type RoomState,
  type RoundResult,
  type ScoreDelta,
  hintCandidates,
  useHint,
} from "./rules";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const hits = new Map<string, number[]>();

type RowRoom = {
  code: string;
  host_id: string;
  phase: string;
  category: string;
  secret_word: string;
  wrong_letters: string;
  guessed_letters: string;
  eliminated_letters: string;
  result: string | null;
  last_guesser_id: string | null;
  word_chooser_id: string | null;
  current_turn_id: string | null;
  revision: number;
  match_over: boolean | number | string;
  hint_used: boolean | number | string;
  notice_id: number | null;
  notice_kind: string | null;
  notice_message: string | null;
  winner_id: string | null;
};

type RowPlayer = {
  id: string;
  name: string;
  score: number;
  wins: number;
  streak: number;
  seat: number;
  connected: boolean | number | string;
};

export type SessionResult = { token: string; playerId: string; state: PublicRoom };

function sha(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeCode(): string {
  let code = "";
  for (let i = 0; i < 5; i += 1) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

function splitLetters(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((letter) => letter.trim())
    .filter((letter) => /^[A-Z]$/.test(letter));
}

function asPhase(value: string): Phase {
  if (value === "lobby" || value === "choosing" || value === "playing" || value === "finished") return value;
  return "lobby";
}

function asResult(value: string | null): RoundResult {
  return value === "won" || value === "lost" ? value : null;
}

function asBool(value: boolean | number | string): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}

function allow(key: string, limit: number): void {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < 10_000);
  if (recent.length >= limit) throw new RuleError("Muitas ações em pouco tempo. Aguarde alguns segundos.");
  recent.push(now);
  hits.set(key, recent);
}

function mapRoom(row: RowRoom): RoomState {
  return {
    code: row.code,
    hostId: row.host_id,
    phase: asPhase(row.phase),
    category: row.category ?? "",
    secret: row.secret_word ?? "",
    wrong: splitLetters(row.wrong_letters),
    guessed: splitLetters(row.guessed_letters),
    eliminatedLetters: splitLetters(row.eliminated_letters),
    result: asResult(row.result),
    lastGuesserId: row.last_guesser_id,
    wordChooserId: row.word_chooser_id,
    currentTurnId: row.current_turn_id,
    revision: Number(row.revision) || 0,
    matchOver: asBool(row.match_over),
    hintUsed: asBool(row.hint_used),
    notice: row.notice_kind && row.notice_message
      ? {
          id: Number(row.notice_id) || 0,
          kind: row.notice_kind as "players" | "target" | "hint",
          message: row.notice_message,
          winnerId: row.winner_id,
        }
      : null,
  };
}

function mapPlayers(rows: RowPlayer[]): PlayerState[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    score: Number(row.score) || 0,
    wins: Number(row.wins) || 0,
    streak: Number(row.streak) || 0,
    connected: asBool(row.connected),
    seat: Number(row.seat) || 0,
  }));
}

async function sweep(sql: Sql): Promise<void> {
  await sql.query(
    "delete from forca_players where last_seen < now() - interval '30 days'",
  );
  await sql.query(
    "delete from forca_rooms r where not exists (select 1 from forca_players p where p.room_code = r.code)",
  );
}

async function loadRoom(sql: Sql, code: string): Promise<RoomState> {
  const rows = await sql.query<RowRoom>(
    "select code, host_id, phase, category, secret_word, wrong_letters, guessed_letters, eliminated_letters, result, last_guesser_id, word_chooser_id, current_turn_id, revision, match_over, hint_used, notice_id, notice_kind, notice_message, winner_id from forca_rooms where code = $1",
    [code],
  );
  const row = rows[0];
  if (!row) throw new RuleError("Sala não encontrada. Confira o código.");
  return mapRoom(row);
}

async function loadPlayers(sql: Sql, code: string): Promise<PlayerState[]> {
  const rows = await sql.query<RowPlayer>(
    `select id, name, score, wins, streak, seat,
      (last_seen > now() - interval '20 seconds') as connected
     from forca_players where room_code = $1 order by seat asc`,
    [code],
  );
  return mapPlayers(rows);
}

async function saveRoom(sql: Sql, room: RoomState, expectedRevision: number): Promise<boolean> {
  const rows = await sql.query<{ revision: number }>(
    `update forca_rooms set
      host_id = $2, phase = $3, category = $4, secret_word = $5,
      wrong_letters = $6, guessed_letters = $7, eliminated_letters = $8, result = $9,
      last_guesser_id = $10, word_chooser_id = $11, current_turn_id = $12,
      match_over = $13, hint_used = $14, notice_id = $15,
      notice_kind = $16, notice_message = $17, winner_id = $18,
      revision = revision + 1, updated_at = now()
     where code = $1 and revision = $19
     returning revision`,
    [
      room.code,
      room.hostId,
      room.phase,
      room.category,
      room.secret,
      room.wrong.join(","),
      room.guessed.join(","),
      room.eliminatedLetters.join(","),
      room.result,
      room.lastGuesserId,
      room.wordChooserId,
      room.currentTurnId,
      room.matchOver,
      room.hintUsed,
      room.notice?.id ?? null,
      room.notice?.kind ?? null,
      room.notice?.message ?? null,
      room.notice?.winnerId ?? null,
      expectedRevision,
    ],
  );
  return rows.length > 0;
}

async function applyScores(sql: Sql, scores: ScoreDelta[]): Promise<void> {
  for (const delta of scores) {
    await sql.query(
      `update forca_players
       set score = greatest(0, score + $2),
           wins = wins + $3,
           streak = coalesce($4, streak)
       where id = $1`,
      [delta.playerId, delta.score, delta.wins, delta.streak ?? null],
    );
  }
}

async function touch(sql: Sql, playerId: string): Promise<void> {
  await sql.query("update forca_players set last_seen = now() where id = $1", [playerId]);
}

async function resetRoomScores(sql: Sql, code: string): Promise<void> {
  await sql.query("update forca_players set score = 0, streak = 0 where room_code = $1", [code]);
}

async function project(sql: Sql, code: string, youId: string): Promise<PublicRoom> {
  const freshRoom = await loadRoom(sql, code);
  const freshPlayers = await loadPlayers(sql, code);
  return projectRoom(freshRoom, freshPlayers, youId);
}

async function withPlayer(
  sql: Sql,
  code: string,
  playerId: string,
  token: string,
): Promise<{ sql: Sql; room: RoomState; players: PlayerState[] }> {
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(cleanCode)) throw new RuleError("Código inválido. Use cinco caracteres.");
  const hash = sha(token);
  const auth = await sql.query<{ id: string }>(
    "select id from forca_players where id = $1 and room_code = $2 and token_hash = $3",
    [playerId, cleanCode, hash],
  );
  if (!auth.length) throw new RuleError("Sessão expirada. Entre de novo com o código da sala.");
  await touch(sql, playerId);
  await sql.query(
    "update forca_players set score = 0 where room_code = $1 and last_seen < now() - interval '20 seconds'",
    [cleanCode],
  );
  await sweep(sql);
  let room = await loadRoom(sql, cleanCode);
  let players = await loadPlayers(sql, cleanCode);
  const reconciled = reconcile(room, players);
  if (reconciled !== room) {
    const saved = await saveRoom(sql, reconciled, room.revision);
    if (saved && reconciled.matchOver && !room.matchOver) {
      await resetRoomScores(sql, cleanCode);
    }
    room = saved ? reconciled : await loadRoom(sql, cleanCode);
    players = await loadPlayers(sql, cleanCode);
  }
  return { sql, room, players };
}

export async function createRoom(nameRaw: string): Promise<SessionResult> {
  const name = cleanName(nameRaw);
  if (name.length < 1) throw new RuleError("Digite um apelido válido.");
  allow("create:" + name.toLowerCase(), 12);
  const sql = await getSql();
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  return sql.transaction(async (tx) => {
    await sweep(tx);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = makeCode();
      const existing = await tx.query("select code from forca_rooms where code = $1", [code]);
      if (existing.length) continue;
      await tx.query(
        `insert into forca_rooms
          (code, host_id, phase, category, secret_word, wrong_letters, guessed_letters, current_turn_id, revision)
         values ($1, $2, 'lobby', '', '', '', '', $2, 0)`,
        [code, id],
      );
      await tx.query(
        `insert into forca_players (id, room_code, name, score, wins, token_hash, seat, last_seen)
         values ($1, $2, $3, 0, 0, $4, 0, now())`,
        [id, code, name, sha(token)],
      );
      return { token, playerId: id, state: await project(tx, code, id) };
    }
    throw new RuleError("Não foi possível criar a sala. Tente novamente.");
  });
}

export async function joinRoom(nameRaw: string, codeRaw: string): Promise<SessionResult> {
  const name = cleanName(nameRaw);
  const code = String(codeRaw || "").trim().toUpperCase();
  if (name.length < 1) throw new RuleError("Digite um apelido válido.");
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) throw new RuleError("Código inválido. Use cinco caracteres.");
  allow("join:" + code, 20);
  const sql = await getSql();
  const token = randomBytes(32).toString("base64url");
  return sql.transaction(async (tx) => {
    await sweep(tx);
    const room = await loadRoom(tx, code);
    if (room.phase === "playing" && !room.matchOver) {
      throw new RuleError("A rodada já começou. Aguarde a próxima para entrar.");
    }
    const players = await loadPlayers(tx, code);
    const duplicate = await tx.query<{ id: string; seat: number; connected: boolean }>(
      `select id, seat, (last_seen > now() - interval '20 seconds') as connected
       from forca_players where room_code = $1 and lower(name) = lower($2)
       order by seat asc limit 1 for update`,
      [code, name],
    );
    if (duplicate[0]?.connected) throw new RuleError("Esse apelido já está em uso nesta sala.");
    if (!duplicate.length && players.length >= MAX_PLAYERS) throw new RuleError("Esta sala está cheia.");

    const id = duplicate[0]?.id ?? randomUUID();
    const seat = duplicate[0]?.seat ?? players.reduce((max, player) => Math.max(max, player.seat), -1) + 1;
    if (duplicate.length) {
      await tx.query(
        `update forca_players set name = $2, score = 0, wins = 0, streak = 0, token_hash = $3, last_seen = now()
         where id = $1 and room_code = $4`,
        [id, name, sha(token), code],
      );
    } else {
      await tx.query(
        `insert into forca_players (id, room_code, name, score, wins, token_hash, seat, last_seen)
         values ($1, $2, $3, 0, 0, $4, $5, now())`,
        [id, code, name, sha(token), seat],
      );
    }
    await tx.query("update forca_rooms set revision = revision + 1, updated_at = now() where code = $1", [code]);
    return { token, playerId: id, state: await project(tx, code, id) };
  });
}

export async function resumeRoom(codeRaw: string, token: string): Promise<SessionResult> {
  const code = String(codeRaw || "").trim().toUpperCase();
  if (!token || !/^[A-HJ-NP-Z2-9]{5}$/.test(code)) {
    throw new RuleError("Não foi possível recuperar a sessão. Entre de novo pelo código.");
  }
  const sql = await getSql();
  return sql.transaction(async (tx) => {
    const found = await tx.query<{ id: string }>(
      "select id from forca_players where room_code = $1 and token_hash = $2",
      [code, sha(token)],
    );
    const player = found[0];
    if (!player) throw new RuleError("Sessão expirada ou inválida. Entre de novo pelo código.");
    const rotatedToken = randomBytes(32).toString("base64url");
    const rotated = await tx.query<{ id: string }>(
      `update forca_players set token_hash = $1, last_seen = now()
       where id = $2 and room_code = $3 and token_hash = $4
       returning id`,
      [sha(rotatedToken), player.id, code, sha(token)],
    );
    if (!rotated.length) throw new RuleError("Sessão já foi retomada em outro dispositivo. Entre novamente.");
    const loaded = await withPlayer(tx, code, player.id, rotatedToken);
    return {
      token: rotatedToken,
      playerId: player.id,
      state: projectRoom(loaded.room, loaded.players, player.id),
    };
  });
}

export async function syncRoom(code: string, playerId: string, token: string): Promise<PublicRoom> {
  allow("sync:" + playerId, 30);
  const sql = await getSql();
  return sql.transaction(async (tx) => {
    const loaded = await withPlayer(tx, code, playerId, token);
    return projectRoom(loaded.room, loaded.players, playerId);
  });
}

async function commit(
  code: string,
  playerId: string,
  token: string,
  mutate: (room: RoomState, players: PlayerState[]) => { room: RoomState; scores: ScoreDelta[] },
): Promise<PublicRoom> {
  allow("act:" + playerId, 24);
  const sql = await getSql();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const committed = await sql.transaction(async (tx) => {
      const loaded = await withPlayer(tx, code, playerId, token);
      const next = mutate(loaded.room, loaded.players);
      const saved = await saveRoom(tx, next.room, loaded.room.revision);
      if (!saved) return null;
      if (loaded.room.matchOver && !next.room.matchOver) {
        await resetRoomScores(tx, loaded.room.code);
      }
      await applyScores(tx, next.scores);
      return project(tx, loaded.room.code, playerId);
    });
    if (committed) return committed;
  }
  throw new RuleError("A sala mudou ao mesmo tempo. Tente novamente.");
}

export async function beginMatch(code: string, playerId: string, token: string): Promise<PublicRoom> {
  return commit(code, playerId, token, (room, players) => ({
    room: startMatch(room, players, playerId),
    scores: [],
  }));
}

export async function submitWord(
  code: string,
  playerId: string,
  token: string,
  word: string,
  category: string,
): Promise<PublicRoom> {
  return commit(code, playerId, token, (room, players) => ({
    room: chooseWord(room, players, playerId, word, category),
    scores: [],
  }));
}

export async function submitGuess(
  code: string,
  playerId: string,
  token: string,
  letter: string,
): Promise<PublicRoom> {
  return commit(code, playerId, token, (room, players) => guessLetter(room, players, playerId, letter));
}

export async function submitHint(
  code: string,
  playerId: string,
  token: string,
  mode: HintMode,
): Promise<PublicRoom> {
  return commit(code, playerId, token, (room, players) => {
    const candidates = hintCandidates(room, mode);
    if (!candidates.length) {
      throw new RuleError(
        `Não há letra disponível para ${mode === "reveal" ? "revelar" : "eliminar"}. Nenhum ponto foi descontado.`,
      );
    }
    const letter = candidates[randomInt(candidates.length)]!;
    return useHint(room, players, playerId, mode, letter);
  });
}

export async function leaveRoom(code: string, playerId: string, token: string): Promise<{ left: true }> {
  const sql = await getSql();
  return sql.transaction(async (tx) => {
    const loaded = await withPlayer(tx, code, playerId, token);
    const snapshot = loaded.players;
    await tx.query("delete from forca_players where id = $1 and room_code = $2", [playerId, loaded.room.code]);
    const next = afterLeave(loaded.room, snapshot, playerId);
    if (!next) {
      await tx.query("delete from forca_rooms where code = $1", [loaded.room.code]);
      return { left: true };
    }
    const saved = await saveRoom(tx, next, loaded.room.revision);
    if (saved && next.matchOver && !loaded.room.matchOver) {
      await resetRoomScores(tx, loaded.room.code);
    }
    if (!saved) {
      const latest = await loadRoom(tx, loaded.room.code);
      const players = await loadPlayers(tx, loaded.room.code);
      const healed = reconcile(latest, players);
      if (healed !== latest) {
        const fixed = await saveRoom(tx, healed, latest.revision);
        if (fixed && healed.matchOver && !latest.matchOver) {
          await resetRoomScores(tx, loaded.room.code);
        }
      }
    }
    return { left: true };
  });
}
