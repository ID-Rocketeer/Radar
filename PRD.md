# Product Requirements Document (PRD): Tactical Airspace Radar Scope

## 1. Project Overview & Philosophy
The **Tactical Airspace Radar Scope** is a real-time, high-fidelity web-based radar tracker styled after a Cold War-era analog radar control room. It visualizes live flight telemetry from public ADSB feeds with an authentic visual phosphor sweep, custom vehicle silhouettes, and a multi-layered spatial ambient audio bunker simulation.

---

## 2. Non-Negotiable Technical Constraints

### 2.1 Local-First / Zero-Server Execution
*   **Requirement**: The application must execute instantly when opened directly from the local filesystem (`file:///` protocol) by double-clicking `index.html` in any modern web browser.
*   **Constraint**: No build steps, compilation, transpilation, or server hosting can be required for runtime execution. 
*   **Avoid**: Do not introduce ES6 import/export modules, server-side proxies, or package managers that break offline `file://` compatibility.

### 2.2 Framework & Dependency Limits
*   **Requirement**: The project is built entirely on **Vanilla JavaScript**, **Vanilla CSS**, and **Vanilla HTML**.
*   **Exceptions**: Leaflet JS (v1.9.4) is the sole external library, loaded via static CDN links in `index.html`.
*   **Avoid**: Do not introduce React, Vue, Next.js, TailwindCSS, or other package-heavy dependencies.

### 2.3 Phosphor Green CRT Aesthetic
*   **Requirement**: The visual design must simulate an old cathode-ray tube (CRT) analog screen. This includes heavy green phosphor glows (`filter: drop-shadow`), scanlines, phosphor persistence (fade-out history trails), and radar sweep lines.
*   **Constraint**: Marker elements must remain as HTML DOM nodes (Leaflet `divIcon`) to allow individual custom CSS rules, neon styling, selection rings, and visual trail animations.
*   **Avoid**: Do not replace Leaflet DOM markers with a flat Canvas overlay layer, as this strips away CSS animation/glow properties.

### 2.4 Browser Audio Compatibility
*   **Requirement**: Ambient room noise and spatial panning must use the native Web Audio API, fully supported across standard desktop and mobile browsers.
*   **Constraint**: Audio generators must run inline without requiring external audio assets or plugins.

---

## 3. Core Feature Requirements

### 3.1 Telemetry Data Ingestion & Suppression
*   **Data Source**: Polls public ADSB JSON endpoints every 10 seconds.
*   **Ground Chaff Suppression**: Airport ground surface traffic (Category C) must be filtered out early during ingestion to keep the radar scope clean from static airport noise.

### 3.2 Dynamic Spatial Audio Bunker
*   **Layered Design**: Real-time room sound modeling simulating concrete room acoustics via parallel convolution reverb.
*   **Audio Generators**: The system synthesizes the following 7 layers in real-time:
    *   *Layer A (Mains Hum)*: Buzzy 60 Hz hum with 120 Hz/180 Hz harmonics panned directly Front & Center.
    *   *Layer B (Rotating Sweep Rumble)*: Deep 47 Hz rumble panned overhead, dynamically circling in sync with the visual sweep line.
    *   *Layer C (Cooling Fan)*: Cabinet cooling fan hum panned Low & Left inside the console chassis.
    *   *Layer D (Room AC & Duct Wind)*: Simulated airflow duct rumble panned High Rear Right.
    *   *Layer E (CRT Deflection Squeal)*: High-frequency 15,625 Hz squeal panned Front & Center.
    *   *Layer F (Concrete Room Reverb)*: Convolution reverb bus with 1.3s exponential decay simulating bunker walls.
    *   *Layer G (Fluorescent Light Ballast Hum)*: 120 Hz buzzy rattle hum panned High Left Rear.
*   **Mute Control**: A custom phosphor-green speaker toggle button on the UI sidebar headers for instant audio control.

### 3.3 Class B Vehicle Toggles
*   **Special Iconography**: Dedicated silhouettes for gliders, weather balloons, parachutes, ultralights, drones, and space capsules.
*   **Behavior**: Balloons and parachutes must remain vertically aligned (rotation-locked) regardless of wind track heading. 
*   **UI Control**: A neon-yellow `CLASS B` toggle to highlight, catalog, and prioritize these targets directly on the scope.

### 3.4 Historically Authentic WWII Warbird Layer
*   **Classification**: Decodes military ICAO designators (bombers, fighters/pursuits, transports, trainers).
*   **Custom Vector Silhouettes**:
    *   *Fighters/Pursuits*: Elliptical-winged piston shape (compact wingspan of 17 units).
    *   *Bombers*: Straight-winged 4-engine heavy bomber profile.
    *   *Transports*: Swept-wing twin-prop C-47 transport profile.
    *   *Trainers/Liaison*: Fallback to standard propeller aircraft icon.

---

## 4. Documentation & Easter Egg Secrecy Rules
*   **Feature Secret Rules**: The system contains two interactive easter eggs:
    1.  **CodeRed (WWII Warbird Mode)**: Decodes historical codes, rendering custom bomber, fighter, and transport shapes with red markers.
    2.  **Active Target Tracking Lock-on**: Centering coordinates dynamically lock on to an aircraft, following it as it travels.
*   **Constraint**: The activation sequences, deactivation triggers, and operational behaviors of **both** easter eggs are classified secrets and must be completely omitted from all user-facing documentation (including `README.md`, help menus, and the in-app operations manual modal).
