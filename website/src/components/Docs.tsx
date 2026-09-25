import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DOC_PAGES, DOC_GROUPS, DOCS_VERSION, type DocPage } from "../docsContent";
import "../styles/content.css";

/**
 * Docs routing. Pages live at /docs/<slug> (crawlable, in the sitemap).
 * Old links of the form /docs#/<slug> still work and are rewritten to the path form.
 */
function slugFromLocation(): string {
  const fromHash = window.location.hash.replace(/^#\/?/, "").trim();
  if (fromHash && DOC_PAGES.some((p) => p.slug === fromHash)) return fromHash;
  const m = window.location.pathname.match(/^\/docs\/([^/]+)\/?$/);
  if (m && DOC_PAGES.some((p) => p.slug === m[1])) return m[1]!;
  return DOC_PAGES[0]!.slug;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function CopyPageButton({ page }: { page: DocPage }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="docs-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`# ${page.title}\n\n${page.markdown}`);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked */
        }
      }}
      title="Copy this page as Markdown (useful for pasting into an AI agent)"
    >
      {done ? "Copied ✓" : "⧉ Copy page"}
    </button>
  );
}

/** A fenced code block with its own copy button. */
function Pre({ children }: { children?: ReactNode }) {
  const [done, setDone] = useState(false);
  const text = textOf(children).replace(/\n$/, "");
  return (
    <div className="doc-pre">
      <pre>{children}</pre>
      <button
        className="doc-copy"
        aria-label="Copy code"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          } catch {
            /* clipboard blocked */
          }
        }}
      >
        {done ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

export default function Docs() {
  const [slug, setSlug] = useState<string>(slugFromLocation);
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  // Normalise legacy hash URLs (/docs#/cli) to /docs/cli, and follow back/forward.
  useEffect(() => {
    const initial = slugFromLocation();
    if (window.location.hash.startsWith("#/")) {
      window.history.replaceState(null, "", `/docs/${initial}`);
    }
    const onPop = () => {
      setSlug(slugFromLocation());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  const page = useMemo(() => DOC_PAGES.find((p) => p.slug === slug) ?? DOC_PAGES[0]!, [slug]);

  useEffect(() => {
    document.title = `${page.title} · Bothread docs`;
  }, [page]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return DOC_PAGES.filter((p) => p.title.toLowerCase().includes(q) || p.markdown.toLowerCase().includes(q));
  }, [q]);

  const go = (s: string) => {
    if (s !== slug) window.history.pushState(null, "", `/docs/${s}`);
    setSlug(s);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  /** In-body links to /docs/<slug> navigate without a full page load. */
  const onBodyClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const href = a.getAttribute("href") ?? "";
    const m = href.match(/^\/docs\/([^/#?]+)$/);
    if (m && DOC_PAGES.some((p) => p.slug === m[1])) {
      e.preventDefault();
      go(m[1]!);
    }
  };

  return (
    <main className="docs">
      <aside className={`docs-sidebar${navOpen || matches ? "" : " collapsed"}`}>
        <a className="docs-back" href="/">
          ‹ Bothread <span className="docs-version">docs · v{DOCS_VERSION}</span>
        </a>
        <input
          className="docs-search"
          type="search"
          placeholder="Search the docs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search documentation"
        />
        <button
          className="docs-mobile-toggle"
          aria-expanded={navOpen}
          aria-controls="docs-nav"
          onClick={() => setNavOpen((o) => !o)}
        >
          {navOpen ? "Hide pages" : `Pages · ${page.title}`}
        </button>
        {matches ? (
          <nav className="docs-nav" id="docs-nav">
            <div className="docs-group-label">
              {matches.length} result{matches.length === 1 ? "" : "s"}
            </div>
            {matches.map((p) => (
              <a
                key={p.slug}
                href={`/docs/${p.slug}`}
                className={`docs-link${p.slug === slug ? " on" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(p.slug);
                  setQuery("");
                }}
              >
                {p.title}
                <span className="docs-link-group">{p.group}</span>
              </a>
            ))}
            {matches.length === 0 && <div className="docs-noresult">No matches.</div>}
          </nav>
        ) : (
          <nav className="docs-nav" id="docs-nav">
            {DOC_GROUPS.map((group) => (
              <div key={group} className="docs-group">
                <div className="docs-group-label">{group}</div>
                {DOC_PAGES.filter((p) => p.group === group).map((p) => (
                  <a
                    key={p.slug}
                    href={`/docs/${p.slug}`}
                    className={`docs-link${p.slug === slug ? " on" : ""}`}
                    aria-current={p.slug === slug ? "page" : undefined}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                      e.preventDefault();
                      go(p.slug);
                    }}
                  >
                    <span className="docs-link-row">
                      {p.title}
                      {p.isNew && <span className="docs-new">new</span>}
                    </span>
                  </a>
                ))}
              </div>
            ))}
          </nav>
        )}
      </aside>

      <article className="docs-content">
        <div className="docs-topbar">
          <div className="docs-crumb">
            <span>{page.group}</span>
            <span className="docs-crumb-sep">/</span>
            <span className="docs-crumb-cur">{page.title}</span>
          </div>
          <CopyPageButton page={page} />
        </div>
        <div className="docs-body" onClick={onBodyClick}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                  {children}
                </a>
              ),
              pre: ({ children }) => <Pre>{children}</Pre>,
            }}
          >
            {page.markdown}
          </ReactMarkdown>
        </div>
        <DocsFooterNav slug={slug} go={go} />
      </article>
    </main>
  );
}

function DocsFooterNav({ slug, go }: { slug: string; go: (s: string) => void }) {
  const idx = DOC_PAGES.findIndex((p) => p.slug === slug);
  const prev = idx > 0 ? DOC_PAGES[idx - 1] : null;
  const next = idx < DOC_PAGES.length - 1 ? DOC_PAGES[idx + 1] : null;
  return (
    <div className="docs-pager">
      {prev ? (
        <button className="docs-pager-btn" onClick={() => go(prev.slug)}>
          <span className="docs-pager-dir">‹ Previous</span>
          <span className="docs-pager-title">{prev.title}</span>
        </button>
      ) : (
        <span />
      )}
      {next ? (
        <button className="docs-pager-btn end" onClick={() => go(next.slug)}>
          <span className="docs-pager-dir">Next ›</span>
          <span className="docs-pager-title">{next.title}</span>
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
