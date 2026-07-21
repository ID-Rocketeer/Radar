
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
HOME_LAT = normalizeLat(HOME_LAT);
HOME_LON = normalizeLon(HOME_LON);

// Validate and cap range. The Airplanes.live API limits point queries to 250 NM.
// We set a minimum query/ring range of 2 NM to maintain data density limits,
// although the visual map zoom is allowed to go closer (up to level 20).
if (isNaN(RANGE_NM)) {
    RANGE_NM = defaultRange;
} else {
    RANGE_NM = Math.max(2, Math.min(RANGE_NM, 250));
}

// Sync address bar URL with normalized coordinates on load
try {
    const formattedRng = RANGE_NM < 10 ? RANGE_NM.toFixed(3) : RANGE_NM.toFixed(1);
    const initialNormalizedUrl = `${window.location.pathname}?lat=${HOME_LAT.toFixed(5)}&lon=${HOME_LON.toFixed(5)}&rng=${formattedRng}`;
    window.history.replaceState({ path: initialNormalizedUrl }, '', initialNormalizedUrl);
} catch (historyError) {
    console.warn("Silent fallback: window.history.replaceState is blocked in this browser context (e.g. file:/// URL).", historyError);
}

const SWEEP_DURATION_MS = 10000; // 10s rotation cycle

// Map and tracking states
let map;
let homeMarker; // Reference to center crosshair marker
let sweepMarker; // Reference to rotating sweep center marker
let rangeRings = [];
var activeAircraft = {}; // Holds aircraft metadata and map instances
var radarScope;
var radarSidebar;
var debugModalOpen = false;
let selectedHex = null;
var trackedHex = null; // Currently tracked aircraft HEX address (Easter Egg)
var hexClickCount = 0; // Click counter for gesture activation
var lastHexClickTime = 0; // Click timestamp for gesture timeout
var activeFilter = 'all'; // 'all', 'mil', 'commercial', 'ga'
var trailsEnabled = true;
var lowAltitudeFilterEnabled = false; // Filter modifier for low-altitude targets
var classBEnabled = false; // Filter modifier for Class B targets (gliders, balloons, UAVs)
var maxTrailPoints = 15; // Dynamically scaled trail length limit
let targetListDomMap = {}; // Maps hex -> DOM element for target list reconciliation
let sweepEl = null; // Global reference to the sweep line DOM element
let sweepActive = true; // Flag to halt/resume sweep line rotation on connection errors
let pollIntervalId = null; // ID to track active polling interval
let activePollController = null; // Controller to abort in-flight API requests
var ingestionService = null; // Global instance of IngestionService
var radarChassis = null; // Global instance of RadarChassis

// Audio system states
var audioCtx = null;
var masterGain = null;
var spatialAudioConsole = null;
var audioEnabled = false;
var rumblePanner = null; // Global reference to animate rotating 3D panner
var audioSources = []; // Keeps track of active oscillators, buffer sources, and LFOs

var warbirdModeActive = localStorage.getItem('codeRedActive') === 'true';

let cachedDisplayedRange = RANGE_NM; // Cache to prevent layout thrashing from getBoundingClientRect()

// Global bearing-based index (360 buckets of Sets, one for each degree)
var bearingBuckets = Array.from({ length: 360 }, () => new Set());

function normalizeLon(lon) {
    let w = ((lon + 180) % 360 + 360) % 360 - 180;
    return w === -180 ? 180 : w;
}

function normalizeLat(lat) {
    return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

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

// AIRCRAFT_ICONS has been moved to js/aircraft.js

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
            ac.destroy(map);
            removeAircraftFromBearingIndex(hex, ac.bearing);
            delete activeAircraft[hex];
        }
    });

    if (radarScope) {
        radarScope.setCenter(newLat, newLon);
    }
}

function startPolling() {
    if (ingestionService) {
        ingestionService.start(
            () => ({ lat: HOME_LAT, lon: HOME_LON, rangeNm: RANGE_NM }),
            (data, error) => {
                if (error) {
                    sweepActive = false;
                    const debugModal = document.getElementById('debug-modal');
                    if (debugModal && !debugModalOpen && document.body.classList.contains('debug-enabled')) {
                        populateDebugModalLogTable();
                        debugModal.style.display = 'flex';
                        void debugModal.offsetWidth;
                        debugModal.classList.add('active');
                        debugModalOpen = true;
                    }
                    return;
                }
                if (data) {
                    processAPIResponse(data);
                }
            }
        );
    }
}

function stopPolling() {
    if (ingestionService) {
        ingestionService.stop();
    }
}

// Note: createReverbImpulseResponse, createPanner, initAudioEngine, and toggleAudio have been moved to js/audio-engine.js.



function initializeRadarSystem() {
    spatialAudioConsole = new SpatialAudioConsole();
    window.spatialAudioConsole = spatialAudioConsole;
    ingestionService = new IngestionService();
    radarChassis = new RadarChassis({
        isWarbirdModeActive: () => warbirdModeActive,
        setWarbirdModeActive: (val) => { warbirdModeActive = val; },
        refreshWarbirdStyling: refreshWarbirdStyling
    });
    radarSidebar = new RadarSidebar('target-list', 'telemetry-display', 'target-count');
    radarScope = new RadarScope('map', { homeLat: HOME_LAT, homeLon: HOME_LON, rangeNm: RANGE_NM });
    radarScope.onCenterChanged = (lat, lon) => {
        HOME_LAT = lat;
        HOME_LON = lon;

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

        // Update UI displays
        updateUIConfigurationValues();

        // Reposition sweep marker
        if (sweepMarker) sweepMarker.setLatLng([HOME_LAT, HOME_LON]);

        // Refresh sweep and range rings size/culling positioning
        updateSweepSize();

        // Update URL parameters silently
        try {
            const formattedRng = RANGE_NM < 10 ? RANGE_NM.toFixed(3) : RANGE_NM.toFixed(1);
            const newUrl = `${window.location.pathname}?lat=${HOME_LAT.toFixed(5)}&lon=${HOME_LON.toFixed(5)}&rng=${formattedRng}`;
            window.history.replaceState(null, '', newUrl);
        } catch (historyError) {
            console.warn("Silent fallback: window.history.replaceState is blocked in this browser context (e.g. file:/// URL).", historyError);
        }
    };
    initMap();
    initControls();
    initDebugModal();
    // Restore CodeRed pilot light if mode was persisted across page reload
    if (warbirdModeActive) {
        const pilotLight = document.getElementById('codered-light');
        if (pilotLight) pilotLight.classList.add('active');
    }
    updateUIConfigurationValues();
    startRadarSweep();
    radarChassis.init();
    
    // Initial size and minimum zoom calculation
    setTimeout(() => {
        if (map) {
            map.invalidateSize({ animate: false });
            map.setView([HOME_LAT, HOME_LON], map.getZoom(), { animate: false });
        }
        updateMinZoom();
        updateSweepSize();
        recalculateDisplayedRange();
        updateDisplayedRange();
    }, 200);

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
            if (!(radarScope && radarScope.isSelectionMode)) {
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
    if (typeof document !== 'undefined' && document.body) {
        if (urlParams.get('debug') === '1') {
            document.body.classList.add('debug-enabled');
        }
    }
    const hasLat = urlParams.has('lat') || urlParams.has('latitude');
    const hasLon = urlParams.has('long') || urlParams.has('longitude') || urlParams.has('lon') || urlParams.has('lng');

    if (!hasLat || !hasLon) {
        const coords = await getIPLocation();
        if (coords) {
            HOME_LAT = normalizeLat(coords.lat);
            HOME_LON = normalizeLon(coords.lon);
            
            // Update URL silently to reflect IP location
            try {
                const formattedRng = RANGE_NM < 10 ? RANGE_NM.toFixed(3) : RANGE_NM.toFixed(1);
                const newUrl = `${window.location.pathname}?lat=${HOME_LAT.toFixed(5)}&lon=${HOME_LON.toFixed(5)}&rng=${formattedRng}`;
                window.history.replaceState(null, '', newUrl);
            } catch (historyError) {
                console.warn("Silent fallback: window.history.replaceState is blocked in this browser context (e.g. file:/// URL).", historyError);
            }
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
            const isProg = radarScope ? radarScope.isProgrammaticChange : false;
            if (isProg) return;
            if (radarScope) radarScope.isProgrammaticChange = true;
            try {
                const isSel = radarScope ? radarScope.isSelectionMode : false;
                map.invalidateSize({ panTo: isSel });
                if (!isSel) {
                    map.setView([HOME_LAT, HOME_LON], map.getZoom(), { animate: false });
                }
                updateMinZoom();
                updateSweepSize();
                recalculateDisplayedRange();
                updateDisplayedRange();
            } finally {
                if (radarScope) radarScope.isProgrammaticChange = false;
            }
        }
    });
    resizeObserver.observe(mapEl);
}

window.addEventListener('load', () => {
    if (map) {
        const isProg = radarScope ? radarScope.isProgrammaticChange : false;
        if (isProg) return;
        if (radarScope) radarScope.isProgrammaticChange = true;
        try {
            map.invalidateSize({ animate: false });
            map.setView([HOME_LAT, HOME_LON], map.getZoom(), { animate: false });
            updateMinZoom();
            updateSweepSize();
            recalculateDisplayedRange();
            updateDisplayedRange();
        } finally {
            if (radarScope) radarScope.isProgrammaticChange = false;
        }
    }
});

/* ==========================================================================
   MAP SETUP
   ========================================================================== */
function initMap() {
    if (radarScope) {
        radarScope.init();
        map = radarScope.map;
        homeMarker = radarScope.crosshair;
        rangeRings = radarScope.rangeRings;
    }

    document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn());
    document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut());



    // Map movement and zoom completion lifecycle listener
    map.on('moveend zoomend', () => {
        const isProg = radarScope ? radarScope.isProgrammaticChange : false;
        if (isProg) return;
        if (radarScope) radarScope.isProgrammaticChange = true;
        try {
            const isSel = radarScope ? radarScope.isSelectionMode : false;
            if (!isSel) {
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
            if (radarScope) radarScope.isProgrammaticChange = false;
        }
    });
}

/* ==========================================================================
   UI CONTROLS & LISTENERS
   ========================================================================== */
function initControls() {
    initAddressSearchControls();

    // Prevent long-press context menus across the entire application (bezel, sidebar, map, etc.)
    // We use the capturing phase (true) to intercept the event before Leaflet blocks propagation.
    window.addEventListener('contextmenu', (e) => e.preventDefault(), true);

    // Audio soundtrack toggle button
    const soundBtn = document.getElementById('sound-btn');
    if (soundBtn) {
        soundBtn.addEventListener('click', () => {
            if (window.spatialAudioConsole) {
                window.spatialAudioConsole.toggle();
            }
        });
    }

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

    // Class B Toggle Button
    const classBBtn = document.getElementById('class-b-toggle');
    if (classBBtn) {
        classBBtn.addEventListener('click', () => {
            classBEnabled = !classBEnabled;
            classBBtn.classList.toggle('active', classBEnabled);

            // Update visibility of all current markers
            Object.keys(activeAircraft).forEach(hex => {
                updateMarkerVisibility(hex);
            });

            // Refresh target list sidebar
            updateTargetList();
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



    if (radarScope) {
        radarScope.initLocationSelection({
            getHomeLat: () => HOME_LAT,
            getHomeLon: () => HOME_LON,
            getRangeNm: () => RANGE_NM,
            setHomeLat: (val) => { HOME_LAT = val; },
            setHomeLon: (val) => { HOME_LON = val; },
            setRangeNm: (val) => { RANGE_NM = val; },
            stopPolling: stopPolling,
            startPolling: startPolling,
            setSweepActive: (val) => { sweepActive = val; },
            clearActiveMarkers: () => {
                Object.keys(activeAircraft).forEach(hex => {
                    const ac = activeAircraft[hex];
                    if (ac.marker && map.hasLayer(ac.marker)) map.removeLayer(ac.marker);
                    if (ac.trail && map.hasLayer(ac.trail)) map.removeLayer(ac.trail);
                });
            },
            clearActiveAircraftRegistry: () => {
                activeAircraft = {};
                bearingBuckets = Array.from({ length: 360 }, () => new Set());
                selectedHex = null;
                trackedHex = null;
            },
            resetTelemetryDisplay: resetTelemetryDisplay,
            updateTargetList: updateTargetList,
            updateMinZoom: updateMinZoom,
            updateSweepSize: updateSweepSize,
            recalculateDisplayedRange: recalculateDisplayedRange,
            updateDisplayedRange: updateDisplayedRange,
            updateUIConfigurationValues: updateUIConfigurationValues,
            getDisplayedRange: getDisplayedRange,
            getBezelDiameter: () => (radarChassis ? radarChassis.getBezelDiameter() : 400),
            getZoomForRange: getZoomForRange,
            normalizeLat: normalizeLat,
            normalizeLon: normalizeLon,
            calcDistance: calcDistance,
            getIPLocation: getIPLocation,
            updateStagingMarkerPosition: (lat, lon) => {
                if (addressSearchStagingMarker && map) {
                    addressSearchStagingMarker.setLatLng([lat, lon]);
                }
            }
        });
    }
}

let initialZoomSet = false;

// Dynamically adjust map's minZoom level to ensure the range ring always fills the visible bezel viewport
function updateMinZoom() {
    if (!map) return;
    
    try {
        const minZoomVal = getZoomForRange(RANGE_NM);
        const snappedMinZoom = (radarScope && radarScope.isSelectionMode) ? 0 : minZoomVal;
        const currentZoom = map.getZoom();
        const currentMinZoom = map.getMinZoom();
        const isAtMinZoom = Math.abs(currentZoom - currentMinZoom) < 0.05;
        
        // Only update minZoom if it has changed by more than 0.001
        if (Math.abs(currentMinZoom - snappedMinZoom) > 0.001) {
            map.setMinZoom(snappedMinZoom);
        }
        
        // Always force initial load to start at the maximum configured range zoom level (disable transition animation to snap instantly)
        // If the window is resized or layout reflows while at minZoom, adjust the zoom to the new minZoomVal automatically
        if (!(radarScope && radarScope.isSelectionMode)) {
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
        const bezelDiameter = radarChassis ? radarChassis.getBezelDiameter() : 400;
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
        const bezelDiameter = radarChassis ? radarChassis.getBezelDiameter() : 400;
        const visibleRadiusPx = bezelDiameter * 0.47;
        const edgeLatLng = map.layerPointToLatLng([centerPoint.x + visibleRadiusPx, centerPoint.y]);
        let displayedRange = calcDistance(centerLatLng.lat, centerLatLng.lng, edgeLatLng.lat, edgeLatLng.lng);
        
        if (!(radarScope && radarScope.isSelectionMode) && Math.abs(map.getZoom() - map.getMinZoom()) < 0.05) {
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
    if (radarScope) radarScope.sweepMarker = sweepMarker;

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

        // Synchronize 3D rotating antenna rumble position on the ceiling
        if (window.spatialAudioConsole) {
            window.spatialAudioConsole.updatePanner(nextAngle);
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
        ac.destroy(map);
        
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
        
        // Update SVG icon rotation only if track changed and not rotation locked
        if (trackChanged) {
            const markerDom = document.getElementById(`marker-${safeHex}`);
            const iconSvg = markerDom ? markerDom.querySelector('.aircraft-icon') : null;
            if (iconSvg) {
                iconSvg.style.transform = `rotate(${(ac.iconType === 'balloon' || ac.iconType === 'parachute') ? 0 : ac.track}deg)`;
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
    if (radarSidebar) {
        radarSidebar.updateRow(ac);
    }

    return needsListUpdate;
}

/* ==========================================================================
   API DATA RETRIEVAL (AIRPLANES.LIVE)
   ========================================================================== */

function processAPIResponse(data) {
    if (radarScope && radarScope.isSelectionMode) return;
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

        // Suppress Category C (surface vehicles, beacons, obstacles)
        const rawCat = (rawAc.category || '').toUpperCase();
        if (rawCat.startsWith('C')) return;

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
        rawAc.dist = calcDistance(HOME_LAT, HOME_LON, lat, lon);
        if (rawAc.dist > RANGE_NM) return;

        rawAc.bearing = calcBearing(lat, lon);

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
                ac.cacheDomElements();
                if (ac.pathEl) {
                    ac.pathEl.setAttribute('d', AIRCRAFT_ICONS[ac.iconType || 'jet']);
                }
            }

            // Buffer the coordinates: do not move the plane until the sweep line passes
            const oldActiveBearing = ac.pendingUpdate ? ac.pendingUpdate.bearing : ac.bearing;
            updateAircraftBearingIndex(cleanHex, oldActiveBearing, rawAc.bearing);

            ac.update(rawAc);
        } else {
            // Store in tracking registry (markers/trails created lazily in updateMarkerVisibility)
            const newAc = new Aircraft(cleanHex, rawAc);
            activeAircraft[cleanHex] = newAc;
            addAircraftToBearingIndex(cleanHex, newAc.bearing);
        }
        updateMarkerVisibility(cleanHex);
    });

    // Flag aircraft that are no longer broadcasted by the API or stale for removal
    Object.keys(activeAircraft).forEach(hex => {
        const ac = activeAircraft[hex];
        if (freshHexes.has(hex)) {
            ac.missedPolls = 0;
        } else {
            ac.missedPolls = (ac.missedPolls || 0) + 1;
            if (ac.missedPolls >= 3 || ac.seen > 60) {
                ac.pendingRemoval = true;
            }
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

    // Refresh map markers and sidebar displays in one optimized repaint pass
    updateMapMarkersVisibility();
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

// Incremental target list DOM reconciliation
function updateTargetList() {
    // Filter and sort active aircraft list
    const filteredAc = Object.values(activeAircraft).filter(ac => {
        if (!ac.sweptOnce) return false; // Hide unswept targets from list
        if (lowAltitudeFilterEnabled && ac.alt >= 18000) return false;
        if (activeFilter === 'mil') return ac.mil || ac.isActiveWarbird;
        if (activeFilter === 'commercial') return ac.isCommercial;
        if (activeFilter === 'ga') return !ac.mil && !ac.isCommercial;
        return true; // 'all'
    });

    // Sort list: Warbirds first (when CodeRed active), then Class B (when active), then Military, then closest distance
    filteredAc.sort((a, b) => {
        if (warbirdModeActive) {
            const aWb = a.isWarbird;
            const bWb = b.isWarbird;
            if (aWb && !bWb) return -1;
            if (!aWb && bWb) return 1;
        }
        if (classBEnabled) {
            const aB = a.isClassB;
            const bB = b.isClassB;
            if (aB && !bB) return -1;
            if (!aB && bB) return 1;
        }
        if (a.mil && !b.mil) return -1;
        if (!a.mil && b.mil) return 1;
        return a.dist - b.dist;
    });

    if (radarSidebar) {
        radarSidebar.updateCount(filteredAc.length);
        radarSidebar.renderList(filteredAc, selectedHex, classBEnabled, selectAircraft);
    }
}

function updateMapMarkersVisibility() {
    if (radarScope) {
        radarScope.activeFilter = activeFilter;
        radarScope.lowAltitudeFilterEnabled = lowAltitudeFilterEnabled;
        radarScope.classBEnabled = classBEnabled;
        radarScope.trailsEnabled = trailsEnabled;
        
        radarScope.repaint(activeAircraft);
    }
}

// Viewport-based marker lazy rendering & dynamic culling
updateMarkerVisibility = function(hex) {
    const ac = activeAircraft[hex];
    if (!ac) return;

    let visible = true;
    if (radarScope && radarScope.isSelectionMode) {
        visible = false;
    } else {
        if (activeFilter === 'mil' && !(ac.mil || ac.isActiveWarbird)) visible = false;
        else if (activeFilter === 'commercial' && !ac.isCommercial) visible = false;
        else if (activeFilter === 'ga' && (ac.mil || ac.isCommercial)) visible = false;

        // Low Altitude filter check
        if (visible && lowAltitudeFilterEnabled && ac.alt >= 18000) {
            visible = false;
        }

        // Viewport bounds pruning check
        const displayedRange = radarScope ? radarScope.rangeNm : RANGE_NM;
        if (visible && ac.dist > displayedRange) {
            visible = false;
        }

        // Hide if not swept once yet
        if (visible && !ac.sweptOnce) {
            visible = false;
        }
    }

    if (map) {
        ac.render(map, visible, trailsEnabled, classBEnabled);
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
    const ac = activeAircraft[hex];
    if (!ac) return;

    const isTracked = trackedHex === ac.hex;

    if (radarSidebar) {
        radarSidebar.renderDetails(ac, isTracked, classBEnabled, (clickedAc) => {
            const now = Date.now();
            if (trackedHex === clickedAc.hex) {
                // Single tap is sufficient to deactivate
                trackedHex = null;
                hexClickCount = 0;
                lastHexClickTime = 0;
                renderTelemetryDetails(clickedAc.hex);
            } else {
                // Triple-click verification to activate tracking
                if (now - lastHexClickTime > 1500) {
                    hexClickCount = 0;
                }
                lastHexClickTime = now;
                hexClickCount++;
                
                if (hexClickCount >= 3) {
                    trackedHex = clickedAc.hex;
                    hexClickCount = 0;
                    lastHexClickTime = 0;
                    updateRadarCenter(clickedAc.lat, clickedAc.lon);
                    renderTelemetryDetails(clickedAc.hex);
                }
            }
        });
    }
}

function resetTelemetryDisplay() {
    if (radarSidebar) {
        radarSidebar.resetDetails();
    }
}

/* ==========================================================================
   HELPER MATHEMATICS & FORMATTERS
   ========================================================================== */

// Haversine formula to compute distance in Nautical Miles
// Math and string utility functions are consolidated in js/utils.js



function getZoomForRange(range) {
    if (!map) return 8;
    try {
        const center = map.getCenter();
        const lat = center.lat;
        const rangeMeters = range * 1852;
        const bezelDiameter = radarChassis ? radarChassis.getBezelDiameter() : 400;
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

// Refresh warbird CSS classes on all existing markers, trails, and the target list
function refreshWarbirdStyling() {
    Object.keys(activeAircraft).forEach(hex => {
        const ac = activeAircraft[hex];
        const isWb = ac.isActiveWarbird;

        // Update marker DOM
        ac.cacheDomElements();
        if (ac.markerEl) {
            ac.markerEl.classList.toggle('warbird', isWb);
            if (ac.pathEl) {
                ac.pathEl.setAttribute('d', AIRCRAFT_ICONS[ac.iconType || 'jet']);
            }
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

function populateDebugModalLogTable() {
    const tbody = document.getElementById('debug-log-body');
    if (!tbody || !ingestionService) return;

    const history = ingestionService.pollHistory || [];
    if (history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--phosphor-green);">NO LOG EVENTS CAPTURED YET</td></tr>`;
        return;
    }

    tbody.innerHTML = history.slice().reverse().map(entry => {
        let statusClass = 'status-online';
        if (entry.status === 'LINK ERROR') statusClass = 'status-error';
        else if (entry.status === 'SCANNING...') statusClass = 'status-scanning';

        const rawTimestamp = entry.timestamp.replace('Z', '').replace('T', ' ');

        return `
            <tr>
                <td>${escapeHtml(rawTimestamp)}</td>
                <td style="word-break: break-all; font-family: monospace; font-size: 0.75rem;">${escapeHtml(entry.source || '--')}</td>
                <td class="${statusClass}">${escapeHtml(entry.status)}</td>
                <td>${entry.duration ? entry.duration + ' ms' : '--'}</td>
                <td>${entry.activeCount !== undefined ? entry.activeCount : '--'}</td>
                <td>${escapeHtml(entry.statusText)}</td>
            </tr>
        `;
    }).join('');
}

function initDebugModal() {
    const debugModal = document.getElementById('debug-modal');
    const debugCloseBtn = document.getElementById('debug-close');
    const statusPanel = document.querySelector('.system-status');

    if (debugModal && debugCloseBtn) {
        const closeDebugModal = () => {
            debugModal.classList.remove('active');
            setTimeout(() => {
                if (!debugModal.classList.contains('active')) {
                    debugModal.style.display = 'none';
                }
            }, 300);
            debugModalOpen = false;
        };

        debugCloseBtn.addEventListener('click', closeDebugModal);

        debugModal.addEventListener('click', (e) => {
            if (e.target === debugModal) {
                closeDebugModal();
            }
        });
    }

    if (statusPanel) {
        statusPanel.addEventListener('click', () => {
            if (!document.body.classList.contains('debug-enabled')) return;
            if (debugModal) {
                if (!debugModalOpen) {
                    populateDebugModalLogTable();
                    debugModal.style.display = 'flex';
                    void debugModal.offsetWidth;
                    debugModal.classList.add('active');
                    debugModalOpen = true;
                } else {
                    debugModal.classList.remove('active');
                    setTimeout(() => {
                        if (!debugModal.classList.contains('active')) {
                            debugModal.style.display = 'none';
                        }
                    }, 300);
                    debugModalOpen = false;
                }
            }
        });
    }
}

// ==========================================
// ADDRESS SEARCH & 2-STAGE GEOCODING ENGINE
// ==========================================
let addressSearchStagingMarker = null;
let revertHomeLat = null;
let revertHomeLon = null;
let stagedTargetLat = null;
let stagedTargetLon = null;

function matchesStreetKeyword(returnedName, searchKeyword) {
    if (!returnedName || !searchKeyword) return false;
    // Strip leading house numbers/digits from search keyword to match street name (e.g. "8008 Gato Lane" -> "Gato Lane")
    const streetOnlyKeyword = searchKeyword.replace(/^\d+\s*/, '');
    const normReturned = returnedName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normKeyword = (streetOnlyKeyword || searchKeyword).toLowerCase().replace(/[^a-z0-9]/g, '');
    
    return normReturned.includes(normKeyword) || normKeyword.includes(normReturned);
}

function getActiveViewCenter() {
    if (radarScope && radarScope.isSelectionMode && typeof radarScope.tempLat === 'number' && typeof radarScope.tempLon === 'number') {
        return { lat: radarScope.tempLat, lon: radarScope.tempLon };
    }
    if (map && typeof map.getCenter === 'function') {
        const c = map.getCenter();
        return { lat: c.lat, lon: c.lng };
    }
    return { lat: HOME_LAT, lon: HOME_LON };
}

const US_STATES = {
    'ALABAMA': ['AL', 'ALABAMA'],
    'ALASKA': ['AK', 'ALASKA'],
    'ARIZONA': ['AZ', 'ARIZONA'],
    'ARKANSAS': ['AR', 'ARKANSAS'],
    'CALIFORNIA': ['CA', 'CALIFORNIA'],
    'COLORADO': ['CO', 'COLORADO'],
    'CONNECTICUT': ['CT', 'CONNECTICUT'],
    'DELAWARE': ['DE', 'DELAWARE'],
    'FLORIDA': ['FL', 'FLORIDA'],
    'GEORGIA': ['GA', 'GEORGIA'],
    'HAWAII': ['HI', 'HAWAII'],
    'IDAHO': ['ID', 'IDAHO'],
    'ILLINOIS': ['IL', 'ILLINOIS'],
    'INDIANA': ['IN', 'INDIANA'],
    'IOWA': ['IA', 'IOWA'],
    'KANSAS': ['KS', 'KANSAS'],
    'KENTUCKY': ['KY', 'KENTUCKY'],
    'LOUISIANA': ['LA', 'LOUISIANA'],
    'MAINE': ['ME', 'MAINE'],
    'MARYLAND': ['MD', 'MARYLAND'],
    'MASSACHUSETTS': ['MA', 'MASSACHUSETTS'],
    'MICHIGAN': ['MI', 'MICHIGAN'],
    'MINNESOTA': ['MN', 'MINNESOTA'],
    'MISSISSIPPI': ['MS', 'MISSISSIPPI'],
    'MISSOURI': ['MO', 'MISSOURI'],
    'MONTANA': ['MT', 'MONTANA'],
    'NEBRASKA': ['NE', 'NEBRASKA'],
    'NEVADA': ['NV', 'NEVADA'],
    'NEW HAMPSHIRE': ['NH', 'NEW HAMPSHIRE'],
    'NEW JERSEY': ['NJ', 'NEW JERSEY'],
    'NEW MEXICO': ['NM', 'NEW MEXICO'],
    'NEW YORK': ['NY', 'NEW YORK'],
    'NORTH CAROLINA': ['NC', 'NORTH CAROLINA'],
    'NORTH DAKOTA': ['ND', 'NORTH DAKOTA'],
    'OHIO': ['OH', 'OHIO'],
    'OKLAHOMA': ['OK', 'OKLAHOMA'],
    'OREGON': ['OR', 'OREGON'],
    'PENNSYLVANIA': ['PA', 'PENNSYLVANIA'],
    'RHODE ISLAND': ['RI', 'RHODE ISLAND'],
    'SOUTH CAROLINA': ['SC', 'SOUTH CAROLINA'],
    'SOUTH DAKOTA': ['SD', 'SOUTH DAKOTA'],
    'TENNESSEE': ['TN', 'TENNESSEE'],
    'TEXAS': ['TX', 'TEXAS'],
    'UTAH': ['UT', 'UTAH'],
    'VERMONT': ['VT', 'VERMONT'],
    'VIRGINIA': ['VA', 'VIRGINIA'],
    'WASHINGTON': ['WA', 'WASHINGTON'],
    'WEST VIRGINIA': ['WV', 'WEST VIRGINIA'],
    'WISCONSIN': ['WI', 'WISCONSIN'],
    'WYOMING': ['WY', 'WYOMING']
};

const US_STATE_REGEXES = {};
for (const [stateName, tokens] of Object.entries(US_STATES)) {
    US_STATE_REGEXES[stateName] = tokens.map(token => new RegExp('\\b' + token + '\\b', 'i'));
}

function extractQueryState(queryText) {
    if (!queryText) return null;
    const upper = queryText.toUpperCase();
    for (const [stateName, regexList] of Object.entries(US_STATE_REGEXES)) {
        for (const regex of regexList) {
            if (regex.test(upper)) {
                return stateName;
            }
        }
    }
    return null;
}

function matchesRequestedState(candidateName, requestedState) {
    if (!requestedState) return true;
    if (!candidateName) return false;
    const regexList = US_STATE_REGEXES[requestedState];
    if (!regexList) return true;
    const upperCand = candidateName.toUpperCase();
    return regexList.some(regex => regex.test(upperCand));
}

// 1. Esri ArcGIS World Geocoder (for exact house numbers, street addresses, and global parcels)
async function fetchArcGISGeocode(queryText, biasLat = null, biasLon = null) {
    const houseMatch = queryText.trim().match(/^(\d+)/);
    const hasHouseNumber = !!houseMatch;
    const reqHouseNumber = houseMatch ? houseMatch[1] : null;

    async function queryArcGIS(lat, lon) {
        let url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(queryText)}&f=json&outFields=Addr_type,Match_addr,LongLabel,AddNum,StName,Region,RegionAbbr,City&maxLocations=15`;
        if (typeof lat === 'number' && typeof lon === 'number') {
            url += `&location=${lon},${lat}`;
        }
        console.log("  ↳ Requesting Esri ArcGIS World Geocoder:", url);
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = await res.json();
            console.log("  ↳ ArcGIS Response Data:", data);
            if (data && data.candidates && data.candidates.length > 0) {
                let candidates = data.candidates;

                if (hasHouseNumber && reqHouseNumber) {
                    candidates = candidates.filter(c => {
                        const t = c.attributes ? c.attributes.Addr_type : '';
                        if (t === 'Locality' || t === 'Subregion' || t === 'StreetName' || t === 'Postal') return false;
                        const addNum = c.attributes ? (c.attributes.AddNum || c.attributes.HouseNum) : '';
                        if (addNum && addNum.trim() === reqHouseNumber.trim()) return true;
                        const label = (c.attributes ? (c.attributes.LongLabel || c.attributes.Match_addr) : c.address) || '';
                        return verifyHouseNumber({ display_name: label, address: { house_number: addNum } }, reqHouseNumber);
                    });
                }

                const cleanStreetQuery = queryText.replace(/^\d+\s*/, '').split(',')[0].trim();
                if (cleanStreetQuery) {
                    candidates = candidates.filter(c => {
                        const stName = c.attributes ? (c.attributes.StName || c.attributes.Match_addr || c.attributes.LongLabel) : (c.address || '');
                        return matchesStreetKeyword(stName, cleanStreetQuery);
                    });
                }

                const reqState = extractQueryState(queryText);
                if (reqState) {
                    candidates = candidates.filter(c => {
                        const fullText = (c.attributes && (c.attributes.LongLabel || c.attributes.Match_addr)) || c.address || '';
                        return matchesRequestedState(fullText, reqState);
                    });
                }

                const candidate = candidates[0];
                if (candidate && candidate.score >= 60 && candidate.location) {
                    const label = (candidate.attributes && (candidate.attributes.LongLabel || candidate.attributes.Match_addr)) || candidate.address || queryText;
                    return {
                        lat: parseFloat(candidate.location.y),
                        lon: parseFloat(candidate.location.x),
                        displayName: label,
                        source: 'Esri ArcGIS'
                    };
                }
            }
        } catch (e) {
            console.warn("ArcGIS geocode error:", e);
        }
        return null;
    }

    // Attempt 1: Query with location proximity bias if available
    if (typeof biasLat === 'number' && typeof biasLon === 'number') {
        const biasedResult = await queryArcGIS(biasLat, biasLon);
        if (biasedResult) return biasedResult;
        console.log("  ↳ Biased Esri query yielded no exact house number match. Retrying unbiased global Esri query...");
    }

    // Attempt 2: Unbiased global Esri query
    return await queryArcGIS(null, null);
}

function escapeRegExp(string) {
    if (typeof string !== 'string') return '';
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function verifyHouseNumber(item, requestedHouseNumber) {
    if (!requestedHouseNumber) return true;
    if (!item) return false;
    
    const reqClean = String(requestedHouseNumber).trim();
    if (item.address && item.address.house_number) {
        if (item.address.house_number.trim() === reqClean) return true;
    }

    const name = item.display_name || item.name || '';
    const safeNum = escapeRegExp(reqClean);
    const regex = new RegExp('^' + safeNum + '(?:$|[\\s,])', 'i');
    if (regex.test(name.trim())) return true;

    return false;
}

function isStreetCandidate(c) {
    if (!c) return false;
    if (c.class === 'highway' || c.class === 'building' || c.type === 'house' || c.type === 'building' || c.addresstype === 'road' || c.addresstype === 'house') {
        return true;
    }
    return false;
}

// 2. Nominatim API (for airports, IATA codes, cities, landmarks, and street addresses with auto suffix expansion)
async function fetchNominatimGeocode(queryText, biasLat = null, biasLon = null) {
    const houseMatch = queryText.trim().match(/^(\d+)/);
    const hasHouseNumber = !!houseMatch;
    const reqHouseNumber = houseMatch ? houseMatch[1] : null;
    const hasSuffix = /\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|way|boulevard|blvd|place|pl|circle|cir|trail|trl)\b/i.test(queryText);

    let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(queryText)}&format=json&addressdetails=1&limit=10`;
    if (typeof biasLat === 'number' && typeof biasLon === 'number') {
        const vb = `${biasLon - 5},${biasLat + 5},${biasLon + 5},${biasLat - 5}`;
        url += `&viewbox=${vb}`;
    }
    console.log("  ↳ Requesting Nominatim API:", url);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'RadarScopeApp/1.0' } });
        if (res.ok) {
            let data = await res.json();
            console.log("  ↳ Nominatim Response Data:", data);

            // Fallback: If full query returned no results (e.g. city name in unincorporated ETJ like Siena near Round Rock), try stripping city name
            if ((!data || data.length === 0) && queryText.includes(',')) {
                const parts = queryText.split(',').map(s => s.trim());
                if (parts.length >= 3) {
                    const simplified = `${parts[0]}, ${parts.slice(2).join(', ')}`;
                    console.log(`  ↳ Nominatim retrying without city name: "${simplified}"`);
                    const retryUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(simplified)}&format=json&addressdetails=1&limit=5`;
                    const retryRes = await fetch(retryUrl, { headers: { 'User-Agent': 'RadarScopeApp/1.0' } });
                    if (retryRes.ok) {
                        data = await retryRes.json();
                        console.log("  ↳ Nominatim Retry Response Data:", data);
                    }
                }
            }

            if (data && data.length > 0) {
                // If house number was input, strictly filter to verified road/building candidates that have the requested house number
                let valid = data;
                if (hasHouseNumber) {
                    valid = data.filter(c => isStreetCandidate(c) && verifyHouseNumber(c, reqHouseNumber));
                }
                const reqState = extractQueryState(queryText);
                if (reqState) {
                    valid = valid.filter(c => matchesRequestedState(c.display_name || c.name, reqState));
                }

                if (valid.length > 0) {
                    if (typeof biasLat === 'number' && typeof biasLon === 'number') {
                        valid.sort((a, b) => {
                            const distA = calcDistance(biasLat, biasLon, parseFloat(a.lat), parseFloat(a.lon));
                            const distB = calcDistance(biasLat, biasLon, parseFloat(b.lat), parseFloat(b.lon));
                            return distA - distB;
                        });
                    }
                    const item = valid[0];
                    return {
                        lat: parseFloat(item.lat),
                        lon: parseFloat(item.lon),
                        displayName: item.display_name || item.name || queryText,
                        source: 'Nominatim'
                    };
                }
            }
        }
    } catch (e) {
        console.warn("Nominatim geocode error:", e);
    }

    // Street Suffix Auto-Expansion: If user typed <number> <name> without a suffix (e.g. "314 Longmeadow"), try common street suffixes
    if (hasHouseNumber && !hasSuffix) {
        console.log(`  ↳ Query "${queryText}" typed with house number but without street suffix. Trying automatic street suffix expansion...`);
        const suffixes = ['Lane', 'Drive', 'Way', 'Road', 'Street', 'Court', 'Avenue'];
        for (const s of suffixes) {
            const expanded = `${queryText.trim()} ${s}`;
            let extUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(expanded)}&format=json&addressdetails=1&limit=5`;
            if (typeof biasLat === 'number' && typeof biasLon === 'number') {
                const vb = `${biasLon - 5},${biasLat + 5},${biasLon + 5},${biasLat - 5}`;
                extUrl += `&viewbox=${vb}`;
            }
            try {
                const extRes = await fetch(extUrl, { headers: { 'User-Agent': 'RadarScopeApp/1.0' } });
                if (extRes.ok) {
                    const extData = await extRes.json();
                    const extValid = extData.filter(c => isStreetCandidate(c) && verifyHouseNumber(c, reqHouseNumber));
                    if (extValid.length > 0) {
                        if (typeof biasLat === 'number' && typeof biasLon === 'number') {
                            extValid.sort((a, b) => {
                                const distA = calcDistance(biasLat, biasLon, parseFloat(a.lat), parseFloat(a.lon));
                                const distB = calcDistance(biasLat, biasLon, parseFloat(b.lat), parseFloat(b.lon));
                                return distA - distB;
                            });
                        }
                        const item = extValid[0];
                        console.log(`  ↳ Automatic Street Suffix Expansion Match ("${expanded}"):`, item.display_name);
                        return {
                            lat: parseFloat(item.lat),
                            lon: parseFloat(item.lon),
                            displayName: item.display_name || item.name || expanded,
                            source: 'Nominatim (Expanded Suffix)'
                        };
                    }
                }
            } catch (e) {
                console.warn(`Error during suffix expansion query "${expanded}":`, e);
            }
        }
    }

    // Directional Prefix Auto-Expansion (e.g., "314 Longmeadow Dr" -> "314 E Longmeadow Dr", "314 W Longmeadow Dr")
    if (hasHouseNumber && !/\b(e|w|n|s|east|west|north|south)\b/i.test(queryText)) {
        const match = queryText.trim().match(/^(\d+)\s+(.+)$/);
        if (match) {
            const num = match[1];
            const rest = match[2];
            const directionals = ['E', 'W', 'N', 'S'];
            for (const dir of directionals) {
                const dirQuery = `${num} ${dir} ${rest}`;
                let dirUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(dirQuery)}&format=json&addressdetails=1&limit=5`;
                if (typeof biasLat === 'number' && typeof biasLon === 'number') {
                    const vb = `${biasLon - 5},${biasLat + 5},${biasLon + 5},${biasLat - 5}`;
                    dirUrl += `&viewbox=${vb}`;
                }
                try {
                    const dirRes = await fetch(dirUrl, { headers: { 'User-Agent': 'RadarScopeApp/1.0' } });
                    if (dirRes.ok) {
                        const dirData = await dirRes.json();
                        const dirValid = dirData.filter(c => isStreetCandidate(c) && verifyHouseNumber(c, reqHouseNumber));
                        if (dirValid.length > 0) {
                            if (typeof biasLat === 'number' && typeof biasLon === 'number') {
                                dirValid.sort((a, b) => {
                                    const distA = calcDistance(biasLat, biasLon, parseFloat(a.lat), parseFloat(a.lon));
                                    const distB = calcDistance(biasLat, biasLon, parseFloat(b.lat), parseFloat(b.lon));
                                    return distA - distB;
                                });
                            }
                            const item = dirValid[0];
                            console.log(`  ↳ Directional Prefix Expansion Match ("${dirQuery}"):`, item.display_name);
                            return {
                                lat: parseFloat(item.lat),
                                lon: parseFloat(item.lon),
                                displayName: item.display_name || item.name || dirQuery,
                                source: 'Nominatim (Directional Prefix)'
                            };
                        }
                    }
                } catch (e) {
                    console.warn(`Error during directional expansion query "${dirQuery}":`, e);
                }
            }
        }
    }

    return null;
}

// 3. Photon API (Plain Text & Proximity)
async function fetchPhotonGeocode(queryText, latBias = null, lonBias = null) {
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(queryText)}&limit=5`;
    if (latBias !== null && lonBias !== null) {
        url += `&lat=${latBias}&lon=${lonBias}`;
    }
    console.log("  ↳ Requesting Photon API:", url);
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn("  ↳ Photon HTTP error:", res.status, res.statusText);
            return null;
        }
        const data = await res.json();
        console.log("  ↳ Photon Response Data:", data);
        if (data && data.features && data.features.length > 0) {
            const reqState = extractQueryState(queryText);
            if (reqState) {
                const stateMatchedFeatures = data.features.filter(f => {
                    const props = f.properties || {};
                    const fullText = [props.name, props.street, props.city, props.locality, props.county, props.state, props.country].filter(Boolean).join(', ');
                    return matchesRequestedState(fullText, reqState);
                });
                if (stateMatchedFeatures.length === 0) {
                    console.log(`  ↳ Photon candidates failed state boundary validation for "${reqState}". Returning null.`);
                    return null;
                }
                data.features = stateMatchedFeatures;
            }

            const cleanQuery = queryText.split(',')[0].trim();
            let chosen = data.features.find(f => {
                const name = f.properties && (f.properties.name || f.properties.street || f.properties.city);
                const matched = matchesStreetKeyword(name, cleanQuery);
                if (matched) console.log(`  ↳ String match filter PASSED for feature: "${name}" matching "${cleanQuery}"`);
                return matched;
            });
            
            if (!chosen) {
                console.log(`  ↳ No features passed strict keyword filter for "${cleanQuery}". Using top returned feature.`);
                chosen = data.features[0];
            }
            
            const coords = chosen.geometry.coordinates; // [lon, lat]
            const props = chosen.properties || {};
            const label = [props.name, props.city || props.locality, props.state || props.country].filter(Boolean).join(', ') || queryText;
            
            return {
                lat: parseFloat(coords[1]),
                lon: parseFloat(coords[0]),
                displayName: label,
                source: 'Photon'
            };
        }
    } catch (e) {
        console.warn("Photon geocode error:", e);
    }
    return null;
}

// Master Cascading Geocode Runner
async function executeCascadingGeocode(queryText) {
    const viewCenter = getActiveViewCenter();
    console.log(`%c[GEOCODE SEARCH]%c Query: "${queryText}" (View Center: ${viewCenter.lat.toFixed(4)}, ${viewCenter.lon.toFixed(4)})`, 'color: #00ff55; font-weight: bold;', 'color: inherit;');
    
    // 0. Airport & IATA/ICAO Code Priority Check (Strict: UPPERCASE 3/4-letter code like "SEA", "AUS", "SFO", "KAUS" or explicit "airport" keyword)
    const cleanQ = queryText.trim();
    const isStateName = ['OHIO', 'UTAH', 'IOWA', 'ROME', 'WACO'].includes(cleanQ.toUpperCase());
    const isExactAirportCode = (/^[A-Z]{3,4}$/.test(cleanQ) || /\bairport\b/i.test(cleanQ)) && !isStateName;
    if (isExactAirportCode) {
        console.log(`[GEOCODE] Step 0: Checking Airport/IATA Code Priority for "${cleanQ}"...`);
        const airportSearch = /airport\b/i.test(cleanQ) ? cleanQ : `${cleanQ} airport`;
        const airportRes = await fetchNominatimGeocode(airportSearch);
        if (airportRes) {
            console.log(`%c[GEOCODE MATCH]%c Airport priority match succeeded:`, 'color: #00ff55; font-weight: bold;', 'color: inherit;', airportRes);
            return airportRes;
        }
    }

    // 1. Try Esri ArcGIS World Geocoder (with active view center proximity bias)
    console.log(`[GEOCODE] Step 1: Querying Esri ArcGIS World Geocoder...`);
    const arcgisRes = await fetchArcGISGeocode(queryText, viewCenter.lat, viewCenter.lon);
    if (arcgisRes) {
        console.log(`%c[GEOCODE MATCH]%c Esri ArcGIS succeeded:`, 'color: #00ff55; font-weight: bold;', 'color: inherit;', arcgisRes);
        return arcgisRes;
    }
    console.log(`[GEOCODE] Step 1 (Esri ArcGIS): No match or only town/locality candidates.`);

    // 2. Try Nominatim (Airports / IATA / Cities / Landmarks / Street Addresses with ETJ fallback)
    console.log(`[GEOCODE] Step 2: Querying Nominatim API...`);
    const nomRes = await fetchNominatimGeocode(queryText, viewCenter.lat, viewCenter.lon);
    if (nomRes) {
        console.log(`%c[GEOCODE MATCH]%c Nominatim succeeded:`, 'color: #00ff55; font-weight: bold;', 'color: inherit;', nomRes);
        return nomRes;
    }
    console.log(`[GEOCODE] Step 2 (Nominatim): No match.`);

    // 3. Try Photon (Fallback Text Search)
    console.log(`[GEOCODE] Step 3: Querying Photon API (Fallback Text Search)...`);
    const photonRes = await fetchPhotonGeocode(queryText);
    if (photonRes) {
        console.log(`%c[GEOCODE MATCH]%c Photon succeeded:`, 'color: #00ff55; font-weight: bold;', 'color: inherit;', photonRes);
        return photonRes;
    }
    console.log(`[GEOCODE] Step 3 (Photon): No match.`);

    console.warn(`[GEOCODE FAILED] No result returned from any provider for query: "${queryText}"`);
    return null;
}

function initAddressSearchControls() {
    const searchPanel = document.getElementById('location-search-panel');
    const searchInput = document.getElementById('addr-search-input');
    const goBtn = document.getElementById('addr-search-go-btn');
    const previewInfo = document.getElementById('addr-preview-info');

    if (!searchPanel) return;

    const removeStagingMarker = () => {
        if (addressSearchStagingMarker && map) {
            map.removeLayer(addressSearchStagingMarker);
            addressSearchStagingMarker = null;
        }
    };

    const performSearch = async () => {
        const text = searchInput ? searchInput.value.trim() : '';
        if (!text) return;

        if (goBtn) {
            goBtn.disabled = true;
            goBtn.innerText = '...';
        }

        const result = await executeCascadingGeocode(text);

        if (goBtn) {
            goBtn.disabled = false;
            goBtn.innerText = 'GO';
        }

        if (result) {
            // Ensure selection mode is active if user typed into search without clicking SELECT LOCATION first
            const selectBtn = document.getElementById('location-select-btn');
            if (radarScope && !radarScope.isSelectionMode && selectBtn) {
                selectBtn.click();
            }

            // Update radarScope temp coordinates
            if (radarScope) {
                radarScope.tempLat = result.lat;
                radarScope.tempLon = result.lon;
                radarScope.isProgrammaticChange = true;
            }

            stagedTargetLat = result.lat;
            stagedTargetLon = result.lon;

            // Pan map to proposed location
            if (map) map.setView([stagedTargetLat, stagedTargetLon]);

            // Update sidebar input fields
            const latInput = document.getElementById('val-lat');
            const lonInput = document.getElementById('val-lon');
            if (latInput) latInput.value = stagedTargetLat.toFixed(5);
            if (lonInput) lonInput.value = stagedTargetLon.toFixed(5);

            // Add staging marker on map
            removeStagingMarker();
            if (map && typeof L !== 'undefined') {
                const icon = L.divIcon({
                    className: 'radar-staging-target',
                    html: '<div class="radar-staging-crosshair"></div>',
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });
                addressSearchStagingMarker = L.marker([stagedTargetLat, stagedTargetLon], { icon, interactive: false }).addTo(map);
            }

            // Sync staging marker position callback for radarScope map changes
            if (radarScope && radarScope.selectionCallbacks) {
                radarScope.selectionCallbacks.updateStagingMarkerPosition = (lat, lon) => {
                    if (addressSearchStagingMarker) {
                        addressSearchStagingMarker.setLatLng([lat, lon]);
                    }
                };
            }

            // Show proposed location label
            if (previewInfo) {
                previewInfo.style.display = 'block';
                previewInfo.innerText = `// PROPOSED: ${result.displayName.substring(0, 35)}`;
                previewInfo.title = result.displayName;
            }
        } else {
            alert(`No match found for "${text}". Please try adding a city, zip code, or house number.`);
        }
    };

    if (goBtn) goBtn.addEventListener('click', performSearch);
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') performSearch();
        });
    }

    // Clean up staging marker when selection mode exits via CONFIRM or CANCEL buttons
    const confirmBtn = document.getElementById('location-confirm-btn');
    const cancelBtn = document.getElementById('location-cancel-btn');

    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            removeStagingMarker();
            if (previewInfo) {
                previewInfo.style.display = 'none';
                previewInfo.innerText = '';
            }
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            removeStagingMarker();
            if (previewInfo) {
                previewInfo.style.display = 'none';
                previewInfo.innerText = '';
            }
        });
    }
}

