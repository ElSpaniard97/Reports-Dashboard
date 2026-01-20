/* Inventory Reports Dashboard (Static, Multi-section)
   - Three independent report sections (Stock / Hardware Consumption / Accessories Consumption)
   - Each section mirrors full functionality:
       Upload CSV, Filters (multi-select), Apply workflow, Presets, Export, Dashboard summary, Sortable table
   - Light/Dark theme toggle (persisted)
*/

const FORCE_MULTI_COLUMNS = new Set(["model"]);

// ---------- Theme ----------
const THEME_KEY = "inventoryDashboardTheme_v1";
function getStoredTheme() {
  const t = localStorage.getItem(THEME_KEY);
  return (t === "light" || t === "dark") ? t : "dark";
}
function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = `Theme: ${theme === "light" ? "Light" : "Dark"}`;
  localStorage.setItem(THEME_KEY, theme);
}
function toggleTheme() {
  const next = getStoredTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
}

// ---------- Tabs ----------
function setActiveReport(reportId) {
  // tabs
  for (const t of document.querySelectorAll(".tab")) {
    t.classList.toggle("is-active", t.getAttribute("data-tab") === reportId);
  }
  // sections
  for (const s of document.querySelectorAll(".report")) {
    s.classList.toggle("is-active", s.getAttribute("data-report") === reportId);
  }
}

// ---------- Utilities ----------
function normalizeValue(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
function toLower(v) {
  return normalizeValue(v).toLowerCase();
}
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
function escapeCsvValue(v) {
  const s = normalizeValue(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}
function isForcedMulti(col) {
  return FORCE_MULTI_COLUMNS.has(normalizeValue(col).toLowerCase());
}

// ---------- Report Dashboard Class ----------
class ReportDashboard {
  constructor(root, reportId) {
    this.root = root;
    this.reportId = reportId;

    // localStorage keys (separate per report)
    this.PRESETS_KEY = `inventoryDashboardPresets_v7_${reportId}`;

    // data
    this.rawRows = [];
    this.filteredRows = [];
    this.columns = [];
    this.sortState = { col: null, dir: "asc" };

    // applied vs draft
    this.appliedState = { global: "", columns: {} };
    this.draftState = { global: "", columns: {} };

    // elements
    this.csvFile = this.q("csvFile");
    this.fileName = this.q("fileName");
    this.rowCount = this.q("rowCount");
    this.filteredCount = this.q("filteredCount");
    this.statusMsg = this.q("statusMsg");

    this.globalSearch = this.q("globalSearch");
    this.filtersContainer = this.q("filtersContainer");

    this.btnClear = this.q("btnClear");
    this.btnExport = this.q("btnExport");
    this.btnApply = this.q("btnApply");

    this.kpiRow = this.q("kpiRow");
    this.breakdownGrid = this.q("breakdownGrid");

    this.presetName = this.q("presetName");
    this.presetSelect = this.q("presetSelect");
    this.btnSavePreset = this.q("btnSavePreset");
    this.btnLoadPreset = this.q("btnLoadPreset");
    this.btnRenamePreset = this.q("btnRenamePreset");
    this.btnDeletePreset = this.q("btnDeletePreset");

    this.tableHead = this.q("tableHead");
    this.tableBody = this.q("tableBody");

    this.bindEvents();
    this.refreshPresetSelect();
    this.enableControls(false);
  }

  q(role) {
    return this.root.querySelector(`[data-role="${role}"]`);
  }

  setStatus(text, tone = "muted") {
    this.statusMsg.className = `status ${tone}`;
    this.statusMsg.textContent = text;
  }

  enableControls(enabled) {
    this.globalSearch.disabled = !enabled;
    this.presetName.disabled = !enabled;
    this.presetSelect.disabled = !enabled;
    this.btnSavePreset.disabled = !enabled;
    this.btnLoadPreset.disabled = !enabled;
    this.btnClear.disabled = !enabled;
    this.btnExport.disabled = !enabled;
    this.btnRenamePreset.disabled = !enabled;
    this.btnDeletePreset.disabled = !enabled;
    this.btnApply.disabled = !enabled;
  }

  isDirty() {
    // Compare applied vs draft (ignore collapsed differences)
    const a = deepClone(this.appliedState);
    const d = deepClone(this.draftState);
    for (const c of Object.keys(a.columns || {})) delete a.columns[c].collapsed;
    for (const c of Object.keys(d.columns || {})) delete d.columns[c].collapsed;
    return JSON.stringify(a) !== JSON.stringify(d);
  }

  updateApplyButtonState() {
    if (!this.rawRows.length) {
      this.btnApply.disabled = true;
      return;
    }
    this.btnApply.disabled = !this.isDirty();
    if (this.isDirty()) this.setStatus("Pending changes. Click Apply to refresh results.", "muted");
  }

  // ---------- Matching logic uses APPLIED state ----------
  rowMatchesApplied(row, excludeCol = null) {
    const g = toLower(this.appliedState.global);
    if (g) {
      let found = false;
      for (const c of this.columns) {
        if (toLower(row[c]).includes(g)) { found = true; break; }
      }
      if (!found) return false;
    }

    for (const c of this.columns) {
      if (excludeCol && c === excludeCol) continue;

      const f = this.appliedState.columns[c];
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
  getFacetCountsForColumn(col) {
    const counts = new Map();
    for (const r of this.rawRows) {
      if (!this.rowMatchesApplied(r, col)) continue;
      const v = normalizeValue(r[col]);
      if (!v) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return counts;
  }

  isLowCardinalityByCounts(counts) {
    const uniq = counts.size;
    return uniq > 0 && uniq <= 30;
  }

  ensureStateSchemas() {
    for (const col of this.columns) {
      // applied
      if (!this.appliedState.columns[col]) {
        const facetCounts = this.getFacetCountsForColumn(col);
        const type = (isForcedMulti(col) || this.isLowCardinalityByCounts(facetCounts)) ? "multi" : "text";
        this.appliedState.columns[col] = { type, value: type === "multi" ? [] : "", collapsed: true };
      } else {
        const f = this.appliedState.columns[col];
        if (isForcedMulti(col) && f.type !== "multi") { f.type = "multi"; f.value = []; }
        if (f.type === "multi" && !Array.isArray(f.value)) f.value = [];
        if (f.type === "text" && Array.isArray(f.value)) f.value = "";
        if (typeof f.collapsed !== "boolean") f.collapsed = true;
      }

      // draft
      if (!this.draftState.columns[col]) {
        this.draftState.columns[col] = deepClone(this.appliedState.columns[col]);
        this.draftState.columns[col].collapsed = true;
      } else {
        const f = this.draftState.columns[col];
        if (isForcedMulti(col) && f.type !== "multi") { f.type = "multi"; f.value = []; }
        if (f.type === "multi" && !Array.isArray(f.value)) f.value = [];
        if (f.type === "text" && Array.isArray(f.value)) f.value = "";
        if (typeof f.collapsed !== "boolean") f.collapsed = true;
      }
    }
  }

  // ---------- Dashboard ----------
  getUniqueCount(rows, colName) {
    if (!colName) return 0;
    const set = new Set();
    for (const r of rows) {
      const v = normalizeValue(r[colName]);
      if (v) set.add(v);
    }
    return set.size;
  }

  countBy(rows, colName) {
    const m = new Map();
    if (!colName) return m;
    for (const r of rows) {
      const v = normalizeValue(r[colName]) || "(Blank)";
      m.set(v, (m.get(v) || 0) + 1);
    }
    return m;
  }

  topN(map, n=6) {
    return Array.from(map.entries())
      .sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n);
  }

  findColumnName(candidates) {
    const lower = new Map(this.columns.map(c => [c.toLowerCase(), c]));
    for (const cand of candidates) {
      const key = cand.toLowerCase();
      if (lower.has(key)) return lower.get(key);
    }
    return null;
  }

  renderDashboard() {
    const rows = this.filteredRows || [];

    const colAsset = this.findColumnName(["Asset Tag","AssetTag","Asset"]);
    const colSerial = this.findColumnName(["Serial Number","Serial","SerialNumber"]);
    const colModel  = this.findColumnName(["Model","Device Model","Model Name"]);
    const colCategory = this.findColumnName(["Category","Device Type","Type"]);
    const colCondition = this.findColumnName(["Condition","Grade"]);
    const colLocation = this.findColumnName(["Location","Site"]);
    const colCompany = this.findColumnName(["Company","Customer","Client"]);
    const colLoggedBy = this.findColumnName(["Logged By","LoggedBy","Checked In By","Technician"]);
    const colAssignedTo = this.findColumnName(["Employee Assign To","Assigned To","Assignee","Employee"]);

    const kpis = [
      { label: "Total Matching Rows", value: rows.length, sub: "Based on applied filters" },
      { label: "Unique Asset Tags", value: this.getUniqueCount(rows, colAsset), sub: colAsset ? colAsset : "Column not found" },
      { label: "Unique Serials", value: this.getUniqueCount(rows, colSerial), sub: colSerial ? colSerial : "Column not found" },
      { label: "Unique Models", value: this.getUniqueCount(rows, colModel), sub: colModel ? colModel : "Column not found" },
    ];

    this.kpiRow.innerHTML = "";
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
      this.kpiRow.appendChild(card);
    }

    const breakdowns = [
      { title: "Category", col: colCategory },
      { title: "Condition", col: colCondition },
      { title: "Location", col: colLocation },
      { title: "Company", col: colCompany },
      { title: "Logged By", col: colLoggedBy },
      { title: "Employee Assign To", col: colAssignedTo },
    ];

    this.breakdownGrid.innerHTML = "";
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
        const counts = this.countBy(rows, b.col);
        const top = this.topN(counts, 6);
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
      this.breakdownGrid.appendChild(card);
    }
  }

  // ---------- Sorting ----------
  sortRows(rows) {
    if (!this.sortState.col) return rows;

    const col = this.sortState.col;
    const dir = this.sortState.dir;

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
  buildTableHeader() {
    this.tableHead.innerHTML = "";
    const tr = document.createElement("tr");

    for (const col of this.columns) {
      const th = document.createElement("th");
      th.textContent = col;

      const sortSpan = document.createElement("span");
      sortSpan.className = "sort";
      if (this.sortState.col === col) sortSpan.textContent = this.sortState.dir === "asc" ? "▲" : "▼";
      else sortSpan.textContent = "";
      th.appendChild(sortSpan);

      th.addEventListener("click", () => {
        if (this.sortState.col === col) this.sortState.dir = (this.sortState.dir === "asc") ? "desc" : "asc";
        else { this.sortState.col = col; this.sortState.dir = "asc"; }

        this.applyAppliedFiltersAndRender();
        this.buildTableHeader();
      });

      tr.appendChild(th);
    }

    this.tableHead.appendChild(tr);
  }

  renderTableBody(rows) {
    this.tableBody.innerHTML = "";

    const RENDER_LIMIT = 2000;
    const displayRows = rows.slice(0, RENDER_LIMIT);

    for (const r of displayRows) {
      const tr = document.createElement("tr");
      for (const c of this.columns) {
        const td = document.createElement("td");
        td.textContent = normalizeValue(r[c]);
        tr.appendChild(td);
      }
      this.tableBody.appendChild(tr);
    }

    if (rows.length > RENDER_LIMIT) {
      this.setStatus(`Showing first ${RENDER_LIMIT} of ${rows.length} filtered rows (export includes all).`, "muted");
    } else {
      this.setStatus("Ready. Edit filters, then click Apply.", "muted");
    }
  }

  // ---------- Apply ----------
  applyAppliedFiltersAndRender() {
    if (!this.rawRows.length) return;

    const matched = this.rawRows.filter(r => this.rowMatchesApplied(r, null));
    this.filteredRows = this.sortRows(matched);

    this.rowCount.textContent = String(this.rawRows.length);
    this.filteredCount.textContent = String(this.filteredRows.length);

    this.renderDashboard();
    this.renderTableBody(this.filteredRows);

    this.buildFiltersUI();
    this.updateApplyButtonState();
  }

  // ---------- Filters UI ----------
  buildFilterHeader(col, f, wrap) {
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

  buildFiltersUI() {
    if (!this.rawRows.length) return;

    const prevSearchText = new Map();
    for (const node of this.filtersContainer.querySelectorAll("input[data-filter-search='1']")) {
      const col = node.getAttribute("data-col");
      prevSearchText.set(col, node.value || "");
    }

    this.filtersContainer.innerHTML = "";
    this.ensureStateSchemas();

    for (const col of this.columns) {
      const fDraft = this.draftState.columns[col];

      const facetCounts = this.getFacetCountsForColumn(col);
      if (!isForcedMulti(col)) {
        const shouldBeMulti = this.isLowCardinalityByCounts(facetCounts);
        if (shouldBeMulti && fDraft.type !== "multi") { fDraft.type = "multi"; fDraft.value = []; }
        if (!shouldBeMulti && fDraft.type !== "text") { fDraft.type = "text"; fDraft.value = ""; }
      } else if (fDraft.type !== "multi") {
        fDraft.type = "multi";
        fDraft.value = [];
      }

      const wrap = document.createElement("div");
      wrap.className = "filter";
      wrap.classList.toggle("collapsed", !!fDraft.collapsed);

      wrap.appendChild(this.buildFilterHeader(col, fDraft, wrap));

      const body = document.createElement("div");
      body.className = "filter-body";

      // TEXT FILTER
      if (fDraft.type === "text") {
        const row = document.createElement("div");
        row.className = "row";

        const inp = document.createElement("input");
        inp.className = "input";
        inp.type = "text";
        inp.placeholder = "Contains…";
        inp.value = fDraft.value || "";

        inp.addEventListener("input", () => {
          this.draftState.columns[col].value = inp.value;
          this.updateApplyButtonState();
        });

        row.appendChild(inp);

        const clearBtn = document.createElement("button");
        clearBtn.className = "small-btn";
        clearBtn.textContent = "Clear";
        clearBtn.type = "button";
        clearBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.draftState.columns[col].value = "";
          this.updateApplyButtonState();
          this.buildFiltersUI();
        });

        row.appendChild(clearBtn);

        body.appendChild(row);
        wrap.appendChild(body);
        this.filtersContainer.appendChild(wrap);
        continue;
      }

      // MULTI-SELECT
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
      btnAll.type = "button";
      btnAll.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const ft = toLower(search.value);
        const visible = options.filter(v => (!ft || toLower(v).includes(ft)));
        this.draftState.columns[col].value = visible;
        this.updateApplyButtonState();
        this.buildFiltersUI();
      });

      const btnNone = document.createElement("button");
      btnNone.className = "small-btn";
      btnNone.textContent = "Clear";
      btnNone.type = "button";
      btnNone.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.draftState.columns[col].value = [];
        this.updateApplyButtonState();
        this.buildFiltersUI();
      });

      actionsRow.appendChild(btnAll);
      actionsRow.appendChild(btnNone);

      const list = document.createElement("div");
      list.className = "facet-list";

      const renderOptionList = () => {
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

            this.draftState.columns[col].value = Array.from(selected);
            this.updateApplyButtonState();

            // rebuild (keeps behavior consistent with your current project)
            this.buildFiltersUI();
            // re-open this filter
            this.draftState.columns[col].collapsed = false;
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
      };

      search.addEventListener("click", (ev) => ev.stopPropagation());
      search.addEventListener("input", renderOptionList);
      renderOptionList();

      body.appendChild(search);
      body.appendChild(actionsRow);
      body.appendChild(list);

      wrap.appendChild(body);
      this.filtersContainer.appendChild(wrap);
    }
  }

  // ---------- Export ----------
  exportFilteredCsv() {
    if (!this.filteredRows.length) return;

    const header = this.columns.map(escapeCsvValue).join(",");
    const lines = this.filteredRows.map(r => this.columns.map(c => escapeCsvValue(r[c])).join(","));
    const csv = [header, ...lines].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.reportId}_filtered_export_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  // ---------- Presets ----------
  readPresets() {
    try {
      const raw = localStorage.getItem(this.PRESETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  writePresets(presets) {
    localStorage.setItem(this.PRESETS_KEY, JSON.stringify(presets));
  }

  refreshPresetSelect() {
    const presets = this.readPresets();
    this.presetSelect.innerHTML = `<option value="">— Select a preset —</option>`;
    for (const p of presets) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      this.presetSelect.appendChild(opt);
    }
  }

  currentPresetPayload() {
    return { global: this.appliedState.global, columns: this.appliedState.columns, sort: this.sortState };
  }

  applyPresetPayload(payload) {
    this.appliedState.global = payload?.global ?? "";
    this.appliedState.columns = payload?.columns ?? {};
    this.sortState = payload?.sort ?? { col: null, dir: "asc" };

    this.draftState = deepClone(this.appliedState);
    for (const c of Object.keys(this.draftState.columns || {})) this.draftState.columns[c].collapsed = true;

    this.globalSearch.value = this.draftState.global;

    this.buildFiltersUI();
    this.buildTableHeader();
    this.applyAppliedFiltersAndRender();
    this.updateApplyButtonState();
  }

  // ---------- Events ----------
  bindEvents() {
    // CSV upload
    this.csvFile.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      this.fileName.textContent = file.name;
      this.setStatus("Parsing CSV…", "muted");

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        complete: (results) => {
          const data = results.data || [];
          const fields = results.meta?.fields || [];
          this.columns = fields.filter(Boolean);
          if (!this.columns.length && data.length) this.columns = Object.keys(data[0]);

          this.rawRows = data.map((r) => {
            const obj = {};
            for (const c of this.columns) obj[c] = (c in r) ? r[c] : "";
            return obj;
          });

          this.appliedState = { global: "", columns: {} };
          this.draftState = { global: "", columns: {} };
          this.sortState = { col: null, dir: "asc" };

          this.enableControls(true);

          this.globalSearch.value = "";
          this.draftState.global = "";

          this.buildTableHeader();
          this.refreshPresetSelect();

          this.ensureStateSchemas();
          for (const c of this.columns) {
            this.appliedState.columns[c].collapsed = true;
            this.draftState.columns[c].collapsed = true;
          }

          this.buildFiltersUI();
          this.applyAppliedFiltersAndRender();

          this.setStatus("CSV loaded. Set filters, then click Apply.", "muted");
          this.updateApplyButtonState();
        },
        error: () => this.setStatus("Failed to parse CSV. Confirm it is a valid .csv file with headers.", "danger")
      });
    });

    // draft global search
    this.globalSearch.addEventListener("input", () => {
      this.draftState.global = this.globalSearch.value;
      this.updateApplyButtonState();
    });

    // apply
    this.btnApply.addEventListener("click", () => {
      this.appliedState = deepClone(this.draftState);

      for (const c of Object.keys(this.draftState.columns || {})) {
        this.draftState.columns[c].collapsed = true;
        this.appliedState.columns[c].collapsed = true;
      }

      this.applyAppliedFiltersAndRender();
      this.buildFiltersUI();

      this.setStatus("Applied filters. Dropdowns closed.", "muted");
      this.updateApplyButtonState();
    });

    // clear
    this.btnClear.addEventListener("click", () => {
      this.draftState.global = "";
      this.appliedState.global = "";
      this.globalSearch.value = "";

      for (const c of this.columns) {
        const a = this.appliedState.columns[c];
        const d = this.draftState.columns[c];
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

      this.sortState = { col: null, dir: "asc" };
      this.buildTableHeader();
      this.buildFiltersUI();
      this.applyAppliedFiltersAndRender();
      this.updateApplyButtonState();
    });

    // export
    this.btnExport.addEventListener("click", () => this.exportFilteredCsv());

    // presets
    this.btnSavePreset.addEventListener("click", () => {
      const name = normalizeValue(this.presetName.value);
      if (!name) {
        this.setStatus("Enter a preset name before saving.", "danger");
        return;
      }

      const presets = this.readPresets();
      const id = crypto?.randomUUID ? crypto.randomUUID() : String(Date.now());

      presets.unshift({
        id,
        name,
        payload: this.currentPresetPayload(),
        createdAt: new Date().toISOString()
      });

      this.writePresets(presets);
      this.refreshPresetSelect();
      this.presetName.value = "";
      this.setStatus(`Saved preset: ${name}`, "muted");
    });

    this.btnLoadPreset.addEventListener("click", () => {
      const id = this.presetSelect.value;
      if (!id) return;

      const presets = this.readPresets();
      const p = presets.find(x => x.id === id);
      if (!p) {
        this.setStatus("Preset not found.", "danger");
        return;
      }

      this.applyPresetPayload(p.payload);
      this.setStatus(`Loaded preset: ${p.name}`, "muted");
    });

    this.btnRenamePreset.addEventListener("click", () => {
      const id = this.presetSelect.value;
      if (!id) {
        this.setStatus("Select a preset to rename.", "danger");
        return;
      }

      const newName = prompt("New preset name:");
      if (!newName) return;

      const presets = this.readPresets();
      const p = presets.find(x => x.id === id);
      if (!p) return;

      p.name = newName.trim();
      this.writePresets(presets);
      this.refreshPresetSelect();
      this.presetSelect.value = id;
      this.setStatus(`Renamed preset to: ${p.name}`, "muted");
    });

    this.btnDeletePreset.addEventListener("click", () => {
      const id = this.presetSelect.value;
      if (!id) {
        this.setStatus("Select a preset to delete.", "danger");
        return;
      }

      const presets = this.readPresets();
      const p = presets.find(x => x.id === id);
      const ok = confirm(`Delete preset "${p?.name || "selected"}"?`);
      if (!ok) return;

      const next = presets.filter(x => x.id !== id);
      this.writePresets(next);
      this.refreshPresetSelect();
      this.presetSelect.value = "";
      this.setStatus("Preset deleted.", "muted");
    });
  }
}

// ---------- Boot ----------
(function init() {
  // theme init
  applyTheme(getStoredTheme());
  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  // dashboards
  const dashboards = new Map();
  for (const section of document.querySelectorAll(".report")) {
    const id = section.getAttribute("data-report");
    dashboards.set(id, new ReportDashboard(section, id));
  }

  // tabs init
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      const id = tab.getAttribute("data-tab");
      setActiveReport(id);
    });
  }

  // default tab
  setActiveReport("stock");
})();
