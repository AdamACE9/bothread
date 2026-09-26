import { lazy, Suspense, useEffect } from "react";
import Background from "./components/Background";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import Showcase from "./components/home/Showcase";
import Features from "./components/home/Features";
import ForAgents from "./components/home/ForAgents";
import LocalFirst from "./components/home/LocalFirst";
import Rv from "./components/home/Rv";
import GetStarted from "./components/GetStarted";
import Feedback from "./components/Feedback";
import Footer from "./components/Footer";
import Faq from "./components/Faq";

// Secondary routes load on demand so the home page's first paint does not pay
// for react-markdown, the docs corpus, the setup wizard or the admin dashboard.
const Setup = lazy(() => import("./components/Setup"));
const Press = lazy(() => import("./components/Press"));
const Docs = lazy(() => import("./components/Docs"));
const Compare = lazy(() => import("./components/Compare"));
const Admin = lazy(() => import("./components/Admin"));

/** Keeps the page height stable while a lazy route chunk loads. */
function RouteFallback() {
  return <main className="route-loading" aria-busy="true" style={{ minHeight: "100vh" }} />;
}

type Route = "home" | "start" | "press" | "docs" | "compare" | "admin";

function currentRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/start") return "start";
  if (path === "/press") return "press";
  if (path === "/compare") return "compare";
  if (path === "/admin") return "admin";
  if (path === "/docs" || path.startsWith("/docs")) return "docs";
  return "home";
}

/** Per-route <title> + meta description so /start and /press aren't duplicates of home
 *  (a real SEO signal; the raw HTML already carries the home-page tags for crawlers). */
const ROUTE_META: Record<Route, { title: string; description: string }> = {
  home: {
    title: "Bothread: run your AI coding agents together on one codebase (local, MCP)",
    description:
      "Bothread is a free, open-source local app where the AI coding agents you already use (Claude Code, Cursor, Codex, Gemini CLI, Antigravity, OpenCode) work together on one codebase over MCP without overwriting each other. One command connects them all, and you review every change as a diff. No API keys, no cloud.",
  },
  start: {
    title: "Get started with Bothread: connect your AI coding agents",
    description:
      "Install Bothread and connect your AI coding agents (Claude Code, Cursor, Antigravity, Gemini CLI, Codex, OpenCode) to one shared room in about two minutes. Free, local, no API keys.",
  },
  press: {
    title: "Bothread press and media kit",
    description:
      "Press kit for Bothread: the one-liner, boilerplate, fast facts, links, and logo assets. Free, open-source local coordination for multiple AI coding agents on one codebase.",
  },
  docs: {
    title: "Bothread docs: run multiple AI coding agents on one codebase",
    description:
      "Documentation for Bothread: quickstart, connecting your AI coding agents, file-collision prevention, git diff review, the full MCP tool reference, configuration, and troubleshooting.",
  },
  compare: {
    title: "Bothread vs git worktrees vs Claude Squad: running multiple AI coding agents on one repo",
    description:
      "An honest comparison of the ways to run multiple AI coding agents on one codebase (raw terminals, git worktrees, Claude Squad, and Bothread), with the tradeoffs of each and when to reach for a shared coordination room vs hard isolation.",
  },
  admin: {
    title: "Bothread admin",
    description: "Bothread usage dashboard.",
  },
};

function useRouteMeta(route: Route) {
  useEffect(() => {
    const meta = ROUTE_META[route];
    document.title = meta.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", meta.description);

    // Keep the admin dashboard out of search engines. Restore the default
    // (indexable) directive on any other route.
    let robots = document.querySelector('meta[name="robots"]');
    if (route === "admin") {
      if (!robots) {
        robots = document.createElement("meta");
        robots.setAttribute("name", "robots");
        document.head.appendChild(robots);
      }
      robots.setAttribute("content", "noindex, nofollow");
    } else if (robots) {
      robots.setAttribute("content", "index, follow");
    }
  }, [route]);
}

function Home() {
  return (
    <main className="home">
      <Hero />
      <HowItWorks />
      <Showcase />
      <Features />
      <ForAgents />
      <LocalFirst />
      <Faq />

      <section className="h-sec h-cta" id="get-started" aria-labelledby="get-started-h">
        <div className="h-wrap">
          <h2 id="get-started-h" className="sr-only">
            Get started
          </h2>
          <div className="cta-grid h-cta-grid">
            <Rv>
              <GetStarted />
            </Rv>
            <Rv i={1}>
              <Feedback />
            </Rv>
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
        <Suspense fallback={<RouteFallback />}>
          <Docs />
        </Suspense>
      </>
    );
  }
  if (route === "admin")
    return (
      <Suspense fallback={<RouteFallback />}>
        <Admin />
      </Suspense>
    );
  return (
    <>
      <Background />
      <div className="grain" aria-hidden="true" />
      <Nav />
      <Suspense fallback={<RouteFallback />}>
        {route === "start" ? (
          <Setup />
        ) : route === "press" ? (
          <Press />
        ) : route === "compare" ? (
          <Compare />
        ) : (
          <Home />
        )}
      </Suspense>
      <Footer />
    </>
  );
}
