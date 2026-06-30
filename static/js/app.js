// WildShield Client Application Controller

document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    let selectedFile = null;
    let isMuted = false;
    let activeFeedTab = 'upload'; // 'upload' or 'simulate'
    let currentThreatLevel = 'SAFE'; // 'SAFE', 'WARNING', 'CRITICAL'
    let alertCount = 0;
    let animalCrossing = false;
    let manualSirenActive = false;
    let lastDetectedAnimal = '';
    
    // Audio Context state
    let audioCtx = null;
    let alarmOscillator = null;
    let alarmLfo = null;
    let alarmGain = null;
    let isAlarmPlaying = false;
    
    // CCTV Simulator State
    let simulatorInterval = null;
    let noiseFrames = [];
    let simAnimals = [];
    let simAnimalIdCounter = 0;
    let previousSimThreatState = 'ALL_SAFE';
    let lastSimCrossingRisk = null;
    let simAlertLogged = false;
    let camContexts = {};
    let camScanLines = { north: 0, east: 0, south: 0, west: 0 };
    let activeCameraSector = null;

    const SIM_CAM = { w: 320, h: 240 };
    const SAFE_ZONE = { x: 55, y: 40, w: 210, h: 160 };
    const ANIMAL_RISKS = { tiger: 'CRITICAL', elephant: 'WARNING', cattle: 'SAFE', monkey: 'SAFE', deer: 'SAFE', rhinoceros: 'WARNING', wolf: 'CRITICAL' };

    const CAMERA_CONFIG = [
        { sector: 'north', id: 'CAM_02', name: 'CAM_02_NORTH_FOREST', canvasId: 'camCanvasNorth', feedId: 'cameraFeedNorth', statusId: 'camStatusNorth' },
        { sector: 'east', id: 'CAM_03', name: 'CAM_03_EAST_RIVER', canvasId: 'camCanvasEast', feedId: 'cameraFeedEast', statusId: 'camStatusEast' },
        { sector: 'west', id: 'CAM_01', name: 'CAM_01_WEST_PERIMETER', canvasId: 'camCanvasWest', feedId: 'cameraFeedWest', statusId: 'camStatusWest' },
        { sector: 'south', id: 'CAM_04', name: 'CAM_04_SOUTH_BUFFER', canvasId: 'camCanvasSouth', feedId: 'cameraFeedSouth', statusId: 'camStatusSouth' },
    ];

    const SECTOR_TO_CAMERA = Object.fromEntries(CAMERA_CONFIG.map(c => [c.sector, c]));

    function isAnimalInSafeZone(animal) {
        const cx = animal.x + animal.w / 2;
        const cy = animal.y + animal.h / 2;
        return cx >= SAFE_ZONE.x && cx <= SAFE_ZONE.x + SAFE_ZONE.w &&
               cy >= SAFE_ZONE.y && cy <= SAFE_ZONE.y + SAFE_ZONE.h;
    }

    function isAnimalCrossingBorder(animal) {
        return !isAnimalInSafeZone(animal);
    }

    function spawnSimAnimal(type, options = {}) {
        const risk = options.risk || ANIMAL_RISKS[type] || 'WARNING';
        const sector = options.sector || 'west';
        const w = options.w || (type === 'elephant' ? 58 : type === 'cattle' ? 42 : 48);
        const h = options.h || w * 0.75;
        let x, y, vx, vy;

        if (options.spawnInside) {
            x = SAFE_ZONE.x + 20 + Math.random() * (SAFE_ZONE.w - w - 40);
            y = SAFE_ZONE.y + 20 + Math.random() * (SAFE_ZONE.h - h - 40);
            vx = (Math.random() - 0.5) * 1.0;
            vy = (Math.random() - 0.5) * 1.0;
        } else {
            const edge = options.spawnOutside || ['left', 'right', 'top', 'bottom'][Math.floor(Math.random() * 4)];
            if (edge === 'left') {
                x = -w - 10; y = 60 + Math.random() * 120; vx = 1.0 + Math.random() * 0.6; vy = (Math.random() - 0.5) * 0.5;
            } else if (edge === 'right') {
                x = SIM_CAM.w + 10; y = 60 + Math.random() * 120; vx = -(1.0 + Math.random() * 0.6); vy = (Math.random() - 0.5) * 0.5;
            } else if (edge === 'top') {
                x = 75 + Math.random() * 170; y = -h - 10; vx = (Math.random() - 0.5) * 0.5; vy = 0.8 + Math.random() * 0.5;
            } else {
                x = 75 + Math.random() * 170; y = SIM_CAM.h + 10; vx = (Math.random() - 0.5) * 0.5; vy = -(0.8 + Math.random() * 0.5);
            }
        }

        simAnimals.push({
            id: ++simAnimalIdCounter,
            sector, type, risk, x, y, w, h, vx, vy
        });
    }

    function drawPerimeterBorder(ctx) {
        ctx.strokeStyle = 'rgba(255, 170, 0, 0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(SAFE_ZONE.x, SAFE_ZONE.y, SAFE_ZONE.w, SAFE_ZONE.h);
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(16, 185, 129, 0.06)';
        ctx.fillRect(SAFE_ZONE.x, SAFE_ZONE.y, SAFE_ZONE.w, SAFE_ZONE.h);

        ctx.fillStyle = 'rgba(16, 185, 129, 0.85)';
        ctx.font = 'bold 10px Orbitron';
        ctx.fillText('SAFE ZONE', SAFE_ZONE.x + 8, SAFE_ZONE.y + 16);

        ctx.strokeStyle = 'rgba(255, 0, 60, 0.35)';
        ctx.lineWidth = 3;
        ctx.strokeRect(4, 4, SIM_CAM.w - 8, SIM_CAM.h - 8);
    }

    function drawSimAnimal(ctx, animal, compact = true) {
        const crossing = isAnimalCrossingBorder(animal);
        const risk = animal.risk;
        const strokeColor = crossing
            ? (risk === 'CRITICAL' ? '#ff2a5f' : risk === 'WARNING' ? '#ffb300' : '#ff8c00')
            : '#10b981';
        const fillColor = crossing
            ? (risk === 'CRITICAL' ? 'rgba(255, 42, 95, 0.18)' : risk === 'WARNING' ? 'rgba(255, 179, 0, 0.15)' : 'rgba(255, 140, 0, 0.12)')
            : 'rgba(16, 185, 129, 0.12)';
        const bodyColor = crossing
            ? (risk === 'CRITICAL' ? 'rgba(255, 100, 120, 0.75)' : risk === 'WARNING' ? 'rgba(255, 200, 100, 0.7)' : 'rgba(255, 180, 80, 0.65)')
            : 'rgba(100, 245, 180, 0.65)';

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = crossing ? 3 : 2;
        ctx.strokeRect(animal.x, animal.y, animal.w, animal.h);
        ctx.fillStyle = fillColor;
        ctx.fillRect(animal.x, animal.y, animal.w, animal.h);

        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(animal.x + animal.w / 2, animal.y + animal.h / 2, animal.w / 3, animal.h / 3.2, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(animal.x + animal.w * 0.78, animal.y + animal.h * 0.32, animal.w / 9, 0, 2 * Math.PI);
        ctx.fill();

        if (animal.type === 'elephant') {
            ctx.beginPath();
            ctx.ellipse(animal.x + animal.w * 0.82, animal.y + animal.h * 0.55, animal.w / 10, animal.h / 5, 0.3, 0, 2 * Math.PI);
            ctx.fill();
        }

        ctx.fillStyle = '#fff';
        ctx.font = compact ? 'bold 9px Orbitron' : 'bold 11px Orbitron';
        const statusTag = crossing ? 'CROSSING' : 'IN RANGE';
        ctx.fillText(`${animal.type.toUpperCase()} [${statusTag}]`, animal.x, Math.max(10, animal.y - 4));
    }

    function updateSimAnimalPositions() {
        simAnimals.forEach(animal => {
            animal.x += animal.vx;
            animal.y += animal.vy;

            if (animal.x < 0 || animal.x + animal.w > SIM_CAM.w) {
                animal.vx *= -1;
                animal.x = Math.max(0, Math.min(animal.x, SIM_CAM.w - animal.w));
            }
            if (animal.y < 0 || animal.y + animal.h > SIM_CAM.h) {
                animal.vy *= -1;
                animal.y = Math.max(0, Math.min(animal.y, SIM_CAM.h - animal.h));
            }

            if (isAnimalInSafeZone(animal) && animal.risk === 'SAFE') {
                const cx = animal.x + animal.w / 2;
                const cy = animal.y + animal.h / 2;
                const margin = 18;
                if (cx < SAFE_ZONE.x + margin) animal.vx = Math.abs(animal.vx);
                if (cx > SAFE_ZONE.x + SAFE_ZONE.w - margin) animal.vx = -Math.abs(animal.vx);
                if (cy < SAFE_ZONE.y + margin) animal.vy = Math.abs(animal.vy);
                if (cy > SAFE_ZONE.y + SAFE_ZONE.h - margin) animal.vy = -Math.abs(animal.vy);
            }
        });
    }

    function renderCameraFrame(ctx, sector, scanY, frameIndex) {
        ctx.fillStyle = '#010f08';
        ctx.fillRect(0, 0, SIM_CAM.w, SIM_CAM.h);

        ctx.strokeStyle = 'rgba(0, 245, 255, 0.04)';
        ctx.lineWidth = 1;
        for (let y = 0; y < SIM_CAM.h; y += 12) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(SIM_CAM.w, y);
            ctx.stroke();
        }

        drawPerimeterBorder(ctx);

        if (noiseFrames.length) {
            const currentNoise = noiseFrames[frameIndex % noiseFrames.length];
            ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
            for (let n = 0; n < currentNoise.length; n++) {
                ctx.fillRect(currentNoise[n] * SIM_CAM.w, currentNoise[(n + 1) % currentNoise.length] * SIM_CAM.h, 2, 2);
            }
        }

        simAnimals.filter(a => a.sector === sector).forEach(animal => drawSimAnimal(ctx, animal));

        ctx.strokeStyle = 'rgba(0, 245, 255, 0.15)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, scanY);
        ctx.lineTo(SIM_CAM.w, scanY);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(SIM_CAM.w / 2, SIM_CAM.h / 2, 35, 0, 2 * Math.PI);
        ctx.moveTo(SIM_CAM.w / 2, SIM_CAM.h / 2 - 35);
        ctx.lineTo(SIM_CAM.w / 2, SIM_CAM.h / 2 + 35);
        ctx.moveTo(SIM_CAM.w / 2 - 35, SIM_CAM.h / 2);
        ctx.lineTo(SIM_CAM.w / 2 + 35, SIM_CAM.h / 2);
        ctx.stroke();
    }

    function setCameraFeedAlert(sector, risk) {
        const cam = SECTOR_TO_CAMERA[sector];
        if (!cam) return;
        const feedEl = document.getElementById(cam.feedId);
        const statusEl = document.getElementById(cam.statusId);
        if (feedEl) {
            feedEl.classList.toggle('alert-feed', risk === 'CRITICAL' || risk === 'WARNING');
        }
        if (statusEl) {
            if (risk === 'CRITICAL' || risk === 'WARNING') {
                statusEl.className = 'cam-status-badge alert';
                statusEl.innerHTML = '<i class="ti ti-alert-triangle"></i> ALERT';
            } else {
                statusEl.className = 'cam-status-badge connected';
                statusEl.innerHTML = '<i class="ti ti-wifi"></i> LIVE';
            }
        }
    }

    function resetAllCameraFeedAlerts() {
        CAMERA_CONFIG.forEach(cam => setCameraFeedAlert(cam.sector, 'SAFE'));
    }

    function highlightCameraFeed(sector) {
        activeCameraSector = sector;
        CAMERA_CONFIG.forEach(cam => {
            const feedEl = document.getElementById(cam.feedId);
            const cardEl = document.getElementById(`sectorCard${cam.sector.charAt(0).toUpperCase() + cam.sector.slice(1)}`);
            if (feedEl) feedEl.classList.toggle('active-feed', cam.sector === sector);
            if (cardEl) {
                cardEl.classList.add('camera-linked');
                cardEl.classList.toggle('active-feed-link', cam.sector === sector);
            }
        });
    }

    function connectAllCameras() {
        fetch('/api/cameras')
            .then(res => res.json())
            .then(data => {
                const badge = document.getElementById('camerasConnectedBadge');
                if (badge) {
                    badge.innerHTML = `<i class="ti ti-wifi"></i> ${data.connected_count}/${data.total_count} CAMERAS CONNECTED`;
                }
                data.cameras.forEach(cam => {
                    updateSectorStatus(cam.sector, 'SAFE');
                    setCameraFeedAlert(cam.sector, 'SAFE');
                });
            })
            .catch(() => {
                CAMERA_CONFIG.forEach(cam => updateSectorStatus(cam.sector, 'SAFE'));
            });
    }

    function getCrossingAlertRisk(animal) {
        if (animal.risk === 'CRITICAL') return 'CRITICAL';
        return 'WARNING';
    }

    function evaluateSimThreatLevel() {
        const crossing = simAnimals.filter(isAnimalCrossingBorder);
        if (crossing.length === 0) {
            return { state: 'ALL_SAFE', crossing: [], inRange: [...simAnimals] };
        }
        const riskRank = { CRITICAL: 3, WARNING: 2, SAFE: 1 };
        const worst = crossing.reduce((a, b) => {
            const aScore = riskRank[getCrossingAlertRisk(a)] || 0;
            const bScore = riskRank[getCrossingAlertRisk(b)] || 0;
            return aScore >= bScore ? a : b;
        });
        return {
            state: 'CROSSING',
            crossing,
            worst,
            risk: getCrossingAlertRisk(worst),
            animal: worst.type,
            sector: worst.sector
        };
    }

    function getSectorForAnimal(animal) {
        return animal.sector || getSectorForAnimalType(animal.type);
    }

    function getSectorForAnimalType(type) {
        if (type === 'tiger') return 'north';
        if (type === 'elephant') return 'east';
        if (type === 'monkey') return 'south';
        return 'west';
    }

    function updateSimZoneStatusLabel(text, className = '') {
        const el = document.getElementById('simZoneStatus');
        if (!el) return;
        el.textContent = text;
        el.className = 'legend-status' + (className ? ' ' + className : '');
    }

    function handleSimThreatEvaluation(result) {
        if (result.state === 'ALL_SAFE') {
            updateSimZoneStatusLabel(
                simAnimals.length ? `All ${simAnimals.length} animal(s) in safe range` : 'All clear',
                ''
            );
            if (previousSimThreatState !== 'ALL_SAFE') {
                resetAllSectors();
                if (simAnimals.length > 0) {
                    const names = simAnimals.map(a => a.type).join(', ');
                    lastDetectedAnimal = names;
                    updateCrossingStatus(true, 'SAFE', names);
                    triggerIntrusionAlert(
                        '🛡️ ALL ANIMALS IN SAFE RANGE',
                        `All ${simAnimals.length} detected animal(s) (${names.toUpperCase()}) are within the secure perimeter. Safe siren active.`,
                        'SAFE'
                    );
                    simAnimals.forEach(a => updateSectorStatus(getSectorForAnimal(a), 'SAFE', a.type));
                    setActiveSirenButton(btnSirenSafe);
                } else {
                    updateCrossingStatus(false);
                    dismissAlert();
                }
                resetAllCameraFeedAlerts();
                lastSimCrossingRisk = null;
                simAlertLogged = false;
            }
            previousSimThreatState = 'ALL_SAFE';
            return;
        }

        const { risk, animal, crossing, sector: breachSector } = result;
        const sector = breachSector || getSectorForAnimalType(animal);
        const riskLabel = risk === 'CRITICAL' ? 'CRITICAL BREACH' : risk === 'WARNING' ? 'WARNING ALERT' : 'BORDER CROSSING';
        updateSimZoneStatusLabel(
            `${crossing.length} animal(s) crossed border — ${animal.toUpperCase()} @ ${SECTOR_TO_CAMERA[sector]?.name || sector}`,
            risk === 'CRITICAL' ? 'status-crossing' : 'status-warning'
        );

        resetAllSectors();
        resetAllCameraFeedAlerts();
        updateSectorStatus(sector, risk, animal);
        setCameraFeedAlert(sector, risk);
        highlightCameraFeed(sector);
        crossing.forEach(a => {
            const s = getSectorForAnimal(a);
            updateSectorStatus(s, getCrossingAlertRisk(a), a.type);
            setCameraFeedAlert(s, getCrossingAlertRisk(a));
        });

        lastDetectedAnimal = animal;
        updateCrossingStatus(true, risk, animal);

        const shouldAlert = previousSimThreatState === 'ALL_SAFE' ||
            (lastSimCrossingRisk !== risk && riskRankHigher(risk, lastSimCrossingRisk));

        if (shouldAlert) {
            triggerIntrusionAlert(
                `🚨 ${riskLabel}: ${animal.toUpperCase()} CROSSED BORDER`,
                `${crossing.length} animal(s) have breached the perimeter border. ${animal.toUpperCase()} detected outside safe zone — activating siren.`,
                risk
            );
            dispatchRangerAlert(animal, risk, sector);
            setActiveSirenButton(risk === 'CRITICAL' ? btnSirenAlert : btnSirenWarning);

            if (!simAlertLogged) {
                simAlertLogged = true;
                const mockBlob = new Blob(['simulation_data'], { type: 'image/jpeg' });
                runDetectionInference(mockBlob, true, `simulated_${animal}_${Date.now()}.jpg`);
            }
        }

        previousSimThreatState = 'CROSSING';
        lastSimCrossingRisk = risk;
    }

    function riskRankHigher(a, b) {
        const rank = { CRITICAL: 3, WARNING: 2, SAFE: 1 };
        return (rank[a] || 0) > (rank[b] || 0);
    }

    function initDefaultSimAnimals() {
        simAnimals = [];
        simAnimalIdCounter = 0;
        previousSimThreatState = 'ALL_SAFE';
        lastSimCrossingRisk = null;
        simAlertLogged = false;
        spawnSimAnimal('cattle', { sector: 'west', spawnInside: true });
        spawnSimAnimal('cattle', { sector: 'south', spawnInside: true });
        spawnSimAnimal('tiger', { sector: 'north', spawnOutside: 'top' });
        spawnSimAnimal('elephant', { sector: 'east', spawnOutside: 'right' });
    }

    // Auto Intrusion timer
    let autoIntrusionTimeout = null;

    // --- Helper Functions for Sentinel Map & Alerts ---
    function loadSettings() {
        const tone = localStorage.getItem('wildshield_alarm_tone');
        if (tone && settingAlarmTone) settingAlarmTone.value = tone;
        
        const simRate = localStorage.getItem('wildshield_sim_rate');
        if (simRate && settingSimRate) settingSimRate.value = simRate;
        
        const autoDismiss = localStorage.getItem('wildshield_auto_dismiss');
        if (autoDismiss !== null && settingAutoDismiss) settingAutoDismiss.checked = (autoDismiss === 'true');
        
        const notifyRangers = localStorage.getItem('wildshield_notify_rangers');
        if (notifyRangers !== null && settingNotifyRangers) settingNotifyRangers.checked = (notifyRangers === 'true');
    }

    function saveSettings() {
        if (settingAlarmTone) localStorage.setItem('wildshield_alarm_tone', settingAlarmTone.value);
        if (settingSimRate) localStorage.setItem('wildshield_sim_rate', settingSimRate.value);
        if (settingAutoDismiss) localStorage.setItem('wildshield_auto_dismiss', settingAutoDismiss.checked);
        if (settingNotifyRangers) localStorage.setItem('wildshield_notify_rangers', settingNotifyRangers.checked);
        
        // Handle changing simulator interval dynamically if active tab is simulate
        if (activeFeedTab === 'simulate') {
            scheduleNextAutoIntrusion();
        }
    }

    function updateSectorStatus(sector, risk, animalName = '') {
        const pathId = `sectorPath${sector.charAt(0).toUpperCase() + sector.slice(1)}`;
        const cardId = `sectorCard${sector.charAt(0).toUpperCase() + sector.slice(1)}`;
        const descId = `sectorDesc${sector.charAt(0).toUpperCase() + sector.slice(1)}`;
        
        const pathEl = document.getElementById(pathId);
        const cardEl = document.getElementById(cardId);
        const descEl = document.getElementById(descId);
        const indicatorEl = cardEl ? cardEl.querySelector('.sector-indicator') : null;
        
        if (!pathEl || !cardEl) return;
        
        // Reset classes
        pathEl.className.baseVal = 'radar-sector';
        cardEl.className = 'sector-status-card';
        if (indicatorEl) indicatorEl.className = 'sector-indicator';
        
        // Apply threat styles
        if (risk === 'CRITICAL') {
            pathEl.classList.add('sector-critical');
            cardEl.classList.add('active-critical');
            if (indicatorEl) indicatorEl.classList.add('critical');
            if (descEl) descEl.textContent = `CRITICAL BREACH: ${animalName.toUpperCase()}`;
        } else if (risk === 'WARNING') {
            pathEl.classList.add('sector-warning');
            cardEl.classList.add('active-warning');
            if (indicatorEl) indicatorEl.classList.add('warning');
            if (descEl) descEl.textContent = `ALERT: ${animalName.toUpperCase()} detected`;
        } else if (risk === 'SAFE' && animalName) {
            pathEl.classList.add('sector-safe');
            if (indicatorEl) indicatorEl.classList.add('safe');
            if (descEl) descEl.textContent = `${animalName.toUpperCase()} crossing (Safe)`;
        } else {
            pathEl.classList.add('sector-safe');
            if (indicatorEl) indicatorEl.classList.add('safe');
            if (descEl) descEl.textContent = animalName
                ? `${animalName.toUpperCase()} in safe range`
                : 'Camera Connected — Live Feed';
        }
        
        updateOverallSentinelLabel();
    }

    function resetAllSectors() {
        ['north', 'east', 'south', 'west'].forEach(sector => {
            updateSectorStatus(sector, 'SAFE');
        });
        if (activeFeedTab === 'simulate') {
            resetAllCameraFeedAlerts();
        }
    }

    function updateOverallSentinelLabel() {
        const sentinelStatusLabel = document.getElementById('sentinelStatusLabel');
        if (!sentinelStatusLabel) return;
        
        const cards = document.querySelectorAll('.sector-status-card');
        let highestRisk = 'SAFE';
        let breachSector = '';
        
        cards.forEach(card => {
            const sector = card.getAttribute('data-sector');
            if (card.classList.contains('active-critical')) {
                highestRisk = 'CRITICAL';
                breachSector = sector.toUpperCase();
            } else if (card.classList.contains('active-warning') && highestRisk !== 'CRITICAL') {
                highestRisk = 'WARNING';
                breachSector = sector.toUpperCase();
            }
        });
        
        sentinelStatusLabel.className = 'badge';
        if (highestRisk === 'CRITICAL') {
            sentinelStatusLabel.classList.add('badge-risk-critical');
            sentinelStatusLabel.textContent = `PERIMETER BREACH: ${breachSector}`;
        } else if (highestRisk === 'WARNING') {
            sentinelStatusLabel.classList.add('badge-risk-warning');
            sentinelStatusLabel.textContent = `ALERT ACTIVE IN ${breachSector}`;
        } else {
            sentinelStatusLabel.classList.add('badge-risk-safe');
            sentinelStatusLabel.textContent = 'ALL SECTORS SECURE';
        }
    }

    function getSectorForDetections(detections) {
        if (!detections || detections.length === 0) return null;
        const critical = detections.find(d => d.risk_level === 'CRITICAL');
        const warning = detections.find(d => d.risk_level === 'WARNING');
        const safe = detections.find(d => d.risk_level === 'SAFE');
        
        if (critical) {
            return { sector: Math.random() > 0.5 ? 'north' : 'west', risk: 'CRITICAL', name: critical.class_name };
        } else if (warning) {
            return { sector: Math.random() > 0.5 ? 'east' : 'south', risk: 'WARNING', name: warning.class_name };
        } else if (safe) {
            return { sector: 'west', risk: 'SAFE', name: safe.class_name };
        }
        return null;
    }

    function dispatchRangerAlert(animalName, riskLevel, sectorName, alertsSent = null) {
        if (!settingNotifyRangers || !settingNotifyRangers.checked) return;
        
        const timestamp = new Date().toLocaleTimeString();
        const sectorCode = {
            'north': 'CAM_02_NORTH_FOREST',
            'east': 'CAM_03_EAST_RIVER',
            'south': 'CAM_04_SOUTH_BUFFER',
            'west': 'CAM_01_WEST_PERIMETER'
        }[sectorName.toLowerCase()] || 'PERIMETER';
        
        let message = "";
        if (riskLevel === 'CRITICAL') {
            message = `CRITICAL dispatch: Armed rangers deployed to ${sectorCode}. Intruder: ${animalName.toUpperCase()}.`;
        } else {
            message = `WARNING alert sent to ranger patrol for investigation at ${sectorCode}. Subject: ${animalName.toUpperCase()}.`;
        }
        
        if (alertsSent) {
            const channels = [];
            if (alertsSent.telegram) channels.push('Telegram Bot 📬');
            if (alertsSent.whatsapp) channels.push('WhatsApp Admin 🟢');
            if (channels.length > 0) {
                message += ` [Admin Alert Dispatched via: ${channels.join(', ')}]`;
            }
        }
        
        // Add to dispatch list feed
        const dispatchList = document.getElementById('dispatchList');
        if (dispatchList) {
            const emptyMsg = dispatchList.querySelector('.empty-list-msg');
            if (emptyMsg) {
                emptyMsg.remove();
            }
            
            const li = document.createElement('li');
            li.className = `dispatch-item dispatch-${riskLevel.toLowerCase()}`;
            
            const badgeClass = riskLevel === 'CRITICAL' ? 'crimson' : 'amber';
            const badgeText = riskLevel === 'CRITICAL' ? '[DISPATCH DEPLOYED]' : '[PATROL ALERTED]';
            
            li.innerHTML = `
                <div class="dispatch-header">
                    <span class="${badgeClass}">${badgeText}</span>
                    <span class="dispatch-time">${timestamp}</span>
                </div>
                <span class="dispatch-msg">${message}</span>
            `;
            
            dispatchList.insertBefore(li, dispatchList.firstChild);
            
            // Cap at 10 items
            while (dispatchList.children.length > 10) {
                dispatchList.removeChild(dispatchList.lastChild);
            }
        }
        
        // Show floating notification toast
        showRangerToast(riskLevel, message);
    }

    function showRangerToast(riskLevel, message) {
        const existingToast = document.querySelector('.ranger-toast');
        if (existingToast) {
            existingToast.remove();
        }
        
        const toast = document.createElement('div');
        toast.className = `ranger-toast toast-${riskLevel.toLowerCase()}`;
        
        const icon = riskLevel === 'CRITICAL' ? '☠️' : '⚠️';
        
        toast.innerHTML = `
            <span style="font-size: 1.5rem;">${icon}</span>
            <div style="flex-grow: 1;">
                <strong style="display: block; font-size: 0.85rem; font-family: var(--font-heading); margin-bottom: 0.1rem;">
                    ${riskLevel === 'CRITICAL' ? 'CRITICAL DISPATCH SENT' : 'RANGER ALERT DISPATCHED'}
                </strong>
                <span style="font-size: 0.75rem; color: var(--text-secondary);">${message}</span>
            </div>
            <span class="ranger-toast-close">&times;</span>
        `;
        
        toast.querySelector('.ranger-toast-close').addEventListener('click', () => {
            toast.remove();
        });
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 6000);
    }

    function scheduleNextAutoIntrusion() {
        if (autoIntrusionTimeout) {
            clearTimeout(autoIntrusionTimeout);
            autoIntrusionTimeout = null;
        }
        
        if (!settingSimRate) return;
        const simRateValue = settingSimRate.value;
        if (simRateValue === 'off' || activeFeedTab !== 'simulate') {
            return;
        }
        
        const seconds = parseInt(simRateValue);
        const ms = seconds * 1000;
        
        autoIntrusionTimeout = setTimeout(() => {
            if (activeFeedTab === 'simulate') {
                const animals = ['tiger', 'elephant', 'cattle', 'monkey'];
                const animalRisks = { tiger: 'CRITICAL', elephant: 'WARNING', cattle: 'SAFE', monkey: 'SAFE' };
                const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
                triggerSimulationIntruder(randomAnimal, animalRisks[randomAnimal]);
                scheduleNextAutoIntrusion();
            }
        }, ms);
    }

    // --- DOM Elements ---
    const navMonitor = document.getElementById('navMonitor');
    const navAnalytics = document.getElementById('navAnalytics');
    const navLogs = document.getElementById('navLogs');
    const navSettings = document.getElementById('navSettings');
    
    const monitorSection = document.getElementById('monitorSection');
    const analyticsSection = document.getElementById('analyticsSection');
    const logsSection = document.getElementById('logsSection');
    const settingsSection = document.getElementById('settingsSection');
    
    const pageTitle = document.getElementById('pageTitle');
    const threatLevelBadge = document.getElementById('threatLevelBadge');
    const muteAlarmBtn = document.getElementById('muteAlarmBtn');
    const muteIcon = document.getElementById('muteIcon');
    const statusPulse = document.getElementById('statusPulse');
    const statusText = document.getElementById('statusText');
    
    const alertBanner = document.getElementById('alertBanner');
    const alertBannerTitle = document.getElementById('alertBannerTitle');
    const alertBannerDesc = document.getElementById('alertBannerDesc');
    const dismissAlertBtn = document.getElementById('dismissAlertBtn');
    const alarmOverlay = document.getElementById('alarmOverlay');
    
    const tabUpload = document.getElementById('tabUpload');
    const tabSimulate = document.getElementById('tabSimulate');
    const uploadFeedContainer = document.getElementById('uploadFeedContainer');
    const simulateFeedContainer = document.getElementById('simulateFeedContainer');
    
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const browseBtn = document.getElementById('browseBtn');
    const previewArea = document.getElementById('previewArea');
    const imagePreview = document.getElementById('imagePreview');
    const videoPreview = document.getElementById('videoPreview');
    const clearFileBtn = document.getElementById('clearFileBtn');
    
    const confRange = document.getElementById('confRange');
    const confVal = document.getElementById('confVal');
    const analyzeBtn = document.getElementById('analyzeBtn');
    
    const outputPlaceholder = document.getElementById('outputPlaceholder');
    const outputMediaWrapper = document.getElementById('outputMediaWrapper');
    const outputImage = document.getElementById('outputImage');
    const outputVideo = document.getElementById('outputVideo');
    const valInfTime = document.getElementById('valInfTime');
    const valInfCount = document.getElementById('valInfCount');
    const detectionsList = document.getElementById('detectionsList');
    
    // Quick Test Deck
    const sampleCattle = document.getElementById('sampleCattle');
    const sampleElephant = document.getElementById('sampleElephant');
    const sampleMonkey = document.getElementById('sampleMonkey');
    const sampleRhinoceros = document.getElementById('sampleRhinoceros');
    const sampleWolf = document.getElementById('sampleWolf');
    const sampleVideo = document.getElementById('sampleVideo');
    
    // Stats & History
    const statTotalIntrusions = document.getElementById('statTotalIntrusions');
    const statCriticalAlerts = document.getElementById('statCriticalAlerts');
    const statWarningAlerts = document.getElementById('statWarningAlerts');
    const statSafetyIndex = document.getElementById('statSafetyIndex');
    const chartContainer = document.getElementById('chartContainer');
    const logsTableBody = document.getElementById('logsTableBody');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    
    // Settings Form
    const settingsForm = document.getElementById('settingsForm');
    const settingAlarmTone = document.getElementById('settingAlarmTone');
    const settingSimRate = document.getElementById('settingSimRate');
    const settingAutoDismiss = document.getElementById('settingAutoDismiss');
    const settingNotifyRangers = document.getElementById('settingNotifyRangers');
    
    // Simulator
    const simulatorTimestamp = document.getElementById('simulatorTimestamp');
    
    // Simulator Trigger Buttons
    const btnSimulateTiger = document.getElementById('btnSimulateTiger');
    const btnSimulateElephant = document.getElementById('btnSimulateElephant');
    const btnSimulateCattle = document.getElementById('btnSimulateCattle');
    const btnSimulateMonkey = document.getElementById('btnSimulateMonkey');
    const btnSimulateRhinoceros = document.getElementById('btnSimulateRhinoceros');
    const btnSimulateWolf = document.getElementById('btnSimulateWolf');
    const btnSimulateClear = document.getElementById('btnSimulateClear');
    
    // Siren Control Buttons
    const crossingStatusBadge = document.getElementById('crossingStatusBadge');
    const btnSirenWarning = document.getElementById('btnSirenWarning');
    const btnSirenAlert = document.getElementById('btnSirenAlert');
    const btnSirenAllClear = document.getElementById('btnSirenAllClear');
    const btnSirenTrigger = document.getElementById('btnSirenTrigger');
    const btnSirenSafe = document.getElementById('btnSirenSafe');
    const sirenButtons = [btnSirenWarning, btnSirenAlert, btnSirenAllClear, btnSirenTrigger, btnSirenSafe].filter(Boolean);

    function updateCrossingStatus(isCrossing, risk = 'SAFE', animalName = '') {
        animalCrossing = isCrossing;
        if (animalName) lastDetectedAnimal = animalName;

        if (!crossingStatusBadge) return;

        crossingStatusBadge.className = 'crossing-badge';
        if (!isCrossing) {
            crossingStatusBadge.classList.add('crossing-clear');
            crossingStatusBadge.innerHTML = '<i class="ti ti-circle-check"></i> NO ANIMAL CROSSING';
        } else if (risk === 'CRITICAL') {
            crossingStatusBadge.classList.add('crossing-active');
            crossingStatusBadge.innerHTML = `<i class="ti ti-alert-triangle animate-pulse"></i> ANIMAL CROSSING — ${(animalName || lastDetectedAnimal || 'UNKNOWN').toUpperCase()}`;
        } else if (risk === 'WARNING') {
            crossingStatusBadge.classList.add('crossing-warning');
            crossingStatusBadge.innerHTML = `<i class="ti ti-alert-circle"></i> ANIMAL CROSSING — ${(animalName || lastDetectedAnimal || 'UNKNOWN').toUpperCase()}`;
        } else {
            crossingStatusBadge.classList.add('crossing-safe');
            crossingStatusBadge.innerHTML = `<i class="ti ti-paw"></i> SAFE CROSSING — ${(animalName || lastDetectedAnimal || 'UNKNOWN').toUpperCase()}`;
        }
    }

    function setActiveSirenButton(activeBtn) {
        sirenButtons.forEach(btn => btn.classList.remove('active'));
        if (activeBtn) activeBtn.classList.add('active');
    }

    function activateWarningSiren(animalName = '') {
        const name = animalName || lastDetectedAnimal || 'unknown animal';
        updateCrossingStatus(true, 'WARNING', name);
        updateSectorStatus('west', 'WARNING', name);
        triggerIntrusionAlert(
            '⚠️ WARNING: ANIMAL AT PERIMETER',
            `Warning alert activated — ${name.toUpperCase()} detected crossing the boundary. Monitor closely.`,
            'WARNING'
        );
        setActiveSirenButton(btnSirenWarning);
        dispatchRangerAlert(name, 'WARNING', 'west');
    }

    function activateAlertSiren(animalName = '') {
        const name = animalName || lastDetectedAnimal || 'unknown animal';
        updateCrossingStatus(true, 'CRITICAL', name);
        updateSectorStatus('north', 'CRITICAL', name);
        triggerIntrusionAlert(
            '🚨 CRITICAL ALERT: DANGEROUS ANIMAL CROSSING',
            `Critical alert activated — ${name.toUpperCase()} has breached the perimeter. Dispatching alarms immediately.`,
            'CRITICAL'
        );
        setActiveSirenButton(btnSirenAlert);
        dispatchRangerAlert(name, 'CRITICAL', 'north');
    }

    function activateSafeCrossing(animalName = '') {
        const name = animalName || lastDetectedAnimal || 'livestock';
        updateCrossingStatus(true, 'SAFE', name);
        updateSectorStatus('west', 'SAFE', name);
        triggerIntrusionAlert(
            '🐾 SAFE CROSSING DETECTED',
            `${name.toUpperCase()} crossing registered — classified as non-threatening. Perimeter remains secure.`,
            'SAFE'
        );
        setActiveSirenButton(btnSirenSafe);
    }

    function activateAllClear() {
        manualSirenActive = false;
        if (btnSirenTrigger) btnSirenTrigger.classList.remove('active');
        dismissAlert();
    }

    function toggleManualSiren() {
        initAudio();
        manualSirenActive = !manualSirenActive;
        if (manualSirenActive) {
            if (isMuted) {
                alert('Alarm is muted. Unmute to hear the siren.');
                manualSirenActive = false;
                return;
            }
            playSiren();
            setActiveSirenButton(btnSirenTrigger);
            alarmOverlay.classList.add('alarm-active');
        } else {
            stopSiren();
            if (currentThreatLevel === 'SAFE') {
                alarmOverlay.classList.remove('alarm-active');
                setActiveSirenButton(null);
            } else {
                setActiveSirenButton(
                    currentThreatLevel === 'CRITICAL' ? btnSirenAlert :
                    currentThreatLevel === 'WARNING' ? btnSirenWarning : btnSirenSafe
                );
            }
        }
    }

    if (btnSirenWarning) btnSirenWarning.addEventListener('click', () => activateWarningSiren());
    if (btnSirenAlert) btnSirenAlert.addEventListener('click', () => activateAlertSiren());
    if (btnSirenAllClear) btnSirenAllClear.addEventListener('click', () => activateAllClear());
    if (btnSirenTrigger) btnSirenTrigger.addEventListener('click', () => toggleManualSiren());
    if (btnSirenSafe) btnSirenSafe.addEventListener('click', () => activateSafeCrossing());

    // Media Lightbox Modal
    const mediaModal = document.getElementById('mediaModal');
    const modalImage = document.getElementById('modalImage');
    const modalVideo = document.getElementById('modalVideo');
    const modalCaption = document.getElementById('modalCaption');
    const closeModalBtn = document.getElementById('closeModalBtn');

    // --- Tab Switcher Navigation ---
    const sections = [
        { btn: navMonitor, sec: monitorSection, title: 'Live Threat Monitoring' },
        { btn: navAnalytics, sec: analyticsSection, title: 'Intrusion Data Analytics' },
        { btn: navLogs, sec: logsSection, title: 'Intrusion Event Register' },
        { btn: navSettings, sec: settingsSection, title: 'System Security Settings' }
    ];

    sections.forEach(item => {
        if (item.btn) {
            item.btn.addEventListener('click', (e) => {
                e.preventDefault();
                sections.forEach(i => {
                    i.btn.classList.remove('active');
                    i.sec.classList.remove('active');
                });
                item.btn.classList.add('active');
                item.sec.classList.add('active');
                pageTitle.textContent = item.title;
                
                // Refresh data if switching sections
                if (item.sec === analyticsSection || item.sec === logsSection) {
                    refreshAnalyticsAndLogs();
                }
            });
        }
    });

    // --- Audio Synthesis Alert Siren ---
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    function playSiren() {
        if (isMuted || isAlarmPlaying) return;
        initAudio();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        isAlarmPlaying = true;
        
        // Setup nodes
        alarmOscillator = audioCtx.createOscillator();
        alarmLfo = audioCtx.createOscillator();
        alarmGain = audioCtx.createGain();
        const lfoGain = audioCtx.createGain();

        const toneType = settingAlarmTone.value;
        
        if (toneType === 'siren') {
            // Traditional siren: frequency sweeps between 400Hz and 800Hz
            alarmOscillator.type = 'sawtooth';
            alarmOscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
            
            alarmLfo.type = 'sine';
            alarmLfo.frequency.setValueAtTime(1.5, audioCtx.currentTime); // sweeps 1.5 times a second
            
            lfoGain.gain.setValueAtTime(200, audioCtx.currentTime); // amplitude of sweep
            
            alarmGain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        } else if (toneType === 'beep') {
            // Rapid warning pulse
            alarmOscillator.type = 'square';
            alarmOscillator.frequency.setValueAtTime(900, audioCtx.currentTime);
            
            alarmLfo.type = 'square';
            alarmLfo.frequency.setValueAtTime(4, audioCtx.currentTime); // 4Hz pulse
            
            lfoGain.gain.setValueAtTime(400, audioCtx.currentTime);
            alarmGain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        } else {
            // Radar sweep
            alarmOscillator.type = 'sine';
            alarmOscillator.frequency.setValueAtTime(300, audioCtx.currentTime);
            
            alarmLfo.type = 'sawtooth';
            alarmLfo.frequency.setValueAtTime(0.5, audioCtx.currentTime); // slow sweep
            
            lfoGain.gain.setValueAtTime(150, audioCtx.currentTime);
            alarmGain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        }

        alarmLfo.connect(lfoGain);
        lfoGain.connect(alarmOscillator.frequency);
        
        alarmOscillator.connect(alarmGain);
        alarmGain.connect(audioCtx.destination);
        
        alarmLfo.start();
        alarmOscillator.start();
    }

    function stopSiren() {
        if (!isAlarmPlaying) return;
        try {
            if (alarmOscillator) {
                alarmOscillator.stop();
                alarmOscillator.disconnect();
            }
            if (alarmLfo) {
                alarmLfo.stop();
                alarmLfo.disconnect();
            }
            if (alarmGain) {
                alarmGain.disconnect();
            }
        } catch (e) {
            console.error("Error stopping audio:", e);
        }
        isAlarmPlaying = false;
        if (!manualSirenActive && btnSirenTrigger) {
            btnSirenTrigger.classList.remove('active');
        }
    }

    muteAlarmBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        muteAlarmBtn.classList.toggle('muted', isMuted);
        if (isMuted) {
            muteIcon.innerHTML = '<i class="ti ti-volume-off"></i>';
            muteAlarmBtn.innerHTML = '<span id="muteIcon"><i class="ti ti-volume-off"></i></span><span>Unmute Alarm</span>';
            stopSiren();
        } else {
            muteIcon.innerHTML = '<i class="ti ti-volume"></i>';
            muteAlarmBtn.innerHTML = '<span id="muteIcon"><i class="ti ti-volume"></i></span><span>Mute Alarm</span>';
            if (currentThreatLevel !== 'SAFE') {
                playSiren();
            }
        }
    });

    // --- Threat Level Visual updates ---
    function setThreatLevel(level) {
        currentThreatLevel = level;
        threatLevelBadge.className = 'threat-badge';
        alarmOverlay.className = 'alarm-overlay';

        if (level === 'CRITICAL') {
            threatLevelBadge.classList.add('threat-critical');
            threatLevelBadge.innerHTML = '<i class="ti ti-alert-triangle animate-pulse"></i><span class="threat-label">LEVEL: CRITICAL THREAT</span>';
            statusPulse.className = 'pulse-indicator red';
            statusText.textContent = 'System: THREAT ACTIVE';
            alarmOverlay.classList.add('alarm-active');
            if (!manualSirenActive) playSiren();
            setActiveSirenButton(btnSirenAlert);
        } else if (level === 'WARNING') {
            threatLevelBadge.classList.add('threat-warning');
            threatLevelBadge.innerHTML = '<i class="ti ti-alert-circle"></i><span class="threat-label">LEVEL: WARNING ALERT</span>';
            statusPulse.className = 'pulse-indicator red';
            statusText.textContent = 'System: THREAT ACTIVE';
            alarmOverlay.classList.add('alarm-active');
            if (!manualSirenActive) playSiren();
            setActiveSirenButton(btnSirenWarning);
        } else {
            threatLevelBadge.classList.add('threat-safe');
            threatLevelBadge.innerHTML = '<i class="ti ti-shield-check"></i><span class="threat-label">LEVEL: SAFE</span>';
            statusPulse.className = 'pulse-indicator green';
            statusText.textContent = 'System: ONLINE';
            if (!manualSirenActive) stopSiren();
            alarmOverlay.classList.remove('alarm-active');
            if (animalCrossing) {
                setActiveSirenButton(btnSirenSafe);
            } else {
                setActiveSirenButton(btnSirenAllClear);
            }
        }
    }

    // --- Alert Banner Banner handling ---
    function triggerIntrusionAlert(title, message, risk) {
        alertBanner.classList.remove('hidden');
        alertBannerTitle.textContent = title;
        alertBannerDesc.textContent = message;
        setThreatLevel(risk);
        
        if (settingAutoDismiss.checked && risk === 'SAFE') {
            setTimeout(() => {
                dismissAlert();
            }, 5000);
        }
    }

    function dismissAlert() {
        alertBanner.classList.add('hidden');
        manualSirenActive = false;
        animalCrossing = false;
        updateCrossingStatus(false);
        setThreatLevel('SAFE');
        resetAllSectors();
        setActiveSirenButton(btnSirenAllClear);
    }

    dismissAlertBtn.addEventListener('click', dismissAlert);

    // --- File Handling & UI Triggers ---
    function handleSelectedFile(file) {
        if (!file) return;
        selectedFile = file;
        analyzeBtn.disabled = false;
        
        // Reset preview states
        imagePreview.classList.add('hidden');
        videoPreview.classList.add('hidden');
        previewArea.classList.remove('hidden');
        dropZone.classList.add('hidden');

        const fileReader = new FileReader();
        if (file.type.startsWith('image/')) {
            fileReader.onload = (e) => {
                imagePreview.src = e.target.result;
                imagePreview.classList.remove('hidden');
            };
            fileReader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
            const url = URL.createObjectURL(file);
            videoPreview.src = url;
            videoPreview.classList.remove('hidden');
        }
    }

    // Drag and drop events
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleSelectedFile(files[0]);
        }
    });

    browseBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleSelectedFile(fileInput.files[0]);
        }
    });

    clearFileBtn.addEventListener('click', () => {
        selectedFile = null;
        fileInput.value = '';
        imagePreview.src = '';
        videoPreview.src = '';
        previewArea.classList.add('hidden');
        dropZone.classList.remove('hidden');
        analyzeBtn.disabled = true;
        
        // Reset output panel
        outputPlaceholder.classList.remove('hidden');
        outputMediaWrapper.classList.add('hidden');
        outputImage.classList.add('hidden');
        outputVideo.classList.add('hidden');
        detectionsList.innerHTML = '<li class="empty-list-msg">No detections registered yet.</li>';
    });

    // Slider text updating
    confRange.addEventListener('input', () => {
        confVal.textContent = `${confRange.value}%`;
    });

    // --- Tab Selection inside Monitor Card ---
    tabUpload.addEventListener('click', () => {
        activeFeedTab = 'upload';
        tabUpload.classList.add('active');
        tabSimulate.classList.remove('active');
        uploadFeedContainer.classList.remove('hidden');
        simulateFeedContainer.classList.add('hidden');
        
        stopCctvSimulator();
    });

    tabSimulate.addEventListener('click', () => {
        activeFeedTab = 'simulate';
        tabSimulate.classList.add('active');
        tabUpload.classList.remove('active');
        simulateFeedContainer.classList.remove('hidden');
        uploadFeedContainer.classList.add('hidden');
        
        startCctvSimulator();
    });

    // --- Web API Fetch Execution ---
    analyzeBtn.addEventListener('click', () => {
        if (!selectedFile) return;
        runDetectionInference(selectedFile);
    });

    function runDetectionInference(fileBlob, isSimulated = false, filenameOverride = null) {
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = '⚡ ANALYZING WITH YOLOv5...';
        
        const formData = new FormData();
        const confDecimal = parseFloat(confRange.value) / 100.0;
        
        // Attach confidence
        formData.append('confidence', confDecimal);
        
        // Attach file
        if (filenameOverride) {
            formData.append('file', fileBlob, filenameOverride);
        } else {
            formData.append('file', fileBlob);
        }

        const startTime = performance.now();
        
        fetch('/api/detect', {
            method: 'POST',
            body: formData
        })
        .then(res => {
            if (!res.ok) {
                throw new Error("Server detection error");
            }
            return res.json();
        })
        .then(data => {
            const endTime = performance.now();
            const timeTaken = ((endTime - startTime) / 1000).toFixed(2);
            
            // Present Output Visualizer
            outputPlaceholder.classList.add('hidden');
            outputMediaWrapper.classList.remove('hidden');
            
            valInfTime.textContent = `${timeTaken}s`;
            valInfCount.textContent = data.detections.length;
            
            // Render result media
            if (data.is_video) {
                outputImage.classList.add('hidden');
                outputVideo.src = data.result_url;
                outputVideo.classList.remove('hidden');
            } else {
                outputVideo.classList.add('hidden');
                outputImage.src = data.result_url + '?t=' + new Date().getTime(); // break caching
                outputImage.classList.remove('hidden');
            }

            // Fill detections inventory list
            detectionsList.innerHTML = '';
            if (data.detections.length === 0) {
                detectionsList.innerHTML = '<li>🐾 No intrusion targets registered.</li>';
            } else {
                data.detections.forEach(det => {
                    const li = document.createElement('li');
                    
                    const nameSpan = document.createElement('span');
                    nameSpan.innerHTML = `<strong>${det.class_name.toUpperCase()}</strong> (${(det.confidence * 100).toFixed(1)}%)`;
                    
                    const badgeSpan = document.createElement('span');
                    badgeSpan.className = `badge badge-risk-${det.risk_level.toLowerCase()}`;
                    badgeSpan.textContent = det.risk_level;
                    
                    li.appendChild(nameSpan);
                    li.appendChild(badgeSpan);
                    detectionsList.appendChild(li);
                });
            }

            // Fire Alarm state machine based on results (skip when live simulator handles border logic)
            if (!isSimulated) {
                if (data.highest_risk !== 'SAFE') {
                    const triggerItem = data.detections.find(d => d.risk_level === data.highest_risk);
                    const animalLabel = triggerItem ? triggerItem.class_name : 'unknown animal';
                    lastDetectedAnimal = animalLabel;
                    
                    const sectorMapping = getSectorForDetections(data.detections) || { sector: 'west', risk: data.highest_risk, name: animalLabel };
                    
                    resetAllSectors();
                    updateSectorStatus(sectorMapping.sector, sectorMapping.risk, sectorMapping.name);
                    updateCrossingStatus(true, data.highest_risk, animalLabel);
                    
                    triggerIntrusionAlert(
                        `🚨 CRITICAL PERIMETER BREACH DETECTED`,
                        `Intrusion alert: ${animalLabel.toUpperCase()} detected at ${(triggerItem.confidence * 100).toFixed(1)}% confidence score. Dispatching warning alarms.`,
                        data.highest_risk
                    );
                    
                    dispatchRangerAlert(animalLabel, data.highest_risk, sectorMapping.sector, data.alerts_sent);
                } else if (data.detections.length > 0) {
                    const safeItem = data.detections[0];
                    lastDetectedAnimal = safeItem.class_name;
                    resetAllSectors();
                    updateSectorStatus('west', 'SAFE', safeItem.class_name);
                    updateCrossingStatus(true, 'SAFE', safeItem.class_name);
                    triggerIntrusionAlert(
                        '🐾 SAFE CROSSING DETECTED',
                        `${safeItem.class_name.toUpperCase()} detected — classified as non-threatening livestock crossing.`,
                        'SAFE'
                    );
                    setActiveSirenButton(btnSirenSafe);
                } else {
                    dismissAlert();
                    resetAllSectors();
                }
            }

            // Update stats
            refreshAnalyticsAndLogs();
        })
        .catch(err => {
            console.error("Inference run error:", err);
            alert("Model run failed. Ensure the server backend is running on port 5000.");
        })
        .finally(() => {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = '⚡ RUN DETECT INFERENCE';
        });
    }

    // --- Sample Deck Quick Clones ---
    function loadSampleByPath(url, filename, isVideo = false) {
        fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("Sample file not found");
            return res.blob();
        })
        .then(blob => {
            const file = new File([blob], filename, { type: isVideo ? 'video/mp4' : 'image/jpeg' });
            handleSelectedFile(file);
            // Execute run
            runDetectionInference(file);
        })
        .catch(err => {
            console.error("Failed to load local sample:", err);
            alert(`Unable to access sample ${filename}. Please upload a file manually.`);
        });
    }

    if (sampleCattle) sampleCattle.addEventListener('click', () => loadSampleByPath('/Images/pred_cattle.jpg', 'cattle.jpg'));
    if (sampleElephant) sampleElephant.addEventListener('click', () => loadSampleByPath('/Images/pred_elephant.png', 'elephant.jpg'));
    if (sampleMonkey) sampleMonkey.addEventListener('click', () => loadSampleByPath('/Images/pred_monkey.jpeg', 'monkey.jpg'));
    if (sampleRhinoceros) sampleRhinoceros.addEventListener('click', () => loadSampleByPath('/Images/pred_rhinoceros.jpg', 'rhinoceros.jpg'));
    if (sampleWolf) sampleWolf.addEventListener('click', () => loadSampleByPath('/Images/pred_wolf.jpg', 'wolf.jpg'));
    if (sampleVideo) sampleVideo.addEventListener('click', () => loadSampleByPath('/Video/Elephant_pred.mp4', 'surveillance_video.mp4', true));

    // --- Surveillance CCTV Live Canvas Simulator (4 cameras) ---
    function startCctvSimulator() {
        stopCctvSimulator(false);
        initAudio();
        connectAllCameras();
        initDefaultSimAnimals();
        scheduleNextAutoIntrusion();

        camContexts = {};
        CAMERA_CONFIG.forEach(cam => {
            const canvas = document.getElementById(cam.canvasId);
            if (canvas) camContexts[cam.sector] = canvas.getContext('2d');
        });

        noiseFrames = [];
        for (let f = 0; f < 5; f++) {
            const frameData = [];
            for (let i = 0; i < 800; i++) {
                frameData.push(Math.random());
            }
            noiseFrames.push(frameData);
        }

        let frameIndex = 0;
        simulatorInterval = setInterval(() => {
            updateSimAnimalPositions();

            CAMERA_CONFIG.forEach(cam => {
                const ctx = camContexts[cam.sector];
                if (!ctx) return;
                renderCameraFrame(ctx, cam.sector, camScanLines[cam.sector], frameIndex);
                camScanLines[cam.sector] = (camScanLines[cam.sector] + 3) % SIM_CAM.h;
            });

            handleSimThreatEvaluation(evaluateSimThreatLevel());

            const now = new Date();
            if (simulatorTimestamp) {
                simulatorTimestamp.textContent = now.toISOString().replace('T', ' ').substring(0, 19);
            }

            frameIndex++;
        }, 33);
    }

    function stopCctvSimulator(clearAlerts = true) {
        if (simulatorInterval) {
            clearInterval(simulatorInterval);
            simulatorInterval = null;
        }
        if (autoIntrusionTimeout) {
            clearTimeout(autoIntrusionTimeout);
            autoIntrusionTimeout = null;
        }
        simAnimals = [];
        previousSimThreatState = 'ALL_SAFE';
        lastSimCrossingRisk = null;
        simAlertLogged = false;
        if (clearAlerts) {
            dismissAlert();
            resetAllSectors();
            updateSimZoneStatusLabel('All clear', '');
        }
    }

    function triggerSimulationIntruder(type, risk) {
        if (activeFeedTab !== 'simulate') return;

        const sectorMap = { tiger: 'north', elephant: 'east', cattle: 'west', monkey: 'south', rhinoceros: 'east', wolf: 'north' };
        const sector = sectorMap[type] || 'west';
        highlightCameraFeed(sector);

        if (risk === 'SAFE') {
            spawnSimAnimal(type, { sector, spawnInside: true, risk });
        } else {
            const edgeMap = { north: 'top', east: 'right', west: 'left', south: 'bottom' };
            spawnSimAnimal(type, { sector, spawnOutside: edgeMap[sector] || 'left', risk });
        }
        simAlertLogged = false;
    }

    if (btnSimulateTiger) btnSimulateTiger.addEventListener('click', () => triggerSimulationIntruder('tiger', 'CRITICAL'));
    if (btnSimulateElephant) btnSimulateElephant.addEventListener('click', () => triggerSimulationIntruder('elephant', 'WARNING'));
    if (btnSimulateCattle) btnSimulateCattle.addEventListener('click', () => triggerSimulationIntruder('cattle', 'SAFE'));
    if (btnSimulateMonkey) btnSimulateMonkey.addEventListener('click', () => triggerSimulationIntruder('monkey', 'SAFE'));
    if (btnSimulateRhinoceros) btnSimulateRhinoceros.addEventListener('click', () => triggerSimulationIntruder('rhinoceros', 'WARNING'));
    if (btnSimulateWolf) btnSimulateWolf.addEventListener('click', () => triggerSimulationIntruder('wolf', 'CRITICAL'));
    if (btnSimulateClear) btnSimulateClear.addEventListener('click', () => {
        simAnimals = [];
        previousSimThreatState = 'ALL_SAFE';
        lastSimCrossingRisk = null;
        simAlertLogged = false;
        dismissAlert();
        resetAllSectors();
        updateSimZoneStatusLabel('All clear', '');
    });

    CAMERA_CONFIG.forEach(cam => {
        const feedEl = document.getElementById(cam.feedId);
        const cardEl = document.getElementById(`sectorCard${cam.sector.charAt(0).toUpperCase() + cam.sector.slice(1)}`);
        if (feedEl) {
            feedEl.addEventListener('click', () => highlightCameraFeed(cam.sector));
        }
        if (cardEl) {
            cardEl.addEventListener('click', () => {
                if (activeFeedTab !== 'simulate') {
                    tabSimulate.click();
                }
                setTimeout(() => highlightCameraFeed(cam.sector), 50);
            });
        }
    });

    // --- Dashboard Analytics & Logs Refreshing ---
    function refreshAnalyticsAndLogs() {
        // Fetch from logs api
        fetch('/api/history')
        .then(res => res.json())
        .then(history => {
            renderLogsTable(history);
        });

        // Fetch from stats api
        fetch('/api/statistics')
        .then(res => res.json())
        .then(stats => {
            renderMetrics(stats);
            renderStatsChart(stats.animal_counts);
        });
    }

    function renderMetrics(stats) {
        if (statTotalIntrusions) statTotalIntrusions.textContent = stats.total_intrusions;
        if (statCriticalAlerts) statCriticalAlerts.textContent = stats.critical_count;
        if (statWarningAlerts) statWarningAlerts.textContent = stats.warning_count;
        
        // Calculate dynamic Safety Rating
        if (statSafetyIndex) {
            if (stats.total_intrusions === 0) {
                statSafetyIndex.textContent = "100%";
                statSafetyIndex.className = 'green';
            } else {
                const penalty = (stats.critical_count * 20) + (stats.warning_count * 5);
                const score = Math.max(0, 100 - penalty);
                statSafetyIndex.textContent = `${score}%`;
                
                if (score > 80) statSafetyIndex.className = 'green';
                else if (score > 50) statSafetyIndex.className = 'amber';
                else statSafetyIndex.className = 'crimson';
            }
        }
    }

    function getChartRiskClass(animalName) {
        const name = animalName.toLowerCase();
        const critical = ['tiger', 'bear', 'lion', 'wolf', 'leopard', 'leopord'];
        const warning = ['elephant', 'bull', 'hippo', 'rhinoceros', 'rhino'];
        if (critical.includes(name)) return 'chart-bar-critical';
        if (warning.includes(name)) return 'chart-bar-warning';
        return 'chart-bar-safe';
    }

    function renderStatsChart(counts) {
        if (!chartContainer) return;
        chartContainer.innerHTML = '';

        const keys = Object.keys(counts || {});
        if (keys.length === 0) {
            chartContainer.innerHTML = '<div class="empty-chart-msg">Log detections to view data metrics</div>';
            return;
        }

        const sortedKeys = keys.sort((a, b) => counts[b] - counts[a]);
        const maxCount = Math.max(...sortedKeys.map(k => counts[k]));

        sortedKeys.forEach(key => {
            const val = counts[key];
            const heightPercent = maxCount > 0 ? Math.max(8, (val / maxCount) * 85) : 8;

            const barWrapper = document.createElement('div');
            barWrapper.className = 'chart-bar-wrapper';
            barWrapper.title = `${key}: ${val} detection${val !== 1 ? 's' : ''}`;

            const bar = document.createElement('div');
            bar.className = `chart-bar ${getChartRiskClass(key)}`;
            bar.style.height = `${heightPercent}%`;

            const valueSpan = document.createElement('span');
            valueSpan.className = 'chart-bar-value';
            valueSpan.textContent = val;

            const labelSpan = document.createElement('span');
            labelSpan.className = 'chart-bar-label';
            labelSpan.textContent = key;
            labelSpan.title = key;

            bar.appendChild(valueSpan);
            barWrapper.appendChild(bar);
            barWrapper.appendChild(labelSpan);
            chartContainer.appendChild(barWrapper);
        });
    }

    function renderLogsTable(history) {
        if (!logsTableBody) return;
        logsTableBody.innerHTML = '';
        
        if (history.length === 0) {
            logsTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-table-msg">No historical events recorded. Try analyzing an image above!</td>
                </tr>
            `;
            return;
        }

        history.forEach(row => {
            const tr = document.createElement('tr');
            
            // Timestamp
            const tdTime = document.createElement('td');
            tdTime.textContent = row.timestamp;
            
            // Filename
            const tdFile = document.createElement('td');
            tdFile.textContent = row.filename;
            
            // Detections string list
            const tdDet = document.createElement('td');
            if (row.detections.length === 0) {
                tdDet.innerHTML = '<span class="text-muted">None</span>';
            } else {
                const uniqueDets = {};
                row.detections.forEach(d => {
                    uniqueDets[d.class_name] = (uniqueDets[d.class_name] || 0) + 1;
                });
                tdDet.innerHTML = Object.entries(uniqueDets)
                    .map(([name, qty]) => `${name.toUpperCase()} (x${qty})`)
                    .join(', ');
            }
            
            // Risk Badge
            const tdRisk = document.createElement('td');
            const rBadge = document.createElement('span');
            rBadge.className = `badge badge-risk-${row.highest_risk.toLowerCase()}`;
            rBadge.textContent = row.highest_risk;
            tdRisk.appendChild(rBadge);
            
            // Video / Image Type
            const tdType = document.createElement('td');
            tdType.textContent = row.is_video ? '🎥 Video' : '🖼️ Image';
            
            // Action button (inspect thumbnail)
            const tdActions = document.createElement('td');
            const viewBtn = document.createElement('button');
            viewBtn.className = 'log-thumbnail-btn';
            viewBtn.innerHTML = '🔍 Inspect';
            viewBtn.addEventListener('click', () => {
                openLightbox(row.result_url, row.is_video, `${row.filename} - ${row.timestamp}`);
            });
            tdActions.appendChild(viewBtn);
            
            // Alarm trigger button
            const alarmBtn = document.createElement('button');
            alarmBtn.className = 'log-alarm-btn';
            alarmBtn.innerHTML = '🚨 Alarm';
            if (row.highest_risk === 'SAFE') {
                alarmBtn.disabled = true;
            }
            alarmBtn.addEventListener('click', () => {
                const detectionsStr = row.detections.length > 0
                    ? row.detections.map(d => `${d.class_name.toUpperCase()} (${(d.confidence*100).toFixed(1)}%)`).join(', ')
                    : 'Intrusion';
                triggerIntrusionAlert(
                    `🚨 RETROSPECTIVE ALARM: ${row.highest_risk} INTRUSION`,
                    `Historical perimeter breach alert: ${detectionsStr} detected at grid sector. Original timestamp: ${row.timestamp}`,
                    row.highest_risk
                );
            });
            tdActions.appendChild(alarmBtn);
            
            tr.appendChild(tdTime);
            tr.appendChild(tdFile);
            tr.appendChild(tdDet);
            tr.appendChild(tdRisk);
            tr.appendChild(tdType);
            tr.appendChild(tdActions);
            
            logsTableBody.appendChild(tr);
        });
    }

    clearHistoryBtn.addEventListener('click', () => {
        if (!confirm("Are you sure you want to clear all historical log events?")) return;
        
        fetch('/api/clear_history', { method: 'POST' })
        .then(res => res.json())
        .then(() => {
            refreshAnalyticsAndLogs();
        });
    });

    // --- Settings handling ---
    if (settingsForm) {
        settingsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveSettings();
            alert("Settings configuration saved successfully!");
        });
    }

    // --- Lightbox Viewer Modals ---
    function openLightbox(url, isVideo, captionText) {
        if (!mediaModal) return;
        
        // Clear previous source
        modalImage.src = '';
        modalVideo.src = '';
        modalImage.classList.add('hidden');
        modalVideo.classList.add('hidden');
        
        if (isVideo) {
            modalVideo.src = url;
            modalVideo.classList.remove('hidden');
        } else {
            modalImage.src = url;
            modalImage.classList.remove('hidden');
        }
        
        modalCaption.textContent = captionText;
        mediaModal.style.display = 'flex';
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            mediaModal.style.display = 'none';
            modalVideo.pause();
        });
    }

    if (mediaModal) {
        mediaModal.addEventListener('click', (e) => {
            if (e.target === mediaModal) {
                mediaModal.style.display = 'none';
                modalVideo.pause();
            }
        });
    }

    // --- Admin Authentication State & Operations ---
    let isAdminLoggedIn = false;

    function loadAdminSettings() {
        fetch('/api/get_admin_settings')
        .then(res => res.json())
        .then(settings => {
            const telegramEnabled = document.getElementById('telegramEnabled');
            const telegramToken = document.getElementById('telegramToken');
            const telegramChatId = document.getElementById('telegramChatId');
            const whatsappEnabled = document.getElementById('whatsappEnabled');
            const whatsappPhone = document.getElementById('whatsappPhone');
            const whatsappApikey = document.getElementById('whatsappApikey');
            
            if (telegramEnabled) telegramEnabled.checked = settings.telegram_enabled;
            if (telegramToken) telegramToken.value = settings.telegram_token;
            if (telegramChatId) telegramChatId.value = settings.telegram_chat_id;
            if (whatsappEnabled) whatsappEnabled.checked = settings.whatsapp_enabled;
            if (whatsappPhone) whatsappPhone.value = settings.whatsapp_phone;
            if (whatsappApikey) whatsappApikey.value = settings.whatsapp_apikey;
        })
        .catch(err => console.error("Error loading admin settings:", err));
    }

    function updateAdminUI() {
        const adminLoginFormContainer = document.getElementById('adminLoginFormContainer');
        const adminStatusContainer = document.getElementById('adminStatusContainer');
        const dispatchAuthBadge = document.getElementById('dispatchAuthBadge');
        const dispatchLockOverlay = document.getElementById('dispatchLockOverlay');
        const adminAlertsForm = document.getElementById('adminAlertsForm');
        const adminDispatchCard = document.getElementById('adminDispatchCard');
        
        const telegramEnabled = document.getElementById('telegramEnabled');
        const telegramToken = document.getElementById('telegramToken');
        const telegramChatId = document.getElementById('telegramChatId');
        const whatsappEnabled = document.getElementById('whatsappEnabled');
        const whatsappPhone = document.getElementById('whatsappPhone');
        const whatsappApikey = document.getElementById('whatsappApikey');
        const saveAlertsBtn = document.getElementById('saveAlertsBtn');
        
        if (isAdminLoggedIn) {
            if (adminLoginFormContainer) adminLoginFormContainer.classList.add('hidden');
            if (adminStatusContainer) adminStatusContainer.classList.remove('hidden');
            if (adminDispatchCard) adminDispatchCard.classList.add('admin-unlocked');
            if (dispatchAuthBadge) {
                dispatchAuthBadge.className = 'badge badge-risk-safe';
                dispatchAuthBadge.textContent = 'ACTIVE';
            }
            if (dispatchLockOverlay) {
                dispatchLockOverlay.classList.add('hidden');
                dispatchLockOverlay.setAttribute('aria-hidden', 'true');
            }
            if (adminAlertsForm) adminAlertsForm.classList.remove('disabled-state');
            
            if (telegramEnabled) telegramEnabled.removeAttribute('disabled');
            if (telegramToken) telegramToken.removeAttribute('disabled');
            if (telegramChatId) telegramChatId.removeAttribute('disabled');
            if (whatsappEnabled) whatsappEnabled.removeAttribute('disabled');
            if (whatsappPhone) whatsappPhone.removeAttribute('disabled');
            if (whatsappApikey) whatsappApikey.removeAttribute('disabled');
            if (saveAlertsBtn) saveAlertsBtn.removeAttribute('disabled');
            
            loadAdminSettings();
        } else {
            if (adminLoginFormContainer) adminLoginFormContainer.classList.remove('hidden');
            if (adminStatusContainer) adminStatusContainer.classList.add('hidden');
            if (adminDispatchCard) adminDispatchCard.classList.remove('admin-unlocked');
            if (dispatchAuthBadge) {
                dispatchAuthBadge.className = 'badge badge-risk-critical';
                dispatchAuthBadge.textContent = 'LOCKED';
            }
            if (dispatchLockOverlay) {
                dispatchLockOverlay.classList.remove('hidden');
                dispatchLockOverlay.setAttribute('aria-hidden', 'false');
            }
            if (adminAlertsForm) adminAlertsForm.classList.add('disabled-state');
            
            if (telegramEnabled) telegramEnabled.setAttribute('disabled', 'disabled');
            if (telegramToken) telegramToken.setAttribute('disabled', 'disabled');
            if (telegramChatId) telegramChatId.setAttribute('disabled', 'disabled');
            if (whatsappEnabled) whatsappEnabled.setAttribute('disabled', 'disabled');
            if (whatsappPhone) whatsappPhone.setAttribute('disabled', 'disabled');
            if (whatsappApikey) whatsappApikey.setAttribute('disabled', 'disabled');
            if (saveAlertsBtn) saveAlertsBtn.setAttribute('disabled', 'disabled');
        }
    }

    const adminLoginForm = document.getElementById('adminLoginForm');
    if (adminLoginForm) {
        adminLoginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const usernameInput = document.getElementById('adminUsername').value;
            const passwordInput = document.getElementById('adminPassword').value;
            
            fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: usernameInput, password: passwordInput })
            })
            .then(res => {
                if (!res.ok) throw new Error("Authentication failed");
                return res.json();
            })
            .then(data => {
                isAdminLoggedIn = true;
                localStorage.setItem('wildshield_admin_auth', 'true');
                updateAdminUI();
                alert("Admin authenticated successfully!");
            })
            .catch(err => {
                alert("Invalid username or password. Please try again.");
            });
        });
    }

    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', () => {
            isAdminLoggedIn = false;
            localStorage.removeItem('wildshield_admin_auth');
            updateAdminUI();
            alert("Admin signed out successfully.");
        });
    }

    const adminAlertsForm = document.getElementById('adminAlertsForm');
    if (adminAlertsForm) {
        adminAlertsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const telegramEnabled = document.getElementById('telegramEnabled').checked;
            const telegramToken = document.getElementById('telegramToken').value;
            const telegramChatId = document.getElementById('telegramChatId').value;
            const whatsappEnabled = document.getElementById('whatsappEnabled').checked;
            const whatsappPhone = document.getElementById('whatsappPhone').value;
            const whatsappApikey = document.getElementById('whatsappApikey').value;
            
            fetch('/api/save_admin_settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegram_enabled: telegramEnabled,
                    telegram_token: telegramToken,
                    telegram_chat_id: telegramChatId,
                    whatsapp_enabled: whatsappEnabled,
                    whatsapp_phone: whatsappPhone,
                    whatsapp_apikey: whatsappApikey
                })
            })
            .then(res => res.json())
            .then(data => {
                alert("Admin alert integrations updated successfully!");
            })
            .catch(err => {
                alert("Failed to save alert integration settings.");
            });
        });
    }

    // --- Init Actions ---
    loadSettings();
    connectAllCameras();
    isAdminLoggedIn = (localStorage.getItem('wildshield_admin_auth') === 'true');
    updateAdminUI();
    refreshAnalyticsAndLogs();
});
