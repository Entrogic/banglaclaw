import { AgentCard } from "@a2a-js/sdk";

export const A2A_PATH = "/a2a";
const SCHEME = "banglaclawApiKey";
const TEXT = ["text/plain"];
const DEFAULT_DESCRIPTION =
  "Bangla-first assistant. It understands Bangla, Banglish and English and replies in the language and script of the message, using its configured skills, tools and knowledge base.";

export interface CardInput {
  name: string;
  version: string;
  description?: string;
  skills: { name: string; description: string; triggers: string[] }[];
}

type Skill = { id: string; name: string; description: string; tags: string[]; examples?: string[] };

function skills(input: CardInput): Skill[] {
  const chat: Skill = {
    id: "chat",
    name: "Chat",
    description: "General conversation and questions in Bangla, Banglish or English.",
    tags: ["bangla", "banglish", "bengali", "english"],
    examples: ["১৫০০ টাকার ১৫% ভ্যাট কত?", "amake ekta email likhe dao"],
  };
  return [chat, ...input.skills.map((s) => ({ id: s.name, name: s.name, description: s.description, tags: s.triggers.slice(0, 10) }))];
}

/**
 * The A2A v1.0 agent card as it goes on the wire (docs/25). JSON-RPC is the only binding, offered at
 * both protocol versions; every call needs the same bearer API key as /v1.
 */
export function agentCardJson(input: CardInput, baseUrl: string) {
  const url = `${baseUrl}${A2A_PATH}`;
  return {
    name: input.name,
    description: input.description ?? DEFAULT_DESCRIPTION,
    version: input.version,
    supportedInterfaces: [
      { url, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url, protocolBinding: "JSONRPC", protocolVersion: "0.3" },
    ],
    capabilities: { streaming: true, pushNotifications: false },
    securitySchemes: { [SCHEME]: { httpAuthSecurityScheme: { scheme: "Bearer", bearerFormat: "BanglaClaw API key (bck_…)", description: "A BanglaClaw API key with the run scope" } } },
    securityRequirements: [{ schemes: { [SCHEME]: { list: [] } } }],
    defaultInputModes: TEXT,
    defaultOutputModes: TEXT,
    skills: skills(input),
  };
}

/** The same card in the SDK's internal form, for DefaultRequestHandler. */
export function agentCard(input: CardInput, baseUrl: string): AgentCard {
  return AgentCard.fromJSON(agentCardJson(input, baseUrl));
}

/** The card for A2A v0.3 clients, which fetch it without an `A2A-Version` header. */
export function legacyAgentCardJson(input: CardInput, baseUrl: string) {
  const url = `${baseUrl}${A2A_PATH}`;
  return {
    protocolVersion: "0.3.0",
    name: input.name,
    description: input.description ?? DEFAULT_DESCRIPTION,
    version: input.version,
    url,
    preferredTransport: "JSONRPC",
    additionalInterfaces: [{ url, transport: "JSONRPC" }],
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false },
    securitySchemes: { [SCHEME]: { type: "http", scheme: "bearer", bearerFormat: "BanglaClaw API key (bck_…)", description: "A BanglaClaw API key with the run scope" } },
    security: [{ [SCHEME]: [] }],
    defaultInputModes: TEXT,
    defaultOutputModes: TEXT,
    skills: skills(input),
  };
}
