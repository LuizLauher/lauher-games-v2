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
  type PlayerState,
  type PublicRoom,
  type RoomState,
  type RoundResult,
  type ScoreDelta,
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
  result: string | null;
  last_guesser_id: string | null;
  word_chooser_id: string | null;
  current_turn_id: string | null;
  revision: number;
};

type RowPlayer = {
  id: string;
  name: string;
  score: number;
  wins: number;
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
    result: asResult(row.result),
    lastGuesserId: row.last_guesser_id,
    wordChooserId: row.word_chooser_id,
    currentTurnId: row.current_turn_id,
    revision: Number(row.revision) || 0,
  };
}

function mapPlayers(rows: RowPlayer[]): PlayerState[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    score: Number(row.score) || 0,
    wins: Number(row.wins) || 0,
    connected: asBool(row.connected),
    seat: Number(row.seat) || 0,
  }));
}

async function sweep(sql: Sql): Promise<void> {
  await sql.query(
    "delete from forca_players where last_seen < now() - interval '10 minutes'",
  );
  await sql.query(
    "delete from forca_rooms r where not exists (select 1 from forca_players p where p.room_code = r.code)",
  );
}

async function loadRoom(sql: Sql, code: string): Promise<RoomState> {
  const rows = await sql.query<RowRoom>(
    "select code, host_id, phase, category, secret_word, wrong_letters, guessed_letters, result, last_guesser_id, word_chooser_id, current_turn_id, revision from forca_rooms where code = $1",
    [code],
  );
  const row = rows[0];
  if (!row) throw new RuleError("Sala não encontrada. Confira o código.");
  return mapRoom(row);
}

async function loadPlayers(sql: Sql, code: string): Promise<PlayerState[]> {
  const rows = await sql.query<RowPlayer>(
    `select id, name, score, wins, seat,
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
      wrong_letters = $6, guessed_letters = $7, result = $8,
      last_guesser_id = $9, word_chooser_id = $10, current_turn_id = $11,
      revision = revision + 1, updated_at = now()
     where code = $1 and revision = $12
     returning revision`,
    [
      room.code,
      room.hostId,
      room.phase,
      room.category,
      room.secret,
      room.wrong.join(","),
      room.guessed.join(","),
      room.result,
      room.lastGuesserId,
      room.wordChooserId,
      room.currentTurnId,
      expectedRevision,
    ],
  );
  return rows.length > 0;
}

async function applyScores(sql: Sql, scores: ScoreDelta[]): Promise<void> {
  for (const delta of scores) {
    await sql.query("update forca_players set score = score + $2, wins = wins + $3 where id = $1", [
      delta.playerId,
      delta.score,
      delta.wins,
    ]);
  }
}

async function touch(sql: Sql, playerId: string): Promise<void> {
  await sql.query("update forca_players set last_seen = now() where id = $1", [playerId]);
}

async function project(sql: Sql, code: string, youId: string): Promise<PublicRoom> {
  const [freshRoom, freshPlayers] = await Promise.all([loadRoom(sql, code), loadPlayers(sql, code)]);
  return projectRoom(freshRoom, freshPlayers, youId);
}

async function withPlayer(
  code: string,
  playerId: string,
  token: string,
): Promise<{ sql: Sql; room: RoomState; players: PlayerState[] }> {
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(cleanCode)) throw new RuleError("Código inválido. Use cinco caracteres.");
  const sql = await getSql();
  const hash = sha(token);
  const auth = await sql.query<{ id: string }>(
    "select id from forca_players where id = $1 and room_code = $2 and token_hash = $3",
    [playerId, cleanCode, hash],
  );
  if (!auth.length) throw new RuleError("Sessão expirada. Entre de novo com o código da sala.");
  await touch(sql, playerId);
  await sweep(sql);
  let room = await loadRoom(sql, cleanCode);
  let players = await loadPlayers(sql, cleanCode);
  const reconciled = reconcile(room, players);
  if (reconciled !== room) {
    const saved = await saveRoom(sql, reconciled, room.revision);
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
  await sweep(sql);
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = makeCode();
    const existing = await sql.query("select code from forca_rooms where code = $1", [code]);
    if (existing.length) continue;
    await sql.query(
      `insert into forca_rooms
        (code, host_id, phase, category, secret_word, wrong_letters, guessed_letters, current_turn_id, revision)
       values ($1, $2, 'lobby', '', '', '', '', $2, 0)`,
      [code, id],
    );
    await sql.query(
      `insert into forca_players (id, room_code, name, score, wins, token_hash, seat, last_seen)
       values ($1, $2, $3, 0, 0, $4, 0, now())`,
      [id, code, name, sha(token)],
    );
    return { token, playerId: id, state: await project(sql, code, id) };
  }
  throw new RuleError("Não foi possível criar a sala. Tente novamente.");
}

export async function joinRoom(nameRaw: string, codeRaw: string): Promise<SessionResult> {
  const name = cleanName(nameRaw);
  const code = String(codeRaw || "").trim().toUpperCase();
  if (name.length < 1) throw new RuleError("Digite um apelido válido.");
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) throw new RuleError("Código inválido. Use cinco caracteres.");
  allow("join:" + code, 20);
  const sql = await getSql();
  await sweep(sql);
  const room = await loadRoom(sql, code);
  if (room.phase === "playing") throw new RuleError("A rodada já começou. Aguarde a próxima para entrar.");
  const players = await loadPlayers(sql, code);
  if (players.length >= MAX_PLAYERS) throw new RuleError("Esta sala está cheia.");
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const seat = players.reduce((max, player) => Math.max(max, player.seat), -1) + 1;
  await sql.query(
    `insert into forca_players (id, room_code, name, score, wins, token_hash, seat, last_seen)
     values ($1, $2, $3, 0, 0, $4, $5, now())`,
    [id, code, name, sha(token), seat],
  );
  return { token, playerId: id, state: await project(sql, code, id) };
}

export async function resumeRoom(codeRaw: string, token: string): Promise<SessionResult> {
  const code = String(codeRaw || "").trim().toUpperCase();
  if (!token || !/^[A-HJ-NP-Z2-9]{5}$/.test(code)) {
    throw new RuleError("Não foi possível recuperar a sessão. Entre de novo pelo código.");
  }
  const sql = await getSql();
  const found = await sql.query<{ id: string }>(
    "select id from forca_players where room_code = $1 and token_hash = $2",
    [code, sha(token)],
  );
  const player = found[0];
  if (!player) throw new RuleError("Sessão expirada ou inválida. Entre de novo pelo código.");
  const rotatedToken = randomBytes(32).toString("base64url");
  const rotated = await sql.query<{ id: string }>(
    `update forca_players set token_hash = $1, last_seen = now()
     where id = $2 and room_code = $3 and token_hash = $4
     returning id`,
    [sha(rotatedToken), player.id, code, sha(token)],
  );
  if (!rotated.length) throw new RuleError("Sessão já foi retomada em outro dispositivo. Entre novamente.");
  const loaded = await withPlayer(code, player.id, rotatedToken);
  return { token: rotatedToken, playerId: player.id, state: projectRoom(loaded.room, loaded.players, player.id) };
}

export async function syncRoom(code: string, playerId: string, token: string): Promise<PublicRoom> {
  allow("sync:" + playerId, 30);
  const loaded = await withPlayer(code, playerId, token);
  return projectRoom(loaded.room, loaded.players, playerId);
}

async function commit(
  code: string,
  playerId: string,
  token: string,
  mutate: (room: RoomState, players: PlayerState[]) => { room: RoomState; scores: ScoreDelta[] },
): Promise<PublicRoom> {
  allow("act:" + playerId, 24);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const loaded = await withPlayer(code, playerId, token);
    const next = mutate(loaded.room, loaded.players);
    const saved = await saveRoom(loaded.sql, next.room, loaded.room.revision);
    if (!saved) continue;
    await applyScores(loaded.sql, next.scores);
    return project(loaded.sql, loaded.room.code, playerId);
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

export async function leaveRoom(code: string, playerId: string, token: string): Promise<{ left: true }> {
  const loaded = await withPlayer(code, playerId, token);
  const snapshot = loaded.players;
  await loaded.sql.query("delete from forca_players where id = $1 and room_code = $2", [playerId, loaded.room.code]);
  const next = afterLeave(loaded.room, snapshot, playerId);
  if (!next) {
    await loaded.sql.query("delete from forca_rooms where code = $1", [loaded.room.code]);
    return { left: true };
  }
  const saved = await saveRoom(loaded.sql, next, loaded.room.revision);
  if (!saved) {
    const latest = await loadRoom(loaded.sql, loaded.room.code);
    const healed = reconcile(latest, await loadPlayers(loaded.sql, loaded.room.code));
    if (healed !== latest) await saveRoom(loaded.sql, healed, latest.revision);
  }
  return { left: true };
}
