import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function scriptedEchoProvider(bb: BbPluginApi): void {
  bb.providers.register({
    id: "scripted-echo",
    displayName: "Scripted echo",
    icon: "Zap",
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["medium"],
    },
    reasoningLevels: [{ id: "medium", label: "Medium" }],
    composerActions: [],
    strings: { signInHint: "Offline test provider.", expiredHint: "Never expires.", installUrl: "https://github.com/get-bb/bb", brandPrefix: "Scripted ", planModeCopy: "No plan mode.", iconTint: { light: "#b45309", dark: "#fcd34d" } },
    maintenance: { health: false, usage: false, installation: false },
    models: {
      fallback: [
        {
          id: "claude-sonnet-5-5",
          displayName: "Sonnet id on the scripted echo",
          description: "Scripted echo under a policy-accepted model id",
          supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
          defaultReasoningEffort: "medium",
          isDefault: false,
        },
        {
          id: "fake-model",
          displayName: "Fake Model",
          description: "Scripted echo",
          supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
    },
  });
}
