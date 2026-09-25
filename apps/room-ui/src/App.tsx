import { useEffect, useState } from "react";
import Landing from "./Landing";
import RoomView from "./RoomView";
import Shortcuts from "./Shortcuts";
import { setToken } from "./api";
import { usePref } from "./hooks";
import { PaletteProvider, usePaletteActions } from "./palette";
import { ToastProvider } from "./toast";
import { Icon } from "./icons";

const roomFromHash = () => {
  const m = location.hash.match(/^#\/room\/(.+)$/);
  return m ? decodeURIComponent(m[1]!) : null;
};

export default function App() {
  return (
    <ToastProvider>
      <PaletteProvider>
        <Shell />
      </PaletteProvider>
    </ToastProvider>
  );
}

function Shell() {
  const [roomId, setRoomId] = useState<string | null>(roomFromHash());
  const [theme, setTheme] = usePref<"dark" | "light">("theme", "dark");
  const [showKeys, setShowKeys] = useState(false);
  const [needsToken, setNeedsToken] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
  }, [theme]);

  useEffect(() => {
    const onHash = () => setRoomId(roomFromHash());
    const onUnauth = () => setNeedsToken(true);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "?" && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !document.querySelector(".overlay")) setShowKeys(true);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("bothread:unauthorized", onUnauth);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("bothread:unauthorized", onUnauth);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const open = (id: string) => {
    location.hash = `#/room/${encodeURIComponent(id)}`;
    setRoomId(id);
  };
  const back = () => {
    history.pushState("", document.title, location.pathname + location.search);
    setRoomId(null);
  };

  usePaletteActions("app", [
    {
      id: "theme",
      group: "Preferences",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: theme === "dark" ? "sun" : "moon",
      keywords: "appearance mode",
      run: () => setTheme(theme === "dark" ? "light" : "dark"),
    },
    { id: "keys", group: "Help", label: "Keyboard shortcuts", icon: "keyboard", hint: "?", run: () => setShowKeys(true) },
    {
      id: "docs",
      group: "Help",
      label: "Open the Bothread guide",
      icon: "link",
      keywords: "help docs website",
      run: () => window.open("https://bothread.vercel.app/start", "_blank", "noopener"),
    },
    ...(roomId ? [{ id: "home", group: "Navigate", label: "All rooms", icon: "back" as const, run: back }] : []),
  ]);

  if (needsToken) return <TokenGate onDone={() => location.reload()} />;

  return (
    <>
      {roomId ? (
        <RoomView roomId={roomId} onBack={back} onOpenRoom={open} theme={theme} onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />
      ) : (
        <Landing onOpen={open} theme={theme} onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />
      )}
      {showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}
    </>
  );
}

/** Shown only when the hub is served off-loopback with BOTHREAD_AUTH=on. */
function TokenGate({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="token-gate">
      <div className="token-card">
        <Icon name="shield" size={28} />
        <h1>This hub needs its access token</h1>
        <p>
          Bothread is running with <code>BOTHREAD_AUTH=on</code> and you're opening it from another machine. Paste the
          token printed in the hub's terminal (the <code>Authorization: Bearer …</code> line).
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!value.trim()) return;
            setToken(value.trim().replace(/^Bearer\s+/i, ""));
            onDone();
          }}
        >
          <input className="field mono" autoFocus placeholder="Token" value={value} onChange={(e) => setValue(e.target.value)} />
          <button className="btn primary" type="submit">
            Unlock
          </button>
        </form>
      </div>
    </div>
  );
}
