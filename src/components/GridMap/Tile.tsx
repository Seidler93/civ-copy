import type { CSSProperties } from 'react';
import type { OwnerTileColorMode, UnitHealthBarPosition, UnitStatDisplayMode, UnitStatLabelMode } from '../../App';
import type { ArmyDoc, MoveOrderMode, PlayerDoc, TileDoc } from '../../types/gameTypes';
import { BUILD_BASE_COST, BUILD_TRENCH_COST, UPGRADE_CONFIG } from '../../data/upgradeConfig';
import { armyHealthPercent, armyPower } from '../../utils/combat';

interface FloatingCombatText {
  id: string;
  tileId: string;
  text: string;
  tone: 'damage' | 'status';
}

interface MoveAnimation {
  id: string;
  tileId: string;
  fromX: number;
  fromY: number;
  durationMs: number;
}

interface TileProps {
  tile: TileDoc;
  army: ArmyDoc | null;
  owner: PlayerDoc | null;
  armyOwner: PlayerDoc | null;
  mineOwner: PlayerDoc | null;
  unitTileOwnerTintEnabled: boolean;
  unitTileOwnerTintIntensity: number;
  unitTileOwnerColorMode: OwnerTileColorMode;
  unitTileOwnerSolidIntensity: number;
  unitOwnerBarEnabled: boolean;
  unitStatDisplayMode: UnitStatDisplayMode;
  unitHealthBarPosition: UnitHealthBarPosition;
  unitDefenseValueVisible: boolean;
  unitStatLabelMode: UnitStatLabelMode;
  isCompactZoom: boolean;
  sentryCoverageColor: string | null;
  isFogged: boolean;
  isExploredButNotVisible: boolean;
  actionRemaining: boolean | null;
  hasBaseDefenseBuff: boolean;
  hasConnectedBaseNetwork: boolean;
  trenchConnections: {
    north: boolean;
    east: boolean;
    south: boolean;
    west: boolean;
  };
  isSelected: boolean;
  isReachable: boolean;
  isAttackRadius: boolean;
  isAttackable: boolean;
  isSmokeTarget: boolean;
  isSmokePreview: boolean;
  isAttackTarget: boolean;
  isMergeable: boolean;
  isMergeTarget: boolean;
  showActionTray: boolean;
  combatTexts: FloatingCombatText[];
  moveAnimation: MoveAnimation | null;
  attackFacingAngle: number | null;
  hasArtilleryImpact: boolean;
  queuedMoveTurns: number | null;
  queuedMoveMode: MoveOrderMode | null;
  onClick: () => void;
  onHover?: () => void;
  onOpenActions?: () => void;
  onCancelSmokeTargeting?: () => void;
  onAttackClick?: () => void;
  onCombineClick?: () => void;
  onBuildTrenchClick?: () => void;
  onBuildBaseClick?: () => void;
  onReclaimBaseClick?: () => void;
  onScavengeClick?: () => void;
  onHealClick?: () => void;
  onPlaceMineClick?: () => void;
  onSmokeScreenClick?: () => void;
  onFortifyClick?: () => void;
  onSetAggressiveClick?: () => void;
  onSetPassiveClick?: () => void;
  onClearMoveOrderClick?: () => void;
  onBaseClick?: () => void;
}

export default function Tile({
  tile,
  army,
  owner,
  armyOwner,
  mineOwner,
  unitTileOwnerTintEnabled,
  unitTileOwnerTintIntensity,
  unitTileOwnerColorMode,
  unitTileOwnerSolidIntensity,
  unitOwnerBarEnabled,
  unitStatDisplayMode,
  unitHealthBarPosition,
  unitDefenseValueVisible,
  unitStatLabelMode,
  isCompactZoom,
  sentryCoverageColor,
  isFogged,
  isExploredButNotVisible,
  actionRemaining,
  hasBaseDefenseBuff,
  hasConnectedBaseNetwork,
  trenchConnections,
  isSelected,
  isReachable,
  isAttackRadius,
  isAttackable,
  isSmokeTarget,
  isSmokePreview,
  isAttackTarget,
  isMergeable,
  isMergeTarget,
  showActionTray,
  combatTexts,
  moveAnimation,
  attackFacingAngle,
  hasArtilleryImpact,
  queuedMoveTurns,
  queuedMoveMode,
  onClick,
  onHover,
  onOpenActions,
  onCancelSmokeTargeting,
  onAttackClick,
  onCombineClick,
  onBuildTrenchClick,
  onBuildBaseClick,
  onReclaimBaseClick,
  onScavengeClick,
  onHealClick,
  onPlaceMineClick,
  onSmokeScreenClick,
  onFortifyClick,
  onSetAggressiveClick,
  onSetPassiveClick,
  onClearMoveOrderClick,
  onBaseClick,
}: TileProps) {
  const showContents = !isFogged;
  const hasOwnershipTintTarget = Boolean(showContents && unitTileOwnerTintEnabled && (army || (tile.base && !tile.base.ruined)));
  const baseDefense = showContents && tile.base
    ? UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel)?.bonus ?? 0
    : 0;
  const baseAttack = showContents && tile.base
    ? (UPGRADE_CONFIG.baseOffense.find((level) => level.level === (tile.base!.offenseLevel ?? 1))?.damage ?? 0) * 10
    : 0;
  const baseQualityLevel = tile.base
    ? Math.max(tile.base.unitQualityLevel ?? 1, ...Object.values(tile.base.unitQualityByType ?? {}).map((level) => level ?? 1))
    : 1;
  const trenchOrientation =
    (trenchConnections.north || trenchConnections.south) && !trenchConnections.east && !trenchConnections.west
      ? 'vertical'
      : 'horizontal';
  const baseLevelClass = tile.base ? `base-marker-lvl${Math.min(5, Math.max(1, tile.base.barracksLevel ?? 1))}` : '';
  const grassVariantClass = tile.terrainType === 'plains' ? `grass-variant-${((tile.x * 7 + tile.y * 11) % 3) + 1}` : '';
  const grassRotationClass = tile.terrainType === 'plains' ? `grass-rot-${((tile.x * 5 + tile.y * 13) % 4) * 90}` : '';
  const darkGrassVariantClass = tile.terrainType === 'forest' ? `darkgrass-variant-${((tile.x * 5 + tile.y * 9) % 2) + 1}` : '';
  const darkGrassRotationClass = tile.terrainType === 'forest' ? `darkgrass-rot-${((tile.x * 13 + tile.y * 3) % 4) * 90}` : '';
  const dirtVariantClass = tile.terrainType === 'hill' ? `dirt-variant-${((tile.x * 11 + tile.y * 7) % 2) + 1}` : '';
  const dirtRotationClass = tile.terrainType === 'hill' ? `dirt-rot-${((tile.x * 17 + tile.y * 5) % 4) * 90}` : '';
  const waterVariantClass = tile.terrainType === 'water' ? `water-variant-${((tile.x * 3 + tile.y * 7) % 2) + 1}` : '';
  const waterRotationClass = tile.terrainType === 'water' ? `water-rot-${((tile.x * 11 + tile.y * 5) % 4) * 90}` : '';
  const armyHealth = army ? armyHealthPercent(army.units) : 0;
  const armyHealthTone = armyHealth < 35 ? 'danger' : armyHealth <= 60 ? 'warning' : 'healthy';
  const armyAttackPower = army ? armyPower(army.units, 'attack') : 0;
  const armyDefensePower = army ? armyPower(army.units, 'defense') : 0;
  const attackLabel = unitStatLabelMode === 'icons' ? '⚔' : 'A';
  const defenseLabel = unitStatLabelMode === 'icons' ? '🛡' : 'D';
  const showIconLabels = unitStatLabelMode === 'icons';
  const renderStatValue = (label: string, value: number, tone: 'attack' | 'defense') => (
    <>
      <span className={showIconLabels ? `army-stat-icon army-stat-icon-${tone}` : ''}>{label}</span>
      <span className="army-stat-value">{value}</span>
    </>
  );
  const showTopHealthDisplay = unitHealthBarPosition === 'top';
  const showBarStats = unitStatDisplayMode === 'bar';
  const shouldMoveTopHealthBelowStats = showTopHealthDisplay && showBarStats && isCompactZoom;
  const healthBarMarkup = (
    <span className={`unit-hp-bar unit-hp-bar-${armyHealthTone}`} aria-label={`${armyHealth} percent health`}>
      <span style={{ width: `${armyHealth}%` }} />
    </span>
  );
  const healthDisplayMarkup = showBarStats ? (
    <span className={['army-topline', shouldMoveTopHealthBelowStats ? 'army-topline-health-below' : ''].join(' ')} aria-hidden="true">
      {!shouldMoveTopHealthBelowStats && healthBarMarkup}
      <span className="army-stat-pill" title={unitDefenseValueVisible ? 'Attack and defense power' : 'Attack power'}>
        <span className="army-top-stat army-top-stat-attack">{renderStatValue(attackLabel, armyAttackPower, 'attack')}</span>
        {unitDefenseValueVisible ? <span className="army-stat-pill-divider" aria-hidden="true" /> : null}
        {unitDefenseValueVisible ? (
          <span className="army-top-stat army-top-stat-defense">{renderStatValue(defenseLabel, armyDefensePower, 'defense')}</span>
        ) : null}
      </span>
      {shouldMoveTopHealthBelowStats && healthBarMarkup}
    </span>
  ) : (
    healthBarMarkup
  );
  const actionButtons = [
    onAttackClick ? { label: 'Attack', className: 'attack-action', onClick: onAttackClick } : null,
    onCombineClick ? { label: 'Combine', className: 'combine-action', onClick: onCombineClick } : null,
    onBuildTrenchClick
      ? {
          label: 'Build Trench',
          className: 'trench-action',
          onClick: onBuildTrenchClick,
          tooltip: `Cost: ${BUILD_TRENCH_COST} supplies. Adds trench attack/defense bonuses on this tile.`,
        }
      : null,
    onBuildBaseClick
      ? {
          label: 'Build Base',
          className: 'build-action',
          onClick: onBuildBaseClick,
          tooltip: `Cost: ${BUILD_BASE_COST} supplies. Consumes this Logistics squad.`,
        }
      : null,
    onReclaimBaseClick ? { label: 'Reclaim Base', className: 'build-action', onClick: onReclaimBaseClick } : null,
    onScavengeClick ? { label: 'Scavenge', className: 'scavenge-action', onClick: onScavengeClick } : null,
    onHealClick ? { label: 'Heal', className: 'heal-action', onClick: onHealClick } : null,
    onPlaceMineClick ? { label: 'Mine', className: 'mine-action', onClick: onPlaceMineClick } : null,
    onSmokeScreenClick ? { label: 'Smoke Screen', className: 'smoke-action', onClick: onSmokeScreenClick } : null,
    onFortifyClick ? { label: 'Fortify', className: 'fortify-action', onClick: onFortifyClick } : null,
    onSetAggressiveClick
      ? {
          label: 'Aggressive',
          className: queuedMoveMode === 'aggressive' ? 'order-action active-order-action' : 'order-action',
          onClick: onSetAggressiveClick,
          tooltip: 'Aggressive: auto-attacks enemies in range before or after moving.',
        }
      : null,
    onSetPassiveClick
      ? {
          label: 'Passive',
          className: queuedMoveMode === 'passive' ? 'order-action active-order-action' : 'order-action',
          onClick: onSetPassiveClick,
          tooltip: 'Passive: keeps marching to the destination and ignores attack opportunities.',
        }
      : null,
    onClearMoveOrderClick
      ? {
          label: 'Clear Order',
          className: 'order-clear-action',
          onClick: onClearMoveOrderClick,
        }
      : null,
  ].filter((action): action is { label: string; className: string; onClick: () => void; tooltip?: string } => action !== null);

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'tile',
        `terrain-${tile.terrainType}`,
        grassVariantClass,
        grassRotationClass,
        darkGrassVariantClass,
        darkGrassRotationClass,
        dirtVariantClass,
        dirtRotationClass,
        waterVariantClass,
        waterRotationClass,
        army ? 'has-army' : '',
        showActionTray && actionButtons.length > 0 ? 'has-action-tray' : '',
        isFogged ? 'fogged' : '',
        isExploredButNotVisible ? 'scouted' : '',
        army && actionRemaining ? 'action-ready' : '',
        hasOwnershipTintTarget ? 'owner-tinted' : '',
        hasOwnershipTintTarget && unitTileOwnerColorMode === 'solid' ? 'owner-solid' : '',
        army && hasBaseDefenseBuff ? 'base-defense-buffed-army' : '',
        isSelected ? 'selected' : '',
        isReachable ? 'reachable' : '',
        isAttackRadius ? 'attack-radius' : '',
        isAttackable ? 'attackable' : '',
        isSmokeTarget ? 'smoke-target' : '',
        isSmokePreview ? 'smoke-preview' : '',
        isAttackTarget ? 'attack-target' : '',
        isMergeable ? 'mergeable' : '',
        isMergeTarget ? 'merge-target' : '',
        tile.base?.ruined ? 'ruined-base-tile' : '',
        queuedMoveTurns ? 'queued-destination' : '',
      ].join(' ')}
      onClick={onClick}
      onMouseEnter={onHover}
      onContextMenu={(event) => {
        if (onCancelSmokeTargeting) {
          event.preventDefault();
          event.stopPropagation();
          onCancelSmokeTargeting();
          return;
        }
        if (!army || !onOpenActions) return;
        event.preventDefault();
        event.stopPropagation();
        onOpenActions();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick();
      }}
      title={isFogged ? `${tile.x}, ${tile.y} fog of war` : `${tile.x}, ${tile.y} ${tile.terrainType}`}
      style={{
        borderColor:
          showContents && tile.base
            ? tile.base.ruined
              ? 'rgba(146, 149, 156, 0.88)'
              : owner?.color ?? 'rgba(255,255,255,0.16)'
            : 'rgba(255,255,255,0.16)',
        '--unit-owner-color': armyOwner?.color ?? (tile.base ? owner?.color : null) ?? 'transparent',
        '--mine-owner-color': mineOwner?.color ?? '#f0c95d',
        '--sentry-coverage-color': sentryCoverageColor ?? 'transparent',
        '--unit-owner-tint': `${unitTileOwnerTintIntensity}%`,
        '--unit-owner-solid': `${unitTileOwnerSolidIntensity}%`,
      } as CSSProperties}
    >
      {showContents && sentryCoverageColor && <span className="sentry-coverage" aria-hidden="true" />}
      {hasOwnershipTintTarget && unitTileOwnerColorMode === 'overlay' && (
        <span className="unit-owner-tint" aria-hidden="true" />
      )}
      {showContents && isSelected && <span className="tile-highlight selected-highlight" aria-hidden="true" />}
      {showContents && isReachable && <span className="tile-highlight movement-highlight" aria-hidden="true" />}
      {showContents && isAttackRadius && <span className="tile-highlight attack-radius-highlight" aria-hidden="true" />}
      {showContents && isAttackable && <span className="tile-highlight attackable-highlight" aria-hidden="true" />}
      {showContents && isMergeable && <span className="tile-highlight merge-highlight" aria-hidden="true" />}
      {showContents && tile.base && onBaseClick && (
        <button
          className={`base-marker ${baseLevelClass}`}
          style={{ '--base-color': tile.base.ruined ? '#8f949c' : owner?.color ?? '#f0c95d' } as CSSProperties}
          onClick={(event) => {
            event.stopPropagation();
            onBaseClick?.();
          }}
          aria-label="Open base"
        >
          <span className="base-roof" />
          <span className="base-body" />
          <span className="base-door" />
          <span className="base-flag" />
          {(tile.base.barracksLevel ?? 1) >= 2 && <span className="base-side-wing" />}
          {(tile.base.barracksLevel ?? 1) >= 3 && <span className="base-motor-pool" />}
          {(tile.base.barracksLevel ?? 1) >= 4 && <span className="base-radio-mast" />}
          {(tile.base.defenseLevel ?? 1) >= 2 && <span className="base-defense-wall" />}
          {(tile.base.defenseLevel ?? 1) >= 3 && <span className="base-bunker" />}
          {(tile.base.offenseLevel ?? 1) >= 2 && <span className="base-sentry-gun" />}
          {(tile.base.offenseLevel ?? 1) >= 5 && <span className="base-watch-tower" />}
          {baseQualityLevel >= 2 && <span className="base-quality-mark base-quality-mark-one" />}
          {baseQualityLevel >= 3 && <span className="base-quality-mark base-quality-mark-two" />}
          {hasConnectedBaseNetwork && <span className="base-network-mark" aria-hidden="true">↔</span>}
          <span className="base-attack">A{baseAttack}</span>
          <span className="base-defense">D{baseDefense}</span>
        </button>
      )}
      {showContents && tile.base && !onBaseClick && (
        <span
          className={`base-marker ${baseLevelClass}`}
          style={{ '--base-color': tile.base.ruined ? '#8f949c' : owner?.color ?? '#f0c95d' } as CSSProperties}
        >
          <span className="base-roof" />
          <span className="base-body" />
          <span className="base-door" />
          <span className="base-flag" />
          {(tile.base.barracksLevel ?? 1) >= 2 && <span className="base-side-wing" />}
          {(tile.base.barracksLevel ?? 1) >= 3 && <span className="base-motor-pool" />}
          {(tile.base.barracksLevel ?? 1) >= 4 && <span className="base-radio-mast" />}
          {(tile.base.defenseLevel ?? 1) >= 2 && <span className="base-defense-wall" />}
          {(tile.base.defenseLevel ?? 1) >= 3 && <span className="base-bunker" />}
          {(tile.base.offenseLevel ?? 1) >= 2 && <span className="base-sentry-gun" />}
          {(tile.base.offenseLevel ?? 1) >= 5 && <span className="base-watch-tower" />}
          {baseQualityLevel >= 2 && <span className="base-quality-mark base-quality-mark-one" />}
          {baseQualityLevel >= 3 && <span className="base-quality-mark base-quality-mark-two" />}
          {hasConnectedBaseNetwork && <span className="base-network-mark" aria-hidden="true">↔</span>}
          <span className="base-attack">A{baseAttack}</span>
          <span className="base-defense">D{baseDefense}</span>
        </span>
      )}
      {showContents && army && (
        <span
          className={[
            'army-badge',
            unitStatDisplayMode === 'bar' ? 'army-badge-top-stats' : 'army-badge-corner-stats',
            `army-facing-${army.lastMoveDirection ?? 'south'}`,
            moveAnimation ? 'moving-in' : '',
            attackFacingAngle !== null ? 'attacking' : '',
          ].join(' ')}
          style={
            {
              borderColor: armyOwner?.color,
              ...(attackFacingAngle !== null ? { '--unit-facing-rotation': `${attackFacingAngle}deg` } : {}),
              '--move-from-x': `${(moveAnimation?.fromX ?? 0) * 82}px`,
              '--move-from-y': `${(moveAnimation?.fromY ?? 0) * 82}px`,
              '--move-duration': `${moveAnimation?.durationMs ?? 440}ms`,
            } as CSSProperties
          }
        >
          {unitStatDisplayMode === 'corners' ? (
            <>
              <span className="army-attack-chip" title="Attack power">
                {renderStatValue(attackLabel, armyAttackPower, 'attack')}
              </span>
              {unitDefenseValueVisible ? (
                <span className="army-defense-chip" title="Defense power">
                  {renderStatValue(defenseLabel, armyDefensePower, 'defense')}
                </span>
              ) : null}
            </>
          ) : null}
          {showTopHealthDisplay && healthDisplayMarkup}
          {unitOwnerBarEnabled && <span className="army-owner-strip" style={{ backgroundColor: armyOwner?.color }} />}
          <span className="unit-formation" aria-label={`Unit at ${tile.x}, ${tile.y}`}>
            {army.units.map((unit) => (
              <span className={`unit-art unit-art-${unit.typeId}`} key={unit.id} aria-hidden="true" />
            ))}
          </span>
          {!showTopHealthDisplay && healthDisplayMarkup}
        </span>
      )}
      {showContents && tile.trench && (
        <span className={`trench-marker trench-${trenchOrientation}`} aria-label="Trench" />
      )}
      {showContents && tile.smoke && (
        <span className="smoke-marker" title={`Smoke screen through round ${tile.smoke.expiresRound}`} aria-label="Smoke screen">
          <span className="smoke-puff smoke-puff-one" />
          <span className="smoke-puff smoke-puff-two" />
          <span className="smoke-puff smoke-puff-three" />
        </span>
      )}
      {tile.mine && <span className="mine-marker" title="Anti-tank mine">M</span>}
      {showContents && hasArtilleryImpact && (
        <span className="artillery-impact" aria-hidden="true">
          <span className="artillery-blast-ring" />
          <span className="artillery-blast-core" />
          <span className="artillery-smoke artillery-smoke-one" />
          <span className="artillery-smoke artillery-smoke-two" />
          <span className="artillery-scorch" />
        </span>
      )}
      {showContents && queuedMoveTurns !== null && (
        <span className={`queued-move-tooltip ${queuedMoveMode === 'passive' ? 'passive' : 'aggressive'}`}>
          {queuedMoveTurns} turn{queuedMoveTurns === 1 ? '' : 's'}
          <span>{queuedMoveMode === 'passive' ? 'Passive route' : 'Aggressive route'}</span>
        </span>
      )}
      {showActionTray && actionButtons.length > 0 && (
        <div className="tile-action-tray">
          {actionButtons.map((action) => (
            <button
              className={`tile-action ${action.className}`}
              key={action.label}
              onClick={(event) => {
                event.stopPropagation();
                action.onClick();
              }}
            >
              {action.label}
              {'tooltip' in action && action.tooltip ? <span className="tile-action-tooltip">{action.tooltip}</span> : null}
            </button>
          ))}
        </div>
      )}
      {combatTexts.map((entry) => (
        <span className={`combat-float ${entry.tone}`} key={entry.id}>
          {entry.text}
        </span>
      ))}
    </div>
  );
}
