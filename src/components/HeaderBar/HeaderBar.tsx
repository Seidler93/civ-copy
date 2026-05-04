import { useEffect, useRef, useState } from 'react';
import { UNIT_TYPES } from '../../data/unitTypes';
import { devAddSupplies } from '../../firebase/gameService';
import type { GameState, UnitTypeId } from '../../types/gameTypes';
import type { MovementSoundMode } from '../../App';
import GameSettings from '../GameSettings/GameSettings';
import MusicPlayer from '../MusicPlayer/MusicPlayer';

type HeaderBarProps = {
  gameState: GameState | null;
  currentPlayerId?: string;
  playerName?: string;
  devPlayerId: string;
  devSpawnUnitType: UnitTypeId | '';
  movementSoundMode: MovementSoundMode;
  unitTileOwnerTintEnabled: boolean;
  unitTileOwnerTintIntensity: number;
  unitOwnerBarEnabled: boolean;
  attackRadiusVisible: boolean;
  qualityTabHidden: boolean;
  musicVolume: number;
  vfxVolume: number;
  onDevPlayerChange: (playerId: string) => void;
  onDevSpawnUnitTypeChange: (unitTypeId: UnitTypeId | '') => void;
  onMovementSoundModeChange: (mode: MovementSoundMode) => void;
  onUnitTileOwnerTintChange: (enabled: boolean) => void;
  onUnitTileOwnerTintIntensityChange: (value: number) => void;
  onUnitOwnerBarChange: (enabled: boolean) => void;
  onAttackRadiusVisibleChange: (visible: boolean) => void;
  onQualityTabHiddenChange: (hidden: boolean) => void;
  onMusicVolumeChange: (value: number) => void;
  onVfxVolumeChange: (value: number) => void;
};

const compositionBuffs = [
  'Combined Arms: Rifleman + Tank + Anti-Vehicle gives +10% attack and defense.',
  'Tank Hunters: Rifleman + Anti-Vehicle gives +25% attack against units with Tanks.',
  'Field Hospital: Rifleman + Medic adds extra passive Medic healing.',
  'Entrenched Infantry: 2+ Riflemen with no Tank gain extra defense in trenches or base aura.',
];

const DEV_SUPPLY_AMOUNT = 100;

export default function HeaderBar({
  gameState,
  currentPlayerId,
  playerName,
  devPlayerId,
  devSpawnUnitType,
  movementSoundMode,
  unitTileOwnerTintEnabled,
  unitTileOwnerTintIntensity,
  unitOwnerBarEnabled,
  attackRadiusVisible,
  qualityTabHidden,
  musicVolume,
  vfxVolume,
  onDevPlayerChange,
  onDevSpawnUnitTypeChange,
  onMovementSoundModeChange,
  onUnitTileOwnerTintChange,
  onUnitTileOwnerTintIntensityChange,
  onUnitOwnerBarChange,
  onAttackRadiusVisibleChange,
  onQualityTabHiddenChange,
  onMusicVolumeChange,
  onVfxVolumeChange,
}: HeaderBarProps) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [devMessage, setDevMessage] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const gameCode = gameState?.game.id ?? null;
  const selectedDevPlayerId = devPlayerId || currentPlayerId || gameState?.players[0]?.id || '';
  const leaderboardPlayers =
    gameState?.players
      .slice()
      .sort((a, b) => {
        if (b.xp !== a.xp) return b.xp - a.xp;
        const aStats = a.stats;
        const bStats = b.stats;
        return (bStats?.enemiesKilled ?? 0) - (aStats?.enemiesKilled ?? 0);
      }) ?? [];

  useEffect(() => {
    if (!isSettingsOpen) return undefined;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && settingsRef.current?.contains(target)) return;
      setIsSettingsOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isSettingsOpen]);

  async function handleDevAddSupplies() {
    if (!gameState || !selectedDevPlayerId) return;
    try {
      setDevMessage(await devAddSupplies(gameState.game.id, selectedDevPlayerId, DEV_SUPPLY_AMOUNT));
    } catch (err) {
      setDevMessage(err instanceof Error ? err.message : 'Could not add dev supplies.');
    }
  }

  function handleDevSpawnChoice(unitTypeId: UnitTypeId | '') {
    onDevSpawnUnitTypeChange(unitTypeId);
    setDevMessage(unitTypeId ? `Click an empty passable square for ${UNIT_TYPES[unitTypeId].name}.` : '');
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header-title">
          <strong>Grid Warfare</strong>
          {gameCode && <span>Game {gameCode}</span>}
        </div>
        <div className="app-header-actions">
          {playerName && <span className="header-player">{playerName}</span>}
          {import.meta.env.DEV && gameState?.game.status === 'active' && (
            <div className="dev-toolbar">
              <button className="secondary" type="button" onClick={() => setIsDevToolsOpen((current) => !current)}>
                Dev Tools
              </button>
              {isDevToolsOpen && (
                <div className="dev-tools-panel">
                  <label>
                    Team
                    <select value={selectedDevPlayerId} onChange={(event) => onDevPlayerChange(event.target.value)}>
                      {gameState.players.map((player) => (
                        <option value={player.id} key={player.id}>
                          {player.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="secondary" type="button" onClick={handleDevAddSupplies}>
                    +{DEV_SUPPLY_AMOUNT} Supplies
                  </button>
                  <label>
                    Spawn squad
                    <select
                      value={devSpawnUnitType}
                      onChange={(event) => handleDevSpawnChoice(event.target.value as UnitTypeId | '')}
                    >
                      <option value="">Choose...</option>
                      {(Object.keys(UNIT_TYPES) as UnitTypeId[]).map((unitTypeId) => (
                        <option value={unitTypeId} key={unitTypeId}>
                          {UNIT_TYPES[unitTypeId].name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {devSpawnUnitType && (
                    <button className="secondary" type="button" onClick={() => handleDevSpawnChoice('')}>
                      Cancel Spawn
                    </button>
                  )}
                  {devMessage && <span className="dev-tools-message">{devMessage}</span>}
                </div>
              )}
            </div>
          )}
          {gameState?.players.length ? (
            <button className="secondary info-button" type="button" onClick={() => setIsLeaderboardOpen(true)}>
              Leaderboard
            </button>
          ) : null}
          <button className="secondary info-button" type="button" onClick={() => setIsInfoOpen(true)}>
            Info
          </button>
          <MusicPlayer volume={musicVolume} />
          <div className="settings-toolbar" ref={settingsRef}>
            <button
              className="secondary settings-icon-button"
              type="button"
              onClick={() => setIsSettingsOpen((current) => !current)}
              aria-label="Open settings"
              title="Settings"
            >
              <img src="/settings.png" alt="" aria-hidden="true" />
            </button>
            {isSettingsOpen && (
              <div className="settings-popover">
                <section className="audio-settings">
                  <p className="eyebrow">Audio</p>
                  <label className="range-setting">
                    Music
                    <span>{Math.round(musicVolume * 100)}%</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={musicVolume}
                      onChange={(event) => onMusicVolumeChange(Number(event.target.value))}
                    />
                  </label>
                  <label className="range-setting">
                    VFX
                    <span>{Math.round(vfxVolume * 100)}%</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={vfxVolume}
                      onChange={(event) => onVfxVolumeChange(Number(event.target.value))}
                    />
                  </label>
                  <label>
                    Movement sound
                    <select
                      value={movementSoundMode}
                      onChange={(event) => onMovementSoundModeChange(event.target.value as MovementSoundMode)}
                    >
                      <option value="move">Once per movement</option>
                      <option value="tile">Once per tile</option>
                    </select>
                  </label>
                  <label className="checkbox-setting">
                    <input
                      type="checkbox"
                      checked={unitTileOwnerTintEnabled}
                      onChange={(event) => onUnitTileOwnerTintChange(event.target.checked)}
                    />
                    Tint occupied tiles
                  </label>
                  <label className="checkbox-setting">
                    <input
                      type="checkbox"
                      checked={unitOwnerBarEnabled}
                      onChange={(event) => onUnitOwnerBarChange(event.target.checked)}
                    />
                    Show owner color bar
                  </label>
                  <label className="checkbox-setting">
                    <input
                      type="checkbox"
                      checked={attackRadiusVisible}
                      onChange={(event) => onAttackRadiusVisibleChange(event.target.checked)}
                    />
                    Show attack radius
                  </label>
                  <label className="checkbox-setting">
                    <input
                      type="checkbox"
                      checked={qualityTabHidden}
                      onChange={(event) => onQualityTabHiddenChange(event.target.checked)}
                    />
                    Hide Quality tab
                  </label>
                  <label className="range-setting">
                    Tint intensity
                    <span>{unitTileOwnerTintIntensity}%</span>
                    <input
                      type="range"
                      min="4"
                      max="100"
                      value={unitTileOwnerTintIntensity}
                      disabled={!unitTileOwnerTintEnabled}
                      onChange={(event) => onUnitTileOwnerTintIntensityChange(Number(event.target.value))}
                    />
                  </label>
                </section>
                {gameState?.game.status === 'active' && currentPlayerId && (
                  <GameSettings game={gameState.game} currentPlayerId={currentPlayerId} onMessage={setSettingsMessage} />
                )}
                {settingsMessage && <p className="settings-message">{settingsMessage}</p>}
              </div>
            )}
          </div>
        </div>
      </header>

      {isLeaderboardOpen && gameState && (
        <div className="modal-backdrop info-backdrop" role="presentation">
          <section className="modal info-modal leaderboard-modal" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Match Stats</p>
                <h2 id="leaderboard-title">Leaderboard</h2>
              </div>
              <button className="icon-button secondary" type="button" onClick={() => setIsLeaderboardOpen(false)}>
                X
              </button>
            </div>
            <div className="leaderboard-summary">
              <span>
                {gameState.game.status === 'finished'
                  ? gameState.game.victoryReason === 'turn-limit'
                    ? 'Final result by total XP'
                    : 'Final result'
                  : 'Live standings by total XP'}
              </span>
              {gameState.game.winnerPlayerId ? (
                <span>
                  Winner: {gameState.players.find((player) => player.id === gameState.game.winnerPlayerId)?.name ?? 'Unknown'}
                </span>
              ) : null}
            </div>
            <div className="leaderboard-table-wrap">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Player</th>
                    <th>Total XP</th>
                    <th>Kills</th>
                    <th>Bases Built</th>
                    <th>Bases Captured</th>
                    <th>Bases Destroyed</th>
                    <th>Units Lost</th>
                    <th>Units Created</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardPlayers.map((player, index) => (
                    <tr key={player.id} className={player.id === gameState.game.winnerPlayerId ? 'leaderboard-winner-row' : ''}>
                      <td>{index + 1}</td>
                      <td>
                        <span className="leaderboard-player-name">
                          <span className="color-dot" style={{ backgroundColor: player.color }} />
                          {player.name}
                          {player.id === currentPlayerId ? ' (You)' : ''}
                        </span>
                      </td>
                      <td>{player.xp}</td>
                      <td>{player.stats?.enemiesKilled ?? 0}</td>
                      <td>{player.stats?.basesBuilt ?? 0}</td>
                      <td>{player.stats?.basesCaptured ?? 0}</td>
                      <td>{player.stats?.basesDestroyed ?? 0}</td>
                      <td>{player.stats?.unitsLost ?? 0}</td>
                      <td>{player.stats?.unitsCreated ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {isInfoOpen && (
        <div className="modal-backdrop info-backdrop" role="presentation">
          <section className="modal info-modal" role="dialog" aria-modal="true" aria-labelledby="info-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Reference</p>
                <h2 id="info-title">Rules and Buffs</h2>
              </div>
              <button className="icon-button secondary" type="button" onClick={() => setIsInfoOpen(false)}>
                X
              </button>
            </div>

            <div className="info-grid">
              <section className="info-section">
                <h3>Controls</h3>
                <ul>
                  <li>Left click selects units, bases, movement targets, and attack targets.</li>
                  <li>Right click one of your units to open its actions.</li>
                  <li>Middle mouse drag pans the map. Mouse wheel zooms toward your cursor.</li>
                </ul>
              </section>

              <section className="info-section">
                <h3>Turns</h3>
                <ul>
                  <li>Units can move up to their movement limit over multiple moves during your turn.</li>
                  <li>Each unit gets one action unless a rule says otherwise.</li>
                  <li>Fortified units cannot move for 2 turns.</li>
                </ul>
              </section>

              <section className="info-section">
                <h3>Map Buffs</h3>
                <ul>
                  <li>Base aura gives nearby friendly units extra defense.</li>
                  <li>Trenches give units bonus attack and defense.</li>
                  <li>Connected trench lines between bases share the highest barracks level and add supplies.</li>
                  <li>An enemy unit on the trench network breaks the connected-base bonus.</li>
                </ul>
              </section>

              <section className="info-section">
                <h3>Actions</h3>
                <ul>
                  <li>Fortify raises defense, lowers damage, and locks movement for 2 turns.</li>
                  <li>Medics passively heal at round end, or can spend an action for a larger heal.</li>
                  <li>Recon squads give their unit +3 movement and reveal fog up to 8 spaces away.</li>
                  <li>Anti-Vehicle squads can place mines that punish Tanks crossing that tile.</li>
                  <li>Artillery squads must stay solo and attack up to 6 spaces away without moving.</li>
                  <li>Logistics squads can build bases and trenches. Logistics squads are consumed when making bases.</li>
                  <li>Ruined bases turn gray and can be reclaimed by a solo Logistics squad for 50 supplies plus half their stored upgrade value.</li>
                </ul>
              </section>

              <section className="info-section wide">
                <h3>Composition Buffs</h3>
                <ul>
                  {compositionBuffs.map((buff) => (
                    <li key={buff}>{buff}</li>
                  ))}
                </ul>
              </section>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
