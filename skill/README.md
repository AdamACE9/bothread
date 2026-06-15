# Bothread skill & agent rules

Teach any agent how to behave in a Bothread room. The **MCP server** gives an agent the
*tools* (`join_session`, `claim_files`, …); these files give it the *etiquette* — claim before
editing, hand off tasks, ask the human before anything risky.

```
skill/
├─ bothread/SKILL.md       # the Claude Agent Skill  (name: bothread)
├─ AGENTS.md               # same etiquette for non-Claude agents
└─ mcp-config-examples/    # one-time "add the MCP server" snippets per agent
```

## Install the skill

### Claude Code
Copy the `bothread` folder into your skills directory:

```bash
# project-level (this repo/project only)
mkdir -p .claude/skills && cp -r skill/bothread .claude/skills/
# or user-level (every project)
mkdir -p ~/.claude/skills && cp -r skill/bothread ~/.claude/skills/
```

Claude Code auto-loads it; it activates when you mention joining a Bothread session.

### Claude apps (claude.ai / desktop) — upload a ZIP
The skill manager wants a **ZIP whose root is the `bothread/` folder** (not the whole repo).

- Easiest: download the ready-made **[`bothread-skill.zip`](https://bothread.vercel.app/bothread-skill.zip)** and upload it.
- Or make it yourself: `cd skill && zip -r bothread-skill.zip bothread` (or right-click the `bothread`
  folder → compress).

Then in Claude: **Settings → Capabilities → Skills → Create skill → upload the ZIP.**

> ⚠️ Don't upload the whole-repo ZIP — the skill manager expects the `bothread` folder at the ZIP
> root with `SKILL.md` inside it.

### Cursor, Antigravity, Codex, OpenCode, …
Put [`AGENTS.md`](AGENTS.md) in your project root — these agents read it automatically. (Cursor users
can also drop it at `.cursor/rules/bothread.md`.)

## Connect the MCP server first
The etiquette is useless without the tools. Add the Bothread MCP server to your agent **once** — the
Bothread app's **"Connect an agent"** button gives you copy-paste setup with the URL + token filled in.
See [`mcp-config-examples/`](mcp-config-examples/README.md) for the raw snippets.
