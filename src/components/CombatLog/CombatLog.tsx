export interface CombatLogEntry {
  id: string;
  title: string;
  attackerTileId: string;
  defenderTileId: string;
  attackRoll: number;
  defenseRoll: number;
  attackPower: number;
  defensePower: number;
  attackSupportBonus: number;
  margin: number;
  attackerDamage: number;
  defenderDamage: number;
  xpGained: number;
  suppliesGained: number;
  defenderSuppliesGained: number;
  unitXpGained: number;
  result: string;
}

interface CombatLogProps {
  entries: string[];
  combatEntries?: CombatLogEntry[];
}

export default function CombatLog({ entries, combatEntries = [] }: CombatLogProps) {
  return (
    <section className="panel combat-log-panel">
      <h2>Log</h2>
      <div className="combat-log-scroll">
        {combatEntries.length > 0 && (
          <div className="combat-log-list">
            {combatEntries.map((entry) => (
              <article className="combat-log-entry" key={entry.id}>
                <div className="combat-log-heading">
                  <strong>{entry.title}</strong>
                  <span>{entry.result}</span>
                </div>
                <div className="combat-log-grid">
                  <span>Attack roll</span>
                  <strong>{entry.attackRoll}</strong>
                  <span>Defense roll</span>
                  <strong>{entry.defenseRoll}</strong>
                  <span>Attack total</span>
                  <strong>{entry.attackPower}</strong>
                  <span>Support bonus</span>
                  <strong>{entry.attackSupportBonus > 0 ? `+${entry.attackSupportBonus}` : '-'}</strong>
                  <span>Defense total</span>
                  <strong>{entry.defensePower}</strong>
                  <span>Margin</span>
                  <strong>{entry.margin > 0 ? `+${entry.margin}` : entry.margin}</strong>
                  <span>Your damage</span>
                  <strong>{entry.attackerDamage}</strong>
                  <span>Enemy damage</span>
                  <strong>{entry.defenderDamage}</strong>
                  <span>Rewards</span>
                  <strong>+{entry.xpGained} XP, +{entry.suppliesGained} supplies</strong>
                  <span>Defender reward</span>
                  <strong>{entry.defenderSuppliesGained > 0 ? `+${entry.defenderSuppliesGained} supplies` : '-'}</strong>
                  <span>Squad XP</span>
                  <strong>+{entry.unitXpGained}</strong>
                </div>
                <p className="muted">
                  From {entry.attackerTileId} to {entry.defenderTileId}
                </p>
              </article>
            ))}
          </div>
        )}
        <div className="log-list">
          {entries.map((entry, index) => (
            <p key={`${entry}-${index}`}>{entry}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
