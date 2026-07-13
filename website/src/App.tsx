import { useEffect } from "react";
import Background from "./components/Background";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import HowItWorks from "./components/HowItWorks";
import WhyDifferent from "./components/WhyDifferent";
import Waitlist from "./components/Waitlist";
import Feedback from "./components/Feedback";
import Footer from "./components/Footer";
import Reveal from "./components/Reveal";
import Setup from "./components/Setup";
import Press from "./components/Press";
import Docs from "./components/Docs";
import Faq from "./components/Faq";

type Route = "home" | "start" | "press" | "docs";

function currentRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/start") return "start";
  if (path === "/press") return "press";
  if (path === "/docs" || path.startsWith("/docs")) return "docs";
  return "home";
}

/** Per-route <title> + meta description so /start and /press aren't duplicates of home
 *  (a real SEO signal; the raw HTML already carries the home-page tags for crawlers). */
const ROUTE_META: Record<Route, { title: string; description: string }> = {
  home: {
    title: "Bothread — run your AI coding agents together on one codebase (local, MCP)",
    description:
      "Bothread is a free, open-source local app where the AI coding agents you already use — Claude Code, Cursor, Antigravity, Gemini CLI, Codex, OpenCode — work together on one codebase over MCP without overwriting each other, while you watch and approve every step. No API keys, no cloud.",
  },
  start: {
    title: "Get started with Bothread — connect your AI coding agents",
    description:
      "Install Bothread and connect your AI coding agents (Claude Code, Cursor, Antigravity, Gemini CLI, Codex, OpenCode) to one shared room in about two minutes. Free, local, no API keys.",
  },
  press: {
    title: "Bothread — press & media kit",
    description:
      "Press kit for Bothread: the one-liner, boilerplate, fast facts, links, and logo assets. Free, open-source local coordination for multiple AI coding agents on one codebase.",
  },
  docs: {
    title: "Bothread docs — run multiple AI coding agents on one codebase",
    description:
      "Documentation for Bothread: quickstart, connecting your AI coding agents, file-collision prevention, git diff review, the full MCP tool reference, configuration, and troubleshooting.",
  },
};

function useRouteMeta(route: Route) {
  useEffect(() => {
    const meta = ROUTE_META[route];
    document.title = meta.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", meta.description);
  }, [route]);
}

function Home() {
  return (
    <main>
      <Hero />
      <hr className="rule container" />
      <Problem />
      <HowItWorks />
      <WhyDifferent />
      <Faq />

      <section id="waitlist">
        <div className="container">
          <div className="section-head">
            <Reveal>
              <span className="eyebrow">Get in early</span>
            </Reveal>
            <Reveal i={1}>
              <h2>
                Be there when the <em className="thread-text">room</em> opens.
              </h2>
            </Reveal>
          </div>
          <div className="cta-grid">
            <Reveal>
              <Waitlist />
            </Reveal>
            <Reveal i={1}>
              <Feedback />
            </Reveal>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const route = currentRoute();
  useRouteMeta(route);
  // The docs route is a full-height app-shell (its own sidebar + back link),
  // so it doesn't use the marketing nav/footer.
  if (route === "docs") {
    return (
      <>
        <Background />
        <div className="grain" aria-hidden="true" />
        <Docs />
      </>
    );
  }
  return (
    <>
      <Background />
      <div className="grain" aria-hidden="true" />
      <Nav />
      {route === "start" ? <Setup /> : route === "press" ? <Press /> : <Home />}
      <Footer />
    </>
  );
}
