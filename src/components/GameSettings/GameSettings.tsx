import { useState } from 'react';
import { backOutOfGame, kickPlayerFromGame, resetGameToLobby, setGamePaused } from '../../firebase/gameService';
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
  const kickablePlayers = players.filter((player) => player.id !== game.hostPlayerId && !player.isEliminated);
  const [kickPlayerId, setKickPlayerId] = useState(kickablePlayers[0]?.id ?? '');
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
    try {
      onMessage(await setGamePaused(game.id, currentPlayerId, !game.isPaused));
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not update pause state.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleKickPlayer() {
    const targetPlayer = players.find((player) => player.id === kickPlayerId);
    if (!targetPlayer) {
      onMessage('Choose a player to kick.');
      return;
    }

    setIsBusy(true);
    try {
      onMessage(await kickPlayerFromGame(game.id, currentPlayerId, targetPlayer.id));
      setConfirmingAction(null);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not kick player.');
    } finally {
      setIsBusy(false);
    }
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
              {kickablePlayers.length > 0 && (
                <div className="kick-player-control">
                  <label>
                    Kick player
                    <select value={kickPlayerId} disabled={isBusy} onChange={(event) => setKickPlayerId(event.target.value)}>
                      {kickablePlayers.map((player) => (
                        <option value={player.id} key={player.id}>
                          {player.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="danger-button" disabled={isBusy || !kickPlayerId} onClick={() => setConfirmingAction('kick')}>
                    Kick Player
                  </button>
                </div>
              )}
              <button className="danger-button" disabled={isBusy} onClick={() => setConfirmingAction('end')}>
                End Game
              </button>
            </>
          )}
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
            Kick {players.find((player) => player.id === kickPlayerId)?.name ?? 'this player'} and remove their units,
            bases, mines, trenches, and smoke from the map?
          </p>
          <button className="danger-button" disabled={isBusy || !kickPlayerId} onClick={handleKickPlayer}>
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
