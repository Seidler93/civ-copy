import type { PlayerDoc } from '../../types/gameTypes';
import { xpForNextLevel } from '../../utils/xp';

interface PlayerProgressProps {
  player: PlayerDoc;
  deployedUnits: number;
  maxDeployedUnits: number;
  onOpenTalents: () => void;
}

export default function PlayerProgress({ player, deployedUnits, maxDeployedUnits, onOpenTalents }: PlayerProgressProps) {
  const nextLevelXp = xpForNextLevel(player.level);
  const progressPercent = Math.min(100, Math.round((player.xp / nextLevelXp) * 100));

  return (
    <section className="panel progress-panel">
      <div className="progress-heading">
        <div>
          <p className="eyebrow">Commander</p>
          <h2>Level {player.level}</h2>
        </div>
        <button className="talent-point-button" onClick={onOpenTalents}>
          {player.talentPoints} SP
        </button>
      </div>
      <div className="health-meter xp-meter" aria-label={`XP ${player.xp} of ${nextLevelXp}`}>
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <p className="muted">
        {player.xp}/{nextLevelXp} XP to level {player.level + 1}
      </p>
      <p className="muted">
        Squads deployed: {deployedUnits}/{maxDeployedUnits}
      </p>
    </section>
  );
}
