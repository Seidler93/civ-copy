import { onAuthStateChanged, type User } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import { auth } from './firebase/firebaseConfig';
import { ensureAnonymousUser, subscribeToGame } from './firebase/gameService';
import type { GameState, UnitTypeId } from './types/gameTypes';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import GamePage from './pages/GamePage';
import ButtonClickSound from './components/ButtonClickSound/ButtonClickSound';
import HeaderBar from './components/HeaderBar/HeaderBar';

export type MovementSoundMode = 'move' | 'tile';
export type OwnerTileColorMode = 'overlay' | 'solid';
export type UnitStatDisplayMode = 'bar' | 'corners';
export type UnitHealthBarPosition = 'top' | 'bottom';
export type UnitStatLabelMode = 'icons' | 'letters';

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
  const [unitTileOwnerColorMode, setUnitTileOwnerColorMode] = useState<OwnerTileColorMode>(
    () => 'solid',
  );
  const [unitTileOwnerSolidIntensity, setUnitTileOwnerSolidIntensity] = useState(() => {
    const saved = Number(localStorage.getItem('unitTileOwnerSolidIntensity'));
    return Number.isFinite(saved) ? Math.min(100, Math.max(4, saved)) : 72;
  });
  const [unitOwnerBarEnabled, setUnitOwnerBarEnabled] = useState(
    () => localStorage.getItem('unitOwnerBarEnabled') !== 'false',
  );
  const [unitStatDisplayMode, setUnitStatDisplayMode] = useState<UnitStatDisplayMode>(
    () => (localStorage.getItem('unitStatDisplayMode') === 'corners' ? 'corners' : 'bar'),
  );
  const [unitHealthBarPosition, setUnitHealthBarPosition] = useState<UnitHealthBarPosition>(
    () => (localStorage.getItem('unitHealthBarPosition') === 'bottom' ? 'bottom' : 'top'),
  );
  const [unitDefenseValueVisible, setUnitDefenseValueVisible] = useState(
    () => localStorage.getItem('unitDefenseValueVisible') !== 'false',
  );
  const [unitStatLabelMode, setUnitStatLabelMode] = useState<UnitStatLabelMode>(
    () => (localStorage.getItem('unitStatLabelMode') === 'letters' ? 'letters' : 'icons'),
  );
  const [attackRadiusVisible, setAttackRadiusVisible] = useState(
    () => localStorage.getItem('attackRadiusVisible') !== 'false',
  );
  const [qualityTabHidden, setQualityTabHidden] = useState(
    () => localStorage.getItem('qualityTabHidden') === 'true',
  );
  const [musicVolume, setMusicVolume] = useState(() => {
    const saved = Number(localStorage.getItem('musicVolume'));
    return Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0.35;
  });
  const [vfxVolume, setVfxVolume] = useState(() => {
    const saved = Number(localStorage.getItem('vfxVolume'));
    return Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0.75;
  });

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
    localStorage.setItem('unitTileOwnerColorMode', unitTileOwnerColorMode);
  }, [unitTileOwnerColorMode]);

  useEffect(() => {
    localStorage.setItem('unitTileOwnerSolidIntensity', String(unitTileOwnerSolidIntensity));
  }, [unitTileOwnerSolidIntensity]);

  useEffect(() => {
    localStorage.setItem('unitOwnerBarEnabled', String(unitOwnerBarEnabled));
  }, [unitOwnerBarEnabled]);

  useEffect(() => {
    localStorage.setItem('unitStatDisplayMode', unitStatDisplayMode);
  }, [unitStatDisplayMode]);

  useEffect(() => {
    localStorage.setItem('unitHealthBarPosition', unitHealthBarPosition);
  }, [unitHealthBarPosition]);

  useEffect(() => {
    localStorage.setItem('unitDefenseValueVisible', String(unitDefenseValueVisible));
  }, [unitDefenseValueVisible]);

  useEffect(() => {
    localStorage.setItem('unitStatLabelMode', unitStatLabelMode);
  }, [unitStatLabelMode]);

  useEffect(() => {
    localStorage.setItem('attackRadiusVisible', String(attackRadiusVisible));
  }, [attackRadiusVisible]);

  useEffect(() => {
    localStorage.setItem('qualityTabHidden', String(qualityTabHidden));
  }, [qualityTabHidden]);

  useEffect(() => {
    localStorage.setItem('musicVolume', String(musicVolume));
  }, [musicVolume]);

  useEffect(() => {
    localStorage.setItem('vfxVolume', String(vfxVolume));
  }, [vfxVolume]);

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

  function handleLeaveGame() {
    localStorage.removeItem('currentGameId');
    setGameId('');
  }

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
      <ButtonClickSound volume={vfxVolume} />
      <HeaderBar
        gameState={gameState}
        currentPlayerId={currentPlayer?.id}
        playerName={currentPlayer?.name}
        devPlayerId={devPlayerId}
        devSpawnUnitType={devSpawnUnitType}
        movementSoundMode={movementSoundMode}
        unitTileOwnerTintEnabled={unitTileOwnerTintEnabled}
        unitTileOwnerTintIntensity={unitTileOwnerTintIntensity}
        unitTileOwnerColorMode={unitTileOwnerColorMode}
        unitTileOwnerSolidIntensity={unitTileOwnerSolidIntensity}
        unitOwnerBarEnabled={unitOwnerBarEnabled}
        unitStatDisplayMode={unitStatDisplayMode}
        unitHealthBarPosition={unitHealthBarPosition}
        unitDefenseValueVisible={unitDefenseValueVisible}
        unitStatLabelMode={unitStatLabelMode}
        attackRadiusVisible={attackRadiusVisible}
        qualityTabHidden={qualityTabHidden}
        musicVolume={musicVolume}
        vfxVolume={vfxVolume}
        onDevPlayerChange={setDevPlayerId}
        onDevSpawnUnitTypeChange={setDevSpawnUnitType}
        onMovementSoundModeChange={setMovementSoundMode}
        onUnitTileOwnerTintChange={setUnitTileOwnerTintEnabled}
        onUnitTileOwnerTintIntensityChange={setUnitTileOwnerTintIntensity}
        onUnitTileOwnerColorModeChange={setUnitTileOwnerColorMode}
        onUnitTileOwnerSolidIntensityChange={setUnitTileOwnerSolidIntensity}
        onUnitOwnerBarChange={setUnitOwnerBarEnabled}
        onUnitStatDisplayModeChange={setUnitStatDisplayMode}
        onUnitHealthBarPositionChange={setUnitHealthBarPosition}
        onUnitDefenseValueVisibleChange={setUnitDefenseValueVisible}
        onUnitStatLabelModeChange={setUnitStatLabelMode}
        onAttackRadiusVisibleChange={setAttackRadiusVisible}
        onQualityTabHiddenChange={setQualityTabHidden}
        onMusicVolumeChange={setMusicVolume}
        onVfxVolumeChange={setVfxVolume}
        onBackOutToMenu={handleLeaveGame}
      />
      {error && <div className="notice error">{error}</div>}
      <div className="app-content">
        {!gameId && <HomePage onGameSelected={setGameId} />}
        {gameId && gameState?.game.status === 'lobby' && (
          <LobbyPage gameState={gameState} currentPlayerId={user.uid} onLeave={handleLeaveGame} />
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
            unitTileOwnerColorMode={unitTileOwnerColorMode}
            unitTileOwnerSolidIntensity={unitTileOwnerSolidIntensity}
            unitOwnerBarEnabled={unitOwnerBarEnabled}
            unitStatDisplayMode={unitStatDisplayMode}
            unitHealthBarPosition={unitHealthBarPosition}
            unitDefenseValueVisible={unitDefenseValueVisible}
            unitStatLabelMode={unitStatLabelMode}
            attackRadiusVisible={attackRadiusVisible}
            qualityTabHidden={qualityTabHidden}
            onDevSpawnUnitTypeChange={setDevSpawnUnitType}
          />
        )}
      </div>
    </main>
  );
}
