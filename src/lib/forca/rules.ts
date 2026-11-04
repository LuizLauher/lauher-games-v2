export const MAX_LIVES = 6;
export const MAX_PLAYERS = 8;

export type Phase = "lobby" | "choosing" | "playing" | "finished";
export type RoundResult = "won" | "lost" | null;
export type Medal = "gold" | "silver" | "bronze" | null;

export type RoomState = {
  code: string;
  hostId: string;
  phase: Phase;
  category: string;
  secret: string;
  wrong: string[];
  guessed: string[];
  result: RoundResult;
  lastGuesserId: string | null;
  wordChooserId: string | null;
  currentTurnId: string | null;
  revision: number;
};

export type PlayerState = {
  id: string;
  name: string;
  score: number;
  wins: number;
  connected: boolean;
  seat: number;
};

export type ScoreDelta = { playerId: string; score: number; wins: number };

export type PublicPlayer = {
  id: string;
  name: string;
  score: number;
  wins: number;
  connected: boolean;
  host: boolean;
  rank: number;
  medal: Medal;
  seat: number;
};

export type PublicRoom = {
  code: string;
  phase: Phase;
  hostId: string;
  category: string;
  lives: number;
  maxLives: number;
  wrong: string[];
  guessed: string[];
  masked: string;
  revealed: string | null;
  result: RoundResult;
  currentTurnId: string | null;
  wordChooserId: string | null;
  players: PublicPlayer[];
  revision: number;
  youId: string;
};

export function displayedMistakes(
  view: "home" | "solo" | "duo" | "online",
  localWrongCount: number,
  room: PublicRoom | null,
): number {
  if (view !== "online") return localWrongCount;
  if (room?.phase === "playing" || room?.phase === "finished") return room.wrong.length;
  return 0;
}

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

export function normalize(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function cleanName(value: string): string {
  return String(value ?? "")
    .replace(/[<>\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 18);
}

export function cleanWord(value: string): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[^A-Za-zÀ-ÿ -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30)
    .toLocaleUpperCase("pt-BR");
}

export function cleanCategory(value: string): string {
  const cleaned = cleanName(value);
  return cleaned || "Personalizada";
}

export function isValidWord(value: string): boolean {
  return normalize(value).replace(/[^A-Z]/g, "").length >= 2;
}

export function normalizeGuess(value: string): string | null {
  const letter = normalize(value || "").replace(/[^A-Z]/g, "");
  return letter.length === 1 ? letter : null;
}

export function allLettersFound(word: string, guessed: readonly string[]): boolean {
  const set = new Set(guessed);
  return [...normalize(word)].every((ch) => !/[A-Z]/.test(ch) || set.has(ch));
}

export function maskWord(word: string, guessed: readonly string[], reveal: boolean): string {
  const set = new Set(guessed);
  return [...(word || "")]
    .map((ch) => {
      if (ch === " " || ch === "-") return ch;
      if (reveal || set.has(normalize(ch))) return ch;
      return "_";
    })
    .join("");
}

export function livesLeft(wrong: readonly string[]): number {
  return Math.max(0, MAX_LIVES - wrong.length);
}

export function connectedPlayers(players: readonly PlayerState[]): PlayerState[] {
  return players.filter((player) => player.connected);
}

export function nextPlayer(players: readonly PlayerState[], afterId: string | null): string | null {
  const list = connectedPlayers(players);
  if (!list.length) return null;
  const index = list.findIndex((player) => player.id === afterId);
  return list[(index + 1 + list.length) % list.length]!.id;
}

export function nextGuesser(
  players: readonly PlayerState[],
  afterId: string | null,
  chooserId: string | null,
): string | null {
  const list = connectedPlayers(players).filter((player) => player.id !== chooserId);
  if (!list.length) return null;
  const index = list.findIndex((player) => player.id === afterId);
  return list[(index + 1 + list.length) % list.length]!.id;
}

function bump(room: RoomState): RoomState {
  return { ...room, wrong: [...room.wrong], guessed: [...room.guessed], revision: room.revision + 1 };
}

export function reconcile(room: RoomState, players: readonly PlayerState[]): RoomState {
  const online = connectedPlayers(players);
  if (!online.length) return room;
  const next = bump(room);
  let changed = false;
  if (!online.some((player) => player.id === room.hostId)) {
    next.hostId = online[0]!.id;
    changed = true;
  }
  const turnOnline = online.some((player) => player.id === room.currentTurnId);
  if (!room.currentTurnId || !turnOnline) {
    const id =
      room.phase === "playing"
        ? nextGuesser(players, room.currentTurnId, room.wordChooserId)
        : nextPlayer(players, room.currentTurnId);
    if (id && id !== room.currentTurnId) {
      next.currentTurnId = id;
      changed = true;
    }
  }
  if (room.phase === "playing" && next.currentTurnId === room.wordChooserId) {
    const id = nextGuesser(players, room.wordChooserId, room.wordChooserId);
    if (id && id !== next.currentTurnId) {
      next.currentTurnId = id;
      changed = true;
    }
  }
  return changed ? next : room;
}

export function startMatch(room: RoomState, players: readonly PlayerState[], actorId: string): RoomState {
  if (actorId !== room.hostId) throw new RuleError("Só o anfitrião pode iniciar a partida.");
  if (room.phase !== "lobby") throw new RuleError("A partida já foi iniciada.");
  const online = connectedPlayers(players);
  if (online.length < 2) throw new RuleError("É preciso pelo menos duas pessoas na sala.");
  const next = bump(room);
  next.phase = "choosing";
  if (!online.some((player) => player.id === next.currentTurnId)) next.currentTurnId = online[0]!.id;
  return next;
}

export function chooseWord(
  room: RoomState,
  players: readonly PlayerState[],
  actorId: string,
  rawWord: string,
  rawCategory: string,
): RoomState {
  if (room.phase === "playing") throw new RuleError("A rodada ainda está em andamento.");
  if (room.phase === "lobby") throw new RuleError("O anfitrião ainda precisa iniciar a partida.");
  if (room.phase !== "choosing" && room.phase !== "finished") {
    throw new RuleError("Não é possível escolher a palavra agora.");
  }
  if (actorId !== room.currentTurnId) throw new RuleError("Ainda não é sua vez de escolher a palavra.");
  if (connectedPlayers(players).length < 2) throw new RuleError("É preciso pelo menos duas pessoas na sala.");
  const word = cleanWord(rawWord);
  if (!isValidWord(word)) throw new RuleError("A palavra precisa ter pelo menos duas letras.");
  const guesser = nextGuesser(players, actorId, actorId);
  if (!guesser) throw new RuleError("Não há outro participante para tentar adivinhar.");
  const next = bump(room);
  next.secret = word;
  next.category = cleanCategory(rawCategory);
  next.wordChooserId = actorId;
  next.phase = "playing";
  next.wrong = [];
  next.guessed = [];
  next.result = null;
  next.lastGuesserId = null;
  next.currentTurnId = guesser;
  return next;
}

export function guessLetter(
  room: RoomState,
  players: readonly PlayerState[],
  actorId: string,
  rawLetter: string,
): { room: RoomState; scores: ScoreDelta[] } {
  if (room.phase !== "playing") throw new RuleError("Não há uma rodada em andamento.");
  if (!actorId || actorId === room.wordChooserId) {
    throw new RuleError("Quem escolheu a palavra não joga nesta rodada.");
  }
  if (room.currentTurnId !== actorId) throw new RuleError("Ainda não é a sua vez.");
  const letter = normalizeGuess(rawLetter);
  if (!letter) throw new RuleError("Envie apenas uma letra de A a Z.");
  if (room.guessed.includes(letter) || room.wrong.includes(letter)) {
    throw new RuleError("Essa letra já foi tentada.");
  }
  const next = bump(room);
  next.lastGuesserId = actorId;
  const scores: ScoreDelta[] = [];
  if (normalize(room.secret).includes(letter)) {
    next.guessed = [...room.guessed, letter];
    if (allLettersFound(next.secret, next.guessed)) {
      const bonus = 25 + livesLeft(next.wrong) * 5;
      scores.push({ playerId: actorId, score: 10 + bonus, wins: 1 });
      next.phase = "finished";
      next.result = "won";
      next.currentTurnId = nextPlayer(players, room.wordChooserId);
    } else {
      scores.push({ playerId: actorId, score: 10, wins: 0 });
      next.currentTurnId = nextGuesser(players, actorId, room.wordChooserId);
    }
  } else {
    next.wrong = [...room.wrong, letter];
    if (next.wrong.length >= MAX_LIVES) {
      next.phase = "finished";
      next.result = "lost";
      next.currentTurnId = nextPlayer(players, room.wordChooserId);
    } else {
      next.currentTurnId = nextGuesser(players, actorId, room.wordChooserId);
    }
  }
  return { room: next, scores };
}

export function afterLeave(room: RoomState, players: readonly PlayerState[], leaverId: string): RoomState | null {
  const remaining = players.filter((player) => player.id !== leaverId);
  if (!remaining.some((player) => player.connected) && remaining.length === 0) return null;
  if (!remaining.length) return null;
  const next = bump(room);
  if (next.hostId === leaverId) {
    next.hostId = (connectedPlayers(remaining)[0] ?? remaining[0]!).id;
  }
  if (next.phase === "playing") {
    const guessers = connectedPlayers(remaining).filter((player) => player.id !== next.wordChooserId);
    if (!guessers.length) {
      next.phase = "finished";
      next.result = "lost";
      next.currentTurnId = nextPlayer(remaining, next.wordChooserId) ?? remaining[0]!.id;
      return next;
    }
    if (next.currentTurnId === leaverId || !guessers.some((player) => player.id === next.currentTurnId)) {
      next.currentTurnId = nextGuesser(remaining, leaverId, next.wordChooserId) ?? guessers[0]!.id;
    }
    return next;
  }
  if (next.currentTurnId === leaverId || !remaining.some((player) => player.id === next.currentTurnId && player.connected)) {
    next.currentTurnId = nextPlayer(remaining, leaverId) ?? remaining[0]!.id;
  }
  return next;
}

export function rankPlayers(players: readonly PlayerState[], hostId: string): PublicPlayer[] {
  const anyPoints = players.some((player) => player.score > 0 || player.wins > 0);
  const sorted = [...players].sort((a, b) => {
    if (anyPoints) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.wins !== a.wins) return b.wins - a.wins;
    }
    return a.seat - b.seat;
  });
  return sorted.map((player, index) => {
    const first = sorted.findIndex((item) => item.score === player.score && item.wins === player.wins);
    const rank = anyPoints ? first + 1 : index + 1;
    const medal: Medal = !anyPoints ? null : rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null;
    return {
      id: player.id,
      name: player.name,
      score: player.score,
      wins: player.wins,
      connected: player.connected,
      host: player.id === hostId,
      rank,
      medal,
      seat: player.seat,
    };
  });
}

export function projectRoom(room: RoomState, players: readonly PlayerState[], youId: string): PublicRoom {
  const showRound = room.phase === "playing" || room.phase === "finished";
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    category: showRound ? room.category : "",
    lives: livesLeft(room.wrong),
    maxLives: MAX_LIVES,
    wrong: [...room.wrong],
    guessed: [...room.guessed],
    masked: showRound ? maskWord(room.secret, room.guessed, room.phase === "finished") : "",
    revealed: room.phase === "finished" ? room.secret : null,
    result: room.result,
    currentTurnId: room.currentTurnId,
    wordChooserId: showRound ? room.wordChooserId : room.phase === "choosing" ? room.currentTurnId : null,
    players: rankPlayers(players, room.hostId),
    revision: room.revision,
    youId,
  };
}
