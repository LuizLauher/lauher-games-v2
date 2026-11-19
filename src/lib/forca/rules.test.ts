import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyScoreDelta,
  afterLeave,
  chooseWord,
  guessLetter,
  useHint,
  maskWord,
  normalize,
  projectRoom,
  rankPlayers,
  startMatch,
  type PlayerState,
  type RoomState,
} from "./rules.ts";

function room(partial: Partial<RoomState> = {}): RoomState {
  return {
    code: "ABCDE",
    hostId: "a",
    phase: "lobby",
    category: "",
    secret: "",
    wrong: [],
    guessed: [],
    eliminatedLetters: [],
    result: null,
    lastGuesserId: null,
    wordChooserId: null,
    currentTurnId: "a",
    revision: 1,
    matchOver: false,
    hintUsed: false,
    notice: null,
    ...partial,
  };
}

function players(ids: string[], extra: Partial<PlayerState> = {}): PlayerState[] {
  return ids.map((id, seat) => ({
    id,
    name: id.toUpperCase(),
    score: 0,
    wins: 0,
    streak: 0,
    connected: true,
    seat,
    ...extra,
  }));
}

describe("forca rules", () => {
  it("ignores accents when comparing letters", () => {
    assert.equal(normalize("Relógio"), "RELOGIO");
    assert.equal(maskWord("RELÓGIO", ["O"], false), "___Ó__O");
  });

  it("requires the host and two players to start", () => {
    assert.throws(() => startMatch(room(), players(["a"]), "a"), /duas pessoas/);
    assert.throws(() => startMatch(room(), players(["a", "b"]), "b"), /anfitrião/);
    const started = startMatch(room(), players(["a", "b"]), "a");
    assert.equal(started.phase, "choosing");
    assert.equal(started.currentTurnId, "a");
  });

  it("keeps the chooser out of the guesses and rotates the next word", () => {
    const choosing = startMatch(room(), players(["a", "b", "c"]), "a");
    const playing = chooseWord(choosing, players(["a", "b", "c"]), "a", "gato", "Animais");
    assert.equal(playing.secret, "GATO");
    assert.equal(playing.currentTurnId, "b");
    assert.throws(() => guessLetter(playing, players(["a", "b", "c"]), "a", "G"), /não joga/);
    assert.throws(() => guessLetter(playing, players(["a", "b", "c"]), "c", "G"), /sua vez/);
    const hit = guessLetter(playing, players(["a", "b", "c"]), "b", "g");
    assert.equal(hit.room.wrong.length, 0);
    assert.equal(hit.room.currentTurnId, "c");
    assert.deepEqual(hit.scores, []);
    assert.throws(() => guessLetter(hit.room, players(["a", "b", "c"]), "c", "g"), /já foi tentada/);
    const miss = guessLetter(hit.room, players(["a", "b", "c"]), "c", "z");
    assert.deepEqual(miss.room.wrong, ["Z"]);
    assert.equal(miss.room.currentTurnId, "b");
    assert.equal(miss.scores[0]?.score, -5);
  });

  it("draws a loss at six mistakes and a win only for the finishing guess", () => {
    let state = chooseWord(
      { ...room({ phase: "choosing" }), currentTurnId: "a" },
      players(["a", "b"]),
      "a",
      "ab",
      "Livre",
    );
    for (const letter of ["C", "D", "E", "F", "G"]) {
      const step = guessLetter(state, players(["a", "b"]), "b", letter);
      state = step.room;
      assert.equal(state.phase, "playing");
    }
    const lost = guessLetter(state, players(["a", "b"]), "b", "H");
    assert.equal(lost.room.phase, "finished");
    assert.equal(lost.room.result, "lost");
    assert.equal(lost.scores[0]?.score, -5);
    assert.equal(lost.room.currentTurnId, "b");

    const again = chooseWord(lost.room, players(["a", "b"]), "b", "sol", "Natureza");
    assert.equal(again.wordChooserId, "b");
    assert.equal(again.currentTurnId, "a");
    const win = guessLetter(again, players(["a", "b"]), "a", "s");
    const done = guessLetter(win.room, players(["a", "b"]), "a", "o");
    const last = guessLetter(done.room, players(["a", "b"]), "a", "l");
    assert.equal(last.room.result, "won");
    assert.equal(last.scores[0]?.wins, 1);
    assert.equal(last.scores[0]?.score, 15);
    assert.equal(last.scores[0]?.streak, 1);
    assert.equal(last.scores[0]?.streakBonus, 0);
  });

  it("adds the current streak to the win award, starting with no first-win bonus", () => {
    const roster = players(["a", "b", "c"]);
    const win = () => guessLetter(
      room({ phase: "playing", secret: "AA", currentTurnId: "b", wordChooserId: "a" }),
      roster,
      "b",
      "A",
    );
    const apply = (scores: ReturnType<typeof guessLetter>["scores"]) => {
      const player = roster.find((item) => item.id === scores[0]?.playerId)!;
      player.score = applyScoreDelta(player.score, scores[0]!.score);
      player.wins += scores[0]!.wins;
      if (scores[0]!.streak !== undefined) player.streak = scores[0]!.streak!;
    };
    let result = win();
    assert.deepEqual(result.scores[0], {
      playerId: "b",
      score: 15,
      wins: 1,
      streak: 1,
      streakBonus: 0,
    });
    apply(result.scores);
    result = win();
    assert.deepEqual(result.scores[0], {
      playerId: "b",
      score: 17,
      wins: 1,
      streak: 2,
      streakBonus: 2,
    });
    apply(result.scores);
    result = win();
    assert.equal(result.scores[0]?.score, 18);
    assert.equal(result.scores[0]?.streak, 3);
    assert.equal(result.scores[0]?.streakBonus, 3);
  });

  it("keeps streaks through ordinary errors and resets only the player who loses all six lives", () => {
    const roster = players(["a", "b"]);
    roster[0] = { ...roster[0]!, streak: 4 };
    roster[1] = { ...roster[1]!, streak: 3 };
    const active = room({
      phase: "playing",
      secret: "AB",
      wrong: [],
      currentTurnId: "b",
      wordChooserId: "a",
    });
    const miss = guessLetter(active, roster, "b", "C");
    assert.equal(miss.scores[0]?.streak, undefined);

    const finalMiss = guessLetter(
      room({
        phase: "playing",
        secret: "AB",
        wrong: ["C", "D", "E", "F", "G"],
        currentTurnId: "b",
        wordChooserId: "a",
      }),
      roster,
      "b",
      "H",
    );
    assert.equal(finalMiss.room.result, "lost");
    assert.equal(finalMiss.scores.length, 1);
    assert.equal(finalMiss.scores[0]?.playerId, "b");
    assert.equal(finalMiss.scores[0]?.streak, 0);
    assert.equal(roster[0]?.streak, 4);
    assert.equal(roster[1]?.streak, 3);
  });

  it("uses the 100-point target to end the match and reset eligibility", () => {
    const word = chooseWord(
      startMatch(room(), players(["a", "b"]), "a"),
      players(["a", "b"]),
      "a",
      "sol",
      "Natureza",
    );
    const scores = players(["a", "b"]);
    scores[1]!.score = 90;
    scores[1]!.streak = 1;
    let state = word;
    for (const letter of ["S", "O"]) {
      state = guessLetter(state, scores, "b", letter).room;
    }
    const won = guessLetter(state, scores, "b", "L");
    assert.equal(won.room.matchOver, true);
    assert.equal(won.room.notice?.kind, "target");
    assert.match(won.room.notice?.message ?? "", /B alcançou 100 pontos/);
    assert.equal(won.scores[0]?.score, 17);
    assert.equal(won.scores[0]?.streak, 2);
  });

  it("applies the hint cost, keeps the turn, and allows one use per turn", () => {
    const roster = players(["a", "b"]);
    roster[1]!.score = 25;
    roster[1]!.streak = 3;
    const playing = chooseWord(
      startMatch(room(), roster, "a"),
      roster,
      "a",
      "gato",
      "Animais",
    );
    const hint = useHint(playing, roster, "b", "reveal", "G");
    assert.deepEqual(hint.room.guessed, ["G"]);
    assert.equal(hint.room.currentTurnId, "b");
    assert.equal(hint.room.hintUsed, true);
    assert.equal(hint.scores[0]?.score, -10);
    assert.equal(hint.scores[0]?.streak, undefined);
    assert.equal(roster[1]?.streak, 3);
    assert.throws(() => useHint(hint.room, roster, "b", "eliminate", "Z"), /já usou/);

    for (const score of [4, 5, 9]) {
      const blocked = [...roster];
      blocked[1] = { ...blocked[1]!, score };
      assert.throws(
        () => useHint(playing, blocked, "b", "reveal", "G"),
        /pelo menos 10 pontos/,
      );
    }

    const exactlyTen = [...roster];
    exactlyTen[1] = { ...exactlyTen[1]!, score: 10, streak: 2 };
    const affordable = useHint(playing, exactlyTen, "b", "reveal", "G");
    assert.equal(affordable.room.currentTurnId, "b");
    assert.equal(affordable.scores[0]?.score, -10);
    assert.equal(affordable.scores[0]?.streak, undefined);
    assert.equal(applyScoreDelta(0, -5), 0);
    assert.equal(applyScoreDelta(0, -10), 0);
    assert.equal(applyScoreDelta(10, -10), 0);
    assert.equal(applyScoreDelta(15, -10), 5);
    assert.equal(applyScoreDelta(20, -10), 10);
    assert.equal(applyScoreDelta(12, -5), 7);
  });

  it("eliminates an incorrect possibility without adding an error or reducing lives", () => {
    const roster = players(["a", "b"]);
    roster[1]!.score = 10;
    roster[1]!.streak = 2;
    const playing = chooseWord(
      startMatch(room(), roster, "a"),
      roster,
      "a",
      "gato",
      "Animais",
    );
    const hint = useHint(playing, roster, "b", "eliminate", "Z");

    assert.deepEqual(hint.room.eliminatedLetters, ["Z"]);
    assert.deepEqual(hint.room.wrong, []);
    assert.equal(hint.room.phase, "playing");
    assert.equal(hint.room.currentTurnId, "b");
    assert.equal(hint.scores[0]?.score, -10);
    assert.equal(hint.scores[0]?.streak, undefined);
    assert.equal(roster[1]?.streak, 2);
    assert.throws(() => guessLetter(hint.room, roster, "b", "Z"), /já foi tentada/);

    const publicRoom = projectRoom(hint.room, roster, "a");
    assert.deepEqual(publicRoom.eliminatedLetters, ["Z"]);
    assert.equal(publicRoom.lives, 6);
  });

  it("checks the 100-point target after the clamped hint cost and word award", () => {
    const roster = players(["a", "b"]);
    const playing = chooseWord(
      startMatch(room(), roster, "a"),
      roster,
      "a",
      "aa",
      "Livre",
    );
    roster[1]!.score = 95;
    roster[1]!.streak = 1;
    const won = useHint(playing, roster, "b", "reveal", "A");
    assert.equal(won.room.matchOver, true);
    assert.equal(won.room.notice?.winnerId, "b");
    assert.deepEqual(won.scores, [
      { playerId: "b", score: -10, wins: 0 },
      { playerId: "b", score: 17, wins: 1, streak: 2, streakBonus: 2 },
    ]);
  });

  it("ends an active match when fewer than two players remain", () => {
    const roster = players(["a", "b"]);
    const playing = chooseWord(
      startMatch(room(), roster, "a"),
      roster,
      "a",
      "gato",
      "Animais",
    );
    const ended = afterLeave(playing, roster, "b");
    assert.equal(ended?.matchOver, true);
    assert.equal(ended?.notice?.message, "A partida encerrou");
    assert.equal(ended?.phase, "finished");
    assert.equal(ended?.secret, "");
  });

  it("transfers the host and never publishes the secret during play", () => {
    const playing = chooseWord(
      startMatch(room(), players(["a", "b", "c"]), "a"),
      players(["a", "b", "c"]),
      "a",
      "qzxwvb",
      "Livre",
    );
    const left = afterLeave(playing, players(["a", "b", "c"]), "a");
    assert.ok(left);
    assert.equal(left?.hostId, "b");
    assert.notEqual(left?.currentTurnId, "a");
    const pub = projectRoom(playing, players(["a", "b", "c"]), "b");
    assert.equal(JSON.stringify(pub).includes("QZXWVB"), false);
    assert.equal(pub.revealed, null);
    assert.match(pub.masked, /^_+$/);
    const finished = { ...playing, phase: "finished" as const, result: "lost" as const };
    assert.equal(projectRoom(finished, players(["a", "b", "c"]), "b").revealed, "QZXWVB");
  });

  it("shares medals on ties and skips the next place", () => {
    const ranked = rankPlayers(
      [
        { id: "a", name: "Ana", score: 40, wins: 1, streak: 0, connected: true, seat: 0 },
        { id: "b", name: "Bia", score: 40, wins: 1, streak: 0, connected: true, seat: 1 },
        { id: "c", name: "Caio", score: 10, wins: 0, streak: 0, connected: true, seat: 2 },
      ],
      "a",
    );
    assert.deepEqual(
      ranked.map((player) => [player.id, player.rank, player.medal]),
      [
        ["a", 1, "gold"],
        ["b", 1, "gold"],
        ["c", 3, "bronze"],
      ],
    );
    const blank = rankPlayers(players(["a", "b"]), "a");
    assert.equal(blank.every((player) => player.medal === null), true);
  });
});
