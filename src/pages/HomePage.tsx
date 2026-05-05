import { FormEvent, useMemo, useState } from 'react';
import { createCpuGame, createDevSoloGame, createGame, joinGameByCode } from '../firebase/gameService';
import type { GameMode } from '../types/gameTypes';

interface HomePageProps {
  onGameSelected: (gameId: string) => void;
}

type MenuAction = 'play' | 'host' | 'join';

const ROUND_LIMIT_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50];
const ROUND_DURATION_OPTIONS = [30, 45, 60, 90, 120];
export default function HomePage({ onGameSelected }: HomePageProps) {
  const [name, setName] = useState(localStorage.getItem('playerName') ?? '');
  const [code, setCode] = useState('');
  const [hostCode, setHostCode] = useState('');
  const [menuAction, setMenuAction] = useState<MenuAction | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>('turn-based');
  const [roundDurationSeconds, setRoundDurationSeconds] = useState(60);
  const [turnLimitEnabled, setTurnLimitEnabled] = useState(false);
  const [turnLimitRounds, setTurnLimitRounds] = useState(20);
  const [allowMixedUnitCombines, setAllowMixedUnitCombines] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const saveName = () => localStorage.setItem('playerName', name.trim() || 'Anonymous Commander');
  const setup = {
    mode: gameMode,
    roundDurationSeconds: gameMode === 'timed-simultaneous' ? roundDurationSeconds : null,
    turnLimitRounds: turnLimitEnabled ? turnLimitRounds : null,
    allowMixedUnitCombines,
  } as const;

  const setupHeading = useMemo(() => {
    if (menuAction === 'play') return 'Solo Setup';
    if (menuAction === 'host') return 'Host Match';
    if (menuAction === 'join') return 'Join Match';
    return '';
  }, [menuAction]);

  const setupDescription = useMemo(() => {
    if (menuAction === 'play') return 'Start an instant CPU match and tune the rules before the fighting begins.';
    if (menuAction === 'host') return 'Create a private lobby, choose the rule set, and share the code with your group.';
    if (menuAction === 'join') return 'Enter your commander name and lobby code to jump straight into an existing match.';
    return '';
  }, [menuAction]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      saveName();
      onGameSelected(await createGame(name, setup, hostCode));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create game.');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      saveName();
      onGameSelected(await joinGameByCode(code, name));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join game.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDevSolo() {
    setBusy(true);
    setError('');
    try {
      saveName();
      onGameSelected(await createDevSoloGame());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create solo test game.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCpuGame() {
    setBusy(true);
    setError('');
    try {
      saveName();
      onGameSelected(await createCpuGame(name, setup));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create CPU game.');
    } finally {
      setBusy(false);
    }
  }

  function cleanGameCode(value: string) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function renderSetupScreen() {
    if (!menuAction) return null;

    return (
      <div className="home-setup-shell">
        <button type="button" className="secondary home-back-button" onClick={() => setMenuAction(null)} disabled={busy}>
          Back
        </button>
        <div className="home-actions home-setup-panel">
          {error && <div className="notice error">{error}</div>}
          <div className="home-setup-header">
          <div>
            <p className="eyebrow">Game Setup</p>
            <h2>{setupHeading}</h2>
            <p>{setupDescription}</p>
          </div>
        </div>

        {menuAction !== 'join' && (
          <section className="home-setup-section">
            <div className="home-section-copy">
              <h3>Battle Format</h3>
              <p>Choose whether the match is a classic turn exchange or a faster simultaneous-pressure round system.</p>
            </div>
            <div className="home-mode-grid home-mode-grid-wide">
              <button
                type="button"
                className={gameMode === 'turn-based' ? 'mode-active' : 'secondary'}
                onClick={() => setGameMode('turn-based')}
              >
                Turn Based
                <span>One commander acts at a time. Best for slower planning and cleaner front lines.</span>
              </button>
              <button
                type="button"
                className={gameMode === 'timed-simultaneous' ? 'mode-active' : 'secondary'}
                onClick={() => setGameMode('timed-simultaneous')}
              >
                Timed Simultaneous
                <span>Everyone moves together. The round rolls over automatically when the timer expires.</span>
              </button>
            </div>
          </section>
        )}

        {menuAction !== 'join' && gameMode === 'timed-simultaneous' && (
          <section className="home-setup-section">
            <div className="home-section-copy">
              <h3>Round Timer</h3>
              <p>Set the pace for each chaotic round. Short timers feel frantic, longer timers leave room for coordination.</p>
            </div>
            <label>
              Round duration
              <select value={roundDurationSeconds} onChange={(event) => setRoundDurationSeconds(Number(event.target.value))}>
                {ROUND_DURATION_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} seconds
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}

        {menuAction !== 'join' && (
          <section className="home-setup-section">
            <div className="home-section-copy">
              <h3>Victory Rule</h3>
              <p>Leave it open-ended for pure elimination, or cap the match and award the win to the highest total XP.</p>
            </div>
            <label className="rule-toggle-setting">
              <span className="rule-toggle-copy">
                <strong>End after a set number of rounds</strong>
                <em>When enabled, the highest total XP wins once the selected round cap is reached.</em>
              </span>
              <span className="slide-toggle">
                <input
                  type="checkbox"
                  checked={turnLimitEnabled}
                  onChange={(event) => setTurnLimitEnabled(event.target.checked)}
                />
                <span className="slide-toggle-track" aria-hidden="true" />
              </span>
            </label>
            <label className={!turnLimitEnabled ? 'disabled-setting' : undefined}>
              Round limit
              <select
                value={turnLimitRounds}
                onChange={(event) => setTurnLimitRounds(Number(event.target.value))}
                disabled={!turnLimitEnabled}
              >
                {ROUND_LIMIT_OPTIONS.map((rounds) => (
                  <option key={rounds} value={rounds}>
                    {rounds} rounds
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}

        {menuAction !== 'join' && (
          <section className="home-setup-section">
            <div className="home-section-copy">
              <h3>Unit Combining</h3>
              <p>Keep units as same-type stacks only, or allow mixed squads to merge while still forcing solo-only squads to remain alone.</p>
            </div>
            <label className="rule-toggle-setting">
              <span className="rule-toggle-copy">
                <strong>Allow different squad types to combine</strong>
                <em>Mixed units use the shorter shared attack range. Solo-only squads still cannot join other units.</em>
              </span>
              <span className="slide-toggle">
                <input
                  type="checkbox"
                  checked={allowMixedUnitCombines}
                  onChange={(event) => setAllowMixedUnitCombines(event.target.checked)}
                />
                <span className="slide-toggle-track" aria-hidden="true" />
              </span>
            </label>
          </section>
        )}

        {menuAction === 'play' && (
          <div className="join-form home-setup-form">
            <section className="home-setup-section">
              <div className="home-section-copy">
                <h3>Commander</h3>
                <p>Name your commander before launching a solo game against the CPU.</p>
              </div>
              <label>
                Commander name
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
              </label>
            </section>
            <button type="button" disabled={busy} onClick={handleCpuGame}>
              {busy ? 'Working...' : 'Start Solo Match'}
            </button>
          </div>
        )}

        {menuAction === 'host' && (
          <form className="join-form home-setup-form" onSubmit={handleCreate}>
            <section className="home-setup-section">
              <div className="home-section-copy">
                <h3>Commander</h3>
                <p>Your name will appear in the lobby while everyone joins using the match code.</p>
              </div>
              <label>
                Commander name
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
              </label>
            </section>
            <section className="home-setup-section">
              <div className="home-section-copy">
                <h3>Match Code</h3>
                <p>Make your own code for siblings to join, or leave it blank and I will generate one.</p>
              </div>
              <label>
                Game code
                <input
                  value={hostCode}
                  onChange={(event) => setHostCode(cleanGameCode(event.target.value))}
                  placeholder="FAMILY"
                  maxLength={12}
                />
              </label>
            </section>
            <button disabled={busy || (hostCode.trim().length > 0 && hostCode.trim().length < 4)}>
              {busy ? 'Working...' : 'Create Lobby'}
            </button>
          </form>
        )}

        {menuAction === 'join' && (
          <form className="join-form home-setup-form" onSubmit={handleJoin}>
            <section className="home-setup-section">
              <div className="home-section-copy">
                <h3>Commander</h3>
                <p>Pick the name that will show up to the other players in the lobby and on the battlefield.</p>
              </div>
              <label>
                Commander name
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
              </label>
            </section>
            <section className="home-setup-section">
              <div className="home-section-copy">
                <h3>Match Code</h3>
                <p>Enter the code shared by the host to connect to their lobby.</p>
              </div>
              <label>
                Game code
                <input
                  value={code}
                  onChange={(event) => setCode(cleanGameCode(event.target.value))}
                  placeholder="FAMILY"
                  maxLength={12}
                />
              </label>
            </section>
            <button disabled={busy || code.trim().length < 4}>{busy ? 'Working...' : 'Join Match'}</button>
          </form>
        )}

        {import.meta.env.DEV && (
          <button className="secondary" disabled={busy} onClick={handleDevSolo}>
            Start Dev Solo Game
          </button>
        )}
        </div>
      </div>
    );
  }

  return (
    <section className={`home-page home-page-background${menuAction ? ' setup-active' : ''}`}>
      {!menuAction && (
        <div className="home-copy">
          <h1>Grid Warfare</h1>
          <p>
            Create a private match, share the code, then battle for territory across the grid. Classic games support up
            to 4 players, and a larger war map opens up automatically when a 5th player joins.
          </p>
          <section className="home-guide" aria-label="How to play">
            <h2>How to Play</h2>
            <div className="home-guide-grid">
              <article className="home-guide-card">
                <h3>Win the map</h3>
                <p>Take enemy bases, protect your own, and keep expanding until the other commanders are wiped out.</p>
              </article>
              <article className="home-guide-card">
                <h3>Use each turn well</h3>
                <p>Move armies, attack nearby enemies, manage bases, then end your turn so supplies and pressure keep flowing.</p>
              </article>
              <article className="home-guide-card">
                <h3>Build and upgrade</h3>
                <p>Spend supplies at bases to recruit squads, improve defenses, unlock stronger options, and set up artillery.</p>
              </article>
              <article className="home-guide-card">
                <h3>Level up</h3>
                <p>Combat and progress earn XP. When you level, spend skill points to improve mobility, logistics, and combat power.</p>
              </article>
            </div>
          </section>
        </div>
      )}

      {!menuAction ? (
        <div className="home-main-menu-shell">
          {error && <div className="notice error">{error}</div>}
          <div className="home-main-menu-buttons">
            <button
              type="button"
              className="home-main-button secondary"
              onClick={() => setMenuAction('play')}
            >
              <strong>Play Solo</strong>
            </button>
            <button
              type="button"
              className="home-main-button secondary"
              onClick={() => setMenuAction('host')}
            >
              <strong>Host</strong>
            </button>
            <button
              type="button"
              className="home-main-button secondary"
              onClick={() => setMenuAction('join')}
            >
              <strong>Join</strong>
            </button>
          </div>
          {import.meta.env.DEV && (
            <button
              className="secondary home-dev-solo-button"
              disabled={busy}
              onClick={handleDevSolo}
            >
              Start Dev Solo Game
            </button>
          )}
        </div>
      ) : (
        renderSetupScreen()
      )}
    </section>
  );
}
