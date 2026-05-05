import { useState } from 'react';
import { UNIT_TYPES } from '../../data/unitTypes';
import { dismissUnitCost } from '../../firebase/gameService';
import type { ArmyDoc, PlayerDoc } from '../../types/gameTypes';
import {
  ARMY_SPACE_CAPACITY,
  armyCurrentHealth,
  armyHealthPercent,
  armyMaxHealth,
  armyPower,
  armySpaceUsed,
  hasCombinedArms,
  hasEntrenchedInfantry,
  hasFieldHospital,
  hasTankHunters,
  unitCurrentHealth,
  unitMaxHealth,
  UNIT_XP_PER_LEVEL,
} from '../../utils/combat';
import { movementAllowance } from '../../utils/movement';

interface ArmyPanelProps {
  army: ArmyDoc | null;
  owner: PlayerDoc | null;
  hasBaseDefenseBuff?: boolean;
  hasTrenchBuff?: boolean;
  currentPlayer?: PlayerDoc;
  isMyTurn?: boolean;
  onDismissUnit?: (unitId: string) => void;
  onSeparateUnit?: (unitId: string) => void;
}

export default function ArmyPanel({
  army,
  owner,
  hasBaseDefenseBuff = false,
  hasTrenchBuff = false,
  currentPlayer,
  isMyTurn = false,
  onDismissUnit,
  onSeparateUnit,
}: ArmyPanelProps) {
  const [openUnitMenuId, setOpenUnitMenuId] = useState<string | null>(null);
  const movementTotal = movementAllowance(owner ?? undefined, army);
  const movementRemaining = army ? Math.max(0, movementTotal - (army.movementUsedThisTurn ?? 0)) : 0;
  const canDismissFromArmy = Boolean(army && currentPlayer && army.ownerId === currentPlayer.id && isMyTurn && onDismissUnit);
  const canSeparateFromArmy = Boolean(
    army && army.units.length > 1 && currentPlayer && army.ownerId === currentPlayer.id && isMyTurn && onSeparateUnit,
  );

  return (
    <section className="panel">
      <h2>Unit</h2>
      {!army && <p className="muted">No unit selected.</p>}
      {army && (
        <>
          <p>
            Controlled by <strong>{owner?.name ?? 'Unknown'}</strong>
          </p>
          <div className="health-block">
            <div className="health-row">
              <span>Health</span>
              <strong>{armyCurrentHealth(army.units)}/{armyMaxHealth(army.units)}</strong>
            </div>
            <div className="health-meter" aria-label={`Unit health ${armyHealthPercent(army.units)} percent`}>
              <span style={{ width: `${armyHealthPercent(army.units)}%` }} />
            </div>
            <div className="health-row">
              <span>Unit space</span>
              <strong>{armySpaceUsed(army.units)}/{ARMY_SPACE_CAPACITY}</strong>
            </div>
          </div>
          <div className="stat-grid">
            <span>Attack {armyPower(army.units, 'attack')}</span>
            <span>Defense {armyPower(army.units, 'defense')}</span>
          </div>
          <div className="unit-status-list">
            <div className="unit-status-row">
              <span>Movement available</span>
              <strong>{movementRemaining}/{movementTotal}</strong>
            </div>
            <div className="unit-status-row">
              <span>Action status</span>
              <strong>{army.hasActedThisTurn ? 'Spent' : 'Ready'}</strong>
            </div>
          </div>
          {(army.fortifyTurnsRemaining ?? 0) > 0 && (
            <p className="muted">Fortified: +35% defense, -25% attack, movement locked for {army.fortifyTurnsRemaining} turns.</p>
          )}
          {hasBaseDefenseBuff && <p className="muted">Base defense aura: +2 defense while defending.</p>}
          {hasTrenchBuff && <p className="muted">Trench: +2 attack and +2 defense while fighting from this tile.</p>}
          <div className="army-buff-list">
            {hasCombinedArms(army.units) && <span>Combined Arms: +10% attack and defense</span>}
            {hasTankHunters(army.units) && <span>Tank Hunters: +25% attack vs Tanks</span>}
            {hasFieldHospital(army.units) && <span>Field Hospital: +4 passive Medic healing</span>}
            {hasEntrenchedInfantry(army.units) && <span>Entrenched Infantry: +15% defense in trenches/base aura</span>}
          </div>
          <div className="unit-list">
            {army.units.map((unit) => (
              <div className="unit-row" key={unit.id}>
                <div className="unit-row-heading">
                  <strong>{UNIT_TYPES[unit.typeId].name}</strong>
                  <div className="unit-row-controls">
                    <span className="unit-level-badge" title={`Level ${unit.level ?? 1}`} aria-label={`Level ${unit.level ?? 1}`}>
                      LVL {unit.level ?? 1}
                    </span>
                    {(canSeparateFromArmy || canDismissFromArmy) && (
                      <>
                        <button
                          className="secondary unit-menu-button"
                          type="button"
                          aria-label={`Open ${UNIT_TYPES[unit.typeId].name} actions`}
                          onClick={() => setOpenUnitMenuId((current) => (current === unit.id ? null : unit.id))}
                        >
                          <i aria-hidden="true" />
                        </button>
                        {openUnitMenuId === unit.id && (
                          <div className="unit-menu">
                            {canSeparateFromArmy && (
                              <button
                                className="secondary"
                                type="button"
                                onClick={() => {
                                  setOpenUnitMenuId(null);
                                  onSeparateUnit?.(unit.id);
                                }}
                              >
                                Separate
                              </button>
                            )}
                            {canDismissFromArmy && (
                              <button
                                className="secondary dismiss-unit-button"
                                type="button"
                                disabled={
                                  (currentPlayer?.supplies ?? 0) <
                                  dismissUnitCost(unit.typeId, Math.max(unit.level ?? 1, unit.qualityLevel ?? 1))
                                }
                                onClick={() => {
                                  setOpenUnitMenuId(null);
                                  onDismissUnit?.(unit.id);
                                }}
                              >
                                Dismiss {dismissUnitCost(unit.typeId, Math.max(unit.level ?? 1, unit.qualityLevel ?? 1))}
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="unit-row-body">
                  <div className="unit-row-stats">
                    HP {unitCurrentHealth(unit)}/{unitMaxHealth(unit)} - A{unit.attack} - D{unit.defense}
                  </div>
                </div>
                <div className="unit-xp-meter" aria-label={`${unit.xp ?? 0} squad XP of ${UNIT_XP_PER_LEVEL}`}>
                  <span style={{ width: `${Math.min(100, Math.round(((unit.xp ?? 0) / UNIT_XP_PER_LEVEL) * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
