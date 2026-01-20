/* Inventory Reports Dashboard (Static)
   - Upload CSV
   - Dynamic filters (dropdown for low-cardinality columns; text otherwise)
   - Save/Load/Rename/Delete presets (localStorage)
   - Sort by column
   - Export filtered CSV
*/

const PRESETS_KEY = "inventoryDashboardPresets_v1";

let rawRows = [];        // original data: array of objects
let filteredRows = [];   // filtered/sorted rows
let columns = [];        // column headers

// filter state
let filterState = {
  global: "",
  columns: {} // { colName: { type: "text"|"select", value: "" } }
};

// sort state
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

function uniqueValuesForColumn(col) {
  const set = new Set();
  for (const r of rawRows) set.add(normalizeValue(r[col]));
  return Array.from(set).filter(v => v !== "");
}

function isLowCardinality(col) {
  // heuristic: <= 30 unique values AND not too many rows
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

  // update UI elements
  globalSearch.value = filterState.global;

  // rebuild filters UI to reflect preset
  buildFiltersUI();
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
      buildTableHeader(); // refresh sort indicators
    });

    tr.appendChild(th);
  }

  tableHead.appendChild(tr);
}

function buildFiltersUI() {
  filtersContainer.innerHTML = "";

  // Ensure filterState has keys for every column
  for (const col of columns) {
    if (!filterState.columns[col]) {
      const type = isLowCardinality(col) ? "select" : "text";
      filterState.columns[col] = { type, value: "" };
    }
  }

  for (const col of columns) {
    const f = filterState.columns[col];

    const wrap = document.createElement("div");
    wrap.className = "filter";

    const label = document.createElement("div");
    label.className = "label";

    const left = document.createElement("div");
    left.textContent = col;

    const pill = document.createElement("div");
    pill.className = "pill";
    pill.textContent = (f.type === "select") ? "Dropdown" : "Contains";

    label.appendChild(left);
    label.appendChild(pill);
    wrap.appendChild(label);

    const row = document.createElement("div");
    row.className = "row";

    if (f.type === "select") {
      const sel = document.createElement("select");
      sel.className = "select";
      const optAll = document.createElement("option");
      optAll.value = "";
      optAll.textContent = "— Any —";
      sel.appendChild(optAll);

      const uniq = uniqueValuesForColumn(col).sort((a,b)=>a.localeCompare(b));
      for (const v of uniq) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      }
      sel.value = f.value || "";
      sel.addEventListener("change", () => {
        filterState.columns[col].value = sel.value;
        applyFiltersAndRender();
      });

      row.appendChild(sel);
    } else {
      const inp = document.createElement("input");
      inp.className = "input";
      inp.type = "text";
      inp.placeholder = `Contains…`;
      inp.value = f.value || "";
      inp.addEventListener("input", () => {
        filterState.columns[col].value = inp.value;
        applyFiltersAndRender();
      });

      row.appendChild(inp);
    }

    const clearBtn = document.createElement("button");
    clearBtn.className = "small-btn";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      filterState.columns[col].value = "";
      buildFiltersUI();
      applyFiltersAndRender();
    });
    row.appendChild(clearBtn);

    wrap.appendChild(row);
    filtersContainer.appendChild(wrap);
  }
}

// ---------- Filtering / Sorting ----------
function rowMatchesFilters(row) {
  // global
  const g = toLower(filterState.global);
  if (g) {
    let found = false;
    for (const col of columns) {
      if (toLower(row[col]).includes(g)) { found = true; break; }
    }
    if (!found) return false;
  }

  // per-column
  for (const col of columns) {
    const f = filterState.columns[col];
    const val = normalizeValue(row[col]);

    if (!f || !f.value) continue;

    if (f.type === "select") {
      if (val !== f.value) return false;
    } else {
      if (!toLower(val).includes(toLower(f.value))) return false;
    }
  }

  return true;
}

function sortRows(rows) {
  if (!sortState.col) return rows;
  const col = sortState.col;
  const dir = sortState.dir;

  // Attempt numeric compare when both parse as finite numbers
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

  // render cap to protect browser if huge; still exports all
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
    setStatus(`Loaded. Use filters on the left to narrow results.`, "muted");
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

      // Clean rows: ensure all keys exist
      const fields = results.meta?.fields || [];
      columns = fields.filter(Boolean);

      // If no headers detected, fallback
      if (!columns.length && data.length) {
        columns = Object.keys(data[0]);
      }

      rawRows = data.map((r) => {
        const obj = {};
        for (const c of columns) obj[c] = (c in r) ? r[c] : "";
        return obj;
      });

      // reset state
      filterState = { global: "", columns: {} };
      sortState = { col: null, dir: "asc" };

      // enable UI
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
    if (filterState.columns[c]) filterState.columns[c].value = "";
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

