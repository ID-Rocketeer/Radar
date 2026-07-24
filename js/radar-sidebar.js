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
        this.currentAc = null;
        this.onHexClickCallback = null;

        if (typeof document !== 'undefined') {
            const headerEl = document.querySelector('.telemetry-panel .panel-title');
            if (headerEl) {
                headerEl.addEventListener('click', () => {
                    if (this.currentAc && this.onHexClickCallback) {
                        this.onHexClickCallback(this.currentAc);
                    }
                });
            }
        }
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
                <span class="tel-val hex-tracker-toggle" id="hex-toggle-${ac.hex}" style="font-weight: bold; ${isTracked ? 'color: #d4ff00; text-shadow: 0 0 6px rgba(212, 255, 0, 0.6);' : ''}">${ac.hex.toUpperCase()}</span>
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

        this.currentAc = ac;
        this.onHexClickCallback = onHexClickCallback;
    }

    resetDetails() {
        this.currentAc = null;
        this.onHexClickCallback = null;
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

if (typeof exports !== 'undefined') {
    exports.RadarSidebar = RadarSidebar;
}
