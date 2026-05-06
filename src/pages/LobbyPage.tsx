import { useEffect, useState } from 'react';
import {
  PLAYER_COLORS,
  kickLobbyPlayer,
  setLobbyPlayerColor,
  setLobbyPlayerReady,
  startGame,
  transferLobbyHost,
} from '../firebase/gameService';
import type { GameState } from '../types/gameTypes';

interface LobbyPageProps {
  gameState: GameState;
  currentPlayerId: string;
  onLeave: () => void;
}

export default function LobbyPage({ gameState, currentPlayerId, onLeave }: LobbyPageProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [openPlayerMenuId, setOpenPlayerMenuId] = useState<string | null>(null);
  const currentPlayer = gameState.players.find((player) => player.id === currentPlayerId);
  const isHost = gameState.game.hostPlayerId === currentPlayerId;
  const enoughPlayers = gameState.players.length >= 2;
  const allReady = enoughPlayers && gameState.players.every((player) => player.isReady);
  const canStart = isHost && allReady && !busyAction;
  const usedColors = new Set(gameState.players.filter((player) => player.id !== currentPlayerId).map((player) => player.color));

  useEffect(() => {
    if (!openPlayerMenuId) return undefined;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.lobby-player-menu-wrap')) return;
      setOpenPlayerMenuId(null);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [openPlayerMenuId]);

  const runLobbyAction = async (actionId: string, action: () => Promise<void>) => {
    setBusyAction(actionId);
    setMessage(null);
    setOpenPlayerMenuId(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setBusyAction(null);
    }
  };

  if (!currentPlayer) {
    return (
      <section className="lobby-page">
        <div>
          <p className="eyebrow">Game code</p>
          <h1>{gameState.game.code}</h1>
          <p>You are no longer in this lobby.</p>
        </div>
        <div className="panel lobby-control-panel">
          <h2>Lobby Updated</h2>
          <p className="muted">The host may have removed you, or this player session is no longer connected.</p>
          <button className="secondary" onClick={onLeave}>
            Leave Lobby
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="lobby-page">
      <div>
        <p className="eyebrow">Game code</p>
        <h1>{gameState.game.code}</h1>
        <p>Share this code with 1 to 4 other players. Pick your team color, ready up, then the host can start.</p>
        <p className="muted">
          {gameState.game.mode === 'timed-simultaneous'
            ? `Mode: Timed simultaneous${gameState.game.roundDurationSeconds ? `, ${gameState.game.roundDurationSeconds}s rounds` : ''}.`
            : 'Mode: Turn based.'}
        </p>
        <p className="muted">
          {gameState.game.turnLimitRounds
            ? `Match cap: ${gameState.game.turnLimitRounds} rounds. Highest total XP wins if nobody wins earlier by elimination.`
            : 'Match cap: none. Last commander standing wins.'}
        </p>
        <p className="muted">
          Unit combining: {gameState.game.allowMixedUnitCombines ? 'mixed squads allowed, except solo-only units' : 'same squad types only'}.
        </p>
        <p className="muted">
          {gameState.players.length >= 5
            ? 'Map: Grand Front, the larger battlefield built for full 5-player wars.'
            : 'Map: Classic Front by default. If a 5th player joins, the game upgrades to the larger Grand Front map.'}
        </p>
      </div>
      <div className="panel lobby-control-panel">
        <div className="lobby-panel-heading">
          <div>
            <p className="eyebrow">Ready menu</p>
            <h2>Commanders</h2>
          </div>
          <span className={`ready-count ${allReady ? 'ready' : ''}`}>
            {gameState.players.filter((player) => player.isReady).length}/{gameState.players.length} ready
          </span>
        </div>

        <div className="lobby-color-picker">
          <span>Team color</span>
          <div className="lobby-color-options" aria-label="Choose team color">
            {PLAYER_COLORS.map((color) => {
              const isSelected = currentPlayer.color.toLowerCase() === color.toLowerCase();
              const isTaken = usedColors.has(color);
              return (
                <button
                  key={color}
                  className={`team-color-swatch ${isSelected ? 'selected' : ''}`}
                  type="button"
                  disabled={isTaken || Boolean(busyAction)}
                  style={{ backgroundColor: color }}
                  title={isTaken ? 'Taken' : isSelected ? 'Selected' : 'Choose color'}
                  aria-label={isTaken ? 'Team color taken' : `Choose team color ${color}`}
                  onClick={() => runLobbyAction(`color-${color}`, () => setLobbyPlayerColor(gameState.game.id, currentPlayerId, color))}
                >
                  {isSelected && <span />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="player-list lobby-player-list">
          {gameState.players.map((player) => (
            <div className={`player-row lobby-player-row ${player.isReady ? 'ready' : ''}`} key={player.id}>
              <div className="lobby-player-identity">
                <span className="color-dot" style={{ backgroundColor: player.color }} />
                <span>{player.name}</span>
              </div>
              <div className="lobby-player-actions">
                {player.id === gameState.game.hostPlayerId && <span className="tag">Host</span>}
                <span className={`tag ${player.isReady ? 'ready-tag' : 'waiting-tag'}`}>{player.isReady ? 'Ready' : 'Not ready'}</span>
                <div className="lobby-player-menu-wrap">
                  <button
                    className="icon-menu-button"
                    type="button"
                    disabled={Boolean(busyAction)}
                    aria-label={`Open ${player.name} player options`}
                    aria-expanded={openPlayerMenuId === player.id}
                    onClick={() => setOpenPlayerMenuId((openId) => (openId === player.id ? null : player.id))}
                  >
                    ...
                  </button>
                  {openPlayerMenuId === player.id && (
                    <div className="lobby-player-menu">
                      <div className="lobby-player-menu-title">{player.name}</div>
                      {isHost && player.id !== currentPlayerId ? (
                        <>
                          <button
                            type="button"
                            disabled={Boolean(busyAction)}
                            onClick={() => runLobbyAction(`host-${player.id}`, () => transferLobbyHost(gameState.game.id, currentPlayerId, player.id))}
                          >
                            Make Host
                          </button>
                          <button
                            className="danger-menu-item"
                            type="button"
                            disabled={Boolean(busyAction)}
                            onClick={() => runLobbyAction(`kick-${player.id}`, () => kickLobbyPlayer(gameState.game.id, currentPlayerId, player.id))}
                          >
                            Kick Player
                          </button>
                        </>
                      ) : (
                        <span className="lobby-player-menu-note">
                          {player.id === currentPlayerId ? 'This is you.' : 'Only the host can manage players.'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {message && <p className="form-error">{message}</p>}

        <div className="button-row">
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => runLobbyAction('ready', () => setLobbyPlayerReady(gameState.game.id, currentPlayerId, !currentPlayer.isReady))}
          >
            {currentPlayer.isReady ? 'Unready' : 'Ready Up'}
          </button>
          <button
            disabled={!canStart}
            onClick={() => runLobbyAction('start', () => startGame(gameState.game.id, currentPlayerId))}
            title={!isHost ? 'Only the host can start.' : !enoughPlayers ? 'Need at least 2 players.' : !allReady ? 'Everyone must be ready.' : 'Start game'}
          >
            Start Game
          </button>
          <button className="secondary" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>
    </section>
  );
}
