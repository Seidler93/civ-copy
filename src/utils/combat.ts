import { UPGRADE_CONFIG } from '../data/upgradeConfig';
import { UNIT_TYPES } from '../data/unitTypes';
import type { BaseState, CombatResult, TerrainType, UnitInstance } from '../types/gameTypes';

export const ARMY_SPACE_CAPACITY = 50;
export const UNIT_XP_PER_LEVEL = 30;
export const FIELD_HOSPITAL_PASSIVE_HEAL_BONUS = 4;
const DAMAGE_PER_LOSS = 10;
const HEALTH_GAIN_PER_LEVEL = 2;

export function rollDie(sides = 6) {
  return Math.floor(Math.random() * sides) + 1;
}

export function armyPower(units: UnitInstance[], stat: 'attack' | 'defense') {
  return units.reduce((total, unit) => total + unit[stat], 0);
}

export function armyHealthPercent(units: UnitInstance[]) {
  const maxHealth = armyMaxHealth(units);
  if (maxHealth <= 0) return 0;
  return Math.round((armyCurrentHealth(units) / maxHealth) * 100);
}

export function armyCurrentHealth(units: UnitInstance[]) {
  return units.reduce((total, unit) => total + unitCurrentHealth(unit), 0);
}

export function armyMaxHealth(units: UnitInstance[]) {
  return units.reduce((total, unit) => total + unitMaxHealth(unit), 0);
}

export function armySpaceUsed(units: UnitInstance[]) {
  return units.reduce((total, unit) => total + UNIT_TYPES[unit.typeId].space, 0);
}

export function armyHasMedic(units: UnitInstance[]) {
  return units.some((unit) => unit.typeId === 'medic');
}

export function hasCombinedArms(units: UnitInstance[]) {
  return hasUnit(units, 'gunman') && hasUnit(units, 'tank') && hasUnit(units, 'antiVehicle');
}

export function hasTankHunters(units: UnitInstance[]) {
  return hasUnit(units, 'antiVehicle') && hasUnit(units, 'gunman');
}

export function hasFieldHospital(units: UnitInstance[]) {
  return hasUnit(units, 'medic') && hasUnit(units, 'gunman');
}

export function hasEntrenchedInfantry(units: UnitInstance[]) {
  return unitCount(units, 'gunman') >= 2 && !hasUnit(units, 'tank');
}

export function hasSiegeColumn(units: UnitInstance[]) {
  return hasUnit(units, 'tank') && hasUnit(units, 'builder');
}

export function unitCurrentHealth(unit: UnitInstance) {
  return Math.max(0, unit.currentHealth ?? unitMaxHealth(unit));
}

export function unitMaxHealth(unit: UnitInstance) {
  return Math.max(1, unit.maxHealth ?? UNIT_TYPES[unit.typeId].space);
}

export function resolveCombat(
  attackerUnits: UnitInstance[],
  defenderUnits: UnitInstance[],
  terrainType: TerrainType,
  defendingBase: BaseState | null,
  attackPowerMultiplier = 1,
  defensePowerMultiplier = 1,
  defenseFlatBonus = 0,
  attackFlatBonus = 0,
): CombatResult {
  const attackRoll = rollDie();
  const defenseRoll = rollDie();
  const rawAttackPower = armyPower(attackerUnits, 'attack') + attackRoll + attackBonuses(attackerUnits, defenderUnits) + attackFlatBonus;
  const attackPower = Math.ceil(rawAttackPower * attackPowerMultiplier);
  const attackSupportBonus = attackPower - rawAttackPower;
  const rawDefensePower =
    armyPower(defenderUnits, 'defense') +
    defenseRoll +
    terrainDefenseBonus(terrainType) +
    baseDefenseBonus(defendingBase) +
    defenseFlatBonus;
  const defensePower = Math.ceil(rawDefensePower * defensePowerMultiplier);
  const margin = attackPower - defensePower;
  const defenderTargets = Math.max(defenderUnits.length, defendingBase ? 1 : 0);
  const defenderLosses = damageChunksAfterDefense(attackPower, defensePower, defenderTargets);
  const attackerLosses =
    defenderUnits.length > 0
      ? damageChunksAfterDefense(defensePower, attackPower, damageCapacityChunks(attackerUnits))
      : 0;

  const defenderDestroyed =
    defenderUnits.length > 0 && removeUnitLosses(defenderUnits, defenderLosses, 'defender').length === 0;
  const baseDestroyed = Boolean(defendingBase && margin > 0 && (defenderUnits.length === 0 || defenderDestroyed));

  return {
    attackRoll,
    defenseRoll,
    attackPower,
    defensePower,
    attackSupportBonus,
    attackerLosses,
    defenderLosses: defenderUnits.length > 0 ? defenderLosses : 0,
    defenderDestroyed,
    baseDestroyed,
  };
}

export function removeUnitLosses(units: UnitInstance[], losses: number, casualtySide: 'attacker' | 'defender') {
  if (losses <= 0) return units;
  const sorted = [...units].sort((a, b) =>
    casualtySide === 'attacker' ? a.defense - b.defense || a.attack - b.attack : a.attack - b.attack || a.defense - b.defense,
  );
  let remainingDamage = losses * DAMAGE_PER_LOSS;
  const damagedUnits = new Map<string, UnitInstance>();
  const destroyedUnitIds = new Set<string>();

  for (const unit of sorted) {
    if (remainingDamage <= 0) {
      damagedUnits.set(unit.id, unit);
      continue;
    }

    const currentHealth = unitCurrentHealth(unit);
    const damage = Math.min(currentHealth, remainingDamage);
    remainingDamage -= damage;
    const nextHealth = currentHealth - damage;
    if (nextHealth > 0) {
      damagedUnits.set(unit.id, { ...unit, currentHealth: nextHealth, maxHealth: unitMaxHealth(unit) });
    } else {
      destroyedUnitIds.add(unit.id);
    }
  }

  return units
    .map((unit) => {
      if (damagedUnits.has(unit.id)) return damagedUnits.get(unit.id)!;
      if (destroyedUnitIds.has(unit.id)) return null;
      return unit;
    })
    .filter((unit): unit is UnitInstance => unit !== null);
}

export function damageTankUnits(units: UnitInstance[], damage: number) {
  if (damage <= 0) return units;
  let remainingDamage = damage;

  return units
    .map((unit) => {
      if (unit.typeId !== 'tank' || remainingDamage <= 0) return unit;
      const currentHealth = unitCurrentHealth(unit);
      const appliedDamage = Math.min(currentHealth, remainingDamage);
      remainingDamage -= appliedDamage;
      const nextHealth = currentHealth - appliedDamage;
      return nextHealth > 0 ? { ...unit, maxHealth: unitMaxHealth(unit), currentHealth: nextHealth } : null;
    })
    .filter((unit): unit is UnitInstance => unit !== null);
}

export function healUnits(units: UnitInstance[], amount: number) {
  if (units.length === 0 || amount <= 0) return units;
  let remainingHeal = amount;

  return units.map((unit) => {
    if (remainingHeal <= 0) return unit;
    const maxHealth = unitMaxHealth(unit);
    const currentHealth = unitCurrentHealth(unit);
    const missingHealth = maxHealth - currentHealth;
    if (missingHealth <= 0) return { ...unit, maxHealth, currentHealth };

    const healing = Math.min(missingHealth, remainingHeal);
    remainingHeal -= healing;
    return { ...unit, maxHealth, currentHealth: currentHealth + healing };
  });
}

export function applyUnitXp(units: UnitInstance[], gainedXp: number) {
  if (units.length === 0 || gainedXp <= 0) return units;
  const xpPerUnit = Math.floor(gainedXp / units.length);
  if (xpPerUnit <= 0) return units;

  return units.map((unit) => {
    let xp = (unit.xp ?? 0) + xpPerUnit;
    let level = unit.level ?? 1;
    let attack = unit.attack;
    let defense = unit.defense;
    let maxHealth = unitMaxHealth(unit);
    let currentHealth = unitCurrentHealth(unit);

    while (xp >= UNIT_XP_PER_LEVEL) {
      xp -= UNIT_XP_PER_LEVEL;
      level += 1;
      attack += 1;
      defense += 1;
      maxHealth += HEALTH_GAIN_PER_LEVEL;
      currentHealth += HEALTH_GAIN_PER_LEVEL;
    }

    return { ...unit, xp, level, attack, defense, maxHealth, currentHealth };
  });
}

function attackBonuses(attackerUnits: UnitInstance[], defenderUnits: UnitInstance[]) {
  const defenderHasTank = defenderUnits.some((unit) => unit.typeId === 'tank');
  const defenderHasGunman = defenderUnits.some((unit) => unit.typeId === 'gunman');

  return attackerUnits.reduce((bonus, unit) => {
    if (unit.typeId === 'sniper') return bonus + 1;
    if (unit.typeId === 'tank' && defenderHasGunman) return bonus + 2;
    if (unit.typeId === 'antiVehicle' && defenderHasTank) return bonus + 6;
    return bonus;
  }, 0);
}

function hasUnit(units: UnitInstance[], typeId: UnitInstance['typeId']) {
  return units.some((unit) => unit.typeId === typeId);
}

function unitCount(units: UnitInstance[], typeId: UnitInstance['typeId']) {
  return units.filter((unit) => unit.typeId === typeId).length;
}

function terrainDefenseBonus(terrainType: TerrainType) {
  if (terrainType === 'forest') return 1;
  if (terrainType === 'hill') return 2;
  return 0;
}

function baseDefenseBonus(base: BaseState | null) {
  if (!base) return 0;
  return UPGRADE_CONFIG.baseDefense.find((level) => level.level === base.defenseLevel)?.bonus ?? 0;
}

function damageChunksAfterDefense(incomingPower: number, defensePower: number, maxDamageChunks: number) {
  if (incomingPower <= 0 || maxDamageChunks <= 0) return 0;
  const minimumDamage = Math.max(1, Math.ceil(incomingPower * 0.18));
  const mitigatedDamage = incomingPower - Math.floor(defensePower * 0.65);
  return clamp(Math.ceil(Math.max(minimumDamage, mitigatedDamage) / DAMAGE_PER_LOSS), 1, maxDamageChunks);
}

function damageCapacityChunks(units: UnitInstance[]) {
  return Math.max(0, Math.ceil(armyCurrentHealth(units) / DAMAGE_PER_LOSS));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
