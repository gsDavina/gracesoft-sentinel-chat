/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-cross-package-internals",
      comment:
        "Packages may only import another package's public entry point (its `index.ts`/declared `exports`), never reach into another package's internals (e.g. `@gracesoft-sentinel/core/src/foo`).",
      severity: "error",
      from: {
        path: "^packages/([^/]+)/src",
      },
      to: {
        path: "^packages/(?!\\1)([^/]+)/src/(?!index\\.ts$).+",
        pathNot: "^packages/\\1/src",
      },
    },
    {
      name: "no-agent-to-channel-or-provider",
      comment:
        "agent-* packages must depend only on @gracesoft-sentinel/core contracts, never on concrete channel-* or provider-* packages.",
      severity: "error",
      from: {
        path: "^packages/agent-[^/]+/src",
      },
      to: {
        path: "^packages/(channel|provider)-[^/]+/src",
      },
    },
    {
      name: "no-channel-to-channel",
      comment: "channel-* packages must not import each other — each is an independent ChannelAdapter implementation.",
      severity: "error",
      from: {
        path: "^packages/channel-([^/]+)/src",
      },
      to: {
        path: "^packages/channel-(?!\\1)([^/]+)/src",
        pathNot: "^packages/channel-\\1/src",
      },
    },
    {
      name: "no-package-imports-app",
      comment:
        "packages/* must never depend on apps/* — apps are composition roots (leaves) that wire packages together, not something packages should reach into.",
      severity: "error",
      from: {
        path: "^packages/",
      },
      to: {
        path: "^apps/",
      },
    },
    {
      name: "no-app-to-app",
      comment: "apps/* are independent deployable services and must not import each other's internals.",
      severity: "error",
      from: {
        path: "^apps/([^/]+)/src",
      },
      to: {
        path: "^apps/(?!\\1)([^/]+)/src",
        pathNot: "^apps/\\1/src",
      },
    },
    {
      name: "no-orphans",
      comment: "Modules that no other module imports and that import nothing themselves are likely dead code. `public/` assets are excluded — they're loaded via a <script> tag, not an ES import, so dependency-cruiser can never see that edge.",
      severity: "warn",
      from: { orphan: true, pathNot: ["\\.d\\.ts$", "(^|/)index\\.ts$", "(^|/)public/"] },
      to: {},
    },
    {
      name: "no-circular",
      comment: "Circular dependencies make boundary/contract reasoning unreliable.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
    },
  },
};
