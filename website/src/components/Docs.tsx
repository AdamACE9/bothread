import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DOC_PAGES, DOC_GROUPS, type DocPage } from "../docsContent";

function slugFromHash(): string {
  const h = window.location.hash.replace(/^#\/?/, "").trim();
  return h || DOC_PAGES[0]!.slug;
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
          /* ignore */
        }
      }}
      title="Copy this page as Markdown (great for pasting into an AI agent)"
    >
      {done ? "Copied ✓" : "⧉ Copy page"}
    </button>
  );
}

export default function Docs() {
  const [slug, setSlug] = useState<string>(slugFromHash);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onHash = () => {
      setSlug(slugFromHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const page = useMemo(() => DOC_PAGES.find((p) => p.slug === slug) ?? DOC_PAGES[0]!, [slug]);

  useEffect(() => {
    document.title = `${page.title} — Bothread docs`;
  }, [page]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return DOC_PAGES.filter(
      (p) => p.title.toLowerCase().includes(q) || p.markdown.toLowerCase().includes(q)
    );
  }, [q]);

  const go = (s: string) => {
    window.location.hash = `#/${s}`;
  };

  return (
    <main className="docs">
      <aside className="docs-sidebar">
        <a className="docs-back" href="/">
          ‹ Bothread
        </a>
        <input
          className="docs-search"
          type="search"
          placeholder="Search the docs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search documentation"
        />
        {matches ? (
          <nav className="docs-nav">
            <div className="docs-group-label">
              {matches.length} result{matches.length === 1 ? "" : "s"}
            </div>
            {matches.map((p) => (
              <button
                key={p.slug}
                className={`docs-link${p.slug === slug ? " on" : ""}`}
                onClick={() => {
                  go(p.slug);
                  setQuery("");
                }}
              >
                {p.title}
                <span className="docs-link-group">{p.group}</span>
              </button>
            ))}
            {matches.length === 0 && <div className="docs-noresult">No matches.</div>}
          </nav>
        ) : (
          <nav className="docs-nav">
            {DOC_GROUPS.map((group) => (
              <div key={group} className="docs-group">
                <div className="docs-group-label">{group}</div>
                {DOC_PAGES.filter((p) => p.group === group).map((p) => (
                  <button
                    key={p.slug}
                    className={`docs-link${p.slug === slug ? " on" : ""}`}
                    onClick={() => go(p.slug)}
                  >
                    {p.title}
                  </button>
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
        <div className="docs-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                  {children}
                </a>
              ),
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
