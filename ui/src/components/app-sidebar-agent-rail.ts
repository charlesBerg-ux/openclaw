import { html, nothing, type TemplateResult } from "lit";
import { normalizeAgentLabel } from "../lib/agents/display.ts";
import "../styles/app-sidebar-agent-rail.css";

/*
 * One row per agent, newest activity first.
 *
 * The current rail asks you to pick an agent before you can find a
 * conversation. This shows the agent and what it last said in one line, which
 * is how a messaging app behaves, and marks the ones with something new.
 *
 * Everything here already arrives on the wire: the gateway session row carries
 * agentId, lastMessagePreview, lastActivityAt, lastReadAt and markedUnreadAt.
 * Nothing is fetched and no transcript is read.
 *
 * Unread is deliberately two different signals, not one:
 *   - markedUnreadAt is a person marking a thread unread on purpose
 *   - lastActivityAt > lastReadAt is "something arrived since you looked"
 * Collapsing them would lose the distinction the wire bothers to make.
 */

type AgentRailHost = {
  activeChipAgent: () => {
    activeId: string;
    agent?: unknown;
    agents: readonly { id: string; name?: string }[];
    identity?: unknown;
    identities: ReadonlyMap<string, unknown>;
  };
  pinnedAgentIds: readonly string[];
  agentUnreadCount: (agentId: string) => number;
  switchChipAgent: (agentId: string) => void;
  sessionData: {
    sessionsResult?: { sessions?: readonly unknown[] } | undefined;
    sessionResultsByAgent?: Record<string, { sessions?: readonly unknown[] }>;
  };
};

type Latest = {
  at: number;
  preview: string;
  lastReadAt: number;
  markedUnreadAt: number;
};

const relativeDay = (ms: number): string => {
  if (!ms) return "";
  const then = new Date(ms);
  const now = new Date();
  const days = Math.round((now.setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return then.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: "short" });
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** Newest session per agent, from whatever rows the sidebar already holds. */
function latestByAgent(host: AgentRailHost): Map<string, Latest> {
  const byAgent = host.sessionData.sessionResultsByAgent ?? {};
  const rows: readonly unknown[] = [
    ...(host.sessionData.sessionsResult?.sessions ?? []),
    ...Object.values(byAgent).flatMap((result) => result?.sessions ?? []),
  ];
  const latest = new Map<string, Latest>();
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const agentId = typeof row.agentId === "string" ? row.agentId : "";
    if (!agentId) continue;
    const at = Number(row.lastActivityAt ?? row.updatedAt ?? 0) || 0;
    const existing = latest.get(agentId);
    if (existing && existing.at >= at) continue;
    latest.set(agentId, {
      at,
      preview: typeof row.lastMessagePreview === "string" ? row.lastMessagePreview : "",
      lastReadAt: Number(row.lastReadAt ?? 0) || 0,
      markedUnreadAt: Number(row.markedUnreadAt ?? 0) || 0,
    });
  }
  return latest;
}

/** A coloured ring per agent, stable for a given id rather than random per render. */
function ringHue(agentId: string): number {
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export function renderAppSidebarAgentRail(host: AgentRailHost): TemplateResult | typeof nothing {
  const { activeId, agents, identities } = host.activeChipAgent();
  if (!agents || agents.length === 0) return nothing;

  const latest = latestByAgent(host);
  const pinned = new Set(host.pinnedAgentIds ?? []);

  const ordered = [...agents].sort((a, b) => (latest.get(b.id)?.at ?? 0) - (latest.get(a.id)?.at ?? 0));

  return html`
    <div class="agent-rail" role="list" aria-label="Agents">
      ${ordered.map((agent) => {
        const info = latest.get(agent.id);
        const label = normalizeAgentLabel(
          agent as never,
          identities.get(agent.id) as never,
        );
        const initial = (label || agent.id).trim().charAt(0).toUpperCase();
        const unreadCount = host.agentUnreadCount(agent.id) || 0;
        const unseen = info ? info.at > info.lastReadAt && info.lastReadAt > 0 : false;
        const unread = unreadCount > 0 || Boolean(info?.markedUnreadAt) || unseen;
        const selected = agent.id === activeId;
        return html`
          <button
            class="agent-rail__row${selected ? " agent-rail__row--selected" : ""}"
            role="listitem"
            aria-current=${selected ? "true" : nothing}
            title=${label}
            @click=${() => host.switchChipAgent(agent.id)}
          >
            <span
              class="agent-rail__avatar"
              style="--agent-ring: hsl(${ringHue(agent.id)} 62% 45%)"
              aria-hidden="true"
              >${initial}</span
            >
            <span class="agent-rail__body">
              <span class="agent-rail__line">
                <span class="agent-rail__name">${label}</span>
                ${pinned.has(agent.id)
                  ? html`<span class="agent-rail__star" title="Favourite">★</span>`
                  : nothing}
                <span class="agent-rail__date">${info ? relativeDay(info.at) : ""}</span>
              </span>
              <span class="agent-rail__preview">${info?.preview || "No messages yet"}</span>
            </span>
            ${unread
              ? html`<span
                  class="agent-rail__unread"
                  title=${unreadCount > 0 ? `${unreadCount} unread` : "Unread"}
                  >${unreadCount > 9 ? "9+" : unreadCount > 0 ? String(unreadCount) : ""}</span
                >`
              : nothing}
          </button>
        `;
      })}
    </div>
  `;
}
