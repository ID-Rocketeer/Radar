
/*
 * Copyright (C) 2026 Steven P. Collins
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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

// Clamp latitude to Web Mercator limits and wrap longitude using modulo 360
HOME_LAT = Math.max(-85.05112878, Math.min(85.05112878, HOME_LAT));
HOME_LON = ((HOME_LON + 180) % 360 + 360) % 360 - 180;

// Validate and cap range. The Airplanes.live API limits point queries to 250 NM.
// We set a minimum query/ring range of 2 NM to maintain data density limits,
// although the visual map zoom is allowed to go closer (up to level 20).
if (isNaN(RANGE_NM)) {
    RANGE_NM = defaultRange;
} else {
    RANGE_NM = Math.max(2, Math.min(RANGE_NM, 250));
}

// Sync address bar URL with normalized coordinates on load
const initialNormalizedUrl = `${window.location.pathname}?lat=${HOME_LAT.toFixed(5)}&lon=${HOME_LON.toFixed(5)}&rng=${Math.round(RANGE_NM)}`;
window.history.replaceState({ path: initialNormalizedUrl }, '', initialNormalizedUrl);

const SWEEP_DURATION_MS = 10000; // 10s rotation cycle

// Map and tracking states
let map;
let homeMarker; // Reference to center crosshair marker
let sweepMarker; // Reference to rotating sweep center marker
let rangeRings = [];
let activeAircraft = {}; // Holds aircraft metadata and map instances
let selectedHex = null;
let trackedHex = null; // Currently tracked aircraft HEX address (Easter Egg)
let hexClickCount = 0; // Click counter for gesture activation
let lastHexClickTime = 0; // Click timestamp for gesture timeout
let activeFilter = 'all'; // 'all', 'mil', 'commercial', 'ga'
let trailsEnabled = true;
let lowAltitudeFilterEnabled = false; // Filter modifier for low-altitude targets
let maxTrailPoints = 15; // Dynamically scaled trail length limit
let targetListDomMap = {}; // Maps hex -> DOM element for target list reconciliation
let sweepEl = null; // Global reference to the sweep line DOM element
let sweepActive = true; // Flag to halt/resume sweep line rotation on connection errors
let pollIntervalId = null; // ID to track active polling interval
let activePollController = null; // Controller to abort in-flight API requests

// Location selection calibration states
let isSelectionMode = false;
let tempLat = HOME_LAT;
let tempLon = HOME_LON;
let tempRange = RANGE_NM;
let isProgrammaticChange = false;
let cachedDisplayedRange = RANGE_NM; // Cache to prevent layout thrashing from getBoundingClientRect()

// Global bearing-based index (360 buckets of Sets, one for each degree)
let bearingBuckets = Array.from({ length: 360 }, () => new Set());

function getBearingBucketIndex(bearing) {
    return Math.floor((bearing % 360 + 360) % 360);
}

function addAircraftToBearingIndex(hex, bearing) {
    const idx = getBearingBucketIndex(bearing);
    bearingBuckets[idx].add(hex);
}

function removeAircraftFromBearingIndex(hex, bearing) {
    const idx = getBearingBucketIndex(bearing);
    bearingBuckets[idx].delete(hex);
}

function updateAircraftBearingIndex(hex, oldBearing, newBearing) {
    const oldIdx = getBearingBucketIndex(oldBearing);
    const newIdx = getBearingBucketIndex(newBearing);
    if (oldIdx !== newIdx) {
        bearingBuckets[oldIdx].delete(hex);
        bearingBuckets[newIdx].add(hex);
    }
}

// Batching & scaling settings (Option B)
let sweepBatchSectorSize = 1; // Sector size in degrees (calculated dynamically based on aircraft count)
let lastCheckedAngle = 0; // Last angle where sweep checks were run

// SVG silhouettes for different aircraft classifications (optimized for 24x24 viewBox)
const AIRCRAFT_ICONS = {
    // Standard commercial airliner/medium-heavy jet
    jet: 'M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z',
    // Sleek delta-wing military fighter jet
    fighter: 'M12,2L14.5,10L22,12.5L14.5,14L13.5,19.5L15.5,21.5L12,21L8.5,21.5L10.5,19.5L9.5,14L2,12.5L9.5,10Z',
    // Light general aviation/propeller airplane (wide straight wings)
    light: 'M12,2A1,1 0 0,0 11,3V8.5L1,9.5V11.5L11,10.5V19L7.5,21.5V22.5L12,22L16.5,22.5V21.5L13,19V10.5L23,11.5V9.5L13,8.5V3A1,1 0 0,0 12,2Z',
    // Helicopter top-down view (rotors & tail spinner)
    helicopter: 'M12,6C13.7,6 14.8,7.5 14.8,10C14.8,12 13.5,14 12.8,16H11.2C10.5,14 9.2,12 9.2,10C9.2,7.5 10.3,6 12,6ZM2.7,3.3L20.7,21.3L21.3,20.7L3.3,2.7ZM20.7,2.7L2.7,20.7L3.3,21.3L21.3,3.3ZM12,9.8A1.2,1.2 0 1,1 12,12.2A1.2,1.2 0 1,1 12,9.8ZM11.6,16H12.4V22H11.6ZM9,19.7H15V20.3H9ZM9.7,19H10.3V23H9.7ZM10.3,21.2H11.6V21.8H10.3'
};

// === CodeRed Easter Egg: WWII Warbird Identification ===
// Military type designators for WWII-era fighters, bombers, patrol, and trainer aircraft.
// Only military designations qualify (e.g. C47 yes, DC3 no).
const WARBIRD_TYPE_CODES = new Set([
    // Lockheed Constellation. No it isn't a warbird, but if either of the two remaining flying examples is in the air I want to be able to highlight them.
    'CONI',
    // USAAF Fighters
    'P36', 'P38', 'P39', 'P40', 'P47', 'P51', 'P61', 'P63', 'P82',
    // USAAF Bombers & Attack
    'B17', 'B24', 'B25', 'B26', 'B29', 'A20', 'A26',
    // USAAF Trainers
    'AT6', 'T6', 'BT13', 'BT15', 'PT13', 'PT17', 'PT19', 'PT22', 'PT26',
    // Military Transport
    'C45', 'C46', 'C47', 'C53', 'C54', 'C60',
    // Fake cargo plane for testing purposes only
    // 'C402',
    // US Navy/Marine Fighters
    'F2A', 'F3F', 'F4F', 'FM1', 'FM2', 'F6F', 'F4U', 'FG1', 'F3A', 'F8F', 'F7F',
    // Navy Dive Bombers / Torpedo Bombers
    'SBD', 'SB2C', 'TBD', 'TBF', 'TBM',
    // Navy Patrol / Flying Boats
    'PBY', 'PBM', 'PBJ', 'PV1', 'PV2',
    // Navy Attack (Korea-era, WWII lineage)
    'AD', 'AD1', 'AD4', 'AD5', 'AD6', 'A1',
    // Navy Trainers
    'SNJ', 'N3N', 'SNV',
    // Royal Air Force / British
    'SPIT', 'HURR', 'HRCN', 'LANC', 'MOSQ', 'TEMP', 'TYPH',
    // Axis — German
    'ME09', 'BF09', 'ME62', 'FW90', 'JU52', 'JU87',
    // Axis — Japanese
    'ZERO', 'A6M',
    // Soviet
    'YAK3', 'YAK9', 'YK11', 'IL2', 'LA5', 'LA7', 'LA9'
]);

let warbirdModeActive = localStorage.getItem('codeRedActive') === 'true';

function isWarbird(ac) {
    if (!ac || !ac.type) return false;
    return WARBIRD_TYPE_CODES.has(ac.type.toUpperCase());
}

function isActiveWarbird(ac) {
    return warbirdModeActive && isWarbird(ac);
}

// Refresh warbird CSS classes on all existing markers, trails, and the target list
function refreshWarbirdStyling() {
    Object.keys(activeAircraft).forEach(hex => {
        const ac = activeAircraft[hex];
        const isWb = isActiveWarbird(ac);
        const safeHex = sanitizeId(hex);

        // Update marker DOM
        const markerDom = document.getElementById(`marker-${safeHex}`);
        if (markerDom) {
            markerDom.classList.toggle('warbird', isWb);
        }

        // Update trail SVG element
        if (ac.trail) {
            const trailEl = ac.trail.getElement ? ac.trail.getElement() : null;
            if (trailEl) {
                trailEl.classList.toggle('warbird', isWb);
            }
        }
    });

    // Toggle pilot indicator light
    const pilotLight = document.getElementById('codered-light');
    if (pilotLight) {
        pilotLight.classList.toggle('active', warbirdModeActive);
    }

    updateTargetList();
}

// Classifies the aircraft raw data into one of our custom icon categories
function getAircraftIconType(rawAc) {
    const category = (rawAc.category || '').toUpperCase();
    const typeCode = (rawAc.t || '').toUpperCase();
    const desc = (rawAc.desc || '').toUpperCase();
    const dbFlagsVal = rawAc.dbFlags !== undefined ? rawAc.dbFlags : rawAc.dbflags;
    const isMil = !!(rawAc.mil === 1 || rawAc.mil === true || (dbFlagsVal & 1) === 1);

    // 1. Helicopters (Category C1/A7, description contains helicopter manufacturers/keywords, common helicopter names, or helicopter type codes)
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
        desc.includes('CHINOOK') || 
        desc.includes('BLACK HAWK') || 
        desc.includes('BLACKHAWK') || 
        desc.includes('APACHE') || 
        desc.includes('SEAHAWK') || 
        desc.includes('HUEY') || 
        desc.includes('COBRA') || 
        desc.includes('SEA STALLION') || 
        desc.includes('SUPER STALLION') || 
        desc.includes('SEA KNIGHT') || 
        desc.includes('LITTLE BIRD') || 
        desc.includes('TILTROTOR') || 
        desc.includes('OSPREY') || 
        desc.includes('WESTLAND') || 
        typeCode.match(/^H\d{2}$/) || 
        typeCode.match(/^H\d$/) || 
        typeCode.startsWith('EC3') || 
        typeCode.startsWith('EC4') || 
        typeCode.startsWith('EC5') || 
        typeCode.startsWith('AS5') || 
        ['S76', 'S92', 'A139', 'R44', 'R22', 'R66', 'B06', 'B206', 'B212', 'B412', 'B429', 'B430', 'B407', 'B505', 'HU30', 'H500', 'UH1', 'V22', 'AS32', 'AS33', 'AS65', 'EC35', 'EC45', 'NH90', 'EH10', 'MI8', 'MI24'].includes(typeCode)
    );
    if (isHelicopter) {
        return 'helicopter';
    }

    // 2. Military Fighters / SLEEK jets (Category A4 = High Performance, military prefix types)
    if (isMil && (category === 'A4' || typeCode.startsWith('F-') || typeCode.startsWith('FA-') || typeCode.startsWith('A-') || ['F15', 'F16', 'F18', 'F22', 'F35', 'A10', 'T38', 'B1', 'B2', 'B52', 'C17', 'C130', 'KC135'].includes(typeCode))) {
        return 'fighter';
    }

    // 3. Light Aircraft / Propeller General Aviation / Turboprops / Warbirds
    const isPropeller = (
        category === 'A1' || 
        desc.includes('PISTON') || 
        desc.includes('PROP') || 
        desc.includes('PROPELLER') || 
        desc.includes('TURBOPROP') || 
        desc.includes('BIPLANE') || 
        desc.includes('WARBIRD') || 
        desc.includes('MITCHELL') || 
        desc.includes('MUSTANG') || 
        desc.includes('SPITFIRE') || 
        desc.includes('TEXAN') || 
        desc.includes('STEERMAN') || 
        desc.includes('HARVARD') || 
        desc.includes('CESSNA') || 
        desc.includes('PIPER') || 
        desc.includes('BEECHCRAFT') || 
        desc.includes('BONANZA') || 
        desc.includes('BARON') || 
        desc.includes('KING AIR') || 
        desc.includes('CARAVAN') || 
        desc.includes('CIRRUS') || 
        desc.includes('DIAMOND') || 
        desc.includes('MOONEY') || 
        desc.includes('PILATUS') || 
        desc.includes('DOUGLAS DC-3') || 
        desc.includes('DOUGLAS C-47') || 
        desc.includes('FLYING FORTRESS') || 
        desc.includes('SUPERFORTRESS') || 
        desc.includes('GLIDER') || 
        desc.includes('SAILPLANE') || 
        // Match specific common propeller ICAO type designators
        ['B25', 'B17', 'B29', 'P51', 'P47', 'P38', 'C172', 'C152', 'C182', 'C206', 'C208', 'C210', 'C310', 'PA28', 'PA32', 'PA34', 'PA44', 'PA46', 'BE33', 'BE35', 'BE36', 'BE55', 'BE58', 'BE9L', 'BE20', 'BE30', 'B350', 'SR20', 'SR22', 'DA40', 'DA42', 'DA62', 'M20', 'PC12', 'DH8A', 'DH8B', 'DH8C', 'DH8D', 'AT43', 'AT45', 'AT72', 'AT75', 'C47', 'DC3', 'DC4', 'DC6', 'DC7', 'T6', 'AN2', 'AN24', 'AN26', 'A29', 'T34'].includes(typeCode) ||
        // Van's RV kitplanes
        typeCode.match(/^RV\d+$/)
    );
    if (isPropeller) {
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
    
    if (latEl) {
        if (latEl.tagName === 'INPUT') latEl.value = HOME_LAT.toFixed(5);
        else latEl.innerText = HOME_LAT.toFixed(5);
    }
    if (lonEl) {
        if (lonEl.tagName === 'INPUT') lonEl.value = HOME_LON.toFixed(5);
        else lonEl.innerText = HOME_LON.toFixed(5);
    }
    if (rangeEl) {
        const rangeVal = getDisplayedRange();
        const formattedVal = rangeVal < 10 ? rangeVal.toFixed(3) : rangeVal.toFixed(1);
        if (rangeEl.tagName === 'INPUT') rangeEl.value = formattedVal;
        else rangeEl.innerText = `${formattedVal} NM`;
    }
}

function updateRadarCenter(newLat, newLon) {
    // 1. First run the migration pass on all active aircraft to prevent ghost planes
    Object.keys(activeAircraft).forEach(hex => {
        const ac = activeAircraft[hex];
        const distToNewCenter = calcDistance(newLat, newLon, ac.lat, ac.lon);

        if (distToNewCenter > RANGE_NM) {
            // Delete plane immediately if it falls out of the new scanning boundary
            if (ac.marker && map.hasLayer(ac.marker)) map.removeLayer(ac.marker);
            if (ac.trail && map.hasLayer(ac.trail)) map.removeLayer(ac.trail);
            removeAircraftFromBearingIndex(hex, ac.bearing);
            delete activeAircraft[hex];
        }
    });

    // 2. Set the new home coordinates
    HOME_LAT = newLat;
    HOME_LON = newLon;

    // 3. Update the index for remaining in-range planes relative to the new center coordinates
    Object.keys(activeAircraft).forEach(hex => {
        const ac = activeAircraft[hex];
        const oldBearing = ac.bearing;
        const newBearing = calcBearing(ac.lat, ac.lon);
        ac.bearing = newBearing;
        ac.dist = calcDistance(HOME_LAT, HOME_LON, ac.lat, ac.lon);

        // Migrate bearing indexes so sweep updates are precise
        removeAircraftFromBearingIndex(hex, oldBearing);
        addAircraftToBearingIndex(hex, newBearing);
    });

    // 4. Update UI input displays
    updateUIConfigurationValues();

    // 5. Reposition map view and console reticle markers
    map.setView([HOME_LAT, HOME_LON], map.getZoom(), { animate: false });
    if (homeMarker) homeMarker.setLatLng([HOME_LAT, HOME_LON]);
    if (sweepMarker) sweepMarker.setLatLng([HOME_LAT, HOME_LON]);

    // 6. Relocate all range rings to the new center
    rangeRings.forEach(ring => {
        ring.setLatLng([HOME_LAT, HOME_LON]);
    });

    // 7. Update URL parameters silently
    const newUrl = `${window.location.pathname}?lat=${HOME_LAT.toFixed(5)}&lon=${HOME_LON.toFixed(5)}&rng=${Math.round(RANGE_NM)}`;
    window.history.replaceState(null, '', newUrl);
}

function startPolling() {
    if (pollIntervalId) return; // Already polling
    pollFlightData();
}

function stopPolling() {
    if (pollIntervalId) {
        clearTimeout(pollIntervalId);
        pollIntervalId = null;
    }
    if (activePollController) {
        activePollController.abort();
        activePollController = null;
    }
}

function initParallaxGlare() {
    const glareReflection = document.getElementById('glass-glare-reflection');
    if (!glareReflection) return;

    window.addEventListener('mousemove', (e) => {
        // Calculate mouse position relative to center of window (-0.5 to 0.5)
        const x = (e.clientX / window.innerWidth) - 0.5;
        const y = (e.clientY / window.innerHeight) - 0.5;

        // Subtle shifting (max 15px translation in either direction)
        const moveX = x * 30;
        const moveY = y * 30;

        glareReflection.style.transform = `translate(${moveX}px, ${moveY}px) rotate(-15deg) scale(1.2)`;
    });
}

function initializeRadarSystem() {
    initMap();
    initControls();
    // Restore CodeRed pilot light if mode was persisted across page reload
    if (warbirdModeActive) {
        const pilotLight = document.getElementById('codered-light');
        if (pilotLight) pilotLight.classList.add('active');
    }
    updateUIConfigurationValues();
    startRadarSweep();
    initParallaxGlare();
    
    // Initial size and minimum zoom calculation
    setTimeout(() => {
        updateMinZoom();
        updateSweepSize();
        recalculateDisplayedRange();
        updateDisplayedRange();
    }, 100);

    // Start fetching data
    startPolling();

    // Listen for tab visibility changes to pause/resume polling
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPolling();
            const statusText = document.querySelector('.system-status .status-text');
            const indicator = document.querySelector('.status-indicator');
            if (statusText) statusText.innerText = "SYS_STATUS: STANDBY";
            if (indicator) indicator.classList.remove('active');
        } else {
            if (!isSelectionMode) {
                startPolling();
            }
        }
    });

    // Listen for browser navigation (Back/Forward) events to keep radar synced with address bar
    window.addEventListener('popstate', (e) => {
        const params = new URLSearchParams(window.location.search);
        const pLat = parseFloat(params.get('lat') || params.get('latitude'));
        const pLon = parseFloat(params.get('long') || params.get('longitude') || params.get('lon') || params.get('lng'));
        const pRng = parseFloat(params.get('range') || params.get('rng'));

        let changed = false;
        if (!isNaN(pLat) && pLat !== HOME_LAT) {
            HOME_LAT = pLat;
            changed = true;
        }
        if (!isNaN(pLon) && pLon !== HOME_LON) {
            HOME_LON = pLon;
            changed = true;
        }
        if (!isNaN(pRng) && pRng !== RANGE_NM) {
            RANGE_NM = Math.max(2, Math.min(pRng, 250));
            changed = true;
        }

        if (changed) {
            // Update sidebar configuration display elements
            updateUIConfigurationValues();
            
            // Relocate markers and map view
            map.setView([HOME_LAT, HOME_LON]);
            if (homeMarker) homeMarker.setLatLng([HOME_LAT, HOME_LON]);
            if (sweepMarker) sweepMarker.setLatLng([HOME_LAT, HOME_LON]);

            // Reset zoom snap and snap the zoom level to match the new range ring diameter
            initialZoomSet = false;
            updateMinZoom();
            updateSweepSize();
            updateDisplayedRange();

            // Redraw and lock range rings
            const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
            rangeRings.forEach((ring, idx) => {
                const factor = ringFactors[idx] || 1.0;
                ring.setLatLng([HOME_LAT, HOME_LON]);
                ring.setRadius(factor * RANGE_NM * 1852);
            });

            // Clear active target tracking registry and bearings, and start fresh
            Object.values(activeAircraft).forEach(ac => {
                if (ac.marker && map.hasLayer(ac.marker)) map.removeLayer(ac.marker);
                if (ac.trail && map.hasLayer(ac.trail)) map.removeLayer(ac.trail);
            });
            activeAircraft = {};
            bearingBuckets = Array.from({ length: 360 }, () => new Set());
            selectedHex = null;
            resetTelemetryDisplay();

            // Refresh list and poll new location
            updateTargetList();
            pollFlightData();
        }
    });
}

async function getIPLocation() {
    // Try ipwho.is first (extremely CORS/HTTPS friendly and keyless)
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout guard
        const response = await fetch('https://ipwho.is/', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
            const data = await response.json();
            if (data && data.success && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
                return { lat: data.latitude, lon: data.longitude };
            }
        }
    } catch (e) {
        console.warn("Silent ipwho.is lookup failed, trying fallback.", e);
    }

    // Try ipapi.co as secondary fallback
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout guard
        const response = await fetch('https://ipapi.co/json/', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
            const data = await response.json();
            if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
                return { lat: data.latitude, lon: data.longitude };
            }
        }
    } catch (e) {
        console.warn("Silent ipapi.co fallback failed.", e);
    }

    return null;
}

async function autoDetectLocationAndInit() {
    const hasLat = urlParams.has('lat') || urlParams.has('latitude');
    const hasLon = urlParams.has('long') || urlParams.has('longitude') || urlParams.has('lon') || urlParams.has('lng');

    if (!hasLat || !hasLon) {
        const coords = await getIPLocation();
        if (coords) {
            HOME_LAT = Math.max(-85.05112878, Math.min(85.05112878, coords.lat));
            HOME_LON = ((coords.lon + 180) % 360 + 360) % 360 - 180;
            
            // Update URL silently to reflect IP location
            const newUrl = `${window.location.pathname}?lat=${HOME_LAT.toFixed(5)}&lon=${HOME_LON.toFixed(5)}&rng=${Math.round(RANGE_NM)}`;
            window.history.replaceState(null, '', newUrl);
        }
    }

    // Now initialize the radar system
    initializeRadarSystem();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', autoDetectLocationAndInit);
} else {
    autoDetectLocationAndInit();
}

// Monitor actual DOM element size changes using ResizeObserver to ensure 
// Leaflet updates its size cache and projections only after the browser has completed layout reflow.
const mapEl = document.getElementById('map');
if (mapEl) {
    const resizeObserver = new ResizeObserver(() => {
        if (map) {
            if (isProgrammaticChange) return;
            isProgrammaticChange = true;
            try {
                map.invalidateSize({ panTo: isSelectionMode });
                if (!isSelectionMode) {
                    map.setView([HOME_LAT, HOME_LON], map.getZoom(), { animate: false });
                }
                updateMinZoom();
                updateSweepSize();
                recalculateDisplayedRange();
                updateDisplayedRange();
            } finally {
                isProgrammaticChange = false;
            }
        }
    });
    resizeObserver.observe(mapEl);
}

/* ==========================================================================
   MAP SETUP
   ========================================================================== */
function initMap() {
    // Initialize map with zoom limits and hide default controls for a clean screen
    // Keep map center locked on Home coordinates, zoom centered on Home
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        dragging: false,
        scrollWheelZoom: 'center',
        touchZoom: 'center',
        zoomSnap: 0, // Enable smooth fractional zoom levels
        zoomDelta: 0.5 // Set zoom buttons step size
    }).setView([HOME_LAT, HOME_LON], 8); // Start at zoom 8 (which is safe and covers bezel)

    // Create isolated pane for the sweep line as a child of mapPane to ensure it translates and scales in sync
    map.createPane('sweepPane', map.getPane('mapPane'));
    map.getPane('sweepPane').style.zIndex = 450;

    // Load CartoDB Dark Matter tile layer
    // The CSS filter in index.css will transform these dark-grayscale tiles into a bright retro-green screen
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 20,
        minZoom: 0
    }).addTo(map);

    // Draw range rings around home location (1 NM = 1852 meters)
    const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
    ringFactors.forEach(factor => {
        const distance = factor * RANGE_NM;
        const ring = L.circle([HOME_LAT, HOME_LON], {
            radius: distance * 1852,
            color: '#00ff55',
            weight: 1,
            opacity: 0.35,
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
    homeMarker = L.marker([HOME_LAT, HOME_LON], { icon: homeIcon, interactive: false }).addTo(map);


    document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn());
    document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut());



    // Map movement and zoom completion lifecycle listener
    map.on('moveend zoomend', () => {
        if (isProgrammaticChange) return;
        isProgrammaticChange = true;
        try {
            if (!isSelectionMode) {
                const center = map.getCenter();
                if (Math.abs(center.lat - HOME_LAT) > 0.00001 || Math.abs(center.lng - HOME_LON) > 0.00001) {
                    map.setView([HOME_LAT, HOME_LON], map.getZoom(), { animate: false });
                }
            }
            updateMinZoom();
            updateSweepSize();
            updateMapMarkersVisibility();
            recalculateDisplayedRange();
            updateDisplayedRange();
        } finally {
            isProgrammaticChange = false;
        }
    });
}

/* ==========================================================================
   UI CONTROLS & LISTENERS
   ========================================================================== */
function initControls() {
    // Prevent long-press context menus across the entire application (bezel, sidebar, map, etc.)
    // We use the capturing phase (true) to intercept the event before Leaflet blocks propagation.
    window.addEventListener('contextmenu', (e) => e.preventDefault(), true);


    // Flight Trails Toggle Button
    const trailBtn = document.getElementById('trail-toggle');
    trailBtn.addEventListener('click', () => {
        trailsEnabled = !trailsEnabled;
        trailBtn.classList.toggle('active', trailsEnabled);
        
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

    // Low Altitude Filter Toggle Button
    const lowAltitudeBtn = document.getElementById('low-altitude-toggle');
    if (lowAltitudeBtn) {
        lowAltitudeBtn.addEventListener('click', () => {
            lowAltitudeFilterEnabled = !lowAltitudeFilterEnabled;
            lowAltitudeBtn.classList.toggle('active', lowAltitudeFilterEnabled);

            // Update visibility of all current markers
            Object.keys(activeAircraft).forEach(hex => {
                updateMarkerVisibility(hex);
            });

            // Recalculate visible count and dynamic scaling limits instantly
            let visibleCount = 0;
            Object.keys(activeAircraft).forEach(hex => {
                const ac = activeAircraft[hex];
                if (!ac.pendingRemoval && ac.visible) {
                    visibleCount++;
                }
            });

            if (visibleCount > 300) {
                maxTrailPoints = 20;
            } else if (visibleCount > 100) {
                maxTrailPoints = 60;
            } else {
                maxTrailPoints = 120;
            }

            sweepBatchSectorSize = Math.max(1, Math.floor((visibleCount + 360) / 360));

            // Instantly apply trail length constraint to active trails
            Object.values(activeAircraft).forEach(ac => {
                if (ac.trail) {
                    const latlngs = ac.trail.getLatLngs();
                    if (latlngs.length > maxTrailPoints) {
                        latlngs.splice(0, latlngs.length - maxTrailPoints);
                        ac.trail.setLatLngs(latlngs);
                    }
                }
            });

            // Refresh target list sidebar
            updateTargetList();
        });
    }

    // Fullscreen Toggle Button
    const fullscreenBtn = document.getElementById('fullscreen-toggle');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                const docEl = document.documentElement;
                if (docEl.requestFullscreen) {
                    docEl.requestFullscreen();
                } else if (docEl.webkitRequestFullscreen) {
                    docEl.webkitRequestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                }
            }
        });
    }

    function updateFullscreenUI() {
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (fullscreenBtn) {
            fullscreenBtn.classList.toggle('active', isFullscreen);
        }
        if (map) {
            setTimeout(() => {
                map.invalidateSize();
                updateMinZoom();
                updateSweepSize();
                updateDisplayedRange();
            }, 100);
        }
    }

    document.addEventListener('fullscreenchange', updateFullscreenUI);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUI);
    updateFullscreenUI();

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

    // Help Modal Operations Manual Handler
    const helpBtn = document.getElementById('help-btn');
    const helpModal = document.getElementById('help-modal');
    const helpClose = document.getElementById('help-close');

    if (helpBtn && helpModal) {
        helpBtn.addEventListener('click', () => {
            // Update current range ring values dynamically in help modal
            const factors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
            factors.forEach((factor, idx) => {
                const ringValEl = document.getElementById(`ring-val-${idx + 1}`);
                if (ringValEl) {
                    const ringDist = factor * RANGE_NM;
                    ringValEl.innerText = ringDist < 10 ? ringDist.toFixed(3) : ringDist.toFixed(1);
                }
            });

            helpModal.style.display = 'flex';
            // Trigger reflow to apply CSS transitions
            void helpModal.offsetWidth;
            helpModal.classList.add('active');
        });
    }

    const closeHelp = () => {
        if (helpModal) {
            helpModal.classList.remove('active');
            // Wait for transition to complete before setting display to none
            setTimeout(() => {
                if (!helpModal.classList.contains('active')) {
                    helpModal.style.display = 'none';
                }
            }, 300);
        }
    };

    if (helpClose) {
        helpClose.addEventListener('click', closeHelp);
    }

    if (helpModal) {
        helpModal.addEventListener('click', (e) => {
            if (e.target === helpModal) {
                closeHelp();
            }
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeHelp();
        }
    });

    // === CodeRed Easter Egg: Scope screw pointerdown sequence handler ===
    // Detect touch-capable devices dynamically upon first touch to enable target expansion
    window.addEventListener('touchstart', function onFirstTouch() {
        document.body.classList.add('touch-enabled');
        window.removeEventListener('touchstart', onFirstTouch);
    }, { passive: true });

    const activationSequence = ['s0', 's135', 's270', 's45', 's180', 's315', 's90', 's225'];
    let eggClicks = [];
    let eggStartTime = 0;
    let lastScrewClicks = {}; // Debounce timestamp registry for screws

    function getScrewPosition(el) {
        const positions = ['s0', 's45', 's90', 's135', 's180', 's225', 's270', 's315'];
        return positions.find(cls => el.classList.contains(cls)) || null;
    }

    document.querySelectorAll('.scope-screw').forEach(screw => {
        // Dynamically append touch expander target
        const touchTarget = document.createElement('div');
        touchTarget.className = 'screw-touch-target';
        screw.appendChild(touchTarget);

        screw.addEventListener('pointerdown', (e) => {
            // Stop propagation and prevent default so mobile map dragging does not cancel the click
            e.preventDefault();
            e.stopPropagation();

            // When active, screws ignore sequence clicks
            if (warbirdModeActive) return;

            const pos = getScrewPosition(screw);
            if (!pos) return;

            const now = Date.now();

            // Debounce: discard clicks on the same screw within 300ms (filtering stylus tip bounce/tremor)
            if (lastScrewClicks[pos] && (now - lastScrewClicks[pos] < 300)) {
                return;
            }
            lastScrewClicks[pos] = now;

            // Activation: 8-screw sequence within 20 seconds
            if (eggClicks.length === 0 || now - eggStartTime > 20000) {
                eggClicks = [];
                eggStartTime = now;
            }
            if (pos === activationSequence[eggClicks.length]) {
                eggClicks.push(pos);
                if (eggClicks.length === activationSequence.length) {
                    warbirdModeActive = true;
                    localStorage.setItem('codeRedActive', 'true');
                    eggClicks = [];
                    refreshWarbirdStyling();
                }
            } else {
                // Wrong screw — reset, but if this screw is the start of the sequence, begin fresh
                eggClicks = [];
                eggStartTime = now;
                if (pos === activationSequence[0]) {
                    eggClicks.push(pos);
                }
            }
        });
    });

    // === CodeRed Easter Egg: Pilot light deactivation handler ===
    const pilotLight = document.getElementById('codered-light');
    if (pilotLight) {
        // Dynamically append touch expander target for mobile/tablet usability
        const touchTarget = document.createElement('div');
        touchTarget.className = 'screw-touch-target';
        pilotLight.appendChild(touchTarget);

        let deactClicks = [];
        let deactStartTime = 0;
        let lastLightClick = 0;

        pilotLight.addEventListener('pointerdown', (e) => {
            // Only deactivate if CodeRed is active
            if (!warbirdModeActive) return;

            e.preventDefault();
            e.stopPropagation();

            const now = Date.now();

            // Debounce: filter stylus tip bounce (ignore events within 300ms)
            if (now - lastLightClick < 300) {
                return;
            }
            lastLightClick = now;

            // Triple click within 5 seconds to deactivate
            if (deactClicks.length === 0 || now - deactStartTime > 5000) {
                deactClicks = [now];
                deactStartTime = now;
            } else {
                deactClicks.push(now);
            }

            if (deactClicks.length >= 3) {
                warbirdModeActive = false;
                localStorage.setItem('codeRedActive', 'false');
                deactClicks = [];
                refreshWarbirdStyling();
            }
        });
    }

    initLocationSelection();
}



// Helper to get the exact rendered width of the scope bezel rim from the DOM,
// falling back to viewport-based calculations if the DOM is not fully ready yet.
function getBezelDiameter() {
    const rimEl = document.querySelector('.radar-scope-bezel');
    if (rimEl) {
        const rect = rimEl.getBoundingClientRect();
        if (rect.width > 0) {
            return rect.width;
        }
    }
    if (window.innerWidth <= 768) {
        return Math.min(window.innerHeight * 0.54, window.innerWidth * 0.92);
    } else {
        const sidebarWidth = window.innerHeight <= 980 ? 380 : 480;
        return Math.min(window.innerHeight * 0.95, (window.innerWidth - sidebarWidth) * 0.95);
    }
}

let initialZoomSet = false;

// Dynamically adjust map's minZoom level to ensure the range ring always fills the visible bezel viewport
function updateMinZoom() {
    if (!map) return;
    
    try {
        const minZoomVal = getZoomForRange(RANGE_NM);
        const snappedMinZoom = isSelectionMode ? 0 : minZoomVal;
        const currentZoom = map.getZoom();
        const currentMinZoom = map.getMinZoom();
        const isAtMinZoom = Math.abs(currentZoom - currentMinZoom) < 0.05;
        
        // Only update minZoom if it has changed by more than 0.001
        if (Math.abs(currentMinZoom - snappedMinZoom) > 0.001) {
            map.setMinZoom(snappedMinZoom);
        }
        
        // Always force initial load to start at the maximum configured range zoom level (disable transition animation to snap instantly)
        // If the window is resized or layout reflows while at minZoom, adjust the zoom to the new minZoomVal automatically
        if (!isSelectionMode) {
            if (!initialZoomSet || (isAtMinZoom && Math.abs(currentZoom - minZoomVal) > 0.001) || currentZoom < minZoomVal) {
                map.setView([HOME_LAT, HOME_LON], minZoomVal, { animate: false });
                initialZoomSet = true;
            }
        }
    } catch (e) {
        console.error("Error in updateMinZoom:", e);
    }
}

// Dynamically adjust the sweep line dimension and cull range rings to prevent SVG rendering bottlenecks at deep zooms
function updateSweepSize() {
    if (!map) return;
    if (!sweepEl || !document.body.contains(sweepEl)) {
        sweepEl = document.getElementById('sweep-line');
    }
    if (!sweepEl) return;

    const rangeMeters = RANGE_NM * 1852; // Configured range in meters
    const centerLatLng = L.latLng(HOME_LAT, HOME_LON);
    const R = 6378137;
    const dLon = rangeMeters / (R * Math.cos(Math.PI * HOME_LAT / 180));
    const destLatLng = L.latLng(HOME_LAT, HOME_LON + dLon * 180 / Math.PI);
    
    try {
        const centerPoint = map.latLngToLayerPoint(centerLatLng);
        const destPoint = map.latLngToLayerPoint(destLatLng);
        let radiusPx = centerPoint.distanceTo(destPoint);
        
        // Measure exact bezel rim size to determine boundaries
        const bezelDiameter = getBezelDiameter();
        const maxVisibleRadius = bezelDiameter * 0.5;

        // Clamp sweep line radius to the bezel radius to prevent massive (e.g. 6,000,000px) animating DOM elements
        const sweepRadius = Math.min(radiusPx, maxVisibleRadius);
        
        sweepEl.style.width = `${sweepRadius * 2}px`;
        sweepEl.style.height = `${sweepRadius * 2}px`;
        sweepEl.style.marginLeft = `${-sweepRadius}px`;
        sweepEl.style.marginTop = `${-sweepRadius}px`;

        // Cull range rings that are completely outside the visible bezel to avoid SVG rendering slowdowns
        if (rangeRings && rangeRings.length > 0) {
            const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
            rangeRings.forEach((ring, idx) => {
                const factor = ringFactors[idx] || 1.0;
                const ringRadiusMeters = factor * RANGE_NM * 1852;
                const dLonRing = ringRadiusMeters / (R * Math.cos(Math.PI * HOME_LAT / 180));
                const ringEdgeLatLng = L.latLng(HOME_LAT, HOME_LON + dLonRing * 180 / Math.PI);
                const ringEdgePoint = map.latLngToLayerPoint(ringEdgeLatLng);
                const ringRadiusPx = centerPoint.distanceTo(ringEdgePoint);

                if (ringRadiusPx > maxVisibleRadius + 10) {
                    if (map.hasLayer(ring)) {
                        map.removeLayer(ring);
                    }
                } else {
                    if (!map.hasLayer(ring)) {
                        ring.addTo(map);
                    }
                }
            });
        }
    } catch (e) {
        console.error("Error in updateSweepSize:", e);
    }
}

// Recalculates and caches the currently displayed range in NM based on the map zoom and bezel diameter.
// Call this function ONLY when the map size, zoom, or center changes, avoiding forced reflows in rendering loops.
function recalculateDisplayedRange() {
    if (!map) return;
    try {
        const centerLatLng = map.getCenter();
        const centerPoint = map.latLngToLayerPoint(centerLatLng);
        const bezelDiameter = getBezelDiameter();
        const visibleRadiusPx = bezelDiameter * 0.47;
        const edgeLatLng = map.layerPointToLatLng([centerPoint.x + visibleRadiusPx, centerPoint.y]);
        let displayedRange = calcDistance(centerLatLng.lat, centerLatLng.lng, edgeLatLng.lat, edgeLatLng.lng);
        
        if (!isSelectionMode && Math.abs(map.getZoom() - map.getMinZoom()) < 0.05) {
            displayedRange = RANGE_NM;
        }
        cachedDisplayedRange = displayedRange;
    } catch (e) {
        cachedDisplayedRange = RANGE_NM;
    }
}

// Helper to get the cached displayed range in O(1) time
function getDisplayedRange() {
    return cachedDisplayedRange;
}

// Dynamically calculate and report the physical range currently displayed at the visible bezel edge
function updateDisplayedRange() {
    const rangeEl = document.getElementById('val-range');
    if (!rangeEl) return;
    
    // Always display the actual visual range from the map
    const rangeVal = getDisplayedRange();
    const formattedVal = rangeVal < 10 ? rangeVal.toFixed(3) : rangeVal.toFixed(1);
    
    if (rangeEl.tagName === 'INPUT') {
        if (document.activeElement !== rangeEl) {
            rangeEl.value = formattedVal;
        }
    } else {
        rangeEl.innerText = `${formattedVal} NM`;
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
    sweepMarker = L.marker([HOME_LAT, HOME_LON], { icon: sweepIcon, interactive: false, pane: 'sweepPane' }).addTo(map);

    let lastTime = null;
    let currentAngle = 0;

    // Update sweep size on map zoom completion and view reset
    map.on('zoomend viewreset', updateSweepSize);

    function animate(timestamp) {
        if (lastTime === null) {
            lastTime = timestamp;
            requestAnimationFrame(animate);
            return;
        }

        const dt = timestamp - lastTime;
        lastTime = timestamp;

        // Check if cached sweep line element is null or has been detached by Leaflet (e.g., on zoom/pan)
        if (!sweepEl || !document.body.contains(sweepEl)) {
            sweepEl = document.getElementById('sweep-line');
            updateSweepSize(); // Recalculate dimensions on recreation
        }

        if (!sweepActive) {
            if (sweepEl) {
                sweepEl.style.display = 'none';
            }
            requestAnimationFrame(animate);
            return;
        } else {
            if (sweepEl) {
                sweepEl.style.display = 'block';
            }
        }

        // Clamp delta time to sweep duration to prevent giant jumps when tab wakes up
        const clampedDt = Math.min(dt, SWEEP_DURATION_MS);

        // Calculate sweep increment based on delta time
        const deltaAngle = (clampedDt / SWEEP_DURATION_MS) * 360;
        const nextAngle = currentAngle + deltaAngle; // Grow continuously to prevent browser compositor matrix resets

        // Update sweep rotation visually
        if (sweepEl) {
            sweepEl.style.transform = `translateZ(0) rotate(${nextAngle}deg)`;
        }

        // Check which aircraft are passed over by the radar beam during this frame (using modulo angles)
        checkSweptAircraft(currentAngle % 360, nextAngle % 360);

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
    
    // Find all integer degrees between prevAngle and currentAngle (handling wrap-around)
    const start = Math.floor(prevAngle);
    const end = Math.floor(currentAngle);
    
    let degreesToCheck = [];
    let d = start;
    while (d !== end) {
        degreesToCheck.push(d);
        d = (d + 1) % 360;
    }
    degreesToCheck.push(end); // Include the end degree
    
    let needsTargetListUpdate = false;
    
    degreesToCheck.forEach(deg => {
        const hexes = bearingBuckets[deg];
        if (hexes) {
            // Copy to array to avoid mutation issues if triggerAircraftSweep deletes aircraft
            const hexList = Array.from(hexes);
            hexList.forEach(hex => {
                const ac = activeAircraft[hex];
                if (!ac) return;
                
                const sweepBearing = ac.pendingUpdate ? ac.pendingUpdate.bearing : ac.bearing;
                const angleDiff = (sweepBearing - prevAngle + 360) % 360;
                
                if (angleDiff <= sweepDiff) {
                    const listChanged = triggerAircraftSweep(hex);
                    if (listChanged) {
                        needsTargetListUpdate = true;
                    }
                }
            });
        }
    });

    if (needsTargetListUpdate) {
        updateTargetList();
    }
}

/* ==========================================================================
   AIRCRAFT UPDATE ON SWEEP PASS
   ========================================================================== */
function triggerAircraftSweep(hex) {
    const ac = activeAircraft[hex];
    if (!ac) return false;

    const safeHex = sanitizeId(hex);

    // If this target is pending removal, delete it when the sweep line passes over its last bearing
    if (ac.pendingRemoval) {
        if (ac.marker && map.hasLayer(ac.marker)) {
            map.removeLayer(ac.marker);
        }
        if (ac.trail && map.hasLayer(ac.trail)) {
            map.removeLayer(ac.trail);
        }
        
        const activeBearing = ac.pendingUpdate ? ac.pendingUpdate.bearing : ac.bearing;
        removeAircraftFromBearingIndex(hex, activeBearing);
        delete activeAircraft[hex];
        
        if (selectedHex === hex) {
            selectedHex = null;
            resetTelemetryDisplay();
        }
        
        return true; // Reconcile list DOM and update target count after all frame processing completes
    }

    let needsListUpdate = false;

    // Enable visibility and lazy-create marker if this is its first sweep
    if (!ac.sweptOnce) {
        ac.sweptOnce = true;
        updateMarkerVisibility(hex);
        needsListUpdate = true; // Update the sidebar list after all frame processing completes
    }

    const hasPending = ac.pendingUpdate !== null;

    // If new data arrived, apply the update precisely at the moment of the sweep pass
    if (hasPending) {
        const update = ac.pendingUpdate;
        
        // Optimization: check if coordinate or track actually changed to prevent redundant DOM updates
        const coordChanged = ac.lat !== update.lat || ac.lon !== update.lon;
        const trackChanged = ac.track !== update.track;

        ac.lat = update.lat;
        ac.lon = update.lon;
        ac.alt = update.alt;
        ac.isOnGround = update.isOnGround;
        ac.speed = update.speed;
        ac.track = update.track;
        ac.seen = update.seen;
        ac.dist = update.dist;
        ac.bearing = update.bearing;

        // Update marker position and visibility on map
        if (coordChanged) {
            updateMarkerVisibility(hex);
            
            // Easter Egg: Active Target Tracking lock-on centering
            if (trackedHex === hex) {
                updateRadarCenter(ac.lat, ac.lon);
            }
        }
        
        // Update SVG icon rotation only if track changed
        if (trackChanged) {
            const markerDom = document.getElementById(`marker-${safeHex}`);
            const iconSvg = markerDom ? markerDom.querySelector('.aircraft-icon') : null;
            if (iconSvg) {
                iconSvg.style.transform = `rotate(${ac.track}deg)`;
            }
        }

        // Update trail polyline if it is currently rendered AND coordinates changed to a non-duplicate
        if (ac.trail && trailsEnabled && coordChanged) {
            const latlngs = ac.trail.getLatLngs();
            const lastLatLng = latlngs.length > 0 ? latlngs[latlngs.length - 1] : null;
            const isDuplicate = lastLatLng && lastLatLng.lat === ac.lat && lastLatLng.lng === ac.lon;
            
            if (!isDuplicate) {
                ac.trail.addLatLng([ac.lat, ac.lon]);
                // Keep trail length constrained to dynamic maxTrailPoints limit (using splice to prune old points instantly)
                if (latlngs.length > maxTrailPoints) {
                    latlngs.splice(0, latlngs.length - maxTrailPoints);
                    ac.trail.setLatLngs(latlngs);
                }
            }
        }

        ac.pendingUpdate = null;
    }

    // Trigger opacity flash excitation state (reflow-free, GPU compositor only)
    const markerDom = document.getElementById(`marker-${safeHex}`);
    if (markerDom) {
        markerDom.classList.add('swept-flash');
        setTimeout(() => {
            markerDom.classList.remove('swept-flash');
        }, 200);
    }

    // If this plane is currently selected, refresh telemetry details dynamically
    if (selectedHex === hex) {
        renderTelemetryDetails(hex);
    }

    // Refresh telemetry values in the sidebar list for this plane only if they changed to prevent layout thrashing
    const rowEl = document.getElementById(`row-${safeHex}`);
    if (rowEl && rowEl.children.length >= 4) {
        const altText = ac.isOnGround ? 'GND' : (ac.alt ? formatNumber(ac.alt) : '0');
        const spdText = ac.speed ? ac.speed.toString() : '0';
        const distVal = ac.dist;
        const dstText = distVal < 10 ? distVal.toFixed(3) : distVal.toFixed(1);

        const altEl = rowEl.children[1];
        const spdEl = rowEl.children[2];
        const dstEl = rowEl.children[3];

        if (altEl && altEl.textContent !== altText) altEl.textContent = altText;
        if (spdEl && spdEl.textContent !== spdText) spdEl.textContent = spdText;
        if (dstEl && dstEl.textContent !== dstText) dstEl.textContent = dstText;
    }

    return needsListUpdate;
}

/* ==========================================================================
   API DATA RETRIEVAL (AIRPLANES.LIVE)
   ========================================================================== */
function pollFlightData() {
    if (pollIntervalId) {
        clearTimeout(pollIntervalId);
        pollIntervalId = null;
    }
    if (activePollController) {
        activePollController.abort();
    }
    activePollController = new AbortController();
    const signal = activePollController.signal;

    const url = `https://api.airplanes.live/v2/point/${HOME_LAT}/${HOME_LON}/${RANGE_NM}`;
    
    fetch(url, { signal })
        .then(res => {
            if (!res.ok) throw new Error("API Connection Failed");
            return res.json();
        })
        .then(data => {
            activePollController = null;
            processAPIResponse(data);
            
            // Calculate delay to hit 1.5 seconds after the next 10s server boundary
            const serverNow = data.now; // Server epoch ms
            const localNow = Date.now();
            
            let delay = 10000; // Default fallback to 10s
            if (typeof serverNow === 'number' && !isNaN(serverNow)) {
                const clockOffset = serverNow - localNow;
                const nextServerTick = Math.ceil(serverNow / 10000) * 10000 + 1500;
                const targetLocalTime = nextServerTick - clockOffset;
                delay = Math.max(1000, targetLocalTime - Date.now()); // Clamped min 1s
            }
            
            // Schedule the next poll recursively
            pollIntervalId = setTimeout(pollFlightData, delay);
        })
        .catch(err => {
            if (err.name === 'AbortError') return; // Ignore programmatic aborts
            activePollController = null;
            console.error("Fetch Error:", err);
            sweepActive = false; // Shut off sweep line on link error
            // Glitch header effect in case of connection errors
            const titleEl = document.querySelector('.system-status .status-text');
            if (titleEl) {
                titleEl.innerText = "SYS_STATUS: LINK ERROR";
                document.querySelector('.status-indicator').classList.remove('active');
            }
            
            // Schedule fallback poll in 10 seconds
            pollIntervalId = setTimeout(pollFlightData, 10000);
        });
}

function processAPIResponse(data) {
    if (isSelectionMode) return;
    sweepActive = true; // Resume sweep line rotation
    // Reset status elements to Online
    const statusText = document.querySelector('.system-status .status-text');
    const indicator = document.querySelector('.status-indicator');
    if (statusText) statusText.innerText = "SYS_STATUS: SCANNING";
    if (indicator) indicator.classList.add('active');

    const freshHexes = new Set();
    const aircraftList = data.ac || [];

    // Dynamically scale trail length limit based on current airspace density
    const apiCount = aircraftList.length;
    if (apiCount > 300) {
        maxTrailPoints = 20;  // High traffic: contract trails to prevent lag and clutter
    } else if (apiCount > 100) {
        maxTrailPoints = 60;  // Medium traffic: moderate detail trails
    } else {
        maxTrailPoints = 120; // Low traffic: long, high-resolution trails (up to 10 mins of history)
    }

    aircraftList.forEach(rawAc => {
        const hex = rawAc.hex;
        if (!hex) return;

        // Escape outside data immediately at the ingestion level and normalize casing
        const cleanHex = escapeHtml(hex).toLowerCase();
        freshHexes.add(cleanHex);

        // Normalize basic telemetry
        const lat = parseFloat(rawAc.lat);
        const lon = parseFloat(rawAc.lon);
        if (isNaN(lat) || isNaN(lon)) return; // Ignore planes without coordinates

        const rawCallsign = (rawAc.flight || rawAc.r || hex).trim();
        const callsign = escapeHtml(rawCallsign);
        const isOnGround = rawAc.alt_baro === 'ground' || rawAc.alt_geom === 'ground' || rawAc.ground === true || rawAc.ground === 1;
        const alt = isOnGround ? 0 : Number(rawAc.alt_baro || rawAc.alt_geom || 0);
        const speed = Number(rawAc.gs || rawAc.ias || rawAc.tas || 0);
        const track = Number(rawAc.track || 0);
        const seen = Number(rawAc.seen || 0);
        
        // Classify military targets: standard 'mil' flag or Category D/Military type flags
        const dbFlagsVal = rawAc.dbFlags !== undefined ? rawAc.dbFlags : rawAc.dbflags;
        const isMil = !!(rawAc.mil === 1 || rawAc.mil === true || (dbFlagsVal & 1) === 1);

        const currentDistance = calcDistance(HOME_LAT, HOME_LON, lat, lon);
        if (currentDistance > RANGE_NM) return;

        // If aircraft is already tracked in local state
        if (activeAircraft[cleanHex]) {
            const ac = activeAircraft[cleanHex];
            ac.pendingRemoval = false; // Reset removal flag if it is back in range/broadcast
            
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
            const oldActiveBearing = ac.pendingUpdate ? ac.pendingUpdate.bearing : ac.bearing;
            const newActiveBearing = calcBearing(lat, lon);
            updateAircraftBearingIndex(cleanHex, oldActiveBearing, newActiveBearing);

            ac.pendingUpdate = {
                lat: lat,
                lon: lon,
                alt: alt,
                isOnGround: isOnGround,
                speed: speed,
                track: track,
                seen: seen,
                bearing: newActiveBearing, // Precompute the new bearing!
                dist: currentDistance
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
                isOnGround: isOnGround,
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
                pendingUpdate: null,
                pendingRemoval: false,
                sweptOnce: false
            };
            addAircraftToBearingIndex(cleanHex, activeAircraft[cleanHex].bearing);
        }

        // Dynamically update marker creation/visibility (includes viewport bounds checking)
        updateMarkerVisibility(cleanHex);
    });

    // Flag aircraft that are no longer in range or not broadcasted by the API for removal
    Object.keys(activeAircraft).forEach(hex => {
        const ac = activeAircraft[hex];
        if (!freshHexes.has(hex) || ac.seen > 60) {
            ac.pendingRemoval = true;
        }
    });

    // Calculate visible aircraft count under the current filter and viewport constraints
    let visibleCount = 0;
    Object.keys(activeAircraft).forEach(hex => {
        const ac = activeAircraft[hex];
        if (!ac.pendingRemoval && ac.visible) {
            visibleCount++;
        }
    });

    // Dynamically scale trail length limit based on currently visible/painted aircraft count
    if (visibleCount > 300) {
        maxTrailPoints = 20;  // High traffic visible: contract trails to prevent lag and clutter
    } else if (visibleCount > 100) {
        maxTrailPoints = 60;  // Medium traffic visible: moderate detail trails
    } else {
        maxTrailPoints = 120; // Low traffic visible: long, high-resolution trails (up to 10 mins of history)
    }

    // Calculate Option B sweep sector batch size dynamically based on visible aircraft count (N = INT((n + 360) / 360))
    sweepBatchSectorSize = Math.max(1, Math.floor((visibleCount + 360) / 360));

    // Refresh sidebar displays
    updateTargetList();

}

/* ==========================================================================
   SIDEBAR COMPONENT RENDERING
   ========================================================================== */

// Helper to determine if an aircraft is inside the map viewport bounds
function isAircraftInViewport(ac) {
    if (!map) return false;
    try {
        // Use mathematical distance limit relative to current displayed scope range.
        // This clips markers strictly inside the circular scope and resolves coordinate wrapping bugs.
        return ac.dist <= getDisplayedRange();
    } catch (e) {
        return true; // Default to true if calculation fails
    }
}

// Heuristic to determine if a civilian flight is commercial air traffic
function isCommercialAircraft(ac) {
    if (ac.mil) return false;
    
    // 1. Check ICAO airline callsign format (3 uppercase letters followed by a digit)
    const isAirline = /^[A-Z]{3}\d/.test(ac.callsign);
    if (isAirline) return true;
    
    // 2. Check cruise altitude/speed thresholds (typical of jets/turboprops even if callsign is charter/ferry)
    if (ac.alt > 15000 || ac.speed > 240) return true;
    
    // 3. Check ICAO size categories (A3 = Heavy, A5 = Large airliner)
    const cat = (ac.category || '').toUpperCase();
    if (cat === 'A3' || cat === 'A5') return true;
    
    return false;
}

// Incremental target list DOM reconciliation
function updateTargetList() {
    const listContainer = document.getElementById('target-list');
    
    // Filter and sort active aircraft list
    const filteredAc = Object.values(activeAircraft).filter(ac => {
        if (!ac.sweptOnce) return false; // Hide unswept targets from list
        if (lowAltitudeFilterEnabled && ac.alt >= 18000) return false;
        if (activeFilter === 'mil') return ac.mil || isActiveWarbird(ac);
        if (activeFilter === 'commercial') return isCommercialAircraft(ac);
        if (activeFilter === 'ga') return !ac.mil && !isCommercialAircraft(ac);
        return true; // 'all'
    });

    // Sort list: Warbirds first (when CodeRed active), then Military, then closest distance
    filteredAc.sort((a, b) => {
        if (warbirdModeActive) {
            const aWb = isWarbird(a);
            const bWb = isWarbird(b);
            if (aWb && !bWb) return -1;
            if (!aWb && bWb) return 1;
        }
        if (a.mil && !b.mil) return -1;
        if (!a.mil && b.mil) return 1;
        return a.dist - b.dist;
    });

    // List all targets in range (removed slice cap)
    const topAc = filteredAc;
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
        item.className = `target-item ${ac.mil ? 'mil' : ''} ${isActiveWarbird(ac) ? 'warbird' : ''} ${selectedHex === ac.hex ? 'selected' : ''}`;

        // Build HTML content and replace only if changed to prevent browser paint loops
        const distVal = ac.dist;
        const formattedDst = distVal < 10 ? distVal.toFixed(3) : distVal.toFixed(1);
        const htmlContent = `
            <span class="col-callsign lbl-callsign">${ac.callsign}</span>
            <span class="col-alt">${ac.isOnGround ? 'GND' : (ac.alt ? formatNumber(ac.alt) : '0')}</span>
            <span class="col-spd">${ac.speed ? ac.speed : '0'}</span>
            <span class="col-dst">${formattedDst}</span>
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

    if (isSelectionMode) {
        if (ac.marker && map.hasLayer(ac.marker)) {
            map.removeLayer(ac.marker);
        }
        if (ac.trail && map.hasLayer(ac.trail)) {
            map.removeLayer(ac.trail);
        }
        return;
    }

    let visible = true;
    if (activeFilter === 'mil' && !(ac.mil || isActiveWarbird(ac))) visible = false;
    else if (activeFilter === 'commercial' && !isCommercialAircraft(ac)) visible = false;
    else if (activeFilter === 'ga' && (ac.mil || isCommercialAircraft(ac))) visible = false;

    // Low Altitude filter check
    if (visible && lowAltitudeFilterEnabled && ac.alt >= 18000) {
        visible = false;
    }

    // Viewport bounds pruning check
    if (visible && !isAircraftInViewport(ac)) {
        visible = false;
    }

    // Hide if not swept once yet
    if (visible && !ac.sweptOnce) {
        visible = false;
    }

    ac.visible = visible;

    if (visible) {
        const safeHex = sanitizeId(ac.hex);
        
        // Lazy create marker on map only if it is visible
        if (!ac.marker) {
            const iconPath = AIRCRAFT_ICONS[ac.iconType || 'jet'];
            const markerIcon = L.divIcon({
                className: `aircraft-marker-container`,
                html: `
                    <div class="aircraft-marker ${ac.mil ? 'mil' : ''} ${isActiveWarbird(ac) ? 'warbird' : ''}" id="marker-${safeHex}">
                        <svg class="aircraft-icon" viewBox="0 0 24 24" style="transform: rotate(${ac.track}deg);">
                            <path d="${iconPath}" />
                        </svg>
                        <div class="aircraft-label">${ac.callsign}</div>
                    </div>
                `,
                iconSize: [30, 45],
                iconAnchor: [15, 10]
            });
            ac.marker = L.marker([ac.lat, ac.lon], { icon: markerIcon }).addTo(map);
            ac.marker.on('click', () => selectAircraft(ac.hex));
        } else {
            ac.marker.setLatLng([ac.lat, ac.lon]);
            if (!map.hasLayer(ac.marker)) {
                ac.marker.addTo(map);
            }
            
            // Synchronize rotation and icon path in the DOM in case they changed while off-screen
            const markerDom = document.getElementById(`marker-${safeHex}`);
            if (markerDom) {
                const iconSvg = markerDom.querySelector('.aircraft-icon');
                if (iconSvg) {
                    iconSvg.style.transform = `rotate(${ac.track}deg)`;
                }
                const pathEl = markerDom.querySelector('.aircraft-icon path');
                if (pathEl) {
                    pathEl.setAttribute('d', AIRCRAFT_ICONS[ac.iconType || 'jet']);
                }
                markerDom.classList.toggle('warbird', isActiveWarbird(ac));
            }
        }

        // Lazy create trail polyline on map
        if (trailsEnabled) {
            if (!ac.trail) {
                ac.trail = L.polyline([[ac.lat, ac.lon]], {
                    className: `radar-trail ${ac.mil ? 'mil' : ''} ${isActiveWarbird(ac) ? 'warbird' : ''}`,
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
    // Break target tracking lock if selection changes or is cleared
    trackedHex = null;
    hexClickCount = 0;
    lastHexClickTime = 0;

    const targetHex = (selectedHex === hex) ? null : hex;

    // Remove highlights from old selection
    if (selectedHex && activeAircraft[selectedHex]) {
        const safeOldHex = sanitizeId(selectedHex);
        const prevDom = document.getElementById(`marker-${safeOldHex}`);
        if (prevDom) prevDom.classList.remove('selected');
        
        const prevRow = document.getElementById(`row-${safeOldHex}`);
        if (prevRow) prevRow.classList.remove('selected');
    }

    selectedHex = targetHex;

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

    const isTracked = trackedHex === ac.hex;

    display.innerHTML = `
        <div class="tel-row">
            <span class="tel-label">HEX ADDR:</span>
            <span class="tel-val hex-tracker-toggle" id="hex-toggle-${ac.hex}" style="cursor: pointer; user-select: none; font-weight: bold; ${isTracked ? 'color: #d4ff00; text-shadow: 0 0 6px rgba(212, 255, 0, 0.6);' : ''}">${ac.hex.toUpperCase()}</span>
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
            <span class="tel-val">${ac.isOnGround ? 'GND' : (ac.alt ? formatNumber(ac.alt) + ' FT' : '0 FT')}</span>
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
            <span class="tel-val">${ac.dist < 10 ? ac.dist.toFixed(3) : ac.dist.toFixed(1)} NM</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">SQUAWK CODE:</span>
            <span class="tel-val">${ac.squawk}</span>
        </div>
        <div class="tel-row">
            <span class="tel-label">CLASSIFICATION:</span>
            <span class="tel-val ${ac.mil ? 'alert' : (isActiveWarbird(ac) ? 'warbird' : '')}">${ac.mil ? 'MILITARY SECURE' : (isActiveWarbird(ac) ? 'WARBIRD' : 'CIVILIAN AIR TRAFFIC')} (${(ac.iconType || 'jet').toUpperCase()})</span>
        </div>
    `;

    // Attach click event listener for the hidden TRACK mode toggle
    const toggleBtn = document.getElementById(`hex-toggle-${ac.hex}`);
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const now = Date.now();
            if (trackedHex === ac.hex) {
                // Single tap is sufficient to deactivate
                trackedHex = null;
                hexClickCount = 0;
                lastHexClickTime = 0;
                renderTelemetryDetails(ac.hex);
            } else {
                // Triple-click verification to activate tracking
                if (now - lastHexClickTime > 1500) {
                    hexClickCount = 0;
                }
                lastHexClickTime = now;
                hexClickCount++;
                
                if (hexClickCount >= 3) {
                    trackedHex = ac.hex;
                    hexClickCount = 0;
                    lastHexClickTime = 0;
                    updateRadarCenter(ac.lat, ac.lon);
                    renderTelemetryDetails(ac.hex);
                }
            }
        });
    }
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
    const R = 3443.918; // Earth radius in NM (matching Leaflet's WGS84 radius of 6378137 meters)
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

/* ==========================================================================
   INTERACTIVE LOCATION & RANGE SELECTION MODE
   ========================================================================== */
function initLocationSelection() {
    const selectBtn = document.getElementById('location-select-btn');
    const locateBtn = document.getElementById('location-locate-btn');
    const confirmBtn = document.getElementById('location-confirm-btn');
    const cancelBtn = document.getElementById('location-cancel-btn');

    if (selectBtn) {
        selectBtn.addEventListener('click', enterSelectionMode);
    }
    if (locateBtn) {
        locateBtn.addEventListener('click', handleGPSLocate);
    }
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => exitSelectionMode(true));
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => exitSelectionMode(false));
    }

    const latInput = document.getElementById('val-lat');
    const lonInput = document.getElementById('val-lon');
    const rangeInput = document.getElementById('val-range');

    const handleManualConfigChange = () => {
        if (!isSelectionMode) return;

        let newLat = parseFloat(latInput.value);
        let newLon = parseFloat(lonInput.value);
        let newRange = parseFloat(rangeInput.value);

        if (isNaN(newLat)) newLat = tempLat;
        if (isNaN(newLon)) newLon = tempLon;
        if (isNaN(newRange)) newRange = tempRange;

        // Clamp latitude to Web Mercator limits and normalize longitude beyond +/-180
        newLat = Math.max(-85.05112878, Math.min(85.05112878, newLat));
        newLon = ((newLon + 180) % 360 + 360) % 360 - 180;
        const inputRangeClamped = Math.max(0.001, Math.min(newRange, 20000));

        tempLat = newLat;
        tempLon = newLon;
        tempRange = Math.max(2, Math.min(newRange, 20000));

        // Sync inputs with the parsed/clamped values in case they typed out of bounds
        latInput.value = tempLat.toFixed(5);
        lonInput.value = tempLon.toFixed(5);
        const rangeVal = inputRangeClamped;
        rangeInput.value = rangeVal < 10 ? rangeVal.toFixed(3) : rangeVal.toFixed(1);

        // Set the programmatic change flag to prevent race conditions during setView
        isProgrammaticChange = true;

        // Temporarily unbind map moveend events to prevent loop feedback
        map.off('move drag zoom', handleSelectionMapChange);

        // Allow global zoom out (0) up to level 20
        const minZoomSelection = 0;
        const maxZoomSelection = 20;
        map.setMinZoom(minZoomSelection);
        map.setMaxZoom(maxZoomSelection);

        const targetZoom = getZoomForRange(inputRangeClamped);
        map.setView([tempLat, tempLon], targetZoom, { animate: false });

        // Redraw rings around the new target center
        const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
        rangeRings.forEach((ring, idx) => {
            const factor = ringFactors[idx] || 1.0;
            ring.setLatLng([tempLat, tempLon]);
            ring.setRadius(factor * tempRange * 1852);
            if (!map.hasLayer(ring)) ring.addTo(map);
        });

        // Re-enable event listeners
        map.on('move drag zoom', handleSelectionMapChange);

        // Safely clear programmatic change flag after Leaflet finishes event loop updates
        let programmaticTimer = null;
        const clearProgrammatic = () => {
            isProgrammaticChange = false;
            map.off('moveend zoomend', clearProgrammatic);
            if (programmaticTimer) {
                clearTimeout(programmaticTimer);
                programmaticTimer = null;
            }
        };
        map.on('moveend zoomend', clearProgrammatic);
        programmaticTimer = setTimeout(clearProgrammatic, 250);
    };

    if (latInput) latInput.addEventListener('change', handleManualConfigChange);
    if (lonInput) lonInput.addEventListener('change', handleManualConfigChange);
    if (rangeInput) rangeInput.addEventListener('change', handleManualConfigChange);

    // Also trigger confirm if the user presses Enter in any input
    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            e.target.blur(); // Triggers change event
            exitSelectionMode(true);
        }
    };
    if (latInput) latInput.addEventListener('keydown', handleKeyPress);
    if (lonInput) lonInput.addEventListener('keydown', handleKeyPress);
    if (rangeInput) rangeInput.addEventListener('keydown', handleKeyPress);
}

function enterSelectionMode() {
    isSelectionMode = true;
    tempLat = HOME_LAT;
    tempLon = HOME_LON;
    const currentDisplayed = getDisplayedRange();
    tempRange = Math.max(2, currentDisplayed);

    // Pause target polling and sweep line rotation
    stopPolling();
    sweepActive = false;
    
    // Hide rotating sweep line overlay
    const sweepEl = document.getElementById('sweep-line');
    if (sweepEl) sweepEl.style.display = 'none';

    // Clear active aircraft markers and trails from Leaflet map
    Object.keys(activeAircraft).forEach(hex => {
        const ac = activeAircraft[hex];
        if (ac.marker && map.hasLayer(ac.marker)) map.removeLayer(ac.marker);
        if (ac.trail && map.hasLayer(ac.trail)) map.removeLayer(ac.trail);
    });

    // Update status display text to Calibration Mode
    const statusText = document.querySelector('.system-status .status-text');
    const indicator = document.querySelector('.status-indicator');
    if (statusText) statusText.innerText = "SYS_STATUS: CALIBRATION";
    if (indicator) indicator.classList.remove('active');

    // Add CSS class to viewport to transition map opacity and reveal reticle
    const viewport = document.querySelector('.radar-viewport');
    if (viewport) viewport.classList.add('selection-mode');

    // Toggle button visibilities in sidebar
    document.getElementById('location-select-btn').style.display = 'none';
    document.getElementById('location-locate-btn').style.display = 'inline-block';
    document.getElementById('location-confirm-btn').style.display = 'inline-block';
    document.getElementById('location-cancel-btn').style.display = 'inline-block';

    // Enable map dragging
    map.dragging.enable();

    // Make configuration inputs editable during location selection
    const latInput = document.getElementById('val-lat');
    const lonInput = document.getElementById('val-lon');
    const rangeInput = document.getElementById('val-range');
    if (latInput) latInput.removeAttribute('readonly');
    if (lonInput) lonInput.removeAttribute('readonly');
    if (rangeInput) rangeInput.removeAttribute('readonly');

    // Display raw numerical values
    if (latInput) latInput.value = tempLat.toFixed(5);
    if (lonInput) lonInput.value = tempLon.toFixed(5);
    if (rangeInput) {
        const rangeVal = currentDisplayed;
        rangeInput.value = rangeVal < 10 ? rangeVal.toFixed(3) : rangeVal.toFixed(1);
    }

    // Allow global zoom out (0) up to high-precision zoom level (20) during selection
    const minZoomSelection = 0;
    const maxZoomSelection = 20;
    
    map.setMinZoom(minZoomSelection);
    map.setMaxZoom(maxZoomSelection);

    // Keep map center and clamp zoom level strictly within calculated bounds
    isProgrammaticChange = true;
    const currentZoom = map.getZoom();
    const targetZoom = Math.max(minZoomSelection, Math.min(currentZoom, maxZoomSelection));
    map.setView([tempLat, tempLon], targetZoom, { animate: false });

    // Bind Leaflet map drag/zoom events
    map.on('move drag zoom', handleSelectionMapChange);

    let programmaticTimer = null;
    const clearProgrammatic = () => {
        isProgrammaticChange = false;
        map.off('moveend zoomend', clearProgrammatic);
        if (programmaticTimer) {
            clearTimeout(programmaticTimer);
            programmaticTimer = null;
        }
    };
    map.on('moveend zoomend', clearProgrammatic);
    programmaticTimer = setTimeout(clearProgrammatic, 250);
}

function handleSelectionMapChange() {
    if (!isSelectionMode || isProgrammaticChange) return;

    const center = map.getCenter();
    tempLat = center.lat;
    tempLon = center.lng;

    // Calculate current scope range by measuring distance from center to bezel edge in pixels
    const bezelDiameter = getBezelDiameter();
    const visibleRadiusPx = bezelDiameter * 0.47;
    const centerPoint = map.latLngToLayerPoint(center);
    const edgeLatLng = map.layerPointToLatLng([centerPoint.x + visibleRadiusPx, centerPoint.y]);
    
    let displayedRange = calcDistance(tempLat, tempLon, edgeLatLng.lat, edgeLatLng.lng);
    tempRange = Math.max(2, displayedRange);



    // Update sidebar UI text readouts in real-time (but don't overwrite user's typing active state)
    const latInput = document.getElementById('val-lat');
    const lonInput = document.getElementById('val-lon');
    const rangeInput = document.getElementById('val-range');

    if (latInput && document.activeElement !== latInput) {
        latInput.value = tempLat.toFixed(5);
    }
    if (lonInput && document.activeElement !== lonInput) {
        lonInput.value = tempLon.toFixed(5);
    }
    if (rangeInput && document.activeElement !== rangeInput) {
        const rangeVal = displayedRange;
        rangeInput.value = rangeVal < 10 ? rangeVal.toFixed(3) : rangeVal.toFixed(1);
    }

    // Rescale and center Leaflet range rings around the new target center
    const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
    rangeRings.forEach((ring, idx) => {
        const factor = ringFactors[idx] || 1.0;
        ring.setLatLng(center);
        ring.setRadius(factor * tempRange * 1852);
        
        // Force rings to be visible (in case they were culled at closer zooms previously)
        if (!map.hasLayer(ring)) {
            ring.addTo(map);
        }
    });
}

function exitSelectionMode(confirmChanges) {
    isSelectionMode = false;

    // Unbind Leaflet events
    map.off('move drag zoom', handleSelectionMapChange);

    // Disable map dragging
    map.dragging.disable();

    // Toggle button visibility back to default
    document.getElementById('location-select-btn').style.display = 'inline-block';
    document.getElementById('location-locate-btn').style.display = 'none';
    document.getElementById('location-confirm-btn').style.display = 'none';
    document.getElementById('location-cancel-btn').style.display = 'none';

    // Remove CSS class from viewport (restores map opacity and hides reticle)
    const viewport = document.querySelector('.radar-viewport');
    if (viewport) viewport.classList.remove('selection-mode');

    // Make configuration inputs read-only again
    const latInput = document.getElementById('val-lat');
    const lonInput = document.getElementById('val-lon');
    const rangeInput = document.getElementById('val-range');
    if (latInput) latInput.setAttribute('readonly', 'true');
    if (lonInput) lonInput.setAttribute('readonly', 'true');
    if (rangeInput) rangeInput.setAttribute('readonly', 'true');

    // Reset map zoom constraints to default active radar limits
    map.setMinZoom(4);
    map.setMaxZoom(20);

    if (confirmChanges) {
        // Break target tracking lock on manual location updates
        trackedHex = null;

        // Commit changes to system variables and normalize them
        HOME_LAT = Math.max(-85.05112878, Math.min(85.05112878, tempLat));
        HOME_LON = ((tempLon + 180) % 360 + 360) % 360 - 180;
        RANGE_NM = Math.min(tempRange, 250); // Snap range back to API limit of 250 NM

        // Update address bar query parameters dynamically without a page refresh
        const newUrl = `${window.location.pathname}?lat=${HOME_LAT.toFixed(5)}&lon=${HOME_LON.toFixed(5)}&rng=${Math.round(RANGE_NM)}`;
        window.history.pushState({ path: newUrl }, '', newUrl);

        // Snap map view center
        map.setView([HOME_LAT, HOME_LON]);

        // Clear active target tracking registry and bearings
        Object.values(activeAircraft).forEach(ac => {
            if (ac.marker && map.hasLayer(ac.marker)) map.removeLayer(ac.marker);
            if (ac.trail && map.hasLayer(ac.trail)) map.removeLayer(ac.trail);
        });
        activeAircraft = {};
        bearingBuckets = Array.from({ length: 360 }, () => new Set());
        selectedHex = null;
        resetTelemetryDisplay();

        // Refresh sidebar lists
        updateTargetList();
    } else {
        // Cancel changes: revert map position to original home coordinates
        map.setView([HOME_LAT, HOME_LON]);
    }

    // Reset zoom snap and snap the zoom level to match the new or original range ring diameter
    updateMinZoom();
    updateSweepSize();
    recalculateDisplayedRange();
    updateDisplayedRange();

    // Redraw and lock range rings back to center with proper range
    const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
    rangeRings.forEach((ring, idx) => {
        const factor = ringFactors[idx] || 1.0;
        ring.setLatLng([HOME_LAT, HOME_LON]);
        ring.setRadius(factor * RANGE_NM * 1852);
    });

    // Relocate home crosshair marker to new coordinates
    if (homeMarker) {
        homeMarker.setLatLng([HOME_LAT, HOME_LON]);
    }

    // Relocate rotating sweep marker center to new coordinates
    if (sweepMarker) {
        sweepMarker.setLatLng([HOME_LAT, HOME_LON]);
    }

    // Sync the inputs with final values
    updateUIConfigurationValues();

    // Resume polling and start sweep line animation
    startPolling();
    sweepActive = true;
    
    const sweepEl = document.getElementById('sweep-line');
    if (sweepEl) {
        sweepEl.style.display = 'block';
        updateSweepSize();
    }
}

function handleGPSLocate() {
    const locateBtn = document.getElementById('location-locate-btn');
    if (!locateBtn) return;

    const originalText = "LOCATE ME";

    // Browser geolocation requires HTTPS context (except localhost)
    if (!navigator.geolocation) {
        console.warn("Geolocation is not supported by this browser or requires an HTTPS context.");
        locateBtn.innerText = "HTTPS REQUIRED";
        locateBtn.style.color = "#ffaa00";
        locateBtn.style.borderColor = "rgba(255, 170, 0, 0.45)";
        setTimeout(() => {
            locateBtn.innerText = originalText;
            locateBtn.style.color = "#d4ff00";
            locateBtn.style.borderColor = "rgba(212, 255, 0, 0.45)";
        }, 3000);
        return;
    }

    locateBtn.innerText = "LOCATING...";
    locateBtn.disabled = true;

    // Helper to query location with dynamic accuracy
    function performLocate(highAccuracy) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                locateBtn.innerText = originalText;
                locateBtn.disabled = false;

                const lat = position.coords.latitude;
                const lon = position.coords.longitude;

                // Update selection state coordinates
                tempLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
                tempLon = ((lon + 180) % 360 + 360) % 360 - 180;

                // Re-center Leaflet map (this automatically triggers handleSelectionMapChange)
                if (map) {
                    map.setView([tempLat, tempLon]);
                }
            },
            (error) => {
                // If high accuracy failed or timed out, immediately fall back to low accuracy
                if (highAccuracy) {
                    console.info("High-accuracy lookup failed, falling back to standard accuracy...");
                    performLocate(false);
                } else {
                    // Both high and low accuracy failed (common on desktops with OS Location Services disabled)
                    console.warn("GPS/Wi-Fi lookup failed completely, falling back to IP Geolocation:", error);
                    locateBtn.innerText = "USING IP...";

                    getIPLocation().then((coords) => {
                        if (coords) {
                            locateBtn.innerText = originalText;
                            locateBtn.disabled = false;

                            tempLat = Math.max(-85.05112878, Math.min(85.05112878, coords.lat));
                            tempLon = ((coords.lon + 180) % 360 + 360) % 360 - 180;

                            if (map) {
                                map.setView([tempLat, tempLon]);
                            }
                        } else {
                            // Even IP lookup failed
                            let errMsg = "LOCATE FAILED";
                            if (error.code === 1) errMsg = "PERMISSION DENIED";
                            else if (error.code === 2) errMsg = "POSITION UNAVAIL";
                            else if (error.code === 3) errMsg = "TIMEOUT";

                            locateBtn.innerText = errMsg;
                            locateBtn.style.color = "#ffaa00";
                            locateBtn.style.borderColor = "rgba(255, 170, 0, 0.45)";

                            setTimeout(() => {
                                locateBtn.innerText = originalText;
                                locateBtn.disabled = false;
                                locateBtn.style.color = "#d4ff00";
                                locateBtn.style.borderColor = "rgba(212, 255, 0, 0.45)";
                            }, 2500);
                        }
                    });
                }
            },
            {
                enableHighAccuracy: highAccuracy,
                timeout: highAccuracy ? 3000 : 8000, // 3-second limit for GPS, 8-second limit for Wi-Fi before IP fallback
                maximumAge: highAccuracy ? 0 : 300000 // Allow cached location for fallback
            }
        );
    }

    // Try high accuracy first
    performLocate(true);
}

function getZoomForRange(range) {
    if (!map) return 8;
    try {
        const center = map.getCenter();
        const lat = center.lat;
        const rangeMeters = range * 1852;
        const bezelDiameter = getBezelDiameter();
        const targetRadiusPx = bezelDiameter * 0.47; // Align with 0.47 bezel fit
        
        const equatorCircumference = 40075017; // meters
        const metersPerPixelAtZoom0 = (equatorCircumference * Math.cos(lat * Math.PI / 180)) / 256;
        
        const denominator = rangeMeters;
        if (denominator <= 0) return 8;
        
        const val = (targetRadiusPx * metersPerPixelAtZoom0) / denominator;
        return Math.log2(val);
    } catch (e) {
        console.error("Error in getZoomForRange:", e);
        return 8;
    }
}
