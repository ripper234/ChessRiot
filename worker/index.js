const ENVIRONMENTS = [
  {
    key: "production",
    name: "Production",
    expectedVersion: "0.1.0",
    urlKey: "PROD_URL",
    tokenKey: "PROD_BYPASS_TOKEN",
    access: "Public",
    accent: "gold",
  },
  {
    key: "staging",
    name: "Staging",
    expectedVersion: "0.1.1",
    urlKey: "STAGING_URL",
    tokenKey: "STAGING_BYPASS_TOKEN",
    access: "Owner only",
    accent: "cyan",
  },
  {
    key: "development",
    name: "Development",
    expectedVersion: "0.1.1",
    urlKey: "DEV_URL",
    tokenKey: "DEV_BYPASS_TOKEN",
    access: "Owner only",
    accent: "purple",
  },
];

const CONTROL_VERSION = "0.1.2";
const AVAILABLE_VERSIONS = ["0.1.0", "0.1.1"];
const initialCards = ENVIRONMENTS.map(
  ({ name, expectedVersion, access, accent }) => `
    <article class="card loading" data-accent="${accent}">
      <div class="card-head">
        <div><h2>${name}</h2><span class="access">${access} // isolated data</span></div>
        <span class="deployment-status"><span class="lamp"></span><span>CHECKING</span></span>
      </div>
      <p class="version-label">ACTIVE RELEASE</p>
      <p class="version">…</p>
      <p class="expected">Target v${expectedVersion}</p>
      <span class="release-label">CHANGE TO RELEASE</span>
      <div class="card-actions">
        <select disabled aria-label="Release target"><option>Checking releases…</option></select>
        <button class="prepare" type="button" disabled>CREATE REQUEST</button>
      </div>
      <span class="open-env" aria-disabled="true">OPEN ENVIRONMENT ↗</span>
    </article>`,
).join("");

function normalizeVersion(version) {
  if (!version) return null;
  return version.split(".").length === 2 ? `${version}.0` : version;
}

async function inspectEnvironment(config, env) {
  const url = env[config.urlKey];
  if (!url) {
    return {
      ...config,
      url: null,
      version: null,
      healthy: false,
      message: "URL is not configured",
    };
  }

  const headers = { accept: "text/html" };
  const token = env[config.tokenKey];
  if (token) headers["OAI-Sites-Authorization"] = `Bearer ${token}`;

  try {
    const response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    const html = await response.text();
    const match = html.match(/CHESSRIOT\s+v(0\.\d+(?:\.\d+)?)/i);
    const version = normalizeVersion(match?.[1] ?? null);
    return {
      ...config,
      url,
      version,
      healthy: response.ok && version !== null,
      message: response.ok
        ? version
          ? "Deployment responded"
          : "Deployment responded without a version marker"
        : `Deployment returned HTTP ${response.status}`,
    };
  } catch {
    return {
      ...config,
      url,
      version: null,
      healthy: false,
      message: "Deployment did not respond",
    };
  }
}

async function statusResponse(env) {
  const environments = await Promise.all(
    ENVIRONMENTS.map((config) => inspectEnvironment(config, env)),
  );
  return Response.json(
    {
      environments,
      availableVersions: AVAILABLE_VERSIONS,
      controlVersion: CONTROL_VERSION,
      checkedAt: new Date().toISOString(),
      sourceUrl: "https://github.com/ripper234/ChessRiot",
    },
    {
      headers: {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'",
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
        --navy: #0b1020;
        --black: #050914;
        --surface: #111a2d;
        --surface-raised: #17233a;
        --line: #2a3958;
        --text: #f7f9ff;
        --muted: #91a0b8;
        --cyan: #00e5ff;
        --gold: #ffc400;
        --purple: #9a6cff;
        --pink: #ff2e6e;
        --green: #17e0c2;
        --display: Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif;
        --ui: Inter, ui-sans-serif, system-ui, sans-serif;
        --mono: "SFMono-Regular", Consolas, monospace;
      }
      * { box-sizing: border-box; }
      body {
        min-width: 320px;
        min-height: 100vh;
        margin: 0;
        color: var(--text);
        font-family: var(--ui);
        background:
          radial-gradient(circle at 18% 8%, rgba(0,229,255,.09), transparent 28rem),
          radial-gradient(circle at 90% 80%, rgba(154,108,255,.1), transparent 32rem),
          var(--navy);
      }
      a { color: inherit; }
      button, select { font: inherit; }
      .topbar {
        min-height: 76px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 14px clamp(18px,5vw,72px);
        border-bottom: 1px solid rgba(255,196,0,.45);
        background: rgba(5,9,20,.9);
      }
      .brand { display: flex; align-items: center; gap: 12px; }
      .mark {
        width: 43px;
        height: 43px;
        display: grid;
        place-items: center;
        color: var(--black);
        background: var(--gold);
        font: 28px/1 Georgia, serif;
        clip-path: polygon(50% 0,100% 25%,85% 78%,50% 100%,15% 78%,0 25%);
      }
      .brand strong {
        display: block;
        font: italic 31px/.9 var(--display);
        letter-spacing: .4px;
        text-transform: uppercase;
      }
      .brand small {
        display: block;
        margin-top: 6px;
        color: var(--cyan);
        font: 700 10px/1 var(--mono);
        letter-spacing: 1.8px;
      }
      .github-ribbon {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 0 15px 0 12px;
        border: 1px solid rgba(255,255,255,.3);
        border-radius: 999px;
        color: #fff;
        background: linear-gradient(135deg,#24292f,#10141b);
        box-shadow: 0 7px 24px rgba(0,0,0,.3);
        font: 800 12px/1 var(--mono);
        letter-spacing: .35px;
        text-decoration: none;
        transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease;
      }
      .github-ribbon:hover {
        border-color: var(--cyan);
        box-shadow: 0 8px 30px rgba(0,229,255,.18);
        transform: translateY(-1px);
      }
      .github-ribbon svg { width: 23px; height: 23px; flex: 0 0 auto; fill: currentColor; }
      .github-ribbon small {
        display: block;
        margin-top: 4px;
        color: #aeb8c5;
        font: 650 9px/1 var(--mono);
        letter-spacing: .2px;
      }
      main { width: min(1180px,100%); margin: 0 auto; padding: 38px clamp(18px,5vw,54px) 70px; }
      .hero { display: flex; align-items: end; justify-content: space-between; gap: 28px; margin-bottom: 25px; }
      .eyebrow { margin: 0 0 10px; color: var(--cyan); font: 800 11px/1 var(--mono); letter-spacing: 1.6px; }
      h1 { margin: 0; font: italic clamp(43px,6vw,66px)/.88 var(--display); letter-spacing: -.5px; text-transform: uppercase; }
      h1 em { color: var(--gold); font-style: inherit; }
      .subtitle { max-width: 610px; margin: 15px 0 0; color: #c3cde0; font-size: 15px; line-height: 1.5; }
      .refresh {
        min-height: 44px;
        padding: 0 18px;
        border: 1px solid rgba(0,229,255,.55);
        color: var(--cyan);
        background: rgba(0,229,255,.07);
        cursor: pointer;
        font-weight: 800;
        clip-path: polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);
      }
      .refresh:disabled { cursor: wait; opacity: .55; }
      .grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 16px; }
      .card {
        position: relative;
        min-height: 300px;
        padding: 23px;
        border: 1px solid var(--line);
        background: linear-gradient(145deg,rgba(23,35,58,.97),rgba(8,14,27,.97));
        clip-path: polygon(13px 0,100% 0,100% calc(100% - 13px),calc(100% - 13px) 100%,0 100%,0 13px);
      }
      .card.loading { opacity: .76; }
      .card::before { position: absolute; top: 0; left: 23px; width: 68px; height: 2px; content: ""; background: var(--accent); box-shadow: 0 0 14px var(--accent); }
      .card[data-accent="gold"] { --accent: var(--gold); }
      .card[data-accent="cyan"] { --accent: var(--cyan); }
      .card[data-accent="purple"] { --accent: var(--purple); }
      .card-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
      .card h2 { margin: 11px 0 3px; font: italic 29px/1 var(--display); letter-spacing: .6px; text-transform: uppercase; }
      .access { color: var(--muted); font: 700 11px/1.25 var(--mono); letter-spacing: .35px; }
      .deployment-status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        color: #aebbd0;
        font: 800 10px/1 var(--mono);
        letter-spacing: .5px;
        white-space: nowrap;
      }
      .lamp { width: 13px; height: 13px; margin-top: 10px; border: 1px solid #4a5670; background: #29344a; transform: rotate(45deg); }
      .deployment-status .lamp { margin: 0; }
      .lamp.ok { border-color: var(--green); background: var(--green); box-shadow: 0 0 14px rgba(23,224,194,.75); }
      .lamp.mismatch { border-color: var(--gold); background: var(--gold); box-shadow: 0 0 14px rgba(255,196,0,.6); }
      .deployment-status.ok { color: var(--green); }
      .deployment-status.mismatch { color: var(--gold); }
      .deployment-status.down { color: #ff8cab; }
      .version-label { margin: 28px 0 5px; color: var(--muted); font: 700 11px/1 var(--mono); letter-spacing: 1px; }
      .version { margin: 0; color: var(--accent); font: italic 42px/1 var(--display); letter-spacing: .5px; }
      .expected { min-height: 20px; margin: 7px 0 20px; color: #b7c3d8; font-size: 13px; }
      .expected.mismatch { color: #ff8cab; }
      .release-label {
        display: block;
        margin: 0 0 7px;
        color: var(--muted);
        font: 750 11px/1 var(--mono);
        letter-spacing: .7px;
      }
      .card-actions { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
      select {
        min-width: 0;
        min-height: 42px;
        padding: 0 10px;
        border: 1px solid #44516b;
        color: var(--text);
        background: var(--black);
      }
      .prepare {
        min-height: 42px;
        padding: 0 13px;
        border: 1px solid rgba(255,196,0,.6);
        color: var(--gold);
        background: rgba(255,196,0,.06);
        cursor: pointer;
        font: 800 11px/1 var(--mono);
        letter-spacing: .25px;
      }
      .prepare:disabled { cursor: not-allowed; opacity: .5; }
      .open-env {
        display: inline-block;
        margin-top: 18px;
        color: var(--cyan);
        font: 750 12px/1 var(--mono);
        text-decoration: none;
      }
      .open-env[aria-disabled="true"] { pointer-events: none; color: #65728a; }
      .notice {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 13px;
        margin-top: 20px;
        padding: 18px 20px;
        border: 1px solid rgba(255,196,0,.28);
        color: #cbd4e5;
        background: rgba(255,196,0,.04);
        font-size: 12px;
        line-height: 1.55;
      }
      .notice b { color: var(--gold); }
      .checked { margin: 18px 0 0; color: var(--muted); font: 700 11px/1 var(--mono); letter-spacing: .45px; text-align: right; }
      dialog {
        width: min(560px,calc(100% - 30px));
        padding: 0;
        border: 1px solid rgba(0,229,255,.5);
        color: var(--text);
        background: var(--surface);
        box-shadow: 0 28px 90px rgba(0,0,0,.65);
      }
      dialog::backdrop { background: rgba(3,6,14,.84); backdrop-filter: blur(6px); }
      .modal { padding: 27px; }
      .modal h2 { margin: 0 0 10px; font: italic 31px/1 var(--display); text-transform: uppercase; }
      .modal p { color: #c4cee0; line-height: 1.5; }
      .command { padding: 14px; border: 1px solid #35425d; color: var(--cyan); background: var(--black); font: 650 11px/1.55 var(--mono); word-break: break-word; }
      .modal-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 9px; margin-top: 20px; }
      .modal button, .modal a { min-height: 42px; display: inline-flex; align-items: center; padding: 0 15px; border: 1px solid #45536d; color: var(--text); background: transparent; cursor: pointer; font-weight: 750; text-decoration: none; }
      .modal .copy { border-color: var(--cyan); color: var(--cyan); }
      .copy-status { min-height: 18px; margin: 10px 0 0; color: var(--green); font: 700 11px/1.4 var(--mono); text-align: right; }
      button:focus-visible, a:focus-visible, select:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }
      @media (max-width: 860px) {
        .grid { grid-template-columns: 1fr; }
        .hero { align-items: start; flex-direction: column; }
        .refresh { align-self: stretch; }
      }
      @media (max-width: 520px) {
        .topbar { min-height: 62px; padding: 10px 13px; }
        .mark { width: 36px; height: 36px; font-size: 23px; }
        .brand strong { font-size: 24px; }
        .brand small { display: none; }
        .github-ribbon { width: 44px; padding: 0; justify-content: center; }
        .github-ribbon span { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        main { padding-top: 30px; }
        .card-actions { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="brand"><span class="mark">♞</span><span><strong>ChessRiot Control</strong><small>ENVIRONMENTS // RELEASES // RECOVERY</small></span></div>
      <a class="github-ribbon" href="https://github.com/ripper234/ChessRiot" target="_blank" rel="noopener noreferrer" aria-label="View ChessRiot source on GitHub">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.98 10.98 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>
        <span>View on GitHub<small>Source + history ↗</small></span>
      </a>
    </header>
    <main>
      <section class="hero">
        <div>
          <p class="eyebrow">CONTROL v${CONTROL_VERSION} // DEPLOYMENT OVERVIEW</p>
          <h1>SHIP CALMLY.<br><em>ROLL BACK SAFELY.</em></h1>
          <p class="subtitle">Three isolated environments, immutable releases, and one clear view of what is running where.</p>
        </div>
        <button class="refresh" id="refresh" type="button">REFRESH STATUS</button>
      </section>
      <section class="grid" id="grid" aria-live="polite" aria-busy="true">${initialCards}</section>
      <aside class="notice"><b>!</b><span><b>Code releases only.</b> Game data and runtime configuration stay in their environment. Until a trusted CI controller is added, release changes remain protected inside ChatGPT. This page creates the exact request without exposing deployment credentials.</span></aside>
      <p class="checked" id="checked">Checking deployments…</p>
    </main>
    <dialog id="rollback-dialog" aria-labelledby="dialog-title" aria-describedby="dialog-description">
      <div class="modal">
        <h2 id="dialog-title">Create release request</h2>
        <p id="dialog-description">Copy this exact request, then paste it into the ChessRiot project in ChatGPT.</p>
        <div class="command" id="command"></div>
        <p class="copy-status" id="copy-status" role="status" aria-live="polite"></p>
        <div class="modal-actions">
          <button id="cancel" type="button">Cancel</button>
          <button class="copy" id="copy" type="button">Copy request</button>
          <a id="open-chatgpt" href="https://chatgpt.com" target="_blank" rel="noopener noreferrer">Open ChatGPT ↗</a>
        </div>
      </div>
    </dialog>
    <script>
      const grid = document.querySelector("#grid");
      const checked = document.querySelector("#checked");
      const refresh = document.querySelector("#refresh");
      const dialog = document.querySelector("#rollback-dialog");
      const command = document.querySelector("#command");
      const copy = document.querySelector("#copy");
      const copyStatus = document.querySelector("#copy-status");
      let status = null;

      function compareVersions(a, b) {
        const left = a.split(".").map(Number);
        const right = b.split(".").map(Number);
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

      function card(item, versions) {
        const article = document.createElement("article");
        article.className = "card";
        article.dataset.accent = item.accent;
        const liveVersion = item.version ? "v" + item.version : "Unavailable";
        const matches = item.version === item.expectedVersion;
        article.innerHTML = \`
          <div class="card-head">
            <div><h2></h2><span class="access"></span></div>
            <span class="deployment-status"><span class="lamp"></span><span class="status-text"></span></span>
          </div>
          <p class="version-label">ACTIVE RELEASE</p>
          <p class="version"></p>
          <p class="expected"></p>
          <label class="release-label">CHANGE TO RELEASE</label>
          <div class="card-actions">
            <select aria-label="Release target"></select>
            <button class="prepare" type="button">CREATE REQUEST</button>
          </div>
          <a class="open-env" target="_blank" rel="noopener noreferrer">OPEN ENVIRONMENT ↗</a>
        \`;
        article.querySelector("h2").textContent = item.name;
        article.querySelector(".access").textContent = item.access + " // isolated data";
        article.querySelector(".version").textContent = liveVersion;
        const expected = article.querySelector(".expected");
        expected.textContent = matches
          ? "Matches target v" + item.expectedVersion
          : item.message + " · target v" + item.expectedVersion;
        if (!matches) expected.classList.add("mismatch");
        const deploymentStatus = article.querySelector(".deployment-status");
        const lamp = article.querySelector(".lamp");
        const statusText = article.querySelector(".status-text");
        if (!item.healthy) {
          deploymentStatus.classList.add("down");
          statusText.textContent = "UNAVAILABLE";
        } else if (!matches) {
          deploymentStatus.classList.add("mismatch");
          lamp.classList.add("mismatch");
          statusText.textContent = "TARGET MISMATCH";
        } else {
          deploymentStatus.classList.add("ok");
          lamp.classList.add("ok");
          statusText.textContent = "HEALTHY";
        }
        deploymentStatus.setAttribute("aria-label", statusText.textContent.toLowerCase());

        const select = article.querySelector("select");
        const targetVersions = versions.filter((version) => version !== item.version);
        targetVersions.forEach((version) => {
          const option = document.createElement("option");
          option.value = version;
          option.textContent = "v" + version + " · " + releaseVerb(item.version, version).toLowerCase();
          select.append(option);
        });
        const prepare = article.querySelector(".prepare");
        if (!targetVersions.length) {
          const option = document.createElement("option");
          option.textContent = "No other release";
          select.append(option);
          select.disabled = true;
          prepare.disabled = true;
        }

        prepare.addEventListener("click", () => {
          const target = select.value;
          const verb = releaseVerb(item.version, target);
          const current = item.version ? " from v" + item.version : "";
          command.textContent =
            verb + " ChessRiot " + item.name.toLowerCase() + current + " to v" + target +
            ". Deploy the saved Sites version matching that semantic release, verify the deployment, and report the resulting URL. Do not change game data or runtime configuration.";
          copy.textContent = "Copy request";
          copyStatus.textContent = "";
          dialog.showModal();
        });
        const link = article.querySelector(".open-env");
        if (item.url) link.href = item.url;
        else link.setAttribute("aria-disabled", "true");
        return article;
      }

      async function loadStatus() {
        grid.setAttribute("aria-busy", "true");
        refresh.disabled = true;
        refresh.textContent = "CHECKING…";
        try {
          const response = await fetch("/api/status", { cache: "no-store" });
          if (!response.ok) throw new Error("Status check failed");
          status = await response.json();
          grid.replaceChildren(...status.environments.map((item) => card(item, status.availableVersions)));
          checked.textContent = "Last checked " + new Date(status.checkedAt).toLocaleString();
        } catch {
          grid.textContent = "Could not load deployment status.";
          checked.textContent = "Status unavailable";
        } finally {
          grid.setAttribute("aria-busy", "false");
          refresh.disabled = false;
          refresh.textContent = "REFRESH STATUS";
        }
      }

      async function copyRequest() {
        const text = command.textContent;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          document.body.append(textarea);
          textarea.select();
          document.execCommand("copy");
          textarea.remove();
        }
        copy.textContent = "Copied";
        copyStatus.textContent = "Request copied to clipboard.";
      }

      refresh.addEventListener("click", loadStatus);
      document.querySelector("#cancel").addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
      copy.addEventListener("click", copyRequest);
      loadStatus();
    </script>
  </body>
</html>`;

const securityHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export default {
  async fetch(request, env, ctx) {
    void ctx;
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/status") {
      return statusResponse(env);
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
