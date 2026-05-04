import { onAuthStateChanged, type User } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import { auth } from './firebase/firebaseConfig';
import { ensureAnonymousUser, subscribeToGame } from './firebase/gameService';
import type { GameState, UnitTypeId } from './types/gameTypes';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import GamePage from './pages/GamePage';
import ButtonClickSound from './components/ButtonClickSound/ButtonClickSound';
import MusicPlayer from './components/MusicPlayer/MusicPlayer';
import HeaderBar from './components/HeaderBar/HeaderBar';

export type MovementSoundMode = 'move' | 'tile';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [gameId, setGameId] = useState(() => localStorage.getItem('currentGameId') ?? '');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState('');
  const [devPlayerId, setDevPlayerId] = useState('');
  const [devSpawnUnitType, setDevSpawnUnitType] = useState<UnitTypeId | ''>('');
  const [movementSoundMode, setMovementSoundMode] = useState<MovementSoundMode>(
    () => (localStorage.getItem('movementSoundMode') === 'tile' ? 'tile' : 'move'),
  );
  const [unitTileOwnerTintEnabled, setUnitTileOwnerTintEnabled] = useState(
    () => localStorage.getItem('unitTileOwnerTintEnabled') !== 'false',
  );
  const [unitTileOwnerTintIntensity, setUnitTileOwnerTintIntensity] = useState(() => {
    const saved = Number(localStorage.getItem('unitTileOwnerTintIntensity'));
    return Number.isFinite(saved) ? Math.min(100, Math.max(4, saved)) : 60;
  });
  const [unitOwnerBarEnabled, setUnitOwnerBarEnabled] = useState(
    () => localStorage.getItem('unitOwnerBarEnabled') !== 'false',
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    ensureAnonymousUser().catch((err: Error) => setError(err.message));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!gameId) {
      setGameState(null);
      return undefined;
    }
    localStorage.setItem('currentGameId', gameId);
    return subscribeToGame(gameId, setGameState, (err) => setError(err.message));
  }, [gameId]);

  useEffect(() => {
    localStorage.setItem('movementSoundMode', movementSoundMode);
  }, [movementSoundMode]);

  useEffect(() => {
    localStorage.setItem('unitTileOwnerTintEnabled', String(unitTileOwnerTintEnabled));
  }, [unitTileOwnerTintEnabled]);

  useEffect(() => {
    localStorage.setItem('unitTileOwnerTintIntensity', String(unitTileOwnerTintIntensity));
  }, [unitTileOwnerTintIntensity]);

  useEffect(() => {
    localStorage.setItem('unitOwnerBarEnabled', String(unitOwnerBarEnabled));
  }, [unitOwnerBarEnabled]);

  const currentPlayer = useMemo(() => {
    if (!gameState) return null;
    if (import.meta.env.DEV && gameState.game.code === 'SOLO') {
      return (
        gameState.players.find((player) => player.id === gameState.game.currentTurnPlayerId) ??
        gameState.players.find((player) => !player.isEliminated) ??
        gameState.players[0] ??
        null
      );
    }
    return gameState.players.find((player) => player.id === user?.uid) ?? null;
  }, [gameState, user?.uid]);

  if (!user) {
    return (
      <main className="app-shell">
        {error ? (
          <div className="panel auth-panel">
            <h1>Firebase sign-in needs attention</h1>
            <div className="notice error">{error}</div>
            <p>
              In the Firebase console, make sure Authentication is enabled and the Anonymous sign-in provider is turned
              on for this project.
            </p>
          </div>
        ) : (
          'Signing you in anonymously...'
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <ButtonClickSound />
      <MusicPlayer />
      <HeaderBar
        gameState={gameState}
        currentPlayerId={currentPlayer?.id}
        playerName={currentPlayer?.name}
        devPlayerId={devPlayerId}
        devSpawnUnitType={devSpawnUnitType}
        movementSoundMode={movementSoundMode}
        unitTileOwnerTintEnabled={unitTileOwnerTintEnabled}
        unitTileOwnerTintIntensity={unitTileOwnerTintIntensity}
        unitOwnerBarEnabled={unitOwnerBarEnabled}
        onDevPlayerChange={setDevPlayerId}
        onDevSpawnUnitTypeChange={setDevSpawnUnitType}
        onMovementSoundModeChange={setMovementSoundMode}
        onUnitTileOwnerTintChange={setUnitTileOwnerTintEnabled}
        onUnitTileOwnerTintIntensityChange={setUnitTileOwnerTintIntensity}
        onUnitOwnerBarChange={setUnitOwnerBarEnabled}
      />
      {error && <div className="notice error">{error}</div>}
      <div className="app-content">
        {!gameId && <HomePage onGameSelected={setGameId} />}
        {gameId && gameState?.game.status === 'lobby' && (
          <LobbyPage gameState={gameState} currentPlayerId={user.uid} onLeave={() => setGameId('')} />
        )}
        {gameId && (gameState?.game.status === 'active' || gameState?.game.status === 'finished') && currentPlayer && (
          <GamePage
            gameState={gameState}
            currentPlayer={currentPlayer}
            devPlayerId={devPlayerId}
            devSpawnUnitType={devSpawnUnitType}
            movementSoundMode={movementSoundMode}
            unitTileOwnerTintEnabled={unitTileOwnerTintEnabled}
            unitTileOwnerTintIntensity={unitTileOwnerTintIntensity}
            unitOwnerBarEnabled={unitOwnerBarEnabled}
            onDevSpawnUnitTypeChange={setDevSpawnUnitType}
          />
        )}
      </div>
    </main>
  );
}
