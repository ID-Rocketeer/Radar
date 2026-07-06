const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log("SYS_DIAGNOSTIC: RUNNING HEADLESS NODE UNIT TESTS");

// 1. MOCK MINIMAL BROWSER ENVIRONMENT FOR NODE
const mockElementsById = {};

const mockElement = (id = '', classes = []) => {
    const classListSet = new Set(classes);
    const el = {
        id,
        classList: {
            add: (c) => classListSet.add(c),
            remove: (c) => classListSet.delete(c),
            toggle: (c, force) => {
                if (force === undefined) {
                    if (classListSet.has(c)) classListSet.delete(c);
                    else classListSet.add(c);
                } else if (force) {
                    classListSet.add(c);
                } else {
                    classListSet.delete(c);
                }
            },
            contains: (c) => classListSet.has(c)
        },
        style: { transform: '' },
        children: [],
        parentNode: null,
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
        },
        insertBefore(child, reference) {
            child.parentNode = this;
            const refIdx = this.children.indexOf(reference);
            if (refIdx !== -1) {
                this.children.splice(refIdx, 0, child);
            } else {
                this.children.push(child);
            }
        },
        removeChild(child) {
            const idx = this.children.indexOf(child);
            if (idx !== -1) {
                this.children.splice(idx, 1);
            }
            child.parentNode = null;
        },
        addEventListener() {},
        getBoundingClientRect() { return { width: 400, height: 400 }; },
        setAttribute(name, value) {
            if (name === 'd') this.pathD = value;
        },
        dispatchEvent(event) {
            if (event.type === 'pointerdown') {
                const listeners = this.listeners || [];
                console.log(`Debug dispatchEvent: id=${this.id}, listeners count=${listeners.length}`);
                listeners.forEach((fn, idx) => {
                    try {
                        fn(event);
                    } catch(e) {
                        console.error(`Error in listener ${idx} for ${this.id || 'unknown'}:`, e);
                    }
                });
            }
        },
        querySelector(sel) {
            if (sel.includes('path')) return mockElement();
            if (sel.includes('.aircraft-icon')) {
                if (!this.iconSvg) {
                    this.iconSvg = mockElement();
                }
                return this.iconSvg;
            }
            return mockElement();
        },
        listeners: [],
        addEventListener(type, fn) {
            this.listeners = this.listeners || [];
            this.listeners.push(fn);
        }
    };
    if (id) {
        mockElementsById[id] = el;
    }
    return el;
};

global.window = {
    location: { search: "?lat=30.19453&lon=-97.66987&rng=250" },
    history: { replaceState() {} },
    addEventListener() {},
    localStorage: {
        store: { codeRedActive: 'false' },
        getItem(k) { return this.store[k] || null; },
        setItem(k, v) { this.store[k] = String(v); }
    },
    PointerEvent: class {
        constructor(type) { this.type = type; }
        preventDefault() {}
        stopPropagation() {}
    }
};

global.PointerEvent = global.window.PointerEvent;
global.localStorage = global.window.localStorage;

const mockPilotLight = mockElement('codered-light');
const mockScrews = [
    mockElement('', ['scope-screw', 's0']),
    mockElement('', ['scope-screw', 's45']),
    mockElement('', ['scope-screw', 's90']),
    mockElement('', ['scope-screw', 's135']),
    mockElement('', ['scope-screw', 's180']),
    mockElement('', ['scope-screw', 's225']),
    mockElement('', ['scope-screw', 's270']),
    mockElement('', ['scope-screw', 's315'])
];

global.document = {
    readyState: "complete",
    addEventListener() {},
    body: {
        contains() { return true; },
        classList: { add() {}, remove() {} }
    },
    getElementById(id) {
        if (!id || typeof id !== 'string') return null;
        if (id === 'codered-light') return mockPilotLight;
        if (id.startsWith('marker-')) {
            const hex = id.replace('marker-', '');
            const ac = context.activeAircraft ? context.activeAircraft[hex] : null;
            if (ac && ac.marker) {
                return ac.marker.getElement();
            }
        }
        return mockElementsById[id] || mockElement(id);
    },
    querySelector(sel) {
        if (sel === '#codered-light') return mockPilotLight;
        if (sel.startsWith('.scope-screw.')) {
            const cls = sel.replace('.scope-screw.', '');
            return mockScrews.find(s => s.classList.contains(cls)) || mockElement();
        }
        return mockElementsById[sel] || mockElement();
    },
    querySelectorAll(sel) {
        if (sel === '.scope-screw') {
            return mockScrews;
        }
        return [mockElement()];
    },
    createElement() { return mockElement(); }
};

global.L = {
    map() {
        const m = {
            _invalidateSizeCount: 0,
            addLayer() {},
            removeLayer() {},
            hasLayer() { return true; },
            invalidateSize() { this._invalidateSizeCount++; },
            setView() { return this; },
            getZoom() { return 10; },
            getMinZoom() { return 1; },
            setMinZoom() {},
            getCenter() {
                return {
                    lat: 30.19,
                    lng: -97.66,
                    distanceTo() { return 10000; }
                };
            },
            createPane() {},
            getPane() { return mockElement(); },
            on() {},
            latLngToLayerPoint() {
                return {
                    x: 50,
                    y: 50,
                    distanceTo() { return 100; }
                };
            }
        };
        if (!global.L.firstCreatedMap) {
            global.L.firstCreatedMap = m;
        }
        global.L.lastCreatedMap = m;
        return m;
    },
    marker(latlng, options) {
        const m = {
            _latlng: latlng,
            on() {},
            addTo() { return this; },
            setLatLng(l) { this._latlng = l; },
            getLatLng() { return this._latlng; },
            getElement() {
                if (!m._el) {
                    m._el = mockElement();
                    if (options && options.icon && options.icon.html) {
                        const html = options.icon.html;
                        const rotateMatch = html.match(/style="transform:\s*rotate\(([^)]+)\);?"/);
                        if (rotateMatch) {
                            const rotateVal = rotateMatch[1];
                            const iconSvg = m._el.querySelector('.aircraft-icon');
                            if (iconSvg) {
                                iconSvg.style.transform = `rotate(${rotateVal})`;
                            }
                        }
                    }
                }
                return m._el;
            }
        };
        return m;
    },
    tileLayer() {
        return { addTo() {} };
    },
    divIcon(opts) {
        return { html: opts ? opts.html : '' };
    },
    latLng(lat, lon) {
        return {
            lat,
            lng: lon,
            distanceTo() { return 10000; }
        };
    },
    circle(latlng, options) {
        const c = {
            _latlng: latlng,
            addTo() { return this; },
            setLatLng(l) { this._latlng = l; },
            getLatLng() { return this._latlng; },
            setRadius() {}
        };
        return c;
    },
    polyline() {
        return {
            addTo() {},
            getLatLngs() { return []; },
            setLatLngs() {},
            getElement() { return mockElement(); }
        };
    },
    svg() {
        return {};
    }
};

global.ResizeObserver = class { observe() {} };
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ac: [] }) });
global.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);

// Mock Web Audio Context to prevent actual hardware allocation in Node
class MockAudioContext {
    constructor() {
        this.state = 'suspended';
        this.destination = {};
        this.sampleRate = 44100;
        this.currentTime = 0;
    }
    createGain() {
        return {
            gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
            connect() {}
        };
    }
    createOscillator() {
        return {
            frequency: { setValueAtTime() {} },
            connect() {},
            start() {},
            type: 'sine'
        };
    }
    createBiquadFilter() {
        return {
            frequency: { setValueAtTime() {} },
            Q: { setValueAtTime() {} },
            connect() {},
            type: 'bandpass'
        };
    }
    createPanner() {
        return {
            panningModel: 'HRTF',
            distanceModel: 'inverse',
            refDistance: 1,
            maxDistance: 100,
            rolloffFactor: 1,
            positionX: { 
                _setValueCurveCount: 0,
                _cancelScheduledValuesCount: 0,
                setValueAtTime() {},
                setValueCurveAtTime(curve, start, dur) { this._setValueCurveCount++; },
                cancelScheduledValues(start) { this._cancelScheduledValuesCount++; }
            },
            positionY: { setValueAtTime() {} },
            positionZ: { 
                _setValueCurveCount: 0,
                _cancelScheduledValuesCount: 0,
                setValueAtTime() {},
                setValueCurveAtTime(curve, start, dur) { this._setValueCurveCount++; },
                cancelScheduledValues(start) { this._cancelScheduledValuesCount++; }
            },
            connect() {}
        };
    }
    createConvolver() {
        return {
            buffer: null,
            connect() {}
        };
    }
    createBuffer() {
        return {
            getChannelData() { return new Float32Array(100); }
        };
    }
    createBufferSource() {
        return {
            buffer: null,
            connect() {},
            start() {},
            stop() {},
            loop: false
        };
    }
    resume() {
        this.state = 'running';
        return Promise.resolve();
    }
    suspend() {
        this.state = 'suspended';
        return Promise.resolve();
    }
}
global.AudioContext = MockAudioContext;
global.window.AudioContext = MockAudioContext;
global.window.webkitAudioContext = MockAudioContext;

// 2. LOAD APPLICATION CODE
// We check if split files exist first. If they do, we load them in sequence. If not, load monolithic app.js.
const scripts = [];
const splitPath = path.join(__dirname, 'js', 'warbird-db.js');
if (fs.existsSync(splitPath)) {
    console.log("Loading modular scripts...");
    scripts.push(
        fs.readFileSync(path.join(__dirname, 'js', 'utils.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'js', 'warbird-db.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'js', 'aircraft.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'js', 'chassis.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'js', 'radar-sidebar.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'js', 'radar-scope.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'js', 'ingestion.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'js', 'audio-engine.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8')
    );
} else {
    console.log("Loading monolithic app.js...");
    scripts.push(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'));
}

const context = vm.createContext(global);
scripts.forEach(code => {
    vm.runInContext(code, context);
});

// Disable background audio initialization in console context
context.audioCtx = null;
context.sweepActive = false;

// 3. EXECUTE TESTS AFTER ASYNC DOMContentLoaded INITIALIZATION COMPLETES
setTimeout(() => {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let pending = 0;

    context.assert = function(name, condition, msg = '') {
        total++;
        if (condition) {
            passed++;
            console.log(`[PASS] ${name}`);
        } else {
            failed++;
            console.error(`[FAIL] ${name}: ${msg}`);
        }
    };

    context.assertPending = function(name, msg = '') {
        total++;
        pending++;
        console.log(`[PEND] ${name}: ${msg}`);
    };

    // Load and run the unit test specifications
    console.log("\n--- RUNNING UNIT TESTS ---");
    const unitSpecCode = fs.readFileSync(path.join(__dirname, 'tests-unit-spec.js'), 'utf8');
    vm.runInContext(unitSpecCode, context);
    context.executeRadarUnitTestSuite(context);

    // Halt early if unit tests failed
    if (failed > 0) {
        console.error(`\n[FATAL] Unit tests failed. Skipping integration tests.`);
        console.log(`TESTS COMPLETE: ${passed}/${total} PASSED, ${failed} FAILED, ${pending} PENDING`);
        process.exit(1);
    }

    // Load and run the integration test specifications
    console.log("\n--- RUNNING INTEGRATION TESTS ---");
    const integrationSpecCode = fs.readFileSync(path.join(__dirname, 'tests-integration-spec.js'), 'utf8');
    vm.runInContext(integrationSpecCode, context);
    context.executeRadarIntegrationTestSuite(context);

    // REPORT SUMMARY
    console.log(`\nTESTS COMPLETE: ${passed}/${total} PASSED, ${failed} FAILED, ${pending} PENDING`);
    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}, 250);
