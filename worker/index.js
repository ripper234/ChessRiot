const ENVIRONMENTS = [
  {
    key: "production",
    name: "Production",
    expectedVersion: "0.2.2",
    urlKey: "PROD_URL",
    secretKey: "PROD_OPS_READ_SECRET",
    access: "Public",
    accent: "gold",
  },
  {
    key: "staging",
    name: "Staging",
    expectedVersion: "0.2.2",
    urlKey: "STAGING_URL",
    secretKey: "STAGING_OPS_READ_SECRET",
    access: "Owner only",
    accent: "cyan",
  },
  {
    key: "development",
    name: "Development",
    expectedVersion: "0.2.2",
    urlKey: "DEV_URL",
    secretKey: "DEV_OPS_READ_SECRET",
    access: "Public",
    accent: "purple",
  },
];

const CONTROL_VERSION = "0.1.5";
const AVAILABLE_VERSIONS = [
  "0.1.0",
  "0.1.1",
  "0.1.2",
  "0.2.0",
  "0.2.1",
  "0.2.2",
];
const STATUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintGrant(secret, audience) {
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    aud: audience,
    scope: "observability:read",
    iat: now,
    exp: now + 120,
    nonce: crypto.randomUUID(),
  };
  const encodedPayload = base64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encodedPayload),
  );
  return encodedPayload + "." + base64Url(new Uint8Array(signature));
}

async function statusResponse(env) {
  const environments = await Promise.all(
    ENVIRONMENTS.map(async (config) => ({
      key: config.key,
      name: config.name,
      expectedVersion: config.expectedVersion,
      access: config.access,
      accent: config.accent,
      url: env[config.urlKey] ?? null,
      grant: await mintGrant(env[config.secretKey], config.key),
    })),
  );
  return Response.json(
    {
      environments,
      availableVersions: AVAILABLE_VERSIONS,
      controlVersion: CONTROL_VERSION,
      refreshIntervalMs: STATUS_REFRESH_INTERVAL_MS,
      sourceUrl: "https://github.com/ripper234/ChessRiot",
    },
    {
      headers: {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ChessRiot Control</title>
    <style>
      :root {
        color-scheme: dark;
        --navy:#0b1020;--black:#050914;--surface:#111a2d;--raised:#17233a;
        --line:#2a3958;--text:#f7f9ff;--muted:#91a0b8;--cyan:#00e5ff;
        --gold:#ffc400;--purple:#9a6cff;--pink:#ff2e6e;--green:#17e0c2;
        --display:Impact,Haettenschweiler,"Arial Narrow Bold",sans-serif;
        --ui:Inter,ui-sans-serif,system-ui,sans-serif;
        --mono:"SFMono-Regular",Consolas,monospace;
      }
      *{box-sizing:border-box} body{min-width:320px;min-height:100vh;margin:0;color:var(--text);
        font-family:var(--ui);background:radial-gradient(circle at 18% 8%,rgba(0,229,255,.09),transparent 28rem),
        radial-gradient(circle at 90% 80%,rgba(154,108,255,.1),transparent 32rem),var(--navy)}
      a{color:inherit} button,select{font:inherit}.topbar{min-height:76px;display:flex;align-items:center;
        justify-content:space-between;gap:20px;padding:14px clamp(18px,5vw,72px);
        border-bottom:1px solid rgba(255,196,0,.45);background:rgba(5,9,20,.9)}
      .brand{display:flex;align-items:center;gap:12px}.mark{width:43px;height:43px;display:grid;place-items:center;
        color:var(--black);background:var(--gold);font:28px/1 Georgia,serif;
        clip-path:polygon(50% 0,100% 25%,85% 78%,50% 100%,15% 78%,0 25%)}
      .brand strong{display:block;font:italic 31px/.9 var(--display);text-transform:uppercase}.brand small{
        display:block;margin-top:6px;color:var(--cyan);font:700 10px/1 var(--mono);letter-spacing:1.8px}
      .github{min-height:44px;display:inline-flex;align-items:center;gap:10px;padding:0 15px;border:1px solid #536077;
        border-radius:999px;background:#121722;font:800 11px/1 var(--mono);text-decoration:none}.github svg{width:22px;fill:#fff}
      main{width:min(1240px,100%);margin:0 auto;padding:36px clamp(16px,4vw,50px) 70px}
      .hero{display:flex;align-items:end;justify-content:space-between;gap:28px;margin-bottom:23px}.eyebrow{
        margin:0 0 10px;color:var(--cyan);font:800 11px/1 var(--mono);letter-spacing:1.5px}
      h1{margin:0;font:italic clamp(42px,6vw,65px)/.88 var(--display);text-transform:uppercase}h1 em{color:var(--gold)}
      .subtitle{max-width:680px;margin:14px 0 0;color:#c3cde0;font-size:14px;line-height:1.5}
      .auto{min-width:240px;padding:13px 16px;border:1px solid rgba(0,229,255,.34);background:rgba(0,229,255,.05)}
      .cadence{display:flex;align-items:center;gap:8px;color:var(--cyan);font:800 10px/1 var(--mono)}.pulse{
        width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 11px var(--green)}
      .checked{margin:8px 0 0;color:#b9c5d8;font:700 10px/1.35 var(--mono)}
      .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{position:relative;min-height:455px;
        padding:22px;border:1px solid var(--line);background:linear-gradient(145deg,rgba(23,35,58,.98),rgba(8,14,27,.98));
        clip-path:polygon(13px 0,100% 0,100% calc(100% - 13px),calc(100% - 13px) 100%,0 100%,0 13px)}
      .card:before{position:absolute;top:0;left:22px;width:68px;height:2px;content:"";background:var(--accent);
        box-shadow:0 0 14px var(--accent)}.card[data-accent=gold]{--accent:var(--gold)}
      .card[data-accent=cyan]{--accent:var(--cyan)}.card[data-accent=purple]{--accent:var(--purple)}
      .card-head{display:flex;align-items:start;justify-content:space-between;gap:10px}.card h2{margin:9px 0 3px;
        font:italic 28px/1 var(--display);text-transform:uppercase}.access{color:var(--muted);font:700 10px/1.25 var(--mono)}
      .status{display:flex;align-items:center;gap:7px;margin-top:8px;font:800 9px/1 var(--mono)}.lamp{width:11px;height:11px;
        border:1px solid #4a5670;background:#29344a;transform:rotate(45deg)}.ok{color:var(--green)}.ok .lamp{
        border-color:var(--green);background:var(--green);box-shadow:0 0 12px var(--green)}.warn{color:var(--gold)}
      .warn .lamp{border-color:var(--gold);background:var(--gold)}.down{color:#ff8cab}.version-label{margin:24px 0 4px;
        color:var(--muted);font:700 10px/1 var(--mono);letter-spacing:1px}.version{margin:0;color:var(--accent);
        font:italic 39px/1 var(--display)}.expected{min-height:18px;margin:6px 0 15px;color:#b7c3d8;font-size:12px}
      .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:0 0 15px}.metric{padding:9px 7px;
        border:1px solid #32415f;background:rgba(5,9,20,.45)}.metric b{display:block;color:var(--text);
        font:italic 20px/1 var(--display)}.metric span{display:block;margin-top:5px;color:var(--muted);
        font:700 7px/1.2 var(--mono);text-transform:uppercase}.metric.error b{color:#ff8cab}
      .telemetry-note{min-height:29px;margin:0 0 15px;color:#b9c5d8;font:650 10px/1.45 var(--mono)}
      .release-label{display:block;margin:0 0 6px;color:var(--muted);font:750 9px/1 var(--mono)}.actions{
        display:grid;grid-template-columns:1fr auto;gap:7px}select,.prepare{min-height:39px;border:1px solid #44516b;
        color:var(--text);background:var(--black)}select{min-width:0;padding:0 9px}.prepare{padding:0 11px;border-color:rgba(255,196,0,.6);
        color:var(--gold);cursor:pointer;font:800 9px/1 var(--mono)}.prepare:disabled{opacity:.5;cursor:not-allowed}
      .open{display:inline-block;margin-top:15px;color:var(--cyan);font:750 10px/1 var(--mono);text-decoration:none}
      .events{margin-top:20px;padding:20px;border:1px solid var(--line);background:rgba(5,9,20,.58)}.events-head{
        display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:14px}.events h2{margin:0;
        font:italic 27px/1 var(--display);text-transform:uppercase}.tabs{display:flex;flex-wrap:wrap;gap:7px}.tab{min-height:34px;
        padding:0 11px;border:1px solid #41506c;color:#c8d3e6;background:transparent;cursor:pointer;font:800 9px/1 var(--mono)}
      .tab[aria-selected=true]{border-color:var(--cyan);color:var(--cyan);background:rgba(0,229,255,.08)}
      .event-table{width:100%;border-collapse:collapse;font:650 10px/1.35 var(--mono)}th,td{padding:9px 8px;
        border-bottom:1px solid #25334e;text-align:left;vertical-align:top}th{color:var(--muted);font-size:8px;letter-spacing:.8px}
      td.success{color:var(--green)}td.rejected{color:var(--gold)}td.failure{color:#ff8cab}.empty{padding:25px;
        color:var(--muted);text-align:center;font:700 11px/1.4 var(--mono)}
      .notice{margin-top:18px;padding:16px 18px;border:1px solid rgba(255,196,0,.28);color:#cbd4e5;
        background:rgba(255,196,0,.04);font-size:11px;line-height:1.5}.notice b{color:var(--gold)}
      dialog{width:min(560px,calc(100% - 30px));padding:0;border:1px solid rgba(0,229,255,.5);color:var(--text);
        background:var(--surface);box-shadow:0 28px 90px rgba(0,0,0,.65)}dialog::backdrop{background:rgba(3,6,14,.84)}
      .modal{padding:27px}.modal h2{margin:0 0 10px;font:italic 30px/1 var(--display)}.modal p{color:#c4cee0;line-height:1.5}
      .command{padding:14px;border:1px solid #35425d;color:var(--cyan);background:var(--black);font:650 11px/1.55 var(--mono)}
      .modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}.modal button,.modal a{min-height:40px;display:inline-flex;
        align-items:center;padding:0 14px;border:1px solid #45536d;color:var(--text);background:transparent;cursor:pointer;text-decoration:none}
      button:focus-visible,a:focus-visible,select:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
      @media(max-width:900px){.grid{grid-template-columns:1fr}.hero{align-items:start;flex-direction:column}.auto{width:100%}}
      @media(max-width:620px){.topbar{min-height:62px;padding:10px 13px}.brand strong{font-size:24px}.brand small{display:none}
        .github{width:42px;padding:0;justify-content:center}.github span{display:none}main{padding-top:28px}.metrics{grid-template-columns:repeat(2,1fr)}
        .actions{grid-template-columns:1fr}.events{padding:14px;overflow:auto}.events-head{align-items:start;flex-direction:column}
        .event-table{min-width:680px}}
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="brand"><span class="mark">♞</span><span><strong>ChessRiot Control</strong><small>ENVIRONMENTS // RELEASES // OBSERVABILITY</small></span></div>
      <a class="github" href="https://github.com/ripper234/ChessRiot" target="_blank" rel="noopener noreferrer" aria-label="View ChessRiot source on GitHub">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.98 10.98 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>
        <span>View on GitHub</span>
      </a>
    </header>
    <main>
      <section class="hero">
        <div><p class="eyebrow">CONTROL v${CONTROL_VERSION} // LIVE OPERATIONS</p>
          <h1>SEE EVERYTHING.<br><em>SHIP CALMLY.</em></h1>
          <p class="subtitle">Real health, releases, game activity, latency, and errors for Production, Staging, and Development. Data never mixes between environments.</p>
        </div>
        <div class="auto"><span class="cadence"><i class="pulse"></i>AUTO CHECK · 5 MIN</span>
          <p class="checked" id="checked">Checking environments…</p></div>
      </section>
      <section class="grid" id="grid" aria-live="polite" aria-busy="true"></section>
      <section class="events">
        <div class="events-head"><h2>Recent events</h2><div class="tabs" id="tabs"></div></div>
        <div id="event-content"><p class="empty">Loading environment events…</p></div>
      </section>
      <aside class="notice"><b>Privacy-safe by design.</b> No player names, private links, invitation tokens, seat keys, IP addresses, FENs, or raw request bodies are logged. Telemetry is isolated per environment and retained for 30 days.</aside>
    </main>
    <dialog id="release-dialog" aria-labelledby="dialog-title">
      <div class="modal"><h2 id="dialog-title">Create release request</h2>
        <p>Copy this exact request into the ChessRiot ChatGPT project.</p>
        <div class="command" id="command"></div>
        <div class="modal-actions"><button id="cancel" type="button">Cancel</button>
          <button id="copy" type="button">Copy request</button>
          <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer">Open ChatGPT ↗</a></div>
      </div>
    </dialog>
    <script src="/control.js" defer></script>
  </body>
</html>`;

const clientScript = String.raw`
  const grid = document.querySelector("#grid");
  const checked = document.querySelector("#checked");
  const tabs = document.querySelector("#tabs");
  const eventContent = document.querySelector("#event-content");
  const initialEnvironments = ${JSON.stringify(
    ENVIRONMENTS.map(
      ({ key, name, expectedVersion, access, accent }) => ({
        key,
        name,
        expectedVersion,
        access,
        accent,
      }),
    ),
  )};
  const initialVersions = ${JSON.stringify(AVAILABLE_VERSIONS)};
  const dialog = document.querySelector("#release-dialog");
  const command = document.querySelector("#command");
  const copy = document.querySelector("#copy");
  const snapshots = new Map();
  let activeEnvironment = "production";
  let lastUpdatedAt = null;
  let refreshIntervalMs = 300000;
  let statusRequest = null;

  function compareVersions(a, b) {
    const left = String(a || "0").split(".").map(Number);
    const right = String(b || "0").split(".").map(Number);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const difference = (left[index] || 0) - (right[index] || 0);
      if (difference) return difference;
    }
    return 0;
  }

  function releaseVerb(current, target) {
    if (!current) return "Deploy";
    return compareVersions(target, current) < 0 ? "Rollback" : "Promote";
  }

  async function readJson(response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  async function inspectEnvironment(item) {
    if (!item.url) throw new Error("URL not configured");
    const healthPromise = fetch(item.url + "/api/health?control-check=" + Date.now(), {
      cache: "no-store",
      credentials: "include",
    }).then(readJson);
    const overviewPromise = item.grant
      ? fetch(item.url + "/api/ops/overview", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: item.grant,
          cache: "no-store",
          credentials: "include",
        }).then(readJson)
      : Promise.reject(new Error("Telemetry grant missing"));
    const results = await Promise.allSettled([healthPromise, overviewPromise]);
    const previous = snapshots.get(item.key);
    const health = results[0].status === "fulfilled" ? results[0].value : previous && previous.health;
    const overview = results[1].status === "fulfilled" ? results[1].value : previous && previous.overview;
    const value = {
      item,
      health: health || null,
      overview: overview || null,
      healthFresh: results[0].status === "fulfilled",
      telemetryFresh: results[1].status === "fulfilled",
      checkedAt: new Date(),
    };
    snapshots.set(item.key, value);
    return value;
  }

  function metric(label, value, error) {
    const element = document.createElement("div");
    element.className = "metric" + (error ? " error" : "");
    const strong = document.createElement("b");
    strong.textContent = value === null || value === undefined ? "—" : String(value);
    const caption = document.createElement("span");
    caption.textContent = label;
    element.append(strong, caption);
    return element;
  }

  function breakdownCount(overview, event, outcome) {
    const row = overview && overview.breakdown && overview.breakdown.find(function (entry) {
      return entry.event_name === event && entry.outcome === outcome;
    });
    return row ? row.count : 0;
  }

  function createCard(snapshot, versions) {
    const item = snapshot.item;
    const health = snapshot.health;
    const overview = snapshot.overview;
    const loading = Boolean(snapshot.loading);
    const version = health && health.version || overview && overview.version || null;
    const matches = version === item.expectedVersion;
    const healthy = health && health.status === "ok";
    const article = document.createElement("article");
    article.className = "card";
    article.dataset.accent = item.accent;
    article.innerHTML =
      '<div class="card-head"><div><h2></h2><span class="access"></span></div>' +
      '<span class="status"><span class="lamp"></span><span class="status-text"></span></span></div>' +
      '<p class="version-label">ACTIVE RELEASE</p><p class="version"></p><p class="expected"></p>' +
      '<div class="metrics"></div><p class="telemetry-note"></p>' +
      '<label class="release-label">CHANGE TO RELEASE</label><div class="actions">' +
      '<select aria-label="Release target"></select><button class="prepare" type="button">CREATE REQUEST</button></div>' +
      '<a class="open" target="_blank" rel="noopener noreferrer">OPEN ENVIRONMENT ↗</a>';
    article.querySelector("h2").textContent = item.name;
    article.querySelector(".access").textContent = item.access + " // isolated data";
    article.querySelector(".version").textContent = loading
      ? "Checking…"
      : version ? "v" + version : "Unavailable";
    const status = article.querySelector(".status");
    const statusText = article.querySelector(".status-text");
    if (loading) {
      status.classList.add("warn");
      statusText.textContent = "CHECKING";
    } else if (!health) {
      status.classList.add("down");
      statusText.textContent = "UNAVAILABLE";
    } else if (!snapshot.healthFresh || !snapshot.telemetryFresh) {
      status.classList.add("warn");
      statusText.textContent = "STALE";
    } else if (!healthy || !matches) {
      status.classList.add("warn");
      statusText.textContent = healthy ? "VERSION MISMATCH" : "DEGRADED";
    } else {
      status.classList.add("ok");
      statusText.textContent = "HEALTHY";
    }
    const expected = article.querySelector(".expected");
    expected.textContent = loading
      ? "Connecting to v" + item.expectedVersion
      : version
      ? (matches ? "Matches target v" + item.expectedVersion : "Target v" + item.expectedVersion)
      : "No successful health response";

    const metrics = article.querySelector(".metrics");
    const totals = overview && overview.totals;
    const games = overview && overview.games;
    const errorRate = totals && totals.total
      ? Math.round(totals.failures / totals.total * 1000) / 10 + "%"
      : totals ? "0%" : null;
    metrics.append(
      metric("Games created · 24h", overview ? breakdownCount(overview, "game.created", "success") : null),
      metric("Moves · 24h", overview ? breakdownCount(overview, "move.submitted", "success") : null),
      metric("Active games", games && games.active),
      metric("Failures · 24h", totals && totals.failures, Boolean(totals && totals.failures)),
      metric("Error rate", errorRate, Boolean(totals && totals.failures)),
      metric("p95 latency", totals && totals.p95LatencyMs !== null ? totals.p95LatencyMs + "ms" : null),
    );
    const note = article.querySelector(".telemetry-note");
    if (loading) note.textContent = "Loading health and telemetry…";
    else if (!overview) note.textContent = "Telemetry unavailable. No zeroes or demo data substituted.";
    else if (!snapshot.telemetryFresh) note.textContent = "Showing last good telemetry snapshot. Latest check failed.";
    else note.textContent = "Last event " + (totals.lastEventAt ? new Date(totals.lastEventAt).toLocaleString() : "none yet");

    const select = article.querySelector("select");
    const targets = versions.filter(function (candidate) { return candidate !== version; });
    const prepare = article.querySelector(".prepare");
    if (loading) {
      const option = document.createElement("option");
      option.textContent = "Waiting for health";
      select.append(option);
      select.disabled = true;
      prepare.disabled = true;
    } else {
      targets.forEach(function (candidate) {
        const option = document.createElement("option");
        option.value = candidate;
        option.textContent = "v" + candidate + " · " + releaseVerb(version, candidate).toLowerCase();
        select.append(option);
      });
    }
    if (!loading && !targets.length) {
      const option = document.createElement("option");
      option.textContent = "No other release";
      select.append(option);
      select.disabled = true;
      prepare.disabled = true;
    }
    prepare.addEventListener("click", function () {
      const target = select.value;
      const verb = releaseVerb(version, target);
      command.textContent = verb + " ChessRiot " + item.name.toLowerCase() +
        (version ? " from v" + version : "") + " to v" + target +
        ". Deploy the saved Sites version matching that semantic release, verify it, and preserve game data and runtime configuration.";
      copy.textContent = "Copy request";
      dialog.showModal();
    });
    const link = article.querySelector(".open");
    if (item.url) link.href = item.url;
    else {
      link.removeAttribute("href");
      link.textContent = "CONNECTING…";
    }
    article.addEventListener("click", function (event) {
      if (event.target.closest("button,select,a")) return;
      activeEnvironment = item.key;
      renderEvents();
    });
    return article;
  }

  function renderTabs() {
    tabs.replaceChildren();
    for (const snapshot of snapshots.values()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab";
      button.textContent = snapshot.item.name;
      button.setAttribute("aria-selected", String(snapshot.item.key === activeEnvironment));
      button.addEventListener("click", function () {
        activeEnvironment = snapshot.item.key;
        renderTabs();
        renderEvents();
      });
      tabs.append(button);
    }
  }

  function renderEvents() {
    const snapshot = snapshots.get(activeEnvironment);
    if (snapshot && snapshot.loading) {
      eventContent.innerHTML = '<p class="empty">Loading environment events…</p>';
      return;
    }
    const events = snapshot && snapshot.overview && snapshot.overview.recentEvents;
    if (!events) {
      eventContent.innerHTML = '<p class="empty">No readable telemetry for this environment.</p>';
      return;
    }
    if (!events.length) {
      eventContent.innerHTML = '<p class="empty">No events recorded yet.</p>';
      return;
    }
    const table = document.createElement("table");
    table.className = "event-table";
    table.innerHTML = "<thead><tr><th>TIME</th><th>EVENT</th><th>RESULT</th><th>REQUEST</th><th>GAME REF</th><th>DETAIL</th></tr></thead>";
    const body = document.createElement("tbody");
    events.forEach(function (event) {
      const row = document.createElement("tr");
      const values = [
        new Date(event.occurredAt).toLocaleString(),
        event.event,
        event.outcome,
        event.requestId || "—",
        event.gameRef || "—",
        event.errorCode || (event.latencyMs === null ? "—" : event.latencyMs + "ms"),
      ];
      values.forEach(function (value, index) {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 2) cell.className = event.outcome;
        row.append(cell);
      });
      body.append(row);
    });
    table.append(body);
    eventContent.replaceChildren(table);
  }

  async function loadStatus() {
    if (statusRequest) return statusRequest;
    grid.setAttribute("aria-busy", "true");
    statusRequest = (async function () {
      try {
        const status = await fetch("/api/status", { cache: "no-store" }).then(readJson);
        refreshIntervalMs = status.refreshIntervalMs;
        const inspected = await Promise.all(status.environments.map(inspectEnvironment));
        grid.replaceChildren.apply(grid, inspected.map(function (item) {
          return createCard(item, status.availableVersions);
        }));
        if (!snapshots.has(activeEnvironment) && inspected[0]) activeEnvironment = inspected[0].item.key;
        renderTabs();
        renderEvents();
        lastUpdatedAt = new Date();
        checked.textContent = "Last updated " + lastUpdatedAt.toLocaleString();
        checked.title = lastUpdatedAt.toISOString();
      } catch {
        checked.textContent = lastUpdatedAt
          ? "Last updated " + lastUpdatedAt.toLocaleString() + " · latest check failed"
          : "Update failed · retrying automatically";
      } finally {
        grid.setAttribute("aria-busy", "false");
      }
    })();
    try { await statusRequest; } finally { statusRequest = null; }
  }

  async function copyRequest() {
    try { await navigator.clipboard.writeText(command.textContent); }
    catch {
      const textarea = document.createElement("textarea");
      textarea.value = command.textContent;
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    copy.textContent = "Copied";
  }

  document.querySelector("#cancel").addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });
  copy.addEventListener("click", copyRequest);
  initialEnvironments.forEach(function (item) {
    const snapshot = {
      item: item,
      health: null,
      overview: null,
      healthFresh: false,
      telemetryFresh: false,
      loading: true,
    };
    snapshots.set(item.key, snapshot);
    grid.append(createCard(snapshot, initialVersions));
  });
  renderTabs();
  renderEvents();
  void loadStatus();
  setInterval(function () { void loadStatus(); }, 300000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" &&
      (!lastUpdatedAt || Date.now() - lastUpdatedAt.getTime() >= refreshIntervalMs)) {
      void loadStatus();
    }
  });
`;

const securityHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self' https://chessriot.ripper234.chatgpt.site https://chessriot-staging.ripper234.chatgpt.site https://chessriot-dev.ripper234.chatgpt.site; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/status") {
      return statusResponse(env);
    }
    if (request.method === "GET" && url.pathname === "/control.js") {
      return new Response(clientScript, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method !== "GET" || url.pathname !== "/") {
      return new Response("Not found", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }
    return new Response(page, { headers: securityHeaders });
  },
};
