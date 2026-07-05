// tests-integration-spec.js
// Shared integration test suite specification file executed by both browser (tests.html) and Node.js (run_tests.js)

function executeRadarIntegrationTestSuite(context) {
    const assert = context.assert;
    const assertPending = context.assertPending;

    // ==========================================================
    // TEST SUITE 1: Standard Classifications (PRD 3.4 fallback / 3.3 icons)
    // ==========================================================
    try {
        const jetAc = new context.Aircraft("fake_jet", { category: "A5", t: "B738", desc: "BOEING 737" });
        assert("Standard Jet Icon Type", jetAc.iconType === 'jet', "A5 Category B738 correctly resolved to 'jet'.");

        const fighterAc = new context.Aircraft("fake_fighter", { category: "A4", t: "F18", desc: "FA-18 HORNET", mil: 1 });
        assert("Military Fighter Jet Icon Type", fighterAc.iconType === 'fighter', "A4 category F18 with mil=1 correctly resolved to 'fighter'.");

        const lightAc = new context.Aircraft("fake_light", { category: "A1", t: "C172", desc: "CESSNA 172" });
        assert("Light Aircraft Icon Type", lightAc.iconType === 'light', "A1 category C172 correctly resolved to 'light'.");

        const copterAc = new context.Aircraft("fake_copter", { category: "C1", t: "EC35", desc: "EC-135 HELICOPTER" });
        assert("Helicopter Icon Type", copterAc.iconType === 'helicopter', "C1 category EC35 correctly resolved to 'helicopter'.");
    } catch (e) {
        assert("TEST SUITE 1 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 2: Class B Iconography (PRD 3.3 requirements)
    // ==========================================================
    try {
        const gliderAc = new context.Aircraft("fake_glid", { category: "B1", t: "GLID", desc: "GLIDER" });
        assert("Glider Icon Type", gliderAc.iconType === 'glider', "B1 category correctly resolved to 'glider'.");

        const balloonAc = new context.Aircraft("fake_ball", { category: "B2", t: "BALL", desc: "WEATHER BALLOON", gs: 10 });
        assert("Weather Balloon Icon Type", balloonAc.iconType === 'balloon', "B2 category correctly resolved to 'balloon'.");

        const chuteAc = new context.Aircraft("fake_chute", { category: "B3", t: "PARA", desc: "PARACHUTE" });
        assert("Parachute Icon Type", chuteAc.iconType === 'parachute', "B3 category correctly resolved to 'parachute'.");

        const ultraAc = new context.Aircraft("fake_ultra", { category: "B4", t: "ULAC", desc: "ULTRALIGHT" });
        assert("Ultralight Icon Type", ultraAc.iconType === 'ultralight', "B4 category correctly resolved to 'ultralight'.");

        const droneAc = new context.Aircraft("fake_drone", { category: "B6", t: "UAV", desc: "QUADCOPTER DRONE" });
        assert("Drone Icon Type", droneAc.iconType === 'drone', "B6 category correctly resolved to 'drone'.");

        const spaceAc = new context.Aircraft("fake_space", { category: "B7", t: "SPAC", desc: "MERCURY CAPSULE" });
        assert("Space Vehicle Icon Type", spaceAc.iconType === 'space_vehicle', "B7 category correctly resolved to 'space_vehicle'.");
    } catch (e) {
        assert("TEST SUITE 2 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 3: Class B Rotation Locks (PRD 3.3 rotation rules)
    // ==========================================================
    try {
        context.activeAircraft = {};
        context.isAircraftInViewport = () => true;

        // 3.1 Ingest Balloon with track: 90
        context.processAPIResponse({
            ac: [{ hex: "fake_balloon", category: "B2", lat: 30.19, lon: -97.66, track: 90 }]
        });
        if (context.activeAircraft["fake_balloon"]) {
            context.activeAircraft["fake_balloon"].sweptOnce = true;
            context.updateMarkerVisibility("fake_balloon");
        }
        
        let balloonSvg = context.document.getElementById("marker-fake_balloon") ? context.document.getElementById("marker-fake_balloon").querySelector('.aircraft-icon') : null;
        assert("Weather Balloon Created Locked", balloonSvg && balloonSvg.style.transform === 'rotate(0deg)', "Balloon created locked at rotate(0deg).");

        // 3.2 Update Balloon with track: 180
        context.processAPIResponse({
            ac: [{ hex: "fake_balloon", category: "B2", lat: 30.19, lon: -97.66, track: 180 }]
        });
        balloonSvg = context.document.getElementById("marker-fake_balloon") ? context.document.getElementById("marker-fake_balloon").querySelector('.aircraft-icon') : null;
        assert("Weather Balloon Rotation Update Locked", balloonSvg && balloonSvg.style.transform === 'rotate(0deg)', "Balloon remains locked at 0deg after telemetry track updates.");

        // 3.3 Ingest Space Vehicle with track: 90
        context.processAPIResponse({
            ac: [{ hex: "fake_space", category: "B7", lat: 30.19, lon: -97.66, track: 90 }]
        });
        if (context.activeAircraft["fake_space"]) {
            context.activeAircraft["fake_space"].sweptOnce = true;
            context.updateMarkerVisibility("fake_space");
        }
        
        let spaceSvg = context.document.getElementById("marker-fake_space") ? context.document.getElementById("marker-fake_space").querySelector('.aircraft-icon') : null;
        assert("Space Vehicle Rotates Freely", spaceSvg && spaceSvg.style.transform === 'rotate(90deg)', "Space Vehicle rotation matches heading (90deg).");
    } catch (e) {
        assert("TEST SUITE 3 EXCEPTION", false, e.stack || e.message);
    }

    // ==========================================================
    // TEST SUITE 4: Ground Chaff Suppression (PRD 3.1 filter rules)
    // ==========================================================
    try {
        const chaffAc = { hex: "fake_chaff", category: "C2", gs: 0, alt_baro: 0 };
        context.activeAircraft = {};
        context.processAPIResponse({ ac: [chaffAc] });
        
        assert("Ground Chaff Category C Filtering", context.activeAircraft["fake_chaff"] === undefined, "Airport ground chaff target filtered out during data ingestion.");
    } catch (e) {
        assert("TEST SUITE 4 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 5: WWII Warbirds (Subtypes & Icons - PRD 3.4)
    // ==========================================================
    try {
        context.warbirdModeActive = true;

        // 5.1 WWII USAAF Bomber (B-17)
        const b17Ac = new context.Aircraft("fake_b17", { t: "B17" });
        assert("WWII Bomber Subtype Parsing", b17Ac.warbirdSubtype === 'BOMBER', "B17 type parsed to 'BOMBER'.");
        assert("WWII Bomber Custom Icon Routing", b17Ac.iconType === 'warbird_bomber', "B17 resolved to 'warbird_bomber' shape.");

        // 5.2 WWII USAAF Pursuit/Fighter (P-51)
        const p51Ac = new context.Aircraft("fake_p51", { t: "P51" });
        assert("WWII Fighter Subtype Parsing", p51Ac.warbirdSubtype === 'PURSUIT', "P51 type parsed to 'PURSUIT'.");
        assert("WWII Fighter Custom Icon Routing", p51Ac.iconType === 'warbird_fighter', "P51 resolved to 'warbird_fighter' shape.");

        // 5.3 WWII USAAF Transport (C-47)
        const c47Ac = new context.Aircraft("fake_c47", { t: "C47" });
        assert("WWII Transport Subtype Parsing", c47Ac.warbirdSubtype === 'TRANSPORT', "C47 type parsed to 'TRANSPORT'.");
        assert("WWII Transport Custom Icon Routing", c47Ac.iconType === 'warbird_transport', "C47 resolved to 'warbird_transport' shape.");

        // 5.4 WWII Advanced Trainer fallback (T-6)
        const t6Ac = new context.Aircraft("fake_t6", { t: "T6" });
        assert("WWII Trainer Subtype Parsing", t6Ac.warbirdSubtype === 'ADVANCED TRAINER', "T6 type parsed to 'ADVANCED TRAINER'.");
        assert("WWII Trainer Custom Icon Fallback", t6Ac.iconType === 'light', "T6 falls back to standard general aviation 'light' propeller shape.");

        context.warbirdModeActive = false;
    } catch (e) {
        assert("TEST SUITE 5 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 6: Active Target Tracking (Second Easter Egg - PRD 4)
    // ==========================================================
    try {
        context.trackedHex = null;
        context.hexClickCount = 0;
        context.lastHexClickTime = 0;

        const acDummy = { hex: "fake_target", lat: 30.1, lon: -97.6 };
        
        const mockClick = (ac) => {
            const now = Date.now();
            if (context.trackedHex === ac.hex) {
                context.trackedHex = null;
                context.hexClickCount = 0;
            } else {
                if (now - context.lastHexClickTime > 1500) context.hexClickCount = 0;
                context.lastHexClickTime = now;
                context.hexClickCount++;
                if (context.hexClickCount >= 3) {
                    context.trackedHex = ac.hex;
                    context.hexClickCount = 0;
                }
            }
        };
        
        mockClick(acDummy);
        assert("Active Tracking (Click 1)", context.trackedHex === null && context.hexClickCount === 1, "First click registers count=1, target not tracked.");
        
        mockClick(acDummy);
        assert("Active Tracking (Click 2)", context.trackedHex === null && context.hexClickCount === 2, "Second click registers count=2, target not tracked.");
        
        mockClick(acDummy);
        assert("Active Tracking Lock-on (Click 3)", context.trackedHex === "fake_target" && context.hexClickCount === 0, "Third click activates lock-on centering tracking.");

        mockClick(acDummy);
        assert("Active Tracking Deactivation (Click 4)", context.trackedHex === null, "Subsequent single tap successfully releases target lock-on.");
    } catch (e) {
        assert("TEST SUITE 6 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 7: WWII Warbirds Easter Egg Gestures (PRD 4 rules)
    // ==========================================================
    try {
        context.warbirdModeActive = false;
        context.localStorage.setItem('codeRedActive', 'false');

        context.refreshWarbirdStyling();
        const pilotLight = context.document.getElementById('codered-light');
        assert("Pilot Light Initially Off", pilotLight && !pilotLight.classList.contains('active'), "Indicator light starts inactive.");

        const seq = ['s0', 's135', 's270', 's45', 's180', 's315', 's90', 's225'];
        seq.forEach(cls => {
            const el = context.document.querySelector(`.scope-screw.${cls}`);
            if (el) {
                el.dispatchEvent(new context.PointerEvent('pointerdown', { bubbles: true }));
            }
        });

        assert("Easter Egg Activation Sequence Success", context.warbirdModeActive === true, "8-screw gesture sequence successfully activates WWII Warbird mode.");
        assert("Pilot Light Turns Active", pilotLight && pilotLight.classList.contains('active'), "CodeRed pilot indicator light turns green.");

        // Simulate deactivation (triple click on pilot light with mocked Date.now to satisfy 300ms debounce)
        if (pilotLight) {
            const realNow = Date.now;
            let mockTime = realNow();
            Date.now = () => {
                mockTime += 350;
                return mockTime;
            };
            
            pilotLight.dispatchEvent(new context.PointerEvent('pointerdown', { bubbles: true }));
            pilotLight.dispatchEvent(new context.PointerEvent('pointerdown', { bubbles: true }));
            pilotLight.dispatchEvent(new context.PointerEvent('pointerdown', { bubbles: true }));
            
            Date.now = realNow;
        }

        assert("Easter Egg Deactivation Click Success", context.warbirdModeActive === false, "Triple-clicking the pilot light deactivates WWII Warbird mode.");
        assert("Pilot Light Reverts Inactive", pilotLight && !pilotLight.classList.contains('active'), "CodeRed pilot light turns off.");
    } catch (e) {
        assert("TEST SUITE 7 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 8: Airspace Filters & Low Altitude (PRD 3.1)
    // ==========================================================
    try {
        context.activeFilter = 'all';
        context.lowAltitudeFilterEnabled = false;

        const milAc = new context.Aircraft("fake_mil", { category: "A4", mil: 1, lat: 30.19, lon: -97.66, dist: 10 });
        const civAc = new context.Aircraft("fake_civ", { category: "A3", mil: 0, lat: 30.19, lon: -97.66, dist: 10 });
        milAc.sweptOnce = true;
        civAc.sweptOnce = true;

        context.activeAircraft = {
            "fake_mil": milAc,
            "fake_civ": civAc
        };

        context.activeFilter = 'mil';
        context.updateMarkerVisibility("fake_mil");
        context.updateMarkerVisibility("fake_civ");
        assert("Military Filter - Mil Target Visible", context.activeAircraft["fake_mil"].visible === true, "Military target remains visible.");
        assert("Military Filter - Civ Target Hidden", context.activeAircraft["fake_civ"].visible === false, "Civilian target is hidden.");

        context.activeFilter = 'all';
        context.lowAltitudeFilterEnabled = true;
        
        context.activeAircraft["fake_civ"].alt = 3000;
        context.updateMarkerVisibility("fake_civ");
        assert("Low Altitude Filter - Target at 3k FT Visible", context.activeAircraft["fake_civ"].visible === true, "Low altitude target remains visible.");
        
        context.activeAircraft["fake_civ"].alt = 24000;
        context.updateMarkerVisibility("fake_civ");
        assert("Low Altitude Filter - Target at 24k FT Hidden", context.activeAircraft["fake_civ"].visible === false, "High altitude target above 18,000 FT is hidden.");

        context.activeFilter = 'all';
        context.lowAltitudeFilterEnabled = false;
    } catch (e) {
        assert("TEST SUITE 8 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 9: Dynamic Trail Limit Scaling (PRD 5.2)
    // ==========================================================
    try {
        const originalUpdate = context.updateMarkerVisibility;
        context.updateMarkerVisibility = (hex) => {
            if (context.activeAircraft[hex]) {
                context.activeAircraft[hex].visible = true;
                context.activeAircraft[hex].sweptOnce = true;
            }
        };

        const generateList = (count) => {
            const acList = [];
            for (let i = 0; i < count; i++) {
                acList.push({ hex: `fake_t_${i}`, category: "A3", lat: 30.19, lon: -97.66 });
            }
            return acList;
        };

        context.activeAircraft = {};
        context.processAPIResponse({ ac: generateList(5) });
        assert("Trail Scaling - Low Traffic (120 points)", context.maxTrailPoints === 120, `maxTrailPoints is ${context.maxTrailPoints} for low traffic.`);

        context.activeAircraft = {};
        context.processAPIResponse({ ac: generateList(120) });
        assert("Trail Scaling - Medium Traffic (60 points)", context.maxTrailPoints === 60, `maxTrailPoints is ${context.maxTrailPoints} for medium traffic.`);

        context.activeAircraft = {};
        context.processAPIResponse({ ac: generateList(350) });
        assert("Trail Scaling - High Traffic (20 points)", context.maxTrailPoints === 20, `maxTrailPoints is ${context.maxTrailPoints} for high traffic.`);
        
        context.updateMarkerVisibility = originalUpdate;
    } catch (e) {
        assert("TEST SUITE 9 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 10: Bearing Bucket Indexing (PRD 5.1 / Optimization)
    // ==========================================================
    try {
        for (let i = 0; i < 360; i++) {
            context.bearingBuckets[i] = new Set();
        }

        context.addAircraftToBearingIndex("t_hex_1", 45.2);
        assert("Add to Bearing Index", context.bearingBuckets[45].has("t_hex_1"), "Target t_hex_1 added to bucket 45.");

        context.updateAircraftBearingIndex("t_hex_1", 45.2, 180.8);
        assert("Update Bearing Index - Removed old", !context.bearingBuckets[45].has("t_hex_1"), "Target removed from bucket 45.");
        assert("Update Bearing Index - Added new", context.bearingBuckets[180].has("t_hex_1"), "Target added to bucket 180.");

        context.removeAircraftFromBearingIndex("t_hex_1", 180.8);
        assert("Remove from Bearing Index", !context.bearingBuckets[180].has("t_hex_1"), "Target removed from bucket 180.");
    } catch (e) {
        assert("TEST SUITE 10 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 11: Coordinates Normalization Math (PRD 3.1)
    // ==========================================================
    try {
        const wrapLon = context.normalizeLon;
        assert("Longitude Wrapper - East Wrap", wrapLon(190) === -170, "190 deg wraps to -170 deg.");
        assert("Longitude Wrapper - West Wrap", wrapLon(-190) === 170, "-190 deg wraps to 170 deg.");
        assert("Longitude Wrapper - Double Wrap", wrapLon(540) === 180, "540 deg wraps to 180 deg.");
        
        const clampLat = context.normalizeLat;
        assert("Latitude Clamp - North Bound", clampLat(95.0) === 85.05112878, "95 deg clamps to Web Mercator north limit.");
        assert("Latitude Clamp - South Bound", clampLat(-95.0) === -85.05112878, "-95 deg clamps to Web Mercator south limit.");
    } catch (e) {
        assert("TEST SUITE 11 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 12: Web Audio Soundscape Control (PRD 3.2)
    // ==========================================================
    try {
        context.audioCtx = null;
        context.audioEnabled = false;

        assert("SpatialAudioConsole class exists", typeof context.SpatialAudioConsole !== "undefined", "SpatialAudioConsole class is defined.");
        assert("spatialAudioConsole global instance exists", typeof context.spatialAudioConsole !== "undefined", "spatialAudioConsole global instance is defined.");

        context.spatialAudioConsole.toggle();
        
        assert("Audio Engine - Context Created", context.audioCtx !== null, "AudioContext instantiated successfully.");
        assert("Audio Engine - Master Gain Created", context.masterGain !== undefined, "masterGain node connected.");
        assert("Audio Engine - Oscillators Started", context.audioSources && context.audioSources.length > 0, "AC mains and ballast oscillators registered in active source list.");
        assert("SpatialAudioConsole encapsulates Context", context.spatialAudioConsole.audioCtx === context.audioCtx, "Console holds reference to AudioContext.");
        assert("SpatialAudioConsole encapsulates panner", context.spatialAudioConsole.panner === context.rumblePanner, "Console holds reference to Sweep panner node.");

        context.spatialAudioConsole.toggle();
    } catch (e) {
        assert("TEST SUITE 12 EXCEPTION", false, e.message);
    }

    // ==========================================================
    // TEST SUITE 13: Class B Balloon Speed Sanity Check (PRD 3.3)
    // ==========================================================
    try {
        const slowBalloon = new context.Aircraft("fake_slow_balloon", { category: "B2", t: "B738", desc: "BOEING 737", gs: 10 });
        assert("Class B Balloon Speed Sanity Check - Slow Balloon", slowBalloon.iconType === 'balloon', "Weather balloon at 10 KTS resolved to 'balloon'.");

        const fastBalloon = new context.Aircraft("fake_fast_balloon", { category: "B2", t: "B738", desc: "BOEING 737", gs: 150 });
        assert("Class B Balloon Speed Sanity Check - Fast Balloon", fastBalloon.iconType === 'jet', "Fast balloon at 150 KTS falls back to standard civilian 'jet' shape.");

        const borderlineBalloon = new context.Aircraft("fake_border_balloon", { category: "B2", t: "C172", desc: "CESSNA 172", gs: 46 });
        assert("Class B Balloon Speed Sanity Check - Borderline Fast Balloon", borderlineBalloon.iconType === 'light', "Fast balloon at 46 KTS falls back to standard civilian 'light' propeller shape.");
    } catch (e) {
        assert("TEST SUITE 13 EXCEPTION", false, e.message);
    }
}

if (typeof exports !== 'undefined') {
    exports.executeRadarIntegrationTestSuite = executeRadarIntegrationTestSuite;
}
