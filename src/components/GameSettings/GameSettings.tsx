import { useState } from 'react';
import { backOutOfGame, resetGameToLobby, setGamePaused } from '../../firebase/gameService';
import type { GameDoc } from '../../types/gameTypes';

interface GameSettingsProps {
  game: GameDoc;
  currentPlayerId: string;
  onMessage: (message: string) => void;
}

export default function GameSettings({ game, currentPlayerId, onMessage }: GameSettingsProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<'end' | 'backout' | null>(null);
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
    </section>
  );
}
