(function () {
  const rawEndpoint = String(window.MSM_VISITOR_LOG_ENDPOINT || "").trim();
  if (!rawEndpoint) return;
  const debug = new URLSearchParams(window.location.search).has("debug_visit");

  const endpoint = rawEndpoint.endsWith("/collect")
    ? rawEndpoint
    : rawEndpoint.replace(/\/+$/, "") + "/collect";

  function debugStatus(message) {
    if (!debug) return;
    console.info("[visitor-log]", message);
    let badge = document.getElementById("visitor-log-debug");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "visitor-log-debug";
      badge.style.cssText = [
        "position:fixed",
        "right:10px",
        "bottom:10px",
        "z-index:999999",
        "max-width:min(420px, calc(100vw - 20px))",
        "padding:8px 10px",
        "border:1px solid #9fc8bf",
        "border-radius:6px",
        "background:#eef8f6",
        "color:#164f47",
        "font:12px/1.4 system-ui, sans-serif",
        "box-shadow:0 6px 24px rgba(0,0,0,.12)",
      ].join(";");
      document.body.appendChild(badge);
    }
    badge.textContent = "visitor log: " + message;
  }

  function sessionId() {
    try {
      const key = "msm_visit_session_id";
      let value = window.sessionStorage.getItem(key);
      if (!value) {
        const bytes = new Uint8Array(12);
        window.crypto.getRandomValues(bytes);
        value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        window.sessionStorage.setItem(key, value);
      }
      return value;
    } catch (_) {
      return "";
    }
  }

  function buildPayload() {
    const viewport = window.innerWidth + "x" + window.innerHeight;
    const screenSize = window.screen ? window.screen.width + "x" + window.screen.height : "";
    return {
      path: window.location.pathname + window.location.search,
      title: document.title || "",
      referrer: document.referrer || "",
      language: navigator.language || "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      viewport,
      screen: screenSize,
      session_id: sessionId(),
    };
  }

  async function send() {
    const body = JSON.stringify(buildPayload());
    debugStatus("sending to " + endpoint);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body,
      });
      debugStatus(response.ok ? "saved (" + response.status + ")" : "failed (" + response.status + ")");
    } catch (error) {
      debugStatus("failed: " + (error && error.message ? error.message : String(error)));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", send, { once: true });
  } else {
    send();
  }
})();
