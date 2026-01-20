/* Inventory Reports Dashboard (Static)
   Changes requested:
   - Filter dropdown bodies hidden until clicked (collapsed by default)
   - Dropdowns stay open until manually closed (no auto-close)
   - Add Apply button:
       * Filter edits do NOT update results until Apply clicked
       * Apply closes all filter dropdowns
*/

const PRESETS_KEY = "inventoryDashboardPresets_v7";

// Columns that should ALWAYS be multi-select options (even if many unique values)
const FORCE_MULTI_COLUMNS = new Set(["model"]);

let rawRows = [];
let filteredRows = [];
let columns = [];

// Applied state drives table/dashboard + facet counts
let appliedState = {
  global: "",
  columns: {} // { col: { type:"text"|"multi", value:""|string[], collapsed:boolean } }
};

// Draft state drives UI edits
let draftState = {
  global: "",
  columns: {}
};

let sortState = { col: null, dir: "asc" };

const el = (id) => document.getElementById(id);

// UI
const csvFile = el("csvFile");
const fileName = el("fileName");
const rowCount = el("rowCount");
const filteredCount = el("filteredCount");
const statusMsg = el("statusMsg");

const globalSearch = el("globalSearch");
const filtersContainer = el("filtersContainer");

const btnClear = el("btnClear");
const btnExport = el("btnExport");
const btnApply = el("btnApply");

// dashboard
const kpiRow = el("kpiRow");
const breakdownGrid = el("breakdownGrid");

// presets
const presetName = el("presetName");
const presetSelect = el("presetSelect");
const btnSavePreset = el("btnSavePreset");
const btnLoadPreset = el("btnLoadPreset");
const btnRenamePreset = el("btnRenamePreset");
const btnDeletePreset = el("btnDeletePreset");

// table
const tableHead = el("tableHead");
const tableBody = el("tableBody");

// ---------- Helpers ----------
function setStatus(text, tone = "muted") {
  statusMsg.className = `status ${tone}`;
  statusMsg.textContent = text;
}

function normalizeValue(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function toLower(v) {
  return normalizeValue(v).toLowerCase();
}

function isForcedMulti(col) {
  return FORCE_MULTI_COLUMNS.has(normalizeValue(col).toLowerCase());
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function enableControls(enabled) {
  globalSearch.disabled = !enabled;
  presetName.disabled = !enabled;
  presetSelect.disabled = !enabled;
  btnSavePreset.disabled = !enabled;
  btnLoadPreset.disabled = !enabled;
  btnClear.disabled = !enabled;
  btnExport.disabled = !enabled;
  btnRenamePreset.disabled = !enabled;
  btnDeletePreset.disabled = !enabled;
  btnApply.disabled = !enabled;
}

function escapeCsvValue(v) {
  const s = normalizeValue(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function isDirty() {
  // Compare applied vs draft (global + columns values/types). Ignore collapsed differences.
  const a = deepClone(appliedState);
  const d = deepClone(draftState);
  for (const c of Object.keys(a.columns || {})) delete a.columns[c].collapsed;
  for (const c of Object.keys(d.columns || {})) delete d.columns[c].collapsed;
  return JSON.stringify(a) !== JSON.stringify(d);
}

function updateApplyButtonState() {
  if (!rawRows.length) {
    btnApply.disabled = true;
    return;
  }
  btnApply.disabled = !isDirty();
  if (isDirty()) setStatus("Pending changes. Click Apply to refresh results.", "muted");
}

// ---------- Matching logic uses APPLIED state ----------
function rowMatchesApplied(row, excludeCol = null) {
  const g = toLower(appliedState.global);
  if (g) {
    let found = false;
    for (const c of columns) {
      if (toLower(row[c]).includes(g)) { found = true; break; }
    }
    if (!found) return false;
  }

  for (const c of columns) {
    if (excludeCol && c === excludeCol) continue;

    const f = appliedState.columns[c];
    if (!f) continue;

    const val = normalizeValue(row[c]);

    if (f.type === "text") {
      const q = normalizeValue(f.value);
      if (!q) continue;
      if (!toLower(val).includes(toLower(q))) return false;
      continue;
    }

    if (f.type === "multi") {
      const selected = Array.isArray(f.value) ? f.value : [];
      if (!selected.length) continue;
      if (!selected.includes(val)) return false;
      continue;
    }
  }

  return true;
}

// Facet counts are based on APPLIED filters (stable until Apply)
function getFacetCountsForColumn(col) {
  const counts = new Map();
  for (const r of rawRows) {
    if (!rowMatchesApplied(r, col)) continue;
    const v = normalizeValue(r[col]);
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return counts;
}

function isLowCardinalityByCounts(counts) {
  const uniq = counts.size;
  return uniq > 0 && uniq <= 30;
}

function ensureStateSchemas() {
  for (const col of columns) {
    // applied
    if (!appliedState.columns[col]) {
      const facetCounts = getFacetCountsForColumn(col);
      const type = (isForcedMulti(col) || isLowCardinalityByCounts(facetCounts)) ? "multi" : "text";
      appliedState.columns[col] = { type, value: type === "multi" ? [] : "", collapsed: true };
    } else {
      const f = appliedState.columns[col];
      if (isForcedMulti(col) && f.type !== "multi") { f.type = "multi"; f.value = []; }
      if (f.type === "multi" && !Array.isArray(f.value)) f.value = [];
      if (f.type === "text" && Array.isArray(f.value)) f.value = "";
      if (typeof f.collapsed !== "boolean") f.collapsed = true;
    }

    // draft
    if (!draftState.columns[col]) {
      // Mirror applied at creation time
      draftState.columns[col] = deepClone(appliedState.columns[col]);
      // Start collapsed by default
      draftState.columns[col].collapsed = true;
    } else {
      const f = draftState.columns[col];
      if (isForcedMulti(col) && f.type !== "multi") { f.type = "multi"; f.value = []; }
      if (f.type === "multi" && !Array.isArray(f.value)) f.value = [];
      if (f.type === "text" && Array.isArray(f.value)) f.value = "";
      if (typeof f.collapsed !== "boolean") f.collapsed = true;
    }
  }
}

// ---------- Dashboard ----------
function getUniqueCount(rows, colName) {
  if (!colName) return 0;
  const set = new Set();
  for (const r of rows) {
    const v = normalizeValue(r[colName]);
    if (v) set.add(v);
  }
  return set.size;
}

function countBy(rows, colName) {
  const m = new Map();
  if (!colName) return m;
  for (const r of rows) {
    const v = normalizeValue(r[colName]) || "(Blank)";
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

function topN(map, n=6) {
  return Array.from(map.entries())
    .sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
}

function findColumnName(candidates) {
  const lower = new Map(columns.map(c => [c.toLowerCase(), c]));
  for (const cand of candidates) {
    const key = cand.toLowerCase();
    if (lower.has(key)) return lower.get(key);
  }
  return null;
}

function renderDashboard() {
  const rows = filteredRows || [];

  const colAsset = findColumnName(["Asset Tag","AssetTag","Asset"]);
  const colSerial = findColumnName(["Serial Number","Serial","SerialNumber"]);
  const colModel  = findColumnName(["Model","Device Model","Model Name"]);
  const colCategory = findColumnName(["Category","Device Type","Type"]);
  const colCondition = findColumnName(["Condition","Grade"]);
  const colLocation = findColumnName(["Location","Site"]);
  const colCompany = findColumnName(["Company","Customer","Client"]);
  const colLoggedBy = findColumnName(["Logged By","LoggedBy","Checked In By","Technician"]);
  const colAssignedTo = findColumnName(["Employee Assign To","Assigned To","Assignee","Employee"]);

  const kpis = [
    { label: "Total Matching Rows", value: rows.length, sub: "Based on applied filters" },
    { label: "Unique Asset Tags", value: getUniqueCount(rows, colAsset), sub: colAsset ? colAsset : "Column not found" },
    { label: "Unique Serials", value: getUniqueCount(rows, colSerial), sub: colSerial ? colSerial : "Column not found" },
    { label: "Unique Models", value: getUniqueCount(rows, colModel), sub: colModel ? colModel : "Column not found" },
  ];

  kpiRow.innerHTML = "";
  for (const k of kpis) {
    const card = document.createElement("div");
    card.className = "kpi";

    const l = document.createElement("div");
    l.className = "label";
    l.textContent = k.label;

    const v = document.createElement("div");
    v.className = "value";
    v.textContent = String(k.value);

    const s = document.createElement("div");
    s.className = "sub";
    s.textContent = k.sub;

    card.appendChild(l);
    card.appendChild(v);
    card.appendChild(s);
    kpiRow.appendChild(card);
  }

  const breakdowns = [
    { title: "Category", col: colCategory },
    { title: "Condition", col: colCondition },
    { title: "Location", col: colLocation },
    { title: "Company", col: colCompany },
    { title: "Logged By", col: colLoggedBy },
    { title: "Employee Assign To", col: colAssignedTo },
  ];

  breakdownGrid.innerHTML = "";
  for (const b of breakdowns) {
    const card = document.createElement("div");
    card.className = "bd";

    const t = document.createElement("div");
    t.className = "title";
    t.textContent = b.col ? `${b.title} (Top)` : `${b.title} (Column not found)`;

    const list = document.createElement("div");
    list.className = "list";

    if (!b.col) {
      const item = document.createElement("div");
      item.className = "muted";
      item.style.fontSize = "12px";
      item.textContent = "No matching column in this CSV.";
      list.appendChild(item);
    } else if (!rows.length) {
      const item = document.createElement("div");
      item.className = "muted";
      item.style.fontSize = "12px";
      item.textContent = "No rows match current filters.";
      list.appendChild(item);
    } else {
      const counts = countBy(rows, b.col);
      const top = topN(counts, 6);
      for (const [name, count] of top) {
        const it = document.createElement("div");
        it.className = "item";

        const nm = document.createElement("div");
        nm.className = "name";
        nm.title = name;
        nm.textContent = name;

        const ct = document.createElement("div");
        ct.className = "count";
        ct.textContent = String(count);

        it.appendChild(nm);
        it.appendChild(ct);
        list.appendChild(it);
      }
    }

    card.appendChild(t);
    card.appendChild(list);
    breakdownGrid.appendChild(card);
  }
}

// ---------- Sorting ----------
function sortRows(rows) {
  if (!sortState.col) return rows;

  const col = sortState.col;
  const dir = sortState.dir;

  return [...rows].sort((a,b) => {
    const av = normalizeValue(a[col]);
    const bv = normalizeValue(b[col]);

    const an = Number(av);
    const bn = Number(bv);
    const aNum = Number.isFinite(an) && av !== "";
    const bNum = Number.isFinite(bn) && bv !== "";

    let cmp;
    if (aNum && bNum) cmp = an - bn;
    else cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });

    return dir === "asc" ? cmp : -cmp;
  });
}

// ---------- Table ----------
function buildTableHeader() {
  tableHead.innerHTML = "";
  const tr = document.createElement("tr");

  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col;

    const sortSpan = document.createElement("span");
    sortSpan.className = "sort";
    if (sortState.col === col) sortSpan.textContent = sortState.dir === "asc" ? "▲" : "▼";
    else sortSpan.textContent = "";
    th.appendChild(sortSpan);

    th.addEventListener("click", () => {
      if (sortState.col === col) sortState.dir = (sortState.dir === "asc") ? "desc" : "asc";
      else { sortState.col = col; sortState.dir = "asc"; }

      // Sorting is applied instantly (does not change filter criteria)
      applyAppliedFiltersAndRender();
      buildTableHeader();
    });

    tr.appendChild(th);
  }

  tableHead.appendChild(tr);
}

function renderTableBody(rows) {
  tableBody.innerHTML = "";

  const RENDER_LIMIT = 2000;
  const displayRows = rows.slice(0, RENDER_LIMIT);

  for (const r of displayRows) {
    const tr = document.createElement("tr");
    for (const c of columns) {
      const td = document.createElement("td");
      td.textContent = normalizeValue(r[c]);
      tr.appendChild(td);
    }
    tableBody.appendChild(tr);
  }

  if (rows.length > RENDER_LIMIT) {
    setStatus(`Showing first ${RENDER_LIMIT} of ${rows.length} filtered rows (export includes all).`, "muted");
  } else {
    setStatus("Ready. Edit filters, then click Apply.", "muted");
  }
}

// ---------- Apply (APPLIED state drives results) ----------
function applyAppliedFiltersAndRender() {
  if (!rawRows.length) return;

  const matched = rawRows.filter(r => rowMatchesApplied(r, null));
  filteredRows = sortRows(matched);

  rowCount.textContent = String(rawRows.length);
  filteredCount.textContent = String(filteredRows.length);

  renderDashboard();
  renderTableBody(filteredRows);

  // Rebuild filter option lists using applied facet counts (stable until next Apply)
  buildFiltersUI();
  updateApplyButtonState();
}

// ---------- Filters UI (DRAFT state is editable; dropdowns are manual) ----------
function buildFilterHeader(col, f, wrap) {
  const header = document.createElement("div");
  header.className = "filter-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "filter-title";

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = col;

  titleWrap.appendChild(name);

  const right = document.createElement("div");
  right.className = "filter-right";

  const pill = document.createElement("div");
  pill.className = "pill";
  if (f.type === "multi") {
    const n = (Array.isArray(f.value) ? f.value : []).length;
    pill.textContent = n ? `${n} selected` : "Multi-select";
  } else {
    pill.textContent = normalizeValue(f.value) ? "Pending" : "Contains";
  }

  const chev = document.createElement("div");
  chev.className = "chev";
  chev.textContent = "▾";

  right.appendChild(pill);
  right.appendChild(chev);

  header.appendChild(titleWrap);
  header.appendChild(right);

  header.addEventListener("click", () => {
    f.collapsed = !f.collapsed;
    wrap.classList.toggle("collapsed", f.collapsed);
  });

  return header;
}

function buildFiltersUI() {
  if (!rawRows.length) return;

  // Preserve in-filter option search text
  const prevSearchText = new Map();
  for (const node of filtersContainer.querySelectorAll("input[data-filter-search='1']")) {
    const col = node.getAttribute("data-col");
    prevSearchText.set(col, node.value || "");
  }

  filtersContainer.innerHTML = "";
  ensureStateSchemas();

  for (const col of columns) {
    const fDraft = draftState.columns[col];

    // Determine type using APPLIED facet counts (stable until Apply), except forced multi
    const facetCounts = getFacetCountsForColumn(col);
    if (!isForcedMulti(col)) {
      const shouldBeMulti = isLowCardinalityByCounts(facetCounts);
      if (shouldBeMulti && fDraft.type !== "multi") { fDraft.type = "multi"; fDraft.value = []; }
      if (!shouldBeMulti && fDraft.type !== "text") { fDraft.type = "text"; fDraft.value = ""; }
    } else if (fDraft.type !== "multi") {
      fDraft.type = "multi";
      fDraft.value = [];
    }

    const wrap = document.createElement("div");
    wrap.className = "filter";
    wrap.classList.toggle("collapsed", !!fDraft.collapsed);

    wrap.appendChild(buildFilterHeader(col, fDraft, wrap));

    const body = document.createElement("div");
    body.className = "filter-body";

    // TEXT FILTER (draft only; does NOT apply immediately)
    if (fDraft.type === "text") {
      const row = document.createElement("div");
      row.className = "row";

      const inp = document.createElement("input");
      inp.className = "input";
      inp.type = "text";
      inp.placeholder = "Contains…";
      inp.value = fDraft.value || "";

      inp.addEventListener("input", () => {
        draftState.columns[col].value = inp.value;
        updateApplyButtonState();
      });

      row.appendChild(inp);

      const clearBtn = document.createElement("button");
      clearBtn.className = "small-btn";
      clearBtn.textContent = "Clear";
      clearBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        draftState.columns[col].value = "";
        updateApplyButtonState();
        buildFiltersUI();
      });

      row.appendChild(clearBtn);

      body.appendChild(row);
      wrap.appendChild(body);
      filtersContainer.appendChild(wrap);
      continue;
    }

    // MULTI-SELECT (draft selections; option list/counts from applied facetCounts)
    const selected = new Set(Array.isArray(fDraft.value) ? fDraft.value : []);

    const optionSet = new Set(facetCounts.keys());
    for (const v of selected) optionSet.add(v);

    const options = Array.from(optionSet).sort((a,b) => {
      const ca = facetCounts.get(a) || 0;
      const cb = facetCounts.get(b) || 0;
      if (cb !== ca) return cb - ca;
      return a.localeCompare(b);
    });

    const search = document.createElement("input");
    search.className = "input";
    search.type = "text";
    search.placeholder = "Search options…";
    search.setAttribute("data-filter-search", "1");
    search.setAttribute("data-col", col);
    search.value = prevSearchText.get(col) || "";

    const actionsRow = document.createElement("div");
    actionsRow.className = "facet-actions";

    const btnAll = document.createElement("button");
    btnAll.className = "small-btn";
    btnAll.textContent = "Select All (visible)";
    btnAll.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const ft = toLower(search.value);
      const visible = options.filter(v => (!ft || toLower(v).includes(ft)));
      draftState.columns[col].value = visible;
      updateApplyButtonState();
      buildFiltersUI();
    });

    const btnNone = document.createElement("button");
    btnNone.className = "small-btn";
    btnNone.textContent = "Clear";
    btnNone.addEventListener("click", (ev) => {
      ev.stopPropagation();
      draftState.columns[col].value = [];
      updateApplyButtonState();
      buildFiltersUI();
    });

    actionsRow.appendChild(btnAll);
    actionsRow.appendChild(btnNone);

    const list = document.createElement("div");
    list.className = "facet-list";

    function renderOptionList() {
      const ft = toLower(search.value);
      list.innerHTML = "";

      const visible = options.filter(v => !ft || toLower(v).includes(ft));

      if (!visible.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.style.fontSize = "12px";
        empty.textContent = "No matching options.";
        list.appendChild(empty);
        return;
      }

      for (const v of visible) {
        const line = document.createElement("label");
        line.className = "facet-item";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.has(v);
        cb.addEventListener("click", (ev) => ev.stopPropagation());

        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(v);
          else selected.delete(v);

          draftState.columns[col].value = Array.from(selected);
          updateApplyButtonState();
          // keep dropdown open until user closes it
          // do not rebuild UI on every click; only update header pill count
          buildFiltersUI();
          // re-open the same filter body (since build rebuilds DOM)
          draftState.columns[col].collapsed = false;
        });

        const textWrap = document.createElement("div");
        textWrap.className = "facet-text";

        const valueSpan = document.createElement("div");
        valueSpan.className = "facet-value";
        valueSpan.textContent = v;

        const countSpan = document.createElement("div");
        countSpan.className = "facet-count";
        countSpan.textContent = String(facetCounts.get(v) || 0);

        textWrap.appendChild(valueSpan);
        textWrap.appendChild(countSpan);

        line.appendChild(cb);
        line.appendChild(textWrap);
        list.appendChild(line);
      }
    }

    search.addEventListener("click", (ev) => ev.stopPropagation());
    search.addEventListener("input", renderOptionList);

    renderOptionList();

    body.appendChild(search);
    body.appendChild(actionsRow);
    body.appendChild(list);

    wrap.appendChild(body);
    filtersContainer.appendChild(wrap);
  }
}

// ---------- Export ----------
function exportFilteredCsv() {
  if (!filteredRows.length) return;

  const header = columns.map(escapeCsvValue).join(",");
  const lines = filteredRows.map(r => columns.map(c => escapeCsvValue(r[c])).join(","));
  const csv = [header, ...lines].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `filtered_export_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

// ---------- Presets ----------
function readPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writePresets(presets) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function refreshPresetSelect() {
  const presets = readPresets();
  presetSelect.innerHTML = `<option value="">— Select a preset —</option>`;
  for (const p of presets) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    presetSelect.appendChild(opt);
  }
}

function currentPresetPayload() {
  // Save APPLIED state (not draft), since presets represent stored result views
  return { global: appliedState.global, columns: appliedState.columns, sort: sortState };
}

function applyPresetPayload(payload) {
  appliedState.global = payload?.global ?? "";
  appliedState.columns = payload?.columns ?? {};
  sortState = payload?.sort ?? { col: null, dir: "asc" };

  // draft mirrors applied when loading preset
  draftState = deepClone(appliedState);

  // collapse all by default after load
  for (const c of Object.keys(draftState.columns || {})) draftState.columns[c].collapsed = true;

  globalSearch.value = draftState.global;

  buildFiltersUI();
  buildTableHeader();
  applyAppliedFiltersAndRender();
  updateApplyButtonState();
}

// ---------- Events ----------
csvFile.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  fileName.textContent = file.name;
  setStatus("Parsing CSV…", "muted");

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    complete: (results) => {
      const data = results.data || [];
      const fields = results.meta?.fields || [];
      columns = fields.filter(Boolean);
      if (!columns.length && data.length) columns = Object.keys(data[0]);

      rawRows = data.map((r) => {
        const obj = {};
        for (const c of columns) obj[c] = (c in r) ? r[c] : "";
        return obj;
      });

      appliedState = { global: "", columns: {} };
      draftState = { global: "", columns: {} };
      sortState = { col: null, dir: "asc" };

      enableControls(true);

      globalSearch.value = "";
      draftState.global = "";

      buildTableHeader();
      refreshPresetSelect();

      // initialize + render
      ensureStateSchemas();
      // start all collapsed
      for (const c of columns) {
        appliedState.columns[c].collapsed = true;
        draftState.columns[c].collapsed = true;
      }

      buildFiltersUI();
      applyAppliedFiltersAndRender();

      setStatus("CSV loaded. Set filters, then click Apply.", "muted");
      updateApplyButtonState();
    },
    error: () => setStatus("Failed to parse CSV. Confirm it is a valid .csv file with headers.", "danger")
  });
});

// Global search is DRAFT until Apply
globalSearch.addEventListener("input", () => {
  draftState.global = globalSearch.value;
  updateApplyButtonState();
});

btnApply.addEventListener("click", () => {
  // Commit draft to applied
  appliedState = deepClone(draftState);

  // Close all dropdowns after apply
  for (const c of Object.keys(draftState.columns || {})) {
    draftState.columns[c].collapsed = true;
    appliedState.columns[c].collapsed = true;
  }

  // Apply & render results
  applyAppliedFiltersAndRender();

  // Close all dropdowns visually
  buildFiltersUI();

  setStatus("Applied filters. Dropdowns closed.", "muted");
  updateApplyButtonState();
});

btnClear.addEventListener("click", () => {
  draftState.global = "";
  appliedState.global = "";
  globalSearch.value = "";

  for (const c of columns) {
    const a = appliedState.columns[c];
    const d = draftState.columns[c];
    if (a) {
      if (a.type === "text") a.value = "";
      if (a.type === "multi") a.value = [];
      a.collapsed = true;
    }
    if (d) {
      if (d.type === "text") d.value = "";
      if (d.type === "multi") d.value = [];
      d.collapsed = true;
    }
  }

  sortState = { col: null, dir: "asc" };
  buildTableHeader();
  buildFiltersUI();
  applyAppliedFiltersAndRender();
  updateApplyButtonState();
});

btnExport.addEventListener("click", exportFilteredCsv);

// Presets
btnSavePreset.addEventListener("click", () => {
  const name = normalizeValue(presetName.value);
  if (!name) {
    setStatus("Enter a preset name before saving.", "danger");
    return;
  }

  const presets = readPresets();
  const id = crypto?.randomUUID ? crypto.randomUUID() : String(Date.now());

  presets.unshift({
    id,
    name,
    payload: currentPresetPayload(),
    createdAt: new Date().toISOString()
  });

  writePresets(presets);
  refreshPresetSelect();
  presetName.value = "";
  setStatus(`Saved preset: ${name}`, "muted");
});

btnLoadPreset.addEventListener("click", () => {
  const id = presetSelect.value;
  if (!id) return;

  const presets = readPresets();
  const p = presets.find(x => x.id === id);
  if (!p) {
    setStatus("Preset not found.", "danger");
    return;
  }

  applyPresetPayload(p.payload);
  setStatus(`Loaded preset: ${p.name}`, "muted");
});

btnRenamePreset.addEventListener("click", () => {
  const id = presetSelect.value;
  if (!id) {
    setStatus("Select a preset to rename.", "danger");
    return;
  }

  const newName = prompt("New preset name:");
  if (!newName) return;

  const presets = readPresets();
  const p = presets.find(x => x.id === id);
  if (!p) return;

  p.name = newName.trim();
  writePresets(presets);
  refreshPresetSelect();
  presetSelect.value = id;
  setStatus(`Renamed preset to: ${p.name}`, "muted");
});

btnDeletePreset.addEventListener("click", () => {
  const id = presetSelect.value;
  if (!id) {
    setStatus("Select a preset to delete.", "danger");
    return;
  }

  const presets = readPresets();
  const p = presets.find(x => x.id === id);
  const ok = confirm(`Delete preset "${p?.name || "selected"}"?`);
  if (!ok) return;

  const next = presets.filter(x => x.id !== id);
  writePresets(next);
  refreshPresetSelect();
  presetSelect.value = "";
  setStatus("Preset deleted.", "muted");
});

// initial
refreshPresetSelect();
enableControls(false);
