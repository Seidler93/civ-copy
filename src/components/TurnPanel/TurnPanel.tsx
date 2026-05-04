import { endTurn } from '../../firebase/gameService';
import type { GameDoc, PlayerDoc } from '../../types/gameTypes';

interface TurnPanelProps {
  game: GameDoc;
  currentPlayer: PlayerDoc;
  turnPlayer: PlayerDoc | null;
}

export default function TurnPanel({ game, currentPlayer, turnPlayer }: TurnPanelProps) {
  const isMyTurn = game.currentTurnPlayerId === currentPlayer.id && !currentPlayer.isEliminated;

  return (
    <section className="panel">
      <p className="eyebrow">
        Turn {game.turnNumber} - Round {game.roundNumber}
      </p>
      <h2>{currentPlayer.isEliminated ? 'Eliminated' : isMyTurn ? 'Your turn' : `${turnPlayer?.name ?? 'Someone'} is up`}</h2>
      <p>Supplies: {currentPlayer.supplies}</p>
      <button disabled={!isMyTurn} onClick={() => endTurn(game.id, currentPlayer.id)}>
        {currentPlayer.isEliminated ? 'Eliminated' : isMyTurn ? 'End Turn' : `${turnPlayer?.name ?? "Player"}'s Turn`}
      </button>
    </section>
  );
}
