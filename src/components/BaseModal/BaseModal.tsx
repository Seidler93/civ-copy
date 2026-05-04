import { type CSSProperties, useState } from 'react';
import { UNIT_TYPES } from '../../data/unitTypes';
import { UNIT_COMPOSITIONS } from '../../data/unitCompositions';
import { UPGRADE_CONFIG } from '../../data/upgradeConfig';
import { ARTILLERY_STRIKES, ARTILLERY_UNLOCK_BARRACKS_LEVEL } from '../../data/artilleryConfig';
import type { ArmyDoc, PlayerDoc, TileDoc, UnitTypeId } from '../../types/gameTypes';
import { connectedBaseSupplyBonus, effectiveBarracksLevel } from '../../utils/trenchNetwork';

type BaseTab = 'barracks' | 'units' | 'quality' | 'defense' | 'artillery';
type BaseUpgradeAction = 'barracks' | 'defense' | 'offense' | `quality:${UnitTypeId}`;

interface BaseModalProps {
  tile: TileDoc | null;
  tiles: TileDoc[];
  armies: ArmyDoc[];
  player: PlayerDoc;
  isCurrentTurn: boolean;
  onRecruit: (unitTypeId: UnitTypeId) => Promise<void>;
  onRecruitComposition: (compositionId: string) => Promise<void>;
  onUpgrade: (action: BaseUpgradeAction) => Promise<void>;
  onClose: () => void;
}

const UNIT_ORDER: UnitTypeId[] = ['gunman', 'recon', 'builder', 'sniper', 'antiVehicle', 'medic', 'tank', 'artillery'];
const SOLO_ONLY_UNITS = new Set<UnitTypeId>(['recon', 'builder', 'artillery']);

export default function BaseModal({
  tile,
  tiles,
  armies,
  player,
  isCurrentTurn,
  onRecruit,
  onRecruitComposition,
  onUpgrade,
  onClose,
}: BaseModalProps) {
  const [activeTab, setActiveTab] = useState<BaseTab>('barracks');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  if (!tile?.base) return null;

  const sharedBarracksLevel = effectiveBarracksLevel(tile, tiles, armies);
  const supplyLineBonus = connectedBaseSupplyBonus(tile, tiles, armies);
  const unlockedUnits = new Set(
    UPGRADE_CONFIG.barracks
      .filter((level) => level.level <= sharedBarracksLevel)
      .flatMap((level) => level.unlocks),
  );
  const nextBarracks = UPGRADE_CONFIG.barracks.find((level) => level.level === tile.base!.barracksLevel + 1);
  const nextDefense = UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel + 1);
  const currentOffenseLevel = tile.base.offenseLevel ?? 1;
  const currentOffense = UPGRADE_CONFIG.baseOffense.find((level) => level.level === currentOffenseLevel);
  const nextOffense = UPGRADE_CONFIG.baseOffense.find((level) => level.level === currentOffenseLevel + 1);
  const isArtilleryUnlocked = sharedBarracksLevel >= ARTILLERY_UNLOCK_BARRACKS_LEVEL;
  const nextBarracksCost = nextBarracks?.cost ? upgradeCostForPlayer(nextBarracks.cost, player) : 0;
  const nextBarracksUnlocks = nextBarracks?.unlocks ?? [];

  async function runAction(actionId: string, action: () => Promise<void>) {
    setBusyAction(actionId);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal base-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Base at {tile.x}, {tile.y}</p>
            <h2>Manage Base</h2>
          </div>
          <strong className="modal-supplies">{player.supplies} supplies</strong>
          <button className="secondary icon-button" onClick={onClose} aria-label="Close base modal">
            X
          </button>
        </div>
        <div className="base-tabs" role="tablist" aria-label="Base management">
          <button className={activeTab === 'barracks' ? 'active' : ''} onClick={() => setActiveTab('barracks')}>
            <span>Barracks</span>
            <span className="tab-level-badge">L{sharedBarracksLevel}</span>
          </button>
          <button className={activeTab === 'units' ? 'active' : ''} onClick={() => setActiveTab('units')}>
            Units
          </button>
          <button className={activeTab === 'quality' ? 'active' : ''} onClick={() => setActiveTab('quality')}>
            Quality
          </button>
          <button className={activeTab === 'defense' ? 'active' : ''} onClick={() => setActiveTab('defense')}>
            <span>Defense</span>
            <span className="tab-level-badge">L{tile.base.defenseLevel}</span>
          </button>
          <button className={activeTab === 'artillery' ? 'active' : ''} onClick={() => setActiveTab('artillery')}>
            Artillery
          </button>
        </div>

        {activeTab === 'barracks' && (
          <div className="recruit-list">
            <div
              className={[
                'recruit-row',
                'upgrade-row',
                'barracks-upgrade-row',
                nextBarracks?.cost && player.supplies < nextBarracksCost ? 'unaffordable' : '',
              ].join(' ')}
            >
              <div>
                <strong>{nextBarracks ? `Upgrade Barracks to L${nextBarracks.level}` : 'Barracks Maxed'}</strong>
                <p>
                  {nextBarracks
                    ? barracksUpgradeDescription(nextBarracks.level, nextBarracksUnlocks)
                    : 'This base can recruit every current squad type.'}
                  {sharedBarracksLevel > tile.base.barracksLevel
                    ? ` Connected trenches share Barracks L${sharedBarracksLevel} here.`
                    : ''}
                  {supplyLineBonus > 0 ? ` Supply line bonus: +${supplyLineBonus} supplies per turn.` : ''}
                </p>
              </div>
              <div className="recruit-actions">
                <span>{nextBarracks?.cost ? nextBarracksCost : '-'}</span>
                <button
                  disabled={!isCurrentTurn || !nextBarracks?.cost || player.supplies < nextBarracksCost || busyAction !== null}
                  onClick={() => runAction('barracks', () => onUpgrade('barracks'))}
                >
                  {busyAction === 'barracks' ? 'Upgrading...' : 'Upgrade'}
                </button>
              </div>
            </div>
            {UNIT_ORDER.map((unitTypeId) => {
              const unit = UNIT_TYPES[unitTypeId];
              const cost = unitCostForPlayer(unit.cost, player);
              const unlocked = unlockedUnits.has(unitTypeId);
              const canAfford = player.supplies >= cost;
              const currentLevel = tile.base!.unitQualityByType?.[unitTypeId] ?? tile.base!.unitQualityLevel ?? 1;
              const qualityBonus = Math.max(0, currentLevel - 1);
              const requiredBarracksLevel =
                UPGRADE_CONFIG.barracks.find((level) => level.unlocks.includes(unitTypeId))?.level ?? 1;
              const recruitStats = [
                { label: 'HP', value: unit.space, max: 20 },
                { label: 'ATK', value: unit.attack + qualityBonus, max: 8 },
                { label: 'DEF', value: unit.defense + qualityBonus, max: 8 },
                { label: 'SPACE', value: unit.space, max: 20 },
              ];
              return (
                <div className={['recruit-row', !canAfford ? 'unaffordable' : ''].join(' ')} key={unitTypeId}>
                  <div className="recruit-details">
                    <div className="recruit-copy">
                      <strong>
                        {unit.name} L{currentLevel}
                        {SOLO_ONLY_UNITS.has(unitTypeId) && <span className="solo-note">Solo only</span>}
                        {unitTypeId === 'medic' && <span className="ability-note">Action: Heal</span>}
                        {unitTypeId === 'antiVehicle' && <span className="ability-note">Action: Deploy Mine</span>}
                        {!unlocked && <span className="lock-note">Requires Barracks L{requiredBarracksLevel}</span>}
                      </strong>
                      <p>{unit.description}</p>
                    </div>
                    <div className="recruit-stat-bars" aria-label={`${unit.name} stats`}>
                      {recruitStats.map((stat) => (
                        <span className="recruit-stat-bar" key={stat.label}>
                          <span className="recruit-stat-label">{stat.label}</span>
                          <span className="recruit-stat-track">
                            <span
                              className="recruit-stat-fill"
                              style={{ '--bar-width': `${Math.min(100, Math.round((stat.value / stat.max) * 100))}%` } as CSSProperties}
                            />
                          </span>
                          <strong>{stat.value}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="recruit-actions">
                    <span>{cost}</span>
                    <button
                      disabled={!isCurrentTurn || !unlocked || !canAfford || busyAction !== null}
                      onClick={() => runAction(`recruit:${unitTypeId}`, () => onRecruit(unitTypeId))}
                    >
                      {busyAction === `recruit:${unitTypeId}` ? 'Recruiting...' : unlocked ? 'Recruit' : 'Locked'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'units' && (
          <div className="recruit-list">
            {UNIT_COMPOSITIONS.map((composition) => {
              const qualityAdjustedUnits = composition.units.map((unitTypeId) => {
                const currentLevel = tile.base!.unitQualityByType?.[unitTypeId] ?? tile.base!.unitQualityLevel ?? 1;
                const qualityBonus = Math.max(0, currentLevel - 1);
                const unit = UNIT_TYPES[unitTypeId];
                return {
                  unitTypeId,
                  name: unit.name,
                  attack: unit.attack + qualityBonus,
                  defense: unit.defense + qualityBonus,
                  health: unit.space,
                  space: unit.space,
                  unlocked: unlockedUnits.has(unitTypeId),
                  requiredBarracksLevel: UPGRADE_CONFIG.barracks.find((level) => level.unlocks.includes(unitTypeId))?.level ?? 1,
                  cost: unitCostForPlayer(unit.cost, player),
                };
              });
              const lockedUnit = qualityAdjustedUnits.find((unit) => !unit.unlocked);
              const totalCost = qualityAdjustedUnits.reduce((total, unit) => total + unit.cost, 0);
              const totalHealth = qualityAdjustedUnits.reduce((total, unit) => total + unit.health, 0);
              const totalAttack = qualityAdjustedUnits.reduce((total, unit) => total + unit.attack, 0);
              const totalDefense = qualityAdjustedUnits.reduce((total, unit) => total + unit.defense, 0);
              const totalSpace = qualityAdjustedUnits.reduce((total, unit) => total + unit.space, 0);
              const compositionStats = [
                { label: 'HP', value: totalHealth, max: 50 },
                { label: 'ATK', value: totalAttack, max: 14 },
                { label: 'DEF', value: totalDefense, max: 14 },
                { label: 'SPACE', value: totalSpace, max: 50 },
              ];
              const canAfford = player.supplies >= totalCost;

              return (
                <div className={['recruit-row', 'composition-row', !canAfford ? 'unaffordable' : ''].join(' ')} key={composition.id}>
                  <div className="composition-card">
                    <div className="composition-heading">
                      <strong>
                        {composition.name}
                        {lockedUnit && (
                          <span className="lock-note">Requires Barracks L{lockedUnit.requiredBarracksLevel}</span>
                        )}
                      </strong>
                    </div>
                    {composition.notes.map((note) => (
                      <p className="muted" key={note}>{note}</p>
                    ))}
                    <div className="composition-stat-bars" aria-label={`${composition.name} total stats`}>
                      {compositionStats.map((stat) => (
                        <span className="recruit-stat-bar" key={stat.label}>
                          <span className="recruit-stat-label">{stat.label}</span>
                          <span className="recruit-stat-track">
                            <span
                              className="recruit-stat-fill"
                              style={{ '--bar-width': `${Math.min(100, Math.round((stat.value / stat.max) * 100))}%` } as CSSProperties}
                            />
                          </span>
                          <strong>{stat.label === 'SPACE' ? `${stat.value}/50` : stat.value}</strong>
                        </span>
                      ))}
                    </div>
                    <div className="composition-buffs">
                      {composition.buffs.map((buff) => (
                        <span className="ability-note" key={buff}>{buff}</span>
                      ))}
                    </div>
                    <p className="composition-list">{qualityAdjustedUnits.map((unit) => unit.name).join(' + ')}</p>
                  </div>
                  <div className="recruit-actions">
                    <span>{totalCost}</span>
                    <button
                      disabled={!isCurrentTurn || Boolean(lockedUnit) || !canAfford || busyAction !== null}
                      onClick={() => runAction(`composition:${composition.id}`, () => onRecruitComposition(composition.id))}
                    >
                      {busyAction === `composition:${composition.id}` ? 'Recruiting...' : lockedUnit ? 'Locked' : 'Recruit'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'quality' && (
          <div className="recruit-list">
            {UNIT_ORDER.map((unitTypeId) => {
              const unit = UNIT_TYPES[unitTypeId];
              const unlocked = unlockedUnits.has(unitTypeId);
              const currentLevel = tile.base!.unitQualityByType?.[unitTypeId] ?? tile.base!.unitQualityLevel ?? 1;
              const nextQuality = UPGRADE_CONFIG.unitQuality.find((level) => level.level === currentLevel + 1);
              const qualityCost = nextQuality?.cost ? upgradeCostForPlayer(nextQuality.cost, player) : 0;
              const canAfford = qualityCost === 0 || player.supplies >= qualityCost;
              const requiredBarracksLevel =
                UPGRADE_CONFIG.barracks.find((level) => level.unlocks.includes(unitTypeId))?.level ?? 1;
              return (
                <div className={['recruit-row', !canAfford ? 'unaffordable' : ''].join(' ')} key={unitTypeId}>
                  <div>
                    <strong>
                      {unit.name} Quality L{currentLevel}
                      {!unlocked && <span className="lock-note">Requires Barracks L{requiredBarracksLevel}</span>}
                    </strong>
                    <p>
                      {nextQuality
                        ? `New ${unit.name} squads gain +${nextQuality.bonus} attack and defense.`
                        : `${unit.name} quality is maxed for this base.`}
                    </p>
                  </div>
                  <div className="recruit-actions">
                    <span>{nextQuality?.cost ? qualityCost : '-'}</span>
                    <button
                      disabled={!isCurrentTurn || !unlocked || !nextQuality?.cost || !canAfford || busyAction !== null}
                      onClick={() => runAction(`quality:${unitTypeId}`, () => onUpgrade(`quality:${unitTypeId}`))}
                    >
                      {busyAction === `quality:${unitTypeId}` ? 'Upgrading...' : nextQuality ? 'Upgrade' : 'Maxed'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'defense' && (
          <div className="recruit-list">
            <div
              className={[
                'recruit-row',
                'upgrade-row',
                nextDefense?.cost && player.supplies < upgradeCostForPlayer(nextDefense.cost, player) ? 'unaffordable' : '',
              ].join(' ')}
            >
              <div>
                <strong>{nextDefense ? `Upgrade Defense to L${nextDefense.level}` : 'Defense Maxed'}</strong>
                <p>
                  Current defense bonus is{' '}
                  {UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel)?.bonus ?? 0}.
                  {nextDefense ? ` Next bonus is ${nextDefense.bonus}.` : ' This base has maximum defenses.'}
                </p>
              </div>
              <div className="recruit-actions">
                <span>{nextDefense?.cost ? upgradeCostForPlayer(nextDefense.cost, player) : '-'}</span>
                <button
                  disabled={!isCurrentTurn || !nextDefense?.cost || busyAction !== null}
                  onClick={() => runAction('defense', () => onUpgrade('defense'))}
                >
                  {busyAction === 'defense' ? 'Upgrading...' : nextDefense ? 'Upgrade' : 'Maxed'}
                </button>
              </div>
            </div>
            <div
              className={[
                'recruit-row',
                'upgrade-row',
                'offense-upgrade-row',
                nextOffense?.cost && player.supplies < upgradeCostForPlayer(nextOffense.cost, player) ? 'unaffordable' : '',
              ].join(' ')}
            >
              <div>
                <strong>{nextOffense ? `Upgrade Sentry to L${nextOffense.level}` : 'Sentry Maxed'}</strong>
                <p>
                  {currentOffense && currentOffense.damage > 0
                    ? `${currentOffense.name}: automatically fires for ${currentOffense.damage * 10} damage at enemies ending movement within ${currentOffense.range} tiles and line of sight.`
                    : 'No offensive base sentry installed yet.'}
                  {nextOffense
                    ? ` Next: ${nextOffense.name}, range ${nextOffense.range}, ${nextOffense.damage * 10} damage.`
                    : ' This base has maximum sentry coverage.'}
                </p>
              </div>
              <div className="recruit-actions">
                <span>{nextOffense?.cost ? upgradeCostForPlayer(nextOffense.cost, player) : '-'}</span>
                <button
                  disabled={!isCurrentTurn || !nextOffense?.cost || busyAction !== null}
                  onClick={() => runAction('offense', () => onUpgrade('offense'))}
                >
                  {busyAction === 'offense' ? 'Upgrading...' : nextOffense ? 'Upgrade' : 'Maxed'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'artillery' && (
          <div className="recruit-list">
            <div
              className={[
                'recruit-row',
                'upgrade-row',
                nextBarracks?.cost && player.supplies < nextBarracksCost ? 'unaffordable' : '',
              ].join(' ')}
            >
              <div>
                <strong>
                  {isArtilleryUnlocked
                    ? `Artillery Command Online`
                    : nextBarracks
                      ? `Upgrade Barracks to L${nextBarracks.level}`
                      : 'Artillery Locked'}
                </strong>
                <p>
                  {isArtilleryUnlocked
                    ? 'Barracks L4 unlocks artillery strike planning from this base.'
                    : nextBarracks
                      ? barracksUpgradeDescription(nextBarracks.level, nextBarracksUnlocks)
                      : `Artillery requires Barracks L${ARTILLERY_UNLOCK_BARRACKS_LEVEL}.`}
                  {sharedBarracksLevel > tile.base.barracksLevel
                    ? ` Connected trenches share Barracks L${sharedBarracksLevel} here.`
                    : ''}
                </p>
              </div>
              <div className="recruit-actions">
                <span>{nextBarracks?.cost && !isArtilleryUnlocked ? nextBarracksCost : '-'}</span>
                <button
                  disabled={
                    isArtilleryUnlocked ||
                    !isCurrentTurn ||
                    !nextBarracks?.cost ||
                    player.supplies < nextBarracksCost ||
                    busyAction !== null
                  }
                  onClick={() => runAction('barracks', () => onUpgrade('barracks'))}
                >
                  {busyAction === 'barracks' ? 'Upgrading...' : isArtilleryUnlocked ? 'Ready' : 'Upgrade'}
                </button>
              </div>
            </div>

            {ARTILLERY_STRIKES.map((strike) => {
              const canAfford = player.supplies >= strike.cost;
              return (
                <div
                  className={['recruit-row', 'artillery-row', !isArtilleryUnlocked || !canAfford ? 'unaffordable' : ''].join(' ')}
                  key={strike.id}
                >
                  <div>
                    <strong>
                      {strike.name}
                      {!isArtilleryUnlocked && (
                        <span className="lock-note">Requires Barracks L{ARTILLERY_UNLOCK_BARRACKS_LEVEL}</span>
                      )}
                    </strong>
                    <p>{strike.description}</p>
                  </div>
                  <div className="recruit-actions">
                    <span>{strike.cost}</span>
                    <button disabled type="button">
                      Coming Soon
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function barracksUpgradeDescription(level: number, unlocks: string[]) {
  if (level >= ARTILLERY_UNLOCK_BARRACKS_LEVEL) return 'Unlocks Artillery squads and artillery strike planning.';
  if (unlocks.length === 0) return 'Expands this base with new command options.';
  return `Unlocks: ${unlocks.map((unitTypeId) => UNIT_TYPES[unitTypeId as UnitTypeId].name).join(', ')}.`;
}

function unitCostForPlayer(baseCost: number, player: PlayerDoc) {
  const productionDiscount = (player.talents.quartermaster ?? 0) * 0.05;
  return Math.max(1, Math.ceil(baseCost * (1 - productionDiscount)));
}

function upgradeCostForPlayer(baseCost: number, player: PlayerDoc) {
  const engineeringDiscount = (player.talents.quartermaster ?? 0) * 0.05;
  return Math.max(1, Math.ceil(baseCost * (1 - engineeringDiscount)));
}
