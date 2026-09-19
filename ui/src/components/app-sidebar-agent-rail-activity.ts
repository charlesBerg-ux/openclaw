import type { SessionsListResult } from "../api/types.ts";
import { isMachineSessionRow } from "../lib/sessions/machine-rows.ts";

/*
 * Latest activity per agent, for the rail.
 *
 * The sidebar only loads sessions for the agent you currently have open, so
 * every other row had nothing to show and said "No messages yet" even for
 * agents with hundreds of messages. That also broke the ordering, because rows
 * cannot sort by most recent activity when most of them have no activity to
 * sort on.
 *
 * This asks the gateway once per agent and keeps the answer. It deliberately
 * does NOT write into the shared session store: that store holds the list you
 * are looking at, and a background read landing in it would swap the list out
 * from under you. This cache is read by the rail and by nothing else.
 *
 * Machine sessions are skipped for the same reason they are skipped in the
 * list. A row should say what the agent last said to you, not when a job last
 * ran.
 */

export type AgentActivity = {
  at: number;
  preview: string;
  lastReadAt: number;
  markedUnreadAt: number;
  unreadRows: number;
};

/** The part of the sessions controller this needs, and nothing else. */
type SessionLists = {
  subscribeList: (
    scope: Record<string, unknown>,
    listener: (snapshot: { result: SessionsListResult | null }) => void,
  ) => () => void;
};

/** Enough rows to find the newest real conversation past any machine rows. */
const ROWS_PER_AGENT = 30;

function newestConversation(result: SessionsListResult | undefined): AgentActivity | null {
  const rows = result?.sessions ?? [];
  let best: AgentActivity | null = null;
  let unreadRows = 0;
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key : "";
    if (!key || key.includes(":cron:")) continue;
    const spawnedBy = typeof row.spawnedBy === "string" ? row.spawnedBy : undefined;
    if (isMachineSessionRow({ key, spawnedBy })) continue;
    if (row.unread === true && row.archived !== true) unreadRows += 1;
    const at = Number(row.lastActivityAt ?? row.updatedAt ?? 0) || 0;
    if (best && best.at >= at) continue;
    best = {
      at,
      preview: typeof row.lastMessagePreview === "string" ? row.lastMessagePreview : "",
      lastReadAt: Number(row.lastReadAt ?? 0) || 0,
      markedUnreadAt: Number(row.markedUnreadAt ?? 0) || 0,
      unreadRows: 0,
    };
  }
  return best ? { ...best, unreadRows } : null;
}

export class AgentRailActivity {
  readonly #byAgent = new Map<string, AgentActivity>();
  readonly #subscriptions = new Map<string, () => void>();

  latest(agentId: string): AgentActivity | undefined {
    return this.#byAgent.get(agentId);
  }

  /** Drop every subscription, for a disconnect or a change of gateway. */
  reset(): void {
    for (const stop of this.#subscriptions.values()) stop();
    this.#subscriptions.clear();
    this.#byAgent.clear();
  }

  /**
   * Watch any agent not watched yet. Safe to call on every render: an agent is
   * subscribed once and the subscription then keeps the row current by itself.
   */
  hydrate(
    sessions: SessionLists | undefined,
    agentIds: readonly string[],
    onChange: () => void,
  ): void {
    if (!sessions) return;
    for (const agentId of agentIds) {
      if (!agentId || this.#subscriptions.has(agentId)) continue;
      // A scope that is not the primary one gets its own managed list, so this
      // never disturbs the list of the agent you currently have open.
      const scope = {
        agentId,
        limit: ROWS_PER_AGENT,
        includeLastMessage: true,
        includeDerivedTitles: true,
      };
      const stop = sessions.subscribeList(scope, (snapshot) => {
        const latest = newestConversation(snapshot.result ?? undefined);
        if (!latest) return;
        const previous = this.#byAgent.get(agentId);
        if (previous && previous.at === latest.at && previous.preview === latest.preview) return;
        this.#byAgent.set(agentId, latest);
        onChange();
      });
      this.#subscriptions.set(agentId, stop);
    }
  }
}
