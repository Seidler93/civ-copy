import { FormEvent, useState } from 'react';
import { createCpuGame, createDevSoloGame, createGame, joinGameByCode } from '../firebase/gameService';
import type { GameMode } from '../types/gameTypes';

interface HomePageProps {
  onGameSelected: (gameId: string) => void;
}

type MenuAction = 'solo' | 'host' | 'join';

export default function HomePage({ onGameSelected }: HomePageProps) {
  const [name, setName] = useState(localStorage.getItem('playerName') ?? '');
  const [code, setCode] = useState('');
  const [menuAction, setMenuAction] = useState<MenuAction>('solo');
  const [gameMode, setGameMode] = useState<GameMode>('turn-based');
  const [roundDurationSeconds, setRoundDurationSeconds] = useState(60);
  const [turnLimitEnabled, setTurnLimitEnabled] = useState(false);
  const [turnLimitRounds, setTurnLimitRounds] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const saveName = () => localStorage.setItem('playerName', name.trim() || 'Anonymous Commander');
  const setup = {
    mode: gameMode,
    roundDurationSeconds: gameMode === 'timed-simultaneous' ? roundDurationSeconds : null,
    turnLimitRounds: turnLimitEnabled ? turnLimitRounds : null,
  } as const;

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      saveName();
      onGameSelected(await createGame(name, setup));
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

  return (
    <section className="home-page">
      <div className="home-copy">
        <p className="eyebrow">Browser strategy night</p>
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
      <div className="home-actions">
        {error && <div className="notice error">{error}</div>}
        <div className="home-action-selector">
          <button
            type="button"
            className={menuAction === 'solo' ? 'mode-active' : 'secondary'}
            onClick={() => setMenuAction('solo')}
          >
            Play Solo
          </button>
          <button
            type="button"
            className={menuAction === 'host' ? 'mode-active' : 'secondary'}
            onClick={() => setMenuAction('host')}
          >
            Host
          </button>
          <button
            type="button"
            className={menuAction === 'join' ? 'mode-active' : 'secondary'}
            onClick={() => setMenuAction('join')}
          >
            Join
          </button>
        </div>

        {(menuAction === 'solo' || menuAction === 'host') && (
          <div className="home-mode-picker">
            <p className="eyebrow">Match style</p>
            <div className="home-mode-grid">
              <button
                type="button"
                className={gameMode === 'turn-based' ? 'mode-active' : 'secondary'}
                onClick={() => setGameMode('turn-based')}
              >
                Turn Based
              </button>
              <button
                type="button"
                className={gameMode === 'timed-simultaneous' ? 'mode-active' : 'secondary'}
                onClick={() => setGameMode('timed-simultaneous')}
              >
                Timed Simultaneous
              </button>
            </div>
            <p className="muted">
              {gameMode === 'turn-based'
                ? 'Classic alternating turns.'
                : 'Everyone acts at once. When the timer ends, the next round begins automatically.'}
            </p>
            {gameMode === 'timed-simultaneous' && (
              <label>
                Round duration
                <select
                  value={roundDurationSeconds}
                  onChange={(event) => setRoundDurationSeconds(Number(event.target.value))}
                >
                  <option value={30}>30 seconds</option>
                  <option value={45}>45 seconds</option>
                  <option value={60}>60 seconds</option>
                  <option value={90}>90 seconds</option>
                  <option value={120}>120 seconds</option>
                </select>
              </label>
            )}
            <label className="checkbox-setting">
              <input
                type="checkbox"
                checked={turnLimitEnabled}
                onChange={(event) => setTurnLimitEnabled(event.target.checked)}
              />
              End after a set number of rounds and crown the highest-XP player
            </label>
            {turnLimitEnabled && (
              <label>
                Round limit
                <select value={turnLimitRounds} onChange={(event) => setTurnLimitRounds(Number(event.target.value))}>
                  <option value={5}>5 rounds</option>
                  <option value={10}>10 rounds</option>
                  <option value={15}>15 rounds</option>
                  <option value={20}>20 rounds</option>
                  <option value={25}>25 rounds</option>
                  <option value={30}>30 rounds</option>
                  <option value={40}>40 rounds</option>
                  <option value={50}>50 rounds</option>
                </select>
              </label>
            )}
          </div>
        )}

        {menuAction === 'solo' && (
          <div className="join-form">
            <label>
              Commander name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
            </label>
            <button type="button" disabled={busy} onClick={handleCpuGame}>
              {busy ? 'Working...' : 'Play Solo'}
            </button>
          </div>
        )}

        {menuAction === 'host' && (
          <form className="join-form" onSubmit={handleCreate}>
            <label>
              Commander name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
            </label>
            <button disabled={busy}>{busy ? 'Working...' : 'Host Game'}</button>
          </form>
        )}

        {menuAction === 'join' && (
          <form className="join-form" onSubmit={handleJoin}>
            <label>
              Commander name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
            </label>
            <label>
              Game code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
              />
            </label>
            <button disabled={busy || code.trim().length < 4}>{busy ? 'Working...' : 'Join Game'}</button>
          </form>
        )}

        {import.meta.env.DEV && (
          <button className="secondary" disabled={busy} onClick={handleDevSolo}>
            Start Dev Solo Game
          </button>
        )}
      </div>
    </section>
  );
}
