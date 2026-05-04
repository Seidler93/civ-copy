import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { signInAnonymously, type User } from 'firebase/auth';
import { auth, db } from './firebaseConfig';
import { UNIT_TYPES } from '../data/unitTypes';
import { UNIT_COMPOSITIONS } from '../data/unitCompositions';
import { BUILD_BASE_COST, UPGRADE_CONFIG } from '../data/upgradeConfig';
import { previousTalentInBranch, talentById } from '../data/talentConfig';
import type {
  ArmyDoc,
  AttackOutcome,
  GameDoc,
  GameState,
  MoveDirection,
  MoveOutcome,
  PlayerDoc,
  TileDoc,
  TalentId,
  UnitInstance,
  UnitTypeId,
} from '../types/gameTypes';
import {
  ARMY_SPACE_CAPACITY,
  applyUnitXp,
  armyCurrentHealth,
  armyHasMedic,
  armyMaxHealth,
  armySpaceUsed,
  damageTankUnits,
  FIELD_HOSPITAL_PASSIVE_HEAL_BONUS,
  hasCombinedArms,
  hasEntrenchedInfantry,
  hasFieldHospital,
  hasSiegeColumn,
  hasTankHunters,
  healUnits,
  removeUnitLosses,
  resolveCombat,
} from '../utils/combat';
import { suppliesFromBases } from '../utils/economy';
import { effectiveBarracksLevel } from '../utils/trenchNetwork';
import { visibleTileIdsForPlayer } from '../utils/vision';
import {
  armyMustStaySolo,
  canLogisticsBuildBase,
  canLogisticsBuildTrench,
  canLogisticsScavenge,
  canCombineArmies,
  canMoveArmy,
  canAttackTile,
  chebyshevDistance,
  hasLineOfSight,
  isSoloArtilleryArmy,
  isImpassableTerrain,
  manhattanDistance,
  movementCost,
  tileIdFromCoords,
} from '../utils/movement';
import { applyXp } from '../utils/xp';

const PLAYER_COLORS = ['#d94848', '#2f80ed', '#2f9e44', '#a855f7'];
const MAP_WIDTH = 20;
const MAP_HEIGHT = 20;
const STARTING_SUPPLIES = 80;
const STARTING_POSITIONS = [
  { x: 1, y: 1 },
  { x: 18, y: 18 },
  { x: 18, y: 1 },
  { x: 1, y: 18 },
];
export const MAX_DEPLOYED_UNITS = 50;
export const DISMISS_UNIT_MIN_COST = 3;
export const DISMISS_UNIT_COST_RATE = 0.25;
const XP_END_TURN = 5;
const XP_PER_BASE_AT_TURN_END = 3;
const XP_ATTACK = 5;
const XP_DESTROY_UNIT = 12;
const XP_DESTROY_ARMY = 25;
const XP_DESTROY_BASE = 40;
const XP_RECRUIT_UNIT = 8;
const XP_UPGRADE_BASE = 15;
const XP_BUILD_BASE = 30;
const SUPPLIES_DESTROY_UNIT = 8;
const SUPPLIES_DESTROY_ARMY = 20;
const SUPPLIES_DESTROY_BASE = 45;
const UNIT_XP_DESTROY_UNIT = 15;
const UNIT_XP_DESTROY_ARMY = 20;
const UNIT_XP_FULL_HEALTH_END_ROUND = 3;
const MEDIC_PASSIVE_HEAL = 4;
const MEDIC_ACTIVE_HEAL = 16;
const ANTI_VEHICLE_MINE_DAMAGE = 30;
const LOGISTICS_SCAVENGE_SUPPLIES = 20;
const BASE_AURA_DEFENSE_BONUS = 2;
const TRENCH_ATTACK_BONUS = 2;
const TRENCH_DEFENSE_BONUS = 2;
const FORTIFY_TURNS = 2;
const FORTIFY_ATTACK_MULTIPLIER = 0.75;
const FORTIFY_DEFENSE_MULTIPLIER = 1.35;

export function dismissUnitCost(unitTypeId: UnitTypeId) {
  return Math.max(DISMISS_UNIT_MIN_COST, Math.ceil(UNIT_TYPES[unitTypeId].cost * DISMISS_UNIT_COST_RATE));
}

export async function ensureAnonymousUser() {
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export async function createGame(playerName: string) {
  const user = await ensureAnonymousUser();
  const code = makeGameCode();
  const gameRef = await addDoc(collection(db, 'games'), {
    code,
    hostPlayerId: user.uid,
    status: 'lobby',
    currentTurnPlayerId: null,
    turnNumber: 0,
    roundNumber: 1,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    createdAt: serverTimestamp(),
  });

  await createPlayer(gameRef.id, user, playerName, 0);
  return gameRef.id;
}

export async function createCpuGame(playerName: string) {
  const gameId = await createGame(playerName);
  await setDoc(doc(db, 'games', gameId, 'players', `cpu_${gameId}`), {
    name: 'CPU Commander',
    color: PLAYER_COLORS[1],
    supplies: STARTING_SUPPLIES,
    xp: 0,
    level: 1,
    talentPoints: 0,
    talents: {},
    isEliminated: false,
    isCpu: true,
    exploredTileIds: [],
    joinedAt: serverTimestamp(),
  });
  await startGame(gameId);
  return gameId;
}

export async function createDevSoloGame() {
  const user = await ensureAnonymousUser();
  const gameRef = await addDoc(collection(db, 'games'), {
    code: 'SOLO',
    hostPlayerId: `solo_${user.uid}_one`,
    status: 'active',
    currentTurnPlayerId: `solo_${user.uid}_one`,
    turnNumber: 1,
    roundNumber: 1,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    createdAt: serverTimestamp(),
  });
  const gameId = gameRef.id;
  const batch = writeBatch(db);
  const terrain = makeTerrain();
  const devTiles = terrain.map((tile) => ({ ...tile }));
  const devArmies: ArmyDoc[] = [];
  const soloPlayers = [
    { id: `solo_${user.uid}_one`, name: 'Solo Red', color: PLAYER_COLORS[0], startIndex: 0 },
    { id: `solo_${user.uid}_two`, name: 'Solo Blue', color: PLAYER_COLORS[1], startIndex: 1 },
  ];

  terrain.forEach((tile) => {
    batch.set(doc(db, 'games', gameId, 'tiles', tile.id), tile);
  });

  soloPlayers.forEach((player) => {
    batch.set(doc(db, 'games', gameId, 'players', player.id), {
      name: player.name,
      color: player.color,
      supplies: STARTING_SUPPLIES,
      xp: 0,
      level: 1,
      talentPoints: 0,
      talents: {},
      isEliminated: false,
      joinedAt: serverTimestamp(),
    });
    const start = STARTING_POSITIONS[player.startIndex];
    const tileId = tileIdFromCoords(start.x, start.y);
    const armyId = `army_${player.id}_start`;
    batch.update(doc(db, 'games', gameId, 'tiles', tileId), {
      ownerId: player.id,
      armyId,
      base: { ownerId: player.id, barracksLevel: 1, unitQualityLevel: 1, defenseLevel: 1 },
    });
    const startTile = devTiles.find((tile) => tile.id === tileId);
    if (startTile) {
      startTile.ownerId = player.id;
      startTile.armyId = armyId;
      startTile.base = { ownerId: player.id, barracksLevel: 1, unitQualityLevel: 1, defenseLevel: 1 };
    }
    const startArmy: ArmyDoc = {
      id: armyId,
      ownerId: player.id,
      tileId,
      units: [makeUnit('gunman'), makeUnit('gunman')],
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
      lastMoveDirection: player.startIndex === 0 ? 'east' : 'west',
    };
    batch.set(doc(db, 'games', gameId, 'armies', armyId), {
      ownerId: startArmy.ownerId,
      tileId: startArmy.tileId,
      units: startArmy.units,
      hasMovedThisTurn: startArmy.hasMovedThisTurn,
      hasActedThisTurn: startArmy.hasActedThisTurn,
      movementUsedThisTurn: startArmy.movementUsedThisTurn,
      lastMoveDirection: startArmy.lastMoveDirection,
    });
    devArmies.push(startArmy);
    const builderTileId = tileIdFromCoords(start.x + (start.x < MAP_WIDTH / 2 ? 1 : -1), start.y);
    const builderArmyId = `army_${player.id}_builder`;
    batch.update(doc(db, 'games', gameId, 'tiles', builderTileId), { armyId: builderArmyId });
    const builderTile = devTiles.find((tile) => tile.id === builderTileId);
    if (builderTile) builderTile.armyId = builderArmyId;
    const builderArmy: ArmyDoc = {
      id: builderArmyId,
      ownerId: player.id,
      tileId: builderTileId,
      units: [makeUnit('builder')],
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
      lastMoveDirection: player.startIndex === 0 ? 'east' : 'west',
    };
    batch.set(doc(db, 'games', gameId, 'armies', builderArmyId), {
      ownerId: builderArmy.ownerId,
      tileId: builderArmy.tileId,
      units: builderArmy.units,
      hasMovedThisTurn: builderArmy.hasMovedThisTurn,
      hasActedThisTurn: builderArmy.hasActedThisTurn,
      movementUsedThisTurn: builderArmy.movementUsedThisTurn,
      lastMoveDirection: builderArmy.lastMoveDirection,
    });
    devArmies.push(builderArmy);
  });

  soloPlayers.forEach((player) => {
    batch.update(doc(db, 'games', gameId, 'players', player.id), {
      exploredTileIds: Array.from(visibleTileIdsForPlayer(player.id, devTiles, devArmies)),
    });
  });

  await batch.commit();
  return gameId;
}

export async function devAddSupplies(gameId: string, playerId: string, amount: number) {
  if (!import.meta.env.DEV) throw new Error('Dev tools are only available in local development.');
  return runTransaction(db, async (transaction) => {
    const playerRef = doc(db, 'games', gameId, 'players', playerId);
    const playerSnap = await transaction.get(playerRef);
    if (!playerSnap.exists()) throw new Error('Player not found.');
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    transaction.update(playerRef, { supplies: player.supplies + amount });
    return `Added ${amount} supplies to ${player.name}.`;
  });
}

export async function devSpawnUnitAtTile(gameId: string, playerId: string, unitTypeId: UnitTypeId, tileId: string) {
  if (!import.meta.env.DEV) throw new Error('Dev tools are only available in local development.');
  return runTransaction(db, async (transaction) => {
    const tileRef = doc(db, 'games', gameId, 'tiles', tileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);
    const [tileSnap, playerSnap] = await Promise.all([transaction.get(tileRef), transaction.get(playerRef)]);
    if (!tileSnap.exists() || !playerSnap.exists()) throw new Error('Game state changed. Try again.');

    const tile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    if (isImpassableTerrain(tile)) throw new Error('Pick a passable tile.');
    if (tile.armyId) throw new Error('That tile already has a unit.');

    const armyRef = doc(collection(db, 'games', gameId, 'armies'));
    transaction.set(armyRef, {
      ownerId: playerId,
      tileId,
      units: [makeUnit(unitTypeId)],
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
      lastMoveDirection: 'south',
    });
    transaction.update(tileRef, { armyId: armyRef.id });

    return `Spawned ${UNIT_TYPES[unitTypeId].name} for ${player.name} at ${tile.x}, ${tile.y}.`;
  });
}

export async function joinGameByCode(code: string, playerName: string) {
  const user = await ensureAnonymousUser();
  const gamesQuery = query(collection(db, 'games'), where('code', '==', code.trim().toUpperCase()), limit(1));
  const gameSnapshot = await getDocs(gamesQuery);
  if (gameSnapshot.empty) throw new Error('No game found with that code.');

  const gameDoc = gameSnapshot.docs[0];
  const playersSnapshot = await getDocs(collection(db, 'games', gameDoc.id, 'players'));
  if (playersSnapshot.docs.some((player) => player.id === user.uid)) return gameDoc.id;
  if (playersSnapshot.size >= 4) throw new Error('This game already has 4 players.');

  await createPlayer(gameDoc.id, user, playerName, playersSnapshot.size);
  return gameDoc.id;
}

export function subscribeToGame(gameId: string, onChange: (state: GameState) => void, onError: (error: Error) => void) {
  const gameRef = doc(db, 'games', gameId);
  let latestGame: GameDoc | null = null;
  let latestPlayers: PlayerDoc[] = [];
  let latestTiles: TileDoc[] = [];
  let latestArmies: ArmyDoc[] = [];

  const emit = () => {
    if (latestGame) {
      onChange({ game: latestGame, players: latestPlayers, tiles: latestTiles, armies: latestArmies });
    }
  };

  const unsubscribers = [
    onSnapshot(
      gameRef,
      (snapshot) => {
        if (!snapshot.exists()) return;
        latestGame = { id: snapshot.id, ...snapshot.data() } as GameDoc;
        emit();
      },
      onError,
    ),
    onSnapshot(
      query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt')),
      (snapshot) => {
        latestPlayers = snapshot.docs.map((player) => ({ id: player.id, ...player.data() }) as PlayerDoc);
        emit();
      },
      onError,
    ),
    onSnapshot(
      collection(db, 'games', gameId, 'tiles'),
      (snapshot) => {
        latestTiles = snapshot.docs.map((tile) => ({ id: tile.id, ...tile.data() }) as TileDoc);
        emit();
      },
      onError,
    ),
    onSnapshot(
      collection(db, 'games', gameId, 'armies'),
      (snapshot) => {
        latestArmies = snapshot.docs.map((army) => ({ id: army.id, ...army.data() }) as ArmyDoc);
        emit();
      },
      onError,
    ),
  ];

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export async function startGame(gameId: string) {
  const playersSnapshot = await getDocs(query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt')));
  const players = playersSnapshot.docs.map((player) => ({ id: player.id, ...player.data() }) as PlayerDoc);
  if (players.length < 2) throw new Error('Start needs at least 2 players.');

  const batch = writeBatch(db);
  const gameRef = doc(db, 'games', gameId);
  const terrain = makeTerrain();
  const startTiles = terrain.map((tile) => ({ ...tile }));
  const startArmies: ArmyDoc[] = [];

  terrain.forEach((tile) => {
    batch.set(doc(db, 'games', gameId, 'tiles', tile.id), tile);
  });

  players.forEach((player, index) => {
    const start = STARTING_POSITIONS[index];
    const tileId = tileIdFromCoords(start.x, start.y);
    const armyId = `army_${player.id}_start`;
    const tileRef = doc(db, 'games', gameId, 'tiles', tileId);
    batch.update(tileRef, {
      ownerId: player.id,
      armyId,
      base: { ownerId: player.id, barracksLevel: 1, unitQualityLevel: 1, defenseLevel: 1 },
    });
    const startTile = startTiles.find((tile) => tile.id === tileId);
    if (startTile) {
      startTile.ownerId = player.id;
      startTile.armyId = armyId;
      startTile.base = { ownerId: player.id, barracksLevel: 1, unitQualityLevel: 1, defenseLevel: 1 };
    }
    const startArmy: ArmyDoc = {
      id: armyId,
      ownerId: player.id,
      tileId,
      units: [makeUnit('gunman'), makeUnit('gunman')],
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
    };
    batch.set(doc(db, 'games', gameId, 'armies', armyId), {
      ownerId: startArmy.ownerId,
      tileId: startArmy.tileId,
      units: startArmy.units,
      hasMovedThisTurn: startArmy.hasMovedThisTurn,
      hasActedThisTurn: startArmy.hasActedThisTurn,
      movementUsedThisTurn: startArmy.movementUsedThisTurn,
    });
    startArmies.push(startArmy);
    const builderTileId = tileIdFromCoords(start.x + (start.x < MAP_WIDTH / 2 ? 1 : -1), start.y);
    const builderArmyId = `army_${player.id}_builder`;
    batch.update(doc(db, 'games', gameId, 'tiles', builderTileId), { armyId: builderArmyId });
    const builderTile = startTiles.find((tile) => tile.id === builderTileId);
    if (builderTile) builderTile.armyId = builderArmyId;
    const builderArmy: ArmyDoc = {
      id: builderArmyId,
      ownerId: player.id,
      tileId: builderTileId,
      units: [makeUnit('builder')],
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
    };
    batch.set(doc(db, 'games', gameId, 'armies', builderArmyId), {
      ownerId: builderArmy.ownerId,
      tileId: builderArmy.tileId,
      units: builderArmy.units,
      hasMovedThisTurn: builderArmy.hasMovedThisTurn,
      hasActedThisTurn: builderArmy.hasActedThisTurn,
      movementUsedThisTurn: builderArmy.movementUsedThisTurn,
    });
    startArmies.push(builderArmy);
  });

  players.forEach((player) => {
    batch.update(doc(db, 'games', gameId, 'players', player.id), {
      exploredTileIds: Array.from(visibleTileIdsForPlayer(player.id, startTiles, startArmies)),
    });
  });

  batch.update(gameRef, {
    status: 'active',
    currentTurnPlayerId: players[0].id,
    turnNumber: 1,
    roundNumber: 1,
  });

  await batch.commit();
}

export async function resetGameToLobby(gameId: string, playerId: string) {
  const gameRef = doc(db, 'games', gameId);
  const gameSnapshot = await getDoc(gameRef);
  const game = gameSnapshot.exists() ? ({ id: gameSnapshot.id, ...gameSnapshot.data() } as GameDoc) : null;
  if (!game || game.hostPlayerId !== playerId) throw new Error('Only the host can end the game.');

  const [tilesSnapshot, armiesSnapshot, playersSnapshot] = await Promise.all([
    getDocs(collection(db, 'games', gameId, 'tiles')),
    getDocs(collection(db, 'games', gameId, 'armies')),
    getDocs(collection(db, 'games', gameId, 'players')),
  ]);
  const batch = writeBatch(db);

  tilesSnapshot.docs.forEach((tileDoc) => batch.delete(tileDoc.ref));
  armiesSnapshot.docs.forEach((armyDoc) => batch.delete(armyDoc.ref));
  playersSnapshot.docs.forEach((playerDoc) => {
    batch.update(playerDoc.ref, {
      supplies: STARTING_SUPPLIES,
      xp: 0,
      level: 1,
      talentPoints: 0,
      talents: {},
      isEliminated: false,
      exploredTileIds: [],
    });
  });
  batch.update(gameRef, {
    status: 'lobby',
    currentTurnPlayerId: null,
    turnNumber: 0,
    roundNumber: 1,
  });

  await batch.commit();
}

export async function backOutOfGame(gameId: string, playerId: string) {
  const gameRef = doc(db, 'games', gameId);
  const [gameSnapshot, playersSnapshot, tilesSnapshot, armiesSnapshot] = await Promise.all([
    getDoc(gameRef),
    getDocs(query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt'))),
    getDocs(collection(db, 'games', gameId, 'tiles')),
    getDocs(collection(db, 'games', gameId, 'armies')),
  ]);
  if (!gameSnapshot.exists()) throw new Error('Game not found.');

  const game = { id: gameSnapshot.id, ...gameSnapshot.data() } as GameDoc;
  const players = playersSnapshot.docs.map((playerDoc) => ({ id: playerDoc.id, ...playerDoc.data() }) as PlayerDoc);
  const armies = armiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
  const armiesById = new Map(armies.map((army) => [army.id, army]));
  const leavingPlayer = players.find((player) => player.id === playerId);
  if (!leavingPlayer) throw new Error('You are not in this game.');

  const batch = writeBatch(db);
  armiesSnapshot.docs.forEach((armyDoc) => {
    const army = { id: armyDoc.id, ...armyDoc.data() } as ArmyDoc;
    if (army.ownerId === playerId) batch.delete(armyDoc.ref);
  });

  tilesSnapshot.docs.forEach((tileDoc) => {
    const tile = { id: tileDoc.id, ...tileDoc.data() } as TileDoc;
    const updates: Partial<TileDoc> = {};
    if (tile.base?.ownerId === playerId) {
      updates.base = null;
      updates.ownerId = null;
    }
    if (tile.armyId) {
      const occupyingArmy = armiesById.get(tile.armyId);
      if (occupyingArmy?.ownerId === playerId) updates.armyId = null;
    }
    if (tile.mine?.ownerId === playerId) updates.mine = null;
    if (tile.trench?.ownerId === playerId) updates.trench = null;
    if (Object.keys(updates).length > 0) batch.update(tileDoc.ref, updates);
  });

  batch.update(doc(db, 'games', gameId, 'players', playerId), { isEliminated: true });

  const activePlayers = players.filter((player) => !player.isEliminated);
  const remainingActivePlayers = activePlayers.filter((player) => player.id !== playerId);
  if (game.currentTurnPlayerId === playerId || remainingActivePlayers.length <= 1) {
    const currentIndex = activePlayers.findIndex((player) => player.id === playerId);
    const nextPlayer =
      remainingActivePlayers.find((_, index) => index >= currentIndex) ?? remainingActivePlayers[0] ?? null;
    batch.update(gameRef, {
      status: remainingActivePlayers.length <= 1 && game.status === 'active' ? 'finished' : game.status,
      currentTurnPlayerId: nextPlayer?.id ?? null,
      turnNumber: game.currentTurnPlayerId === playerId ? game.turnNumber + 1 : game.turnNumber,
      roundNumber:
        game.currentTurnPlayerId === playerId && currentIndex === activePlayers.length - 1
          ? game.roundNumber + 1
          : game.roundNumber,
    });
  }

  await batch.commit();
  return 'You backed out of the game. Your armies, bases, and mines were removed.';
}

export async function moveArmy(gameId: string, armyId: string, targetTileId: string, playerId: string): Promise<MoveOutcome> {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const targetTileRef = doc(db, 'games', gameId, 'tiles', targetTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, armySnap, targetTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(armyRef),
      transaction.get(targetTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !armySnap.exists() || !targetTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    const targetTile = { id: targetTileSnap.id, ...targetTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const fromTileRef = doc(db, 'games', gameId, 'tiles', army.tileId);
    const fromTileSnap = await transaction.get(fromTileRef);
    if (!fromTileSnap.exists()) throw new Error('Unit tile is missing.');
    const fromTile = { id: fromTileSnap.id, ...fromTileSnap.data() } as TileDoc;
    const tilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const tiles = tilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const armiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const armies = armiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);

    if (game.currentTurnPlayerId !== playerId) throw new Error('It is not your turn.');
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if ((army.fortifyTurnsRemaining ?? 0) > 0) throw new Error('This unit is fortified and cannot move.');
    if (!canMoveArmy(army, fromTile, targetTile, player, tiles, armies)) throw new Error('That move is not allowed.');
    const moveCost = movementCost(fromTile, targetTile, tiles, { armies, passThroughOwnerId: army.ownerId }) ?? 0;
    const mineDamage = targetTile.mine?.damage ?? ANTI_VEHICLE_MINE_DAMAGE;
    const mineTriggers = Boolean(
      targetTile.mine &&
        targetTile.mine.ownerId !== playerId &&
        army.units.some((unit) => unit.typeId === 'tank'),
    );
    const movedUnits = mineTriggers ? damageTankUnits(army.units, mineDamage) : army.units;
    const sentryAttacks =
      movedUnits.length > 0
        ? tiles
            .filter((tile) => tile.base && tile.base.ownerId !== playerId)
            .map((tile) => {
              const offenseConfig = UPGRADE_CONFIG.baseOffense.find((level) => level.level === (tile.base!.offenseLevel ?? 1));
              return { tile, offenseConfig };
            })
            .filter(
              (entry): entry is {
                tile: TileDoc;
                offenseConfig: (typeof UPGRADE_CONFIG.baseOffense)[number];
              } =>
                Boolean(
                  entry.offenseConfig &&
                    entry.offenseConfig.damage > 0 &&
                    chebyshevDistance(entry.tile, targetTile) <= entry.offenseConfig.range &&
                    hasLineOfSight(entry.tile, targetTile, tiles),
                ),
            )
        : [];
    const sentryLosses = sentryAttacks.reduce((total, entry) => total + entry.offenseConfig.damage, 0);
    const sentryDamage = sentryLosses * 10;
    const finalUnits = sentryLosses > 0 ? removeUnitLosses(movedUnits, sentryLosses, 'defender') : movedUnits;
    const lastMoveDirection = directionFromTiles(fromTile, targetTile);
    const nextTiles = tiles.map((tile) => {
      if (tile.id === fromTile.id) return { ...tile, armyId: null };
      if (tile.id === targetTile.id) return { ...tile, armyId: finalUnits.length > 0 ? armyId : null, mine: mineTriggers ? null : tile.mine };
      return tile;
    });
    const nextArmies =
      finalUnits.length > 0
        ? armies.map((candidate) =>
            candidate.id === armyId
              ? { ...candidate, tileId: targetTileId, units: finalUnits, lastMoveDirection }
              : candidate,
          )
        : armies.filter((candidate) => candidate.id !== armyId);
    const nextExploredTileIds = exploredTileIdsFor(player, nextTiles, nextArmies);

    transaction.update(fromTileRef, { armyId: null });
    if (movedUnits.length === 0 || finalUnits.length === 0) {
      transaction.update(targetTileRef, { armyId: null, mine: mineTriggers ? null : targetTile.mine });
      transaction.delete(armyRef);
      transaction.update(playerRef, { exploredTileIds: nextExploredTileIds });
      if (movedUnits.length > 0 && sentryDamage > 0) {
        return {
          message: `Unit moved to ${targetTile.x}, ${targetTile.y} and was destroyed by base sentry fire for ${sentryDamage} damage.`,
          armyDestroyed: true,
          triggeredMineTileId: mineTriggers ? targetTile.id : undefined,
          mineDamage: mineTriggers ? mineDamage : undefined,
          sentryDamage,
        };
      }
      return {
        message: `Unit hit an anti-vehicle mine at ${targetTile.x}, ${targetTile.y} and was destroyed.`,
        armyDestroyed: true,
        triggeredMineTileId: targetTile.id,
        mineDamage: mineTriggers ? mineDamage : undefined,
      };
    }

    transaction.update(targetTileRef, { armyId, mine: mineTriggers ? null : targetTile.mine });
    transaction.update(armyRef, {
      tileId: targetTileId,
      units: finalUnits,
      hasMovedThisTurn: true,
      movementUsedThisTurn: (army.movementUsedThisTurn ?? 0) + moveCost,
      lastMoveDirection,
    });
    transaction.update(playerRef, { exploredTileIds: nextExploredTileIds });

    return {
      message:
        `Unit moved to ${targetTile.x}, ${targetTile.y}.` +
        (mineTriggers ? ` Tank hit a mine for ${mineDamage} damage.` : '') +
        (sentryDamage > 0 ? ` Base sentry fire dealt ${sentryDamage} damage.` : ''),
      armyDestroyed: false,
      triggeredMineTileId: mineTriggers ? targetTile.id : undefined,
      mineDamage: mineTriggers ? mineDamage : undefined,
      sentryDamage: sentryDamage > 0 ? sentryDamage : undefined,
    };
  });
}

export async function combineArmies(gameId: string, sourceArmyId: string, targetArmyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const sourceArmyRef = doc(db, 'games', gameId, 'armies', sourceArmyId);
    const targetArmyRef = doc(db, 'games', gameId, 'armies', targetArmyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, sourceArmySnap, targetArmySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(sourceArmyRef),
      transaction.get(targetArmyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !sourceArmySnap.exists() || !targetArmySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const sourceArmy = { id: sourceArmySnap.id, ...sourceArmySnap.data() } as ArmyDoc;
    const targetArmy = { id: targetArmySnap.id, ...targetArmySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const sourceTileRef = doc(db, 'games', gameId, 'tiles', sourceArmy.tileId);
    const targetTileRef = doc(db, 'games', gameId, 'tiles', targetArmy.tileId);
    const [sourceTileSnap, targetTileSnap] = await Promise.all([
      transaction.get(sourceTileRef),
      transaction.get(targetTileRef),
    ]);
    if (!sourceTileSnap.exists() || !targetTileSnap.exists()) throw new Error('Unit tile is missing.');

    const sourceTile = { id: sourceTileSnap.id, ...sourceTileSnap.data() } as TileDoc;
    const targetTile = { id: targetTileSnap.id, ...targetTileSnap.data() } as TileDoc;
    const tilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const tiles = tilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const armiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const armies = armiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    if (game.currentTurnPlayerId !== playerId) throw new Error('It is not your turn.');
    if (!canCombineArmies(sourceArmy, targetArmy, sourceTile, targetTile, player, tiles, armies)) {
      throw new Error('Those units cannot combine.');
    }

    const combinedUnits = [...targetArmy.units, ...sourceArmy.units];
    transaction.delete(sourceArmyRef);
    transaction.update(sourceTileRef, { armyId: null });
    transaction.update(targetArmyRef, {
      units: combinedUnits,
      hasMovedThisTurn: true,
      hasActedThisTurn: targetArmy.hasActedThisTurn,
    });

    return {
      targetArmyId,
      message: `Combined units into one unit using ${armySpaceUsed(combinedUnits)}/${ARMY_SPACE_CAPACITY} space.`,
    };
  });
}

export async function dismissUnitFromArmy(gameId: string, armyId: string, unitId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, armySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(armyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !armySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const unit = army.units.find((candidate) => candidate.id === unitId);
    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only dismiss squads during your turn.');
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (!unit) throw new Error('That squad is no longer in this unit.');

    const cost = dismissUnitCost(unit.typeId);
    if (player.supplies < cost) throw new Error(`You need ${cost} supplies to dismiss ${UNIT_TYPES[unit.typeId].name}.`);

    const remainingUnits = army.units.filter((candidate) => candidate.id !== unitId);
    const tileRef = doc(db, 'games', gameId, 'tiles', army.tileId);
    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const playersSnapshot = await getDocs(query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt')));
    const tiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const armies = allArmiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const players = playersSnapshot.docs.map((playerDoc) => ({ id: playerDoc.id, ...playerDoc.data() }) as PlayerDoc);
    const updatedArmies =
      remainingUnits.length === 0
        ? armies.filter((candidate) => candidate.id !== armyId)
        : armies.map((candidate) => (candidate.id === armyId ? { ...candidate, units: remainingUnits } : candidate));

    if (remainingUnits.length === 0) {
      transaction.delete(armyRef);
      transaction.update(tileRef, { armyId: null });
    } else {
      transaction.update(armyRef, { units: remainingUnits });
    }

    const isNowEliminated = shouldEliminatePlayer(playerId, tiles, updatedArmies);
    transaction.update(playerRef, {
      supplies: player.supplies - cost,
      isEliminated: isNowEliminated ? true : player.isEliminated,
    });

    if (isNowEliminated) {
      const activePlayers = players.filter((candidate) => !candidate.isEliminated);
      const remainingActivePlayers = activePlayers.filter((candidate) => candidate.id !== playerId);
      const currentIndex = activePlayers.findIndex((candidate) => candidate.id === playerId);
      const nextPlayer =
        remainingActivePlayers.find((_, index) => index >= currentIndex) ?? remainingActivePlayers[0] ?? null;
      transaction.update(gameRef, {
        status: remainingActivePlayers.length <= 1 && game.status === 'active' ? 'finished' : game.status,
        currentTurnPlayerId: game.currentTurnPlayerId === playerId ? nextPlayer?.id ?? null : game.currentTurnPlayerId,
        turnNumber: game.currentTurnPlayerId === playerId ? game.turnNumber + 1 : game.turnNumber,
        roundNumber:
          game.currentTurnPlayerId === playerId && currentIndex === activePlayers.length - 1
            ? game.roundNumber + 1
            : game.roundNumber,
      });
    }

    return {
      armyRemoved: remainingUnits.length === 0,
      message: `Dismissed ${UNIT_TYPES[unit.typeId].name} for ${cost} supplies.`,
    };
  });
}

export async function separateUnitFromArmy(gameId: string, armyId: string, unitId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, armySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(armyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !armySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const unit = army.units.find((candidate) => candidate.id === unitId);
    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only separate squads during your turn.');
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (!unit) throw new Error('That squad is no longer in this unit.');
    if (army.units.length <= 1) throw new Error('That squad is already operating alone.');

    const tileRef = doc(db, 'games', gameId, 'tiles', army.tileId);
    const tileSnap = await transaction.get(tileRef);
    if (!tileSnap.exists()) throw new Error('Unit tile is missing.');
    const sourceTile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;
    const neighborTiles = await Promise.all(
      getNeighborTileIds(sourceTile, game.mapWidth, game.mapHeight).map(async (tileId) => {
        const neighborRef = doc(db, 'games', gameId, 'tiles', tileId);
        const neighborSnap = await transaction.get(neighborRef);
        return neighborSnap.exists() ? { ref: neighborRef, tile: { id: neighborSnap.id, ...neighborSnap.data() } as TileDoc } : null;
      }),
    );
    const spawnTarget = neighborTiles
      .filter((entry): entry is { ref: ReturnType<typeof doc>; tile: TileDoc } => entry !== null)
      .find(({ tile }) => !tile.armyId && !isImpassableTerrain(tile));
    if (!spawnTarget) throw new Error('No adjacent open tile to separate into.');

    const remainingUnits = army.units.filter((candidate) => candidate.id !== unitId);
    const newArmyRef = doc(collection(db, 'games', gameId, 'armies'));
    const newArmy: ArmyDoc = {
      id: newArmyRef.id,
      ownerId: playerId,
      tileId: spawnTarget.tile.id,
      units: [unit],
      hasMovedThisTurn: army.hasMovedThisTurn,
      hasActedThisTurn: army.hasActedThisTurn,
      movementUsedThisTurn: army.movementUsedThisTurn ?? 0,
      lastMoveDirection: army.lastMoveDirection ?? 'south',
    };
    transaction.update(armyRef, { units: remainingUnits });
    transaction.set(newArmyRef, {
      ownerId: newArmy.ownerId,
      tileId: newArmy.tileId,
      units: newArmy.units,
      hasMovedThisTurn: newArmy.hasMovedThisTurn,
      hasActedThisTurn: newArmy.hasActedThisTurn,
      movementUsedThisTurn: newArmy.movementUsedThisTurn,
      lastMoveDirection: newArmy.lastMoveDirection,
    });
    transaction.update(spawnTarget.ref, { armyId: newArmyRef.id });

    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const tiles = allTilesSnapshot.docs
      .map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc)
      .map((tile) => (tile.id === spawnTarget.tile.id ? { ...tile, armyId: newArmyRef.id } : tile));
    const armies = [
      ...allArmiesSnapshot.docs
        .map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc)
        .map((candidate) => (candidate.id === armyId ? { ...candidate, units: remainingUnits } : candidate)),
      newArmy,
    ];
    transaction.update(playerRef, { exploredTileIds: exploredTileIdsFor(player, tiles, armies) });

    return {
      newArmyId: newArmyRef.id,
      message: `${UNIT_TYPES[unit.typeId].name} separated into ${spawnTarget.tile.x}, ${spawnTarget.tile.y}.`,
    };
  });
}

export async function attackTile(gameId: string, attackerArmyId: string, targetTileId: string, playerId: string): Promise<AttackOutcome> {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const attackerRef = doc(db, 'games', gameId, 'armies', attackerArmyId);
    const targetTileRef = doc(db, 'games', gameId, 'tiles', targetTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, attackerSnap, targetTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(attackerRef),
      transaction.get(targetTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !attackerSnap.exists() || !targetTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const attacker = { id: attackerSnap.id, ...attackerSnap.data() } as ArmyDoc;
    const targetTile = { id: targetTileSnap.id, ...targetTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const fromTileRef = doc(db, 'games', gameId, 'tiles', attacker.tileId);
    const fromTileSnap = await transaction.get(fromTileRef);
    if (!fromTileSnap.exists()) throw new Error('Attacking unit tile is missing.');
    const fromTile = { id: fromTileSnap.id, ...fromTileSnap.data() } as TileDoc;

    if (game.currentTurnPlayerId !== playerId) throw new Error('It is not your turn.');

    let defender: ArmyDoc | null = null;
    let defenderRef: ReturnType<typeof doc> | null = null;
    if (targetTile.armyId) {
      defenderRef = doc(db, 'games', gameId, 'armies', targetTile.armyId);
      const defenderSnap = await transaction.get(defenderRef);
      if (!defenderSnap.exists()) throw new Error('Defending unit is missing.');
      defender = { id: defenderSnap.id, ...defenderSnap.data() } as ArmyDoc;
      if (defender.ownerId === playerId) throw new Error('You cannot attack your own unit.');
    }

    if (!defender && (!targetTile.base || targetTile.base.ownerId === playerId)) {
      throw new Error('There is no enemy target on that tile.');
    }
    const defendingOwnerId = defender?.ownerId ?? (targetTile.base?.ownerId !== playerId ? targetTile.base?.ownerId : null);
    let defendingPlayer: PlayerDoc | null = null;
    if (defendingOwnerId) {
      const defendingPlayerSnap = await transaction.get(doc(db, 'games', gameId, 'players', defendingOwnerId));
      defendingPlayer = defendingPlayerSnap.exists()
        ? ({ id: defendingPlayerSnap.id, ...defendingPlayerSnap.data() } as PlayerDoc)
        : null;
    }

    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allTiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const supportArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const supportArmies = supportArmiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    if (!canAttackTile(attacker, fromTile, targetTile, playerId, allTiles)) {
      throw new Error(
        isSoloArtilleryArmy(attacker)
          ? 'Target is out of artillery range or line of sight.'
          : 'Target is out of attack range or line of sight.',
      );
    }

    const isRangedArtilleryAttack = isSoloArtilleryArmy(attacker) && chebyshevDistance(fromTile, targetTile) > 1;
    const supportedByAdjacentArmy = supportArmies.some((supportArmy) => {
      if (supportArmy.id === attacker.id || supportArmy.ownerId !== playerId) return false;
      const supportTile = allTiles.find((tile) => tile.id === supportArmy.tileId);
      return Boolean(supportTile && manhattanDistance(fromTile, supportTile) === 1);
    });
    const defendingBase = targetTile.base?.ownerId !== playerId ? targetTile.base : null;
    const attackTalentBonus = (player.talents.attackTraining ?? 0) * 0.05;
    const supportTalentBonus = supportedByAdjacentArmy ? 0.1 + (player.talents.coordinatedAssault ?? 0) * 0.02 : 0;
    const defenseTalentBonus = (defendingPlayer?.talents.defensiveDrills ?? 0) * 0.05;
    const baseTalentDefenseBonus = defendingBase ? defendingPlayer?.talents.baseFortification ?? 0 : 0;
    const baseAuraDefenseBonus =
      defendingOwnerId && isInFriendlyBaseAura(targetTile, defendingOwnerId, allTiles) ? BASE_AURA_DEFENSE_BONUS : 0;
    const trenchAttackBonus = fromTile.trench ? TRENCH_ATTACK_BONUS : 0;
    const trenchDefenseBonus = targetTile.trench ? TRENCH_DEFENSE_BONUS : 0;
    const attackerCombinedArmsBonus = hasCombinedArms(attacker.units) ? 0.1 : 0;
    const defenderCombinedArmsBonus = defender && hasCombinedArms(defender.units) ? 0.1 : 0;
    const tankHunterBonus = defender?.units.some((unit) => unit.typeId === 'tank') && hasTankHunters(attacker.units) ? 0.25 : 0;
    const entrenchedInfantryBonus =
      defender &&
      hasEntrenchedInfantry(defender.units) &&
      (Boolean(targetTile.trench) || baseAuraDefenseBonus > 0)
        ? 0.15
        : 0;
    const siegeColumnBonus = defendingBase && hasSiegeColumn(attacker.units) ? 0.2 : 0;
    const fortifyAttackPenalty = (attacker.fortifyTurnsRemaining ?? 0) > 0 ? FORTIFY_ATTACK_MULTIPLIER : 1;
    const fortifyDefenseBonus = defender && (defender.fortifyTurnsRemaining ?? 0) > 0 ? FORTIFY_DEFENSE_MULTIPLIER : 1;
    const resolvedCombat = resolveCombat(
      attacker.units,
      defender?.units ?? [],
      targetTile.terrainType,
      defendingBase,
      (1 + attackTalentBonus + supportTalentBonus + attackerCombinedArmsBonus + tankHunterBonus + siegeColumnBonus) *
        fortifyAttackPenalty,
      (1 + defenseTalentBonus + defenderCombinedArmsBonus + entrenchedInfantryBonus) * fortifyDefenseBonus,
      baseTalentDefenseBonus + baseAuraDefenseBonus + trenchDefenseBonus,
      trenchAttackBonus,
    );
    const combat = isRangedArtilleryAttack ? { ...resolvedCombat, attackerLosses: 0 } : resolvedCombat;
    const remainingAttackers = removeUnitLosses(attacker.units, combat.attackerLosses, 'attacker');
    const remainingDefenders = defender ? removeUnitLosses(defender.units, combat.defenderLosses, 'defender') : [];
    const xpGained =
      XP_ATTACK +
      combat.defenderLosses * XP_DESTROY_UNIT +
      (defender && remainingDefenders.length === 0 ? XP_DESTROY_ARMY : 0) +
      (combat.baseDestroyed ? XP_DESTROY_BASE : 0);
    const suppliesGained =
      combat.defenderLosses * SUPPLIES_DESTROY_UNIT +
      (defender && remainingDefenders.length === 0 ? SUPPLIES_DESTROY_ARMY : 0) +
      (combat.baseDestroyed ? SUPPLIES_DESTROY_BASE : 0);
    const defenderSuppliesGained =
      defender && remainingAttackers.length === 0
        ? combat.attackerLosses * SUPPLIES_DESTROY_UNIT + SUPPLIES_DESTROY_ARMY
        : 0;
    const unitXpGained =
      combat.defenderLosses * UNIT_XP_DESTROY_UNIT +
      (defender && remainingDefenders.length === 0 ? UNIT_XP_DESTROY_ARMY : 0);
    const leveledAttackers = applyUnitXp(remainingAttackers, unitXpGained);

    if (remainingAttackers.length === 0) {
      transaction.delete(attackerRef);
      transaction.update(fromTileRef, { armyId: null });
    } else {
      transaction.update(attackerRef, {
        units: leveledAttackers,
        hasActedThisTurn: true,
      });
    }

    if (defender && remainingDefenders.length === 0 && defenderRef) {
      transaction.delete(defenderRef);
      transaction.update(targetTileRef, {
        armyId: null,
        base: combat.baseDestroyed ? null : targetTile.base,
        ownerId: combat.baseDestroyed ? null : targetTile.ownerId,
      });
    } else if (defender && defenderRef) {
      transaction.update(defenderRef, { units: remainingDefenders });
    } else if (combat.baseDestroyed) {
      transaction.update(targetTileRef, { base: null, ownerId: null });
    }

    const [playersSnapshot, tilesSnapshot, armiesSnapshot] = await Promise.all([
      getDocs(collection(db, 'games', gameId, 'players')),
      getDocs(collection(db, 'games', gameId, 'tiles')),
      getDocs(collection(db, 'games', gameId, 'armies')),
    ]);
    const players = playersSnapshot.docs.map((playerDoc) => ({ id: playerDoc.id, ...playerDoc.data() }) as PlayerDoc);
    const updatedTiles = tilesSnapshot.docs.map((tileDoc) => {
      const tileData = { id: tileDoc.id, ...tileDoc.data() } as TileDoc;
      if (tileData.id === targetTile.id) {
        return {
          ...tileData,
          armyId: defender && remainingDefenders.length === 0 ? null : tileData.armyId,
          base: combat.baseDestroyed ? null : tileData.base,
        };
      }
      if (tileData.id === fromTile.id && remainingAttackers.length === 0) return { ...tileData, armyId: null };
      return tileData;
    });
    const updatedArmies = armiesSnapshot.docs
      .map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc)
      .filter((armyDoc) => armyDoc.id !== (remainingAttackers.length === 0 ? attacker.id : ''))
      .filter((armyDoc) => armyDoc.id !== (defender && remainingDefenders.length === 0 ? defender.id : ''));
    const eliminatedPlayerIds = players
      .filter((candidate) => !candidate.isEliminated && candidate.id !== playerId)
      .filter((candidate) => shouldEliminatePlayer(candidate.id, updatedTiles, updatedArmies))
      .map((candidate) => candidate.id);
    eliminatedPlayerIds.forEach((eliminatedPlayerId) => {
      transaction.update(doc(db, 'games', gameId, 'players', eliminatedPlayerId), { isEliminated: true });
    });

    transaction.update(playerRef, {
      supplies: player.supplies + suppliesGained,
      ...applyXp(player, xpGained),
    });
    if (defender && defenderSuppliesGained > 0) {
      const defenderPlayer = players.find((candidate) => candidate.id === defender.ownerId);
      if (defenderPlayer) {
        transaction.update(doc(db, 'games', gameId, 'players', defender.ownerId), {
          supplies: defenderPlayer.supplies + defenderSuppliesGained,
        });
      }
    }

    const resultLine =
      `Attack ${combat.attackPower} vs defense ${combat.defensePower} ` +
      `(rolls ${combat.attackRoll}/${combat.defenseRoll}). ` +
      `Losses: you ${combat.attackerLosses}, enemy ${combat.defenderLosses}. ` +
      `+${xpGained} XP, +${suppliesGained} supplies.`;
    const defenderRewardMessage =
      defenderSuppliesGained > 0 ? ` Defender earned +${defenderSuppliesGained} supplies for destroying the attacker.` : '';
    const supportMessage = combat.attackSupportBonus > 0 ? ` Attack bonuses added +${combat.attackSupportBonus} attack.` : '';
    const unitXpMessage = unitXpGained > 0 ? ` Surviving attackers gained ${unitXpGained} squad XP.` : '';
    const message = remainingAttackers.length === 0
      ? `${resultLine}${supportMessage}${defenderRewardMessage} Your attacking unit was destroyed.`
      : combat.baseDestroyed
        ? `${resultLine}${supportMessage} Enemy base destroyed.`
        : defender && remainingDefenders.length === 0
          ? `${resultLine}${supportMessage} Enemy unit destroyed.`
          : `${resultLine}${supportMessage}`;
    const eliminationMessage =
      eliminatedPlayerIds.length > 0
        ? ` Eliminated ${eliminatedPlayerIds
            .map((id) => players.find((candidate) => candidate.id === id)?.name ?? 'a player')
            .join(', ')}.`
        : '';

    return {
      ...combat,
      message: `${message}${unitXpMessage}${eliminationMessage}`,
      attackerTileId: fromTile.id,
      defenderTileId: targetTile.id,
      xpGained,
      suppliesGained,
      defenderSuppliesGained,
      unitXpGained,
    };
  });
}

export async function recruitUnitAtBase(gameId: string, baseTileId: string, unitTypeId: UnitTypeId, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const baseTileRef = doc(db, 'games', gameId, 'tiles', baseTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, baseTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(baseTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !baseTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const baseTile = { id: baseTileSnap.id, ...baseTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const unitType = UNIT_TYPES[unitTypeId];
    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allTiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const allArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const allArmies = allArmiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const effectiveBaseTiles = allTiles.map((tile) => (tile.id === baseTile.id ? baseTile : tile));
    const sharedBarracksLevel = effectiveBarracksLevel(baseTile, effectiveBaseTiles, allArmies);

    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only recruit during your turn.');
    if (!baseTile.base || baseTile.base.ownerId !== playerId) throw new Error('You do not control that base.');
    if (!isUnitUnlocked(unitTypeId, sharedBarracksLevel)) throw new Error(`${unitType.name} is not unlocked here.`);

    const cost = unitCostForPlayer(unitType.cost, player);
    if (player.supplies < cost) throw new Error(`You need ${cost} supplies to recruit ${unitType.name}.`);

    const playerArmiesSnapshot = await getDocs(query(collection(db, 'games', gameId, 'armies'), where('ownerId', '==', playerId)));
    const deployedUnitCount = playerArmiesSnapshot.docs.reduce((total, armyDoc) => {
      const army = armyDoc.data() as ArmyDoc;
      return total + army.units.length;
    }, 0);
    if (deployedUnitCount >= MAX_DEPLOYED_UNITS) {
      throw new Error(`You already have the maximum ${MAX_DEPLOYED_UNITS} squads deployed.`);
    }

    const neighborTiles = await Promise.all(
      getNeighborTileIds(baseTile, game.mapWidth, game.mapHeight).map(async (tileId) => {
        const tileRef = doc(db, 'games', gameId, 'tiles', tileId);
        const tileSnap = await transaction.get(tileRef);
        return tileSnap.exists() ? ({ ref: tileRef, tile: { id: tileSnap.id, ...tileSnap.data() } as TileDoc }) : null;
      }),
    );
    const deployTiles = neighborTiles.filter(
      (entry): entry is { ref: ReturnType<typeof doc>; tile: TileDoc } => entry !== null && !isImpassableTerrain(entry.tile),
    );
    const spawnTarget = deployTiles
      .filter((entry): entry is { ref: ReturnType<typeof doc>; tile: TileDoc } => entry !== null)
      .find(({ tile }) => !tile.armyId);

    const qualityLevel = baseTile.base.unitQualityByType?.[unitTypeId] ?? baseTile.base.unitQualityLevel ?? 1;
    const qualityBonus = Math.max(0, qualityLevel - 1);
    const newUnit = makeUnit(unitTypeId, qualityBonus);

    if (spawnTarget) {
      const armyRef = doc(collection(db, 'games', gameId, 'armies'));
      transaction.set(armyRef, {
        ownerId: playerId,
        tileId: spawnTarget.tile.id,
        units: [newUnit],
        hasMovedThisTurn: false,
        hasActedThisTurn: false,
        movementUsedThisTurn: 0,
      });
      transaction.update(spawnTarget.ref, { armyId: armyRef.id });
    } else if (unitTypeId === 'builder' || unitTypeId === 'artillery' || unitTypeId === 'recon') {
      throw new Error('No space to deploy.');
    } else {
      const adjacentArmyEntries = await Promise.all(
        deployTiles
          .filter(({ tile }) => tile.armyId)
          .map(async ({ tile }) => {
            const armyRef = doc(db, 'games', gameId, 'armies', tile.armyId!);
            const armySnap = await transaction.get(armyRef);
            return armySnap.exists() ? { ref: armyRef, army: { id: armySnap.id, ...armySnap.data() } as ArmyDoc } : null;
          }),
      );
      const mergeTarget = adjacentArmyEntries
        .filter((entry): entry is { ref: ReturnType<typeof doc>; army: ArmyDoc } => entry !== null)
        .find(
          ({ army }) =>
            army.ownerId === playerId &&
            armySpaceUsed(army.units) + UNIT_TYPES[unitTypeId].space <= ARMY_SPACE_CAPACITY &&
            !armyMustStaySolo(army),
        );
      if (!mergeTarget) throw new Error('No space to deploy.');

      transaction.update(mergeTarget.ref, {
        units: [...mergeTarget.army.units, newUnit],
      });
    }

    transaction.update(playerRef, {
      supplies: player.supplies - cost,
      ...applyXp(player, XP_RECRUIT_UNIT),
    });

    return `Recruited ${unitType.name} for ${cost} supplies. +${XP_RECRUIT_UNIT} XP.`;
  });
}

export async function recruitUnitCompositionAtBase(
  gameId: string,
  baseTileId: string,
  compositionId: string,
  playerId: string,
) {
  return runTransaction(db, async (transaction) => {
    const composition = UNIT_COMPOSITIONS.find((candidate) => candidate.id === compositionId);
    if (!composition) throw new Error('That unit composition is not available.');

    const gameRef = doc(db, 'games', gameId);
    const baseTileRef = doc(db, 'games', gameId, 'tiles', baseTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, baseTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(baseTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !baseTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const baseTile = { id: baseTileSnap.id, ...baseTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allTiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const allArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const allArmies = allArmiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const effectiveBaseTiles = allTiles.map((tile) => (tile.id === baseTile.id ? baseTile : tile));
    const sharedBarracksLevel = effectiveBarracksLevel(baseTile, effectiveBaseTiles, allArmies);

    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only recruit during your turn.');
    if (!baseTile.base || baseTile.base.ownerId !== playerId) throw new Error('You do not control that base.');

    const lockedUnit = composition.units.find((unitTypeId) => !isUnitUnlocked(unitTypeId, sharedBarracksLevel));
    if (lockedUnit) throw new Error(`${UNIT_TYPES[lockedUnit].name} is not unlocked here.`);

    const soloOnlyUnit = composition.units.find((unitTypeId) => unitTypeId === 'builder' || unitTypeId === 'recon' || unitTypeId === 'artillery');
    if (soloOnlyUnit) throw new Error(`${UNIT_TYPES[soloOnlyUnit].name} must operate solo.`);

    const totalSpace = composition.units.reduce((total, unitTypeId) => total + UNIT_TYPES[unitTypeId].space, 0);
    if (totalSpace > ARMY_SPACE_CAPACITY) throw new Error('That unit composition is too large.');

    const cost = composition.units.reduce((total, unitTypeId) => total + unitCostForPlayer(UNIT_TYPES[unitTypeId].cost, player), 0);
    if (player.supplies < cost) throw new Error(`You need ${cost} supplies to recruit ${composition.name}.`);

    const deployedUnitCount = allArmies
      .filter((army) => army.ownerId === playerId)
      .reduce((total, army) => total + army.units.length, 0);
    if (deployedUnitCount + composition.units.length > MAX_DEPLOYED_UNITS) {
      throw new Error(`You can only have ${MAX_DEPLOYED_UNITS} squads deployed.`);
    }

    const neighborTiles = await Promise.all(
      getNeighborTileIds(baseTile, game.mapWidth, game.mapHeight).map(async (tileId) => {
        const tileRef = doc(db, 'games', gameId, 'tiles', tileId);
        const tileSnap = await transaction.get(tileRef);
        return tileSnap.exists() ? ({ ref: tileRef, tile: { id: tileSnap.id, ...tileSnap.data() } as TileDoc }) : null;
      }),
    );
    const spawnTarget = neighborTiles
      .filter((entry): entry is { ref: ReturnType<typeof doc>; tile: TileDoc } => entry !== null)
      .find(({ tile }) => !tile.armyId && !isImpassableTerrain(tile));
    if (!spawnTarget) throw new Error('No space to deploy.');

    const newUnits = composition.units.map((unitTypeId) => {
      const qualityLevel = baseTile.base!.unitQualityByType?.[unitTypeId] ?? baseTile.base!.unitQualityLevel ?? 1;
      return makeUnit(unitTypeId, Math.max(0, qualityLevel - 1));
    });
    const armyRef = doc(collection(db, 'games', gameId, 'armies'));
    transaction.set(armyRef, {
      ownerId: playerId,
      tileId: spawnTarget.tile.id,
      units: newUnits,
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
    });
    transaction.update(spawnTarget.ref, { armyId: armyRef.id });
    transaction.update(playerRef, {
      supplies: player.supplies - cost,
      ...applyXp(player, XP_RECRUIT_UNIT * composition.units.length),
    });

    return `Recruited ${composition.name} for ${cost} supplies. +${XP_RECRUIT_UNIT * composition.units.length} XP.`;
  });
}

export async function buildBaseWithBuilder(gameId: string, builderArmyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const builderArmyRef = doc(db, 'games', gameId, 'armies', builderArmyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, builderArmySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(builderArmyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !builderArmySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const builderArmy = { id: builderArmySnap.id, ...builderArmySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const tileRef = doc(db, 'games', gameId, 'tiles', builderArmy.tileId);
    const tileSnap = await transaction.get(tileRef);
    if (!tileSnap.exists()) throw new Error('Logistics tile is missing.');
    const tile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;

    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only build during your turn.');
    if (builderArmy.ownerId !== playerId) throw new Error('You do not control that logistics squad.');
    if (builderArmy.hasActedThisTurn) throw new Error('That logistics squad has already acted this turn.');
    if (builderArmy.units.length !== 1 || builderArmy.units[0].typeId !== 'builder') {
      throw new Error('Only a solo Logistics squad can build a base.');
    }
    if (!canLogisticsBuildBase(builderArmy)) throw new Error('This Logistics squad cannot build bases yet.');
    if (tile.base) throw new Error('There is already a base on this tile.');
    if (player.supplies < BUILD_BASE_COST) throw new Error(`You need ${BUILD_BASE_COST} supplies to build a base.`);

    const tilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const tooCloseBase = tilesSnapshot.docs
      .map((baseTileDoc) => ({ id: baseTileDoc.id, ...baseTileDoc.data() }) as TileDoc)
      .some((otherTile) => otherTile.base && manhattanDistance(tile, otherTile) < 5);
    if (tooCloseBase) throw new Error('Bases must be at least 5 spaces from another base.');

    transaction.update(tileRef, {
      ownerId: playerId,
      base: { ownerId: playerId, barracksLevel: 1, unitQualityLevel: 1, defenseLevel: 1 },
      armyId: null,
    });
    transaction.delete(builderArmyRef);
    transaction.update(playerRef, {
      supplies: player.supplies - BUILD_BASE_COST,
      ...applyXp(player, XP_BUILD_BASE),
    });

    return `Built a new base for ${BUILD_BASE_COST} supplies. +${XP_BUILD_BASE} XP.`;
  });
}

export async function buildTrenchWithBuilder(gameId: string, builderArmyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const builderArmyRef = doc(db, 'games', gameId, 'armies', builderArmyId);
    const [gameSnap, builderArmySnap] = await Promise.all([transaction.get(gameRef), transaction.get(builderArmyRef)]);
    if (!gameSnap.exists() || !builderArmySnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const builderArmy = { id: builderArmySnap.id, ...builderArmySnap.data() } as ArmyDoc;
    const tileRef = doc(db, 'games', gameId, 'tiles', builderArmy.tileId);
    const tileSnap = await transaction.get(tileRef);
    if (!tileSnap.exists()) throw new Error('Logistics tile is missing.');
    const tile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;

    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only build during your turn.');
    if (builderArmy.ownerId !== playerId) throw new Error('You do not control that logistics squad.');
    if (builderArmy.hasActedThisTurn) throw new Error('That logistics squad has already acted this turn.');
    if (builderArmy.units.length !== 1 || builderArmy.units[0].typeId !== 'builder') {
      throw new Error('Only a solo Logistics squad can build a trench.');
    }
    if (!canLogisticsBuildTrench(builderArmy)) throw new Error('Logistics needs to be L2 to build trenches.');
    if (tile.trench) throw new Error('There is already a trench on this tile.');
    if (isImpassableTerrain(tile)) throw new Error('You cannot build a trench on this terrain.');

    transaction.update(tileRef, {
      trench: { ownerId: playerId },
    });
    transaction.update(builderArmyRef, { hasActedThisTurn: true });

    return `Logistics squad dug a trench. Units on this tile gain +${TRENCH_ATTACK_BONUS} attack and +${TRENCH_DEFENSE_BONUS} defense.`;
  });
}

export async function scavengeSuppliesWithBuilder(gameId: string, builderArmyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const builderArmyRef = doc(db, 'games', gameId, 'armies', builderArmyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);
    const [gameSnap, builderArmySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(builderArmyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !builderArmySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const builderArmy = { id: builderArmySnap.id, ...builderArmySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;

    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only scavenge during your turn.');
    if (builderArmy.ownerId !== playerId) throw new Error('You do not control that logistics squad.');
    if (builderArmy.hasActedThisTurn) throw new Error('That logistics squad has already acted this turn.');
    if (builderArmy.units.length !== 1 || builderArmy.units[0].typeId !== 'builder') {
      throw new Error('Only a solo Logistics squad can scavenge supplies.');
    }
    if (!canLogisticsScavenge(builderArmy)) throw new Error('Logistics needs to be L3 to scavenge supplies.');

    transaction.update(playerRef, { supplies: player.supplies + LOGISTICS_SCAVENGE_SUPPLIES });
    transaction.update(builderArmyRef, { hasActedThisTurn: true });

    return `Logistics squad scavenged +${LOGISTICS_SCAVENGE_SUPPLIES} supplies.`;
  });
}

export async function healArmyWithMedic(gameId: string, armyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const [gameSnap, armySnap] = await Promise.all([transaction.get(gameRef), transaction.get(armyRef)]);
    if (!gameSnap.exists() || !armySnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only heal during your turn.');
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (!armyHasMedic(army.units)) throw new Error('This unit needs a Medic to heal.');
    if (army.hasMovedThisTurn || army.hasActedThisTurn) {
      throw new Error('Healing uses the unit turn, so it must be ready to move and act.');
    }

    const healedUnits = healUnits(army.units, MEDIC_ACTIVE_HEAL);
    transaction.update(armyRef, {
      units: healedUnits,
      hasMovedThisTurn: true,
      hasActedThisTurn: true,
      passiveHealSkippedRound: game.roundNumber,
    });

    return `Medic healed this unit for up to ${MEDIC_ACTIVE_HEAL} HP. Passive healing will skip this round.`;
  });
}

export async function placeMineWithAntiVehicle(gameId: string, armyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const [gameSnap, armySnap] = await Promise.all([transaction.get(gameRef), transaction.get(armyRef)]);
    if (!gameSnap.exists() || !armySnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    const tileRef = doc(db, 'games', gameId, 'tiles', army.tileId);
    const tileSnap = await transaction.get(tileRef);
    if (!tileSnap.exists()) throw new Error('Unit tile is missing.');
    const tile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;

    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only place mines during your turn.');
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (army.hasActedThisTurn) throw new Error('That unit has already acted this turn.');
    if (!army.units.some((unit) => unit.typeId === 'antiVehicle')) {
      throw new Error('This unit needs an Anti-Vehicle squad to place a mine.');
    }
    if (tile.mine) throw new Error('There is already a mine on this tile.');

    transaction.update(tileRef, {
      mine: { ownerId: playerId, damage: ANTI_VEHICLE_MINE_DAMAGE },
    });
    transaction.update(armyRef, { hasActedThisTurn: true });

    return `Anti-Vehicle squad placed a mine for ${ANTI_VEHICLE_MINE_DAMAGE} tank damage.`;
  });
}

export async function fortifyArmy(gameId: string, armyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const [gameSnap, armySnap] = await Promise.all([transaction.get(gameRef), transaction.get(armyRef)]);
    if (!gameSnap.exists() || !armySnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only fortify during your turn.');
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (army.hasActedThisTurn) throw new Error('That unit has already acted this turn.');

    transaction.update(armyRef, {
      hasMovedThisTurn: true,
      hasActedThisTurn: true,
      movementUsedThisTurn: 999,
      fortifyTurnsRemaining: FORTIFY_TURNS,
    });

    return `Unit fortified. Defense increased, attack reduced, and movement locked for ${FORTIFY_TURNS} turns.`;
  });
}

export async function upgradeBaseBarracks(gameId: string, baseTileId: string, playerId: string) {
  return upgradeBase(gameId, baseTileId, playerId, 'barracks');
}

export async function upgradeBaseDefense(gameId: string, baseTileId: string, playerId: string) {
  return upgradeBase(gameId, baseTileId, playerId, 'defense');
}

export async function upgradeBaseOffense(gameId: string, baseTileId: string, playerId: string) {
  return upgradeBase(gameId, baseTileId, playerId, 'offense');
}

export async function upgradeBaseUnitQuality(
  gameId: string,
  baseTileId: string,
  unitTypeId: UnitTypeId,
  playerId: string,
) {
  return upgradeBase(gameId, baseTileId, playerId, 'quality', unitTypeId);
}

export async function spendTalentPoint(gameId: string, playerId: string, talentId: TalentId) {
  return runTransaction(db, async (transaction) => {
    const playerRef = doc(db, 'games', gameId, 'players', playerId);
    const playerSnap = await transaction.get(playerRef);
    if (!playerSnap.exists()) throw new Error('Player not found.');

    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const talent = talentById(talentId);
    if (!talent) throw new Error('That talent does not exist.');
    if (player.talentPoints <= 0) throw new Error('You do not have any skill points.');

    const currentRank = player.talents[talentId] ?? 0;
    if (currentRank >= talent.maxRanks) throw new Error(`${talent.name} is already maxed.`);
    const prerequisite = previousTalentInBranch(talentId);
    if (prerequisite && (player.talents[prerequisite.id] ?? 0) <= 0) {
      throw new Error(`${prerequisite.name} needs at least 1 rank first.`);
    }

    const nextTalents = { ...player.talents, [talentId]: currentRank + 1 };
    transaction.update(playerRef, {
      talentPoints: player.talentPoints - 1,
      talents: nextTalents,
    });

    return `${talent.name} increased to rank ${currentRank + 1}.`;
  });
}

export async function endTurn(gameId: string, playerId: string) {
  await runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await transaction.get(gameRef);
    if (!gameSnap.exists()) throw new Error('Game not found.');
    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    if (game.currentTurnPlayerId !== playerId) throw new Error('It is not your turn.');

    const playersSnapshot = await getDocs(query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt')));
    const tilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const armiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const players = playersSnapshot.docs.map((player) => ({ id: player.id, ...player.data() }) as PlayerDoc);
    const tiles = tilesSnapshot.docs.map((tile) => ({ id: tile.id, ...tile.data() }) as TileDoc);
    const currentPlayerState = players.find((player) => player.id === playerId);
    if (currentPlayerState?.isEliminated) throw new Error('You have been eliminated.');
    const activePlayers = players.filter((player) => !player.isEliminated);
    if (activePlayers.length === 0) throw new Error('No active players remain.');
    const currentIndex = activePlayers.findIndex((player) => player.id === playerId);
    if (currentIndex < 0) throw new Error('You are no longer in this game.');
    const nextPlayer = activePlayers[(currentIndex + 1) % activePlayers.length];
    const nextRound = currentIndex === activePlayers.length - 1 ? game.roundNumber + 1 : game.roundNumber;
    const nextTurn = game.turnNumber + 1;
    const isRoundEnding = nextRound > game.roundNumber;

    const armies = armiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const nextIncome = suppliesFromBases(nextPlayer, tiles, armies);
    transaction.update(doc(db, 'games', gameId, 'players', nextPlayer.id), {
      supplies: nextPlayer.supplies + nextIncome,
    });
    const currentPlayer = players.find((player) => player.id === playerId);
    if (currentPlayer) {
      const ownedBaseCount = tiles.filter((tile) => tile.base?.ownerId === playerId).length;
      const endTurnXp = XP_END_TURN + ownedBaseCount * XP_PER_BASE_AT_TURN_END;
      transaction.update(doc(db, 'games', gameId, 'players', playerId), applyXp(currentPlayer, endTurnXp));
    }
    armiesSnapshot.docs.forEach((armyDoc) => {
      const army = armyDoc.data() as ArmyDoc;
      const armyUpdates: Partial<ArmyDoc> = {};
      if (isRoundEnding && army.units.length > 0) {
        const passivelyHealedUnits =
          armyHasMedic(army.units) && army.passiveHealSkippedRound !== game.roundNumber
            ? healUnits(
                army.units,
                MEDIC_PASSIVE_HEAL + (hasFieldHospital(army.units) ? FIELD_HOSPITAL_PASSIVE_HEAL_BONUS : 0),
              )
            : army.units;
        const fullHealthXp =
          armyCurrentHealth(passivelyHealedUnits) >= armyMaxHealth(passivelyHealedUnits)
            ? army.units.length * UNIT_XP_FULL_HEALTH_END_ROUND
            : 0;
        armyUpdates.units = applyUnitXp(passivelyHealedUnits, fullHealthXp);
      }
      if (army.ownerId === nextPlayer.id) {
        const fortifyTurnsRemaining = army.fortifyTurnsRemaining ?? 0;
        const isMovementLocked = fortifyTurnsRemaining > 0;
        armyUpdates.hasMovedThisTurn = isMovementLocked;
        armyUpdates.hasActedThisTurn = false;
        armyUpdates.movementUsedThisTurn = isMovementLocked ? 999 : 0;
        armyUpdates.fortifyTurnsRemaining = Math.max(0, fortifyTurnsRemaining - 1);
      }
      if (Object.keys(armyUpdates).length > 0) transaction.update(armyDoc.ref, armyUpdates);
    });
    transaction.update(gameRef, {
      currentTurnPlayerId: nextPlayer.id,
      turnNumber: nextTurn,
      roundNumber: nextRound,
    });
  });
}

async function createPlayer(gameId: string, user: User, playerName: string, colorIndex: number) {
  await setDoc(doc(db, 'games', gameId, 'players', user.uid), {
    name: playerName.trim() || 'Anonymous Commander',
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    supplies: STARTING_SUPPLIES,
    xp: 0,
    level: 1,
    talentPoints: 0,
    talents: {},
    isEliminated: false,
    exploredTileIds: [],
    joinedAt: serverTimestamp(),
  });
}

function makeGameCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makeTerrain(): TileDoc[] {
  const tiles: TileDoc[] = [];
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const terrainType = terrainForCoords(x, y);
      tiles.push({
        id: tileIdFromCoords(x, y),
        x,
        y,
        terrainType,
        ownerId: null,
        armyId: null,
        base: null,
        mine: null,
        trench: null,
      });
    }
  }
  return tiles;
}

function terrainForCoords(x: number, y: number): TileDoc['terrainType'] {
  if (isProtectedStartArea(x, y)) return 'plains';

  const waterBand = (x >= 7 && x <= 10 && y >= 3 && y <= 14) || (y >= 12 && y <= 14 && x >= 3 && x <= 8);
  const waterScatter = (x * 11 + y * 7) % 37 === 0;
  if (waterBand || waterScatter) return 'water';

  const mountainRidge = (x >= 13 && x <= 15 && y >= 4 && y <= 16) || (x >= 4 && x <= 6 && y >= 9 && y <= 17);
  const mountainScatter = (x * 5 + y * 13) % 41 === 0;
  if (mountainRidge || mountainScatter) return 'mountain';

  if ((x + y) % 9 === 0) return 'forest';
  if ((x * y) % 17 === 0) return 'hill';
  return 'plains';
}

function isProtectedStartArea(x: number, y: number) {
  return STARTING_POSITIONS.some((start) => Math.abs(start.x - x) + Math.abs(start.y - y) <= 2);
}

function shouldEliminatePlayer(playerId: string, tiles: TileDoc[], armies: ArmyDoc[]) {
  const hasBase = tiles.some((tile) => tile.base?.ownerId === playerId);
  const hasArmy = armies.some((army) => army.ownerId === playerId && army.units.length > 0);
  return !hasBase && !hasArmy;
}

function isInFriendlyBaseAura(tile: TileDoc, ownerId: string, tiles: TileDoc[]) {
  return tiles.some(
    (baseTile) =>
      baseTile.base?.ownerId === ownerId &&
      Math.max(Math.abs(baseTile.x - tile.x), Math.abs(baseTile.y - tile.y)) <= 1,
  );
}

function directionFromTiles(from: TileDoc, to: TileDoc): MoveDirection {
  if (to.x > from.x) return 'east';
  if (to.x < from.x) return 'west';
  if (to.y < from.y) return 'north';
  return 'south';
}

function exploredTileIdsFor(player: PlayerDoc, tiles: TileDoc[], armies: ArmyDoc[]) {
  return Array.from(new Set([...(player.exploredTileIds ?? []), ...visibleTileIdsForPlayer(player.id, tiles, armies)]));
}

function getNeighborTileIds(tile: TileDoc, mapWidth: number, mapHeight: number) {
  return [
    { x: tile.x + 1, y: tile.y },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x, y: tile.y - 1 },
  ]
    .filter(({ x, y }) => x >= 0 && y >= 0 && x < mapWidth && y < mapHeight)
    .map(({ x, y }) => tileIdFromCoords(x, y));
}

function isUnitUnlocked(unitTypeId: UnitTypeId, barracksLevel: number) {
  return UPGRADE_CONFIG.barracks
    .filter((level) => level.level <= barracksLevel)
    .flatMap((level) => level.unlocks)
    .includes(unitTypeId);
}

async function upgradeBase(
  gameId: string,
  baseTileId: string,
  playerId: string,
  upgradeType: 'barracks' | 'quality' | 'defense' | 'offense',
  unitTypeId?: UnitTypeId,
) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const baseTileRef = doc(db, 'games', gameId, 'tiles', baseTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, baseTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(baseTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !baseTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const baseTile = { id: baseTileSnap.id, ...baseTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;

    if (game.currentTurnPlayerId !== playerId) throw new Error('You can only upgrade during your turn.');
    if (!baseTile.base || baseTile.base.ownerId !== playerId) throw new Error('You do not control that base.');

    const currentBase = baseTile.base;
    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allTiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const allArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const allArmies = allArmiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const effectiveBaseTiles = allTiles.map((tile) => (tile.id === baseTile.id ? baseTile : tile));
    const sharedBarracksLevel = effectiveBarracksLevel(baseTile, effectiveBaseTiles, allArmies);
    const nextBase = { ...currentBase, unitQualityByType: { ...(currentBase.unitQualityByType ?? {}) } };
    let cost = 0;
    let message = '';

    if (upgradeType === 'barracks') {
      const nextConfig = UPGRADE_CONFIG.barracks.find((level) => level.level === currentBase.barracksLevel + 1);
      if (!nextConfig?.cost) throw new Error('Barracks are already at max level.');
      cost = upgradeCostForPlayer(nextConfig.cost, player);
      nextBase.barracksLevel = nextConfig.level;
      message = `Barracks upgraded to L${nextConfig.level}.`;
    }

    if (upgradeType === 'defense') {
      const nextConfig = UPGRADE_CONFIG.baseDefense.find((level) => level.level === currentBase.defenseLevel + 1);
      if (!nextConfig?.cost) throw new Error('Base defense is already at max level.');
      cost = upgradeCostForPlayer(nextConfig.cost, player);
      nextBase.defenseLevel = nextConfig.level;
      message = `Base defense upgraded to L${nextConfig.level}.`;
    }

    if (upgradeType === 'offense') {
      const currentOffenseLevel = currentBase.offenseLevel ?? 1;
      const nextConfig = UPGRADE_CONFIG.baseOffense.find((level) => level.level === currentOffenseLevel + 1);
      if (!nextConfig?.cost) throw new Error('Base sentry is already at max level.');
      cost = upgradeCostForPlayer(nextConfig.cost, player);
      nextBase.offenseLevel = nextConfig.level;
      message = `Base sentry upgraded to L${nextConfig.level}.`;
    }

    if (upgradeType === 'quality') {
      if (!unitTypeId) throw new Error('Choose a squad quality to upgrade.');
      if (!isUnitUnlocked(unitTypeId, sharedBarracksLevel)) {
        throw new Error(`${UNIT_TYPES[unitTypeId].name} is not unlocked here.`);
      }
      const currentQuality = currentBase.unitQualityByType?.[unitTypeId] ?? currentBase.unitQualityLevel ?? 1;
      const nextConfig = UPGRADE_CONFIG.unitQuality.find((level) => level.level === currentQuality + 1);
      if (!nextConfig?.cost) throw new Error(`${UNIT_TYPES[unitTypeId].name} quality is already maxed.`);
      cost = upgradeCostForPlayer(nextConfig.cost, player);
      nextBase.unitQualityByType![unitTypeId] = nextConfig.level;
      message = `${UNIT_TYPES[unitTypeId].name} quality upgraded to L${nextConfig.level}.`;
    }

    if (player.supplies < cost) throw new Error(`You need ${cost} supplies for that upgrade.`);

    transaction.update(baseTileRef, { base: nextBase });
    transaction.update(playerRef, {
      supplies: player.supplies - cost,
      ...applyXp(player, XP_UPGRADE_BASE),
    });

    return `${message} Spent ${cost} supplies. +${XP_UPGRADE_BASE} XP.`;
  });
}

function unitCostForPlayer(baseCost: number, player: PlayerDoc) {
  const productionDiscount = (player.talents.quartermaster ?? 0) * 0.05;
  return Math.max(1, Math.ceil(baseCost * (1 - productionDiscount)));
}

function upgradeCostForPlayer(baseCost: number, player: PlayerDoc) {
  const engineeringDiscount = (player.talents.quartermaster ?? 0) * 0.05;
  return Math.max(1, Math.ceil(baseCost * (1 - engineeringDiscount)));
}

function makeUnit(typeId: keyof typeof UNIT_TYPES, qualityBonus = 0): UnitInstance {
  const type = UNIT_TYPES[typeId];
  return {
    id: `${typeId}_${crypto.randomUUID()}`,
    typeId,
    attack: type.attack + qualityBonus,
    defense: type.defense + qualityBonus,
    qualityLevel: 1 + qualityBonus,
    level: 1,
    xp: 0,
    maxHealth: type.space,
    currentHealth: type.space,
  };
}
