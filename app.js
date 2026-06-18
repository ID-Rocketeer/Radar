
/* ==========================================================================
   SYSTEM PARAMETERS & INITIAL DATA
   ========================================================================== */
// Parse coordinates and tracking range from URL query parameters supporting multiple aliases
const urlParams = new URLSearchParams(window.location.search);

const defaultLat = 30.19453;
const defaultLon = -97.66987;
const defaultRange = 250;

// Latitude aliases: lat, latitude
const rawLat = urlParams.get('lat') || urlParams.get('latitude');
let HOME_LAT = parseFloat(rawLat);

// Longitude aliases: long, longitude, lon, lng
const rawLon = urlParams.get('long') || urlParams.get('longitude') || urlParams.get('lon') || urlParams.get('lng');
let HOME_LON = parseFloat(rawLon);

// Range aliases: range, rng
const rawRange = urlParams.get('range') || urlParams.get('rng');
let RANGE_NM = parseFloat(rawRange);

if (isNaN(HOME_LAT)) HOME_LAT = defaultLat;
if (isNaN(HOME_LON)) HOME_LON = defaultLon;

// Validate and cap range. The Airplanes.live API limits point queries to 250 NM.
// We also set a minimum of 10 NM to prevent division by zero or rendering issues on tiny zoom levels.
if (isNaN(RANGE_NM)) {
    RANGE_NM = defaultRange;
} else {
    RANGE_NM = Math.max(10, Math.min(RANGE_NM, 250));
}

const SWEEP_DURATION_MS = 10000; // 10s rotation cycle
const API_POLL_INTERVAL_MS = 10000; // Poll API every 10s

// Map and tracking states
let map;
let rangeRings = [];
let activeAircraft = {}; // Holds aircraft metadata and map instances
let selectedHex = null;
let activeFilter = 'all'; // 'all', 'mil', 'commercial', 'ga'
let trailsEnabled = true;
let targetListDomMap = {}; // Maps hex -> DOM element for target list reconciliation
let sweepEl = null; // Global reference to the sweep line DOM element

// SVG silhouettes for different aircraft classifications (optimized for 24x24 viewBox)
const AIRCRAFT_ICONS = {
    // Standard commercial airliner/medium-heavy jet
    jet: 'M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z',
    // Sleek delta-wing military fighter jet
    fighter: 'M12,2L14.5,10L22,12.5L14.5,14L13.5,19.5L15.5,21.5L12,21L8.5,21.5L10.5,19.5L9.5,14L2,12.5L9.5,10Z',
    // Light general aviation/propeller airplane (wide straight wings)
    light: 'M12,2A1,1 0 0,0 11,3V8.5L1,9.5V11.5L11,10.5V19L7.5,21.5V22.5L12,22L16.5,22.5V21.5L13,19V10.5L23,11.5V9.5L13,8.5V3A1,1 0 0,0 12,2Z',
    // Helicopter top-down view (rotors & tail spinner)
    helicopter: 'M12,6C13.7,6 14.8,7.5 14.8,10C14.8,12 13.5,14 12.8,16H11.2C10.5,14 9.2,12 9.2,10C9.2,7.5 10.3,6 12,6ZM2.7,3.3L20.7,21.3L21.3,20.7L3.3,2.7ZM20.7,2.7L2.7,20.7L3.3,21.3L21.3,3.3ZM12,9.8A1.2,1.2 0 1,1 12,12.2A1.2,1.2 0 1,1 12,9.8ZM6.6,9H7.4V15.5H6.6ZM7.4,9.6H9.2V10.4H7.4ZM7.4,13.6H9.5V14.4H7.4ZM16.6,9H17.4V15.5H16.6ZM14.8,9.6H16.6V10.4H14.8ZM14.5,13.6H16.6V14.4H14.5ZM11.6,16H12.4V22H11.6ZM9,19.7H15V20.3H9ZM9.7,19H10.3V23H9.7ZM10.3,21.2H11.6V21.8H10.3'
};

// Classifies the aircraft raw data into one of our custom icon categories
function getAircraftIconType(rawAc) {
    const category = (rawAc.category || '').toUpperCase();
    const typeCode = (rawAc.t || '').toUpperCase();
    const desc = (rawAc.desc || '').toUpperCase();
    const isMil = !!(rawAc.mil === 1 || rawAc.mil === true || (rawAc.dbflags & 1) === 1);

    // 1. Helicopters (Category C1/A7, description contains helicopter manufacturers/keywords, or common helicopter type codes)
    const isHelicopter = (
        category === 'C1' || 
        category === 'A7' || 
        desc.includes('HELICOPTER') || 
        desc.includes('ROTOR') || 
        desc.includes('BELL') || 
        desc.includes('ROBINSON') || 
        desc.includes('SIKORSKY') || 
        desc.includes('EUROCOPTER') || 
        desc.includes('AGUSTA') || 
        desc.includes('HUGHES') || 
        desc.includes('SCHWEIZER') || 
        typeCode.startsWith('EC3') || 
        typeCode.startsWith('EC4') || 
        typeCode.startsWith('EC5') || 
        typeCode.startsWith('AS5') || 
        ['S76', 'S92', 'A139', 'R44', 'R22', 'R66', 'B06', 'B407', 'B505', 'HU30', 'H500'].includes(typeCode)
    );
    if (isHelicopter) {
        return 'helicopter';
    }

    // 2. Military Fighters / SLEEK jets (Category A4 = High Performance, military prefix types)
    if (isMil && (category === 'A4' || typeCode.startsWith('F-') || typeCode.startsWith('FA-') || typeCode.startsWith('A-') || ['F15', 'F16', 'F18', 'F22', 'F35', 'A10', 'T38', 'B1', 'B2', 'B52', 'C17', 'C130', 'KC135'].includes(typeCode))) {
        return 'fighter';
    }

    // 3. Light Aircraft / Propeller General Aviation (ICAO description ends with 'P' for piston-engines, e.g. L1P)
    if (category === 'A1' || desc.endsWith('P') || desc.includes('PISTON') || ['C172', 'C152', 'C182', 'PA28', 'PA44', 'SR22', 'SR20', 'DA40', 'DA42', 'BE36', 'BE58', 'M20', 'RV6', 'RV7', 'RV8', 'RV10'].includes(typeCode)) {
        return 'light';
    }

    // Default to commercial jet liner
    return 'jet';
}

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */
// Update the sidebar configuration display elements with the parsed URL query parameters
function updateUIConfigurationValues() {
    const latEl = document.getElementById('val-lat');
    const lonEl = document.getElementById('val-lon');
    const rangeEl = document.getElementById('val-range');
    
    if (latEl) latEl.innerText = HOME_LAT.toFixed(5);
    if (lonEl) lonEl.innerText = HOME_LON.toFixed(5);
    if (rangeEl) rangeEl.innerText = `${RANGE_NM} NM`;
}

function initializeRadarSystem() {
    initMap();
    initControls();
    updateUIConfigurationValues();
    startRadarSweep();
    
    // Initial size and minimum zoom calculation
    setTimeout(() => {
        updateMinZoom();
        updateSweepSize();
        updateDisplayedRange();
    }, 100);

    pollFlightData();
    setInterval(pollFlightData, API_POLL_INTERVAL_MS);
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initializeRadarSystem);
} else {
    initializeRadarSystem();
}

// Update scope dimension and zoom limits on window resize
window.addEventListener('resize', () => {
    updateMinZoom();
    updateSweepSize();
    updateDisplayedRange();
});

/* ==========================================================================
   MAP SETUP
   ========================================================================== */
function initMap() {
    // Initialize map with zoom limits and hide default controls for a clean screen
    // Keep map center locked on Home coordinates, zoom centered on Home
    map = L.map('map', {
        zoomControl: false,
        attributionControl: true,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        dragging: false,
        scrollWheelZoom: 'center',
        touchZoom: 'center',
        zoomSnap: 0, // Enable smooth fractional zoom levels
        zoomDelta: 0.5 // Set zoom buttons step size
    }).setView([HOME_LAT, HOME_LON], 8); // Start at zoom 8 (which is safe and covers bezel)

    // Load CartoDB Dark Matter tile layer
    // The CSS filter in index.css will transform these dark-grayscale tiles into a bright retro-green screen
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 12,
        minZoom: 4
    }).addTo(map);

    // Draw range rings around home location (1 NM = 1852 meters)
    const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
    ringFactors.forEach(factor => {
        const distance = factor * RANGE_NM;
        const ring = L.circle([HOME_LAT, HOME_LON], {
            radius: distance * 1852,
            color: '#00ff55',
            weight: 1,
            opacity: 0.12,
            dashArray: '3, 8',
            fill: false,
            interactive: false
        }).addTo(map);
        rangeRings.push(ring);
    });

    // Add Home Crosshair Marker
    const homeIcon = L.divIcon({
        className: 'radar-home-marker-container',
        html: `
            <div class="radar-home-marker">
                <div class="radar-home-crosshair">
                    <div class="radar-home-dot"></div>
                    <div class="radar-home-ring"></div>
                </div>
            </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    L.marker([HOME_LAT, HOME_LON], { icon: homeIcon, interactive: false }).addTo(map);

    // Initialize custom control buttons in bottom-left corner of the map viewport
    const customZoom = L.control({ position: 'bottomright' });
    customZoom.onAdd = function() {
        const div = L.DomUtil.create('div', 'leaflet-bar');
        div.style.border = '1px solid var(--panel-border)';
        div.style.background = 'rgba(1, 10, 2, 0.85)';
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.innerHTML = `
            <button class="retro-btn" id="zoom-in" style="width: 32px; height: 32px; margin: 0; font-size: 1rem; border:none; border-bottom:1px solid var(--panel-border)">+</button>
            <button class="retro-btn" id="zoom-out" style="width: 32px; height: 32px; margin: 0; font-size: 1rem; border:none">-</button>
        `;
        return div;
    };
    customZoom.addTo(map);

    document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn());
    document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut());

    // Bind zoom/pan events to dynamically update marker visibility (viewport pruning) and displayed range
    map.on('moveend zoomend', () => {
        updateMapMarkersVisibility();
        updateDisplayedRange();
    });
}

/* ==========================================================================
   UI CONTROLS & LISTENERS
   ========================================================================== */
function initControls() {


    // Flight Trails Toggle Button
    const trailBtn = document.getElementById('trail-toggle');
    trailBtn.addEventListener('click', () => {
        trailsEnabled = !trailsEnabled;
        trailBtn.innerHTML = `TRAILS: ${trailsEnabled ? 'ON' : 'OFF'}`;
        
        // Hide or show all current trails
        Object.values(activeAircraft).forEach(ac => {
            if (ac.trail) {
                if (trailsEnabled) {
                    ac.trail.addTo(map);
                } else {
                    ac.trail.remove();
                }
            }
        });
    });

    // Filter Buttons Selection
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.filter;
            
            // Re-render components to filter views
            updateTargetList();
            updateMapMarkersVisibility();
        });
    });
}



// Dynamically adjust map's minZoom level to ensure the 250 NM range ring always fills the bezel viewport
function updateMinZoom() {
    if (!map) return;
    
    const rangeMeters = RANGE_NM * 1852; // 250 NM in meters
    const centerLatLng = L.latLng(HOME_LAT, HOME_LON);
    const R = 6378137;
    const dLon = rangeMeters / (R * Math.cos(Math.PI * HOME_LAT / 180));
    const destLatLng = L.latLng(HOME_LAT, HOME_LON + dLon * 180 / Math.PI);
    
    try {
        const currentZoom = map.getZoom();
        const centerPoint = map.latLngToLayerPoint(centerLatLng);
        const destPoint = map.latLngToLayerPoint(destLatLng);
        const radiusPx = centerPoint.distanceTo(destPoint);
        
        // Calculate bezel diameter dynamically based on device layout (mobile vs desktop)
        let bezelDiameter;
        if (window.innerWidth <= 768) {
            bezelDiameter = Math.min(window.innerHeight * 0.56, window.innerWidth * 0.94);
        } else {
            bezelDiameter = Math.min(window.innerHeight * 0.96, (window.innerWidth - 380) * 0.96);
        }
        
        // Calculate the exact zoom level where the 250 NM circle diameter equals the bezel diameter
        const requiredRatio = bezelDiameter / (2 * radiusPx);
        const targetZoomFloat = currentZoom + Math.log2(requiredRatio);
        
        // Use the exact fractional target zoom to lock the minimum zoom exactly at the bezel border
        // Add a tiny safety offset (e.g. +0.01) to ensure we completely cover the border with zero pixel gap
        const minZoomVal = targetZoomFloat + 0.01;
        
        map.setMinZoom(minZoomVal);
        
        // Force the map to the minimum zoom level if it is currently zoomed out too far
        if (map.getZoom() < minZoomVal) {
            map.setZoom(minZoomVal);
        }
    } catch (e) {
        // Map projection or bounds not ready yet
    }
}

// Dynamically adjust the sweep line dimension to match the 250 NM range ring exactly
function updateSweepSize() {
    if (!map) return;
    if (!sweepEl || !document.body.contains(sweepEl)) {
        sweepEl = document.getElementById('sweep-line');
    }
    if (!sweepEl) return;

    const rangeMeters = RANGE_NM * 1852; // 250 NM in meters
    const centerLatLng = L.latLng(HOME_LAT, HOME_LON);
    const R = 6378137;
    const dLon = rangeMeters / (R * Math.cos(Math.PI * HOME_LAT / 180));
    const destLatLng = L.latLng(HOME_LAT, HOME_LON + dLon * 180 / Math.PI);
    
    try {
        const centerPoint = map.latLngToLayerPoint(centerLatLng);
        const destPoint = map.latLngToLayerPoint(destLatLng);
        const radiusPx = centerPoint.distanceTo(destPoint);
        
        sweepEl.style.width = `${radiusPx * 2}px`;
        sweepEl.style.height = `${radiusPx * 2}px`;
        sweepEl.style.marginLeft = `${-radiusPx}px`;
        sweepEl.style.marginTop = `${-radiusPx}px`;
    } catch (e) {
        // Map projection not ready yet
    }
}

// Dynamically calculate and report the physical range currently displayed at the bezel edge
function updateDisplayedRange() {
    if (!map) return;
    const rangeEl = document.getElementById('val-range');
    if (!rangeEl) return;

    try {
        const centerLatLng = L.latLng(HOME_LAT, HOME_LON);
        const centerPoint = map.latLngToLayerPoint(centerLatLng);
        
        // Calculate bezel diameter dynamically based on device layout (mobile vs desktop)
        let bezelDiameter;
        if (window.innerWidth <= 768) {
            bezelDiameter = Math.min(window.innerHeight * 0.56, window.innerWidth * 0.94);
        } else {
            bezelDiameter = Math.min(window.innerHeight * 0.96, (window.innerWidth - 380) * 0.96);
        }
        const bezelRadiusPx = bezelDiameter / 2;
        
        // Get LatLng at the edge of the bezel
        const edgeLatLng = map.layerPointToLatLng([centerPoint.x + bezelRadiusPx, centerPoint.y]);
        
        // Calculate distance in NM
        const displayedRange = calcDistance(HOME_LAT, HOME_LON, edgeLatLng.lat, edgeLatLng.lng);
        
        rangeEl.innerText = `${displayedRange.toFixed(1)} NM`;
    } catch (e) {
        // Map projection not ready yet
    }
}

/* ==========================================================================
   RADAR ROTATING SWEEP ANIMATION
   ========================================================================== */
function startRadarSweep() {
    // Create the sweep element as an overlay pinned at your coordinates
    const sweepIcon = L.divIcon({
        className: 'radar-sweep-marker',
        html: '<div class="radar-sweep-line" id="sweep-line"></div>',
        iconSize: [0, 0]
    });
    L.marker([HOME_LAT, HOME_LON], { icon: sweepIcon, interactive: false }).addTo(map);

    let lastTime = null;
    let currentAngle = 0;

    // Update sweep size on map zoom and view reset
    map.on('zoom viewreset', updateSweepSize);

    function animate(timestamp) {
        if (lastTime === null) {
            lastTime = timestamp;
            requestAnimationFrame(animate);
            return;
        }

        const dt = timestamp - lastTime;
        lastTime = timestamp;

        // Clamp delta time to sweep duration to prevent giant jumps when tab wakes up
        const clampedDt = Math.min(dt, SWEEP_DURATION_MS);

        // Calculate sweep increment based on delta time
        const deltaAngle = (clampedDt / SWEEP_DURATION_MS) * 360;
        const nextAngle = (currentAngle + deltaAngle) % 360;

        // Check if cached sweep line element is null or has been detached by Leaflet (e.g., on zoom/pan)
        if (!sweepEl || !document.body.contains(sweepEl)) {
            sweepEl = document.getElementById('sweep-line');
            updateSweepSize(); // Recalculate dimensions on recreation
        }

        // Update sweep rotation visually
        if (sweepEl) {
            sweepEl.style.transform = `translateZ(0) rotate(${nextAngle}deg)`;
        }

        // Check which aircraft are passed over by the radar beam during this frame
        checkSweptAircraft(currentAngle, nextAngle);

        currentAngle = nextAngle;
        requestAnimationFrame(animate);
    }
    
    // Initial size calculation call
    setTimeout(updateSweepSize, 100);
    requestAnimationFrame(animate);
}

/* ==========================================================================
   SWEEP INTERSECTION CHECK (GEOGRAPHICAL BEARING)
   ========================================================================== */
function checkSweptAircraft(prevAngle, currentAngle) {
    // The width of the sweep intersection sector in degrees
    const sweepDiff = (currentAngle - prevAngle + 360) % 360;

    Object.keys(activeAircraft).forEach(hex => {
        const ac = activeAircraft[hex];
        
        // Check if the plane's precomputed bearing is within the wedge swept in this frame
        // This runs instantly with zero DOM/Leaflet coordinate conversion overhead
        const angleDiff = (ac.bearing - prevAngle + 360) % 360;

        if (angleDiff <= sweepDiff) {
            triggerAircraftSweep(hex);
        }
    });
}

/* ==========================================================================
   AIRCRAFT UPDATE ON SWEEP PASS
   ========================================================================== */
function triggerAircraftSweep(hex) {
    const ac = activeAircraft[hex];
    if (!ac) return;

    const hasPending = ac.pendingUpdate !== null;
    const safeHex = sanitizeId(hex);

    // If new data arrived, apply the update precisely at the moment of the sweep pass
    if (hasPending) {
        const update = ac.pendingUpdate;
        ac.lat = update.lat;
        ac.lon = update.lon;
        ac.alt = update.alt;
        ac.speed = update.speed;
        ac.track = update.track;
        ac.seen = update.seen;
        ac.dist = calcDistance(HOME_LAT, HOME_LON, ac.lat, ac.lon);
        ac.bearing = calcBearing(ac.lat, ac.lon);

        // Move marker if it is currently rendered (active on map)
        if (ac.marker) {
            ac.marker.setLatLng([ac.lat, ac.lon]);
        }
        
        // Update SVG icon rotation (safely via getElementById to handle hex IDs containing tildes "~")
        const markerDom = document.getElementById(`marker-${safeHex}`);
        const iconSvg = markerDom ? markerDom.querySelector('.aircraft-icon') : null;
        if (iconSvg) {
            iconSvg.style.transform = `rotate(${ac.track}deg)`;
        }

        // Update trail polyline if it is currently rendered
        if (ac.trail && trailsEnabled) {
            ac.trail.addLatLng([ac.lat, ac.lon]);
            // Keep trail length constrained to recent 15 coordinates
            const latlngs = ac.trail.getLatLngs();
            if (latlngs.length > 15) {
                latlngs.shift();
                ac.trail.setLatLngs(latlngs);
            }
        }

        ac.pendingUpdate = null;
    }

    // Trigger phosphor flash excitation animation (reflow-free using setTimeout)
    const markerDom = document.getElementById(`marker-${safeHex}`);
    if (markerDom) {
        markerDom.classList.add('swept-flash');
        setTimeout(() => {
            const el = document.getElementById(`marker-${safeHex}`);
            if (el) el.classList.remove('swept-flash');
        }, 100);
    }

    // If this plane is currently selected, refresh telemetry details dynamically
    if (selectedHex === hex) {
        renderTelemetryDetails(hex);
    }

    // Refresh telemetry values in the sidebar list for this plane
    const rowEl = document.getElementById(`row-${safeHex}`);
    if (rowEl) {
        rowEl.querySelector('.col-alt').innerText = ac.alt ? formatNumber(ac.alt) : '0';
        rowEl.querySelector('.col-spd').innerText = ac.speed ? ac.speed : '0';
        rowEl.querySelector('.col-dst').innerText = ac.dist.toFixed(1);
    }
}

/* ==========================================================================
   API DATA RETRIEVAL (AIRPLANES.LIVE)
   ========================================================================== */
function pollFlightData() {
    const url = `https://api.airplanes.live/v2/point/${HOME_LAT}/${HOME_LON}/${RANGE_NM}`;
    
    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("API Connection Failed");
            return res.json();
        })
        .then(data => {
            processAPIResponse(data);
        })
        .catch(err => {
            console.error("Fetch Error:", err);
            // Glitch header effect in case of connection errors
            const titleEl = document.querySelector('.system-status .status-text');
            if (titleEl) {
                titleEl.innerText = "SYS_STATUS: LINK ERROR";
                document.querySelector('.status-indicator').classList.remove('active');
            }
        });
}

function processAPIResponse(data) {
    // Reset status elements to Online
    const statusText = document.querySelector('.system-status .status-text');
    const indicator = document.querySelector('.status-indicator');
    if (statusText) statusText.innerText = "SYS_STATUS: SCANNING";
    if (indicator) indicator.classList.add('active');

    const freshHexes = new Set();
    const aircraftList = data.ac || [];

    aircraftList.forEach(rawAc => {
        const hex = rawAc.hex;
        if (!hex) return;

        // Escape outside data immediately at the ingestion level
        const cleanHex = escapeHtml(hex);
        freshHexes.add(cleanHex);

        // Normalize basic telemetry
        const lat = parseFloat(rawAc.lat);
        const lon = parseFloat(rawAc.lon);
        if (isNaN(lat) || isNaN(lon)) return; // Ignore planes without coordinates

        const rawCallsign = (rawAc.flight || rawAc.r || hex).trim();
        const callsign = escapeHtml(rawCallsign);
        const alt = Number(rawAc.alt_baro || rawAc.alt_geom || 0);
        const speed = Number(rawAc.gs || rawAc.ias || rawAc.tas || 0);
        const track = Number(rawAc.track || 0);
        const seen = Number(rawAc.seen || 0);
        
        // Classify military targets: standard 'mil' flag or Category D/Military type flags
        const isMil = !!(rawAc.mil === 1 || rawAc.mil === true || (rawAc.dbflags & 1) === 1);

        const currentDistance = calcDistance(HOME_LAT, HOME_LON, lat, lon);

        // If aircraft is already tracked in local state
        if (activeAircraft[cleanHex]) {
            const ac = activeAircraft[cleanHex];
            
            // Recalculate icon type if we get new info that was missing initially
            let infoChanged = false;
            if (rawAc.t && (!ac.type || ac.type === 'UNKN')) { ac.type = escapeHtml(rawAc.t); infoChanged = true; }
            if (rawAc.desc && (!ac.desc || ac.desc === 'AIRCRAFT')) { ac.desc = escapeHtml(rawAc.desc); infoChanged = true; }
            if (rawAc.category && !ac.category) { ac.category = escapeHtml(rawAc.category); infoChanged = true; }
            if (rawAc.r && (!ac.reg || ac.reg === 'UNKNOWN')) { ac.reg = escapeHtml(rawAc.r); infoChanged = true; }
            if (rawAc.squawk && (!ac.squawk || ac.squawk === '0000')) { ac.squawk = escapeHtml(rawAc.squawk); infoChanged = true; }

            if (infoChanged) {
                const newIconType = getAircraftIconType(rawAc);
                if (newIconType !== ac.iconType) {
                    ac.iconType = newIconType;
                    // Dynamically update the SVG path in the Leaflet marker if it is currently rendered
                    const safeHex = sanitizeId(cleanHex);
                    const markerDom = document.getElementById(`marker-${safeHex}`);
                    const pathEl = markerDom ? markerDom.querySelector('.aircraft-icon path') : null;
                    if (pathEl) {
                        pathEl.setAttribute('d', AIRCRAFT_ICONS[newIconType || 'jet']);
                    }
                }
            }

            // Buffer the coordinates: do not move the plane until the sweep line passes
            ac.pendingUpdate = {
                lat: lat,
                lon: lon,
                alt: alt,
                speed: speed,
                track: track,
                seen: seen
            };
            ac.seen = seen;
        } else {
            // Store in tracking registry (markers/trails created lazily in updateMarkerVisibility)
            activeAircraft[cleanHex] = {
                hex: cleanHex,
                marker: null,
                trail: null,
                lat: lat,
                lon: lon,
                alt: alt,
                speed: speed,
                track: track,
                bearing: calcBearing(lat, lon),
                callsign: callsign,
                reg: escapeHtml(rawAc.r || 'UNKNOWN'),
                type: escapeHtml(rawAc.t || 'UNKN'),
                desc: escapeHtml(rawAc.desc || 'AIRCRAFT'),
                squawk: escapeHtml(rawAc.squawk || '0000'),
                mil: isMil,
                dist: currentDistance,
                category: escapeHtml(rawAc.category || ''),
                seen: seen,
                iconType: getAircraftIconType(rawAc),
                pendingUpdate: null
            };
        }

        // Dynamically update marker creation/visibility (includes viewport bounds checking)
        updateMarkerVisibility(cleanHex);
    });

    // Remove aircraft that are no longer being broadcasted by the API (seen threshold > 60s)
    Object.keys(activeAircraft).forEach(hex => {
        const ac = activeAircraft[hex];
        // If not in the fresh batch, or if it hasn't been seen in a while
        if (!freshHexes.has(hex) || ac.seen > 60) {
            if (ac.marker && map.hasLayer(ac.marker)) {
                map.removeLayer(ac.marker);
            }
            if (ac.trail && map.hasLayer(ac.trail)) {
                map.removeLayer(ac.trail);
            }
            delete activeAircraft[hex];
            
            if (selectedHex === hex) {
                selectedHex = null;
                resetTelemetryDisplay();
            }
        }
    });

    // Refresh sidebar displays
    updateTargetList();

    // Ensure map zoom limits and sweep size are correct now that map is fully loaded
    updateMinZoom();
    updateSweepSize();
}

/* ==========================================================================
   SIDEBAR COMPONENT RENDERING
   ========================================================================== */

// Helper to determine if an aircraft is inside the map viewport bounds
function isAircraftInViewport(ac) {
    if (!map) return false;
    try {
        const bounds = map.getBounds();
        return bounds.contains([ac.lat, ac.lon]);
    } catch (e) {
        return true; // Default to true if bounds aren't loaded yet
    }
}

// Incremental target list DOM reconciliation & slicing to top 100 targets
function updateTargetList() {
    const listContainer = document.getElementById('target-list');
    
    // Filter and sort active aircraft list
    const filteredAc = Object.values(activeAircraft).filter(ac => {
        if (activeFilter === 'mil') return ac.mil;
        if (activeFilter === 'commercial') {
            // Heuristic for commercial flights: Not military, cruising at higher altitudes
            // or has commercial category A3/A4/A5
            return !ac.mil && (ac.alt > 15000 || ac.speed > 240);
        }
        if (activeFilter === 'ga') {
            // General Aviation: Not military, lower speeds/altitudes
            return !ac.mil && ac.alt <= 15000 && ac.speed <= 240;
        }
        return true; // 'all'
    });

    // Sort list: Military first, then closest distance
    filteredAc.sort((a, b) => {
        if (a.mil && !b.mil) return -1;
        if (!a.mil && b.mil) return 1;
        return a.dist - b.dist;
    });

    // Slice to top 100 closest targets for layout performance
    const topAc = filteredAc.slice(0, 100);
    document.getElementById('target-count').innerText = filteredAc.length;

    if (topAc.length === 0) {
        listContainer.innerHTML = `<div class="empty-list-message">NO TARGETS MATCHING CURRENT SELECTION IN RANGE</div>`;
        targetListDomMap = {};
        return;
    }

    // Remove empty list message if it's there
    const emptyMsg = listContainer.querySelector('.empty-list-message');
    if (emptyMsg) {
        listContainer.removeChild(emptyMsg);
    }

    const currentHexes = new Set(topAc.map(ac => ac.hex));

    // Remove DOM elements for aircraft that are no longer in the top 100
    Object.keys(targetListDomMap).forEach(hex => {
        if (!currentHexes.has(hex)) {
            const el = targetListDomMap[hex];
            if (el && el.parentNode) {
                el.parentNode.removeChild(el);
            }
            delete targetListDomMap[hex];
        }
    });

    // Reconcile and position rows
    topAc.forEach((ac, idx) => {
        const safeHex = sanitizeId(ac.hex);
        let item = targetListDomMap[ac.hex];

        if (!item) {
            item = document.createElement('div');
            item.id = `row-${safeHex}`;
            item.addEventListener('click', () => {
                selectAircraft(ac.hex);
            });
            targetListDomMap[ac.hex] = item;
        }

        // Apply updated classification classes
        item.className = `target-item ${ac.mil ? 'mil' : ''} ${selectedHex === ac.hex ? 'selected' : ''}`;

        // Build HTML content and replace only if changed to prevent browser paint loops
        const htmlContent = `
            <span class="col-callsign lbl-callsign">${ac.callsign}</span>
            <span class="col-alt">${ac.alt ? formatNumber(ac.alt) : '0'}</span>
            <span class="col-spd">${ac.speed ? ac.speed : '0'}</span>
            <span class="col-dst">${ac.dist.toFixed(1)}</span>
        `;
        if (item.innerHTML !== htmlContent) {
            item.innerHTML = htmlContent;
        }

        // Maintain correct sorting positions in the list
        const childAtIdx = listContainer.children[idx];
        if (childAtIdx) {
            if (childAtIdx !== item) {
                listContainer.insertBefore(item, childAtIdx);
            }
        } else {
            listContainer.appendChild(item);
        }
    });
}

function updateMapMarkersVisibility() {
    Object.keys(activeAircraft).forEach(hex => {
        updateMarkerVisibility(hex);
    });
}

// Viewport-based marker lazy rendering & dynamic culling
function updateMarkerVisibility(hex) {
    const ac = activeAircraft[hex];
    if (!ac) return;

    let visible = true;
    if (activeFilter === 'mil' && !ac.mil) visible = false;
    else if (activeFilter === 'commercial' && (ac.mil || (ac.alt <= 15000 && ac.speed <= 240))) visible = false;
    else if (activeFilter === 'ga' && (ac.mil || ac.alt > 15000 || ac.speed > 240)) visible = false;

    // Viewport bounds pruning check
    if (visible && !isAircraftInViewport(ac)) {
        visible = false;
    }

    if (visible) {
        const safeHex = sanitizeId(ac.hex);
        
        // Lazy create marker on map only if it is visible
        if (!ac.marker) {
            const iconPath = AIRCRAFT_ICONS[ac.iconType || 'jet'];
            const markerIcon = L.divIcon({
                className: `aircraft-marker-container`,
                html: `
                    <div class="aircraft-marker ${ac.mil ? 'mil' : ''}" id="marker-${safeHex}">
                        <svg class="aircraft-icon" viewBox="0 0 24 24" style="transform: rotate(${ac.track}deg);">
                            <path d="${iconPath}" />
                        </svg>
                        <div class="aircraft-label">${ac.callsign}</div>
                    </div>
                `,
                iconSize: [30, 45],
                iconAnchor: [15, 22]
            });
            ac.marker = L.marker([ac.lat, ac.lon], { icon: markerIcon }).addTo(map);
            ac.marker.on('click', () => selectAircraft(ac.hex));
        } else {
            if (!map.hasLayer(ac.marker)) {
                ac.marker.addTo(map);
            }
        }

        // Lazy create trail polyline on map
        if (trailsEnabled) {
            if (!ac.trail) {
                ac.trail = L.polyline([[ac.lat, ac.lon]], {
                    className: `radar-trail ${ac.mil ? 'mil' : ''}`,
                    interactive: false
                }).addTo(map);
            } else {
                if (!map.hasLayer(ac.trail)) {
                    ac.trail.addTo(map);
                }
            }
        } else {
            if (ac.trail && map.hasLayer(ac.trail)) {
                ac.trail.remove();
            }
        }
    } else {
        // Prune off-screen or filtered markers from the map DOM to release memory/CPU load
        if (ac.marker && map.hasLayer(ac.marker)) {
            map.removeLayer(ac.marker);
        }
        if (ac.trail && map.hasLayer(ac.trail)) {
            map.removeLayer(ac.trail);
        }
    }
}

/* ==========================================================================
   SELECTION HANDLING
   ========================================================================== */
function selectAircraft(hex) {
    // Remove highlights from old selection
    if (selectedHex && activeAircraft[selectedHex]) {
        const safeOldHex = sanitizeId(selectedHex);
        const prevDom = document.getElementById(`marker-${safeOldHex}`);
        if (prevDom) prevDom.classList.remove('selected');
        
        const prevRow = document.getElementById(`row-${safeOldHex}`);
        if (prevRow) prevRow.classList.remove('selected');
    }

    selectedHex = hex;

    // Apply selection styling to new aircraft
    if (selectedHex && activeAircraft[selectedHex]) {
        const ac = activeAircraft[selectedHex];
        const safeNewHex = sanitizeId(selectedHex);
        const newDom = document.getElementById(`marker-${safeNewHex}`);
        if (newDom) newDom.classList.add('selected');

        const newRow = document.getElementById(`row-${safeNewHex}`);
        if (newRow) newRow.classList.add('selected');

        renderTelemetryDetails(selectedHex);
        ensureAircraftVisible(ac);
    } else {
        resetTelemetryDisplay();
    }
}

// Ensure selected aircraft is visible by adjusting the zoom level if it is off-screen, while keeping the center locked
function ensureAircraftVisible(ac) {
    if (!map) return;
    
    // Check if the aircraft is already within the visible map bounds
    try {
        if (map.getBounds().contains([ac.lat, ac.lon])) {
            return; // Already visible, no zoom change needed
        }
    } catch (e) {
        // Bounds not ready yet
    }

    // Calculate symmetric bounding box around home coordinates that includes the aircraft
    const dLat = Math.abs(ac.lat - HOME_LAT);
    const dLon = Math.abs(ac.lon - HOME_LON);
    const padding = 1.15; // 15% margin to prevent marker clipping at screen edges
    const bounds = L.latLngBounds(
        [HOME_LAT - dLat * padding, HOME_LON - dLon * padding],
        [HOME_LAT + dLat * padding, HOME_LON + dLon * padding]
    );

    // Get the maximum zoom level where this bounding box fits in the viewport
    const targetZoom = map.getBoundsZoom(bounds);
    
    // If the map is currently zoomed in past this target level, zoom out to make it visible
    if (map.getZoom() > targetZoom) {
        map.setZoom(targetZoom);
    }
}

function renderTelemetryDetails(hex) {
    const display = document.getElementById('telemetry-display');
    const ac = activeAircraft[hex];
    if (!ac) return;

    const headingText = getHeadingDirection(ac.track);

    display.innerHTML = `
        <div class="tel-row">
            <span class="tel-label">HEX ADDR:</span>
            <span class="tel-val">${ac.hex.toUpperCase()}</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">CALLSIGN:</span>
            <span class="tel-val">${ac.callsign}</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">REGISTRATION:</span>
            <span class="tel-val">${ac.reg}</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">AIRCRAFT MODEL:</span>
            <span class="tel-val">${ac.type} (${ac.desc})</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">ALTITUDE:</span>
            <span class="tel-val">${ac.alt ? formatNumber(ac.alt) : '0'} FT</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">GROUND SPEED:</span>
            <span class="tel-val">${ac.speed} KT</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">BEARING:</span>
            <span class="tel-val">${ac.track}° (${headingText})</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">RANGE DISTANCE:</span>
            <span class="tel-val">${ac.dist.toFixed(1)} NM</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">SQUAWK CODE:</span>
            <span class="tel-val">${ac.squawk}</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">CLASSIFICATION:</span>
            <span class="tel-val ${ac.mil ? 'alert' : ''}">${ac.mil ? 'MILITARY SECURE' : 'CIVILIAN AIR TRAFFIC'} (${(ac.iconType || 'jet').toUpperCase()})</span>
        </div>
    `;
}

function resetTelemetryDisplay() {
    const display = document.getElementById('telemetry-display');
    display.innerHTML = `<div class="empty-telemetry">NO TARGET ACQUIRED. SELECT A TARGET FROM THE RADAR SCREEN OR LIST PANEL.</div>`;
}

/* ==========================================================================
   HELPER MATHEMATICS & FORMATTERS
   ========================================================================== */

// Haversine formula to compute distance in Nautical Miles
function calcDistance(lat1, lon1, lat2, lon2) {
    const R = 3440.065; // Earth radius in NM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Calculate bearing from home to target (0 is North, clockwise)
function calcBearing(lat, lon) {
    const scaleLon = Math.cos(HOME_LAT * Math.PI / 180);
    const dx = (lon - HOME_LON) * scaleLon;
    const dy = lat - HOME_LAT;
    return (90 - Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
}

// Convert track degrees to standard cardinal compass directions
function getHeadingDirection(degrees) {
    const d = (degrees + 360) % 360;
    if (d >= 337.5 || d < 22.5) return 'N';
    if (d >= 22.5 && d < 67.5) return 'NE';
    if (d >= 67.5 && d < 112.5) return 'E';
    if (d >= 112.5 && d < 157.5) return 'SE';
    if (d >= 157.5 && d < 202.5) return 'S';
    if (d >= 202.5 && d < 247.5) return 'SW';
    if (d >= 247.5 && d < 292.5) return 'W';
    return 'NW';
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Escape HTML tags to prevent XSS injection from API payload inputs
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"'/`]/g, function (s) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '/': '&#x2F;',
            '`': '&#x60;'
        }[s];
    });
}

// Sanitize hex IDs for valid HTML attribute syntax and clean selectors (e.g. converting "~" to "_")
function sanitizeId(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}
