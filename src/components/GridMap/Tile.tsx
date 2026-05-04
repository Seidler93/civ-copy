import type { CSSProperties } from 'react';
import type { ArmyDoc, MoveOrderMode, PlayerDoc, TileDoc } from '../../types/gameTypes';
import { UPGRADE_CONFIG } from '../../data/upgradeConfig';
import { armyHealthPercent } from '../../utils/combat';

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
  unitTileOwnerTintEnabled: boolean;
  unitTileOwnerTintIntensity: number;
  unitOwnerBarEnabled: boolean;
  isFogged: boolean;
  isExploredButNotVisible: boolean;
  actionRemaining: boolean | null;
  hasBaseDefenseBuff: boolean;
  isSelected: boolean;
  isReachable: boolean;
  isAttackRadius: boolean;
  isAttackable: boolean;
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
  onOpenActions?: () => void;
  onAttackClick?: () => void;
  onCombineClick?: () => void;
  onBuildTrenchClick?: () => void;
  onBuildBaseClick?: () => void;
  onReclaimBaseClick?: () => void;
  onScavengeClick?: () => void;
  onHealClick?: () => void;
  onPlaceMineClick?: () => void;
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
  unitTileOwnerTintEnabled,
  unitTileOwnerTintIntensity,
  unitOwnerBarEnabled,
  isFogged,
  isExploredButNotVisible,
  actionRemaining,
  hasBaseDefenseBuff,
  isSelected,
  isReachable,
  isAttackRadius,
  isAttackable,
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
  onOpenActions,
  onAttackClick,
  onCombineClick,
  onBuildTrenchClick,
  onBuildBaseClick,
  onReclaimBaseClick,
  onScavengeClick,
  onHealClick,
  onPlaceMineClick,
  onFortifyClick,
  onSetAggressiveClick,
  onSetPassiveClick,
  onClearMoveOrderClick,
  onBaseClick,
}: TileProps) {
  const showContents = !isFogged;
  const baseDefense = showContents && tile.base
    ? UPGRADE_CONFIG.baseDefense.find((level) => level.level === tile.base!.defenseLevel)?.bonus ?? 0
    : 0;
  const baseQualityLevel = tile.base
    ? Math.max(tile.base.unitQualityLevel ?? 1, ...Object.values(tile.base.unitQualityByType ?? {}).map((level) => level ?? 1))
    : 1;
  const actionButtons = [
    onAttackClick ? { label: 'Attack', className: 'attack-action', onClick: onAttackClick } : null,
    onCombineClick ? { label: 'Combine', className: 'combine-action', onClick: onCombineClick } : null,
    onBuildTrenchClick ? { label: 'Build Trench', className: 'trench-action', onClick: onBuildTrenchClick } : null,
    onBuildBaseClick ? { label: 'Build Base', className: 'build-action', onClick: onBuildBaseClick } : null,
    onReclaimBaseClick ? { label: 'Reclaim Base', className: 'build-action', onClick: onReclaimBaseClick } : null,
    onScavengeClick ? { label: 'Scavenge', className: 'scavenge-action', onClick: onScavengeClick } : null,
    onHealClick ? { label: 'Heal', className: 'heal-action', onClick: onHealClick } : null,
    onPlaceMineClick ? { label: 'Mine', className: 'mine-action', onClick: onPlaceMineClick } : null,
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
        isFogged ? 'fogged' : '',
        isExploredButNotVisible ? 'scouted' : '',
        army && actionRemaining ? 'action-ready' : '',
        army && unitTileOwnerTintEnabled ? 'owner-tinted' : '',
        army && hasBaseDefenseBuff ? 'base-defense-buffed-army' : '',
        isSelected ? 'selected' : '',
        isReachable ? 'reachable' : '',
        isAttackRadius ? 'attack-radius' : '',
        isAttackable ? 'attackable' : '',
        isAttackTarget ? 'attack-target' : '',
        isMergeable ? 'mergeable' : '',
        isMergeTarget ? 'merge-target' : '',
        tile.base?.ruined ? 'ruined-base-tile' : '',
        queuedMoveTurns ? 'queued-destination' : '',
      ].join(' ')}
      onClick={onClick}
      onContextMenu={(event) => {
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
        '--unit-owner-color': armyOwner?.color ?? 'transparent',
        '--unit-owner-tint': `${isSelected ? Math.round(unitTileOwnerTintIntensity * 0.45) : unitTileOwnerTintIntensity}%`,
      } as CSSProperties}
    >
      {showContents && tile.base && onBaseClick && (
        <button
          className="base-marker"
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
          {(tile.base.offenseLevel ?? 1) >= 3 && <span className="base-watch-tower" />}
          {baseQualityLevel >= 2 && <span className="base-quality-mark base-quality-mark-one" />}
          {baseQualityLevel >= 3 && <span className="base-quality-mark base-quality-mark-two" />}
          <span className="base-defense">D{baseDefense}</span>
        </button>
      )}
      {showContents && tile.base && !onBaseClick && (
        <span
          className="base-marker"
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
          {(tile.base.offenseLevel ?? 1) >= 3 && <span className="base-watch-tower" />}
          {baseQualityLevel >= 2 && <span className="base-quality-mark base-quality-mark-one" />}
          {baseQualityLevel >= 3 && <span className="base-quality-mark base-quality-mark-two" />}
          <span className="base-defense">D{baseDefense}</span>
        </span>
      )}
      {showContents && army && (
        <span
          className={[
            'army-badge',
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
          {unitOwnerBarEnabled && <span className="army-owner-strip" style={{ backgroundColor: armyOwner?.color }} />}
          <span className="unit-formation" aria-label={`Unit at ${tile.x}, ${tile.y}`}>
            {army.units.map((unit) => (
              <span className={`unit-art unit-art-${unit.typeId}`} key={unit.id} aria-hidden="true" />
            ))}
          </span>
          <span className="unit-hp-bar" aria-label={`${armyHealthPercent(army.units)} percent health`}>
            <span style={{ width: `${armyHealthPercent(army.units)}%` }} />
          </span>
        </span>
      )}
      {showContents && tile.trench && (
        <span className="trench-marker" aria-label="Trench">
          <span className="trench-line" aria-hidden="true" />
          <span className="trench-badge" aria-hidden="true">T</span>
        </span>
      )}
      {showContents && tile.mine && <span className="mine-marker">M</span>}
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
