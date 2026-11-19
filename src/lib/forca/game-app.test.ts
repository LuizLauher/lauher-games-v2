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
    eliminatedLetters: [],
    masked: "___",
    revealed: null,
    result: null,
    currentTurnId: "guest",
    wordChooserId: "host",
    players: [],
    revision: 1,
    youId: "guest",
    matchOver: false,
    hintUsed: false,
    notice: null,
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

  it("blocks the hint power below 10 points and never bypasses it in the handler", () => {
    const app = readFileSync(new URL("../../components/forca/game-app.tsx", import.meta.url), "utf8");
    assert.match(app, /const canUseHint = canGuess && yourScore >= 10 && !room\?\.hintUsed/);
    assert.match(app, /disabled=\{!canUseHint \|\| busy\}/);
    assert.match(app, /myScore < 10/);
  });

  it("shows scoring rules in the multiplayer sidebar and names the control Dica", () => {
    const app = readFileSync(new URL("../../components/forca/game-app.tsx", import.meta.url), "utf8");
    assert.match(app, /<details className="scoring-info" data-testid="scoring-info">/);
    assert.match(app, /<summary className="btn ghost">Regras de pontuação<\/summary>/);
    assert.match(app, /Vitórias seguidas: <strong>da segunda em diante, \+15 pontos e bônus igual à sequência<\/strong>/);
    assert.match(app, /<h2>Dica<\/h2>/);
    assert.doesNotMatch(app, /<h2>Poder Dica<\/h2>/);
    assert.doesNotMatch(app, /Palavra descoberta: \+15.*letra errada: -5/);
  });

  it("renders a per-player streak badge and syncs streak feedback from room updates", () => {
    const app = readFileSync(new URL("../../components/forca/game-app.tsx", import.meta.url), "utf8");
    assert.match(app, /player\.streak >= 2/);
    assert.match(app, /className="streak-badge"/);
    assert.match(app, /SEQUÊNCIA x\$\{player\.streak\}! \+\$\{player\.streak\} PONTOS EXTRAS/);
    assert.match(app, /SEQUÊNCIA PERDIDA!/);
  });
});
