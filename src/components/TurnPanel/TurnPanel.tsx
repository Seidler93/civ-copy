import { endTurn } from '../../firebase/gameService';
import type { GameDoc, PlayerDoc } from '../../types/gameTypes';
import { useEffect, useState } from 'react';

interface TurnPanelProps {
  game: GameDoc;
  currentPlayer: PlayerDoc;
  turnPlayer: PlayerDoc | null;
}

export default function TurnPanel({ game, currentPlayer, turnPlayer }: TurnPanelProps) {
  const isTimedMode = game.mode === 'timed-simultaneous';
  const isFinished = game.status === 'finished';
  const isMyTurn = !game.isPaused && (isTimedMode || game.currentTurnPlayerId === currentPlayer.id) && !currentPlayer.isEliminated;
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, (game.roundEndsAtMs ?? 0) - Date.now()));

  useEffect(() => {
    if (!isTimedMode || !game.roundEndsAtMs) {
      setRemainingMs(0);
      return undefined;
    }

    const update = () => setRemainingMs(Math.max(0, game.roundEndsAtMs! - Date.now()));
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [game.roundEndsAtMs, isTimedMode]);

  return (
    <section className="panel">
      <p className="eyebrow">
        Turn {game.turnNumber} - Round {game.roundNumber}
      </p>
      <h2>
        {isFinished
          ? game.winnerPlayerId === currentPlayer.id
            ? 'Victory'
            : 'Game over'
          : game.isPaused
            ? 'Paused'
          : currentPlayer.isEliminated
          ? 'Eliminated'
          : isTimedMode
            ? 'Simultaneous round live'
            : isMyTurn
              ? 'Your turn'
              : `${turnPlayer?.name ?? 'Someone'} is up`}
      </h2>
      <p>Supplies: {currentPlayer.supplies}</p>
      {isFinished ? (
        <p className="muted">
          {game.victoryReason === 'turn-limit' ? 'Match ended on the round cap. Highest XP wins.' : 'A winner has been decided.'}
        </p>
      ) : game.isPaused ? (
        <p className="muted">Gameplay is paused by the host. Map viewing stays available.</p>
      ) : isTimedMode ? (
        <p className="muted">
          Round timer: {Math.floor(remainingMs / 1000)}s remaining
        </p>
      ) : (
        <button disabled={!isMyTurn} onClick={() => endTurn(game.id, currentPlayer.id)}>
          {currentPlayer.isEliminated ? 'Eliminated' : isMyTurn ? 'End Turn' : `${turnPlayer?.name ?? "Player"}'s Turn`}
        </button>
      )}
    </section>
  );
}
