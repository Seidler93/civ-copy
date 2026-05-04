export type GameStatus = 'lobby' | 'active' | 'finished';
export type TerrainType = 'plains' | 'forest' | 'hill' | 'water' | 'mountain';
export type UnitTypeId = 'gunman' | 'recon' | 'sniper' | 'tank' | 'antiVehicle' | 'builder' | 'medic' | 'artillery';
export type MoveDirection = 'north' | 'east' | 'south' | 'west';
export type TalentId =
  | 'attackTraining'
  | 'coordinatedAssault'
  | 'defensiveDrills'
  | 'baseFortification'
  | 'logistics'
  | 'quartermaster'
  | 'mobilization';

export interface GameDoc {
  id: string;
  code: string;
  hostPlayerId: string;
  status: GameStatus;
  currentTurnPlayerId: string | null;
  turnNumber: number;
  roundNumber: number;
  mapWidth: number;
  mapHeight: number;
  createdAt: unknown;
}

export interface PlayerDoc {
  id: string;
  name: string;
  color: string;
  supplies: number;
  xp: number;
  level: number;
  talentPoints: number;
  talents: Partial<Record<TalentId, number>>;
  isEliminated: boolean;
  isCpu?: boolean;
  exploredTileIds?: string[];
  joinedAt: unknown;
}

export interface BaseState {
  ownerId: string;
  barracksLevel: number;
  unitQualityLevel: number;
  unitQualityByType?: Partial<Record<UnitTypeId, number>>;
  defenseLevel: number;
  offenseLevel?: number;
}

export interface MineState {
  ownerId: string;
  damage: number;
}

export interface TrenchState {
  ownerId: string;
}

export interface TileDoc {
  id: string;
  x: number;
  y: number;
  terrainType: TerrainType;
  ownerId: string | null;
  armyId: string | null;
  base: BaseState | null;
  mine: MineState | null;
  trench?: TrenchState | null;
}

export interface UnitInstance {
  id: string;
  typeId: UnitTypeId;
  attack: number;
  defense: number;
  qualityLevel: number;
  level: number;
  xp: number;
  maxHealth: number;
  currentHealth: number;
}

export interface ArmyDoc {
  id: string;
  ownerId: string;
  tileId: string;
  units: UnitInstance[];
  hasMovedThisTurn: boolean;
  hasActedThisTurn: boolean;
  movementUsedThisTurn?: number;
  lastMoveDirection?: MoveDirection;
  fortifyTurnsRemaining?: number;
  passiveHealSkippedRound?: number;
}

export interface GameState {
  game: GameDoc;
  players: PlayerDoc[];
  tiles: TileDoc[];
  armies: ArmyDoc[];
}

export interface UnitTypeConfig {
  id: UnitTypeId;
  name: string;
  cost: number;
  space: number;
  attack: number;
  defense: number;
  description: string;
}

export interface CombatResult {
  attackRoll: number;
  defenseRoll: number;
  attackPower: number;
  defensePower: number;
  attackSupportBonus: number;
  attackerLosses: number;
  defenderLosses: number;
  defenderDestroyed: boolean;
  baseDestroyed: boolean;
}

export interface AttackOutcome extends CombatResult {
  message: string;
  attackerTileId: string;
  defenderTileId: string;
  xpGained: number;
  suppliesGained: number;
  defenderSuppliesGained: number;
  unitXpGained: number;
}

export interface MoveOutcome {
  message: string;
  armyDestroyed: boolean;
  triggeredMineTileId?: string;
  mineDamage?: number;
  sentryDamage?: number;
}
