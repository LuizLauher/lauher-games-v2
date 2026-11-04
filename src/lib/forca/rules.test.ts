import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  afterLeave,
  chooseWord,
  guessLetter,
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
    result: null,
    lastGuesserId: null,
    wordChooserId: null,
    currentTurnId: "a",
    revision: 1,
    ...partial,
  };
}

function players(ids: string[], extra: Partial<PlayerState> = {}): PlayerState[] {
  return ids.map((id, seat) => ({
    id,
    name: id.toUpperCase(),
    score: 0,
    wins: 0,
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
    assert.equal(hit.scores[0]?.score, 10);
    const miss = guessLetter(hit.room, players(["a", "b", "c"]), "c", "z");
    assert.deepEqual(miss.room.wrong, ["Z"]);
    assert.equal(miss.room.currentTurnId, "b");
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
    assert.equal(lost.scores.length, 0);
    assert.equal(lost.room.currentTurnId, "b");

    const again = chooseWord(lost.room, players(["a", "b"]), "b", "sol", "Natureza");
    assert.equal(again.wordChooserId, "b");
    assert.equal(again.currentTurnId, "a");
    const win = guessLetter(again, players(["a", "b"]), "a", "s");
    const done = guessLetter(win.room, players(["a", "b"]), "a", "o");
    const last = guessLetter(done.room, players(["a", "b"]), "a", "l");
    assert.equal(last.room.result, "won");
    assert.equal(last.scores[0]?.wins, 1);
    assert.ok((last.scores[0]?.score ?? 0) > 10);
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
        { id: "a", name: "Ana", score: 40, wins: 1, connected: true, seat: 0 },
        { id: "b", name: "Bia", score: 40, wins: 1, connected: true, seat: 1 },
        { id: "c", name: "Caio", score: 10, wins: 0, connected: true, seat: 2 },
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
