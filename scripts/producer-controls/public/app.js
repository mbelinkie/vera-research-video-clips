// Producer Controls (#107) page. Plain JS, no build step, so the panel works
// even when the Research website hasn't been built. All text is inserted with
// textContent; nothing from the server is parsed as HTML.

const token = document.querySelector('meta[name="controls-token"]').content;
const main = document.getElementById("main");
const opBox = document.getElementById("op");
const tabsBox = document.getElementById("tabs");
const modeBox = document.getElementById("mode");

const TABS = [
  ["overview", "Overview"],
  ["setup", "Setup"],
  ["walkthrough", "#48 walkthrough"],
  ["activity", "Activity"],
];
const ISSUE_48 =
  "https://github.com/mbelinkie/vera-research-video-clips/issues/48";

let data;
let tab = readPref("tab", "overview");
let selectedStep = readPref("step", "");
let showOutput = false;
let pollTimer;
let loadError = "";

function readPref(key, fallback) {
  try {
    return localStorage.getItem(`vera-controls-${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    localStorage.setItem(`vera-controls-${key}`, value);
  } catch {
    /* private window */
  }
}

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false || value === null) continue;
    if (key === "class") node.className = value;
    else if (key === "style")
      node.style.cssText = value; // CSSOM: allowed by the page's CSP
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return node;
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      "x-controls-token": token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const type = response.headers.get("content-type") ?? "";
  const payload = type.includes("json")
    ? await response.json()
    : await response.text();
  if (!response.ok && response.status !== 409)
    throw new Error(payload?.message ?? `Error ${response.status}`);
  return { status: response.status, payload };
}

async function refresh() {
  try {
    const { payload } = await api("/api/state");
    data = payload;
    loadError = "";
  } catch (error) {
    loadError =
      error instanceof TypeError
        ? "Producer Controls isn't answering. Reopen VERA Producer Controls from Applications."
        : error.message;
  }
  render();
  schedule();
}

function schedule() {
  clearTimeout(pollTimer);
  const busy = data?.operation?.state === "running";
  pollTimer = setTimeout(refresh, busy ? 1500 : 15000);
}

// ---------------------------------------------------------------- actions

const EXPOSURE = {
  "open-access": {
    title: "Open access for testing?",
    text: "Invited testers can connect while this Mac is awake and online. You can pause access at any time from this panel.",
    yes: "Open access",
  },
  "stop-research": {
    title: "Stop Research?",
    text: "This stops outside access and Research on this Mac. Testers see an unavailable page. Saved work is safe.",
    yes: "Stop Research",
  },
};

function ask({ title, text, yes }) {
  const dialog = document.getElementById("confirm");
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-text").textContent = text;
  const yesButton = document.getElementById("confirm-yes");
  yesButton.textContent = yes;
  return new Promise((done) => {
    const finish = (value) => {
      dialog.close();
      done(value);
    };
    yesButton.onclick = () => finish(true);
    document.getElementById("confirm-no").onclick = () => finish(false);
    dialog.oncancel = () => finish(false);
    dialog.showModal();
    yesButton.focus();
  });
}

async function act(action, input = {}) {
  if (EXPOSURE[action] && !(await ask(EXPOSURE[action]))) return;
  showOutput = false;
  try {
    const { status, payload } = await api("/api/action", { action, input });
    if (status === 409) flash(payload.message, "failed");
  } catch (error) {
    flash(error.message, "failed");
  }
  await refresh();
}

async function acceptance(op, input = {}) {
  try {
    const { payload } = await api("/api/acceptance", { op, ...input });
    if (!payload.ok) flash(payload.message, "failed");
  } catch (error) {
    flash(error.message, "failed");
  }
  await refresh();
}

let flashed;
function flash(message, state = "succeeded") {
  flashed = { message, state, at: Date.now() };
  renderOp();
}

async function copy(text, label = "Copied.") {
  try {
    await navigator.clipboard.writeText(text);
    flash(label);
  } catch {
    flash("Couldn't copy. Select the text and press Command-C.", "failed");
  }
}

function button(action, opts = {}) {
  const label = opts.label ?? data.actions[action] ?? action;
  const running = data.operation?.state === "running";
  return h(
    "button",
    {
      class: `btn ${opts.class ?? ""}`,
      type: "button",
      "data-key": `act-${action}-${opts.key ?? ""}`,
      disabled: running || opts.disabled,
      onclick: () => act(action, opts.input),
    },
    label,
  );
}

// ---------------------------------------------------------------- render

function render() {
  const focused = document.activeElement?.getAttribute("data-key");
  renderMode();
  renderTabs();
  renderOp();
  main.replaceChildren();
  if (loadError)
    main.append(
      h(
        "div",
        { class: "card hero", "data-tone": "bad" },
        h("h2", {}, "Can't load Producer Controls"),
        h("p", { class: "detail" }, loadError),
        h(
          "button",
          { class: "btn", type: "button", onclick: refresh },
          "Try again",
        ),
      ),
    );
  else if (!data) main.append(h("p", { class: "hint" }, "Checking this Mac…"));
  else if (tab === "setup") main.append(renderSetup());
  else if (tab === "walkthrough") main.append(renderWalkthrough());
  else if (tab === "activity") main.append(renderActivity());
  else main.append(renderOverview());
  if (focused)
    document.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
}

function renderMode() {
  modeBox.replaceChildren();
  if (!data) return;
  if (data.mode === "demo") {
    modeBox.append(
      h(
        "span",
        { class: "chip example" },
        "Example setup · nothing on this Mac changes",
      ),
      h("label", { class: "sr", for: "scenario" }, "Example state"),
      h(
        "select",
        {
          id: "scenario",
          "data-key": "scenario",
          onchange: async (event) => {
            await api("/api/demo", { scenario: event.target.value });
            await refresh();
          },
        },
        Object.entries(data.demo.scenarios).map(([id, label]) =>
          h("option", { value: id, selected: id === data.demo.current }, label),
        ),
      ),
    );
  } else {
    modeBox.append(
      h("span", { class: "chip" }, "This Mac only"),
      h(
        "span",
        {},
        `Checked ${new Date(data.snapshot.checkedAt).toLocaleTimeString()}`,
      ),
    );
  }
}

function renderTabs() {
  tabsBox.replaceChildren();
  const counts = data
    ? {
        setup: `${data.steps.filter((s) => s.state === "done").length}/${data.steps.length}`,
        walkthrough: `${data.acceptance.progress.done}/${data.acceptance.progress.total}`,
      }
    : {};
  TABS.forEach(([id, label], index) => {
    tabsBox.append(
      h(
        "button",
        {
          class: "tab",
          role: "tab",
          id: `tab-${id}`,
          "data-key": `tab-${id}`,
          "aria-selected": String(tab === id),
          "aria-controls": "main",
          tabindex: tab === id ? "0" : "-1",
          type: "button",
          onclick: () => selectTab(id),
          onkeydown: (event) => {
            const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
            if (!move) return;
            event.preventDefault();
            const next = TABS[(index + move + TABS.length) % TABS.length][0];
            selectTab(next);
            document.getElementById(`tab-${next}`)?.focus();
          },
        },
        label,
        counts[id] ? h("span", { class: "count" }, counts[id]) : null,
      ),
    );
  });
  main.setAttribute("role", "tabpanel");
  main.setAttribute("aria-labelledby", `tab-${tab}`);
}

function selectTab(id) {
  tab = id;
  writePref("tab", id);
  render();
}

function renderOp() {
  opBox.replaceChildren();
  const op = data?.operation;
  const recentFlash =
    flashed && Date.now() - flashed.at < 8000 ? flashed : undefined;
  if (
    op &&
    (op.state === "running" ||
      !recentFlash ||
      op.finishedAt > new Date(recentFlash.at).toISOString())
  ) {
    opBox.append(
      h(
        "div",
        {
          class: "op",
          "data-state": op.state,
          role: op.state === "failed" ? "alert" : "status",
        },
        op.state === "running"
          ? h("span", { class: "spinner", "aria-hidden": "true" })
          : null,
        h(
          "span",
          { class: "pill", "data-s": op.state },
          op.state === "running"
            ? "Working"
            : op.state === "succeeded"
              ? "Done"
              : "Didn't work",
        ),
        h(
          "span",
          { class: "msg" },
          op.state === "running"
            ? `${op.label}…`
            : `${op.label}: ${op.message ?? ""}`,
        ),
        op.output
          ? h(
              "button",
              {
                class: "btn quiet",
                type: "button",
                "data-key": "op-details",
                "aria-expanded": String(showOutput),
                onclick: () => {
                  showOutput = !showOutput;
                  renderOp();
                },
              },
              showOutput ? "Hide details" : "Technical details",
            )
          : null,
        op.state !== "running"
          ? h(
              "button",
              {
                class: "btn quiet",
                type: "button",
                "data-key": "op-dismiss",
                onclick: () => {
                  data.operation = undefined;
                  renderOp();
                },
              },
              "Dismiss",
            )
          : null,
        showOutput && op.output
          ? h("pre", { style: "flex-basis:100%" }, op.output)
          : null,
      ),
    );
  } else if (recentFlash) {
    opBox.append(
      h(
        "div",
        { class: "op", "data-state": recentFlash.state, role: "status" },
        h("span", { class: "msg" }, recentFlash.message),
      ),
    );
  }
}

// ---------------------------------------------------------------- overview

function renderOverview() {
  const o = data.overview;
  const primary = o.primary;
  const wrap = h("div");
  wrap.append(
    h(
      "section",
      {
        class: "card hero",
        "data-tone": o.tone,
        "aria-labelledby": "headline",
      },
      h("h2", { id: "headline" }, o.headline),
      h("p", { class: "detail" }, o.detail),
      h(
        "div",
        { class: "actions" },
        primary
          ? button(primary.action, {
              label: primary.label,
              class: `big ${primary.action === "pause-access" ? "pause" : "primary"}`,
              key: "hero",
            })
          : null,
        o.secondary.map((action) => button(action, { key: "hero2" })),
        !o.setupComplete
          ? h(
              "button",
              {
                class: "btn quiet",
                type: "button",
                "data-key": "go-setup",
                onclick: () => selectTab("setup"),
              },
              "Open guided setup",
            )
          : null,
      ),
      primary?.hint ? h("p", { class: "hint" }, primary.hint) : null,
    ),
  );
  wrap.append(
    h(
      "section",
      { class: "card", "aria-labelledby": "areas-title" },
      h("h3", { id: "areas-title" }, "What VERA checked"),
      h(
        "ul",
        { class: "areas" },
        o.areas.map((area) =>
          h(
            "li",
            { class: "area" },
            h("span", { class: "label" }, area.label),
            h(
              "span",
              {},
              h(
                "span",
                { class: "pill", "data-s": area.state },
                area.badge ?? AREA_WORDS[area.state] ?? area.state,
              ),
            ),
            h("span", { class: "text" }, area.text),
          ),
        ),
      ),
    ),
  );
  if (!o.openGate.allowed && !data.snapshot.service.remoteLoaded)
    wrap.append(
      h(
        "section",
        { class: "card" },
        h("h3", {}, "Why outside access stays off"),
        h(
          "p",
          { class: "hint" },
          "VERA keeps remote access off until every setup step, including a recovery test, passes.",
        ),
        h(
          "ul",
          {},
          o.openGate.reasons
            .slice(0, 4)
            .map((reason) => h("li", { class: "hint" }, reason)),
        ),
      ),
    );
  wrap.append(
    h(
      "section",
      { class: "card" },
      h("h3", {}, "Other controls"),
      h(
        "div",
        { class: "actions" },
        button("back-up-now", { key: "o" }),
        button("test-recovery", { key: "o" }),
        data.snapshot.service.apiRunning
          ? button("stop-research", { key: "o", class: "danger" })
          : button("start-research", { key: "o" }),
        data.snapshot.service.remoteLoaded
          ? button("pause-access", { key: "o", class: "pause" })
          : null,
        h(
          "button",
          {
            class: "btn",
            type: "button",
            "data-key": "diag",
            onclick: async () =>
              copy(
                (await api("/api/diagnostics")).payload,
                "Diagnostic summary copied. It contains no secrets, emails or IDs.",
              ),
          },
          "Copy diagnostic summary",
        ),
      ),
      h(
        "p",
        { class: "hint" },
        `Last encrypted backup: ${data.ages.backup}. Last recovery test: ${data.ages.drill}. Address checks: ${data.ages.edge}.`,
      ),
    ),
  );
  return wrap;
}

const AREA_WORDS = {
  ready: "Ready",
  checked: "Checked",
  attention: "Needs attention",
  unverified: "Unverified",
  off: "Off",
  on: "On",
};
const STEP_WORDS = {
  done: "Done",
  todo: "To do",
  attention: "Needs attention",
  unverified: "Unverified",
};

// ---------------------------------------------------------------- setup

function renderSetup() {
  const steps = data.steps;
  const current =
    steps.find((s) => s.id === selectedStep) ??
    steps.find((s) => s.state !== "done") ??
    steps[0];
  const list = h(
    "ol",
    { class: "steps card", "aria-label": "Setup steps" },
    steps.map((step, index) =>
      h(
        "li",
        {},
        h(
          "button",
          {
            type: "button",
            "data-key": `step-${step.id}`,
            "aria-current": step.id === current.id ? "step" : undefined,
            onclick: () => {
              selectedStep = step.id;
              writePref("step", step.id);
              render();
              document.getElementById("step-title")?.focus();
            },
          },
          h(
            "span",
            { class: "n", "data-s": step.state, "aria-hidden": "true" },
            step.state === "done" ? "✓" : index + 1,
          ),
          h(
            "span",
            {},
            h("span", { class: "t" }, step.title),
            h("span", { class: "s" }, STEP_WORDS[step.state]),
          ),
        ),
      ),
    ),
  );
  const index = steps.indexOf(current);
  const next = steps[index + 1];
  const detail = h(
    "section",
    { class: "card", "aria-labelledby": "step-title" },
    h("p", { class: "eyebrow" }, `Step ${index + 1} of ${steps.length}`),
    h("h2", { id: "step-title", tabindex: "-1" }, current.title),
    h(
      "p",
      {},
      h(
        "span",
        { class: "pill", "data-s": current.state },
        STEP_WORDS[current.state],
      ),
      " ",
      current.summary,
    ),
    current.values?.length
      ? h(
          "div",
          { class: "block" },
          h("p", { class: "block-title" }, "Exact values to copy"),
          h(
            "div",
            { class: "values" },
            current.values.map((v) =>
              h(
                "div",
                { class: "value" },
                h("span", { class: "k" }, v.label),
                h("code", {}, v.value),
                h(
                  "button",
                  {
                    class: "btn quiet",
                    type: "button",
                    "data-key": `copy-${v.label}`,
                    onclick: () => copy(v.value, `${v.label} copied.`),
                  },
                  "Copy",
                ),
              ),
            ),
          ),
        )
      : null,
    h(
      "div",
      { class: "block" },
      h("p", { class: "block-title" }, "What you do"),
      h(
        "ol",
        { class: "todo" },
        current.producer.map((line) => h("li", {}, line)),
      ),
    ),
    h(
      "div",
      { class: "block" },
      h("p", { class: "block-title" }, "What VERA does"),
      h("p", {}, current.vera),
    ),
    current.help
      ? h("p", { class: "note" }, `Needs help: ${current.help}`)
      : null,
    current.confirmations?.length
      ? h(
          "div",
          { class: "block" },
          h("p", { class: "block-title" }, "You confirm"),
          current.confirmations.map((c) => {
            const at = data.snapshot.confirmations[c.id];
            return h(
              "label",
              { class: "confirm" },
              h("input", {
                type: "checkbox",
                "data-key": `confirm-${c.id}`,
                checked: Boolean(at),
                disabled: data.operation?.state === "running",
                onchange: (event) =>
                  act(event.target.checked ? "confirm" : "unconfirm", {
                    id: c.id,
                  }),
              }),
              h(
                "span",
                {},
                c.label,
                at
                  ? h("small", {}, `Confirmed ${new Date(at).toLocaleString()}`)
                  : null,
              ),
            );
          }),
        )
      : null,
    current.id === "backup-key" && data.snapshot.backupKey.fingerprint
      ? h(
          "p",
          { class: "hint" },
          `Key fingerprint: ${data.snapshot.backupKey.fingerprint}. Put this in the password manager item's notes.`,
        )
      : null,
    h(
      "div",
      { class: "block actions" },
      current.actions.map((action, i) =>
        button(action, {
          key: current.id,
          class: i === 0 && current.state !== "done" ? "primary" : "",
        }),
      ),
      next
        ? h(
            "button",
            {
              class: "btn quiet",
              type: "button",
              "data-key": "next-step",
              onclick: () => {
                selectedStep = next.id;
                writePref("step", next.id);
                render();
                document.getElementById("step-title")?.focus();
              },
            },
            `Next: ${next.title} →`,
          )
        : h(
            "button",
            {
              class: "btn quiet",
              type: "button",
              "data-key": "to-overview",
              onclick: () => selectTab("overview"),
            },
            "Back to overview →",
          ),
    ),
  );
  return h("div", { class: "setup" }, list, detail);
}

// ---------------------------------------------------------------- walkthrough

function renderWalkthrough() {
  const a = data.acceptance;
  const record = a.record;
  const wrap = h("div");
  const pct = Math.round((a.progress.done / a.progress.total) * 100);
  wrap.append(
    h(
      "section",
      { class: "card" },
      h("h2", {}, "#48 Producer live acceptance"),
      h(
        "p",
        { class: "hint" },
        "Follow the stages in order. VERA records what it can prove from this Mac; you record what you see testers do. Steps that need testers can only be recorded while remote access is on.",
      ),
      h(
        "div",
        {
          class: "progress",
          role: "progressbar",
          "aria-valuenow": String(a.progress.done),
          "aria-valuemin": "0",
          "aria-valuemax": String(a.progress.total),
          "aria-label": "Walkthrough progress",
        },
        h("span", { style: `width:${pct}%` }),
      ),
      h(
        "p",
        { class: "hint" },
        `${a.progress.done} of ${a.progress.total} recorded · started ${new Date(record.startedAt).toLocaleString()}`,
      ),
    ),
  );
  for (const stage of a.stages) wrap.append(renderStage(stage, record));
  wrap.append(renderSignOff(a));
  return wrap;
}

function renderStage(stage, record) {
  const s = data.snapshot;
  const extra = [];
  if (stage.id === "restore") extra.push(renderRestore(record));
  if (stage.id === "sign-in" && !s.service.remoteLoaded)
    extra.push(
      h(
        "div",
        { class: "actions block" },
        button("open-access", { class: "primary", key: "wt" }),
        h(
          "span",
          { class: "hint" },
          data.overview.openGate.allowed ? "" : "Available once setup passes.",
        ),
      ),
    );
  if (stage.id === "interruption") {
    const row = h("div", { class: "actions block" });
    if (s.service.remoteLoaded)
      row.append(button("pause-access", { class: "pause", key: "wt" }));
    if (data.mode === "demo")
      row.append(
        h(
          "button",
          {
            class: "btn",
            type: "button",
            "data-key": "sim-sleep",
            onclick: async () => {
              await api("/api/demo", { simulate: "sleep" });
              refresh();
            },
          },
          "Example: Mac sleeps",
        ),
        h(
          "button",
          {
            class: "btn",
            type: "button",
            "data-key": "sim-wake",
            onclick: async () => {
              await api("/api/demo", { simulate: "wake" });
              refresh();
            },
          },
          "Example: Mac wakes",
        ),
      );
    extra.push(row);
  }
  const done = stage.items.filter((i) => i.recorded).length;
  return h(
    "section",
    { class: "card stage", "aria-labelledby": `stage-${stage.id}` },
    h(
      "header",
      {},
      h("h3", { id: `stage-${stage.id}` }, stage.title),
      h(
        "span",
        { class: "gate" },
        `${stage.gate} · ${done}/${stage.items.length}`,
      ),
    ),
    h("p", { class: "intro" }, stage.intro),
    extra,
    h(
      "ul",
      { class: "items" },
      stage.items.map((item) => renderItem(item)),
    ),
  );
}

function renderItem(item) {
  const rec = item.recorded;
  const signed = Boolean(data.acceptance.record.signOff);
  return h(
    "li",
    { class: "item", "data-done": String(Boolean(rec)) },
    h("span", { class: "mark", "aria-hidden": "true" }, rec ? "✓" : ""),
    h(
      "div",
      {},
      h(
        "span",
        { class: "kind" },
        item.kind === "check" ? "VERA checks" : "You observe",
      ),
      item.text,
      rec
        ? h(
            "span",
            { class: "sub ok" },
            `${item.kind === "check" ? "Verified" : "Recorded"} ${new Date(rec.at).toLocaleString()}${rec.evidence ? ` — ${rec.evidence}` : ""}`,
          )
        : item.blockedBy
          ? h("span", { class: "sub blocked" }, item.blockedBy)
          : item.live
            ? h("span", { class: "sub ok" }, item.live.evidence)
            : null,
      !rec && item.how ? h("span", { class: "sub" }, item.how) : null,
    ),
    rec
      ? signed
        ? h("span", { class: "pill", "data-s": "recorded" }, "Recorded")
        : h(
            "button",
            {
              class: "btn quiet",
              type: "button",
              "data-key": `undo-${item.id}`,
              onclick: () => acceptance("undo", { id: item.id }),
              "aria-label": `Undo: ${item.text}`,
            },
            "Undo",
          )
      : h(
          "button",
          {
            class: `btn ${item.canRecord ? "primary" : ""}`,
            type: "button",
            "data-key": `rec-${item.id}`,
            disabled: !item.canRecord,
            "aria-label": `${item.kind === "check" ? "Record check" : "I saw this"}: ${item.text}`,
            onclick: () => acceptance("record", { id: item.id }),
          },
          item.kind === "check" ? "Record" : "I saw this",
        ),
  );
}

function renderRestore(record) {
  const t = record.restoreTest;
  const box = h("div", { class: "block" });
  const running = data.operation?.state === "running";
  if (!t || t.removedAt) {
    box.append(
      h(
        "p",
        { class: "hint" },
        "VERA asks for the backup key in a macOS window (paste it from your password manager), checks its fingerprint, restores the newest off-Mac backup into a new database and folder, verifies it, and compares memberships with today's. The key never appears here.",
      ),
      h(
        "div",
        { class: "actions" },
        button("restore-test-copy", {
          class: "primary",
          key: "restore",
          disabled: running,
        }),
      ),
    );
    if (t?.removedAt)
      box.append(
        h(
          "p",
          { class: "hint" },
          `Previous test copy removed ${new Date(t.removedAt).toLocaleString()}.`,
        ),
      );
    return box;
  }
  const c = t.comparison;
  const rows = [
    ...c.restoredOnly.map((r) => ({
      ...r,
      change: "In the backup, revoked since — must stay revoked",
      cls: "revoked",
    })),
    ...c.roleChanged.map((r) => ({
      ...r,
      role: `${r.role} → now ${r.liveRole}`,
      change: "Role changed since the backup — today's role stands",
      cls: "revoked",
    })),
    ...c.liveOnly.map((r) => ({
      ...r,
      change: "Granted after the backup",
      cls: "",
    })),
  ];
  box.append(
    h(
      "p",
      {},
      `Restored ${t.backupName} at ${new Date(t.at).toLocaleString()}: ${t.counts.projects} projects, ${t.counts.members} memberships, ${t.counts.clips} clips. ${c.unchanged} memberships match today's.`,
    ),
    rows.length
      ? h(
          "table",
          {},
          h(
            "caption",
            { class: "sr" },
            "Membership differences between the restored copy and today",
          ),
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              h("th", { scope: "col" }, "Project"),
              h("th", { scope: "col" }, "Member"),
              h("th", { scope: "col" }, "Role in backup"),
              h("th", { scope: "col" }, "What it means"),
            ),
          ),
          h(
            "tbody",
            {},
            rows.map((r) =>
              h(
                "tr",
                { class: r.cls },
                h("td", {}, r.project),
                h("td", {}, r.member),
                h("td", {}, r.role),
                h("td", {}, r.change),
              ),
            ),
          ),
        )
      : h(
          "p",
          { class: "hint" },
          "No differences: every restored membership matches today's approvals.",
        ),
    h(
      "p",
      { class: "hint" },
      "If you ever restored this copy for real, VERA's recovery steps keep remote access off until these differences are reapplied. This test copy is never connected to testers.",
    ),
    h(
      "div",
      { class: "actions block" },
      button("restore-test-copy", {
        label: "Remove test copy",
        key: "remove",
        input: { remove: true },
      }),
    ),
  );
  return box;
}

function renderSignOff(a) {
  const record = a.record;
  const section = h(
    "section",
    { class: "card stage", "aria-labelledby": "signoff-title" },
    h("h3", { id: "signoff-title" }, "Sign off #48"),
  );
  if (record.signOff) {
    section.append(
      h(
        "p",
        {},
        h("span", { class: "pill", "data-s": "done" }, "Signed off"),
        ` by ${record.signOff.by}, ${new Date(record.signOff.at).toLocaleString()}.`,
      ),
      h("p", { class: "hint" }, record.signOff.statement),
    );
  } else {
    const nameInput = h("input", {
      type: "text",
      id: "signoff-name",
      "data-key": "signoff-name",
      autocomplete: "name",
      value: readPref("name", ""),
    });
    section.append(
      h(
        "p",
        { class: "hint" },
        a.progress.complete
          ? "Every step is recorded. Sign off to record your explicit approval, then post the comment on #48."
          : `Sign-off unlocks when all ${a.progress.total} steps are recorded.`,
      ),
      h(
        "div",
        { class: "actions" },
        h("label", { for: "signoff-name" }, "Your name "),
        nameInput,
        h(
          "button",
          {
            class: "btn primary",
            type: "button",
            "data-key": "signoff",
            disabled: !a.progress.complete,
            onclick: async () => {
              writePref("name", nameInput.value);
              if (
                await ask({
                  title: "Approve #48 live acceptance?",
                  text: "This records that you observed the full Owner, Editor and Viewer walkthrough, the restore, recovery and disconnect, and that you accept #48.",
                  yes: "Approve",
                })
              )
                acceptance("sign-off", { by: nameInput.value });
            },
          },
          "Approve #48 live acceptance",
        ),
      ),
    );
  }
  const comment = h(
    "textarea",
    { readonly: true, "aria-label": "#48 comment text", "data-key": "comment" },
    a.comment,
  );
  section.append(
    h(
      "div",
      { class: "block" },
      h("p", { class: "block-title" }, "Comment for #48"),
      comment,
    ),
    h(
      "div",
      { class: "actions block" },
      h(
        "button",
        {
          class: "btn",
          type: "button",
          "data-key": "copy-comment",
          onclick: () => copy(a.comment, "Comment copied. Paste it on #48."),
        },
        "Copy comment",
      ),
      h(
        "a",
        {
          class: "btn quiet",
          href: ISSUE_48,
          target: "_blank",
          rel: "noreferrer noopener",
        },
        "Open #48 on GitHub ↗",
      ),
      h(
        "button",
        {
          class: "btn quiet",
          type: "button",
          "data-key": "restart",
          onclick: async () => {
            if (
              await ask({
                title: "Start a new walkthrough?",
                text: "The current record is archived on this Mac and a fresh checklist starts.",
                yes: "Start new",
              })
            )
              acceptance("restart");
          },
        },
        "Start a new walkthrough",
      ),
    ),
  );
  return section;
}

// ---------------------------------------------------------------- activity

function renderActivity() {
  const items = data.history;
  return h(
    "section",
    { class: "card" },
    h("h2", {}, "Activity"),
    h(
      "p",
      { class: "hint" },
      "What Producer Controls did since it opened. Technical details have secrets removed.",
    ),
    items.length
      ? h(
          "table",
          {},
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              h("th", { scope: "col" }, "When"),
              h("th", { scope: "col" }, "Action"),
              h("th", { scope: "col" }, "Result"),
            ),
          ),
          h(
            "tbody",
            {},
            items.map((op) =>
              h(
                "tr",
                {},
                h("td", {}, new Date(op.startedAt).toLocaleTimeString()),
                h("td", {}, op.label),
                h(
                  "td",
                  {},
                  h(
                    "span",
                    { class: "pill", "data-s": op.state },
                    op.state === "succeeded" ? "Done" : "Didn't work",
                  ),
                  " ",
                  op.message ?? "",
                ),
              ),
            ),
          ),
        )
      : h("p", {}, "Nothing yet."),
  );
}

window.addEventListener("focus", refresh);
refresh();
