import { type CSSProperties, useState } from 'react';
import { UNIT_TYPES } from '../../data/unitTypes';
import { UNIT_COMPOSITIONS } from '../../data/unitCompositions';
import { MAX_ARTILLERY_UNITS, MAX_LOGISTICS_UNITS, UPGRADE_CONFIG } from '../../data/upgradeConfig';
import { ARTILLERY_SQUADS, ARTILLERY_UNLOCK_BARRACKS_LEVEL } from '../../data/artilleryConfig';
import type { ArmyDoc, PlayerDoc, TileDoc, UnitTypeId } from '../../types/gameTypes';
import { connectedBaseSupplyBonus, connectedBaseTiles, effectiveBarracksLevel, effectiveUnitQualityLevel } from '../../utils/trenchNetwork';

type BaseTab = 'barracks' | 'units' | 'defense';
type BaseUpgradeAction = 'barracks' | 'defense' | 'offense' | `quality:${UnitTypeId}`;

interface BaseModalProps {
  tile: TileDoc | null;
  tiles: TileDoc[];
  armies: ArmyDoc[];
  player: PlayerDoc;
  isCurrentTurn: boolean;
  hideQualityTab: boolean;
  onRecruit: (unitTypeId: UnitTypeId) => Promise<void>;
  onRecruitComposition: (compositionId: string) => Promise<void>;
  onUpgrade: (action: BaseUpgradeAction) => Promise<void>;
  onClose: () => void;
}

const ARTILLERY_UNIT_ORDER = ARTILLERY_SQUADS.map((squad) => squad.unitTypeId);
const UNIT_ORDER: UnitTypeId[] = ['gunman', 'builder', 'sniper', 'antiVehicle', 'tank', ...ARTILLERY_UNIT_ORDER];
const BARRACKS_RECRUIT_ORDER = UNIT_ORDER.filter((unitTypeId) => !ARTILLERY_UNIT_ORDER.includes(unitTypeId));
const SOLO_ONLY_UNITS = new Set<UnitTypeId>(['recon', 'builder', 'artillery', ...ARTILLERY_UNIT_ORDER]);
const QUALITY_HEALTH_BONUS_PER_LEVEL = 2;

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
  const [isBarracksUpgradePreviewed, setIsBarracksUpgradePreviewed] = useState(false);

  if (!tile?.base) return null;

  const sharedBarracksLevel = effectiveBarracksLevel(tile, tiles, armies);
  const connectedBases = connectedBaseTiles(tile, tiles, armies);
  const supplyLineBonus = connectedBaseSupplyBonus(tile, tiles, armies);
  const unlockedUnits = new Set<UnitTypeId>(
    UPGRADE_CONFIG.barracks
      .filter((level) => level.level <= sharedBarracksLevel)
      .flatMap((level) => level.unlocks as UnitTypeId[]),
  );
  const nextBarracks = UPGRADE_CONFIG.barracks.find((level) => level.level === tile.base!.barracksLevel + 1);
  const nextDefense = UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel + 1);
  const currentOffenseLevel = tile.base.offenseLevel ?? 1;
  const currentOffense = UPGRADE_CONFIG.baseOffense.find((level) => level.level === currentOffenseLevel);
  const nextOffense = UPGRADE_CONFIG.baseOffense.find((level) => level.level === currentOffenseLevel + 1);
  const defenseRequiresBarracks = Boolean(nextDefense && tile.base.barracksLevel < nextDefense.level);
  const offenseRequiresBarracks = Boolean(nextOffense && tile.base.barracksLevel < nextOffense.level);
  const nextBarracksCost = nextBarracks?.cost ? upgradeCostForPlayer(nextBarracks.cost, player) : 0;
  const nextBarracksUnlocks = nextBarracks?.unlocks ?? [];
  const logisticsInPlay = armies
    .filter((army) => army.ownerId === player.id)
    .reduce((total, army) => total + army.units.filter((unit) => unit.typeId === 'builder').length, 0);
  const artilleryInPlay = armies
    .filter((army) => army.ownerId === player.id)
    .reduce((total, army) => total + army.units.filter((unit) => ARTILLERY_UNIT_ORDER.includes(unit.typeId)).length, 0);

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
          <div className="base-tab-static active" role="heading" aria-level={3}>
            <span>Barracks</span>
            <span className="tab-level-badge">L{sharedBarracksLevel}</span>
          </div>
        </div>

        {activeTab === 'barracks' && (
          <div className="recruit-list barracks-recruit-grid">
            {BARRACKS_RECRUIT_ORDER.slice(0, 4).map((unitTypeId) => {
              const unit = UNIT_TYPES[unitTypeId];
              const cost = unitCostForPlayer(unit.cost, player);
              const unlocked = unlockedUnits.has(unitTypeId);
              const canAfford = player.supplies >= cost;
              const logisticsCapReached = unitTypeId === 'builder' && logisticsInPlay >= MAX_LOGISTICS_UNITS;
              const currentLevel = effectiveUnitQualityLevel(tile, unitTypeId, tiles, armies);
              const previewLevel = barracksPreviewLevel(isBarracksUpgradePreviewed, Boolean(nextBarracks), tile.base!.barracksLevel, unitTypeId, currentLevel);
              const qualityBonus = Math.max(0, currentLevel - 1);
              const qualityHealthBonus = qualityHealthBonusForUnit(unitTypeId, currentLevel);
              const previewQualityBonus = Math.max(0, previewLevel - 1);
              const previewQualityHealthBonus = qualityHealthBonusForUnit(unitTypeId, previewLevel);
              const requiredBarracksLevel =
                UPGRADE_CONFIG.barracks.find((level) => level.unlocks.includes(unitTypeId))?.level ?? 1;
              const unlockSource = unlockSourceForBarracksLevel(tile, connectedBases, requiredBarracksLevel);
              const actionBadges = barracksActionBadges(unitTypeId, currentLevel);
              const abilityDetails = [{ title: 'Overview', description: unit.description }, ...barracksAbilityDetails(unitTypeId)];
              const recruitStats = [
                { label: 'HP', value: unit.space + qualityHealthBonus, nextValue: unit.space + previewQualityHealthBonus, max: 24 },
                { label: 'ATK', value: unit.attack + qualityBonus, nextValue: unit.attack + previewQualityBonus, max: 8 },
                { label: 'DEF', value: unit.defense + qualityBonus, nextValue: unit.defense + previewQualityBonus, max: 8 },
              ];
              return (
                <div className={['recruit-row', 'split-upgrade-row', unlocked && (!canAfford || logisticsCapReached) ? 'unaffordable' : '', !unlocked ? 'locked-recruit-row' : ''].join(' ')} key={unitTypeId}>
                  <div className="recruit-unit-card">
                    {!unlocked && <span className="recruit-lock-banner">Requires Barracks L{requiredBarracksLevel}</span>}
                    <span className="ability-info-control" tabIndex={0} aria-label={`${unit.name} details`}>
                      i
                      <span className="ability-info-popover" role="tooltip">
                        {abilityDetails.map((detail) => (
                          <span key={detail.title}>
                            <strong>{detail.title}</strong>
                            {detail.description}
                          </span>
                        ))}
                      </span>
                    </span>
                    <div className="recruit-details">
                      <div className="recruit-copy">
                        <strong>
                          {unit.name}
                          <span className={`unit-level-badge compact-level-badge unit-level-${Math.min(3, currentLevel)}`} title={`Level ${currentLevel}`} aria-label={`Level ${currentLevel}`}>
                            LVL {currentLevel}
                          </span>
                          {SOLO_ONLY_UNITS.has(unitTypeId) && (
                            <span className="solo-note tooltip-note" tabIndex={0}>
                              Solo only
                              <span className="note-tooltip">This squad must stay alone and cannot join a unit.</span>
                            </span>
                          )}
                          {unlocked && unlockSource && <span className="source-note">From base at {unlockSource.x}, {unlockSource.y}</span>}
                          {logisticsCapReached && <span className="source-note">Max {MAX_LOGISTICS_UNITS} in play</span>}
                        </strong>
                      </div>
                      <span className="recruit-squad-preview" aria-hidden="true">
                        <span className={`unit-art unit-art-${unitTypeId}`} />
                      </span>
                      <div className="recruit-stat-bars" aria-label={`${unit.name} stats`}>
                        {recruitStats.map((stat) => (
                          <span className="recruit-stat-bar" key={stat.label}>
                            <span className="recruit-stat-label">{stat.label}</span>
                            <span className="recruit-stat-track">
                              {stat.nextValue > stat.value && (
                                <span
                                  className="recruit-stat-growth"
                                  style={
                                    {
                                      '--bar-left': `${Math.min(100, Math.round((stat.value / stat.max) * 100))}%`,
                                      '--bar-width': `${Math.max(0, Math.min(100, Math.round((stat.nextValue / stat.max) * 100)) - Math.min(100, Math.round((stat.value / stat.max) * 100)))}%`,
                                    } as CSSProperties
                                  }
                                />
                              )}
                              <span
                                className="recruit-stat-fill"
                                style={{ '--bar-width': `${Math.min(100, Math.round((stat.value / stat.max) * 100))}%` } as CSSProperties}
                              />
                            </span>
                            <strong>
                              {stat.value}
                              {stat.nextValue > stat.value && <em>+{stat.nextValue - stat.value}</em>}
                            </strong>
                          </span>
                        ))}
                      </div>
                      {actionBadges.length > 0 && (
                        <div className="recruit-ability-list" aria-label={`${unit.name} actions`}>
                          {actionBadges.map((action) => (
                            <span
                              className={[
                                'quiet-card-description',
                                'tooltip-note',
                                action.unlocked ? '' : 'locked-ability-note',
                              ].join(' ')}
                              key={action.label}
                              tabIndex={0}
                            >
                              {action.label}
                              <span className="note-tooltip">{action.tooltip}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="recruit-actions">
                      <span>{cost}</span>
                      <button
                        disabled={!isCurrentTurn || !unlocked || !canAfford || logisticsCapReached || busyAction !== null}
                        onClick={() => runAction(`recruit:${unitTypeId}`, () => onRecruit(unitTypeId))}
                      >
                        {busyAction === `recruit:${unitTypeId}` ? <span className="button-spinner" aria-label="Recruiting" /> : logisticsCapReached ? `Max ${MAX_LOGISTICS_UNITS}` : unlocked ? 'Recruit' : 'Locked'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className={['recruit-row', 'split-upgrade-row', 'base-upgrade-cell', 'base-defense-cell', nextDefense?.cost && player.supplies < upgradeCostForPlayer(nextDefense.cost, player) ? 'unaffordable' : ''].join(' ')}>
              <div className="recruit-unit-card base-upgrade-card">
                <div className="base-upgrade-card-copy">
                  <strong>
                    Base Defense
                    <span className="unit-level-badge compact-level-badge unit-level-1">LVL {tile.base.defenseLevel}</span>
                  </strong>
                  <p>
                    {nextDefense
                      ? defenseRequiresBarracks
                        ? `Requires Barracks L${nextDefense.level}.`
                        : `Next defense bonus: ${nextDefense.bonus}.`
                      : 'Maximum base defense reached.'}
                  </p>
                </div>
                <span className="base-upgrade-preview" aria-hidden="true">
                  <img src={baseArtForLevel(nextDefense?.level ?? tile.base.defenseLevel)} alt="" />
                </span>
                <div className="base-upgrade-card-stat">
                  <span className="recruit-stat-bar">
                    <span className="recruit-stat-label">DEF</span>
                    <span className="recruit-stat-track">
                      <span
                        className="recruit-stat-growth"
                        style={
                          {
                            '--bar-left': `${Math.min(100, ((UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel)?.bonus ?? 0) / 28) * 100)}%`,
                            '--bar-width': `${Math.max(0, Math.min(100, (((nextDefense?.bonus ?? (UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel)?.bonus ?? 0)) / 28) * 100)) - Math.min(100, ((UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel)?.bonus ?? 0) / 28) * 100))}%`,
                          } as CSSProperties
                        }
                      />
                      <span
                        className="recruit-stat-fill"
                        style={{ '--bar-width': `${Math.min(100, ((UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel)?.bonus ?? 0) / 28) * 100)}%` } as CSSProperties}
                      />
                    </span>
                    <strong>
                      {UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel)?.bonus ?? 0}
                      {nextDefense && (
                        <em>+{nextDefense.bonus - (UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel)?.bonus ?? 0)}</em>
                      )}
                    </strong>
                  </span>
                </div>
                <div className="recruit-actions">
                  <span>{nextDefense?.cost ? upgradeCostForPlayer(nextDefense.cost, player) : '-'}</span>
                  <button
                    disabled={!isCurrentTurn || !nextDefense?.cost || defenseRequiresBarracks || player.supplies < upgradeCostForPlayer(nextDefense.cost, player) || busyAction !== null}
                    onClick={() => runAction('defense', () => onUpgrade('defense'))}
                  >
                    {busyAction === 'defense' ? 'Upgrading...' : defenseRequiresBarracks ? `Barracks L${nextDefense?.level}` : nextDefense ? 'Upgrade' : 'Maxed'}
                  </button>
                </div>
              </div>
            </div>
            <div className={['recruit-row', 'split-upgrade-row', 'base-upgrade-cell', 'base-attack-cell', nextOffense?.cost && player.supplies < upgradeCostForPlayer(nextOffense.cost, player) ? 'unaffordable' : ''].join(' ')}>
              <div className="recruit-unit-card base-upgrade-card">
                <div className="base-upgrade-card-copy">
                  <strong>
                    Base Attack
                    <span className="unit-level-badge compact-level-badge unit-level-1">LVL {currentOffenseLevel}</span>
                  </strong>
                  <p>
                    {nextOffense
                      ? offenseRequiresBarracks
                        ? `Requires Barracks L${nextOffense.level}.`
                        : `Next sentry: range ${nextOffense.range}, ${nextOffense.damage * 10} damage.`
                      : 'Maximum base sentry reached.'}
                  </p>
                </div>
                <span className="base-upgrade-preview" aria-hidden="true">
                  <img src={baseArtForLevel(nextOffense?.level ?? currentOffenseLevel)} alt="" />
                </span>
                <div className="base-upgrade-card-stat">
                  <span className="recruit-stat-bar">
                    <span className="recruit-stat-label">ATK</span>
                    <span className="recruit-stat-track">
                      <span
                        className="recruit-stat-growth"
                        style={
                          {
                            '--bar-left': `${Math.min(100, (((currentOffense?.damage ?? 0) * 10) / 20) * 100)}%`,
                            '--bar-width': `${Math.max(0, Math.min(100, (((nextOffense?.damage ?? currentOffense?.damage ?? 0) * 10) / 20) * 100) - Math.min(100, (((currentOffense?.damage ?? 0) * 10) / 20) * 100))}%`,
                          } as CSSProperties
                        }
                      />
                      <span
                        className="recruit-stat-fill"
                        style={{ '--bar-width': `${Math.min(100, (((currentOffense?.damage ?? 0) * 10) / 20) * 100)}%` } as CSSProperties}
                      />
                    </span>
                    <strong>
                      {(currentOffense?.damage ?? 0) * 10}
                      {nextOffense && <em>+{(nextOffense.damage - (currentOffense?.damage ?? 0)) * 10}</em>}
                    </strong>
                  </span>
                </div>
                <div className="recruit-actions">
                  <span>{nextOffense?.cost ? upgradeCostForPlayer(nextOffense.cost, player) : '-'}</span>
                  <button
                    disabled={!isCurrentTurn || !nextOffense?.cost || offenseRequiresBarracks || player.supplies < upgradeCostForPlayer(nextOffense.cost, player) || busyAction !== null}
                    onClick={() => runAction('offense', () => onUpgrade('offense'))}
                  >
                    {busyAction === 'offense' ? 'Upgrading...' : offenseRequiresBarracks ? `Barracks L${nextOffense?.level}` : nextOffense ? 'Upgrade' : 'Maxed'}
                  </button>
                </div>
              </div>
            </div>
            {BARRACKS_RECRUIT_ORDER.slice(4).map((unitTypeId) => {
              const unit = UNIT_TYPES[unitTypeId];
              const cost = unitCostForPlayer(unit.cost, player);
              const unlocked = unlockedUnits.has(unitTypeId);
              const canAfford = player.supplies >= cost;
              const logisticsCapReached = unitTypeId === 'builder' && logisticsInPlay >= MAX_LOGISTICS_UNITS;
              const currentLevel = effectiveUnitQualityLevel(tile, unitTypeId, tiles, armies);
              const previewLevel = barracksPreviewLevel(isBarracksUpgradePreviewed, Boolean(nextBarracks), tile.base!.barracksLevel, unitTypeId, currentLevel);
              const qualityBonus = Math.max(0, currentLevel - 1);
              const qualityHealthBonus = qualityHealthBonusForUnit(unitTypeId, currentLevel);
              const previewQualityBonus = Math.max(0, previewLevel - 1);
              const previewQualityHealthBonus = qualityHealthBonusForUnit(unitTypeId, previewLevel);
              const requiredBarracksLevel =
                UPGRADE_CONFIG.barracks.find((level) => level.unlocks.includes(unitTypeId))?.level ?? 1;
              const unlockSource = unlockSourceForBarracksLevel(tile, connectedBases, requiredBarracksLevel);
              const actionBadges = barracksActionBadges(unitTypeId, currentLevel);
              const abilityDetails = [{ title: 'Overview', description: unit.description }, ...barracksAbilityDetails(unitTypeId)];
              const recruitStats = [
                { label: 'HP', value: unit.space + qualityHealthBonus, nextValue: unit.space + previewQualityHealthBonus, max: 24 },
                { label: 'ATK', value: unit.attack + qualityBonus, nextValue: unit.attack + previewQualityBonus, max: 8 },
                { label: 'DEF', value: unit.defense + qualityBonus, nextValue: unit.defense + previewQualityBonus, max: 8 },
              ];
              return (
                <div className={['recruit-row', 'split-upgrade-row', unlocked && (!canAfford || logisticsCapReached) ? 'unaffordable' : '', !unlocked ? 'locked-recruit-row' : ''].join(' ')} key={unitTypeId}>
                  <div className="recruit-unit-card">
                    {!unlocked && <span className="recruit-lock-banner">Requires Barracks L{requiredBarracksLevel}</span>}
                    <span className="ability-info-control" tabIndex={0} aria-label={`${unit.name} details`}>
                      i
                      <span className="ability-info-popover" role="tooltip">
                        {abilityDetails.map((detail) => (
                          <span key={detail.title}>
                            <strong>{detail.title}</strong>
                            {detail.description}
                          </span>
                        ))}
                      </span>
                    </span>
                    <div className="recruit-details">
                      <div className="recruit-copy">
                        <strong>
                          {unit.name}
                          <span className={`unit-level-badge compact-level-badge unit-level-${Math.min(3, currentLevel)}`} title={`Level ${currentLevel}`} aria-label={`Level ${currentLevel}`}>
                            LVL {currentLevel}
                          </span>
                          {SOLO_ONLY_UNITS.has(unitTypeId) && (
                            <span className="solo-note tooltip-note" tabIndex={0}>
                              Solo only
                              <span className="note-tooltip">This squad must stay alone and cannot join a unit.</span>
                            </span>
                          )}
                          {unlocked && unlockSource && <span className="source-note">From base at {unlockSource.x}, {unlockSource.y}</span>}
                          {logisticsCapReached && <span className="source-note">Max {MAX_LOGISTICS_UNITS} in play</span>}
                        </strong>
                      </div>
                      <span className="recruit-squad-preview" aria-hidden="true">
                        <span className={`unit-art unit-art-${unitTypeId}`} />
                      </span>
                      <div className="recruit-stat-bars" aria-label={`${unit.name} stats`}>
                        {recruitStats.map((stat) => (
                          <span className="recruit-stat-bar" key={stat.label}>
                            <span className="recruit-stat-label">{stat.label}</span>
                            <span className="recruit-stat-track">
                              {stat.nextValue > stat.value && (
                                <span
                                  className="recruit-stat-growth"
                                  style={
                                    {
                                      '--bar-left': `${Math.min(100, Math.round((stat.value / stat.max) * 100))}%`,
                                      '--bar-width': `${Math.max(0, Math.min(100, Math.round((stat.nextValue / stat.max) * 100)) - Math.min(100, Math.round((stat.value / stat.max) * 100)))}%`,
                                    } as CSSProperties
                                  }
                                />
                              )}
                              <span
                                className="recruit-stat-fill"
                                style={{ '--bar-width': `${Math.min(100, Math.round((stat.value / stat.max) * 100))}%` } as CSSProperties}
                              />
                            </span>
                            <strong>
                              {stat.value}
                              {stat.nextValue > stat.value && <em>+{stat.nextValue - stat.value}</em>}
                            </strong>
                          </span>
                        ))}
                      </div>
                      {actionBadges.length > 0 && (
                        <div className="recruit-ability-list" aria-label={`${unit.name} actions`}>
                          {actionBadges.map((action) => (
                            <span
                              className={[
                                'quiet-card-description',
                                'tooltip-note',
                                action.unlocked ? '' : 'locked-ability-note',
                              ].join(' ')}
                              key={action.label}
                              tabIndex={0}
                            >
                              {action.label}
                              <span className="note-tooltip">{action.tooltip}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="recruit-actions">
                      <span>{cost}</span>
                      <button
                        disabled={!isCurrentTurn || !unlocked || !canAfford || logisticsCapReached || busyAction !== null}
                        onClick={() => runAction(`recruit:${unitTypeId}`, () => onRecruit(unitTypeId))}
                      >
                        {busyAction === `recruit:${unitTypeId}` ? <span className="button-spinner" aria-label="Recruiting" /> : logisticsCapReached ? `Max ${MAX_LOGISTICS_UNITS}` : unlocked ? 'Recruit' : 'Locked'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {ARTILLERY_SQUADS.map((squad) =>
              renderArtilleryRecruitRow({
                squad,
                tile,
                tiles,
                armies,
                player,
                isCurrentTurn,
                unlockedUnits,
                connectedBases,
                artilleryInPlay,
                busyAction,
                runAction,
                onRecruit,
              }),
            )}
            <div className="barracks-footer-upgrade">
              <div className="barracks-footer-copy">
                <strong>{nextBarracks ? `Upgrade Barracks to L${nextBarracks.level}` : 'Barracks Maxed'}</strong>
                <span>
                  {nextBarracks
                    ? barracksUpgradeDescription(nextBarracks.level, nextBarracksUnlocks)
                    : 'This base can recruit every current squad type.'}
                  {sharedBarracksLevel > tile.base.barracksLevel ? ` Connected trenches share Barracks L${sharedBarracksLevel} here.` : ''}
                  {supplyLineBonus > 0 ? ` Supply line bonus: +${supplyLineBonus} supplies per turn.` : ''}
                </span>
              </div>
              <div className="recruit-actions">
                <span>{nextBarracks?.cost ? nextBarracksCost : '-'}</span>
                <button
                  disabled={!isCurrentTurn || !nextBarracks?.cost || player.supplies < nextBarracksCost || busyAction !== null}
                  onMouseEnter={() => setIsBarracksUpgradePreviewed(true)}
                  onMouseLeave={() => setIsBarracksUpgradePreviewed(false)}
                  onFocus={() => setIsBarracksUpgradePreviewed(true)}
                  onBlur={() => setIsBarracksUpgradePreviewed(false)}
                  onClick={() => runAction('barracks', () => onUpgrade('barracks'))}
                >
                  {busyAction === 'barracks' ? 'Upgrading...' : nextBarracks ? 'Upgrade Barracks' : 'Maxed'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'units' && (
          <div className="recruit-list">
            {UNIT_COMPOSITIONS.map((composition) => {
              const qualityAdjustedUnits = composition.units.map((unitTypeId) => {
                const currentLevel = effectiveUnitQualityLevel(tile, unitTypeId, tiles, armies);
                const qualityBonus = Math.max(0, currentLevel - 1);
                const qualityHealthBonus = qualityHealthBonusForUnit(unitTypeId, currentLevel);
                const unit = UNIT_TYPES[unitTypeId];
                return {
                  unitTypeId,
                  name: unit.name,
                  attack: unit.attack + qualityBonus,
                  defense: unit.defense + qualityBonus,
                  health: unit.space + qualityHealthBonus,
                  space: unit.space,
                  unlocked: unlockedUnits.has(unitTypeId),
                  requiredBarracksLevel: UPGRADE_CONFIG.barracks.find((level) => level.unlocks.includes(unitTypeId))?.level ?? 1,
                  unlockSource: unlockSourceForBarracksLevel(tile, connectedBases, UPGRADE_CONFIG.barracks.find((level) => level.unlocks.includes(unitTypeId))?.level ?? 1),
                  cost: unitCostForPlayer(unit.cost, player),
                };
              });
              const lockedUnit = qualityAdjustedUnits.find((unit) => !unit.unlocked);
              const networkUnlockSource = qualityAdjustedUnits.find((unit) => unit.unlocked && unit.unlockSource)?.unlockSource ?? null;
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
                        {!lockedUnit && networkUnlockSource && <span className="source-note">From base at {networkUnlockSource.x}, {networkUnlockSource.y}</span>}
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
                      {busyAction === `composition:${composition.id}` ? (
                        <span className="button-spinner" aria-label="Recruiting" />
                      ) : lockedUnit ? (
                        'Locked'
                      ) : (
                        'Recruit'
                      )}
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
                    ? `${currentOffense.name}: automatically fires for ${currentOffense.damage * 10} damage at enemies moving within ${currentOffense.range} tiles and line of sight.`
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

      </section>
    </div>
  );
}

function barracksUpgradeDescription(level: number, unlocks: string[]) {
  if (level >= ARTILLERY_UNLOCK_BARRACKS_LEVEL) return 'Unlocks Artillery squads and artillery strike planning.';
  if (unlocks.length === 0) return 'Expands this base with new command options.';
  return `Unlocks: ${unlocks.map((unitTypeId) => UNIT_TYPES[unitTypeId as UnitTypeId].name).join(', ')}.`;
}

function unlockSourceForBarracksLevel(currentBaseTile: TileDoc, connectedBases: TileDoc[], requiredBarracksLevel: number) {
  if ((currentBaseTile.base?.barracksLevel ?? 1) >= requiredBarracksLevel) return null;
  return (
    connectedBases
      .filter((baseTile) => baseTile.id !== currentBaseTile.id && (baseTile.base?.barracksLevel ?? 1) >= requiredBarracksLevel)
      .sort((a, b) => (b.base?.barracksLevel ?? 1) - (a.base?.barracksLevel ?? 1))[0] ?? null
  );
}

function baseArtForLevel(level: number) {
  if (level <= 1) return '/sprites/base-default.png';
  return `/sprites/base_lvl${Math.min(5, level)}.png`;
}

function barracksPreviewLevel(isPreviewed: boolean, hasNextBarracks: boolean, barracksLevel: number, unitTypeId: UnitTypeId, currentLevel: number) {
  if (!isPreviewed || !hasNextBarracks || currentLevel >= 3) return currentLevel;
  if (!isUnitUnlockedAtBarracksLevel(unitTypeId, barracksLevel)) return currentLevel;
  return Math.min(3, currentLevel + 1);
}

function isUnitUnlockedAtBarracksLevel(unitTypeId: UnitTypeId, barracksLevel: number) {
  return UPGRADE_CONFIG.barracks
    .filter((level) => level.level <= barracksLevel)
    .flatMap((level) => level.unlocks as UnitTypeId[])
    .includes(unitTypeId);
}

function renderArtilleryRecruitRow({
  squad,
  tile,
  tiles,
  armies,
  player,
  isCurrentTurn,
  unlockedUnits,
  connectedBases,
  artilleryInPlay,
  busyAction,
  runAction,
  onRecruit,
}: {
  squad: (typeof ARTILLERY_SQUADS)[number];
  tile: TileDoc;
  tiles: TileDoc[];
  armies: ArmyDoc[];
  player: PlayerDoc;
  isCurrentTurn: boolean;
  unlockedUnits: Set<UnitTypeId>;
  connectedBases: TileDoc[];
  artilleryInPlay: number;
  busyAction: string | null;
  runAction: (actionId: string, action: () => Promise<void>) => Promise<void>;
  onRecruit: (unitTypeId: UnitTypeId) => Promise<void>;
}) {
  const unitTypeId = squad.unitTypeId;
  const unit = UNIT_TYPES[unitTypeId];
  const cost = unitCostForPlayer(unit.cost, player);
  const unlocked = unlockedUnits.has(unitTypeId);
  const canAfford = player.supplies >= cost;
  const artilleryCapReached = artilleryInPlay >= MAX_ARTILLERY_UNITS;
  const currentLevel = effectiveUnitQualityLevel(tile, unitTypeId, tiles, armies);
  const qualityBonus = Math.max(0, currentLevel - 1);
  const requiredBarracksLevel = UPGRADE_CONFIG.barracks.find((level) => level.unlocks.includes(unitTypeId))?.level ?? ARTILLERY_UNLOCK_BARRACKS_LEVEL;
  const unlockSource = unlockSourceForBarracksLevel(tile, connectedBases, requiredBarracksLevel);
  const recruitStats = [
    { label: 'HP', value: unit.space, max: 20 },
    { label: 'ATK', value: unit.attack + qualityBonus, max: 8 },
    { label: 'DEF', value: unit.defense + qualityBonus, max: 8 },
  ];
  const abilityDetails = [
    { title: 'Overview', description: squad.description },
    { title: squad.ability, description: 'Special artillery role for this squad.' },
  ];

  return (
    <div className={['recruit-row', 'artillery-recruit-row', 'split-upgrade-row', unlocked && (!canAfford || artilleryCapReached) ? 'unaffordable' : '', !unlocked ? 'locked-recruit-row' : ''].join(' ')} key={squad.id}>
      <div className="recruit-unit-card">
        {!unlocked && <span className="recruit-lock-banner">Requires Barracks L{requiredBarracksLevel}</span>}
        <span className="ability-info-control" tabIndex={0} aria-label={`${unit.name} details`}>
          i
          <span className="ability-info-popover" role="tooltip">
            {abilityDetails.map((detail) => (
              <span key={detail.title}>
                <strong>{detail.title}</strong>
                {detail.description}
              </span>
            ))}
          </span>
        </span>
        <div className="recruit-details">
          <div className="recruit-copy">
            <strong>
              {unit.name}
              <span className={`unit-level-badge compact-level-badge unit-level-${Math.min(3, currentLevel)}`} title={`Level ${currentLevel}`} aria-label={`Level ${currentLevel}`}>
                LVL {currentLevel}
              </span>
              <span className="solo-note tooltip-note" tabIndex={0}>
                Solo only
                <span className="note-tooltip">This squad must stay alone and cannot join a unit.</span>
              </span>
              <span className="ability-note">Range 6</span>
              {unlocked && unlockSource && <span className="source-note">From base at {unlockSource.x}, {unlockSource.y}</span>}
              {artilleryCapReached && <span className="source-note">Max {MAX_ARTILLERY_UNITS} in play</span>}
            </strong>
          </div>
          <span className="recruit-squad-preview" aria-hidden="true">
            <span className={`unit-art unit-art-${unitTypeId}`} />
          </span>
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
          <div className="artillery-buff-list">
            <span className="quiet-card-description">{squad.ability}</span>
          </div>
        </div>
        <div className="recruit-actions">
          <span>{cost}</span>
          <button
            disabled={!isCurrentTurn || !unlocked || !canAfford || artilleryCapReached || busyAction !== null}
            onClick={() => runAction(`recruit:${unitTypeId}`, () => onRecruit(unitTypeId))}
          >
            {busyAction === `recruit:${unitTypeId}` ? <span className="button-spinner" aria-label="Recruiting" /> : artilleryCapReached ? `Max ${MAX_ARTILLERY_UNITS}` : unlocked ? 'Recruit' : 'Locked'}
          </button>
        </div>
      </div>
    </div>
  );
}

function renderQualityUpgradeCard({
  unitName,
  unitTypeId,
  baseHealth,
  baseAttack,
  baseDefense,
  includeHealthGrowth,
  localLevel,
  nextQuality,
  qualityCost,
  canAffordQuality,
  unlocked,
  isCurrentTurn,
  busyAction,
  runAction,
  onUpgrade,
}: {
  unitName: string;
  unitTypeId: UnitTypeId;
  baseHealth: number;
  baseAttack: number;
  baseDefense: number;
  includeHealthGrowth: boolean;
  localLevel: number;
  nextQuality: (typeof UPGRADE_CONFIG.unitQuality)[number] | undefined;
  qualityCost: number;
  canAffordQuality: boolean;
  unlocked: boolean;
  isCurrentTurn: boolean;
  busyAction: string | null;
  runAction: (actionId: string, action: () => Promise<void>) => Promise<void>;
  onUpgrade: (action: BaseUpgradeAction) => Promise<void>;
}) {
  const currentQuality = UPGRADE_CONFIG.unitQuality.find((level) => level.level === localLevel);
  const currentBonus = currentQuality?.bonus ?? Math.max(0, localLevel - 1);
  const nextBonus = nextQuality?.bonus ?? currentBonus;
  const currentHealthBonus = includeHealthGrowth ? currentBonus * QUALITY_HEALTH_BONUS_PER_LEVEL : 0;
  const nextHealthBonus = includeHealthGrowth ? nextBonus * QUALITY_HEALTH_BONUS_PER_LEVEL : 0;
  const nextAbilityUnlock = nextQuality ? logisticsQualityUnlock(unitTypeId, localLevel + 1) : '';
  const upgradeStats = [
    { label: 'HP', current: baseHealth + currentHealthBonus, next: baseHealth + nextHealthBonus, max: 24 },
    { label: 'ATK', current: baseAttack + currentBonus, next: baseAttack + nextBonus, max: 10 },
    { label: 'DEF', current: baseDefense + currentBonus, next: baseDefense + nextBonus, max: 10 },
  ];

  return (
    <div className={['quality-upgrade-card', !nextQuality || !canAffordQuality ? 'unaffordable' : ''].join(' ')}>
      <div className="quality-upgrade-details">
        <strong>{nextQuality ? `Upgrade ${unitName}` : `${unitName} Maxed`}</strong>
        <div className="quality-upgrade-bars" aria-label={`${unitName} quality stat increase`}>
          {upgradeStats.map((stat) => {
            const currentWidth = Math.min(100, Math.round((stat.current / stat.max) * 100));
            const nextWidth = Math.min(100, Math.round((stat.next / stat.max) * 100));
            const growthDelta = Math.max(0, stat.next - stat.current);
            return (
              <span className="quality-upgrade-bar" key={stat.label}>
                <span className="quality-upgrade-label">{stat.label}</span>
                <span className="quality-upgrade-track">
                  <span className="quality-upgrade-current" style={{ '--bar-width': `${currentWidth}%` } as CSSProperties} />
                  {growthDelta > 0 && (
                    <span
                      className="quality-upgrade-growth"
                      style={
                        {
                          '--bar-left': `${currentWidth}%`,
                          '--bar-width': `${Math.max(0, nextWidth - currentWidth)}%`,
                        } as CSSProperties
                      }
                    />
                  )}
                </span>
                <strong>
                  {stat.current}
                  {growthDelta > 0 && <em>+{growthDelta}</em>}
                </strong>
              </span>
            );
          })}
        </div>
        <div className="quality-upgrade-unlocks">
          {nextAbilityUnlock ? (
            <span>{nextAbilityUnlock.replace('New skill: ', '')}</span>
          ) : (
            <span />
          )}
        </div>
        <div className="quality-upgrade-action">
          <span>{nextQuality?.cost ? qualityCost : '-'}</span>
          <button
            disabled={!isCurrentTurn || !unlocked || !nextQuality?.cost || !canAffordQuality || busyAction !== null}
            onClick={() => runAction(`quality:${unitTypeId}`, () => onUpgrade(`quality:${unitTypeId}`))}
          >
            {busyAction === `quality:${unitTypeId}` ? 'Upgrading...' : nextQuality ? `Upgrade L${localLevel + 1}` : 'Maxed'}
          </button>
        </div>
      </div>
    </div>
  );
}

function logisticsQualityUnlock(unitTypeId: UnitTypeId, nextLevel: number) {
  if (unitTypeId !== 'builder') return '';
  if (nextLevel === 2) return 'New skill: Logistics L2 can build trenches.';
  if (nextLevel === 3) return 'New skill: Logistics L3 can scavenge supplies.';
  return '';
}

function barracksActionBadges(unitTypeId: UnitTypeId, currentLevel: number) {
  if (unitTypeId === 'medic') {
    return [
      {
        label: 'Action: Heal',
        unlocked: true,
        tooltip: 'Spends this unit turn for a larger immediate heal. Passive healing will not also trigger for that unit.',
      },
    ];
  }
  if (unitTypeId === 'antiVehicle') {
    return [
      {
        label: 'Action: Deploy Mine',
        unlocked: true,
        tooltip: 'Places a visible mine on this tile. Enemy Tanks take heavy damage when crossing it.',
      },
    ];
  }
  if (unitTypeId === 'builder') {
    return [
      {
        label: 'Action: Build Base',
        unlocked: currentLevel >= 1,
        tooltip: 'Creates a new base on this tile and consumes the Logistics squad.',
      },
      {
        label: 'L2 Action: Build Trench',
        unlocked: currentLevel >= 2,
        tooltip: 'Builds a trench on this tile without consuming the Logistics squad.',
      },
      {
        label: 'L3 Action: Scavenge',
        unlocked: currentLevel >= 3,
        tooltip: 'Spends this unit action to gain supplies.',
      },
    ];
  }
  return [];
}

function barracksAbilityDetails(unitTypeId: UnitTypeId) {
  if (unitTypeId === 'recon') {
    return [
      {
        title: 'Scout',
        description: 'Moves farther than standard squads and reveals a larger fog-of-war radius.',
      },
    ];
  }
  if (unitTypeId === 'medic') {
    return [
      {
        title: 'Passive Heal',
        description: 'Heals its unit at the end of the round if it did not use active healing.',
      },
      {
        title: 'Action: Heal',
        description: 'Spends the unit turn for a larger immediate heal.',
      },
    ];
  }
  if (unitTypeId === 'antiVehicle') {
    return [
      {
        title: 'Tank Hunter',
        description: 'Deals bonus damage when attacking units that contain Tanks.',
      },
      {
        title: 'Action: Deploy Mine',
        description: 'Places a visible mine on its tile. Enemy Tanks take heavy damage when crossing it.',
      },
    ];
  }
  if (unitTypeId === 'builder') {
    return [
      {
        title: 'L1: Build Base',
        description: 'Creates a new base and consumes the Logistics squad.',
      },
      {
        title: 'L2: Build Trench',
        description: 'Builds a trench without consuming the Logistics squad.',
      },
      {
        title: 'L3: Scavenge',
        description: 'Spends its action to gain supplies.',
      },
    ];
  }
  return [];
}

function qualityHealthBonusForUnit(unitTypeId: UnitTypeId, qualityLevel: number) {
  if (ARTILLERY_UNIT_ORDER.includes(unitTypeId)) return 0;
  return Math.max(0, qualityLevel - 1) * QUALITY_HEALTH_BONUS_PER_LEVEL;
}

function unitCostForPlayer(baseCost: number, player: PlayerDoc) {
  const productionDiscount = (player.talents.quartermaster ?? 0) * 0.05;
  return Math.max(1, Math.ceil(baseCost * (1 - productionDiscount)));
}

function upgradeCostForPlayer(baseCost: number, player: PlayerDoc) {
  const engineeringDiscount = (player.talents.quartermaster ?? 0) * 0.05;
  return Math.max(1, Math.ceil(baseCost * (1 - engineeringDiscount)));
}
