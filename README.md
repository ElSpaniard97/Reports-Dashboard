# Reports Dashboard

Live site: https://elspaniard97.github.io/Reports-Dashboard/

A static (front-end) reports dashboard for uploading CSV files, applying multi-select filters, saving preset filter views, exporting filtered results, and switching between three report sections:
- Stock Report
- Hardware Consumption Report
- Accessories Consumption Report

Includes a simple landing/login page (client-side gate) and a light/dark theme toggle.

---

## Features

### Report Sections
Each section has the same capabilities and operates independently (including its own saved presets):
- Upload a CSV
- Global search across all columns
- Column filters
  - Multi-select dropdowns for low-cardinality columns
  - Multi-select enforced for the **Model** column
  - Collapsible filters (after selections)
  - Larger option list height to support hundreds of unique values
- **Apply** workflow (filters/search update results only when you click Apply)
- Saved Views (Presets)
  - Save / Load / Rename / Delete
  - Stored in localStorage per report section
- Export filtered data to CSV
- Sortable table (click column headers)

### Landing Page (Login Gate)
A simple username/password landing page blocks access to the dashboard UI until authenticated.

Credentials (as configured):
- Username: `IndeedITAM`
- Password: `Indeed1234`

Notes:
- This is **client-side only** (static site). It is a convenience gate, **not** secure authentication.
- “Remember me” stores login state in localStorage; otherwise it uses sessionStorage.

### Theme Toggle
- Light/Dark mode toggle
- Theme preference persists using localStorage

---

## Project Structure

- `index.html`  
  Main UI + login gate + report section layout.
- `style.css`  
  Theme tokens and full styling for login, tabs, filters, dashboard, and table.
- `app.js`  
  All logic: auth gate, theme toggle, tabs, CSV parsing, filters, presets, apply workflow, export, table rendering/sorting.

---

## How to Use

1. Open the live site:
   https://elspaniard97.github.io/Reports-Dashboard/

2. Log in using the provided credentials.

3. Select a report tab:
   - Stock Report
   - Hardware Consumption Report
   - Accessories Consumption Report

4. Upload a CSV (must contain header row / column names).

5. Configure filters and/or global search.
   - Filters do not change results until you click **Apply**.
   - Multi-select filters allow selecting multiple options per column.

6. Click **Apply** to update the dashboard summary and table.

7. Optional:
   - Save your current applied filters as a preset
   - Export filtered results to CSV
   - Click column headers to sort

---

## Running Locally

### Option A: Simple local web server (recommended)
Some browsers restrict file loading behavior with local files. Use a local server:

**Python**
```bash
python3 -m http.server 8000
