import { useEffect, useRef, useState } from 'react';
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
  const [xpFloats, setXpFloats] = useState<{ id: number; amount: number }[]>([]);
  const lastTotalXpRef = useRef<number | null>(null);

  useEffect(() => {
    const totalXp = totalPlayerXp(player.level, player.xp);
    const previousTotalXp = lastTotalXpRef.current;
    lastTotalXpRef.current = totalXp;

    if (previousTotalXp === null || totalXp <= previousTotalXp) return undefined;

    const id = Date.now();
    setXpFloats((current) => [...current, { id, amount: totalXp - previousTotalXp }]);
    const timeout = window.setTimeout(() => {
      setXpFloats((current) => current.filter((entry) => entry.id !== id));
    }, 1400);

    return () => window.clearTimeout(timeout);
  }, [player.level, player.xp]);

  return (
    <section className="panel progress-panel">
      <div className="progress-heading">
        <div>
          <p className="eyebrow">Commander</p>
          <h2>Level {player.level}</h2>
        </div>
        <button
          className={`talent-point-button ${player.talentPoints > 0 ? 'has-points' : ''}`}
          onClick={onOpenTalents}
          aria-label={
            player.talentPoints > 0
              ? `${player.talentPoints} skill point${player.talentPoints === 1 ? '' : 's'} available`
              : 'Open skill tree'
          }
        >
          {player.talentPoints} SP
        </button>
      </div>
      <div className="xp-meter-wrap">
        <div className="health-meter xp-meter" aria-label={`XP ${player.xp} of ${nextLevelXp}`}>
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        {xpFloats.map((entry) => (
          <span className="xp-float" key={entry.id}>
            +{entry.amount} XP
          </span>
        ))}
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

function totalPlayerXp(level: number, currentLevelXp: number) {
  let total = currentLevelXp;
  for (let previousLevel = 1; previousLevel < level; previousLevel += 1) {
    total += xpForNextLevel(previousLevel);
  }
  return total;
}
