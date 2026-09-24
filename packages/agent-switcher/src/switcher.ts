import type { ConversationState, NormalizedMessage, NormalizedResponse, SessionStore } from "@gracesoft-sentinel/core";

export interface RegisteredAgent {
  /** Stable key, e.g. "concierge" — used internally and in the switch-confirmation message. */
  name: string;
  /** Human-friendly label shown to the chatter, e.g. "Sentinel Concierge". */
  label: string;
  /** One line on what this agent does, shown in the service map, e.g. "FAQs and appointment booking". */
  description?: string;
  /**
   * Phrases that switch *to* this agent — matched case-insensitively
   * against the chatter's *entire* trimmed message, not a substring search,
   * so an ordinary sentence that happens to contain a trigger word doesn't
   * accidentally switch mid-conversation.
   */
  triggers: string[];
  /**
   * Fully self-contained — already closes over this agent's own
   * session/provider/logging wiring, exactly like what a channel webhook
   * router is normally given. This package never sees any agent's own
   * `ConversationState` or dependencies, only this callback.
   */
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
}

export interface AgentSwitcherConfig {
  agents: RegisteredAgent[];
  /** `name` of the agent a chatter talks to before ever explicitly switching. Must be one of `agents`. */
  defaultAgent: string;
  /** Persists which agent is currently active per chatter — deliberately separate from any agent's own session store/key. */
  sessionStore: SessionStore;
  /** Defaults to `switcher:{channel}:{senderId}`; override if that would collide with something else sharing the same SessionStore. */
  sessionIdFor?: (message: NormalizedMessage) => string;
  /** How long the "which agent is active" choice survives with no messages. Defaults to 24h. */
  sessionTtlSeconds?: number;
  /**
   * Whole-message phrases that show the service map — every registered
   * agent, what it does, how to switch to it, and which one is active —
   * instead of forwarding to the active agent. Defaults to
   * "/services", "services", "/menu", "menu". Pass `[]` to turn it off.
   */
  serviceMapTriggers?: string[];
  /** Optional extra line at the bottom of the service map, e.g. how to delete your data. */
  serviceMapFooter?: string;
}

interface SwitcherContext {
  activeAgent?: string;
}

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_SERVICE_MAP_TRIGGERS = ["/services", "services", "/menu", "menu"];

/** The default key the switcher stores a chatter's active agent under — exported so a service's "delete my data" flow can erase it. */
export function switcherSessionIdFor(message: Pick<NormalizedMessage, "channel" | "senderId">): string {
  return `switcher:${message.channel}:${message.senderId}`;
}

function freshState(sessionId: string, message: NormalizedMessage): ConversationState {
  const now = new Date().toISOString();
  return { sessionId, channel: message.channel, userId: message.senderId, agent: "switcher", createdAt: now, updatedAt: now, context: {} };
}

function matchesTrigger(triggers: string[], value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return false;
  return triggers.some((trigger) => trigger.toLowerCase() === trimmed);
}

/**
 * Checks the tapped quick-reply id as well as the text: the service map's
 * buttons carry an agent's first trigger as their id, and some channels
 * (WhatsApp, Slack) put the button's *label* in `text`, not its id.
 */
function findTriggeredAgent(agents: RegisteredAgent[], message: NormalizedMessage): RegisteredAgent | undefined {
  return agents.find((agent) => matchesTrigger(agent.triggers, message.quickReplyId) || matchesTrigger(agent.triggers, message.text));
}

/**
 * The service map: a plain-text directory of every agent behind this
 * switcher, plus one quick-reply button per agent to jump straight to it.
 * Plain text on purpose — it renders the same on every channel.
 */
export function renderServiceMap(
  agents: RegisteredAgent[],
  activeAgent: string,
  options: { footer?: string; mapCommand?: string } = {}
): NormalizedResponse {
  const lines = agents.map((agent) => {
    const current = agent.name === activeAgent ? " (you're here)" : "";
    const description = agent.description ? ` — ${agent.description}` : "";
    const command = agent.triggers[0] ? ` Say "${agent.triggers[0]}".` : "";
    return `• ${agent.label}${current}${description}.${command}`;
  });
  const again = options.mapCommand ? ` Send ${options.mapCommand} any time to see this again.` : "";
  const text = ["Here's everything in this demo:", "", ...lines, "", `Tap one to switch.${again}`, ...(options.footer ? [options.footer] : [])].join("\n");
  return {
    text,
    quickReplies: agents.filter((agent) => agent.triggers[0]).map((agent) => ({ id: agent.triggers[0]!, label: agent.label })),
  };
}

/**
 * Wraps N independently-composed agents (each an already fully
 * self-contained `onMessage` callback) behind *one* `onMessage` a single
 * channel webhook can be pointed at, letting a chatter switch which one
 * they're talking to via a command or passphrase mid-conversation.
 *
 * Deliberately unaware of any specific agent's internals — `agent-concierge`
 * and `agent-cook` stay exactly as ignorant of each other as the boundary
 * lint already requires elsewhere in this monorepo; this package sits one
 * level above both, in the composition layer, not beside them. A trigger
 * match never reaches the active agent at all (it's handled here and
 * confirmed directly), so switching never shows up as a strange message in
 * either agent's own conversation history.
 */
export function createAgentSwitcher(config: AgentSwitcherConfig): (message: NormalizedMessage) => Promise<NormalizedResponse> {
  const sessionIdFor = config.sessionIdFor ?? switcherSessionIdFor;
  const ttlSeconds = config.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const byName = new Map(config.agents.map((agent) => [agent.name, agent]));
  const serviceMapTriggers = config.serviceMapTriggers ?? DEFAULT_SERVICE_MAP_TRIGGERS;
  const defaultAgent = byName.get(config.defaultAgent);
  if (!defaultAgent) {
    throw new Error(`createAgentSwitcher: defaultAgent "${config.defaultAgent}" is not in the agents list`);
  }

  return async (message: NormalizedMessage): Promise<NormalizedResponse> => {
    const sessionId = sessionIdFor(message);
    const state = (await config.sessionStore.get(sessionId)) ?? freshState(sessionId, message);
    const context = state.context as SwitcherContext;

    if (matchesTrigger(serviceMapTriggers, message.text) || matchesTrigger(serviceMapTriggers, message.quickReplyId)) {
      const active = (context.activeAgent && byName.get(context.activeAgent)) || defaultAgent;
      return renderServiceMap(config.agents, active.name, { footer: config.serviceMapFooter, mapCommand: serviceMapTriggers[0] });
    }

    const triggered = findTriggeredAgent(config.agents, message);
    if (triggered) {
      await config.sessionStore.set(
        { ...state, context: { activeAgent: triggered.name }, updatedAt: new Date().toISOString() },
        ttlSeconds
      );
      const mapHint = serviceMapTriggers[0] ? ` (Send ${serviceMapTriggers[0]} to see everything else in this demo.)` : "";
      return { text: `Switched to ${triggered.label}. Go ahead — say something to get started.${mapHint}` };
    }

    const active = (context.activeAgent && byName.get(context.activeAgent)) || defaultAgent;
    const response = await active.onMessage(message);

    // Re-persist even when nothing changed — same "defense in depth over a
    // merge-based store" reasoning as agent-concierge's withAiDisclosure:
    // silently losing which agent was active is worse than a redundant write.
    await config.sessionStore.set(
      { ...state, context: { activeAgent: active.name }, updatedAt: new Date().toISOString() },
      ttlSeconds
    );

    return response;
  };
}
