// Haversine formula to compute distance in Nautical Miles
function calcDistance(lat1, lon1, lat2, lon2) {
    const R = 3443.918; // Earth radius in NM (matching Leaflet's WGS84 radius of 6378137 meters)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Calculate bearing from home to target (0 is North, clockwise)
function calcBearing(lat, lon) {
    const hLat = typeof HOME_LAT !== 'undefined' ? HOME_LAT : 0;
    const hLon = typeof HOME_LON !== 'undefined' ? HOME_LON : 0;
    const scaleLon = Math.cos(hLat * Math.PI / 180);
    const dx = (lon - hLon) * scaleLon;
    const dy = lat - hLat;
    return (90 - Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
}

// Escape HTML tags to prevent XSS injection from API payload inputs
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"'/`]/g, function (s) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '/': '&#x2F;',
            '`': '&#x60;'
        }[s];
    });
}

// Sanitize hex IDs for valid HTML attribute syntax and clean selectors (e.g. converting "~" to "_")
function sanitizeId(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}

if (typeof exports !== 'undefined') {
    exports.calcDistance = calcDistance;
    exports.calcBearing = calcBearing;
    exports.escapeHtml = escapeHtml;
    exports.sanitizeId = sanitizeId;
}
