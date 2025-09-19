const state = {
    isTracking: false,
    watchId: null,
    updateInterval: 1000,
    speeds: [],
    maxSpeed: 0,
    movingAverageWindow: [],
    kalmanFilter: null,
    currentUnit: 'kph'
};

const ACCURACY_THRESHOLD = 20;
const SPEED_THRESHOLDS = { 
    STANDBY: 5,
    SLOW: 20,
    MEDIUM: 40,
    FAST: 60,
    VERY_FAST: 80
};
const MOVING_AVERAGE_DURATION = 60 * 1000; // 60 seconds
const MAX_WINDOW_SIZE = 1000; // Prevent memory issues

const elements = {
    speedDisplay: document.querySelector('.speed-display'),
    maxSpeedDisplay: document.querySelector('.max-speed'),
    avgSpeedDisplay: document.querySelector('.avg-speed'),
    statusDisplay: document.querySelector('.status'),
    errorDisplay: document.querySelector('.error'),
    button: document.querySelector('.button'),
};

class KalmanFilter {
    constructor(processNoise = 0.1, measurementNoise = 1) {
        this.Q = processNoise; // Process noise
        this.R = measurementNoise; // Measurement noise
        this.P = 1; // Error covariance
        this.x = null; // State estimate
    }

    update(measurement) {
        if (this.x === null) {
            this.x = measurement;
            return measurement;
        }

        // Prediction step
        const predictedP = this.P + this.Q;
        
        // Update step
        const K = predictedP / (predictedP + this.R);
        this.x += K * (measurement - this.x);
        this.P = (1 - K) * predictedP;

        return this.x;
    }
}

function updateSpeedClass(speedKph) {
    // Remove all speed classes
    elements.speedDisplay.classList.remove(
        'speed-standby', 'speed-slow', 'speed-medium', 'speed-fast', 'speed-very-fast'
    );

    // Add appropriate class based on speed
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
    // Update max speed
    if (speedKph > state.maxSpeed) {
        state.maxSpeed = speedKph;
    }

    // Update moving average window with timestamp filtering
    const now = Date.now();
    state.movingAverageWindow = state.movingAverageWindow.filter(
        entry => now - entry.timestamp < MOVING_AVERAGE_DURATION
    );
    
    // Limit window size to prevent memory issues
    if (state.movingAverageWindow.length > MAX_WINDOW_SIZE) {
        state.movingAverageWindow = state.movingAverageWindow.slice(-MAX_WINDOW_SIZE);
    }
    
    state.movingAverageWindow.push({ speed: speedKph, timestamp: now });
    
    // Calculate average with safety checks
    const total = state.movingAverageWindow.reduce((sum, entry) => sum + entry.speed, 0);
    const avgSpeed = state.movingAverageWindow.length > 0 
        ? total / state.movingAverageWindow.length 
        : 0;

    // Update displays with proper unit conversion
    const unitLabel = state.currentUnit === 'mph' ? 'mph' : 'km/h';
    elements.maxSpeedDisplay.textContent = `${formatSpeed(state.maxSpeed, state.currentUnit, 1)} ${unitLabel}`;
    elements.avgSpeedDisplay.textContent = `${formatSpeed(avgSpeed, state.currentUnit, 1)} ${unitLabel}`;
}

function toggleUnit(unit) {
    if (unit === state.currentUnit) return;
    
    state.currentUnit = unit;
    
    // Update UI buttons
    document.querySelectorAll('.unit-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = document.querySelector(`[onclick="toggleUnit('${unit}')"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    // Update display with current speed
    const currentSpeed = state.speeds.length > 0 ? state.speeds[state.speeds.length - 1] : 0;
    updateSpeedDisplay(currentSpeed);
}

function handlePosition(position) {
    // Check for valid GPS data
    if (position.coords.speed == null || position.coords.accuracy > ACCURACY_THRESHOLD) {
        return;
    }
    
    // Convert from m/s to km/h and ensure positive value
    const rawSpeed = Math.max(0, position.coords.speed * 3.6);
    
    // Apply Kalman filter for smoothing
    const filteredSpeed = state.kalmanFilter.update(rawSpeed);
    
    // Store speed and update display
    state.speeds.push(filteredSpeed);
    updateSpeedDisplay(filteredSpeed);
    
    // Adjust update rate based on current speed
    adjustUpdateRate(filteredSpeed);
}

function adjustUpdateRate(speedKph) {
    let newInterval = 1000; // Default 1 second
    
    // Faster updates for higher speeds
    if (speedKph > 100) {
        newInterval = 100; // 10 updates per second
    } else if (speedKph > 60) {
        newInterval = 200; // 5 updates per second
    } else if (speedKph > 20) {
        newInterval = 500; // 2 updates per second
    }

    // Only restart if interval changed significantly
    if (Math.abs(newInterval - state.updateInterval) > 50) {
        state.updateInterval = newInterval;
        
        // Restart geolocation with new settings
        if (state.watchId) {
            navigator.geolocation.clearWatch(state.watchId);
        }
        
        state.watchId = navigator.geolocation.watchPosition(
            handlePosition,
            handlePositionError,
            { 
                enableHighAccuracy: true, 
                maximumAge: newInterval,
                timeout: newInterval * 2
            }
        );
    }
}

function handlePositionError(error) {
    let message = 'GPS Error: ';
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            message += 'Location access denied. Please enable GPS permissions.';
            break;
        case error.POSITION_UNAVAILABLE:
            message += 'GPS signal unavailable. Try moving to an open area.';
            break;
        case error.TIMEOUT:
            message += 'GPS request timeout. Check your connection.';
            break;
        default:
            message += error.message || 'Unknown GPS error occurred.';
    }
    
    elements.errorDisplay.textContent = message;
    elements.statusDisplay.textContent = 'GPS Error';
    
    // Auto-retry after error (optional)
    setTimeout(() => {
        if (state.isTracking) {
            elements.errorDisplay.textContent = 'Retrying GPS connection...';
        }
    }, 3000);
}

function toggleTracking() {
    if (state.isTracking) {
        stopTracking();
    } else {
        startTracking();
    }
}

function startTracking() {
    // Check geolocation support
    if (!('geolocation' in navigator)) {
        elements.errorDisplay.textContent = 'Geolocation not supported by this browser';
        return;
    }

    state.isTracking = true;
    state.kalmanFilter = new KalmanFilter(0.1, 1); // Tuned for GPS speed data
    state.speeds = [];
    state.maxSpeed = 0;
    state.movingAverageWindow = [];
    
    // Update UI
    elements.button.textContent = 'Stop Tracking';
    elements.statusDisplay.textContent = 'Starting GPS...';
    elements.errorDisplay.textContent = '';

    // Start GPS tracking
    state.watchId = navigator.geolocation.watchPosition(
        handlePosition,
        handlePositionError,
        { 
            enableHighAccuracy: true, 
            maximumAge: 1000,
            timeout: 10000
        }
    );
    
    // Update status after a brief delay
    setTimeout(() => {
        if (state.isTracking) {
            elements.statusDisplay.textContent = 'Acquiring GPS signal...';
        }
    }, 1000);
}

function stopTracking() {
    state.isTracking = false;
    
    // Clear GPS watch
    if (state.watchId) {
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
    }
    
    // Update UI
    elements.button.textContent = 'Start Tracking';
    elements.statusDisplay.textContent = 'Ready';
    elements.errorDisplay.textContent = '';
    
    // Reset speed display but keep stats
    updateSpeedDisplay(0);
}

function resetStats() {
    state.maxSpeed = 0;
    state.movingAverageWindow = [];
    state.speeds = [];
    
    // Update displays
    const unitLabel = state.currentUnit === 'mph' ? 'mph' : 'km/h';
    elements.maxSpeedDisplay.textContent = `0.0 ${unitLabel}`;
    elements.avgSpeedDisplay.textContent = `0.0 ${unitLabel}`;
}

// Initialize when page loads
window.addEventListener('load', () => {
    if ('geolocation' in navigator) {
        elements.button.disabled = false;
        elements.statusDisplay.textContent = 'Ready to track';
        
        // Set initial unit button state
        const kphButton = document.querySelector(`[onclick="toggleUnit('kph')"]`);
        if (kphButton) {
            kphButton.classList.add('active');
        }
    } else {
        elements.statusDisplay.textContent = 'Geolocation not supported';
        elements.errorDisplay.textContent = 'This browser does not support GPS tracking';
        elements.button.disabled = true;
    }
});

// Handle page visibility changes (pause/resume tracking)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.isTracking) {
        // Optionally pause tracking when tab is hidden to save battery
        console.log('Page hidden - GPS tracking continues in background');
    } else if (!document.hidden && state.isTracking) {
        console.log('Page visible - GPS tracking active');
    }
});

// Export functions for global access
window.toggleTracking = toggleTracking;
window.toggleUnit = toggleUnit;
window.resetStats = resetStats;
