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
        this.pollHistory = [];
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
        if (this.pollIntervalId) {
            clearTimeout(this.pollIntervalId);
            this.pollIntervalId = null;
        }
        if (this.activePollController) {
            this.activePollController.abort();
            this.activePollController = null;
        }


        
        let controller = null;
        if (typeof AbortController !== 'undefined') {
            controller = new AbortController();
            this.activePollController = controller;
        }

        this.updateStatus("SCANNING...", true);

        const params = typeof getParams === 'function' ? getParams() : { lat: 0, lon: 0, rangeNm: 40 };
        const formattedLat = parseFloat(params.lat).toFixed(5);
        const formattedLon = parseFloat(params.lon).toFixed(5);
        const formattedRange = Math.round(params.rangeNm);

        const url = `https://api.airplanes.live/v2/point/${formattedLat}/${formattedLon}/${formattedRange}`;

        const fetchOptions = controller ? { signal: controller.signal } : {};

        const startTime = Date.now();
        // 6-second timeout to prevent requests from hanging indefinitely on network loss
        let timeoutId = null;
        if (controller && typeof setTimeout === 'function') {
            timeoutId = setTimeout(() => {
                if (this.activePollController === controller) {
                    console.warn("Flight data query timed out. Aborting request.");
                    controller.abort();
                }
            }, 6000);
        }

        if (typeof fetch === 'function') {
            fetch(url, fetchOptions)
                .then(response => {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (!response.ok) throw new Error("HTTP error " + response.status);
                    return response.json();
                })
                .then(data => {
                    if (!this.isPolling) return;
                    this.updateStatus("ONLINE", true);
                    const duration = Date.now() - startTime;
                    const activeCount = (data && data.ac) ? data.ac.length : 0;
                    this.addToHistory(url, "ONLINE", "Success", duration, activeCount);

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
                        let nextServerTick = Math.floor(serverNow / 10000) * 10000 + 10000 + 1500;
                        let targetLocalTime = nextServerTick - clockOffset;
                        
                        // Enforce a strict minimum 10-second delay between consecutive polls to prevent rate-limiting
                        if (targetLocalTime - localNow < 10000) {
                            nextServerTick += 10000;
                            targetLocalTime = nextServerTick - clockOffset;
                        }
                        delay = Math.max(10000, targetLocalTime - Date.now());
                    }

                    // Recursively schedule next poll
                    this.pollIntervalId = setTimeout(() => {
                        this.poll(getParams, onDataReceived);
                    }, delay);
                })
                .catch(error => {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (!this.isPolling) return;

                    // If aborted because a newer request was started, exit silently without scheduling anything
                    if (error.name === 'AbortError' && this.activePollController !== controller) {
                        return;
                    }


                    
                    console.error("Flight data poll failed:", error);
                    this.updateStatus("LINK ERROR", false);
                    const duration = Date.now() - startTime;

                    let errorMessage = error.message || String(error);
                    if (typeof window !== 'undefined') {
                        if (window.navigator && window.navigator.onLine === false) {
                            errorMessage = "Offline: Browser network connectivity disabled.";
                        } else if (error.name === 'AbortError' || errorMessage.includes('timeout')) {
                            errorMessage = "Timeout: API request exceeded the 6-second threshold.";
                        }
                    }

                    if (errorMessage === 'Failed to fetch' && typeof fetch === 'function') {
                        // Perform live CORS vs Network diagnostics
                        fetch(url, { mode: 'no-cors' })
                            .then(() => {
                                const diagnostics = "JS Error: TypeError: Failed to fetch. (Probe: Server is online, but browser blocked reading the response. Common when the server returns an error page like a 403 or 404).";
                                this.addToHistory(url, "LINK ERROR", diagnostics, duration, 0);
                                if (onDataReceived) onDataReceived(null, new Error(diagnostics));
                            })
                            .catch((diagErr) => {
                                const diagnostics = "JS Error: TypeError: Failed to fetch. (Probe failed: Server is offline, DNS failed, or host unreachable: " + String(diagErr) + ")";
                                this.addToHistory(url, "LINK ERROR", diagnostics, duration, 0);
                                if (onDataReceived) onDataReceived(null, new Error(diagnostics));
                            });
                    } else {
                        const rawDiagnostic = "JS Error: " + (error.name || "Error") + ": " + errorMessage;
                        this.addToHistory(url, "LINK ERROR", rawDiagnostic, duration, 0);
                        if (onDataReceived) {
                            onDataReceived(null, new Error(rawDiagnostic));
                        }
                    }

                    // Schedule fallback poll
                    this.pollIntervalId = setTimeout(() => {
                        this.poll(getParams, onDataReceived);
                    }, this.pollIntervalMs);
                });
        }
    }

    addToHistory(source, status, statusText, duration, activeCount) {
        const timestamp = new Date().toISOString();
        this.pollHistory.push({
            timestamp,
            source,
            status,
            statusText,
            duration,
            activeCount
        });
        if (this.pollHistory.length > 15) {
            this.pollHistory.shift();
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

if (typeof exports !== 'undefined') {
    exports.IngestionService = IngestionService;
}
