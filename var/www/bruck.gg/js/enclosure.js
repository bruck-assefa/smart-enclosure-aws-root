/* Current dashboard: cached AWS state only; no polling of hardware diagnostics. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const API = "/enclosure";
  let snapshot = null, receivedAt = 0, timer = null, inFlight = null;
  let generation = 0, failures = 0, fahrenheit = true, busy = false, apiHealthy = false;
  let renderedRelays = false;
  const source = () => $("source").value;
  const scenario = () => $("scenario").value;
  const message = text => { $("message").textContent = text; };
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const age = seconds => seconds == null ? "Never received" : seconds < 60 ?
    `${Math.floor(seconds)}s ago` : `${Math.floor(seconds / 60)}m ago`;
  const stamp = value => value == null ? "Never" : new Date(value * 1000).toLocaleString();

  async function request(path, options = {}, controller = new AbortController()) {
    const deadline = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(API + path, {...options, signal: controller.signal, cache: "no-store"});
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      return data;
    } finally {
      clearTimeout(deadline);
    }
  }

  function controlsAllowed() {
    return source() === "hardware" && apiHealthy && snapshot?.controls_enabled &&
      performance.now() - receivedAt < 15000 && !busy;
  }

  function renderSensors() {
    const holder = $("sensor-container");
    const expanded = new Set([...holder.querySelectorAll("details[open]")].map(el => el.dataset.sensor));
    holder.replaceChildren();
    if (!snapshot) {
      holder.append(node("p", "No sensor state available yet. The page remains usable while AWS or the Pi is unavailable."));
      return;
    }
    const counts = {};
    for (const sensor of snapshot.snapshot.sensors) {
      const elapsed = (performance.now() - receivedAt) / 1000;
      const seconds = sensor.age_seconds == null ? null : sensor.age_seconds + elapsed;
      let status = sensor.status;
      if (sensor.enabled && seconds != null && seconds > 30) status = "stale";
      counts[status] = (counts[status] || 0) + 1;
      const card = node("article", "", `sensor-box ${status}`);
      card.append(node("h3", sensor.label), node("strong", status.toUpperCase()));
      const reading = sensor.last_good_reading;
      if (reading) {
        const temperature = fahrenheit ? reading.temperature_c * 9 / 5 + 32 : reading.temperature_c;
        card.append(node("p", `${status === "healthy" ? "" : "Last good: "}${temperature.toFixed(1)}°${fahrenheit ? "F" : "C"} · ${reading.humidity_pct.toFixed(1)}% RH`, "reading"));
        card.append(node("p", `${reading.pressure_hpa.toFixed(1)} hPa · measured ${age(seconds)}`));
      } else {
        card.append(node("p", status === "disabled" ? "Not configured for collection" : "No successful measurement"));
      }
      const details = document.createElement("details");
      details.dataset.sensor = sensor.sensor_id;
      details.open = expanded.has(sensor.sensor_id);
      details.append(node("summary", "Sensor diagnostics"));
      const hw = sensor.hardware;
      for (const text of [
        `ID: ${sensor.sensor_id} · source: ${sensor.source}`,
        `I²C bus ${hw.bus} · mux ${hw.multiplexer_address} · channel ${hw.channel}`,
        `Expected sensor address: ${hw.sensor_addresses.join(" or ")}`,
        `Last success: ${stamp(sensor.last_success_at)}`,
        `Last attempt: ${stamp(sensor.last_attempt_at)}`,
        `Consecutive failures: ${sensor.consecutive_failures}`,
        `Error: ${sensor.error_code || "none"}`
      ]) details.append(node("p", text));
      if (sensor.error_code) details.append(node("p", "Check this channel's wiring and power. Multiple affected channels may indicate a shared bus or multiplexer issue."));
      card.append(details);
      holder.append(card);
    }
    $("summary").textContent = Object.entries(counts).map(([key, count]) => `${count} ${key}`).join(" · ");
  }

  function renderRelays() {
    const holder = $("relay-container");
    if (source() === "simulation") {
      holder.replaceChildren(node("p", "Physical controls are disabled in simulation. No relay or schedule commands are sent."));
      renderedRelays = false;
      return;
    }
    if (!renderedRelays) {
      holder.replaceChildren();
      for (const id of ["1", "2", "3", "4"]) {
        const row = node("article", "", "relay-item");
        row.append(node("h3", `Relay ${id}`));
        const status = node("p", "Unknown");
        status.id = `relay-status-${id}`;
        row.append(status);
        const toggle = node("button", "Toggle");
        toggle.id = `toggle-${id}`;
        toggle.addEventListener("click", () => {
          const current = snapshot?.relays.data?.[id];
          if (current !== "on" && current !== "off") return;
          command(`/relays/${id}/${current === "on" ? "off" : "on"}`, "POST");
        });
        row.append(toggle);
        for (const field of ["on", "off"]) {
          const label = node("label", field.toUpperCase() + " ");
          const input = document.createElement("input");
          input.type = "time"; input.id = `${field}-${id}`;
          input.addEventListener("input", () => { input.dataset.dirty = "1"; });
          label.append(input); row.append(label);
        }
        const save = node("button", "Save schedule");
        save.addEventListener("click", () => {
          const on = $(`on-${id}`).value, off = $(`off-${id}`).value;
          if (!on || !off) { message("Enter both schedule times."); return; }
          command(`/schedules/${id}`, "PUT", {on_time: on, off_time: off, mode: "auto"}, id);
        });
        row.append(save);
        holder.append(row);
      }
      renderedRelays = true;
    }
    for (const id of ["1", "2", "3", "4"]) {
      const state = snapshot?.relays.data?.[id] || "unknown";
      $(`relay-status-${id}`).textContent = `${state.toUpperCase()}${controlsAllowed() ? "" : " · unverified; controls unavailable"}`;
      $(`toggle-${id}`).textContent = `Turn ${state === "on" ? "OFF" : "ON"}`;
      const schedule = snapshot?.schedules.data?.find(s => String(s.relay_id) === id);
      for (const field of ["on", "off"]) {
        const input = $(`${field}-${id}`);
        if (!input.dataset.dirty && document.activeElement !== input && schedule)
          input.value = schedule[`${field}_time`];
      }
    }
    holder.querySelectorAll("button, input").forEach(element => { element.disabled = !controlsAllowed(); });
  }

  function render() {
    $("simulation-banner").hidden = source() !== "simulation";
    $("scenario-label").hidden = source() !== "simulation";
    const connected = snapshot?.connection.status === "connected";
    const collector = snapshot?.snapshot.collector.status || "unknown";
    $("connection").textContent = !apiHealthy ? "AWS state unavailable — retained readings may be old." :
      source() === "simulation" ? `SIMULATION · ${scenario()} · connection ${connected ? "available" : "unavailable"}` :
      `Pi connection: ${connected ? "connected" : "unavailable"} · sensor collector: ${collector}`;
    $("load-camera").disabled = source() !== "hardware" || !apiHealthy || !snapshot?.live_available;
    renderSensors();
    renderRelays();
  }

  async function poll() {
    if (inFlight || document.hidden) return;
    const version = generation;
    const controller = new AbortController();
    inFlight = controller;
    try {
      const data = await request(`/state?source=${source()}&scenario=${scenario()}`, {}, controller);
      if (version !== generation) return;
      if (!data.snapshot || !Array.isArray(data.snapshot.sensors) || data.source !== source())
        throw new Error("Incompatible gateway response");
      snapshot = data; receivedAt = performance.now(); apiHealthy = true; failures = 0;
    } catch (error) {
      if (version !== generation) return;
      apiHealthy = false; failures++;
    } finally {
      if (inFlight === controller) inFlight = null;
      if (version === generation) {
        render();
        clearTimeout(timer);
        timer = setTimeout(poll, Math.min(30000, 5000 * 2 ** Math.min(failures, 3)));
      } else {
        clearTimeout(timer);
        timer = setTimeout(poll, 0);
      }
    }
  }

  async function command(path, method, body, relayId) {
    if (!controlsAllowed()) return;
    busy = true; $("source").disabled = true; $("scenario").disabled = true; renderRelays();
    try {
      await request(path + "?source=hardware", {method,
        headers: {"Content-Type": "application/json", "X-Enclosure-Control": "1"},
        ...(body ? {body: JSON.stringify(body)} : {})});
      message("Command accepted. Waiting for refreshed device state.");
      if (relayId) for (const field of ["on", "off"]) delete $(`${field}-${relayId}`).dataset.dirty;
    } catch (error) {
      message("Command was not confirmed. Verify device state before retrying. " + error.message);
    } finally {
      busy = false; $("source").disabled = false; $("scenario").disabled = false; apiHealthy = false; renderRelays();
      clearTimeout(timer);
      if (!inFlight) poll();
    }
  }

  function changeMode() {
    generation++; snapshot = null; apiHealthy = false; failures = 0;
    clearTimeout(timer);
    $("camera").replaceChildren();
    message("");
    render();
    if (inFlight) inFlight.abort(); else poll();
  }
  $("source").addEventListener("change", changeMode);
  $("scenario").addEventListener("change", changeMode);
  $("unit-toggle").addEventListener("click", () => {
    fahrenheit = !fahrenheit;
    $("unit-toggle").textContent = fahrenheit ? "Show °C" : "Show °F";
    renderSensors();
  });
  $("load-camera").addEventListener("click", () => {
    if (source() !== "hardware" || !apiHealthy || !snapshot?.live_available) return;
    const frame = document.createElement("iframe");
    frame.src = "https://api.bruck.gg/pi/cam/";
    frame.title = "Live enclosure camera"; frame.allowFullscreen = true;
    $("camera").replaceChildren(frame);
  });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (document.hidden) { if (inFlight) inFlight.abort(); }
    else if (!inFlight) poll();
  });
  // Age retained readings even when the server cannot be reached.
  setInterval(() => { if (!document.hidden) render(); }, 1000);
  if (new URLSearchParams(location.search).get("source") === "simulation") $("source").value = "simulation";
  render(); poll();
})();
