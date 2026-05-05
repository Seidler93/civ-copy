import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { UNIT_TYPES } from '../../data/unitTypes';
import { devAddSupplies } from '../../firebase/gameService';
import type { GameState, UnitTypeId } from '../../types/gameTypes';
import { xpForNextLevel } from '../../utils/xp';
import type { MovementSoundMode, OwnerTileColorMode, UnitHealthBarPosition, UnitStatDisplayMode, UnitStatLabelMode } from '../../App';
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
  unitTileOwnerColorMode: OwnerTileColorMode;
  unitTileOwnerSolidIntensity: number;
  unitOwnerBarEnabled: boolean;
  unitStatDisplayMode: UnitStatDisplayMode;
  unitHealthBarPosition: UnitHealthBarPosition;
  unitDefenseValueVisible: boolean;
  unitStatLabelMode: UnitStatLabelMode;
  attackRadiusVisible: boolean;
  qualityTabHidden: boolean;
  musicVolume: number;
  vfxVolume: number;
  onDevPlayerChange: (playerId: string) => void;
  onDevSpawnUnitTypeChange: (unitTypeId: UnitTypeId | '') => void;
  onMovementSoundModeChange: (mode: MovementSoundMode) => void;
  onUnitTileOwnerTintChange: (enabled: boolean) => void;
  onUnitTileOwnerTintIntensityChange: (value: number) => void;
  onUnitTileOwnerColorModeChange: (mode: OwnerTileColorMode) => void;
  onUnitTileOwnerSolidIntensityChange: (value: number) => void;
  onUnitOwnerBarChange: (enabled: boolean) => void;
  onUnitStatDisplayModeChange: (mode: UnitStatDisplayMode) => void;
  onUnitHealthBarPositionChange: (position: UnitHealthBarPosition) => void;
  onUnitDefenseValueVisibleChange: (visible: boolean) => void;
  onUnitStatLabelModeChange: (mode: UnitStatLabelMode) => void;
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
  unitTileOwnerColorMode,
  unitTileOwnerSolidIntensity,
  unitOwnerBarEnabled,
  unitStatDisplayMode,
  unitHealthBarPosition,
  unitDefenseValueVisible,
  unitStatLabelMode,
  attackRadiusVisible,
  qualityTabHidden,
  musicVolume,
  vfxVolume,
  onDevPlayerChange,
  onDevSpawnUnitTypeChange,
  onMovementSoundModeChange,
  onUnitTileOwnerTintChange,
  onUnitTileOwnerTintIntensityChange,
  onUnitTileOwnerColorModeChange,
  onUnitTileOwnerSolidIntensityChange,
  onUnitOwnerBarChange,
  onUnitStatDisplayModeChange,
  onUnitHealthBarPositionChange,
  onUnitDefenseValueVisibleChange,
  onUnitStatLabelModeChange,
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
        const aTotalXp = totalCommanderXp(a.level, a.xp);
        const bTotalXp = totalCommanderXp(b.level, b.xp);
        if (bTotalXp !== aTotalXp) return bTotalXp - aTotalXp;
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

  function dispatchMusicCommand(command: 'toggle' | 'skip') {
    window.dispatchEvent(new Event(command === 'toggle' ? 'grid-warfare:toggle-music' : 'grid-warfare:skip-music'));
  }

  function totalCommanderXp(level: number, currentLevelXp: number) {
    let total = currentLevelXp;
    for (let previousLevel = 1; previousLevel < level; previousLevel += 1) {
      total += xpForNextLevel(previousLevel);
    }
    return total;
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
          <MusicPlayer volume={musicVolume} autoPlay={!gameState} />
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
                <div className="settings-modal-heading">
                  <div>
                    <p className="eyebrow">Settings</p>
                    <h2>Game Preferences</h2>
                    <p>Tune audio, map readability, interface complexity, and match controls for this device.</p>
                  </div>
                  <button className="icon-button secondary" type="button" onClick={() => setIsSettingsOpen(false)} aria-label="Close settings">
                    X
                  </button>
                </div>

                <div className="settings-modal-grid">
                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <p className="eyebrow">Audio</p>
                      <h3>Sound Mix</h3>
                      <p>These sliders are saved locally in this browser, so every player can set their own comfort level.</p>
                    </div>
                    <div className="settings-music-controls">
                      <button className="secondary" type="button" onClick={() => dispatchMusicCommand('toggle')}>
                        Play / Pause Music
                      </button>
                      <button className="secondary" type="button" onClick={() => dispatchMusicCommand('skip')}>
                        Next Track
                      </button>
                    </div>
                    <label className={`range-setting settings-option ${unitTileOwnerTintEnabled ? '' : 'setting-disabled'}`}>
                      <span className="settings-option-copy">
                        <strong>Music volume</strong>
                        <em>Controls the background music player in the top bar without changing button clicks, shots, or movement sounds.</em>
                      </span>
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
                    <label className="range-setting settings-option">
                      <span className="settings-option-copy">
                        <strong>VFX volume</strong>
                        <em>Controls interface clicks, unit selection, movement, shooting, upgrades, and base-building sounds.</em>
                      </span>
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
                    <label className="settings-option">
                      <span className="settings-option-copy">
                        <strong>Movement sound timing</strong>
                        <em>Choose one sound for the whole move, or a quicker step sound for each tile crossed.</em>
                      </span>
                      <select
                        value={movementSoundMode}
                        onChange={(event) => onMovementSoundModeChange(event.target.value as MovementSoundMode)}
                      >
                        <option value="move">Once per movement</option>
                        <option value="tile">Once per tile</option>
                      </select>
                    </label>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <p className="eyebrow">Map Display</p>
                      <h3>Tile Readability</h3>
                      <p>Use these when the map gets crowded and you want ownership, movement, or targeting cues to stand out differently.</p>
                    </div>
                    <div className={`settings-option ownership-display-card ${unitTileOwnerTintEnabled ? '' : 'setting-disabled'}`}>
                      <label className="checkbox-setting ownership-display-toggle">
                        <span className="slide-toggle">
                          <input
                            type="checkbox"
                            checked={unitTileOwnerTintEnabled}
                            onChange={(event) => onUnitTileOwnerTintChange(event.target.checked)}
                          />
                          <span className="slide-toggle-track" aria-hidden="true" />
                        </span>
                        <span className="settings-option-copy">
                          <strong>Tint occupied tiles</strong>
                          <em>
                            Shows occupied tiles in the owning player's color. Overlay keeps terrain texture visible;
                            solid color makes ownership louder and easier to scan.
                          </em>
                        </span>
                      </label>
                      <div className="ownership-display-modes" aria-label="Ownership tile display style">
                        <button
                          type="button"
                          className={unitTileOwnerColorMode === 'overlay' ? 'mode-active' : ''}
                          disabled={!unitTileOwnerTintEnabled}
                          onClick={() => onUnitTileOwnerColorModeChange('overlay')}
                        >
                          Overlay
                        </button>
                        <button
                          type="button"
                          className={unitTileOwnerColorMode === 'solid' ? 'mode-active' : ''}
                          disabled={!unitTileOwnerTintEnabled}
                          onClick={() => onUnitTileOwnerColorModeChange('solid')}
                        >
                          Solid color
                        </button>
                      </div>
                      <label className="range-setting ownership-range">
                        <span className="settings-option-copy">
                          <strong>Overlay intensity</strong>
                          <em>Higher values make ownership stronger while keeping terrain art underneath.</em>
                        </span>
                        <span>{unitTileOwnerTintIntensity}%</span>
                        <input
                          type="range"
                          min="4"
                          max="100"
                          value={unitTileOwnerTintIntensity}
                          disabled={!unitTileOwnerTintEnabled || unitTileOwnerColorMode !== 'overlay'}
                          onChange={(event) => onUnitTileOwnerTintIntensityChange(Number(event.target.value))}
                        />
                      </label>
                      <label className="range-setting ownership-range">
                        <span className="settings-option-copy">
                          <strong>Solid color intensity</strong>
                          <em>Higher values replace more of the terrain tile with the owning player's color.</em>
                        </span>
                        <span>{unitTileOwnerSolidIntensity}%</span>
                        <input
                          type="range"
                          min="4"
                          max="100"
                          value={unitTileOwnerSolidIntensity}
                          disabled={!unitTileOwnerTintEnabled || unitTileOwnerColorMode !== 'solid'}
                          onChange={(event) => onUnitTileOwnerSolidIntensityChange(Number(event.target.value))}
                        />
                      </label>
                      <div className="tint-preview-panel" aria-label="Occupied tile ownership preview">
                        {[
                          ['Red', '#d9534f'],
                          ['Blue', '#4f7ee8'],
                          ['Green', '#4fb06d'],
                          ['Purple', '#8f63d8'],
                        ].map(([label, color]) => (
                          <div className="tint-preview-item" key={label}>
                            <span
                              className={`tint-preview-tile ${unitTileOwnerColorMode === 'solid' ? 'solid-preview' : ''}`}
                              style={
                                {
                                  '--preview-owner-color': color,
                                  '--preview-owner-tint':
                                    unitTileOwnerTintEnabled && unitTileOwnerColorMode === 'overlay'
                                      ? `${unitTileOwnerTintIntensity}%`
                                      : '0%',
                                  '--preview-owner-solid':
                                    unitTileOwnerTintEnabled && unitTileOwnerColorMode === 'solid'
                                      ? `${unitTileOwnerSolidIntensity}%`
                                      : '0%',
                                } as CSSProperties
                              }
                            >
                              <span className="tint-preview-overlay" />
                              <span className="tint-preview-rifleman" />
                            </span>
                            <span>{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <label className="checkbox-setting settings-option">
                      <span className="slide-toggle">
                        <input
                          type="checkbox"
                          checked={unitOwnerBarEnabled}
                          onChange={(event) => onUnitOwnerBarChange(event.target.checked)}
                        />
                        <span className="slide-toggle-track" aria-hidden="true" />
                      </span>
                      <span className="settings-option-copy">
                        <strong>Show owner color bar</strong>
                        <em>Displays a small color strip at the bottom of occupied tiles for a compact ownership cue.</em>
                      </span>
                      <span className="owner-bar-preview-panel" aria-label="Owner color bar preview">
                        <span className="owner-bar-preview-item">
                          <span className="owner-bar-preview-tile">
                            <span className="owner-bar-preview-rifleman" />
                          </span>
                          <span>Off</span>
                        </span>
                        <span className="owner-bar-preview-item">
                          <span className="owner-bar-preview-tile">
                            <span className="owner-bar-preview-strip" />
                            <span className="owner-bar-preview-rifleman" />
                          </span>
                          <span>On</span>
                        </span>
                      </span>
                    </label>
                    <div className="settings-option">
                      <span className="settings-option-copy">
                        <strong>Unit attack and defense labels</strong>
                        <em>Show attack and defense beside the top health bar, or keep them in the tile corners.</em>
                      </span>
                      <div className="ownership-display-modes" aria-label="Unit stat label position">
                        <button
                          type="button"
                          className={unitStatDisplayMode === 'bar' ? 'mode-active' : ''}
                          onClick={() => onUnitStatDisplayModeChange('bar')}
                        >
                          On health bar
                        </button>
                        <button
                          type="button"
                          className={unitStatDisplayMode === 'corners' ? 'mode-active' : ''}
                          onClick={() => onUnitStatDisplayModeChange('corners')}
                        >
                          Tile corners
                        </button>
                      </div>
                    </div>
                    <div className="settings-option">
                      <span className="settings-option-copy">
                        <strong>Unit health bar position</strong>
                        <em>Anchor the health bar display above the unit art or below it.</em>
                      </span>
                      <div className="ownership-display-modes" aria-label="Unit health bar position">
                        <button
                          type="button"
                          className={unitHealthBarPosition === 'top' ? 'mode-active' : ''}
                          onClick={() => onUnitHealthBarPositionChange('top')}
                        >
                          Top
                        </button>
                        <button
                          type="button"
                          className={unitHealthBarPosition === 'bottom' ? 'mode-active' : ''}
                          onClick={() => onUnitHealthBarPositionChange('bottom')}
                        >
                          Bottom
                        </button>
                      </div>
                    </div>
                    <label className="checkbox-setting settings-option">
                      <span className="slide-toggle">
                        <input
                          type="checkbox"
                          checked={unitDefenseValueVisible}
                          onChange={(event) => onUnitDefenseValueVisibleChange(event.target.checked)}
                        />
                        <span className="slide-toggle-track" aria-hidden="true" />
                      </span>
                      <span className="settings-option-copy">
                        <strong>Show defense value</strong>
                        <em>Keeps the defense number in the unit stat display. Turn it off for a cleaner, attack-focused tile read.</em>
                      </span>
                    </label>
                    <div className="settings-option">
                      <span className="settings-option-copy">
                        <strong>Attack and defense icon style</strong>
                        <em>Use sword and shield icons for combat values, or switch back to classic A and D labels.</em>
                      </span>
                      <div className="ownership-display-modes" aria-label="Unit stat label style">
                        <button
                          type="button"
                          className={unitStatLabelMode === 'icons' ? 'mode-active' : ''}
                          onClick={() => onUnitStatLabelModeChange('icons')}
                        >
                          Sword + Shield
                        </button>
                        <button
                          type="button"
                          className={unitStatLabelMode === 'letters' ? 'mode-active' : ''}
                          onClick={() => onUnitStatLabelModeChange('letters')}
                        >
                          A / D
                        </button>
                      </div>
                    </div>
                    <label className="checkbox-setting settings-option">
                      <span className="slide-toggle">
                        <input
                          type="checkbox"
                          checked={attackRadiusVisible}
                          onChange={(event) => onAttackRadiusVisibleChange(event.target.checked)}
                        />
                        <span className="slide-toggle-track" aria-hidden="true" />
                      </span>
                      <span className="settings-option-copy">
                        <strong>Show attack radius</strong>
                        <em>Shows red range tiles for the selected unit. Attackable enemies still get a red border even when this is hidden.</em>
                      </span>
                    </label>
                  </section>

                  <section className="settings-section">
                    <div className="settings-section-heading">
                      <p className="eyebrow">Interface</p>
                      <h3>Complexity</h3>
                      <p>These options simplify panels when you want faster decisions and less detail on screen.</p>
                    </div>
                    <label className="checkbox-setting settings-option">
                      <span className="slide-toggle">
                        <input
                          type="checkbox"
                          checked={qualityTabHidden}
                          onChange={(event) => onQualityTabHiddenChange(event.target.checked)}
                        />
                        <span className="slide-toggle-track" aria-hidden="true" />
                      </span>
                      <span className="settings-option-copy">
                        <strong>Hide Quality tab</strong>
                        <em>Removes the separate Quality tab from base management. Squad quality upgrades still appear next to recruit cards.</em>
                      </span>
                    </label>
                  </section>

                  {gameState?.game.status === 'active' && currentPlayerId && (
                    <section className="settings-section settings-game-controls">
                      <div className="settings-section-heading">
                        <p className="eyebrow">Match</p>
                        <h3>Game Controls</h3>
                        <p>Use these for the current match. Host-only controls affect every player; player controls affect only you.</p>
                      </div>
                      <GameSettings
                        game={gameState.game}
                        players={gameState.players}
                        currentPlayerId={currentPlayerId}
                        onMessage={setSettingsMessage}
                      />
                      {settingsMessage && <p className="settings-message">{settingsMessage}</p>}
                    </section>
                  )}
                </div>
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
                      <td>{totalCommanderXp(player.level, player.xp)}</td>
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
