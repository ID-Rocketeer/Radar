/**
 * IngestionService: Coordinates API polling loops, AbortControllers,
 * and system connection status indicator states in the UI.
 */
var IngestionService = class IngestionService {
    constructor(options = {}) {
        this.pollIntervalMs = options.pollIntervalMs || 10000;
        this.pollIntervalId = null;
        this.activePollController = null;
        this.isPolling = false;

        this.statusTextEl = null;
        this.statusIndicatorEl = null;
    }

    init() {
        if (typeof document !== 'undefined') {
            this.statusTextEl = document.querySelector('.system-status .status-text');
            this.statusIndicatorEl = document.querySelector('.status-indicator');
        }
    }

    start(getParams, onDataReceived) {
        this.init();
        if (this.isPolling) return;
        this.isPolling = true;

        this.poll(getParams, onDataReceived);
    }

    stop() {
        this.isPolling = false;
        if (this.pollIntervalId) {
            clearTimeout(this.pollIntervalId);
            this.pollIntervalId = null;
        }
        if (this.activePollController) {
            this.activePollController.abort();
            this.activePollController = null;
        }
        this.updateStatus("STANDBY", false);
    }

    poll(getParams, onDataReceived) {
        if (this.activePollController) {
            this.activePollController.abort();
        }
        
        if (typeof AbortController !== 'undefined') {
            this.activePollController = new AbortController();
        }

        this.updateStatus("SCANNING...", true);

        const params = typeof getParams === 'function' ? getParams() : { lat: 0, lon: 0, rangeNm: 40 };
        const url = `https://api.airplanes.live/v2/point/${params.lat}/${params.lon}/${params.rangeNm}`;

        const fetchOptions = this.activePollController ? { signal: this.activePollController.signal } : {};

        if (typeof fetch === 'function') {
            fetch(url, fetchOptions)
                .then(response => {
                    if (!response.ok) throw new Error("HTTP error " + response.status);
                    return response.json();
                })
                .then(data => {
                    if (!this.isPolling) return;
                    this.updateStatus("ONLINE", true);
                    if (onDataReceived) {
                        onDataReceived(data);
                    }

                    // Calculate delay to hit 1.5 seconds after the next 10s server boundary (handle both seconds and milliseconds)
                    let serverNow = data.now;
                    const localNow = Date.now();
                    let delay = this.pollIntervalMs;
                    if (typeof serverNow === 'number' && !isNaN(serverNow)) {
                        if (serverNow < 10000000000) {
                            serverNow *= 1000; // Convert seconds from airplanes.live API to milliseconds
                        }
                        const clockOffset = serverNow - localNow;
                        const nextServerTick = Math.ceil(serverNow / 10000) * 10000 + 1500;
                        const targetLocalTime = nextServerTick - clockOffset;
                        delay = Math.max(1000, targetLocalTime - Date.now());
                    }

                    // Recursively schedule next poll
                    this.pollIntervalId = setTimeout(() => {
                        this.poll(getParams, onDataReceived);
                    }, delay);
                })
                .catch(error => {
                    if (error.name === 'AbortError') return;
                    if (!this.isPolling) return;
                    console.error("Flight data poll failed:", error);
                    this.updateStatus("LINK ERROR", false);
                    
                    if (onDataReceived) {
                        onDataReceived(null, error);
                    }

                    // Schedule fallback poll
                    this.pollIntervalId = setTimeout(() => {
                        this.poll(getParams, onDataReceived);
                    }, this.pollIntervalMs);
                });
        }
    }

    updateStatus(text, isActive) {
        if (this.statusTextEl) {
            this.statusTextEl.innerText = `SYS_STATUS: ${text}`;
        }
        if (this.statusIndicatorEl) {
            if (isActive) {
                this.statusIndicatorEl.classList.add('active');
            } else {
                this.statusIndicatorEl.classList.remove('active');
            }
        }
    }
};
