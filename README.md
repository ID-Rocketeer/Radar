# PHOSPHOR RADAR SYSTEM // TYPE-1090

A high-fidelity, real-time local flight tracking application that utilizes community ADS-B feeds (via the Airplanes.live API) to display aircraft on a retro CRT-styled radar scope. 

The application is styled with a custom brushed aluminum console housing, an inset glowing green-phosphor glass data panel, and a circular CRT glass bezel mask with dynamic 3D glare overlays.

---

## Setup & Launching

You can run the radar system locally in one of two ways:

### Option A: Open the File Directly (Frictionless)
Since the application runs entirely in the client browser, you can simply open the `index.html` file directly in any modern browser:
* Double-click [index.html](file:///C:/Users/Qwarx/code/radar/index.html) or drag it into your browser.
* You can still append query parameters to configure the scope directly in the address bar (e.g. `file:///C:/path/to/radar/index.html?lat=30.1945&lng=-97.6698&rng=50`).

### Option B: Spin up a Local Web Server
If you want to serve the application over your local network:
1. Spin up a local development web server. For example, using Python:
   ```bash
   python -m http.server 8080
   ```
2. Open your browser and navigate to:
   ```
   http://localhost:8080
   ```

---

## URL Configuration Controls

The radar scope's center coordinates and scanning range can be configured dynamically on load by appending query parameters to the URL. The system supports multiple flexible aliases for each parameter.

### 1. Latitude
Sets the center coordinate of the radar origin.
* **Supported Aliases:** `lat`, `latitude`
* **Example:** `?lat=30.19453` or `?latitude=30.19453`

### 2. Longitude
Sets the center coordinate of the radar origin.
* **Supported Aliases:** `long`, `longitude`, `lon`, `lng`
* **Example:** `?lng=-97.66987` or `?longitude=-97.66987`

### 3. Range
Sets the data query boundary radius in Nautical Miles.
* **Supported Aliases:** `range`, `rng`
* **Example:** `?range=100` or `?rng=100`
* **Capping Limits:** Range values are clamped between **10 NM** (minimum for coordinate conversions) and **250 NM** (maximum allowed by the community API). Out-of-bounds requests are automatically capped to these limits.

### Combining Parameters
You can combine parameters to set a completely custom tracking station. For example, to set up a 50 NM radar sweep centered on San Francisco International Airport:
```
http://localhost:8080/?lat=37.6213&lng=-122.3790&rng=50
```

---

## Defaults & Fallbacks
If parameters are missing, invalid, or omitted, the application falls back to:
* **Default Center Coordinates:** Austin-Bergstrom Airport (AUS) (`30.19453, -97.66987`)
* **Default Range:** `250 NM`

---

## Interface Layout & Navigation

* **Desktop View:**
  * Left side contains a unified green-glass plate nested in a brushed metal console. It houses **Configuration**, **Target Filters**, the **Target List**, and the **Active Telemetry Log**.
  * The **Target List** scrolls internally to prevent pushing the **Active Telemetry Log** off screen. On shorter screens (height under 850px, e.g., tablet landscape), the target list caps at 200px and the main sidebar becomes scrollable.
* **Mobile / Tablet View:**
  * The layout collapses into a single vertical scrollable page. The map automatically scales its circular CRT bezel to fit portrait aspect ratios, and nested scrolling is disabled for standard touchscreen scrolling.
* **Map Lock:**
  * Map panning/dragging is disabled to keep the radar origin locked in the center. Selecting a flight from the list or map will keep it selected and zoom out dynamically if the flight flies out of the visible scope.
