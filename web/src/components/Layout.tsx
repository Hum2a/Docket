import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { api } from "../lib/api";
import { getStoredMode, setStoredMode, type AppMode } from "../lib/mode";
import { useOutreachPreflight } from "../lib/useOutreachPreflight";

function ModeSwitch({ mode, onChange }: { mode: AppMode; onChange: (m: AppMode) => void }) {
  return (
    <div className="mode-switch" role="group" aria-label="Pipeline mode">
      <button
        type="button"
        className={mode === "jobs" ? "active" : ""}
        onClick={() => onChange("jobs")}
      >
        Job Search
      </button>
      <button
        type="button"
        className={mode === "outreach" ? "active" : ""}
        onClick={() => onChange("outreach")}
      >
        Outreach
      </button>
    </div>
  );
}

function OutreachChip() {
  const { preflight } = useOutreachPreflight();
  const [label, setLabel] = useState<string>("…");
  const [tone, setTone] = useState<"live" | "dry" | "paused" | "config">("dry");

  useEffect(() => {
    if (preflight && !preflight.ready) {
      setLabel("Not configured");
      setTone("config");
      return;
    }
    if (!preflight) return;

    void (async () => {
      try {
        const s = await api.getOutreachSettings();
        const paused =
          s.pausedUntil && new Date(s.pausedUntil).getTime() > Date.now();
        if (paused) {
          setLabel("Paused");
          setTone("paused");
        } else if (s.dryRun || !s.autoSendEnabled) {
          setLabel(s.dryRun ? "Dry run" : "Paused");
          setTone(s.dryRun ? "dry" : "paused");
        } else {
          const hasWarnings = (preflight.warnings?.length ?? 0) > 0;
          setLabel(hasWarnings ? "Live (warnings)" : "Live");
          setTone("live");
        }
      } catch {
        setLabel("Offline");
        setTone("paused");
      }
    })();
  }, [preflight]);

  return <span className={`outreach-chip tone-${tone}`}>{label}</span>;
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathMode: AppMode = location.pathname.startsWith("/outreach") ? "outreach" : "jobs";
  const [mode, setMode] = useState<AppMode>(() => getStoredMode());

  useEffect(() => {
    setMode(pathMode);
    setStoredMode(pathMode);
  }, [pathMode]);

  function switchMode(next: AppMode) {
    setMode(next);
    setStoredMode(next);
    navigate(next === "outreach" ? "/outreach" : "/");
  }

  const isOutreach = mode === "outreach";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <NavLink to={isOutreach ? "/outreach" : "/"} className="brand" end>
            <Logo />
            <span className="brand-name">Docket</span>
          </NavLink>
          <ModeSwitch mode={mode} onChange={switchMode} />
          {isOutreach && <OutreachChip />}
        </div>
        <nav className="nav-pill" aria-label="Primary">
          {isOutreach ? (
            <>
              <NavLink to="/outreach" end>
                Board
              </NavLink>
              <NavLink to="/outreach/list">List</NavLink>
              <NavLink to="/outreach/queue">Queue</NavLink>
              <NavLink to="/outreach/sent">Sent</NavLink>
              <NavLink to="/outreach/stats">Stats</NavLink>
              <NavLink to="/outreach/settings">Settings</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/" end>
                Board
              </NavLink>
              <NavLink to="/list">List</NavLink>
              <NavLink to="/stats">Stats</NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </>
          )}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
