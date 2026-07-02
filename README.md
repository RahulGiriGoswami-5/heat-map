# SafePath — Anonymous Community Safety Map

SafePath is a lightweight, mobile-first community safety mapping application. It allows users to drop pins on a map where they have safety concerns (e.g., poor lighting, harassment) and visualizes those reports through a live heatmap.

This is a **frontend-only** implementation that persists data using the browser's `localStorage` and secures user anonymity by automatically shifting coordinates by a random 50-100 meter offset.

---

## Features

- **Geolocation Auto-Center**: Centers map automatically using the browser's Geolocation API, with a clean fallback if blocked.
- **Click-to-Report Popup**: Interactive popup with custom category tagging buttons and brief notes (max 100 characters).
- **Subtle Privacy Offsets**: Pure mathematical randomization applied to coordinates (~50–100m) to mask exact user locations.
- **Visual Heatmap Layer**: Uses Leaflet.heat with custom weights (e.g. higher weights for harassment incidents).
- **Recent Activity Drawer**: Responsive sidebar highlighting recent reports by category and relative duration (no raw coordinates shown).
- **Client-Side Rate Limiting**: Limit of 5 submissions per 10 minutes per browser session.
- **Interactive Demos**: Load mock safety concerns in the current view or wipe data via Developer Tools in the modal.

---

## How to Run Locally

Since this project utilizes ES Modules (`import/export` statements), opening `index.html` directly from your local filesystem (`file://`) will trigger CORS blocks. You **must** run it using a local development server.

Here are a few quick ways to launch one:

### Method 1: Using Python (Pre-installed on macOS/Linux)
Open a terminal in the project directory and run:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000` in your browser.

### Method 2: Using Node.js (via npx)
If you have Node.js installed, open a terminal in the project directory and run:
```bash
npx http-server -p 8000
```
Or:
```bash
npx live-server
```
Then visit `http://localhost:8000`.

---

## Swapping in a Real Backend Later

All persistence, rate-limiting check logic, and random coordinate offsets are contained within the `data.js` module. The core UI script `app.js` is fully decoupled from the storage layer.

To transition this to a production database (like Supabase, Firebase, or a custom REST API), you **only need to change the contents of `data.js`**. The signature and return values of the exported functions must remain identical.

### Transition Roadmap Example (using Supabase)

To swap `localStorage` with a live Supabase client, rewrite `data.js` as follows:

```javascript
// 1. Initialize Supabase client
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabase = createClient('SUPABASE_URL', 'SUPABASE_ANON_KEY');

export function applyRandomOffset(lat, lng) {
  // Keep the same privacy offset calculation here so it runs before saving to the DB
  ...
}

// 2. Fetch reports from database
export async function getReports() {
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false });
    
  if (error) {
    console.error(error);
    return [];
  }
  return data;
}

// 3. Add report to database (Rate limit checking should ideally move server-side via DB trigger or API)
export async function addReport(reportInput) {
  const offsetCoords = applyRandomOffset(reportInput.lat, reportInput.lng);
  
  const report = {
    lat: offsetCoords.lat,
    lng: offsetCoords.lng,
    category: reportInput.category,
    note: reportInput.note ? reportInput.note.substring(0, 100) : null
  };

  const { data, error } = await supabase
    .from('reports')
    .insert([report])
    .select()
    .single();

  if (error) {
    console.error(error);
    return null;
  }
  return data;
}

// 4. Reset function (For dev environments)
export async function clearReports() {
  const { error } = await supabase
    .from('reports')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Truncate table expression
    
  if (error) console.error(error);
}
```

No modifications will be needed in `app.js`.
