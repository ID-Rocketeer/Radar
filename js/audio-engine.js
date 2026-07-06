function createReverbImpulseResponse(audioCtx, duration, decay) {
    const sampleRate = audioCtx.sampleRate || 44100;
    const length = Math.max(100, Math.round(sampleRate * duration));
    const impulse = audioCtx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        // Exponential decay of white noise to simulate room reflections
        const pct = i / length;
        const decayFactor = Math.exp(-pct * decay);
        left[i] = (Math.random() * 2 - 1) * decayFactor;
        right[i] = (Math.random() * 2 - 1) * decayFactor;
    }
    return impulse;
}

function createPanner(audioCtx, x, y, z) {
    try {
        if (!audioCtx.createPanner) return null;
        const panner = audioCtx.createPanner();
        panner.panningModel = 'equalpower'; // Lightweight and universally compatible across speaker setups
        panner.distanceModel = 'inverse';
        panner.refDistance = 1.0;
        panner.maxDistance = 10000;
        panner.rollOffFactor = 1.0;
        
        // Support modern AudioParam setter syntax with fallback to legacy setPosition
        if (panner.positionX && panner.positionX.setValueAtTime) {
            panner.positionX.setValueAtTime(x, audioCtx.currentTime);
            panner.positionY.setValueAtTime(y, audioCtx.currentTime);
            panner.positionZ.setValueAtTime(z, audioCtx.currentTime);
        } else if (panner.setPosition) {
            panner.setPosition(x, y, z);
        }
        return panner;
    } catch (e) {
        console.warn("PannerNode setup failed, falling back to stereo:", e);
        return null;
    }
}

function initAudioEngine() {
    if (audioCtx) return;

    try {
        // 1. Create AudioContext (fallback to webkitAudioContext)
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            console.warn("Web Audio API not supported in this browser.");
            return;
        }
        audioCtx = new AudioContextClass();

        // 2. Master Volume
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(0.55, audioCtx.currentTime); // Standard comfortable volume
        masterGain.connect(audioCtx.destination);

        // 3. Concrete Room Reverb Node & Send Bus
        const reverbNode = audioCtx.createConvolver();
        const reverbSend = audioCtx.createGain();
        reverbSend.gain.setValueAtTime(0.22, audioCtx.currentTime); // Wet mix level

        try {
            reverbNode.buffer = createReverbImpulseResponse(audioCtx, 1.3, 6.0); // 1.3 second decay
            reverbSend.connect(reverbNode);
            reverbNode.connect(masterGain);
        } catch (reverbErr) {
            console.warn("Concrete room reverb failed, bypassing reverb send:", reverbErr);
        }

        // ==========================================
        // LAYER A: 3-Phase Mains Hum (60 Hz & Harmonics)
        // ==========================================
        const humOsc60 = audioCtx.createOscillator();
        humOsc60.type = 'sawtooth';
        humOsc60.frequency.setValueAtTime(60, audioCtx.currentTime);

        const humOsc120 = audioCtx.createOscillator();
        humOsc120.type = 'sine';
        humOsc120.frequency.setValueAtTime(120, audioCtx.currentTime);

        const humOsc180 = audioCtx.createOscillator();
        humOsc180.type = 'sine';
        humOsc180.frequency.setValueAtTime(180, audioCtx.currentTime);

        const gain60 = audioCtx.createGain();
        gain60.gain.setValueAtTime(0.12, audioCtx.currentTime);

        const gain120 = audioCtx.createGain();
        gain120.gain.setValueAtTime(0.06, audioCtx.currentTime);

        const gain180 = audioCtx.createGain();
        gain180.gain.setValueAtTime(0.03, audioCtx.currentTime);

        const humFilter = audioCtx.createBiquadFilter();
        humFilter.type = 'lowpass';
        humFilter.frequency.setValueAtTime(110, audioCtx.currentTime);
        humFilter.Q.setValueAtTime(1.0, audioCtx.currentTime);

        humOsc60.connect(gain60);
        humOsc120.connect(gain120);
        humOsc180.connect(gain180);

        gain60.connect(humFilter);
        gain120.connect(humFilter);
        gain180.connect(humFilter);

        const humPanner = createPanner(audioCtx, 0, 0, -1);
        if (humPanner) {
            humFilter.connect(humPanner);
            humPanner.connect(masterGain);
            humPanner.connect(reverbSend);
        } else {
            humFilter.connect(masterGain);
            humFilter.connect(reverbSend);
        }

        audioSources.push(humOsc60, humOsc120, humOsc180);

        // ==========================================
        // LAYER B: Rotating Antenna Rumble (47 Hz + 10s Panner Animation)
        // ==========================================
        const rumbleOsc = audioCtx.createOscillator();
        rumbleOsc.type = 'sawtooth';
        rumbleOsc.frequency.setValueAtTime(47, audioCtx.currentTime);
        const rumbleGain = audioCtx.createGain();
        rumbleGain.gain.setValueAtTime(0.07, audioCtx.currentTime);

        const rumbleFilter = audioCtx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.setValueAtTime(150, audioCtx.currentTime);

        rumblePanner = createPanner(audioCtx, 0, 2.5, -1.5);
        if (rumblePanner) {
            rumblePanner.refDistance = 3.0;
            rumbleOsc.connect(rumbleFilter);
            rumbleFilter.connect(rumbleGain);
            rumbleGain.connect(rumblePanner);
            rumblePanner.connect(masterGain);
            rumblePanner.connect(reverbSend);
        } else {
            rumbleOsc.connect(rumbleFilter);
            rumbleFilter.connect(rumbleGain);
            rumbleGain.connect(masterGain);
            rumbleGain.connect(reverbSend);
        }

        audioSources.push(rumbleOsc);

        // ==========================================
        // LAYER C: Ventilation Fans & AC (Muffled Noise + Prime LFOs)
        // ==========================================
        const bufferSize = 2 * audioCtx.sampleRate;
        const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            noiseData[i] = Math.random() * 2 - 1;
        }

        // --- Fan 1: Cabinet cooling fan (Bandpass at 300Hz, Q=1.5) ---
        const fanNoise = audioCtx.createBufferSource();
        fanNoise.buffer = noiseBuffer;
        fanNoise.loop = true;

        const fanFilter = audioCtx.createBiquadFilter();
        fanFilter.type = 'bandpass';
        fanFilter.frequency.setValueAtTime(300, audioCtx.currentTime);
        fanFilter.Q.setValueAtTime(1.5, audioCtx.currentTime);

        const fanGain = audioCtx.createGain();
        fanGain.gain.setValueAtTime(0.06, audioCtx.currentTime);

        const fanLfo = audioCtx.createOscillator();
        fanLfo.type = 'sine';
        fanLfo.frequency.setValueAtTime(0.058, audioCtx.currentTime);

        const fanLfoGain = audioCtx.createGain();
        fanLfoGain.gain.setValueAtTime(0.03, audioCtx.currentTime);

        fanLfo.connect(fanLfoGain);
        fanLfoGain.connect(fanGain.gain);
        fanLfo.start();

        fanNoise.connect(fanFilter);
        fanFilter.connect(fanGain);

        const fanPanner = createPanner(audioCtx, -0.5, -0.5, -1);
        if (fanPanner) {
            fanGain.connect(fanPanner);
            fanPanner.connect(masterGain);
            fanPanner.connect(reverbSend);
        } else {
            fanGain.connect(masterGain);
            fanGain.connect(reverbSend);
        }

        audioSources.push(fanNoise, fanLfo);

        // --- Fan 2: Room air conditioning (Lowpass at 420Hz) ---
        const acNoise = audioCtx.createBufferSource();
        acNoise.buffer = noiseBuffer;
        acNoise.loop = true;

        const acFilter = audioCtx.createBiquadFilter();
        acFilter.type = 'lowpass';
        acFilter.frequency.setValueAtTime(420, audioCtx.currentTime);

        const acGain = audioCtx.createGain();
        acGain.gain.setValueAtTime(0.09, audioCtx.currentTime);

        const acLfo = audioCtx.createOscillator();
        acLfo.type = 'sine';
        acLfo.frequency.setValueAtTime(0.043, audioCtx.currentTime);

        const acLfoGain = audioCtx.createGain();
        acLfoGain.gain.setValueAtTime(0.04, audioCtx.currentTime);

        acLfo.connect(acLfoGain);
        acLfoGain.connect(acGain.gain);
        acLfo.start();

        acNoise.connect(acFilter);
        acFilter.connect(acGain);

        const acPanner = createPanner(audioCtx, 0.8, 1.2, 1.5);
        if (acPanner) {
            acGain.connect(acPanner);
            acPanner.connect(masterGain);
            acPanner.connect(reverbSend);
        } else {
            acGain.connect(masterGain);
            acGain.connect(reverbSend);
        }

        audioSources.push(acNoise, acLfo);

        // ==========================================
        // LAYER D: CRT Flyback Transformer Squeal (15,625 Hz)
        // ==========================================
        const flybackOsc = audioCtx.createOscillator();
        flybackOsc.type = 'sine';
        flybackOsc.frequency.setValueAtTime(15625, audioCtx.currentTime);

        const flybackGain = audioCtx.createGain();
        flybackGain.gain.setValueAtTime(0.04, audioCtx.currentTime);

        flybackOsc.connect(flybackGain);
        
        const flybackPanner = createPanner(audioCtx, 0, 0, -1);
        if (flybackPanner) {
            flybackGain.connect(flybackPanner);
            flybackPanner.connect(masterGain);
        } else {
            flybackGain.connect(masterGain);
        }

        audioSources.push(flybackOsc);

        // ==========================================
        // LAYER E: Magnetic Drum Memory Whir
        // ==========================================
        const spindleOsc = audioCtx.createOscillator();
        spindleOsc.type = 'sine';
        spindleOsc.frequency.setValueAtTime(520, audioCtx.currentTime);

        const spindleLfo = audioCtx.createOscillator();
        spindleLfo.type = 'sine';
        spindleLfo.frequency.setValueAtTime(1.4, audioCtx.currentTime);

        const spindleLfoGain = audioCtx.createGain();
        spindleLfoGain.gain.setValueAtTime(2.0, audioCtx.currentTime);

        spindleLfo.connect(spindleLfoGain);
        spindleLfoGain.connect(spindleOsc.frequency);
        spindleLfo.start();

        const spindleGain = audioCtx.createGain();
        spindleGain.gain.setValueAtTime(0.006, audioCtx.currentTime);

        spindleOsc.connect(spindleGain);

        const spindlePanner = createPanner(audioCtx, 0, 0, -1);
        if (spindlePanner) {
            spindleGain.connect(spindlePanner);
            spindlePanner.connect(masterGain);
            spindlePanner.connect(reverbSend);
        } else {
            spindleGain.connect(masterGain);
            spindleGain.connect(reverbSend);
        }

        audioSources.push(spindleOsc, spindleLfo);

        // ==========================================
        // LAYER F: Ventilation Duct Wind Howl
        // ==========================================
        const ductNoise = audioCtx.createBufferSource();
        ductNoise.buffer = noiseBuffer;
        ductNoise.loop = true;

        const ductFilter = audioCtx.createBiquadFilter();
        ductFilter.type = 'bandpass';
        ductFilter.frequency.setValueAtTime(130, audioCtx.currentTime);
        ductFilter.Q.setValueAtTime(18.0, audioCtx.currentTime);

        const ductLfo = audioCtx.createOscillator();
        ductLfo.type = 'sine';
        ductLfo.frequency.setValueAtTime(0.034, audioCtx.currentTime);

        const ductLfoGain = audioCtx.createGain();
        ductLfoGain.gain.setValueAtTime(20.0, audioCtx.currentTime);

        ductLfo.connect(ductLfoGain);
        ductLfoGain.connect(ductFilter.frequency);
        ductLfo.start();

        const ductGain = audioCtx.createGain();
        ductGain.gain.setValueAtTime(0.02, audioCtx.currentTime);

        ductNoise.connect(ductFilter);
        ductFilter.connect(ductGain);

        const ductPanner = createPanner(audioCtx, 0.8, 1.2, 1.5);
        if (ductPanner) {
            ductGain.connect(ductPanner);
            ductPanner.connect(masterGain);
            ductPanner.connect(reverbSend);
        } else {
            ductGain.connect(masterGain);
            ductGain.connect(reverbSend);
        }

        audioSources.push(ductNoise, ductLfo);

        // ==========================================
        // LAYER G: Fluorescent Light Ballast Hum
        // ==========================================
        const ballastOsc = audioCtx.createOscillator();
        ballastOsc.type = 'sawtooth';
        ballastOsc.frequency.setValueAtTime(120, audioCtx.currentTime);

        const ballastFilter = audioCtx.createBiquadFilter();
        ballastFilter.type = 'bandpass';
        ballastFilter.frequency.setValueAtTime(120, audioCtx.currentTime);
        ballastFilter.Q.setValueAtTime(2.0, audioCtx.currentTime);

        const ballastGain = audioCtx.createGain();
        ballastGain.gain.setValueAtTime(0.015, audioCtx.currentTime);

        ballastOsc.connect(ballastFilter);
        ballastFilter.connect(ballastGain);

        const ballastPanner = createPanner(audioCtx, -0.8, 2.0, 0.5);
        if (ballastPanner) {
            ballastGain.connect(ballastPanner);
            ballastPanner.connect(masterGain);
            ballastPanner.connect(reverbSend);
        } else {
            ballastGain.connect(masterGain);
            ballastGain.connect(reverbSend);
        }

        audioSources.push(ballastOsc);

        // Start all generators
        humOsc60.start();
        humOsc120.start();
        humOsc180.start();
        rumbleOsc.start();
        flybackOsc.start();
        spindleOsc.start();
        ductNoise.start();
        ballastOsc.start();
        fanNoise.start();
        acNoise.start();
    } catch (err) {
        console.error("Failed to initialize audio spatializer:", err);
    }
}

function toggleAudio() {
    const soundBtn = document.getElementById('sound-btn');
    if (!soundBtn) return;

    if (!audioCtx) {
        initAudioEngine();
    }

    if (!audioCtx) return; // Web Audio not supported

    const wavesEl = document.getElementById('sound-waves');
    const muteEl = document.getElementById('sound-mute');

    if (audioEnabled) {
        audioCtx.suspend().then(() => {
            audioEnabled = false;
            if (wavesEl) wavesEl.style.display = 'none';
            if (muteEl) muteEl.style.display = 'block';
            soundBtn.title = 'Enable ambient audio';
        });
    } else {
        audioCtx.resume().then(() => {
            audioEnabled = true;
            if (wavesEl) wavesEl.style.display = 'block';
            if (muteEl) muteEl.style.display = 'none';
            soundBtn.title = 'Mute ambient audio';
        });
    }
}

/**
 * SpatialAudioConsole: Encapsulates Web Audio context, gain controls,
 * oscillator registers, and antenna rumble panner updates.
 */
var SpatialAudioConsole = class SpatialAudioConsole {
    constructor() {
        this.audioCtx = null;
        this.masterGain = null;
        this.audioSources = [];
        this.panner = null;
        this.audioEnabled = false;
        this.nextScheduleTime = undefined;
    }

    init() {
        if (this.audioCtx) return;
        initAudioEngine();
        this.audioCtx = audioCtx;
        this.masterGain = masterGain;
        this.audioSources = audioSources;
        this.panner = rumblePanner;
        this.audioEnabled = audioEnabled;
    }

    toggle() {
        this.init();
        toggleAudio();
        this.audioEnabled = audioEnabled;
        return this.audioEnabled;
    }

    updatePanner(nextAngle) {
        this.audioEnabled = audioEnabled;
        if (this.audioCtx && this.audioEnabled && this.panner) {
            // Handle sweep pauses/interruptions (e.g. selection mode)
            const isActive = typeof sweepActive !== 'undefined' ? sweepActive : true;
            if (!isActive) {
                if (this.panner.positionX && this.panner.positionX.cancelScheduledValues) {
                    this.panner.positionX.cancelScheduledValues(this.audioCtx.currentTime);
                    this.panner.positionZ.cancelScheduledValues(this.audioCtx.currentTime);
                }
                this.nextScheduleTime = undefined;
                return;
            }

            if (this.nextScheduleTime === undefined || this.nextScheduleTime < this.audioCtx.currentTime) {
                this.nextScheduleTime = this.audioCtx.currentTime;
            }

            const lookAhead = 1.0; // 1 second buffer
            const scheduleInterval = 5.0; // 5-second chunk updates

            if (this.nextScheduleTime < this.audioCtx.currentTime + lookAhead) {
                const startTime = this.nextScheduleTime;
                const duration = scheduleInterval;
                const tCurrent = this.audioCtx.currentTime;

                const steps = 100;
                const sineCurve = new Float32Array(steps);
                const cosineCurve = new Float32Array(steps);

                for (let i = 0; i < steps; i++) {
                    const fraction = i / (steps - 1);
                    const t = startTime + fraction * duration;
                    // Pre-calculate angle sweep: nextAngle + 36 * (t - tCurrent)
                    const angle = nextAngle + 36 * (t - tCurrent);
                    const rad = (angle % 360) * Math.PI / 180;
                    sineCurve[i] = Math.sin(rad) * 1.5;
                    cosineCurve[i] = -Math.cos(rad) * 1.5;
                }

                if (this.panner.positionX && this.panner.positionX.setValueCurveAtTime) {
                    try {
                        this.panner.positionX.cancelScheduledValues(startTime);
                        this.panner.positionZ.cancelScheduledValues(startTime);
                        this.panner.positionX.setValueCurveAtTime(sineCurve, startTime, duration);
                        this.panner.positionZ.setValueCurveAtTime(cosineCurve, startTime, duration);
                    } catch (e) {
                        console.warn("setValueCurveAtTime failed, falling back to setValueAtTime:", e);
                        const rad = (nextAngle % 360) * Math.PI / 180;
                        this.panner.positionX.setValueAtTime(Math.sin(rad) * 1.5, tCurrent);
                        this.panner.positionZ.setValueAtTime(-Math.cos(rad) * 1.5, tCurrent);
                    }
                } else if (this.panner.setPosition) {
                    const rad = (nextAngle % 360) * Math.PI / 180;
                    this.panner.setPosition(Math.sin(rad) * 1.5, 2.5, -Math.cos(rad) * 1.5);
                }

                this.nextScheduleTime += duration;
            }
        }
    }
};

var spatialAudioConsole = new SpatialAudioConsole();
