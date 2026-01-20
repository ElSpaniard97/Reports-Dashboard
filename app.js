/* Inventory Reports Dashboard (Static)
   - Upload CSV
   - Dynamic filters:
       * Collapsible filters (all filters)
       * Multi-select checkboxes (facet) for low-cardinality columns
       * Text "contains" input for high-cardinality columns
   - Forced multi-select:
       * "Model" is always multi-select, even if hundreds+ unique values
   - Auto-collapse after selecting options (multi-select)
   - Auto-collapse after finishing text input (Enter or blur)
   - Search within filter options
   - Option counts shown in multi-select lists
   - Save/Load/Rename/Delete presets (localStorage)
   - Sort by column
   - Export filtered CSV
*/

const PRESETS_KEY = "inventoryDashboardPresets_v4"; // bumped (forced multi columns logic)

// Columns that should ALWAYS be multi-select options (even if many unique values)
const FORCE_MULTI_COLUMNS = new Set(["model"]);

let rawRows = [];
let filteredRows = [];
let columns = [];

// filter state
// columns: { colName: { type: "text"|"multi", value: ""|string[], collapsed?: boolean } }
let filterState = {
  global: "",
  columns: {}
};

let sortState = { col: null, dir: "asc" };

const el = (id) => document.getElementById(id);

// UI elements
const csvFile = el("csvFile");
const fileName = el("fileName");
const rowCount = el("rowCount");
const filteredCount = el("filteredCount");
const statusMsg = el("statusMsg");

const globalSearch = el("globalSearch");
const filtersContainer = el("filtersContainer");

const btnClear = el("btnClear");
const btnExport = el("btnExport");

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

function uniqueValuesForColumn(col) {
  const set = new Set();
  for (const r of rawRows) set.add(normalizeValue(r[col]));
  return Array.from(set).filter(v => v !== "");
}

function isLowCardinality(col) {
  const uniq = uniqueValuesForColumn(col);
  return uniq.length > 0 && uniq.length <= 30;
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
}

function escapeCsvValue(v) {
  const s = normalizeValue(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function isActiveFilter(f) {
  if (!f) return false;
  if (f.type === "text") return !!normalizeValue(f.value);
  if (f.type === "multi") return Array.isArray(f.value) && f.value.length > 0;
  return false;
}

function autoCollapseIfActive(col) {
  const f = filterState.columns[col];
  if (!f) return;
  if (isActiveFilter(f)) f.collapsed = true;
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
  return {
    global: filterState.global,
    columns: filterState.columns,
    sort: sortState
  };
}

function applyPresetPayload(payload) {
  filterState.global = payload?.global ?? "";
  filterState.columns = payload?.columns ?? {};
  sortState = payload?.sort ?? { col: null, dir: "asc" };

  globalSearch.value = filterState.global;

  buildFiltersUI();
  buildTableHeader();
  applyFiltersAndRender();
}

// ---------- Build UI ----------
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
      if (sortState.col === col) {
        sortState.dir = (sortState.dir === "asc") ? "desc" : "asc";
      } else {
        sortState.col = col;
        sortState.dir = "asc";
      }
      applyFiltersAndRender();
      buildTableHeader();
    });

    tr.appendChild(th);
  }

  tableHead.appendChild(tr);
}

function ensureFilterStateForColumns() {
  for (const col of columns) {
    if (!filterState.columns[col]) {
      const type = (isForcedMulti(col) || isLowCardinality(col)) ? "multi" : "text";
      filterState.columns[col] = {
        type,
        value: type === "multi" ? [] : "",
        collapsed: false
      };
    } else {
      const f = filterState.columns[col];

      // Force "Model" to be multi even if older presets stored it as text
      const mustBeMulti = isForcedMulti(col);
      if (mustBeMulti && f.type !== "multi") {
        f.type = "multi";
        f.value = [];
      }

      // schema guard
      if (f.type === "multi" && !Array.isArray(f.value)) f.value = [];
      if (f.type === "text" && Array.isArray(f.value)) f.value = "";

      if (typeof f.collapsed !== "boolean") {
        f.collapsed = false;
      }
    }
  }
}

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
    pill.textContent = normalizeValue(f.value) ? "Active" : "Contains";
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
  filtersContainer.innerHTML = "";
  ensureFilterStateForColumns();

  for (const col of columns) {
    const f = filterState.columns[col];

    const wrap = document.createElement("div");
    wrap.className = "filter";
    wrap.classList.toggle("collapsed", !!f.collapsed);

    const header = buildFilterHeader(col, f, wrap);
    wrap.appendChild(header);

    const body = document.createElement("div");
    body.className = "filter-body";

    // TEXT FILTER
    if (f.type === "text") {
      const row = document.createElement("div");
      row.className = "row";

      const inp = document.createElement("input");
      inp.className = "input";
      inp.type = "text";
      inp.placeholder = "Contains…";
      inp.value = f.value || "";

      inp.addEventListener("input", () => {
        filterState.columns[col].value = inp.value;
        applyFiltersAndRender();
        buildFiltersUI();
      });

      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          autoCollapseIfActive(col);
          buildFiltersUI();
        }
      });

      inp.addEventListener("blur", () => {
        autoCollapseIfActive(col);
        buildFiltersUI();
      });

      row.appendChild(inp);

      const clearBtn = document.createElement("button");
      clearBtn.className = "small-btn";
      clearBtn.textContent = "Clear";
      clearBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        filterState.columns[col].value = "";
        filterState.columns[col].collapsed = false;
        buildFiltersUI();
        applyFiltersAndRender();
      });

      row.appendChild(clearBtn);

      body.appendChild(row);
      wrap.appendChild(body);
      filtersContainer.appendChild(wrap);
      continue;
    }

    // MULTI-SELECT FACET FILTER
    const uniq = uniqueValuesForColumn(col).sort((a,b)=>a.localeCompare(b));
    const selected = new Set(Array.isArray(f.value) ? f.value : []);

    const counts = new Map();
    for (const r of rawRows) {
      const v = normalizeValue(r[col]);
      if (!v) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }

    const search = document.createElement("input");
    search.className = "input";
    search.type = "text";
    search.placeholder = "Search options…";

    const actionsRow = document.createElement("div");
    actionsRow.className = "facet-actions";

    const btnAll = document.createElement("button");
    btnAll.className = "small-btn";
    btnAll.textContent = "Select All";
    btnAll.addEventListener("click", (ev) => {
      ev.stopPropagation();
      filterState.columns[col].value = [...uniq];
      autoCollapseIfActive(col);
      buildFiltersUI();
      applyFiltersAndRender();
    });

    const btnNone = document.createElement("button");
    btnNone.className = "small-btn";
    btnNone.textContent = "Clear";
    btnNone.addEventListener("click", (ev) => {
      ev.stopPropagation();
      filterState.columns[col].value = [];
      filterState.columns[col].collapsed = false;
      buildFiltersUI();
      applyFiltersAndRender();
    });

    actionsRow.appendChild(btnAll);
    actionsRow.appendChild(btnNone);

    const list = document.createElement("div");
    list.className = "facet-list";

    function renderOptionList(filterText = "") {
      const ft = toLower(filterText);
      list.innerHTML = "";

      const visible = uniq.filter(v => !ft || toLower(v).includes(ft));

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

          filterState.columns[col].value = Array.from(selected);
          autoCollapseIfActive(col);

          applyFiltersAndRender();
          buildFiltersUI();
        });

        const textWrap = document.createElement("div");
        textWrap.className = "facet-text";

        const valueSpan = document.createElement("div");
        valueSpan.className = "facet-value";
        valueSpan.textContent = v;

        const countSpan = document.createElement("div");
        countSpan.className = "facet-count";
        countSpan.textContent = String(counts.get(v) || 0);

        textWrap.appendChild(valueSpan);
        textWrap.appendChild(countSpan);

        line.appendChild(cb);
        line.appendChild(textWrap);
        list.appendChild(line);
      }
    }

    search.addEventListener("click", (ev) => ev.stopPropagation());
    search.addEventListener("input", () => renderOptionList(search.value));

    renderOptionList("");

    body.appendChild(search);
    body.appendChild(actionsRow);
    body.appendChild(list);

    wrap.appendChild(body);
    filtersContainer.appendChild(wrap);
  }
}

// ---------- Filtering / Sorting ----------
function rowMatchesFilters(row) {
  const g = toLower(filterState.global);
  if (g) {
    let found = false;
    for (const col of columns) {
      if (toLower(row[col]).includes(g)) { found = true; break; }
    }
    if (!found) return false;
  }

  for (const col of columns) {
    const f = filterState.columns[col];
    if (!f) continue;

    const val = normalizeValue(row[col]);

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

function sortRows(rows) {
  if (!sortState.col) return rows;
  const col = sortState.col;
  const dir = sortState.dir;

  const sorted = [...rows].sort((a,b) => {
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

  return sorted;
}

function applyFiltersAndRender() {
  if (!rawRows.length) return;

  const matched = rawRows.filter(rowMatchesFilters);
  filteredRows = sortRows(matched);

  filteredCount.textContent = String(filteredRows.length);
  rowCount.textContent = String(rawRows.length);

  renderTableBody(filteredRows);
}

function renderTableBody(rows) {
  tableBody.innerHTML = "";

  const RENDER_LIMIT = 2000;
  const displayRows = rows.slice(0, RENDER_LIMIT);

  for (const r of displayRows) {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      td.textContent = normalizeValue(r[col]);
      tr.appendChild(td);
    }
    tableBody.appendChild(tr);
  }

  if (rows.length > RENDER_LIMIT) {
    setStatus(`Showing first ${RENDER_LIMIT} of ${rows.length} filtered rows (export includes all).`, "muted");
  } else {
    setStatus("Loaded. Use filters on the left to narrow results.", "muted");
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

      if (!columns.length && data.length) {
        columns = Object.keys(data[0]);
      }

      rawRows = data.map((r) => {
        const obj = {};
        for (const c of columns) obj[c] = (c in r) ? r[c] : "";
        return obj;
      });

      filterState = { global: "", columns: {} };
      sortState = { col: null, dir: "asc" };

      enableControls(true);

      globalSearch.value = "";
      buildFiltersUI();
      buildTableHeader();
      applyFiltersAndRender();
      refreshPresetSelect();

      setStatus("CSV loaded successfully.", "muted");
    },
    error: () => {
      setStatus("Failed to parse CSV. Confirm it is a valid .csv file with headers.", "danger");
    }
  });
});

globalSearch.addEventListener("input", () => {
  filterState.global = globalSearch.value;
  applyFiltersAndRender();
});

btnClear.addEventListener("click", () => {
  filterState.global = "";
  globalSearch.value = "";

  for (const c of columns) {
    const f = filterState.columns[c];
    if (!f) continue;

    if (f.type === "text") f.value = "";
    if (f.type === "multi") f.value = [];

    f.collapsed = false;
  }

  sortState = { col: null, dir: "asc" };
  buildTableHeader();
  buildFiltersUI();
  applyFiltersAndRender();
});

btnExport.addEventListener("click", exportFilteredCsv);

// ---------- Preset handlers ----------
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
