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
    STANDBY: 20,
    SLOW: 40,
    MEDIUM: 60,
    FAST: 80
};
const MOVING_AVERAGE_SIZE = 100;

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

    if (speedKph >= SPEED_THRESHOLDS.FAST) {
        elements.speedDisplay.classList.add('speed-very-fast');
    } else if (speedKph >= SPEED_THRESHOLDS.MEDIUM) {
        elements.speedDisplay.classList.add('speed-fast');
    } else if (speedKph >= SPEED_THRESHOLDS.SLOW) {
        elements.speedDisplay.classList.add('speed-medium');
    } else if (speedKph >= SPEED_THRESHOLDS.STANDBY) {
        elements.speedDisplay.classList.add('speed-slow');
    } else {
        elements.speedDisplay.classList.add('speed-standby');
    }
}

function updateSpeedDisplay(speedKph) {
    let displaySpeed;
    if (state.currentUnit === 'kph') {
        displaySpeed = speedKph;
    } else {
        displaySpeed = speedKph * 0.621371;
    }
    
    elements.speedDisplay.textContent = Math.round(displaySpeed);
    updateSpeedClass(speedKph);
    updateStats(speedKph);
}

function updateStats(speedKph) {
    if (speedKph > state.maxSpeed) {
        state.maxSpeed = speedKph;
    }

    state.movingAverageWindow.push(speedKph);
    if (state.movingAverageWindow.length > MOVING_AVERAGE_SIZE) {
        state.movingAverageWindow.shift();
    }
    const avgSpeed = state.movingAverageWindow.reduce((a, b) => a + b, 0) / state.movingAverageWindow.length;

    if (state.currentUnit === 'mph') {
        elements.maxSpeedDisplay.textContent = `${(state.maxSpeed * 0.621371).toFixed(1)} mph`;
        elements.avgSpeedDisplay.textContent = `${(avgSpeed * 0.621371).toFixed(1)} mph`;
    } else {
        elements.maxSpeedDisplay.textContent = `${state.maxSpeed.toFixed(1)} km/h`;
        elements.avgSpeedDisplay.textContent = `${avgSpeed.toFixed(1)} km/h`;
    }
}

function toggleUnit(unit) {
    if (unit === state.currentUnit) return;
    
    state.currentUnit = unit;
    document.querySelectorAll('.unit-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = document.querySelector(`[onclick="toggleUnit('${unit}')"]`);
    activeBtn.classList.add('active');
    
    if (state.speeds.length > 0) {
        const lastSpeed = state.speeds[state.speeds.length - 1];
        updateSpeedDisplay(lastSpeed);
    }
}

function handlePosition(position) {
    if (!position.coords.speed || position.coords.accuracy > ACCURACY_THRESHOLD) return;
    
    const rawSpeed = position.coords.speed * 3.6;
    const filteredSpeed = state.kalmanFilter.update(rawSpeed);
    
    state.speeds.push(filteredSpeed);
    updateSpeedDisplay(filteredSpeed);
    adjustUpdateRate(filteredSpeed);
}

function adjustUpdateRate(speedKph) {
    let newInterval = 1000;
    if (speedKph > 100) newInterval = 100;
    else if (speedKph > 40) newInterval = 200;
    else if (speedKph > 5) newInterval = 500;

    if (newInterval !== state.updateInterval) {
        state.updateInterval = newInterval;
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = navigator.geolocation.watchPosition(
            handlePosition,
            handlePositionError,
            { enableHighAccuracy: true, maximumAge: newInterval }
        );
    }
}

function handlePositionError(error) {
    let message = 'GPS Error: ';
    switch(error.code) {
        case error.PERMISSION_DENIED:
            message += 'Permission denied'; break;
        case error.POSITION_UNAVAILABLE:
            message += 'Position unavailable'; break;
        case error.TIMEOUT:
            message += 'Request timeout'; break;
        default:
            message += error.message;
    }
    elements.errorDisplay.textContent = message;
    stopTracking();
}

function toggleTracking() {
    state.isTracking ? stopTracking() : startTracking();
}

function startTracking() {
    state.isTracking = true;
    state.kalmanFilter = new KalmanFilter();
    state.speeds = [];
    state.maxSpeed = 0;
    state.movingAverageWindow = [];
    
    elements.button.textContent = 'Stop Tracking';
    elements.statusDisplay.textContent = 'Tracking...';
    elements.errorDisplay.textContent = '';

    state.watchId = navigator.geolocation.watchPosition(
        handlePosition,
        handlePositionError,
        { enableHighAccuracy: true, maximumAge: 1000 }
    );
}

function stopTracking() {
    state.isTracking = false;
    navigator.geolocation.clearWatch(state.watchId);
    elements.button.textContent = 'Start Tracking';
    elements.statusDisplay.textContent = 'Ready';
    updateSpeedDisplay(0); // Reset speed display to 0
}

window.addEventListener('load', () => {
    if ('geolocation' in navigator) {
        elements.button.disabled = false;
        elements.statusDisplay.textContent = 'Ready to track';
    } else {
        elements.statusDisplay.textContent = 'Geolocation not supported';
        elements.errorDisplay.textContent = 'This browser lacks geolocation support';
    }
});
