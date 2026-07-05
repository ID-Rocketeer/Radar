/**
 * RadarSidebar: Handles HTML DOM list updates, detail panel injections,
 * and target counters. Safe to instantiate in headless test environments.
 */
var RadarSidebar = class RadarSidebar {
    constructor(listContainerId, detailsContainerId, countId) {
        this.listContainer = listContainerId ? document.getElementById(listContainerId) : null;
        this.detailsContainer = detailsContainerId ? document.getElementById(detailsContainerId) : null;
        this.countElement = countId ? document.getElementById(countId) : null;
        this.domRowMap = {};
    }

    updateCount(count) {
        if (this.countElement) {
            this.countElement.innerText = count;
        }
    }

    renderList(filteredAc, selectedHex, classBEnabled, onSelectCallback) {
        if (!this.listContainer) return;

        if (filteredAc.length === 0) {
            this.listContainer.innerHTML = `<div class="empty-list-message">NO TARGETS MATCHING CURRENT SELECTION IN RANGE</div>`;
            this.domRowMap = {};
            return;
        }

        // Remove empty list message if it's there
        const emptyMsg = this.listContainer.querySelector('.empty-list-message');
        if (emptyMsg) {
            this.listContainer.removeChild(emptyMsg);
        }

        const currentHexes = new Set(filteredAc.map(ac => ac.hex));

        // Remove DOM elements for aircraft that are no longer in the list
        Object.keys(this.domRowMap).forEach(hex => {
            if (!currentHexes.has(hex)) {
                const el = this.domRowMap[hex];
                if (el && el.parentNode) {
                    el.parentNode.removeChild(el);
                }
                delete this.domRowMap[hex];
            }
        });

        // Reconcile and position rows
        filteredAc.forEach((ac, idx) => {
            const safeHex = sanitizeId(ac.hex);
            let item = this.domRowMap[ac.hex];

            if (!item) {
                item = document.createElement('div');
                item.id = `row-${safeHex}`;
                item.addEventListener('click', () => {
                    if (onSelectCallback) onSelectCallback(ac.hex);
                });
                this.domRowMap[ac.hex] = item;
            }

            // Apply updated classification classes
            const isB = classBEnabled && ac.isClassB;
            item.className = `target-item ${ac.mil ? 'mil' : ''} ${ac.isActiveWarbird ? 'warbird' : ''} ${isB ? 'special-b' : ''} ${selectedHex === ac.hex ? 'selected' : ''}`;

            // Build HTML content and replace only if changed to prevent browser paint loops
            const distVal = ac.dist || 0;
            const formattedDst = distVal < 10 ? distVal.toFixed(3) : distVal.toFixed(1);
            const htmlContent = `
                <span class="col-callsign lbl-callsign">${ac.callsign}</span>
                <span class="col-alt">${ac.isOnGround ? 'GND' : (ac.alt ? RadarSidebar.formatNumber(ac.alt) : '0')}</span>
                <span class="col-spd">${ac.speed ? ac.speed : '0'}</span>
                <span class="col-dst">${formattedDst}</span>
            `;
            if (item.innerHTML !== htmlContent) {
                item.innerHTML = htmlContent;
            }

            // Maintain correct sorting positions in the list
            const childAtIdx = this.listContainer.children[idx];
            if (childAtIdx) {
                if (childAtIdx !== item) {
                    this.listContainer.insertBefore(item, childAtIdx);
                }
            } else {
                this.listContainer.appendChild(item);
            }
        });
    }

    updateRow(ac) {
        const safeHex = sanitizeId(ac.hex);
        const rowEl = document.getElementById(`row-${safeHex}`);
        if (rowEl && rowEl.children.length >= 4) {
            const altText = ac.isOnGround ? 'GND' : (ac.alt ? RadarSidebar.formatNumber(ac.alt) : '0');
            const spdText = ac.speed ? ac.speed.toString() : '0';
            const distVal = ac.dist || 0;
            const dstText = distVal < 10 ? distVal.toFixed(3) : distVal.toFixed(1);

            const altEl = rowEl.children[1];
            const spdEl = rowEl.children[2];
            const dstEl = rowEl.children[3];

            if (altEl && altEl.textContent !== altText) altEl.textContent = altText;
            if (spdEl && spdEl.textContent !== spdText) spdEl.textContent = spdText;
            if (dstEl && dstEl.textContent !== dstText) dstEl.textContent = dstText;
        }
    }

    renderDetails(ac, isTracked, classBEnabled, onHexClickCallback) {
        if (!this.detailsContainer) return;

        const headingText = RadarSidebar.getHeadingDirection(ac.track);

        this.detailsContainer.innerHTML = `
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
                <span class="tel-val">${ac.isOnGround ? 'GND' : (ac.alt ? RadarSidebar.formatNumber(ac.alt) + ' FT' : '0 FT')}</span>
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
                <span class="tel-val">${(ac.dist || 0) < 10 ? (ac.dist || 0).toFixed(3) : (ac.dist || 0).toFixed(1)} NM</span>
            </div>
            <div class="tel-row">
                <span class="tel-label">SQUAWK CODE:</span>
                <span class="tel-val">${ac.squawk}</span>
            </div>
            <div class="tel-row">
                <span class="tel-label">CLASSIFICATION:</span>
                <span class="tel-val ${ac.mil ? 'alert' : (ac.isActiveWarbird ? 'warbird' : (classBEnabled && ac.isClassB ? 'special-b' : ''))}">
                    ${ac.mil ? `MILITARY SECURE (${(ac.iconType || 'jet').toUpperCase().replace('_', ' ')})` : 
                      (ac.isActiveWarbird ? `WARBIRD (${ac.warbirdSubtype})` : 
                      (ac.isClassB ? 
                        (classBEnabled ? `CLASS B (${ac.specialBSubtype})` : `CIVILIAN AIR TRAFFIC (${ac.specialBSubtype})`) : 
                        `CIVILIAN AIR TRAFFIC (${(ac.iconType || 'jet').toUpperCase().replace('_', ' ')})`))}
                </span>
            </div>
        `;

        // Attach click event listener for the hex tracker toggle
        const toggleBtn = document.getElementById(`hex-toggle-${ac.hex}`);
        if (toggleBtn && onHexClickCallback) {
            toggleBtn.addEventListener('click', () => {
                onHexClickCallback(ac);
            });
        }
    }

    resetDetails() {
        if (this.detailsContainer) {
            this.detailsContainer.innerHTML = `<div class="empty-telemetry">NO TARGET ACQUIRED. SELECT A TARGET FROM THE RADAR SCREEN OR LIST PANEL.</div>`;
        }
    }

    static getHeadingDirection(degrees) {
        const val = Math.floor((degrees / 22.5) + 0.5);
        const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
        return arr[(val % 16)];
    }

    static formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
};

/**
 * RadarScope: Manages Leaflet map state, coordinates center shifts,
 * range rings scaling, filter selections, and delegates sidebar rendering.
 */
var RadarScope = class RadarScope {
    constructor(mapContainerId, options = {}) {
        this.mapId = mapContainerId;
        this.homeLat = options.homeLat || -40.5472;
        this.homeLon = options.homeLon || 175.4107;
        this.rangeNm = options.rangeNm || 100;
        
        this.activeFilter = 'all';
        this.lowAltitudeFilterEnabled = false;
        this.classBEnabled = true;
        this.trailsEnabled = true;

        this.selectedHex = null;
        this.trackedHex = null;

        this.map = null;
        this.crosshair = null;
        this.rangeRings = [];
        this.onCenterChanged = null;

        this.sidebar = new RadarSidebar('target-list', 'telemetry-display', 'target-count');

        // Manual Location Selection/Calibration Mode State
        this.isSelectionMode = false;
        this.tempLat = 0;
        this.tempLon = 0;
        this.tempRange = 0;
        this.isProgrammaticChange = false;
        this.sweepMarker = null;
    }

    init() {
        if (typeof L === 'undefined') return;

        this.map = L.map(this.mapId, {
            zoomControl: false,
            attributionControl: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            dragging: false,
            scrollWheelZoom: 'center',
            touchZoom: 'center',
            zoomSnap: 0,
            zoomDelta: 0.5,
            renderer: L.svg({ padding: 0 })
        }).setView([this.homeLat, this.homeLon], 8);


        this.map.createPane('sweepPane', this.map.getPane('mapPane'));
        this.map.getPane('sweepPane').style.zIndex = 450;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 20,
            minZoom: 0
        }).addTo(this.map);

        // Draw range rings
        this.drawRangeRings();

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
        const marker = L.marker([this.homeLat, this.homeLon], { icon: homeIcon, interactive: false });
        marker.addTo(this.map);
        this.crosshair = marker;
    }

    drawRangeRings() {
        if (!this.map) return;

        // Clear existing rings
        this.rangeRings.forEach(ring => {
            if (ring && this.map && this.map.hasLayer(ring)) {
                this.map.removeLayer(ring);
            }
        });
        this.rangeRings = [];

        const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
        ringFactors.forEach(factor => {
            const distance = factor * this.rangeNm;
            const ring = L.circle([this.homeLat, this.homeLon], {
                radius: distance * 1852,
                color: '#00ff55',
                weight: 1,
                opacity: 0.35,
                dashArray: '3, 8',
                fill: false,
                interactive: false
            });
            ring.addTo(this.map);
            this.rangeRings.push(ring);
        });
    }

    setCenter(lat, lon) {
        this.homeLat = lat;
        this.homeLon = lon;

        this.isProgrammaticChange = true;
        try {
            if (this.map) {
                this.map.setView([lat, lon], this.map.getZoom(), { animate: false });
            }
            if (this.crosshair && typeof this.crosshair.setLatLng === 'function') {
                this.crosshair.setLatLng([lat, lon]);
            }
            this.rangeRings.forEach(ring => {
                if (ring && typeof ring.setLatLng === 'function') {
                    ring.setLatLng([lat, lon]);
                }
            });
        } finally {
            this.isProgrammaticChange = false;
        }

        // Fire coordinate update callback if registered
        if (this.onCenterChanged) {
            this.onCenterChanged(lat, lon);
        }
    }

    setRange(nm) {
        this.rangeNm = nm;
        if (this.map) {
            this.drawRangeRings();
        }
    }

    // Filter selectors
    setFilter(filterType) { this.activeFilter = filterType; }
    toggleLowAltitude(enabled) { this.lowAltitudeFilterEnabled = enabled; }
    toggleClassB(enabled) { this.classBEnabled = enabled; }
    toggleTrails(enabled) { this.trailsEnabled = enabled; }

    selectTarget(hex) {
        this.selectedHex = hex;
    }

    trackTarget(hex) {
        this.trackedHex = hex;
    }

    repaint(activeAircraft) {
        let visibleCount = 0;

        Object.keys(activeAircraft).forEach(hex => {
            const ac = activeAircraft[hex];
            if (!ac) return;

            let visible = true;
            if (this.isSelectionMode) {
                visible = false;
            } else {
                if (this.activeFilter === 'mil' && !(ac.mil || ac.isActiveWarbird)) visible = false;
                else if (this.activeFilter === 'commercial' && !ac.isCommercial) visible = false;
                else if (this.activeFilter === 'ga' && (ac.mil || ac.isCommercial)) visible = false;

                // Low Altitude filter check
                if (visible && this.lowAltitudeFilterEnabled && ac.alt >= 18000) {
                    visible = false;
                }

                // Viewport bounds pruning check
                const displayedRange = typeof getDisplayedRange === 'function' ? getDisplayedRange() : this.rangeNm;
                if (visible && ac.dist > displayedRange) {
                    visible = false;
                }

                // Hide if not swept once yet
                if (visible && !ac.sweptOnce) {
                    visible = false;
                }
            }

            if (this.map) {
                ac.render(this.map, visible, this.trailsEnabled, this.classBEnabled);
            }

            if (!ac.pendingRemoval && ac.visible) {
                visibleCount++;
            }
        });

        // Update trail scaling based on visible count
        if (typeof maxTrailPoints !== 'undefined') {
            if (visibleCount > 300) {
                maxTrailPoints = 20;
            } else if (visibleCount > 100) {
                maxTrailPoints = 60;
            } else {
                maxTrailPoints = 120;
            }
        }

        // Calculate sweep batch sector size
        if (typeof sweepBatchSectorSize !== 'undefined') {
            sweepBatchSectorSize = Math.max(1, Math.floor((visibleCount + 360) / 360));
        }

        // Refresh sidebar displays
        this.updateSidebarList(activeAircraft);
    }

    updateSidebarList(activeAircraft) {
        // Filter and sort active aircraft list
        const filteredAc = Object.values(activeAircraft).filter(ac => {
            if (!ac.sweptOnce) return false;
            if (this.lowAltitudeFilterEnabled && ac.alt >= 18000) return false;
            if (this.activeFilter === 'mil') return ac.mil || ac.isActiveWarbird;
            if (this.activeFilter === 'commercial') return ac.isCommercial;
            if (this.activeFilter === 'ga') return !ac.mil && !ac.isCommercial;
            return true;
        });

        filteredAc.sort((a, b) => {
            if (typeof warbirdModeActive !== 'undefined' && warbirdModeActive) {
                const aWb = a.isWarbird;
                const bWb = b.isWarbird;
                if (aWb && !bWb) return -1;
                if (!aWb && bWb) return 1;
            }
            if (this.classBEnabled) {
                const aB = a.isClassB;
                const bB = b.isClassB;
                if (aB && !bB) return -1;
                if (!aB && bB) return 1;
            }
            if (a.mil && !b.mil) return -1;
            if (!a.mil && b.mil) return 1;
            return a.dist - b.dist;
        });

        if (this.sidebar) {
            this.sidebar.updateCount(filteredAc.length);
            const selectedHexVal = typeof selectedHex !== 'undefined' ? selectedHex : this.selectedHex;
            this.sidebar.renderList(filteredAc, selectedHexVal, this.classBEnabled, typeof selectAircraft === 'function' ? selectAircraft : null);
        }
    }

    initLocationSelection(callbacks) {
        this.callbacks = callbacks;
        const selectBtn = document.getElementById('location-select-btn');
        const locateBtn = document.getElementById('location-locate-btn');
        const confirmBtn = document.getElementById('location-confirm-btn');
        const cancelBtn = document.getElementById('location-cancel-btn');

        if (selectBtn) {
            selectBtn.addEventListener('click', () => this.enterSelectionMode(callbacks));
        }
        if (locateBtn) {
            locateBtn.addEventListener('click', () => this.handleGPSLocate(callbacks));
        }
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.exitSelectionMode(true, callbacks));
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.exitSelectionMode(false, callbacks));
        }

        const latInput = document.getElementById('val-lat');
        const lonInput = document.getElementById('val-lon');
        const rangeInput = document.getElementById('val-range');

        const handleManualConfigChange = () => {
            if (!this.isSelectionMode) return;

            let newLat = parseFloat(latInput.value);
            let newLon = parseFloat(lonInput.value);
            let newRange = parseFloat(rangeInput.value);

            if (isNaN(newLat)) newLat = this.tempLat;
            if (isNaN(newLon)) newLon = this.tempLon;
            if (isNaN(newRange)) newRange = this.tempRange;

            // Clamp latitude to Web Mercator limits and normalize longitude beyond +/-180
            newLat = callbacks.normalizeLat(newLat);
            newLon = callbacks.normalizeLon(newLon);
            const inputRangeClamped = Math.max(0.001, Math.min(newRange, 20000));

            this.tempLat = newLat;
            this.tempLon = newLon;
            this.tempRange = Math.max(2, Math.min(newRange, 20000));

            // Sync inputs with the parsed/clamped values in case they typed out of bounds
            latInput.value = this.tempLat.toFixed(5);
            lonInput.value = this.tempLon.toFixed(5);
            const rangeVal = inputRangeClamped;
            rangeInput.value = rangeVal < 10 ? rangeVal.toFixed(3) : rangeVal.toFixed(1);

            // Set the programmatic change flag to prevent race conditions during setView
            this.isProgrammaticChange = true;

            // Temporarily unbind map moveend events to prevent loop feedback
            this.map.off('move drag zoom', this._boundSelectionMapChange);

            // Allow global zoom out (0) up to level 20
            const minZoomSelection = 0;
            const maxZoomSelection = 20;
            this.map.setMinZoom(minZoomSelection);
            this.map.setMaxZoom(maxZoomSelection);

            const targetZoom = callbacks.getZoomForRange(inputRangeClamped);
            this.map.setView([this.tempLat, this.tempLon], targetZoom, { animate: false });

            // Redraw rings around the new target center
            const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
            this.rangeRings.forEach((ring, idx) => {
                const factor = ringFactors[idx] || 1.0;
                ring.setLatLng([this.tempLat, this.tempLon]);
                ring.setRadius(factor * this.tempRange * 1852);
                if (!this.map.hasLayer(ring)) ring.addTo(this.map);
            });

            // Re-enable event listeners
            this.map.on('move drag zoom', this._boundSelectionMapChange);

            // Safely clear programmatic change flag after Leaflet finishes event loop updates
            let programmaticTimer = null;
            const clearProgrammatic = () => {
                this.isProgrammaticChange = false;
                this.map.off('moveend zoomend', clearProgrammatic);
                if (programmaticTimer) {
                    clearTimeout(programmaticTimer);
                    programmaticTimer = null;
                }
            };
            this.map.on('moveend zoomend', clearProgrammatic);
            programmaticTimer = setTimeout(clearProgrammatic, 250);
        };

        if (latInput) latInput.addEventListener('change', handleManualConfigChange);
        if (lonInput) lonInput.addEventListener('change', handleManualConfigChange);
        if (rangeInput) rangeInput.addEventListener('change', handleManualConfigChange);

        // Also trigger confirm if the user presses Enter in any input
        const handleKeyPress = (e) => {
            if (e.key === 'Enter') {
                e.target.blur(); // Triggers change event
                this.exitSelectionMode(true, callbacks);
            }
        };
        if (latInput) latInput.addEventListener('keydown', handleKeyPress);
        if (lonInput) lonInput.addEventListener('keydown', handleKeyPress);
        if (rangeInput) rangeInput.addEventListener('keydown', handleKeyPress);
    }

    enterSelectionMode(callbacks) {
        this.isSelectionMode = true;
        this.tempLat = callbacks.getHomeLat();
        this.tempLon = callbacks.getHomeLon();
        const currentDisplayed = callbacks.getDisplayedRange();
        this.tempRange = Math.max(2, currentDisplayed);

        // Pause target polling and sweep line rotation
        callbacks.stopPolling();
        callbacks.setSweepActive(false);
        
        // Hide rotating sweep line overlay
        const sweepEl = document.getElementById('sweep-line');
        if (sweepEl) sweepEl.style.display = 'none';

        // Clear active aircraft markers and trails from Leaflet map
        callbacks.clearActiveMarkers();

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
        const classBBtn = document.getElementById('class-b-toggle');
        if (classBBtn) classBBtn.style.display = 'none';
        document.getElementById('location-locate-btn').style.display = 'inline-block';
        document.getElementById('location-confirm-btn').style.display = 'inline-block';
        document.getElementById('location-cancel-btn').style.display = 'inline-block';

        // Enable map dragging
        this.map.dragging.enable();

        // Make configuration inputs editable during location selection
        const latInput = document.getElementById('val-lat');
        const lonInput = document.getElementById('val-lon');
        const rangeInput = document.getElementById('val-range');
        if (latInput) latInput.removeAttribute('readonly');
        if (lonInput) lonInput.removeAttribute('readonly');
        if (rangeInput) rangeInput.removeAttribute('readonly');

        // Display raw numerical values
        if (latInput) latInput.value = this.tempLat.toFixed(5);
        if (lonInput) lonInput.value = this.tempLon.toFixed(5);
        if (rangeInput) {
            const rangeVal = currentDisplayed;
            rangeInput.value = rangeVal < 10 ? rangeVal.toFixed(3) : rangeVal.toFixed(1);
        }

        // Allow global zoom out (0) up to high-precision zoom level (20) during selection
        const minZoomSelection = 0;
        const maxZoomSelection = 20;
        
        this.map.setMinZoom(minZoomSelection);
        this.map.setMaxZoom(maxZoomSelection);

        // Keep map center and clamp zoom level strictly within calculated bounds
        this.isProgrammaticChange = true;
        const currentZoom = this.map.getZoom();
        const targetZoom = Math.max(minZoomSelection, Math.min(currentZoom, maxZoomSelection));
        this.map.setView([this.tempLat, this.tempLon], targetZoom, { animate: false });

        // Bind Leaflet map drag/zoom events
        this._boundSelectionMapChange = () => this.handleSelectionMapChange(callbacks);
        this.map.on('move drag zoom', this._boundSelectionMapChange);

        let programmaticTimer = null;
        const clearProgrammatic = () => {
            this.isProgrammaticChange = false;
            this.map.off('moveend zoomend', clearProgrammatic);
            if (programmaticTimer) {
                clearTimeout(programmaticTimer);
                programmaticTimer = null;
            }
        };
        this.map.on('moveend zoomend', clearProgrammatic);
        programmaticTimer = setTimeout(clearProgrammatic, 250);
    }

    handleSelectionMapChange(callbacks) {
        if (!this.isSelectionMode || this.isProgrammaticChange) return;

        const center = this.map.getCenter();
        this.tempLat = center.lat;
        this.tempLon = center.lng;

        // Calculate current scope range by measuring distance from center to bezel edge in pixels
        const bezelDiameter = callbacks.getBezelDiameter();
        const visibleRadiusPx = bezelDiameter * 0.47;
        const centerPoint = this.map.latLngToLayerPoint(center);
        const edgeLatLng = this.map.layerPointToLatLng([centerPoint.x + visibleRadiusPx, centerPoint.y]);
        
        let displayedRange = callbacks.calcDistance(this.tempLat, this.tempLon, edgeLatLng.lat, edgeLatLng.lng);
        this.tempRange = Math.max(2, displayedRange);

        // Update sidebar UI text readouts in real-time (but don't overwrite user's typing active state)
        const latInput = document.getElementById('val-lat');
        const lonInput = document.getElementById('val-lon');
        const rangeInput = document.getElementById('val-range');

        if (latInput && document.activeElement !== latInput) {
            latInput.value = this.tempLat.toFixed(5);
        }
        if (lonInput && document.activeElement !== lonInput) {
            lonInput.value = this.tempLon.toFixed(5);
        }
        if (rangeInput && document.activeElement !== rangeInput) {
            const rangeVal = displayedRange;
            rangeInput.value = rangeVal < 10 ? rangeVal.toFixed(3) : rangeVal.toFixed(1);
        }

        // Rescale and center Leaflet range rings around the new target center
        const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
        this.rangeRings.forEach((ring, idx) => {
            const factor = ringFactors[idx] || 1.0;
            ring.setLatLng(center);
            ring.setRadius(factor * this.tempRange * 1852);
            
            // Force rings to be visible (in case they were culled at closer zooms previously)
            if (!this.map.hasLayer(ring)) {
                ring.addTo(this.map);
            }
        });
    }

    exitSelectionMode(confirmChanges, callbacks) {
        this.isSelectionMode = false;

        // Unbind Leaflet events
        if (this._boundSelectionMapChange) {
            this.map.off('move drag zoom', this._boundSelectionMapChange);
        }

        // Disable map dragging
        this.map.dragging.disable();

        // Toggle button visibility back to default
        document.getElementById('location-select-btn').style.display = 'inline-block';
        const classBBtn = document.getElementById('class-b-toggle');
        if (classBBtn) classBBtn.style.display = 'inline-block';
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
        this.map.setMinZoom(4);
        this.map.setMaxZoom(20);

        if (confirmChanges) {
            // Commit changes to system variables and normalize them
            const finalLat = callbacks.normalizeLat(this.tempLat);
            const finalLon = callbacks.normalizeLon(this.tempLon);
            const finalRange = Math.min(this.tempRange, 250); // Snap range back to API limit of 250 NM

            callbacks.setHomeLat(finalLat);
            callbacks.setHomeLon(finalLon);
            callbacks.setRangeNm(finalRange);

            this.homeLat = finalLat;
            this.homeLon = finalLon;
            this.rangeNm = finalRange;
            // Update address bar query parameters dynamically without a page refresh
            try {
                const newUrl = `${window.location.pathname}?lat=${finalLat.toFixed(5)}&lon=${finalLon.toFixed(5)}&rng=${Math.round(finalRange)}`;
                window.history.pushState({ path: newUrl }, '', newUrl);
            } catch (historyError) {
                console.warn("Silent fallback: window.history.pushState is blocked in this browser context (e.g. file:/// URL).", historyError);
            }

            // Snap map view center
            this.map.setView([finalLat, finalLon]);

            // Clear active target tracking registry and bearings
            callbacks.clearActiveMarkers();
            callbacks.clearActiveAircraftRegistry();
            callbacks.resetTelemetryDisplay();

            // Refresh sidebar lists
            callbacks.updateTargetList();
        } else {
            // Cancel changes: revert map position to original home coordinates
            const origLat = callbacks.getHomeLat();
            const origLon = callbacks.getHomeLon();
            this.map.setView([origLat, origLon]);
        }

        // Reset zoom snap and snap the zoom level to match the new or original range ring diameter
        callbacks.updateMinZoom();
        callbacks.updateSweepSize();
        callbacks.recalculateDisplayedRange();
        callbacks.updateDisplayedRange();

        // Redraw and lock range rings back to center with proper range
        const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
        const hLat = callbacks.getHomeLat();
        const hLon = callbacks.getHomeLon();
        const rNm = callbacks.getRangeNm();
        this.rangeRings.forEach((ring, idx) => {
            const factor = ringFactors[idx] || 1.0;
            ring.setLatLng([hLat, hLon]);
            ring.setRadius(factor * rNm * 1852);
        });

        // Relocate home crosshair marker to new coordinates
        if (this.crosshair) {
            this.crosshair.setLatLng([hLat, hLon]);
        }

        // Relocate rotating sweep marker center to new coordinates
        if (this.sweepMarker) {
            this.sweepMarker.setLatLng([hLat, hLon]);
        }

        // Sync the inputs with final values
        callbacks.updateUIConfigurationValues();

        // Resume polling and start sweep line animation
        callbacks.startPolling();
        callbacks.setSweepActive(true);
        
        const sweepEl = document.getElementById('sweep-line');
        if (sweepEl) {
            sweepEl.style.display = 'block';
            callbacks.updateSweepSize();
        }
    }

    handleGPSLocate(callbacks) {
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
        const performLocate = (highAccuracy) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    locateBtn.innerText = originalText;
                    locateBtn.disabled = false;

                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;

                    // Update selection state coordinates
                    this.tempLat = callbacks.normalizeLat(lat);
                    this.tempLon = callbacks.normalizeLon(lon);

                    // Re-center Leaflet map (this automatically triggers handleSelectionMapChange)
                    this.map.setView([this.tempLat, this.tempLon]);
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

                        callbacks.getIPLocation().then((coords) => {
                            if (coords) {
                                locateBtn.innerText = originalText;
                                locateBtn.disabled = false;

                                this.tempLat = callbacks.normalizeLat(coords.lat);
                                this.tempLon = callbacks.normalizeLon(coords.lon);

                                this.map.setView([this.tempLat, this.tempLon]);
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
                { enableHighAccuracy: highAccuracy, timeout: 5000, maximumAge: 0 }
            );
        };

        performLocate(true);
    }
};
