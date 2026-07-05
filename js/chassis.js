var RadarChassis = class RadarChassis {
    constructor(callbacks = {}) {
        this.callbacks = callbacks;
    }

    init() {
        this.initParallaxGlare();
        this.initScrews();
        this.initPilotLight();
    }

    getBezelDiameter() {
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

    initParallaxGlare() {
        const glareReflection = document.getElementById('glass-glare-reflection');
        if (!glareReflection) return;

        window.addEventListener('mousemove', (e) => {
            const x = (e.clientX / window.innerWidth) - 0.5;
            const y = (e.clientY / window.innerHeight) - 0.5;

            const moveX = x * 30;
            const moveY = y * 30;

            glareReflection.style.transform = `translate(${moveX}px, ${moveY}px) rotate(-15deg) scale(1.2)`;
        });
    }

    initScrews() {
        window.addEventListener('touchstart', function onFirstTouch() {
            document.body.classList.add('touch-enabled');
            window.removeEventListener('touchstart', onFirstTouch);
        }, { passive: true });

        const activationSequence = ['s0', 's135', 's270', 's45', 's180', 's315', 's90', 's225'];
        let eggClicks = [];
        let eggStartTime = 0;
        let lastScrewClicks = {};

        const getScrewPosition = (el) => {
            const positions = ['s0', 's45', 's90', 's135', 's180', 's225', 's270', 's315'];
            return positions.find(cls => el.classList.contains(cls)) || null;
        };

        document.querySelectorAll('.scope-screw').forEach(screw => {
            const touchTarget = document.createElement('div');
            touchTarget.className = 'screw-touch-target';
            screw.appendChild(touchTarget);

            screw.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const isWbActive = this.callbacks.isWarbirdModeActive ? this.callbacks.isWarbirdModeActive() : false;
                if (isWbActive) return;

                const pos = getScrewPosition(screw);
                if (!pos) return;

                const now = Date.now();

                if (lastScrewClicks[pos] && (now - lastScrewClicks[pos] < 300)) {
                    return;
                }
                lastScrewClicks[pos] = now;

                if (eggClicks.length === 0 || now - eggStartTime > 20000) {
                    eggClicks = [];
                    eggStartTime = now;
                }
                if (pos === activationSequence[eggClicks.length]) {
                    eggClicks.push(pos);
                    if (eggClicks.length === activationSequence.length) {
                        if (this.callbacks.setWarbirdModeActive) {
                            this.callbacks.setWarbirdModeActive(true);
                        }
                        eggClicks = [];
                        if (this.callbacks.refreshWarbirdStyling) {
                            this.callbacks.refreshWarbirdStyling();
                        }
                    }
                } else {
                    eggClicks = [];
                    eggStartTime = now;
                    if (pos === activationSequence[0]) {
                        eggClicks.push(pos);
                    }
                }
            });
        });
    }

    initPilotLight() {
        const pilotLight = document.getElementById('codered-light');
        if (pilotLight) {
            const touchTarget = document.createElement('div');
            touchTarget.className = 'screw-touch-target';
            pilotLight.appendChild(touchTarget);

            let deactClicks = [];
            let deactStartTime = 0;
            let lastLightClick = 0;

            pilotLight.addEventListener('pointerdown', (e) => {
                const isWbActive = this.callbacks.isWarbirdModeActive ? this.callbacks.isWarbirdModeActive() : false;
                if (!isWbActive) return;

                e.preventDefault();
                e.stopPropagation();

                const now = Date.now();

                if (now - lastLightClick < 300) {
                    return;
                }
                lastLightClick = now;

                if (deactClicks.length === 0 || now - deactStartTime > 5000) {
                    deactClicks = [now];
                    deactStartTime = now;
                } else {
                    deactClicks.push(now);
                }

                if (deactClicks.length >= 3) {
                    if (this.callbacks.setWarbirdModeActive) {
                        this.callbacks.setWarbirdModeActive(false);
                    }
                    deactClicks = [];
                    if (this.callbacks.refreshWarbirdStyling) {
                        this.callbacks.refreshWarbirdStyling();
                    }
                }
            });
        }
    }
}


