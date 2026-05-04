import type { PlayerDoc } from '../../types/gameTypes';

interface PlayerPanelProps {
  players: PlayerDoc[];
  currentPlayerId: string;
}

export default function PlayerPanel({ players, currentPlayerId }: PlayerPanelProps) {
  return (
    <section className="panel">
      <h2>Commanders</h2>
      <div className="player-list">
        {players.map((player) => (
          <div className={['player-row', player.isEliminated ? 'eliminated' : ''].join(' ')} key={player.id}>
            <span className="color-dot" style={{ backgroundColor: player.color }} />
            <span className="player-name">
              {player.name} <span className="level-chip">L{player.level}</span>
              {player.isEliminated && <span className="eliminated-chip">Out</span>}
            </span>
            {player.id === currentPlayerId && <span className="tag">You</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
