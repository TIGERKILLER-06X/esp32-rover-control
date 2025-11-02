// ESP32 Rover Control - Web Bluetooth App
// Fixed BLE Connection for ESP32

class RoverController {
    constructor() {
        // BLE Configuration (matches ESP32 code)
        this.SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
        this.CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
        
        // Connection state
        this.device = null;
        this.characteristic = null;
        this.isConnected = false;
        
        // Control state
        this.currentSpeed = 50;
        this.currentDirection = 'STOP';
        this.commandCount = 0;
        this.connectionStartTime = null;
        
        // Joystick state
        this.joystickActive = false;
        this.joystickCenter = { x: 0, y: 0 };
        this.maxRadius = 80;
        
        // Command debouncing
        this.lastCommand = '';
        this.lastCommandTime = 0;
        this.commandDelay = 100; // ms
        
        this.init();
    }

    init() {
        console.log('🚀 Initializing Rover Controller...');
        this.checkBluetoothSupport();
        this.setupEventListeners();
        this.setupJoystick();
        this.setupPWA();
        console.log('✅ Rover Controller Ready!');
    }

    checkBluetoothSupport() {
        if (!navigator.bluetooth) {
            alert('❌ Web Bluetooth is not supported in your browser!\n\nPlease use Chrome or Edge on Android.');
            console.error('Web Bluetooth not supported');
            document.getElementById('connectBtn').disabled = true;
            return false;
        }
        console.log('✅ Web Bluetooth supported');
        return true;
    }

    setupEventListeners() {
        // Connection buttons
        document.getElementById('connectBtn').addEventListener('click', () => this.connect());
        document.getElementById('disconnectBtn').addEventListener('click', () => this.disconnect());
        
        // Arrow buttons
        document.querySelectorAll('.arrow-btn').forEach(btn => {
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.sendCommand(btn.dataset.cmd);
                btn.style.transform = 'scale(0.95)';
            });
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                btn.style.transform = '';
            });
            btn.addEventListener('click', () => {
                this.sendCommand(btn.dataset.cmd);
            });
        });
        
        // Speed slider
        document.getElementById('speedSlider').addEventListener('input', (e) => {
            this.currentSpeed = parseInt(e.target.value);
            document.getElementById('speedValue').textContent = this.currentSpeed + '%';
            document.getElementById('currentSpeed').textContent = this.currentSpeed + '%';
            
            // Send speed to rover
            const speed = Math.round((this.currentSpeed / 100) * 255);
            this.sendCommand(`SPEED:${speed}`);
        });
        
        // Emergency stop
        document.getElementById('emergencyStop').addEventListener('click', () => {
            this.emergencyStop();
        });
    }

    setupJoystick() {
        const joystick = document.getElementById('joystick');
        const base = joystick.parentElement;
        
        // Calculate center
        const updateCenter = () => {
            const rect = base.getBoundingClientRect();
            this.joystickCenter = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            };
            this.maxRadius = (rect.width / 2) - 50;
        };
        
        updateCenter();
        window.addEventListener('resize', updateCenter);
        
        // Touch events
        joystick.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.joystickActive = true;
            updateCenter();
        });
        
        joystick.addEventListener('touchmove', (e) => {
            if (!this.joystickActive) return;
            e.preventDefault();
            
            const touch = e.touches[0];
            this.handleJoystickMove(touch.clientX, touch.clientY, joystick);
        });
        
        joystick.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.joystickActive = false;
            this.resetJoystick(joystick);
        });
        
        // Mouse events (for desktop testing)
        joystick.addEventListener('mousedown', (e) => {
            this.joystickActive = true;
            updateCenter();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!this.joystickActive) return;
            this.handleJoystickMove(e.clientX, e.clientY, joystick);
        });
        
        document.addEventListener('mouseup', () => {
            if (this.joystickActive) {
                this.joystickActive = false;
                this.resetJoystick(joystick);
            }
        });
    }

    handleJoystickMove(x, y, joystick) {
        const dx = x - this.joystickCenter.x;
        const dy = y - this.joystickCenter.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Limit to max radius
        let newX = dx;
        let newY = dy;
        
        if (distance > this.maxRadius) {
            const angle = Math.atan2(dy, dx);
            newX = Math.cos(angle) * this.maxRadius;
            newY = Math.sin(angle) * this.maxRadius;
        }
        
        // Update joystick position
        joystick.style.transform = `translate(calc(-50% + ${newX}px), calc(-50% + ${newY}px))`;
        
        // Determine direction
        const angle = Math.atan2(newY, newX) * (180 / Math.PI);
        const threshold = 30; // Minimum distance to register
        
        if (distance < threshold) {
            this.sendCommandThrottled('S');
        } else {
            if (angle >= -45 && angle < 45) {
                this.sendCommandThrottled('R'); // Right
            } else if (angle >= 45 && angle < 135) {
                this.sendCommandThrottled('B'); // Backward
            } else if (angle >= -135 && angle < -45) {
                this.sendCommandThrottled('F'); // Forward
            } else {
                this.sendCommandThrottled('L'); // Left
            }
        }
    }

    resetJoystick(joystick) {
        joystick.style.transform = 'translate(-50%, -50%)';
        this.sendCommand('S');
    }

    sendCommandThrottled(cmd) {
        const now = Date.now();
        if (cmd !== this.lastCommand || (now - this.lastCommandTime) > this.commandDelay) {
            this.sendCommand(cmd);
            this.lastCommand = cmd;
            this.lastCommandTime = now;
        }
    }

    async connect() {
        try {
            console.log('🔍 Scanning for ESP32-Rover...');
            document.getElementById('connectBtn').textContent = '🔍 Scanning...';
            
            // Request device
            this.device = await navigator.bluetooth.requestDevice({
                filters: [
                    { name: 'ESP32-Rover' },
                    { namePrefix: 'ESP32' }
                ],
                optionalServices: [this.SERVICE_UUID]
            });
            
            console.log('✅ Device found:', this.device.name);
            document.getElementById('connectBtn').textContent = '🔗 Connecting...';
            
            // Connect to GATT server
            const server = await this.device.gatt.connect();
            console.log('✅ GATT Server connected');
            
            // Get service
            const service = await server.getPrimaryService(this.SERVICE_UUID);
            console.log('✅ Service found');
            
            // Get characteristic
            this.characteristic = await service.getCharacteristic(this.CHARACTERISTIC_UUID);
            console.log('✅ Characteristic found');
            
            // Setup notifications
            await this.characteristic.startNotifications();
            this.characteristic.addEventListener('characteristicvaluechanged', (e) => {
                const value = new TextDecoder().decode(e.target.value);
                console.log('📨 Received:', value);
            });
            
            // Handle disconnection
            this.device.addEventListener('gattserverdisconnected', () => {
                console.log('❌ Device disconnected');
                this.onDisconnected();
            });
            
            this.isConnected = true;
            this.connectionStartTime = Date.now();
            this.onConnected();
            
            console.log('🎉 Successfully connected!');
            
        } catch (error) {
            console.error('❌ Connection failed:', error);
            alert('Connection failed!\n\n' + error.message + '\n\nMake sure:\n1. ESP32 is powered on\n2. BLE code is uploaded\n3. Bluetooth is enabled');
            document.getElementById('connectBtn').textContent = '🔗 Connect to Rover';
        }
    }

    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            await this.sendCommand('S'); // Stop motors first
            this.device.gatt.disconnect();
        }
        this.onDisconnected();
    }

    async sendCommand(cmd) {
        if (!this.isConnected || !this.characteristic) {
            console.warn('⚠️ Not connected');
            return;
        }
        
        try {
            const encoder = new TextEncoder();
            await this.characteristic.writeValue(encoder.encode(cmd));
            
            this.commandCount++;
            console.log(`📤 Sent: ${cmd} (${this.commandCount})`);
            
            // Update UI
            this.updateDirection(cmd);
            document.getElementById('commandCount').textContent = this.commandCount;
            
            // Haptic feedback
            if (navigator.vibrate) {
                navigator.vibrate(10);
            }
            
        } catch (error) {
            console.error('❌ Send failed:', error);
        }
    }

    emergencyStop() {
        this.sendCommand('S');
        if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
        }
    }

    updateDirection(cmd) {
        const dirMap = {
            'F': { text: 'Forward', emoji: '⬆️' },
            'B': { text: 'Backward', emoji: '⬇️' },
            'L': { text: 'Left', emoji: '⬅️' },
            'R': { text: 'Right', emoji: '➡️' },
            'S': { text: 'Stopped', emoji: '⏹️' }
        };
        
        const dir = dirMap[cmd] || dirMap['S'];
        document.getElementById('directionIndicator').textContent = dir.emoji;
        document.getElementById('currentDirection').textContent = dir.text;
        this.currentDirection = dir.text;
    }

    onConnected() {
        // Update UI
        document.getElementById('statusIndicator').classList.add('connected');
        document.getElementById('statusText').textContent = 'Connected';
        document.getElementById('connectBtn').classList.add('hidden');
        document.getElementById('disconnectBtn').classList.remove('hidden');
        document.getElementById('controlCard').classList.remove('hidden');
        document.getElementById('statusCard').classList.remove('hidden');
        
        // Enable controls
        document.querySelectorAll('.arrow-btn').forEach(btn => btn.disabled = false);
        
        // Start connection timer
        this.startConnectionTimer();
    }

    onDisconnected() {
        this.isConnected = false;
        this.characteristic = null;
        this.device = null;
        
        // Update UI
        document.getElementById('statusIndicator').classList.remove('connected');
        document.getElementById('statusText').textContent = 'Disconnected';
        document.getElementById('connectBtn').classList.remove('hidden');
        document.getElementById('connectBtn').textContent = '🔗 Connect to Rover';
        document.getElementById('disconnectBtn').classList.add('hidden');
        document.getElementById('controlCard').classList.add('hidden');
        document.getElementById('statusCard').classList.add('hidden');
        
        // Disable controls
        document.querySelectorAll('.arrow-btn').forEach(btn => btn.disabled = true);
        
        // Reset state
        this.updateDirection('S');
        this.commandCount = 0;
    }

    startConnectionTimer() {
        setInterval(() => {
            if (this.isConnected && this.connectionStartTime) {
                const elapsed = Math.floor((Date.now() - this.connectionStartTime) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                document.getElementById('connectionTime').textContent = 
                    `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    setupPWA() {
        // Install prompt
        let deferredPrompt;
        
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            document.getElementById('installPrompt').classList.add('show');
        });
        
        document.getElementById('installBtn').addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                console.log('Install outcome:', outcome);
                deferredPrompt = null;
                document.getElementById('installPrompt').classList.remove('show');
            }
        });
        
        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('service-worker.js')
                .then(reg => console.log('✅ Service Worker registered'))
                .catch(err => console.log('❌ Service Worker failed:', err));
        }
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.roverController = new RoverController();
});
