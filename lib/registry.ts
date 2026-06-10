// Model capability registry (IntelBot v2.2). The router binds tier slots to
// concrete model ids here. All ids env-overridable. Prices (USD / 1M tokens)
// are for reference/logging only. Re-verify against provider docs before
// go-live (Rule #3). Pinned 2026-06-10 from the v2.2 amendment.

export const MODELS = {
  // Anthropic
  haiku: process.env.MODEL_HAIKU || "claude-haiku-4-5", // in 1 / out 5
  sonnet: process.env.MODEL_SONNET || "claude-sonnet-4-6", // in 3 / out 15
  opus: process.env.ANTHROPIC_MODEL || "claude-opus-4-8", // in 5 / out 25
  // OpenAI
  gptMini: process.env.MODEL_GPT_MINI || "gpt-5.4-mini", // in 0.75 / out 4.5
  gptFlagship: process.env.OPENAI_MODEL || "gpt-5.5", // in 5 / out 30
  // Perplexity
  sonar: process.env.MODEL_SONAR || "sonar", // in 1 / out 1, cited
  sonarPro: process.env.PERPLEXITY_MODEL || "sonar-reasoning-pro", // in 2 / out 8, cited
} as const;

export type Tier = 0 | 1 | 2 | 3;
export type Provider = "openai" | "anthropic" | "perplexity";
export type AnalystSpec = { provider: Provider; model: string; effort?: string; name: string };
export type RoutePlan = {
  tier: Tier;
  analysts: AnalystSpec[];
  synth: { model: string; effort?: string }; // always Anthropic
  effortLabel: string;
};

// Map a complexity tier (+ whether it needs live web data) to the cheapest
// model configuration that clears the quality bar. Opus is reserved for tier 3.
export function planForTier(tier: Tier, needsLiveData: boolean): RoutePlan {
  switch (tier) {
    case 0: // command / greeting / trivial
      return {
        tier,
        analysts: [],
        synth: { model: MODELS.haiku },
        effortLabel: "haiku",
      };
    case 1: // single factual lookup
      return {
        tier,
        analysts: needsLiveData
          ? [{ provider: "perplexity", model: MODELS.sonar, name: "Perplexity Sonar" }]
          : [{ provider: "anthropic", model: MODELS.haiku, name: "Claude Haiku" }],
        synth: { model: MODELS.haiku },
        effortLabel: "haiku",
      };
    case 2: // standard analysis / comparison
      return {
        tier,
        analysts: [
          { provider: "openai", model: MODELS.gptMini, effort: "medium", name: "GPT-5.4-mini" },
          ...(needsLiveData
            ? [{ provider: "perplexity" as const, model: MODELS.sonarPro, name: "Perplexity Sonar" }]
            : []),
        ],
        synth: { model: MODELS.sonnet, effort: "medium" },
        effortLabel: "sonnet · medium",
      };
    case 3: // complex / strategic / contradictory evidence — the full fan-out
    default:
      return {
        tier: 3,
        analysts: [
          { provider: "openai", model: MODELS.gptFlagship, effort: "high", name: "GPT-5.5" },
          { provider: "anthropic", model: MODELS.opus, effort: "high", name: "Claude Opus" },
          ...(needsLiveData
            ? [{ provider: "perplexity" as const, model: MODELS.sonarPro, name: "Perplexity Sonar" }]
            : []),
        ],
        synth: { model: MODELS.opus, effort: "high" },
        effortLabel: "opus · high",
      };
  }
}
