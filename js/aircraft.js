// SVG silhouettes for different aircraft classifications (optimized for 24x24 viewBox)
var AIRCRAFT_ICONS = {
    // Standard commercial airliner/medium-heavy jet
    jet: 'M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z',
    // Sleek delta-wing military fighter jet
    fighter: 'M12,2L14.5,10L22,12.5L14.5,14L13.5,19.5L15.5,21.5L12,21L8.5,21.5L10.5,19.5L9.5,14L2,12.5L9.5,10Z',
    // Light general aviation/propeller airplane (wide straight wings)
    light: 'M12,2A1,1 0 0,0 11,3V8.5L1,9.5V11.5L11,10.5V19L7.5,21.5V22.5L12,22L16.5,22.5V21.5L13,19V10.5L23,11.5V9.5L13,8.5V3A1,1 0 0,0 12,2Z',
    // Helicopter top-down view (rotors & tail spinner)
    helicopter: 'M12,6C13.7,6 14.8,7.5 14.8,10C14.8,12 13.5,14 12.8,16H11.2C10.5,14 9.2,12 9.2,10C9.2,7.5 10.3,6 12,6ZM2.7,3.3L20.7,21.3L21.3,20.7L3.3,2.7ZM20.7,2.7L2.7,20.7L3.3,21.3L21.3,3.3ZM12,9.8A1.2,1.2 0 1,1 12,12.2A1.2,1.2 0 1,1 12,9.8ZM11.6,16H12.4V22H11.6ZM9,19.7H15V20.3H9ZM9.7,19H10.3V23H9.7ZM10.3,21.2H11.6V21.8H10.3',
    // Class B Glider/Sailplane (very high-aspect long wings)
    glider: 'M12,2L13,8L23,9L23,10L13,10L12,22L11,22L11,10L1,10L1,9L11,8Z',
    // Class B Lighter-Than-Air (weather/hot-air balloon with gradual, continuous bottom taper)
    balloon: 'M 12,2 C 7,2 5.5,4.5 5.5,8 C 5.5,11.5 8.5,14.5 10,17 L 11,18.5 L 13,18.5 L 14,17 C 15.5,14.5 18.5,11.5 18.5,8 C 18.5,4.5 17,2 12,2 Z M 10,20.5 L 14,20.5 L 14,22.5 L 10,22.5 Z',
    // Class B Parachutist (dome canopy, thick outer V-shrouds, and distinct jumper blip)
    parachute: 'M 5,9 C 5,4 8,2 12,2 C 16,2 19,4 19,9 Z M 5,8.5 L 7,8.5 L 12.5,17 L 10.5,17 Z M 19,8.5 L 17,8.5 L 11.5,17 L 13.5,17 Z M 10,18 L 14,18 L 14,22 L 10,22 Z',
    // Class B Ultralight (delta-wing with suspended trike frame pod)
    ultralight: 'M12,2L23,12L14,11L13,20L11,20L10,11L1,12Z',
    // Class B UAV/Drone (bold quadcopter silhouette with smooth curved rotors)
    drone: 'M12,9L6,3C4.5,1.5 1.5,4.5 3,6L9,12L3,18C1.5,19.5 4.5,22.5 6,21L12,15L18,21C19.5,22.5 22.5,19.5 21,18L15,12L21,6C22.5,4.5 19.5,1.5 18,3L12,9Z',
    // Class B Space Vehicle (upright Mercury capsule pointing straight up at 0 degrees)
    space_vehicle: 'M6,18C6,19.5 18,19.5 18,18L14,8L13,8L13,2L11,2L11,8L10,8Z',
    // Active Warbird WWII Bomber (four-engine heavy bomber with engine nacelles)
    warbird_bomber: 'M12,2 C13,2 13.5,4 13.5,7 L14,7 L14,6 L15,6 L15,7 L17,7.5 L17,6.5 L18,6.5 L18,9 L23.5,9.5 L23.5,12.5 L13.5,14.5 L13.5,20 L17,21.5 L17,22.5 L12,22 L7,22.5 L7,21.5 L10.5,20 L10.5,14.5 L0.5,12.5 L0.5,9.5 L6,9 L6,6.5 L7,6.5 L7,7.5 L9,7 L9,6 L10,6 L10,7 L10.5,7 C10.5,4 11,2 12,2 Z',
    // Active Warbird WWII Fighter/Attack/Pursuit (classic piston fighter with elliptical Spitfire-style wings)
    warbird_fighter: 'M12,4 C12.5,4 13,5.5 13,8.5 L20.5,10.5 L20.5,12.5 L13,12.5 L13,17 L15,18.5 L15,19.5 L12,19 L9,19.5 L9,18.5 L11,17 L11,12.5 L3.5,12.5 L3.5,10.5 L11,8.5 C11,5.5 11.5,4 12,4 Z',
    // Active Warbird WWII Transport (classic twin-engine propeller transport/C-47 Goony Bird)
    warbird_transport: 'M12,2 C12.5,2 13,4 13,9 L14.5,9 L14.5,8 L15.5,8 L15.5,10 L23.5,12.5 L23.5,14 L13,14 L13,20 L16.5,21.5 L16.5,22.5 L12,22 L7.5,22.5 L7.5,21.5 L11,20 L11,14 L0.5,14 L0.5,12.5 L8.5,10 L8.5,8 L9.5,8 L9.5,9 L11,9 C11,4 11.5,2 12,2 Z'
};

var Aircraft = class Aircraft {
    constructor(hex, rawAc) {
        this.hex = hex;
        
        // Escape HTML and apply default fallback values for string attributes
        this.category = escapeHtml(rawAc.category || '').toUpperCase();
        this.reg = escapeHtml(rawAc.r || 'UNKNOWN');
        this.type = escapeHtml(rawAc.t || 'UNKN');
        this.desc = escapeHtml(rawAc.desc || 'AIRCRAFT');
        this.squawk = escapeHtml(rawAc.squawk || '0000');

        this.isClassB = this.category.startsWith('B');
        this.specialBSubtype = 'CLASS B';
        if (this.isClassB) {
            const cat = this.category;
            if (cat === 'B1') this.specialBSubtype = 'GLIDER';
            else if (cat === 'B2') this.specialBSubtype = 'LIGHTER-THAN-AIR';
            else if (cat === 'B3') this.specialBSubtype = 'PARACHUTIST';
            else if (cat === 'B4') this.specialBSubtype = 'ULTRALIGHT';
            else if (cat === 'B6') this.specialBSubtype = 'UAV/DRONE';
            else if (cat === 'B7') this.specialBSubtype = 'SPACE VEHICLE';
        }

        // Target Lifecycle & DOM Cache Defaults
        this.marker = null;
        this.trail = null;
        this.markerEl = null;
        this.pathEl = null;
        this.iconSvg = null;
        this.pendingUpdate = null;
        this.pendingRemoval = false;
        this.sweptOnce = false;

        // Parse and ingest telemetry directly from rawAc
        this.lat = parseFloat(rawAc.lat) || 0;
        this.lon = parseFloat(rawAc.lon) || 0;
        
        this.isOnGround = rawAc.alt_baro === 'ground' || rawAc.alt_geom === 'ground' || rawAc.ground === true || rawAc.ground === 1;
        this.alt = this.isOnGround ? 0 : Number(rawAc.alt_baro || rawAc.alt_geom || 0);
        this.speed = Number(rawAc.gs || rawAc.ias || rawAc.tas || 0);
        this.track = Number(rawAc.track || 0);
        this.seen = Number(rawAc.seen || 0);

        const rawCallsign = (rawAc.flight || rawAc.r || this.hex || '').trim();
        this.callsign = escapeHtml(rawCallsign);

        const dbFlagsVal = rawAc.dbFlags !== undefined ? rawAc.dbFlags : rawAc.dbflags;
        this.mil = !!(rawAc.mil === 1 || rawAc.mil === true || (dbFlagsVal & 1) === 1);

        // Precompute bearing and distance relative to current station
        const hLat = typeof HOME_LAT !== 'undefined' ? HOME_LAT : 0;
        const hLon = typeof HOME_LON !== 'undefined' ? HOME_LON : 0;
        this.bearing = rawAc.bearing !== undefined ? rawAc.bearing : calcBearing(this.lat, this.lon);
        this.dist = rawAc.dist !== undefined ? rawAc.dist : calcDistance(hLat, hLon, this.lat, this.lon);

        // Statically determine if aircraft is commercial
        const isAirline = /^[A-Z]{3}\d/.test(this.callsign);
        const cat = this.category;
        this._isCommercial = !this.mil && !this.isClassB && (isAirline || cat === 'A3' || cat === 'A5');
    }

    get iconType() {
        const category = (this.category || '').toUpperCase();
        const typeCode = (this.type || '').toUpperCase();
        const desc = (this.desc || '').toUpperCase();

        // WWII Warbirds custom icons when warbirdModeActive is enabled
        if (this.isActiveWarbird) {
            const subtype = this.warbirdSubtype;
            if (['BOMBER', 'TORPEDO BOMBER', 'PATROL BOMBER', 'SCOUT BOMBER'].includes(subtype)) {
                return 'warbird_bomber';
            }
            if (['FIGHTER', 'ATTACK', 'PURSUIT', 'JET'].includes(subtype)) {
                return 'warbird_fighter';
            }
            if (subtype === 'TRANSPORT') {
                return 'warbird_transport';
            }
        }

        // Class B Iconography (Applies universally)
        const speed = Number(this.speed || 0);

        if (category === 'B1') return 'glider';
        if (category === 'B2') {
            if (speed <= 45) {
                return 'balloon';
            }
        }
        if (category === 'B3') return 'parachute';
        if (category === 'B4') return 'ultralight';
        if (category === 'B6') return 'drone';
        if (category === 'B7') return 'space_vehicle';

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

        // 2. Military Fighters / SLEEK jets (Category A4 = High Performance, military prefix types, or specific jet warbirds)
        const isMilTarget = !!(this.mil === 1 || this.mil === true);
        const isSleekJet = isMilTarget && (category === 'A4' || typeCode.startsWith('F-') || typeCode.startsWith('FA-') || typeCode.startsWith('A-') || ['F15', 'F16', 'F18', 'F22', 'F35', 'A10', 'T38', 'B1', 'B2', 'B52', 'C17', 'C130', 'KC135'].includes(typeCode));
        if (isSleekJet || typeCode === 'ME62' || typeCode === 'METE') {
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
            typeCode.match(/^RV\d+$/) ||
            // Any other warbird that is not one of our jet holdouts
            (WARBIRD_TYPE_CODES.has(typeCode) && typeCode !== 'ME62' && typeCode !== 'METE')
        );
        if (isPropeller) {
            return 'light';
        }

        // Default to commercial jet liner
        return 'jet';
    }

    get isCommercial() {
        return this._isCommercial;
    }

    get isWarbird() {
        return WARBIRD_TYPE_CODES.has(this.type.toUpperCase());
    }

    get isActiveWarbird() {
        return warbirdModeActive && this.isWarbird;
    }

    get warbirdSubtype() {
        return getWarbirdSubtype(this);
    }

    update(rawAc) {
        // Update category and category-derived flags
        this.category = escapeHtml(rawAc.category || '').toUpperCase();
        this.isClassB = this.category.startsWith('B');
        this.specialBSubtype = 'CLASS B';
        if (this.isClassB) {
            const cat = this.category;
            if (cat === 'B1') this.specialBSubtype = 'GLIDER';
            else if (cat === 'B2') this.specialBSubtype = 'LIGHTER-THAN-AIR';
            else if (cat === 'B3') this.specialBSubtype = 'PARACHUTIST';
            else if (cat === 'B4') this.specialBSubtype = 'ULTRALIGHT';
            else if (cat === 'B6') this.specialBSubtype = 'UAV/DRONE';
            else if (cat === 'B7') this.specialBSubtype = 'SPACE VEHICLE';
        }

        const lat = parseFloat(rawAc.lat) || 0;
        const lon = parseFloat(rawAc.lon) || 0;
        const isOnGround = rawAc.alt_baro === 'ground' || rawAc.alt_geom === 'ground' || rawAc.ground === true || rawAc.ground === 1;
        const alt = isOnGround ? 0 : Number(rawAc.alt_baro || rawAc.alt_geom || 0);
        const speed = Number(rawAc.gs || rawAc.ias || rawAc.tas || 0);
        const track = Number(rawAc.track || 0);
        const seen = Number(rawAc.seen || 0);

        const hLat = typeof HOME_LAT !== 'undefined' ? HOME_LAT : 0;
        const hLon = typeof HOME_LON !== 'undefined' ? HOME_LON : 0;
        const bearing = rawAc.bearing !== undefined ? rawAc.bearing : calcBearing(lat, lon);
        const dist = rawAc.dist !== undefined ? rawAc.dist : calcDistance(hLat, hLon, lat, lon);

        this.pendingUpdate = {
            lat: lat,
            lon: lon,
            alt: alt,
            isOnGround: isOnGround,
            speed: speed,
            track: track,
            bearing: bearing,
            dist: dist,
            seen: seen
        };

        this.seen = this.pendingUpdate.seen;
    }

    cacheDomElements() {
        if (this.markerEl && typeof document !== 'undefined' && document.body && document.body.contains(this.markerEl)) return; // Already cached and attached to DOM
        
        // Reset cache if element is detached
        this.markerEl = null;
        this.pathEl = null;
        this.iconSvg = null;

        const safeHex = sanitizeId(this.hex);
        if (typeof document !== 'undefined') {
            const markerDom = document.getElementById(`marker-${safeHex}`);
            if (markerDom) {
                this.markerEl = markerDom;
                this.pathEl = markerDom.querySelector('.aircraft-icon path');
                this.iconSvg = markerDom.querySelector('.aircraft-icon');
            }
        }
    }

    render(map, visible, trailsEnabled, classBEnabled) {
        this.visible = visible;

        if (visible) {
            const safeHex = sanitizeId(this.hex);
            
            // Lazy create marker on map only if it is visible
            if (!this.marker) {
                const iconPath = AIRCRAFT_ICONS[this.iconType || 'jet'];
                const markerIcon = L.divIcon({
                    className: `aircraft-marker-container`,
                    html: `
                        <div class="aircraft-marker ${this.mil ? 'mil' : ''} ${this.isActiveWarbird ? 'warbird' : ''} ${classBEnabled && this.isClassB ? 'special-b' : ''}" id="marker-${safeHex}">
                            <svg class="aircraft-icon" viewBox="0 0 24 24" style="transform: rotate(${(this.iconType === 'balloon' || this.iconType === 'parachute') ? 0 : this.track}deg);">
                                <path d="${iconPath}" />
                            </svg>
                            <div class="aircraft-label">${this.callsign}</div>
                        </div>
                    `,
                    iconSize: [30, 45],
                    iconAnchor: [15, 10]
                });
                this.marker = L.marker([this.lat, this.lon], { icon: markerIcon }).addTo(map);
                this.marker.on('click', () => selectAircraft(this.hex));
            } else {
                this.marker.setLatLng([this.lat, this.lon]);
                if (!map.hasLayer(this.marker)) {
                    this.marker.addTo(map);
                }
                
                // Synchronize rotation and icon path in the DOM
                this.cacheDomElements();
                if (this.markerEl) {
                    if (this.iconSvg) {
                        this.iconSvg.style.transform = `rotate(${(this.iconType === 'balloon' || this.iconType === 'parachute') ? 0 : this.track}deg)`;
                    }
                    if (this.pathEl) {
                        this.pathEl.setAttribute('d', AIRCRAFT_ICONS[this.iconType || 'jet']);
                    }
                    this.markerEl.classList.toggle('warbird', this.isActiveWarbird);
                    this.markerEl.classList.toggle('special-b', classBEnabled && this.isClassB);
                }
            }

            // Lazy create trail polyline on map
            if (trailsEnabled) {
                if (!this.trail) {
                    this.trail = L.polyline([[this.lat, this.lon]], {
                        className: `radar-trail ${this.mil ? 'mil' : ''} ${this.isActiveWarbird ? 'warbird' : ''} ${classBEnabled && this.isClassB ? 'special-b' : ''}`,
                        interactive: false
                    }).addTo(map);
                } else {
                    if (!map.hasLayer(this.trail)) {
                        this.trail.addTo(map);
                    }
                }
            } else {
                if (this.trail && map.hasLayer(this.trail)) {
                    this.trail.remove();
                }
            }
        } else {
            // Prune off-screen or filtered markers from the map DOM to release memory/CPU load
            if (this.marker && map.hasLayer(this.marker)) {
                map.removeLayer(this.marker);
            }
            if (this.trail && map.hasLayer(this.trail)) {
                map.removeLayer(this.trail);
            }
        }
    }

    destroy(map) {
        if (this.marker) {
            if (map && map.hasLayer(this.marker)) {
                map.removeLayer(this.marker);
            }
            this.marker = null;
        }
        if (this.trail) {
            if (map && map.hasLayer(this.trail)) {
                map.removeLayer(this.trail);
            }
            this.trail = null;
        }
        this.markerEl = null;
        this.pathEl = null;
        this.iconSvg = null;
    }
};
