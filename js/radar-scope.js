// RadarSidebar class has been extracted to js/radar-sidebar.js

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

        // Manual Location Selection/Calibration Mode State
        this.isSelectionMode = false;
        this.tempLat = 0;
        this.tempLon = 0;
        this.tempRange = 0;
        this.isProgrammaticChange = false;
        this.sweepMarker = null;

        // Weather Radar state properties
        this.weatherEnabled = false;
        this.weatherLayer = null;
        this.weatherProvider = null;
        this.weatherFetchId = 0;
        this.weatherUpdateTimeout = null;
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


        this.map.createPane('weatherPane', this.map.getPane('mapPane'));
        this.map.getPane('weatherPane').style.zIndex = 250;

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

        const container = this.map.getContainer ? this.map.getContainer() : null;
        if (container) {
            container.addEventListener('wheel', (e) => {
                if (this.isSelectionMode) return;
                if (e.deltaY > 0) {
                    const currentMinZoom = this.map.getMinZoom();
                    const zoomDelta = this.map.options.zoomDelta || 0.5;
                    const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
                    const standardDeltaY = isFirefox ? 3 : 100;
                    const estimatedZoomChange = Math.max(0.05, (e.deltaY / standardDeltaY) * zoomDelta);
                    
                    if (this.map.getZoom() - estimatedZoomChange <= currentMinZoom + 0.01) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }
            }, { capture: true, passive: false });
        }

        this.map.on('dragstart', () => {
            if (!this.isSelectionMode) return;
            if (this.weatherUpdateTimeout) {
                clearTimeout(this.weatherUpdateTimeout);
                this.weatherUpdateTimeout = null;
            }
            if (this.weatherLayer) {
                this.map.removeLayer(this.weatherLayer);
                this.weatherLayer = null;
            }
            // Clear active provider so the next moveend is forced to rebuild/reload it
            this.weatherProvider = null;
        });

        this.map.on('moveend', () => {
            if (this.isProgrammaticChange) return;
            if (!this.weatherEnabled) return;

            if (this.weatherUpdateTimeout) {
                clearTimeout(this.weatherUpdateTimeout);
            }

            this.weatherUpdateTimeout = setTimeout(() => {
                this.updateWeatherLayer();
                this.weatherUpdateTimeout = null;
            }, 500);
        });

        if (this.weatherEnabled) {
            this.updateWeatherLayer();
        }
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

        if (this.weatherEnabled) {
            this.updateWeatherLayer();
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

    }

    initLocationSelection(callbacks) {
        this.callbacks = callbacks;
        this.selectionCallbacks = callbacks;
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
            rangeInput.value = inputRangeClamped < 10 ? inputRangeClamped.toFixed(3) : inputRangeClamped.toFixed(1);

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

        // Toggle button visibilities in sidebar and show location search panel
        document.getElementById('location-select-btn').style.display = 'none';
        const classBBtn = document.getElementById('class-b-toggle');
        if (classBBtn) classBBtn.style.display = 'none';
        const wxBtn = document.getElementById('wx-toggle');
        if (wxBtn) wxBtn.style.display = 'none';
        document.getElementById('location-locate-btn').style.display = 'inline-block';
        document.getElementById('location-confirm-btn').style.display = 'inline-block';
        document.getElementById('location-cancel-btn').style.display = 'inline-block';

        const defaultControls = document.getElementById('default-panel-controls');
        const searchPanel = document.getElementById('location-search-panel');
        if (defaultControls) defaultControls.style.display = 'none';
        if (searchPanel) searchPanel.classList.add('active');

        // Enable map dragging and lock scroll wheel zoom to center
        this.map.dragging.enable();
        if (this.map.scrollWheelZoom) {
            this.map.scrollWheelZoom.disable();
            this.map.options.scrollWheelZoom = 'center';
            this.map.options.touchZoom = 'center';
            this.map.scrollWheelZoom.enable();
        }

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
            rangeInput.value = currentDisplayed < 10 ? currentDisplayed.toFixed(3) : currentDisplayed.toFixed(1);
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

        this.isZooming = false;

        // Unbind any previous selection listeners to prevent leaks if enterSelectionMode is called repeatedly
        if (this._boundSelectionMapDrag) {
            this.map.off('drag moveend', this._boundSelectionMapDrag);
        }
        if (this._boundSelectionMapZoom) {
            this.map.off('zoomend', this._boundSelectionMapZoom);
        }

        // Bind Leaflet map drag/zoom events
        this._boundSelectionMapDrag = () => this.handleSelectionMapDrag(callbacks);
        this._boundSelectionMapZoom = () => this.handleSelectionMapZoom(callbacks);

        this.map.on('drag moveend', this._boundSelectionMapDrag);
        this.map.on('zoomend', this._boundSelectionMapZoom);

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

    updateTempRangeFromMap(callbacks) {
        if (!this.map || !callbacks) return;
        const center = this.map.getCenter();
        const bezelDiameter = callbacks.getBezelDiameter ? callbacks.getBezelDiameter() : 600;
        const visibleRadiusPx = bezelDiameter * 0.47;
        const centerPoint = this.map.latLngToLayerPoint(center);
        const edgeLatLng = this.map.layerPointToLatLng([centerPoint.x + visibleRadiusPx, centerPoint.y]);
        
        let displayedRange = callbacks.calcDistance ? callbacks.calcDistance(this.tempLat, this.tempLon, edgeLatLng.lat, edgeLatLng.lng) : this.tempRange;
        if (displayedRange && !isNaN(displayedRange)) {
            this.tempRange = Math.max(2, displayedRange);
        }

        const rangeInput = document.getElementById('val-range');
        if (rangeInput && document.activeElement !== rangeInput) {
            rangeInput.value = this.tempRange < 10 ? this.tempRange.toFixed(3) : this.tempRange.toFixed(1);
        }
    }

    handleSelectionMapDrag(callbacks) {
        if (!this.isSelectionMode || this.isProgrammaticChange) return;

        const center = this.map.getCenter();
        this.tempLat = center.lat;
        this.tempLon = center.lng;

        if (callbacks.updateStagingMarkerPosition) {
            callbacks.updateStagingMarkerPosition(this.tempLat, this.tempLon);
        }

        this.updateTempRangeFromMap(callbacks);

        const latInput = document.getElementById('val-lat');
        const lonInput = document.getElementById('val-lon');

        if (latInput && document.activeElement !== latInput) {
            latInput.value = this.tempLat.toFixed(5);
        }
        if (lonInput && document.activeElement !== lonInput) {
            lonInput.value = this.tempLon.toFixed(5);
        }

        const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
        this.rangeRings.forEach((ring, idx) => {
            const factor = ringFactors[idx] || 1.0;
            ring.setLatLng(center);
            ring.setRadius(factor * this.tempRange * 1852);
            if (!this.map.hasLayer(ring)) {
                ring.addTo(this.map);
            }
        });
    }

    handleSelectionMapZoom(callbacks) {
        if (!this.isSelectionMode || this.isProgrammaticChange) return;

        this.isProgrammaticChange = true;
        this.map.setView([this.tempLat, this.tempLon], this.map.getZoom(), { animate: false });

        if (callbacks.updateStagingMarkerPosition) {
            callbacks.updateStagingMarkerPosition(this.tempLat, this.tempLon);
        }

        this.updateTempRangeFromMap(callbacks);

        const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
        this.rangeRings.forEach((ring, idx) => {
            const factor = ringFactors[idx] || 1.0;
            ring.setLatLng([this.tempLat, this.tempLon]);
            ring.setRadius(factor * this.tempRange * 1852);
            if (!this.map.hasLayer(ring)) {
                ring.addTo(this.map);
            }
        });

        setTimeout(() => {
            this.isProgrammaticChange = false;
        }, 50);
    }

    exitSelectionMode(confirmChanges, callbacks) {
        this.isSelectionMode = false;

        if (callbacks && typeof callbacks.onExitSelectionMode === 'function') {
            callbacks.onExitSelectionMode();
        }

        // Unbind Leaflet events
        if (this._boundSelectionMapDrag) {
            this.map.off('drag moveend', this._boundSelectionMapDrag);
        }
        if (this._boundSelectionMapZoom) {
            this.map.off('zoomend', this._boundSelectionMapZoom);
        }

        // Disable map dragging and restore default scroll wheel zoom
        this.map.dragging.disable();
        if (this.map.scrollWheelZoom) {
            this.map.scrollWheelZoom.disable();
            this.map.options.scrollWheelZoom = 'center';
            this.map.options.touchZoom = 'center';
            this.map.scrollWheelZoom.enable();
        }

        // Toggle button visibility back to default
        document.getElementById('location-select-btn').style.display = 'inline-block';
        const classBBtn = document.getElementById('class-b-toggle');
        if (classBBtn) classBBtn.style.display = 'inline-block';
        const wxBtn = document.getElementById('wx-toggle');
        if (wxBtn) wxBtn.style.display = 'inline-block';
        document.getElementById('location-locate-btn').style.display = 'none';
        document.getElementById('location-confirm-btn').style.display = 'none';
        document.getElementById('location-cancel-btn').style.display = 'none';

        const defaultControls = document.getElementById('default-panel-controls');
        const searchPanel = document.getElementById('location-search-panel');
        const searchInput = document.getElementById('addr-search-input');
        const previewInfo = document.getElementById('addr-preview-info');
        if (searchPanel) searchPanel.classList.remove('active');
        if (defaultControls) defaultControls.style.display = 'flex';
        if (searchInput) searchInput.value = '';
        if (previewInfo) {
            previewInfo.style.display = 'none';
            previewInfo.innerText = '';
        }

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
            this.updateTempRangeFromMap(callbacks);
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
                const formattedRange = finalRange < 10 ? finalRange.toFixed(3) : finalRange.toFixed(1);
                const newUrl = `${window.location.pathname}?lat=${finalLat.toFixed(5)}&lon=${finalLon.toFixed(5)}&rng=${formattedRange}`;
                window.history.pushState({ path: newUrl }, '', newUrl);
            } catch (historyError) {
                console.warn("Silent fallback: window.history.pushState is blocked in this browser context (e.g. file:/// URL).", historyError);
            }

            const targetZoom = callbacks.getZoomForRange(finalRange);
            this.map.setView([finalLat, finalLon], targetZoom, { animate: false });

            // Clear active target tracking registry and bearings
            callbacks.clearActiveMarkers();
            callbacks.clearActiveAircraftRegistry();
            callbacks.resetTelemetryDisplay();

            // Refresh sidebar lists
            callbacks.updateTargetList();
        } else {
            // Cancel changes: revert map position and zoom level to original home coordinates and range
            const origLat = callbacks.getHomeLat();
            const origLon = callbacks.getHomeLon();
            const origRange = callbacks.getRangeNm();

            this.tempLat = origLat;
            this.tempLon = origLon;
            this.tempRange = origRange;
        }

        // Reset zoom snap and snap the zoom level to match the new or original range ring diameter
        callbacks.updateMinZoom();
        callbacks.updateSweepSize();
        callbacks.recalculateDisplayedRange();
        callbacks.updateDisplayedRange();

        const hLat = callbacks.getHomeLat();
        const hLon = callbacks.getHomeLon();
        const rNm = callbacks.getRangeNm();
        const targetZoom = callbacks.getZoomForRange(rNm);

        this.isProgrammaticChange = true;
        this.map.setView([hLat, hLon], targetZoom, { animate: false });
        setTimeout(() => { this.isProgrammaticChange = false; }, 250);

        // Redraw and lock range rings back to center with proper range
        const ringFactors = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
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

        if (this.weatherEnabled) {
            this.updateWeatherLayer();
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

    isCenterInCONUS(lat, lon) {
        return lat >= 24.0 && lat <= 50.0 && lon >= -125.0 && lon <= -66.9;
    }

    setupTileRetry(layer) {
        if (!layer) return;
        layer.on('tileerror', (e) => {
            const tile = e.tile;
            if (!tile) return;
            if (!tile._retryCount) tile._retryCount = 0;
            if (tile._retryCount < 3) {
                tile._retryCount++;
                const coords = e.coords;
                const tileUrl = layer.getTileUrl(coords);
                setTimeout(() => {
                    tile.src = tileUrl + (tileUrl.indexOf('?') > -1 ? '&' : '?') + 'retry=' + Date.now();
                }, 2000);
            }
        });
    }

    updateWeatherLayer() {
        if (!this.map) return;

        // Clean up any existing layer first if weather is disabled
        if (!this.weatherEnabled) {
            if (this.weatherLayer) {
                this.map.removeLayer(this.weatherLayer);
                this.weatherLayer = null;
            }
            this.weatherProvider = null;
            return;
        }

        const currentZoom = this.map.getZoom();
        if (currentZoom < 4) {
            if (this.weatherLayer) {
                this.map.removeLayer(this.weatherLayer);
                this.weatherLayer = null;
            }
            this.weatherProvider = null;
            return;
        }

        const center = this.map.getCenter();
        const activeLat = this.isSelectionMode ? center.lat : this.homeLat;
        const activeLon = this.isSelectionMode ? center.lng : this.homeLon;
        const insideUS = this.isCenterInCONUS(activeLat, activeLon);
        const targetProvider = insideUS ? 'iem' : 'rainviewer';

        if (targetProvider === this.weatherProvider && this.weatherLayer) {
            return; // Already active and set up!
        }

        // Remove old layer before creating a new one
        if (this.weatherLayer) {
            this.map.removeLayer(this.weatherLayer);
            this.weatherLayer = null;
        }

        this.weatherProvider = targetProvider;
        console.log(`[WEATHER RADAR] Active source: ${targetProvider === 'iem' ? 'IEM (ISU) NEXRAD WMS' : 'RainViewer Global Composite'}`);

        if (targetProvider === 'iem') {
            const wmsUrl = "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi";
            console.log(`[WEATHER RADAR] Requesting WMS layers from: ${wmsUrl}`);
            this.weatherLayer = L.tileLayer.wms(wmsUrl, {
                layers: 'nexrad-n0r-900913',
                format: 'image/png',
                transparent: true,
                opacity: 0.10,
                pane: 'weatherPane',
                minZoom: 4,
                attribution: 'Weather data © IEM Nexrad'
            });
            this.setupTileRetry(this.weatherLayer);
            this.weatherLayer.addTo(this.map);
        } else {
            this.weatherFetchId++;
            const currentFetchId = this.weatherFetchId;

            const globalObject = (typeof window !== 'undefined') ? window : (typeof global !== 'undefined' ? global : {});
            const fetchFunc = globalObject.fetch;

            const fetchPromise = (typeof fetchFunc === 'function') 
                ? fetchFunc('https://api.rainviewer.com/public/weather-maps.json')
                : Promise.reject(new Error("fetch undefined"));

            fetchPromise
                .then(res => res.json())
                .then(data => {
                    if (this.weatherFetchId !== currentFetchId || !this.weatherEnabled) return;

                    const pastRadars = data && data.radar && data.radar.past;
                    if (pastRadars && pastRadars.length > 0) {
                        const latestPath = pastRadars[pastRadars.length - 1].path;
                        const host = data.host || 'https://tilecache.rainviewer.com';
                        const tileUrl = `${host}${latestPath}/256/{z}/{x}/{y}/6/1_1.png`;
                        console.log(`[WEATHER RADAR] Requesting RainViewer tiles from: ${tileUrl}`);
                        
                        if (this.weatherLayer) {
                            this.map.removeLayer(this.weatherLayer);
                        }
                        
                        this.weatherLayer = L.tileLayer(tileUrl, {
                            opacity: 0.10,
                            pane: 'weatherPane',
                            minZoom: 4,
                            maxNativeZoom: 7,
                            maxZoom: 20,
                            attribution: 'Weather data from RainViewer'
                        });
                        this.setupTileRetry(this.weatherLayer);
                        this.weatherLayer.addTo(this.map);
                    }
                })
                .catch(err => {
                    console.warn("Weather radar fetch failed or aborted:", err.message);
                });
        }
    }

    setWeatherEnabled(enabled) {
        this.weatherEnabled = enabled;
        if (this.weatherUpdateTimeout) {
            clearTimeout(this.weatherUpdateTimeout);
            this.weatherUpdateTimeout = null;
        }
        this.updateWeatherLayer();
    }
};
