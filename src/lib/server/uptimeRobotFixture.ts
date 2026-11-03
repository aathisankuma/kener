// Answers of an UptimeRobot status page, shaped like status.swiss21.org (November 2026).
const ratio = { ratio: "100.000", label: "excellent", color: "green" };

const monitor = (
  monitorId: number,
  name: string,
  statusClass: string,
  lastDowntime: { date: string; duration: number; reason: string } | null = null,
) => ({
  monitorId,
  createdAt: "2020-03-24 13:28:16",
  statusClass,
  name,
  url: null,
  type: "HTTP(s)",
  groupId: 0,
  groupName: "Monitors (default)",
  dailyRatios: [{ date: "2026-11-03", ...ratio }],
  "30dRatio": ratio,
  "90dRatio": ratio,
  ratio,
  hasIncidentComments: false,
  lastDowntime,
});

export const SWISS21_HTML = `<!doctype html><html><body><footer>…</footer>
<audio id="notification"><source src="/assets/sounds/notification.mp3" type="audio/mpeg"></audio>
<input type="hidden" value="9DxKOsmRzV" id="pspi" />
<script src="/assets/js/lib/jquery-3.7.1.min.js"></script></body></html>`;

export const SWISS21_LIST = (overrides: Record<string, string> = {}) => ({
  status: "ok",
  psp: {
    monitors: [
      monitor(784606817, "AbaNinja", overrides["AbaNinja"] ?? "success"),
      monitor(804362936, "AbaNinja - WebAPI", overrides["AbaNinja - WebAPI"] ?? "success", {
        date: "2026-10-21 11:07:55",
        duration: 15620,
        reason: "Incident detected",
      }),
      monitor(784606820, "Portal", overrides["Portal"] ?? "success"),
      monitor(784606821, "Shop - Testshop", overrides["Shop - Testshop"] ?? "black"),
    ],
    totalMonitors: 4,
    perPage: 30,
    timezone: "+00:00",
  },
  statistics: { latest_downtime: null, counts: { up: 3, down: 0, paused: 1, total: 4 }, count_result: "All Clear" },
  days: ["2026-11-03"],
});
