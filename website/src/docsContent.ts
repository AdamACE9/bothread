// Docs pages. Each page's body lives in src/docs/<slug>.md (imported as raw text),
// so the Markdown stays readable and needs no backtick escaping.
import introduction from "./docs/introduction.md?raw";
import quickstart from "./docs/quickstart.md?raw";
import setup from "./docs/setup.md?raw";
import connectAgents from "./docs/connect-agents.md?raw";
import rooms from "./docs/rooms.md?raw";
import collisionPrevention from "./docs/collision-prevention.md?raw";
import commitGuard from "./docs/commit-guard.md?raw";
import gitReview from "./docs/git-review.md?raw";
import coordination from "./docs/coordination.md?raw";
import tasks from "./docs/tasks.md?raw";
import humanControls from "./docs/human-controls.md?raw";
import timeouts from "./docs/timeouts.md?raw";
import cli from "./docs/cli.md?raw";
import mcpTools from "./docs/mcp-tools.md?raw";
import promptsResources from "./docs/prompts-resources.md?raw";
import configuration from "./docs/configuration.md?raw";
import security from "./docs/security.md?raw";
import architecture from "./docs/architecture.md?raw";
import faq from "./docs/faq.md?raw";
import troubleshooting from "./docs/troubleshooting.md?raw";
import forAgents from "./docs/for-agents.md?raw";

export type DocPage = {
  slug: string;
  title: string;
  group: string;
  markdown: string;
  /** Added in the current release: shown with a "new" badge in the sidebar. */
  isNew?: boolean;
};

export const DOCS_VERSION = "0.3.0";

export const DOC_GROUPS: string[] = ["Getting started", "Core concepts", "Reference", "Help"];

export const DOC_PAGES: DocPage[] = [
  { slug: "introduction", title: "Introduction", group: "Getting started", markdown: introduction },
  { slug: "quickstart", title: "Quickstart", group: "Getting started", markdown: quickstart },
  { slug: "setup", title: "One-command setup", group: "Getting started", markdown: setup, isNew: true },
  { slug: "connect-agents", title: "Connecting agents manually", group: "Getting started", markdown: connectAgents },

  { slug: "rooms", title: "Rooms & sessions", group: "Core concepts", markdown: rooms },
  { slug: "collision-prevention", title: "File claims & collisions", group: "Core concepts", markdown: collisionPrevention },
  { slug: "commit-guard", title: "Commit guard", group: "Core concepts", markdown: commitGuard, isNew: true },
  { slug: "git-review", title: "Per-agent git diff review", group: "Core concepts", markdown: gitReview },
  { slug: "coordination", title: "Talking, notes & hand-offs", group: "Core concepts", markdown: coordination },
  { slug: "tasks", title: "Tasks & dependencies", group: "Core concepts", markdown: tasks, isNew: true },
  { slug: "human-controls", title: "Human controls & approvals", group: "Core concepts", markdown: humanControls },
  { slug: "timeouts", title: "Timeouts & approvals", group: "Core concepts", markdown: timeouts, isNew: true },

  { slug: "cli", title: "CLI reference", group: "Reference", markdown: cli, isNew: true },
  { slug: "mcp-tools", title: "MCP tool reference", group: "Reference", markdown: mcpTools },
  { slug: "prompts-resources", title: "MCP prompts & resources", group: "Reference", markdown: promptsResources, isNew: true },
  { slug: "configuration", title: "Configuration", group: "Reference", markdown: configuration },
  { slug: "security", title: "Security model", group: "Reference", markdown: security, isNew: true },
  { slug: "architecture", title: "How it works (architecture)", group: "Reference", markdown: architecture },

  { slug: "faq", title: "FAQ", group: "Help", markdown: faq },
  { slug: "troubleshooting", title: "Troubleshooting", group: "Help", markdown: troubleshooting },
  { slug: "for-agents", title: "For AI agents", group: "Help", markdown: forAgents },
];
