// tests-unit-spec.js
// Shared unit test suite specification file executed by both browser (tests.html) and Node.js (run_tests.js)

function executeRadarUnitTestSuite(context) {
    const assert = context.assert;
    const assertPending = context.assertPending;

    // ==========================================================
    // TEST SUITE 14: Aircraft Class Lifecycle & State Cache
    // ==========================================================
    try {
        const rawCiv = { category: "A3", t: "B738", desc: "BOEING 737", mil: 0 };
        const acCiv = new context.Aircraft("C00001", rawCiv);
        assert("Aircraft instantiation registers hex", acCiv.hex === "C00001", "Aircraft instance has hex property set.");
        assert("Aircraft standard isClassB evaluation", acCiv.isClassB === false, "Standard civilian aircraft correctly sets isClassB = false.");
        assert("Aircraft standard specialBSubtype evaluation", acCiv.specialBSubtype === 'CLASS B', "Standard civilian aircraft sets specialBSubtype = 'CLASS B'.");

        const rawGlid = { category: "B1", t: "GLID", desc: "GLIDER", mil: 0 };
        const acGlid = new context.Aircraft("C00002", rawGlid);
        assert("Aircraft glider isClassB evaluation", acGlid.isClassB === true, "Glider target correctly sets isClassB = true.");
        assert("Aircraft glider specialBSubtype evaluation", acGlid.specialBSubtype === 'GLIDER', "Glider target sets specialBSubtype = 'GLIDER'.");

        const rawBalloon = { category: "B2", t: "BALL", desc: "BALLOON", mil: 0 };
        const acBalloon = new context.Aircraft("C00003", rawBalloon);
        assert("Aircraft balloon isClassB evaluation", acBalloon.isClassB === true, "Balloon target correctly sets isClassB = true.");
        assert("Aircraft balloon specialBSubtype evaluation", acBalloon.specialBSubtype === 'LIGHTER-THAN-AIR', "Balloon target sets specialBSubtype = 'LIGHTER-THAN-AIR'.");

        // 14.1 HTML escaping & default fallback values
        const rawDirty = { category: "A1", r: "<b>DirtyReg</b>", t: "DirtyType*", desc: "<script>DirtyDesc</script>", squawk: "DirtySquawk%" };
        const acDirty = new context.Aircraft("C00004", rawDirty);
        assert("Aircraft constructor escapes registration", acDirty.reg === "&lt;b&gt;DirtyReg&lt;&#x2F;b&gt;", "Registration HTML elements correctly escaped.");
        assert("Aircraft constructor escapes description", acDirty.desc === "&lt;script&gt;DirtyDesc&lt;&#x2F;script&gt;", "Description script tags correctly escaped.");
        assert("Aircraft constructor handles type placeholder fallback", acDirty.type === "DirtyType*", "Dirty type code assigned.");

        const rawMissing = {};
        const acMissing = new context.Aircraft("C00005", rawMissing);
        assert("Aircraft constructor fallback registration", acMissing.reg === "UNKNOWN", "Missing registration fallback defaults to 'UNKNOWN'.");
        assert("Aircraft constructor fallback type", acMissing.type === "UNKN", "Missing type code fallback defaults to 'UNKN'.");

        // 14.2 Telemetry updates & pendingUpdate buffer
        const rawUpdateBase = { category: "A1", lat: 10, lon: 20 };
        const acUpdate = new context.Aircraft("C00006", rawUpdateBase);
        
        // Trigger coordinate and speed update
        acUpdate.update({ category: "A1", lat: 11, lon: 21, gs: 150 });
        assert("Aircraft update queues lat in pendingUpdate", acUpdate.pendingUpdate.lat === 11, "Updated latitude buffered in pendingUpdate.");
        assert("Aircraft update queues speed in pendingUpdate", acUpdate.pendingUpdate.speed === 150, "Updated speed buffered in pendingUpdate.");
        assert("Aircraft update does not instantly mutate active lat", acUpdate.lat === 10, "Active target latitude remains unchanged until sweep line pass.");

        // 14.3 Resource cleanups & reference resets
        const acCleanup = new context.Aircraft("C00007", {});
        acCleanup.marker = { name: "MockLeafletMarker" };
        acCleanup.trail = { name: "MockLeafletPolyline" };
        acCleanup.markerEl = { name: "MockDOMNode" };
        
        // Execute destruction
        acCleanup.destroy({ hasLayer: () => true, removeLayer: () => {} });
        assert("Aircraft destroy clears marker reference", acCleanup.marker === null, "Leaflet marker reference reset to null.");
        assert("Aircraft destroy clears trail reference", acCleanup.trail === null, "Leaflet polyline reference reset to null.");
        assert("Aircraft destroy clears markerEl DOM cache", acCleanup.markerEl === null, "Marker DOM node cache reference reset to null.");

        // 14.4 Classification Getters & isCommercial Encapsulation
        const rawCivJet = { category: "A5", r: "N12345", t: "B738", desc: "BOEING 737", mil: 0 };
        const acCivJet = new context.Aircraft("C00008", rawCivJet);
        assert("Aircraft isWarbird false for B738", acCivJet.isWarbird === false, "B738 is not classified as a warbird.");
        assert("Aircraft isActiveWarbird false for B738", acCivJet.isActiveWarbird === false, "B738 is not active warbird.");
        assert("Aircraft iconType 'jet' for B738", acCivJet.iconType === "jet", "B738 resolves to 'jet' shape.");
        assert("Aircraft isCommercial true for A5 airline", acCivJet.isCommercial === true, "A5 category airliner is classified as commercial.");

        const rawGaLight = { category: "A1", r: "N7723S", t: "C172", desc: "CESSNA 172", mil: 0 };
        const acGaLight = new context.Aircraft("C00010", rawGaLight);
        assert("Aircraft isCommercial false for GA Cessna", acGaLight.isCommercial === false, "GA light propeller target is not commercial.");

        assert("RadarSidebar.formatNumber pads thousands", context.RadarSidebar.formatNumber(24500) === "24,500", "formatNumber formatted large altitude.");
        assert("RadarSidebar.getHeadingDirection resolves North", context.RadarSidebar.getHeadingDirection(10) === "N", "getHeadingDirection resolved 10 degrees to N.");
        assert("RadarSidebar.getHeadingDirection resolves South", context.RadarSidebar.getHeadingDirection(185) === "S", "getHeadingDirection resolved 185 degrees to S.");

        const rawB17 = { category: "A1", r: "WW2BOMB", t: "B17", desc: "BOEING B-17", mil: 0 };
        const acB17 = new context.Aircraft("C00009", rawB17);
        assert("Aircraft isWarbird true for B17", acB17.isWarbird === true, "B17 is classified as a warbird.");
        
        context.warbirdModeActive = true;
        assert("Aircraft isActiveWarbird true for B17 when mode active", acB17.isActiveWarbird === true, "B17 is active warbird when mode is enabled.");
        assert("Aircraft warbirdSubtype 'BOMBER' for B17", acB17.warbirdSubtype === "BOMBER", "B17 subtype is 'BOMBER'.");
        assert("Aircraft iconType 'warbird_bomber' for B17", acB17.iconType === "warbird_bomber", "B17 icon shape is 'warbird_bomber'.");

        context.warbirdModeActive = false;
        assert("Aircraft isActiveWarbird false for B17 when mode disabled", acB17.isActiveWarbird === false, "B17 is not active warbird when mode is disabled.");
        assert("Aircraft iconType 'light' fallback for B17 when mode disabled", acB17.iconType === "light", "B17 falls back to standard G/A propeller 'light' icon when warbird mode is disabled.");

        // 14.4.5 Shared Utilities Unit Tests
        assert("utils.calcDistance exists", typeof context.calcDistance === "function", "calcDistance utility defined.");
        assert("utils.calcBearing exists", typeof context.calcBearing === "function", "calcBearing utility defined.");
        assert("utils.escapeHtml escapes HTML tags", context.escapeHtml("<div>") === "&lt;div&gt;", "escapeHtml escapes tag brackets.");
        assert("utils.sanitizeId sanitizes ID selectors", context.sanitizeId("hex~val") === "hex_val", "sanitizeId replaces non-alphanumeric chars with underscore.");

        // 14.5 RadarScope, RadarSidebar & IngestionService Instantiation
        assert("RadarSidebar class exists", typeof context.RadarSidebar !== "undefined", "RadarSidebar class is defined.");
        assert("RadarScope class exists", typeof context.RadarScope !== "undefined", "RadarScope class is defined.");
        assert("IngestionService class exists", typeof context.IngestionService !== "undefined", "IngestionService class is defined.");
        
        const mockScope = new context.RadarScope("fake_map_container", { homeLat: 10, homeLon: 20, rangeNm: 50 });
        assert("RadarScope homeLat property set", mockScope.homeLat === 10, "RadarScope homeLat option bound correctly.");
        assert("RadarScope homeLon property set", mockScope.homeLon === 20, "RadarScope homeLon option bound correctly.");
        assert("RadarScope rangeNm property set", mockScope.rangeNm === 50, "RadarScope rangeNm option bound correctly.");
        assert("RadarSidebar can be instantiated independently", new context.RadarSidebar() instanceof context.RadarSidebar, "RadarSidebar instantiates independently.");

        const mockIngest = new context.IngestionService({ pollIntervalMs: 5000 });
        assert("IngestionService pollIntervalMs property set", mockIngest.pollIntervalMs === 5000, "IngestionService pollIntervalMs option bound correctly.");
        assert("IngestionService isPolling false initially", mockIngest.isPolling === false, "IngestionService starts with polling off.");

        // 14.6 RadarSidebar DOM Rendering Unit Tests
        const mockCountEl = { innerText: "" };
        const mockDetailsEl = { innerHTML: "" };
        const mockListEl = {
            innerHTML: "",
            children: [],
            appendChild(child) { this.children.push(child); },
            insertBefore(child, reference) {
                const idx = this.children.indexOf(reference);
                if (idx !== -1) this.children.splice(idx, 0, child);
                else this.children.push(child);
            },
            removeChild(child) {
                const idx = this.children.indexOf(child);
                if (idx !== -1) this.children.splice(idx, 1);
            },
            querySelector() { return null; }
        };

        const testSidebar = new context.RadarSidebar(null, null, null);
        testSidebar.countElement = mockCountEl;
        testSidebar.detailsContainer = mockDetailsEl;
        testSidebar.listContainer = mockListEl;

        testSidebar.updateCount(42);
        assert("RadarSidebar.updateCount writes to element", mockCountEl.innerText === 42, "updateCount set innerText correctly.");

        testSidebar.resetDetails();
        assert("RadarSidebar.resetDetails clears panel HTML", mockDetailsEl.innerHTML.includes("NO TARGET ACQUIRED"), "resetDetails injected empty target message.");

        const testAc = new context.Aircraft("A00001", { category: "A5", r: "NTEST", t: "B738", desc: "BOEING 737", gs: 250, track: 90, dist: 12.5, flight: "TEST1" });
        testSidebar.renderDetails(testAc, false, true, null);
        assert("RadarSidebar.renderDetails renders registration", mockDetailsEl.innerHTML.includes("NTEST"), "renderDetails renders target registration.");
        assert("RadarSidebar.renderDetails renders model desc", mockDetailsEl.innerHTML.includes("BOEING 737"), "renderDetails renders model description.");

        testSidebar.renderList([testAc], "A00001", true, null);
        assert("RadarSidebar.renderList creates DOM row", testSidebar.domRowMap["A00001"] !== undefined, "renderList added target to row cache map.");
        assert("RadarSidebar.renderList appends row to listContainer", mockListEl.children.length === 1, "Row appended to list container.");

        // 14.7 RadarScope Map Lifecycle Unit Tests
        let centerCallbackFired = false;
        mockScope.onCenterChanged = (lat, lon) => {
            centerCallbackFired = true;
        };

        // Create temporary map container in browser DOM to prevent Leaflet container not found error
        let testDiv = null;
        if (typeof document !== 'undefined' && typeof document.createElement === 'function' && document.body && typeof document.body.appendChild === 'function') {
            testDiv = document.createElement('div');
            testDiv.id = 'fake_map_container';
            testDiv.style.width = '100px';
            testDiv.style.height = '100px';
            testDiv.style.display = 'none';
            document.body.appendChild(testDiv);
        }

        try {
            mockScope.init();
            assert("RadarScope.init creates map instance", mockScope.map !== null, "init initialized Leaflet map.");
            assert("RadarScope.init draws range rings", mockScope.rangeRings.length === 6, "six range rings drawn on map initialization.");

            mockScope.setCenter(-30.5, 120.4);
            assert("RadarScope.setCenter updates homeLat", mockScope.homeLat === -30.5, "setCenter updated homeLat.");
            assert("RadarScope.setCenter updates homeLon", mockScope.homeLon === 120.4, "setCenter updated homeLon.");
            assert("RadarScope.setCenter fires callback", centerCallbackFired === true, "onCenterChanged callback fired on center shift.");
            
            // Verify crosshair and range rings LatLng updates
            const chLatLng = mockScope.crosshair.getLatLng();
            assert("RadarScope.setCenter updates crosshair LatLng", chLatLng && (chLatLng.lat === -30.5 || chLatLng[0] === -30.5) && (chLatLng.lng === 120.4 || chLatLng[1] === 120.4), "crosshair LatLng was updated.");
            
            let allRingsUpdated = true;
            mockScope.rangeRings.forEach(ring => {
                const rLatLng = ring.getLatLng();
                const latMatch = rLatLng && (rLatLng.lat === -30.5 || rLatLng[0] === -30.5);
                const lonMatch = rLatLng && (rLatLng.lng === 120.4 || rLatLng[1] === 120.4);
                if (!latMatch || !lonMatch) allRingsUpdated = false;
            });
            assert("RadarScope.setCenter updates range rings LatLngs", allRingsUpdated === true, "all range rings LatLngs were updated.");

            mockScope.setRange(150);
            assert("RadarScope.setRange updates rangeNm", mockScope.rangeNm === 150, "setRange updated rangeNm.");

            assert("RadarScope has initLocationSelection", typeof mockScope.initLocationSelection === 'function', "initLocationSelection is defined.");
            assert("RadarScope has enterSelectionMode", typeof mockScope.enterSelectionMode === 'function', "enterSelectionMode is defined.");
            assert("RadarScope has exitSelectionMode", typeof mockScope.exitSelectionMode === 'function', "exitSelectionMode is defined.");
        } finally {
            if (testDiv && testDiv.parentNode) {
                testDiv.parentNode.removeChild(testDiv);
            }
        }

        // 14.8 RadarChassis Unit Tests
        assert("RadarChassis class exists", typeof context.RadarChassis !== "undefined", "RadarChassis class is defined.");
        
        let warbirdState = false;
        let stylingRefreshed = false;
        const testChassis = new context.RadarChassis({
            isWarbirdModeActive: () => warbirdState,
            setWarbirdModeActive: (val) => { warbirdState = val; },
            refreshWarbirdStyling: () => { stylingRefreshed = true; }
        });

        assert("RadarChassis.getBezelDiameter returns expected default diameter", typeof testChassis.getBezelDiameter() === 'number', "getBezelDiameter returned numeric diameter.");
        
        testChassis.callbacks.setWarbirdModeActive(true);
        assert("RadarChassis setWarbirdModeActive callback functions", warbirdState === true, "setWarbirdModeActive updated external state variable.");

        // 14.9 RadarScope.setCenter isProgrammaticChange Flag Unit Test
        let wasProgChangeTrueDuringSetView = false;
        const testScope = new context.RadarScope('fake_map_container_for_flag', { homeLat: 30, homeLon: -90, rangeNm: 40 });
        testScope.map = {
            setView: (latlng, zoom, options) => {
                if (testScope.isProgrammaticChange === true) {
                    wasProgChangeTrueDuringSetView = true;
                }
                return this;
            },
            getZoom: () => 10
        };
        testScope.crosshair = { setLatLng() {} };
        testScope.rangeRings = [];

        testScope.setCenter(35, -95);
        assert("RadarScope.setCenter sets isProgrammaticChange flag during view updates", wasProgChangeTrueDuringSetView === true, "isProgrammaticChange was true during setView execution.");

        // 14.10 updateSweepSize is called during center update
        let updateSweepSizeCalled = false;
        const originalUpdateSweepSize = context.updateSweepSize;
        context.updateSweepSize = () => {
            updateSweepSizeCalled = true;
            originalUpdateSweepSize();
        };

        context.updateRadarCenter(30.2, -97.6);
        
        context.updateSweepSize = originalUpdateSweepSize;
        assert("updateSweepSize is called when radar center updates", updateSweepSizeCalled === true, "updateSweepSize was executed on radar center change.");

        // 14.11 map.invalidateSize is called at startup
        if (context.L.firstCreatedMap) {
            assert("map.invalidateSize is called at startup", context.L.firstCreatedMap._invalidateSizeCount > 0, "map.invalidateSize was called at startup.");
        } else {
            assertPending("map.invalidateSize is called at startup", "Skipped in browser environment (requires mock Leaflet spy).");
        }

        // 14.12 IngestionService boundary polling calculation test
        const originalSetTimeout = context.setTimeout;
        const originalFetch = context.fetch;
        const originalDateNow = context.Date.now;

        try {
            let capturedDelay = null;
            context.setTimeout = (callback, delay) => {
                capturedDelay = delay;
                return 9999;
            };

            context.Date.now = () => 1712345685000;

            context.fetch = () => {
                return {
                    then(onFulfilled) {
                        const response = {
                            ok: true,
                            json() {
                                return {
                                    then(onJsonFulfilled) {
                                        onJsonFulfilled({ now: 1712345680, ac: [] });
                                        return { catch() {} };
                                    }
                                };
                            }
                        };
                        return onFulfilled(response);
                    },
                    catch() { return this; }
                };
            };

            const testIngest = new context.IngestionService({ pollIntervalMs: 10000 });
            testIngest.isPolling = true;
            testIngest.poll(() => ({ lat: 0, lon: 0, rangeNm: 40 }), null);

            assert("IngestionService nextServerTick avoids rapid polling loop", capturedDelay > 5000, "Calculated next poll delay was " + capturedDelay + "ms (should be >5000ms to avoid loop).");

            // Test timeout abort recovery
            capturedDelay = null;
            context.fetch = () => {
                return {
                    then(onFulfilled) {
                        return {
                            then() { return this; },
                            catch(onRejected) {
                                const err = new Error("Request timed out");
                                err.name = "AbortError";
                                onRejected(err);
                                return this;
                            }
                        };
                    }
                };
            };

            testIngest.poll(() => ({ lat: 0, lon: 0, rangeNm: 40 }), null);
            assert("IngestionService schedules retry on request timeout abort", capturedDelay === 10000, "Calculated next poll delay was " + capturedDelay + "ms (should be 10000ms to recover). activePollController=" + (testIngest.activePollController ? "defined" : "null"));

            // 14.13 Aircraft.prototype.cacheDomElements handles detached markers
            const originalContains = context.document.body.contains;
            const originalGetElementById = context.document.getElementById;
            try {
                const testAc = new context.Aircraft("fake_hex", { t: "B17" });
                
                const firstMockEl = { id: "marker-fake_hex", isFirst: true, querySelector() {} };
                const secondMockEl = { id: "marker-fake_hex", isSecond: true, querySelector() {} };

                let currentMockEl = firstMockEl;
                context.document.getElementById = (id) => {
                    if (id === "marker-fake_hex") return currentMockEl;
                    return originalGetElementById.call(context.document, id);
                };

                let isAttached = true;
                context.document.body.contains = (el) => {
                    if (el === firstMockEl) return isAttached;
                    return true;
                };

                testAc.cacheDomElements();
                assert("cacheDomElements caches initial element", testAc.markerEl === firstMockEl, "Initial DOM element was cached.");

                // Simulate DOM detachment
                isAttached = false;
                currentMockEl = secondMockEl;

                testAc.cacheDomElements();
                assert("cacheDomElements updates cache for detached elements", testAc.markerEl === secondMockEl, "Detached element was cleaned and the new active element was cached.");

                // 14.14 Test isStreetCandidate strict road/building classification
                assert("isStreetCandidate returns true for highway class", context.isStreetCandidate({ class: 'highway', type: 'residential' }) === true, "Highway class is recognized as street candidate.");
                assert("isStreetCandidate returns true for building class", context.isStreetCandidate({ class: 'building' }) === true, "Building class is recognized as street candidate.");
                assert("isStreetCandidate returns true for house type", context.isStreetCandidate({ type: 'house' }) === true, "House type is recognized as street candidate.");
                assert("isStreetCandidate returns true for road addresstype", context.isStreetCandidate({ addresstype: 'road' }) === true, "Road addresstype is recognized as street candidate.");
                assert("isStreetCandidate rejects place class (subdivisions/neighborhoods)", context.isStreetCandidate({ class: 'place', type: 'neighbourhood' }) === false, "Place class (neighborhood) is strictly rejected for house queries.");
                assert("isStreetCandidate rejects landuse class (residential zones)", context.isStreetCandidate({ class: 'landuse', type: 'residential' }) === false, "Landuse class (residential zone polygon) is strictly rejected for house queries.");

                // 14.15 Test extractQueryState and matchesRequestedState
                assert("extractQueryState identifies full state name", context.extractQueryState("Sea, South Carolina") === "SOUTH CAROLINA", "Extracted SOUTH CAROLINA from full name.");
                assert("extractQueryState identifies 2-letter postal code", context.extractQueryState("Des Moines, IA") === "IOWA", "Extracted IOWA from IA abbreviation.");
                assert("extractQueryState returns null when no state present", context.extractQueryState("Austin") === null, "Returned null when no US state present.");
                assert("matchesRequestedState evaluates positive match", context.matchesRequestedState("Sea Ln, Aiken, South Carolina, 29801", "SOUTH CAROLINA") === true, "Positive state match confirmed.");
                assert("matchesRequestedState rejects out-of-state candidate", context.matchesRequestedState("South Ln, Andalusia, Alabama", "SOUTH CAROLINA") === false, "Out-of-state candidate rejected.");

                // 14.16 Test verifyHouseNumber and escapeRegExp
                assert("escapeRegExp escapes special regex control characters", context.escapeRegExp("314*+?^$") === "314\\*\\+\\?\\^\\$", "Special characters safely escaped.");
                assert("verifyHouseNumber validates exact address object", context.verifyHouseNumber({ address: { house_number: "314" } }, "314") === true, "Exact house number in address object validated.");
                assert("verifyHouseNumber validates name string boundary without trailing space", context.verifyHouseNumber({ display_name: "314" }, "314") === true, "House number at end of string matched.");
                assert("verifyHouseNumber rejects incorrect house numbers", context.verifyHouseNumber({ display_name: "3140 Longmeadow Dr" }, "314") === false, "Prefix house number mismatch rejected.");

                // 14.17 Test enterSelectionMode event listener unbinding safety
                let mockOffCount = 0;
                const origGetElem = context.document.getElementById;
                context.document.getElementById = () => ({ value: '', style: {}, removeAttribute: () => {}, setAttribute: () => {}, classList: { add: () => {}, remove: () => {} } });
                const testScope = new context.RadarScope(40, -90, 25);
                testScope.map = {
                    off: () => { mockOffCount++; },
                    dragging: { enable: () => {}, disable: () => {} },
                    scrollWheelZoom: { enable: () => {}, disable: () => {} },
                    options: {},
                    getCenter: () => ({ lat: 40, lng: -90 }),
                    latLngToLayerPoint: () => ({ x: 0, y: 0 }),
                    layerPointToLatLng: () => ({ lat: 40, lng: -90 }),
                    setMinZoom: () => {},
                    setMaxZoom: () => {},
                    getZoom: () => 10,
                    setView: () => {},
                    on: () => {}
                };
                testScope._boundSelectionMapDrag = () => {};
                testScope._boundSelectionMapZoom = () => {};
                testScope.enterSelectionMode({
                    getHomeLat: () => 40,
                    getHomeLon: () => -90,
                    getDisplayedRange: () => 25,
                    updateMinZoom: () => {},
                    stopPolling: () => {},
                    setSweepActive: () => {},
                    clearActiveMarkers: () => {},
                    calcDistance: () => 10,
                    getBezelDiameter: () => 600
                });
                assert("enterSelectionMode unbinds existing listeners before attaching new ones", mockOffCount >= 1, "Existing event listeners safely unbound to prevent memory leaks.");

                // 14.18 Test exitSelectionMode invokes onExitSelectionMode callback
                let exitCallbackCalled = false;
                testScope.exitSelectionMode(true, {
                    onExitSelectionMode: () => { exitCallbackCalled = true; },
                    normalizeLat: (v) => v,
                    normalizeLon: (v) => v,
                    setHomeLat: () => {},
                    setHomeLon: () => {},
                    setRangeNm: () => {},
                    getZoomForRange: () => 10,
                    clearActiveMarkers: () => {},
                    clearActiveAircraftRegistry: () => {},
                    resetTelemetryDisplay: () => {},
                    getHomeLat: () => 40,
                    getHomeLon: () => -90,
                    getRangeNm: () => 25,
                    startPolling: () => {},
                    setSweepActive: () => {},
                    updateTargetList: () => {},
                    updateMinZoom: () => {},
                    updateSweepSize: () => {},
                    recalculateDisplayedRange: () => {},
                    updateDisplayedRange: () => {},
                    updateUIConfigurationValues: () => {}
                });
                assert("exitSelectionMode invokes onExitSelectionMode callback", exitCallbackCalled === true, "onExitSelectionMode callback executed on selection exit.");

                context.document.getElementById = origGetElem;
            } finally {
                context.document.body.contains = originalContains;
                context.document.getElementById = originalGetElementById;
            }
        } finally {
            context.setTimeout = originalSetTimeout;
            context.fetch = originalFetch;
            context.Date.now = originalDateNow;
        }
    } catch (e) {
        assert("TEST SUITE 14 EXCEPTION", false, e.stack || e.message);
    }

    // -------------------------------------------------------------
    // TEST SUITE 15: HTML DOM UNIQUENESS & PORTRAIT LAYOUT GUARD
    // -------------------------------------------------------------
    try {
        const nodeFs = (typeof fs !== 'undefined' && fs.readFileSync ? fs : null) || (typeof require === 'function' ? require('fs') : null);
        if (nodeFs && nodeFs.readFileSync) {
            const htmlContent = nodeFs.readFileSync('index.html', 'utf8');
            
            const checkUniqueId = (id) => {
                const regex = new RegExp(`id="${id}"`, 'g');
                const matches = htmlContent.match(regex);
                return matches ? matches.length : 0;
            };

            const checkUniqueClass = (className) => {
                const regex = new RegExp(`class="${className}"`, 'g');
                const matches = htmlContent.match(regex);
                return matches ? matches.length : 0;
            };

            context.assert("HTML DOM Guard: Single #map element", checkUniqueId('map') === 1, "Exactly one #map element present in index.html.");
            context.assert("HTML DOM Guard: Single #target-list element", checkUniqueId('target-list') === 1, "Exactly one #target-list element present in index.html.");
            context.assert("HTML DOM Guard: Single #telemetry-display element", checkUniqueId('telemetry-display') === 1, "Exactly one #telemetry-display element present in index.html.");
            context.assert("HTML DOM Guard: Single #help-modal element", checkUniqueId('help-modal') === 1, "Exactly one #help-modal element present in index.html.");
            context.assert("HTML DOM Guard: Single #debug-modal element", checkUniqueId('debug-modal') === 1, "Exactly one #debug-modal element present in index.html.");
            context.assert("HTML DOM Guard: Single brand-label-strip element", checkUniqueClass('brand-label-strip') === 1, "Exactly one brand-label-strip element present in index.html.");
            context.assert("HTML DOM Guard: Single radar-viewport element", checkUniqueClass('radar-viewport') === 1, "Exactly one radar-viewport element present in index.html.");
        }
    } catch (e) {
        context.assert("TEST SUITE 15 EXCEPTION", false, e.stack || e.message);
    }

    // -------------------------------------------------------------
    // TEST SUITE 16: WEATHER RADAR (WX) OVERLAY UNIT TESTS
    // -------------------------------------------------------------
    try {
        const testScope = new context.RadarScope('fake_map_container_wx', { homeLat: 30, homeLon: -90, rangeNm: 40 });
        
        // 16.1 Test isCenterInCONUS
        context.assert("isCenterInCONUS returns true for Austin, TX", testScope.isCenterInCONUS(30.19453, -97.66987) === true, "Austin is inside CONUS.");
        context.assert("isCenterInCONUS returns false for Shannon, NZ", testScope.isCenterInCONUS(-40.5472, 175.4107) === false, "Shannon is outside CONUS.");
        context.assert("isCenterInCONUS returns false for London, UK", testScope.isCenterInCONUS(51.5074, -0.1278) === false, "London is outside CONUS.");

        // 16.2 Test weatherPane creation on map init
        let createdPaneName = null;
        const panes = {};
        const originalLMap = context.L.map;
        context.L.map = (id, options) => {
            const m = originalLMap(id, options);
            m.createPane = (name) => {
                if (name === 'weatherPane') {
                    createdPaneName = name;
                }
                panes[name] = { style: {} };
                return panes[name];
            };
            m.getPane = (name) => {
                if (!panes[name]) panes[name] = { style: {} };
                return panes[name];
            };
            return m;
        };
        testScope.init();
        context.L.map = originalLMap; // restore
        context.assert("init creates weatherPane with zIndex 250", createdPaneName === 'weatherPane' && panes['weatherPane'] && panes['weatherPane'].style.zIndex === 250, "weatherPane initialized at correct z-index layer.");

        // 16.3 Test setWeatherEnabled modifies state and sets up layer
        let addedLayer = null;
        testScope.map = {
            createPane: () => mockPane,
            getPane: () => mockPane,
            setView: () => {},
            getZoom: () => 10,
            getCenter: () => ({ lat: testScope.homeLat, lng: testScope.homeLon }),
            hasLayer: () => false,
            addLayer: (layer) => { addedLayer = layer; },
            removeLayer: () => {}
        };
        
        // Enable inside US
        testScope.homeLat = 30.19453;
        testScope.homeLon = -97.66987;
        testScope.setWeatherEnabled(true);
        context.assert("setWeatherEnabled(true) inside US sets provider to iem", testScope.weatherEnabled === true && testScope.weatherProvider === 'iem', "IEM provider resolved inside US.");
        context.assert("setWeatherEnabled(true) inside US adds WMS tileLayer with 10% opacity", addedLayer !== null && addedLayer.options.layers === 'nexrad-n0r-900913' && addedLayer.options.opacity === 0.10, "IEM WMS layer attached with 10% opacity.");

        // Disable weather
        testScope.setWeatherEnabled(false);
        context.assert("setWeatherEnabled(false) removes active weatherLayer", testScope.weatherEnabled === false && testScope.weatherLayer === null && testScope.weatherProvider === null, "Weather layer successfully torn down.");
    } catch (e) {
        context.assert("TEST SUITE 16 EXCEPTION", false, e.stack || e.message);
    }
}

if (typeof exports !== 'undefined') {
    exports.executeRadarUnitTestSuite = executeRadarUnitTestSuite;
}
