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
        <p>Share this code with 1 to 4 other players. The host starts the game once everyone is in.</p>
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
          {gameState.players.length >= 5
            ? 'Map: Grand Front, the larger battlefield built for full 5-player wars.'
            : 'Map: Classic Front by default. If a 5th player joins, the game upgrades to the larger Grand Front map.'}
        </p>
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
