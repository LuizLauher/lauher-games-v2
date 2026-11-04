import { useEffect, useRef, useState } from "react";
import { Copy, Crown, House, Medal, Music, RotateCcw, User, Users, Volume2, VolumeX, Wifi } from "lucide-react";
import { beginMatchFn, createRoomFn, joinRoomFn, leaveRoomFn, resumeRoomFn, submitGuessFn, submitWordFn, syncRoomFn } from "@/lib/forca/api";
import {
  audioPrefs,
  playHit,
  playJoin,
  playLeave,
  playLose,
  playMiss,
  playStart,
  playWin,
  setMusicEnabled,
  setSfxEnabled,
  subscribeAudio,
  unlockAudio,
} from "@/lib/forca/audio";
import { CATEGORIES, pickWord } from "@/lib/forca/bank";
import { allLettersFound, cleanWord, displayedMistakes, isValidWord, normalize, normalizeGuess, type PublicRoom } from "@/lib/forca/rules";
import { HangmanStage } from "./hangman-stage";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const STATS_KEY = "lauher-forca-stats-v1";
const SESSION_KEY = "lauher-forca-session-v1";
const ONLINE_CATEGORIES = ["Personalizada", "Animais", "Tecnologia", "Comidas", "Natureza", "Brasil", "Conhecimentos gerais"];

type View = "home" | "solo" | "duo" | "online";
type Stats = { wins: number; losses: number; streak: number };
type Session = { code: string; playerId: string; token: string };
type LocalMatch = {
  secret: string;
  category: string;
  guessed: string[];
  wrong: string[];
  running: boolean;
};
type Toast = { id: number; text: string };

function readStats(): Stats {
  try {
    const saved = JSON.parse(localStorage.getItem(STATS_KEY) || "{}") as Partial<Stats>;
    return {
      wins: Number.isInteger(saved.wins) && (saved.wins ?? 0) >= 0 ? saved.wins! : 0,
      losses: Number.isInteger(saved.losses) && (saved.losses ?? 0) >= 0 ? saved.losses! : 0,
      streak: Number.isInteger(saved.streak) && (saved.streak ?? 0) >= 0 ? saved.streak! : 0,
    };
  } catch {
    return { wins: 0, losses: 0, streak: 0 };
  }
}

function readSession(): Session | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as Session | null;
    if (!saved?.code || !saved.playerId || !saved.token) return null;
    return saved;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null) {
  try {
    if (!session) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore quota */
  }
}

function playerName(room: PublicRoom, id: string | null) {
  return room.players.find((player) => player.id === id)?.name ?? "Alguém";
}

export function GameApp() {
  const [view, setView] = useState<View>("home");
  const [stats, setStats] = useState<Stats>({ wins: 0, losses: 0, streak: 0 });
  const [category, setCategory] = useState("Todas");
  const [local, setLocal] = useState<LocalMatch>({ secret: "", category: "", guessed: [], wrong: [], running: false });
  const [duoWord, setDuoWord] = useState("");
  const [status, setStatus] = useState("Escolha como quer jogar.");
  const [tone, setTone] = useState<"" | "good" | "bad">("");
  const [shake, setShake] = useState(false);
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [busy, setBusy] = useState(false);
  const [secretDraft, setSecretDraft] = useState("");
  const [onlineCategory, setOnlineCategory] = useState("Personalizada");
  const [audio, setAudio] = useState({ music: true, sfx: true });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const roomRef = useRef<PublicRoom | null>(null);
  const toastId = useRef(0);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    setStats(readStats());
    setAudio(audioPrefs());
    return subscribeAudio(setAudio);
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  function toast(text: string) {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-2), { id, text }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  }

  function note(message: string, next: "" | "good" | "bad" = "") {
    setStatus(message);
    setTone(next);
  }

  function bumpShake() {
    setShake(false);
    requestAnimationFrame(() => setShake(true));
  }

  function saveStats(next: Stats) {
    setStats(next);
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  }

  function reactToRoom(previous: PublicRoom | null, next: PublicRoom) {
    if (!previous || previous.code !== next.code) return;
    const previousIds = new Set(previous.players.map((player) => player.id));
    const nextIds = new Set(next.players.map((player) => player.id));
    for (const player of next.players) {
      if (!previousIds.has(player.id) && player.id !== next.youId) {
        toast(`${player.name} entrou na sala.`);
        playJoin();
      }
    }
    for (const player of previous.players) {
      if (!nextIds.has(player.id)) {
        toast(`${player.name} saiu da sala.`);
        playLeave();
      }
    }
    if (next.phase === "playing" && previous.phase !== "playing") playStart();
    if (next.phase === "finished" && previous.phase !== "finished") {
      if (next.result === "won") playWin();
      else playLose();
    } else if (next.wrong.length > previous.wrong.length) {
      playMiss();
      bumpShake();
    } else if (next.guessed.length > previous.guessed.length) playHit();
  }

  function applyRoom(next: PublicRoom) {
    const previous = roomRef.current;
    if (previous && previous.code === next.code && next.revision < previous.revision) return;
    roomRef.current = next;
    setRoom(next);
    reactToRoom(previous, next);
  }

  useEffect(() => {
    let cancel = false;
    const saved = readSession();
    const inviteParams = new URLSearchParams(window.location.search);
    const invited = (inviteParams.get("sala") || inviteParams.get("room") || "").toUpperCase();
    if (invited) setJoinCode(invited.replace(/[^A-Z0-9]/g, "").slice(0, 5));
    if (!saved) {
      if (invited) setView("online");
      return;
    }
    setView("online");
    setSession(saved);
    void resumeRoomFn({ data: { code: saved.code, token: saved.token } }).then((result) => {
      if (cancel) return;
      if (!result.ok) {
        writeSession(null);
        setSession(null);
        note(result.error, "bad");
        return;
      }
      const next = { code: result.state.code, playerId: result.playerId, token: result.token };
      writeSession(next);
      setSession(next);
      applyRoom(result.state);
      note("Você voltou para a sala.", "good");
    });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!session || view !== "online") return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      const current = sessionRef.current;
      if (!current || stopped) return;
      const result = await syncRoomFn({ data: current });
      if (stopped) return;
      if (!result.ok) {
        if (result.error.includes("Sala não encontrada") || result.error.includes("Sessão")) {
          writeSession(null);
          setSession(null);
          setRoom(null);
          roomRef.current = null;
          note(result.error, "bad");
        }
        return;
      }
      applyRoom(result.state);
    };
    const beat = () => {
      const delay = document.hidden ? 4000 : 1000;
      timer = window.setTimeout(async () => {
        await poll();
        if (!stopped) beat();
      }, delay);
    };
    void poll();
    beat();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // Poll is keyed by the session identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.code, session?.playerId, session?.token, view]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const letter = normalizeGuess(event.key);
      if (!letter) return;
      if (view === "online") void sendOnlineGuess(letter);
      else if (view === "solo" || view === "duo") guessLocal(letter);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function startSolo() {
    unlockAudio();
    const picked = pickWord(category, local.secret);
    setLocal({ secret: picked.word, category: picked.cat, guessed: [], wrong: [], running: true });
    setView("solo");
    note(`Categoria ${picked.cat}. Boa sorte.`);
  }

  function startDuo() {
    unlockAudio();
    const word = cleanWord(duoWord);
    if (!isValidWord(word) || normalize(word).replace(/[^A-Z]/g, "").length > 24) {
      note("Digite uma palavra de 2 a 24 letras. Espaços são permitidos.", "bad");
      return;
    }
    setDuoWord("");
    setLocal({ secret: word, category: "Palavra secreta", guessed: [], wrong: [], running: true });
    setView("duo");
    note("A palavra foi guardada neste aparelho. Quem adivinha já pode jogar.");
  }

  function guessLocal(letter: string) {
    if (!local.running || local.guessed.includes(letter) || local.wrong.includes(letter)) return;
    const guessed = [...local.guessed, letter];
    const hit = normalize(local.secret).includes(letter);
    const wrong = hit ? local.wrong : [...local.wrong, letter];
    const won = allLettersFound(local.secret, guessed);
    const lost = wrong.length >= 6;
    setLocal({ ...local, guessed, wrong, running: !(won || lost) });
    if (hit) playHit();
    else {
      playMiss();
      bumpShake();
    }
    if (won) {
      playWin();
      const next = { wins: stats.wins + 1, losses: stats.losses, streak: stats.streak + 1 };
      saveStats(next);
      note(`Você venceu. A palavra era ${local.secret}.`, "good");
    } else if (lost) {
      playLose();
      saveStats({ wins: stats.wins, losses: stats.losses + 1, streak: 0 });
      note(`Fim de jogo. A palavra era ${local.secret}.`, "bad");
    } else note(hit ? "Letra certa." : `Letra errada. Restam ${6 - wrong.length}.`, hit ? "good" : "");
  }

  function remember(next: Session) {
    writeSession(next);
    setSession(next);
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    url.searchParams.set("sala", next.code);
    window.history.replaceState(null, "", url);
  }

  async function createOnline() {
    unlockAudio();
    setBusy(true);
    const result = await createRoomFn({ data: { name: nickname } });
    setBusy(false);
    if (!result.ok) return note(result.error, "bad");
    remember({ code: result.state.code, playerId: result.playerId, token: result.token });
    applyRoom(result.state);
    setView("online");
    note("Sala criada. Envie o código para quem vai jogar.", "good");
  }

  async function joinOnline() {
    unlockAudio();
    setBusy(true);
    const result = await joinRoomFn({ data: { name: nickname, code: joinCode } });
    setBusy(false);
    if (!result.ok) return note(result.error, "bad");
    remember({ code: result.state.code, playerId: result.playerId, token: result.token });
    applyRoom(result.state);
    setView("online");
    note("Você entrou na sala.", "good");
  }

  async function startOnline() {
    if (!session) return;
    setBusy(true);
    const result = await beginMatchFn({ data: session });
    setBusy(false);
    if (!result.ok) return note(result.error, "bad");
    applyRoom(result.state);
    note("Partida iniciada. Quem está indicado escolhe a palavra.", "good");
  }

  async function chooseOnline() {
    if (!session) return;
    setBusy(true);
    const result = await submitWordFn({
      data: { ...session, word: secretDraft, category: onlineCategory },
    });
    setBusy(false);
    if (!result.ok) return note(result.error, "bad");
    setSecretDraft("");
    applyRoom(result.state);
    note("Palavra escolhida. Você fica de fora dos palpites desta rodada.", "good");
  }

  async function sendOnlineGuess(letter: string) {
    if (!session || !roomRef.current) return;
    const current = roomRef.current;
    if (current.phase !== "playing" || current.wordChooserId === current.youId || current.currentTurnId !== current.youId) return;
    if (current.guessed.includes(letter) || current.wrong.includes(letter)) return;
    const result = await submitGuessFn({ data: { ...session, letter } });
    if (!result.ok) return note(result.error, "bad");
    applyRoom(result.state);
  }

  async function leaveOnline() {
    const current = sessionRef.current;
    if (current) void leaveRoomFn({ data: current });
    writeSession(null);
    setSession(null);
    setRoom(null);
    roomRef.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("sala");
    window.history.replaceState(null, "", url);
    setView("home");
    note("Você saiu da sala.");
  }

  async function copyCode() {
    if (!room) return;
    const url = new URL(window.location.href);
    url.searchParams.set("sala", room.code);
    const text = `Lauher Games · sala ${room.code}\n${url.toString()}`;
    try {
      await navigator.clipboard.writeText(text);
      note("Convite copiado.", "good");
    } catch {
      note(`Código da sala: ${room.code}.`, "");
    }
  }

  const shownMistakes = displayedMistakes(view, local.wrong.length, room);
  const shownWord = view === "online" ? room?.masked ?? "" : local.running || local.secret ? maskedLocal() : "";
  const shownCategory = view === "online" ? room?.category || "Sala online" : local.category || "Pronto para jogar";
  const shownWrong = view === "online" ? room?.wrong ?? [] : local.wrong;
  const shownGuessed = view === "online" ? room?.guessed ?? [] : local.guessed;
  const secretForKeys = view === "online" ? "" : local.secret;

  function maskedLocal() {
    return [...local.secret]
      .map((ch) => (ch === " " || ch === "-" || !local.running || local.guessed.includes(normalize(ch)) ? ch : "_"))
      .join("");
  }

  const you = room?.youId ?? "";
  const connectedCount = room?.players.filter((player) => player.connected).length ?? 0;
  const isHost = !!room && room.hostId === you;
  const choosing = !!room && (room.phase === "choosing" || room.phase === "finished") && room.currentTurnId === you;
  const canGuess = !!room && room.phase === "playing" && room.wordChooserId !== you && room.currentTurnId === you;
  const anyMedal = !!room?.players.some((player) => player.medal);

  let onlineStatus = status;
  if (room && view === "online") {
    if (room.phase === "lobby") {
      onlineStatus = isHost
        ? connectedCount < 2
          ? "Compartilhe o código. A partida começa com duas pessoas."
          : "Todo mundo está na sala. Você pode iniciar."
        : `Aguardando ${playerName(room, room.hostId)} iniciar a partida.`;
    } else if (room.phase === "choosing" || (room.phase === "finished" && choosing)) {
      onlineStatus = choosing
        ? "Escolha a palavra. Você não participa dos palpites desta rodada."
        : `${playerName(room, room.currentTurnId)} está escolhendo a palavra.`;
    } else if (room.phase === "playing") {
      onlineStatus =
        room.wordChooserId === you
          ? `Você escolheu a palavra. ${playerName(room, room.currentTurnId)} tenta adivinhar. Restam ${room.lives}.`
          : canGuess
            ? `Sua vez. ${playerName(room, room.wordChooserId)} ficou de fora desta rodada. Restam ${room.lives}.`
            : `Vez de ${playerName(room, room.currentTurnId)}. Restam ${room.lives}.`;
    } else if (room.phase === "finished") {
      onlineStatus =
        room.result === "won"
          ? `A palavra ${room.revealed} foi descoberta.`
          : `A forca fechou. A palavra era ${room.revealed}.`;
    }
  }

  const bannerTone = view === "online" && room?.phase === "finished" ? (room.result === "won" ? "good" : "bad") : tone;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="mark" aria-hidden="true">L</div>
        <div className="brand">
          <p className="eyebrow">Lauher Games</p>
          <h1>Jogo da Forca</h1>
        </div>
        <div className="top-actions">
          <button className="icon-btn" type="button" aria-pressed={audio.sfx} aria-label={audio.sfx ? "Desligar efeitos" : "Ligar efeitos"} onClick={() => setSfxEnabled(!audio.sfx)}>
            {audio.sfx ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button className="icon-btn" type="button" aria-pressed={audio.music} aria-label={audio.music ? "Desligar música" : "Ligar música"} onClick={() => setMusicEnabled(!audio.music)}>
            <Music size={18} />
          </button>
          {view !== "home" && (
            <button className="icon-btn" type="button" aria-label="Voltar ao início" onClick={() => (view === "online" && session ? void leaveOnline() : setView("home"))}>
              <House size={18} />
            </button>
          )}
        </div>
      </header>

      {view === "home" && (
        <section>
          <div className="home-copy">
            <h2>Uma palavra, seis erros, o boneco de sempre.</h2>
            <p>Jogue sozinho, passe o aparelho para outra pessoa ou abra uma sala. Quem escolhe a palavra fica de fora dos palpites daquela rodada.</p>
          </div>
          <div className="modes">
            <button className="mode-card" type="button" onClick={startSolo}>
              <User size={18} />
              <strong>Sozinho</strong>
              <span>Uma palavra sorteada da categoria que você escolher.</span>
            </button>
            <button className="mode-card" type="button" onClick={() => { setLocal({ secret: "", category: "", guessed: [], wrong: [], running: false }); setDuoWord(""); setView("duo"); note("A outra pessoa digita a palavra sem mostrar."); }}>
              <Users size={18} />
              <strong>No mesmo aparelho</strong>
              <span>Alguém escreve a palavra secreta e o outro tenta descobrir.</span>
            </button>
            <button className="mode-card" type="button" data-testid="open-online" onClick={() => { setView("online"); note("Crie uma sala ou entre com o código."); }}>
              <Wifi size={18} />
              <strong>Sala online</strong>
              <span>Código de cinco letras, turnos e placar conferidos pelo servidor.</span>
            </button>
          </div>
        </section>
      )}

      {view !== "home" && (
        <div className="layout">
          <section className="panel">
            <div className="panel-head">
              <h2>{view === "online" ? "Sala" : view === "duo" ? "Dois no aparelho" : "Partida solo"}</h2>
              <span className="tag">{shownCategory}</span>
            </div>
            <HangmanStage mistakes={shownMistakes} shake={shake} />
            <div className="word" data-testid="word" aria-label="Palavra secreta">
              {shownWord
                ? [...shownWord].map((ch, index) => (
                    <span key={`${ch}-${index}`} className={ch === " " ? "slot space" : ch === "_" ? "slot" : "slot revealed"}>
                      {ch === "_" || ch === " " ? "" : ch}
                    </span>
                  ))
                : <span className="helper">A palavra aparece aqui.</span>}
            </div>
            <p className="meta-line">
              Letras erradas: {shownWrong.length ? <b>{shownWrong.join(" ")}</b> : "nenhuma"}
            </p>
            <div className="panel-head">
              <span className="helper">Erros {shownMistakes}/6</span>
              <span className="pips" aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <i key={index} className={index < shownMistakes ? "pip spent" : "pip"} />
                ))}
              </span>
            </div>
            <div className={`banner ${bannerTone}`} role="status">{view === "online" ? onlineStatus : status}</div>
            <div className="keyboard" aria-label="Teclado">
              {ALPHABET.map((letter) => {
                const correct = view === "online"
                  ? shownGuessed.includes(letter)
                  : shownGuessed.includes(letter) && normalize(secretForKeys).includes(letter);
                const wrong = shownWrong.includes(letter);
                const disabled = view === "online"
                  ? !canGuess || correct || wrong || busy
                  : !local.running || shownGuessed.includes(letter) || wrong;
                return (
                  <button
                    key={letter}
                    type="button"
                    className={correct ? "key correct" : wrong ? "key wrong" : "key"}
                    data-letter={letter}
                    disabled={disabled}
                    onClick={() => (view === "online" ? void sendOnlineGuess(letter) : guessLocal(letter))}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="panel stack">
            {view !== "online" && (
              <>
                <div className="stats" aria-label="Placar neste aparelho">
                  <div className="stat"><span>Vitórias</span><strong>{stats.wins}</strong></div>
                  <div className="stat"><span>Derrotas</span><strong>{stats.losses}</strong></div>
                  <div className="stat"><span>Sequência</span><strong>{stats.streak}</strong></div>
                </div>
                {view === "solo" && (
                  <label className="field">
                    <span>Categoria</span>
                    <select value={category} onChange={(event) => setCategory(event.target.value)}>
                      {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                )}
                {view === "duo" && !local.running && (
                  <label className="field">
                    <span>Palavra secreta</span>
                    <input value={duoWord} type="password" maxLength={30} autoComplete="off" placeholder="Só quem dita a palavra vê" onChange={(event) => setDuoWord(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") startDuo(); }} />
                  </label>
                )}
                <div className="row">
                  {view === "solo" ? (
                    <button className="btn primary" type="button" data-testid="solo-start" onClick={startSolo}>
                      <RotateCcw size={16} /> Nova palavra
                    </button>
                  ) : (
                    <button className="btn primary" type="button" onClick={startDuo} disabled={local.running && !duoWord}>
                      {local.running ? "Rodada em jogo" : "Começar"}
                    </button>
                  )}
                  <button className="btn ghost" type="button" onClick={() => { saveStats({ wins: 0, losses: 0, streak: 0 }); note("Placar deste aparelho zerado."); }}>
                    Zerar placar
                  </button>
                </div>
                {view === "duo" && local.running && (
                  <button className="btn" type="button" onClick={() => setLocal({ ...local, running: false, secret: "", guessed: [], wrong: [] })}>
                    Nova palavra secreta
                  </button>
                )}
                <p className="helper">Acentos não importam: se a palavra tem Ó, a letra O revela. O boneco ganha uma parte a cada erro.</p>
              </>
            )}

            {view === "online" && !session && (
              <>
                <label className="field">
                  <span>Seu apelido</span>
                  <input value={nickname} maxLength={18} autoComplete="nickname" placeholder="Como vão te chamar" onChange={(event) => setNickname(event.target.value)} />
                </label>
                <button className="btn primary" type="button" data-testid="create-room" disabled={busy} onClick={() => void createOnline()}>
                  Criar sala
                </button>
                <label className="field">
                  <span>Código da sala</span>
                  <input
                    value={joinCode}
                    maxLength={5}
                    data-testid="join-code"
                    placeholder="ABCDE"
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
                  />
                </label>
                <button className="btn" type="button" data-testid="join-room" disabled={busy} onClick={() => void joinOnline()}>
                  Entrar na sala
                </button>
              </>
            )}

            {view === "online" && session && room && (
              <>
                <div>
                  <p className="helper">Código da sala</p>
                  <p className="room-code" data-testid="room-code">{room.code}</p>
                </div>
                <div className="row">
                  <button className="btn" type="button" onClick={() => void copyCode()}><Copy size={16} /> Copiar convite</button>
                  <button className="btn ghost" type="button" onClick={() => void leaveOnline()}>Sair da sala</button>
                </div>
                {room.phase === "lobby" && isHost && (
                  <button className="btn primary" type="button" data-testid="start-match" disabled={busy || connectedCount < 2} onClick={() => void startOnline()}>
                    Iniciar partida
                  </button>
                )}
                {choosing && (
                  <>
                    <label className="field">
                      <span>Sua palavra secreta</span>
                      <input value={secretDraft} maxLength={30} data-testid="secret-word" autoComplete="off" placeholder="As outras pessoas não veem" onChange={(event) => setSecretDraft(event.target.value)} />
                    </label>
                    <label className="field">
                      <span>Categoria</span>
                      <select value={onlineCategory} onChange={(event) => setOnlineCategory(event.target.value)}>
                        {ONLINE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <button className="btn primary" type="button" data-testid="submit-word" disabled={busy} onClick={() => void chooseOnline()}>
                      {room.phase === "finished" ? "Começar próxima rodada" : "Escolher palavra"}
                    </button>
                  </>
                )}
                <div>
                  <h2>Classificação</h2>
                  {anyMedal && room.players.filter((player) => player.medal === "gold").length > 1 && (
                    <p className="helper">Empate no primeiro lugar: a coroa fica com os dois.</p>
                  )}
                  <ol className="scoreboard">
                    {room.players.map((player) => (
                      <li key={player.id} className={player.id === you ? "score-row you" : player.connected ? "score-row" : "score-row off"}>
                        <span className={player.medal ? `medal ${player.medal}` : "medal"} aria-hidden="true">
                          {player.medal === "gold" ? <Crown size={18} /> : player.medal ? <Medal size={18} /> : <span className="place">{player.rank}º</span>}
                        </span>
                        <span className="who">
                          <b>{player.name}{player.id === you ? " · você" : ""}{player.host ? " · anfitrião" : ""}</b>
                          <small>{player.connected ? "na sala" : "reconectando"} · {player.wins} vitória{player.wins === 1 ? "" : "s"}</small>
                        </span>
                        <strong>{player.score}</strong>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((item) => <div key={item.id} className="toast">{item.text}</div>)}
      </div>
      <p className="footer">Lauher Games · a palavra fica no servidor até o fim da rodada</p>
    </main>
  );
}
