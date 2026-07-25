import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { BoardPage } from "./pages/BoardPage";
import { ListPage } from "./pages/ListPage";
import { DetailPage } from "./pages/DetailPage";
import { StatsPage } from "./pages/StatsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { OutreachBoardPage } from "./pages/outreach/OutreachBoardPage";
import { OutreachListPage } from "./pages/outreach/OutreachListPage";
import { OutreachQueuePage } from "./pages/outreach/OutreachQueuePage";
import { OutreachDetailPage } from "./pages/outreach/OutreachDetailPage";
import { OutreachStatsPage } from "./pages/outreach/OutreachStatsPage";
import { OutreachSettingsPage } from "./pages/outreach/OutreachSettingsPage";
import { OutreachSentPage } from "./pages/outreach/OutreachSentPage";
import { getStoredMode } from "./lib/mode";

function ModeRedirect() {
  return <Navigate to={getStoredMode() === "outreach" ? "/outreach" : "/"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<BoardPage />} />
        <Route path="list" element={<ListPage />} />
        <Route path="apps/:id" element={<DetailPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="settings" element={<SettingsPage />} />

        <Route path="outreach" element={<OutreachBoardPage />} />
        <Route path="outreach/list" element={<OutreachListPage />} />
        <Route path="outreach/queue" element={<OutreachQueuePage />} />
        <Route path="outreach/sent" element={<OutreachSentPage />} />
        <Route path="outreach/leads/:id" element={<OutreachDetailPage />} />
        <Route path="outreach/stats" element={<OutreachStatsPage />} />
        <Route path="outreach/settings" element={<OutreachSettingsPage />} />
      </Route>
      <Route path="*" element={<ModeRedirect />} />
    </Routes>
  );
}
