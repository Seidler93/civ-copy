import { startGame } from '../firebase/gameService';
import type { GameState } from '../types/gameTypes';

interface LobbyPageProps {
  gameState: GameState;
  currentPlayerId: string;
  onLeave: () => void;
}

export default function LobbyPage({ gameState, currentPlayerId, onLeave }: LobbyPageProps) {
  const isHost = gameState.game.hostPlayerId === currentPlayerId;
  const canStart = isHost && gameState.players.length >= 2;

  return (
    <section className="lobby-page">
      <div>
        <p className="eyebrow">Game code</p>
        <h1>{gameState.game.code}</h1>
        <p>Share this code with 1 to 3 siblings. The host starts the game once everyone is in.</p>
      </div>
      <div className="panel">
        <h2>Players</h2>
        <div className="player-list">
          {gameState.players.map((player) => (
            <div className="player-row" key={player.id}>
              <span className="color-dot" style={{ backgroundColor: player.color }} />
              <span>{player.name}</span>
              {player.id === gameState.game.hostPlayerId && <span className="tag">Host</span>}
            </div>
          ))}
        </div>
        <div className="button-row">
          <button disabled={!canStart} onClick={() => startGame(gameState.game.id)}>
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
