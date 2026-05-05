import { useState } from 'react';
import { backOutOfGame, kickPlayerFromGame, resetGameToLobby, setGamePaused, transferGameHost } from '../../firebase/gameService';
import type { GameDoc, PlayerDoc } from '../../types/gameTypes';

interface GameSettingsProps {
  game: GameDoc;
  players: PlayerDoc[];
  currentPlayerId: string;
  onMessage: (message: string) => void;
}

export default function GameSettings({ game, players, currentPlayerId, onMessage }: GameSettingsProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<'end' | 'backout' | 'kick' | null>(null);
  const [targetPlayerId, setTargetPlayerId] = useState('');
  const [openPlayerMenuId, setOpenPlayerMenuId] = useState<string | null>(null);
  const isHost = game.hostPlayerId === currentPlayerId;

  async function handleEndGame() {
    setIsBusy(true);
    try {
      await resetGameToLobby(game.id, currentPlayerId);
      onMessage('Game ended. Back to lobby for a fresh restart.');
      setConfirmingAction(null);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not end game.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleBackOut() {
    setIsBusy(true);
    try {
      const result = await backOutOfGame(game.id, currentPlayerId);
      onMessage(result);
      setConfirmingAction(null);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not back out.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handlePauseToggle() {
    setIsBusy(true);
    setOpenPlayerMenuId(null);
    try {
      onMessage(await setGamePaused(game.id, currentPlayerId, !game.isPaused));
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not update pause state.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleKickPlayer() {
    const targetPlayer = players.find((player) => player.id === targetPlayerId);
    if (!targetPlayer) {
      onMessage('Choose a player to kick.');
      return;
    }

    setIsBusy(true);
    try {
      onMessage(await kickPlayerFromGame(game.id, currentPlayerId, targetPlayer.id));
      setConfirmingAction(null);
      setTargetPlayerId('');
      setOpenPlayerMenuId(null);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not kick player.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleTransferHost(nextHostPlayerId: string) {
    setIsBusy(true);
    setOpenPlayerMenuId(null);
    try {
      await transferGameHost(game.id, currentPlayerId, nextHostPlayerId);
      const nextHost = players.find((player) => player.id === nextHostPlayerId);
      onMessage(`${nextHost?.name ?? 'That player'} is now host.`);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not change host.');
    } finally {
      setIsBusy(false);
    }
  }

  function requestKickPlayer(playerId: string) {
    setTargetPlayerId(playerId);
    setOpenPlayerMenuId(null);
    setConfirmingAction('kick');
  }

  return (
    <section className="panel settings-panel">
      <p className="eyebrow">{isHost ? 'Host Settings' : 'Player Settings'}</p>
      <h2>Game Controls</h2>
      {confirmingAction === null && (
        <>
          <button className="danger-button" disabled={isBusy} onClick={() => setConfirmingAction('backout')}>
            Back Out
          </button>
          {isHost && (
            <>
              <button className="secondary" disabled={isBusy} onClick={handlePauseToggle}>
                {game.isPaused ? 'Resume Gameplay' : 'Pause Gameplay'}
              </button>
              <button className="danger-button" disabled={isBusy} onClick={() => setConfirmingAction('end')}>
                End Game
              </button>
            </>
          )}
          <div className="match-party-list">
            <div className="match-party-heading">
              <span>Party</span>
              <span>{players.filter((player) => !player.isEliminated).length}/{players.length} active</span>
            </div>
            <div className="player-list lobby-player-list match-player-list">
              {players.map((player) => (
                <div className={`player-row lobby-player-row match-player-row ${player.isEliminated ? 'eliminated' : ''}`} key={player.id}>
                  <div className="lobby-player-identity">
                    <span className="color-dot" style={{ backgroundColor: player.color }} />
                    <span>{player.name}</span>
                  </div>
                  <div className="lobby-player-actions">
                    {player.id === game.hostPlayerId && <span className="tag">Host</span>}
                    {player.id === currentPlayerId && <span className="tag">You</span>}
                    {player.isEliminated && <span className="tag eliminated-chip">Out</span>}
                    <div className="lobby-player-menu-wrap">
                      <button
                        className="icon-menu-button"
                        type="button"
                        disabled={isBusy}
                        aria-label={`Open ${player.name} player options`}
                        aria-expanded={openPlayerMenuId === player.id}
                        onClick={() => setOpenPlayerMenuId((openId) => (openId === player.id ? null : player.id))}
                      >
                        ...
                      </button>
                      {openPlayerMenuId === player.id && (
                        <div className="lobby-player-menu">
                          <div className="lobby-player-menu-title">{player.name}</div>
                          {isHost && player.id !== currentPlayerId && !player.isEliminated ? (
                            <>
                              <button type="button" disabled={isBusy} onClick={() => handleTransferHost(player.id)}>
                                Make Host
                              </button>
                              <button className="danger-menu-item" type="button" disabled={isBusy} onClick={() => requestKickPlayer(player.id)}>
                                Kick Player
                              </button>
                            </>
                          ) : player.id === currentPlayerId ? (
                            <button
                              className="danger-menu-item"
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                setOpenPlayerMenuId(null);
                                setConfirmingAction('backout');
                              }}
                            >
                              Back Out
                            </button>
                          ) : (
                            <span className="lobby-player-menu-note">
                              {player.isEliminated ? 'This player is already out.' : 'Only the host can manage players.'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {confirmingAction === 'end' && (
        <div className="confirm-actions">
          <button className="danger-button" disabled={isBusy} onClick={handleEndGame}>
            {isBusy ? 'Ending...' : 'Are You Sure?'}
          </button>
          <button className="secondary" disabled={isBusy} onClick={() => setConfirmingAction(null)}>
            Cancel
          </button>
        </div>
      )}
      {confirmingAction === 'backout' && (
        <div className="confirm-actions">
          <button className="danger-button" disabled={isBusy} onClick={handleBackOut}>
            {isBusy ? 'Backing out...' : 'Confirm Back Out'}
          </button>
          <button className="secondary" disabled={isBusy} onClick={() => setConfirmingAction(null)}>
            Cancel
          </button>
        </div>
      )}
      {confirmingAction === 'kick' && (
        <div className="confirm-actions">
          <p className="settings-confirm-copy">
            Kick {players.find((player) => player.id === targetPlayerId)?.name ?? 'this player'} and remove their units,
            bases, mines, trenches, and smoke from the map?
          </p>
          <button className="danger-button" disabled={isBusy || !targetPlayerId} onClick={handleKickPlayer}>
            {isBusy ? 'Kicking...' : 'Confirm Kick'}
          </button>
          <button className="secondary" disabled={isBusy} onClick={() => setConfirmingAction(null)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
