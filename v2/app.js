const state = {
    isTracking: false,
    watchId: null,
    updateInterval: 1000,
    speeds: [],
    maxSpeed: 0,
    movingAverageWindow: [],
    kalmanFilter: null,
    currentUnit: 'kph',
    debugMode: true // Enable debug logging
};

const ACCURACY_THRESHOLD = 50; // Increased from 20 - try more lenient threshold
const SPEED_THRESHOLDS = { 
    STANDBY: 5,
    SLOW: 20,
    MEDIUM: 40,
    FAST: 60,
    VERY_FAST: 80
};
const MOVING_AVERAGE_DURATION = 60 * 1000;
const MAX_WINDOW_SIZE = 1000;

const elements = {
    speedDisplay: document.querySelector('.speed-display'),
    maxSpeedDisplay: document.querySelector('.max-speed'),
    avgSpeedDisplay: document.querySelector('.avg-speed'),
    statusDisplay: document.querySelector('.status'),
    errorDisplay: document.querySelector('.error'),
    button: document.querySelector('.button.primary'),
};

// Debug logging function
function debugLog(message, data = null) {
    if (state.debugMode) {
        console.log(`[GPS Debug] ${message}`, data || '');
    }
}

class KalmanFilter {
    constructor(processNoise = 0.1, measurementNoise = 1) {
        this.Q = processNoise;
        this.R = measurementNoise;
        this.P = 1;
        this.x = null;
    }

    update(measurement) {
        if (this.x === null) {
            this.x = measurement;
            return measurement;
        }

        const predictedP = this.P + this.Q;
        const K = predictedP / (predictedP + this.R);
        this.x += K * (measurement - this.x);
        this.P = (1 - K) * predictedP;

        return this.x;
    }
}

function updateSpeedClass(speedKph) {
    elements.speedDisplay.classList.remove(
        'speed-standby', 'speed-slow', 'speed-medium', 'speed-fast', 'speed-very-fast'
    );

    if (speedKph >= SPEED_THRESHOLDS.VERY_FAST) {
        elements.speedDisplay.classList.add('speed-very-fast');
    } else if (speedKph >= SPEED_THRESHOLDS.FAST) {
        elements.speedDisplay.classList.add('speed-fast');
    } else if (speedKph >= SPEED_THRESHOLDS.MEDIUM) {
        elements.speedDisplay.classList.add('speed-medium');
    } else if (speedKph >= SPEED_THRESHOLDS.SLOW) {
        elements.speedDisplay.classList.add('speed-slow');
    } else {
        elements.speedDisplay.classList.add('speed-standby');
    }
}

function convertSpeed(speedKph, unit) {
    if (unit === 'mph') {
        return speedKph * 0.621371;
    }
    return speedKph;
}

function formatSpeed(speed, unit, decimals = 0) {
    const convertedSpeed = convertSpeed(speed, unit);
    return decimals > 0 ? convertedSpeed.toFixed(decimals) : Math.round(convertedSpeed);
}

function updateSpeedDisplay(speedKph) {
    const displaySpeed = formatSpeed(speedKph, state.currentUnit);
    elements.speedDisplay.textContent = displaySpeed;
    updateSpeedClass(speedKph);
    updateStats(speedKph);
}

function updateStats(speedKph) {
    if (speedKph > state.maxSpeed) {
        state.maxSpeed = speedKph;
    }

    const now = Date.now();
    state.movingAverageWindow = state.movingAverageWindow.filter(
        entry => now - entry.timestamp < MOVING_AVERAGE_DURATION
    );
    
    if (state.movingAverageWindow.length > MAX_WINDOW_SIZE) {
        state.movingAverageWindow = state.movingAverageWindow.slice(-MAX_WINDOW_SIZE);
    }
    
    state.movingAverageWindow.push({ speed: speedKph, timestamp: now });
    
    const total = state.movingAverageWindow.reduce((sum, entry) => sum + entry.speed, 0);
    const avgSpeed = state.movingAverageWindow.length > 0 
        ? total / state.movingAverageWindow.length 
        : 0;

    const unitLabel = state.currentUnit === 'mph' ? 'mph' : 'km/h';
    elements.maxSpeedDisplay.textContent = `${formatSpeed(state.maxSpeed, state.currentUnit, 1)} ${unitLabel}`;
    elements.avgSpeedDisplay.textContent = `${formatSpeed(avgSpeed, state.currentUnit, 1)} ${unitLabel}`;
}

function toggleUnit(unit) {
    if (unit === state.currentUnit) return;
    
    state.currentUnit = unit;
    
    document.querySelectorAll('.unit-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = document.querySelector(`[onclick="toggleUnit('${unit}')"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    const currentSpeed = state.speeds.length > 0 ? state.speeds[state.speeds.length - 1] : 0;
    updateSpeedDisplay(currentSpeed);
}

function handlePosition(position) {
    debugLog('GPS Position received:', {
        speed: position.coords.speed,
        accuracy: position.coords.accuracy,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: new Date(position.timestamp).toLocaleTimeString()
    });

    // More lenient checking - accept more GPS data
    if (position.coords.speed === null || position.coords.speed === undefined) {
        debugLog('Speed is null/undefined, skipping');
        return;
    }
    
    if (position.coords.accuracy > ACCURACY_THRESHOLD) {
        debugLog(`Accuracy too low: ${position.coords.accuracy}m (threshold: ${ACCURACY_THRESHOLD}m)`);
        // Don't return, just log - let's see if we get any good data
    }
    
    const rawSpeed = Math.max(0, position.coords.speed * 3.6);
    debugLog('Raw speed (km/h):', rawSpeed);
    
    const filteredSpeed = state.kalmanFilter.update(rawSpeed);
    debugLog('Filtered speed (km/h):', filteredSpeed);
    
    state.speeds.push(filteredSpeed);
    updateSpeedDisplay(filteredSpeed);
    
    // Update status to show we're getting data
    elements.statusDisplay.textContent = `Tracking (Accuracy: ${Math.round(position.coords.accuracy)}m)`;
    elements.errorDisplay.textContent = ''; // Clear any errors
    
    adjustUpdateRate(filteredSpeed);
}

function adjustUpdateRate(speedKph) {
    let newInterval = 1000;
    
    if (speedKph > 100) {
        newInterval = 100;
    } else if (speedKph > 60) {
        newInterval = 200;
    } else if (speedKph > 20) {
        newInterval = 500;
    }

    if (Math.abs(newInterval - state.updateInterval) > 50) {
        state.updateInterval = newInterval;
        debugLog(`Updating GPS interval to ${newInterval}ms`);
        
        if (state.watchId) {
            navigator.geolocation.clearWatch(state.watchId);
        }
        
        state.watchId = navigator.geolocation.watchPosition(
            handlePosition,
            handlePositionError,
            { 
                enableHighAccuracy: true, 
                maximumAge: 5000, // Increased from newInterval
                timeout: 15000 // Increased timeout
            }
        );
    }
}

function handlePositionError(error) {
    debugLog('GPS Error occurred:', {
        code: error.code,
        message: error.message,
        timestamp: new Date().toLocaleTimeString()
    });

    let message = 'GPS Error: ';
    let shouldRetry = true;
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            message += 'Location access denied. Please enable GPS permissions in your browser settings.';
            shouldRetry = false; // Don't retry permission errors
            break;
        case error.POSITION_UNAVAILABLE:
            message += 'GPS signal unavailable. Try moving to an open area or near a window.';
            break;
        case error.TIMEOUT:
            message += 'GPS request timeout. Trying again with relaxed settings...';
            break;
        default:
            message += error.message || 'Unknown GPS error occurred.';
    }
    
    elements.errorDisplay.textContent = message;
    elements.statusDisplay.textContent = 'GPS Error';
    
    // Only retry if it makes sense and we're still tracking
    if (shouldRetry && state.isTracking) {
        debugLog('Will retry GPS in 5 seconds');
        setTimeout(() => {
            if (state.isTracking) {
                debugLog('Retrying GPS with relaxed settings...');
                elements.errorDisplay.textContent = 'Retrying GPS connection...';
                
                // Restart with more lenient settings
                if (state.watchId) {
                    navigator.geolocation.clearWatch(state.watchId);
                }
                
                state.watchId = navigator.geolocation.watchPosition(
                    handlePosition,
                    handlePositionError,
                    { 
                        enableHighAccuracy: false, // Try less accurate but more available GPS
                        maximumAge: 10000, // Accept older positions
                        timeout: 20000 // Even longer timeout
                    }
                );
            }
        }, 5000);
    }
}

function toggleTracking() {
    if (state.isTracking) {
        stopTracking();
    } else {
        startTracking();
    }
}

function startTracking() {
    debugLog('Starting GPS tracking...');
    
    if (!('geolocation' in navigator)) {
        elements.errorDisplay.textContent = 'Geolocation not supported by this browser';
        return;
    }

    // Check if we're in a secure context (HTTPS or localhost)
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        elements.errorDisplay.textContent = 'GPS requires HTTPS or localhost for security';
        debugLog('Insecure context - GPS may not work properly');
    }

    state.isTracking = true;
    state.kalmanFilter = new KalmanFilter(0.1, 1);
    state.speeds = [];
    state.maxSpeed = 0;
    state.movingAverageWindow = [];
    
    elements.button.textContent = 'Stop Tracking';
    elements.statusDisplay.textContent = 'Starting GPS...';
    elements.errorDisplay.textContent = '';

    debugLog('Starting GPS watch with initial settings...');
    
    state.watchId = navigator.geolocation.watchPosition(
        handlePosition,
        handlePositionError,
        { 
            enableHighAccuracy: true, 
            maximumAge: 5000,
            timeout: 15000
        }
    );
    
    setTimeout(() => {
        if (state.isTracking && elements.statusDisplay.textContent === 'Starting GPS...') {
            elements.statusDisplay.textContent = 'Waiting for GPS signal...';
            debugLog('Still waiting for first GPS fix...');
        }
    }, 3000);
}

function stopTracking() {
    debugLog('Stopping GPS tracking...');
    state.isTracking = false;
    
    if (state.watchId) {
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
    }
    
    elements.button.textContent = 'Start Tracking';
    elements.statusDisplay.textContent = 'Ready';
    elements.errorDisplay.textContent = '';
    
    updateSpeedDisplay(0);
}

function resetStats() {
    debugLog('Resetting statistics...');
    state.maxSpeed = 0;
    state.movingAverageWindow = [];
    state.speeds = [];
    
    const unitLabel = state.currentUnit === 'mph' ? 'mph' : 'km/h';
    elements.maxSpeedDisplay.textContent = `0.0 ${unitLabel}`;
    elements.avgSpeedDisplay.textContent = `0.0 ${unitLabel}`;
}

// Initialize when page loads
window.addEventListener('load', () => {
    debugLog('Page loaded, initializing...');
    
    if ('geolocation' in navigator) {
        elements.button.disabled = false;
        elements.statusDisplay.textContent = 'Ready to track';
        
        const kphButton = document.querySelector(`[onclick="toggleUnit('kph')"]`);
        if (kphButton) {
            kphButton.classList.add('active');
        }
        
        debugLog('Geolocation is supported');
    } else {
        elements.statusDisplay.textContent = 'Geolocation not supported';
        elements.errorDisplay.textContent = 'This browser does not support GPS tracking';
        elements.button.disabled = true;
        debugLog('Geolocation is NOT supported');
    }
});

// Export functions for global access
window.toggleTracking = toggleTracking;
window.toggleUnit = toggleUnit;
window.resetStats = resetStats;
