import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { displayedMistakes, type PublicRoom } from "./rules.ts";

function room(phase: PublicRoom["phase"], wrong: string[]): PublicRoom {
  return {
    code: "ABCDE",
    phase,
    hostId: "host",
    category: "Animais",
    lives: Math.max(0, 6 - wrong.length),
    maxLives: 6,
    wrong,
    guessed: [],
    masked: "___",
    revealed: null,
    result: null,
    currentTurnId: "guest",
    wordChooserId: "host",
    players: [],
    revision: 1,
    youId: "guest",
  };
}

describe("shared hangman drawing", () => {
  it("uses the same wrong-letter count for local and online rounds", () => {
    assert.equal(displayedMistakes("solo", 3, null), 3);
    assert.equal(displayedMistakes("duo", 2, null), 2);
    assert.equal(displayedMistakes("online", 0, room("playing", ["A", "B", "C", "D"])), 4);
    assert.equal(displayedMistakes("online", 0, room("finished", ["A", "B", "C", "D", "E", "F"])), 6);
  });

  it("hides previous-round drawing while waiting in the lobby", () => {
    assert.equal(displayedMistakes("online", 0, room("lobby", ["A", "B"])), 0);
    assert.equal(displayedMistakes("home", 4, room("playing", ["A"])), 4);
  });

  it("feeds the shared canvas from the active mode's mistake count", () => {
    const app = readFileSync(new URL("../../components/forca/game-app.tsx", import.meta.url), "utf8");
    assert.match(app, /<HangmanStage mistakes=\{shownMistakes\} shake=\{shake\} \/>/);
    assert.match(app, /displayedMistakes\(view, local\.wrong\.length, room\)/);
  });
});
