import { useEffect, useMemo, useState } from 'react';
import { TALENT_CONFIG, previousTalentInBranch, type TalentBranch } from '../../data/talentConfig';
import type { PlayerDoc, TalentId } from '../../types/gameTypes';

interface TalentTreeModalProps {
  player: PlayerDoc;
  isOpen: boolean;
  busyTalentId: TalentId | null;
  onSpendTalent: (talentId: TalentId) => Promise<void>;
  onClose: () => void;
}

const BRANCHES: Array<{ id: TalentBranch; name: string }> = [
  { id: 'attack', name: 'Attack' },
  { id: 'defense', name: 'Defense' },
  { id: 'progress', name: 'Progress' },
];

export default function TalentTreeModal({ player, isOpen, busyTalentId, onSpendTalent, onClose }: TalentTreeModalProps) {
  const [queuedTalentIds, setQueuedTalentIds] = useState<TalentId[]>([]);
  const isSpending = busyTalentId !== null;

  useEffect(() => {
    if (!isOpen) {
      setQueuedTalentIds([]);
    }
  }, [isOpen]);

  const plannedTalents = useMemo(() => {
    const nextTalents = { ...player.talents };
    queuedTalentIds.forEach((talentId) => {
      nextTalents[talentId] = (nextTalents[talentId] ?? 0) + 1;
    });
    return nextTalents;
  }, [player.talents, queuedTalentIds]);

  if (!isOpen) return null;

  const queuedCount = queuedTalentIds.length;
  const availablePoints = Math.max(0, player.talentPoints - queuedCount);

  function canQueueTalent(talentId: TalentId, maxRanks: number) {
    const plannedRank = plannedTalents[talentId] ?? 0;
    const prerequisite = previousTalentInBranch(talentId);
    const hasPrerequisite = !prerequisite || (plannedTalents[prerequisite.id] ?? 0) > 0;
    return player.talentPoints > queuedCount && plannedRank < maxRanks && hasPrerequisite && !isSpending;
  }

  function queueTalent(talentId: TalentId, maxRanks: number) {
    if (!canQueueTalent(talentId, maxRanks)) return;
    setQueuedTalentIds((current) => [...current, talentId]);
  }

  function removeLastQueuedTalent(talentId: TalentId) {
    if (isSpending) return;
    const lastIndex = queuedTalentIds.lastIndexOf(talentId);
    if (lastIndex < 0) return;
    setQueuedTalentIds((current) => current.filter((_, index) => index !== lastIndex));
  }

  async function confirmTalents() {
    if (queuedTalentIds.length === 0 || isSpending) return;
    const talentsToSpend = [...queuedTalentIds];
    for (const talentId of talentsToSpend) {
      await onSpendTalent(talentId);
    }
    setQueuedTalentIds([]);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal talent-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Commander Skills</p>
            <h2>{availablePoints} Skill Points</h2>
          </div>
          {queuedCount > 0 && (
            <div className="talent-confirm">
              <span>{queuedCount} queued</span>
              <button className="secondary" type="button" disabled={isSpending} onClick={() => setQueuedTalentIds([])}>
                Clear
              </button>
              <button type="button" disabled={isSpending} onClick={confirmTalents}>
                {isSpending ? 'Confirming...' : 'Confirm'}
              </button>
            </div>
          )}
          <button className="secondary icon-button" onClick={onClose} aria-label="Close talent tree">
            X
          </button>
        </div>

        <div className="talent-tree">
          {BRANCHES.map((branch) => (
            <section className={`talent-branch ${branch.id}`} key={branch.id}>
              <h3>{branch.name}</h3>
              {TALENT_CONFIG.filter((talent) => talent.branch === branch.id).map((talent) => {
                const rank = player.talents[talent.id] ?? 0;
                const plannedRank = plannedTalents[talent.id] ?? 0;
                const queuedRanks = plannedRank - rank;
                const isMaxed = plannedRank >= talent.maxRanks;
                const prerequisite = previousTalentInBranch(talent.id);
                const isLocked = Boolean(prerequisite && (plannedTalents[prerequisite.id] ?? 0) <= 0);
                const canQueue = canQueueTalent(talent.id, talent.maxRanks);
                return (
                  <article
                    className={`talent-node ${canQueue ? 'available' : ''} ${isLocked ? 'locked' : ''} ${
                      queuedRanks > 0 ? 'queued' : ''
                    } ${isMaxed ? 'maxed' : ''}`}
                    key={talent.id}
                    role={canQueue ? 'button' : undefined}
                    tabIndex={canQueue ? 0 : undefined}
                    onClick={() => queueTalent(talent.id, talent.maxRanks)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        queueTalent(talent.id, talent.maxRanks);
                      }
                    }}
                  >
                    <div>
                      <strong>{talent.name}</strong>
                      <span>
                        Rank {plannedRank}/{talent.maxRanks}
                      </span>
                    </div>
                    <p>{talent.description}</p>
                    <p className="talent-effect">{talent.perRank}</p>
                    {isLocked && prerequisite && <p className="talent-note">Requires {prerequisite.name}</p>}
                    {queuedRanks > 0 && (
                      <button
                        className="secondary talent-remove"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeLastQueuedTalent(talent.id);
                        }}
                      >
                        Remove queued rank
                      </button>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
