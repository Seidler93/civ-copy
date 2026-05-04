import { FormEvent, useState } from 'react';
import { createCpuGame, createDevSoloGame, createGame, joinGameByCode } from '../firebase/gameService';

interface HomePageProps {
  onGameSelected: (gameId: string) => void;
}

export default function HomePage({ onGameSelected }: HomePageProps) {
  const [name, setName] = useState(localStorage.getItem('playerName') ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const saveName = () => localStorage.setItem('playerName', name.trim() || 'Anonymous Commander');

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      saveName();
      onGameSelected(await createGame(name));
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
      onGameSelected(await createCpuGame(name));
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
        <h1>Sibling Conquest</h1>
        <p>
          Create a small private match, share the code, then take turns grabbing territory and moving armies across
          the grid.
        </p>
      </div>
      <div className="home-actions">
        {error && <div className="notice error">{error}</div>}
        <label>
          Commander name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
        </label>
        <form onSubmit={handleCreate}>
          <button disabled={busy}>{busy ? 'Working...' : 'Create Game'}</button>
        </form>
        <button className="secondary" disabled={busy} onClick={handleCpuGame}>
          Play vs CPU
        </button>
        <form className="join-form" onSubmit={handleJoin}>
          <label>
            Game code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
            />
          </label>
          <button disabled={busy || code.trim().length < 4}>Join Game</button>
        </form>
        {import.meta.env.DEV && (
          <button className="secondary" disabled={busy} onClick={handleDevSolo}>
            Start Dev Solo Game
          </button>
        )}
      </div>
    </section>
  );
}
