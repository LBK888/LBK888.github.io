// 遊戲核心類 - 引用script.js的功能
class WaterMazeGame {
    constructor() {
        this.currentStage = 1;
        this.totalStages = 9;
        this.gameScore = 0;
        this.stageStartTime = 0;
        this.gameTimer = null;
        this.stageTimeLimit = 90; // 3分鐘
        
        // 關卡配置
        this.stageConfigs = [
            // 第1-3關
            { mazeSize: 11, startDroplets: 100, targetWeight: 20, scalePanWidth: 25 },
            { mazeSize: 11, startDroplets:  85, targetWeight: 30, scalePanWidth: 25 },
            { mazeSize: 11, startDroplets:  70, targetWeight: 40, scalePanWidth: 25 },
            // 第4-6關
            { mazeSize: 17, startDroplets: 200, targetWeight: 40, scalePanWidth: 25 },
            { mazeSize: 17, startDroplets: 150, targetWeight: 50, scalePanWidth: 21 },
            { mazeSize: 17, startDroplets: 100, targetWeight: 60, scalePanWidth: 17 },
            // 第7-9關
            { mazeSize: 25, startDroplets: 400, targetWeight: 60, scalePanWidth: 23 },
            { mazeSize: 25, startDroplets: 310, targetWeight: 70, scalePanWidth: 19 },
            { mazeSize: 25, startDroplets: 250, targetWeight: 80, scalePanWidth: 15 }
        ];
        
        // 遊戲狀態
        this.isGameRunning = false;
        this.currentWeight = 0;
        this.rankings = [];
        
        this.init();
    }
    
    init() {
        // 等待script.js載入完成
        if (typeof window.generateMaze === 'undefined' ||
            typeof window.mazeWidth === 'undefined' ||
            typeof window.waterDroplets === 'undefined' ||
            typeof window.world === 'undefined' ||
            typeof window.render === 'undefined') {
            console.log('等待script.js載入完成...');
            setTimeout(() => this.init(), 200);
            return;
        }

        console.log('script.js載入完成，初始化遊戲');
        this.setupEventListeners();
        this.initializeNumberDisplay();

        // 確保遊戲狀態正確初始化
        this.isGameRunning = false;
        this.currentWeight = 0;

        this.showInstructionModal();
    }
    
    initializeNumberDisplay() {
        // 初始化數字顯示
        this.displayNumberAsImages(this.currentStage, 'currentStage');
        this.displayNumberAsImages(this.totalStages, 'totalStages');
        this.displayNumberAsImages(this.gameScore, 'gameScore');
        this.displayTimeAsImages('0.0', 'gameTime');
        this.displayNumberAsImages(this.currentWeight, 'currentWeight');

        // 使用第一關的目標重量
        const firstStageTarget = this.stageConfigs[0].targetWeight;
        this.displayNumberAsImages(firstStageTarget, 'targetWeight');
    }
    
    // 數字圖片顯示功能
    displayNumberAsImages(number, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const numberStr = number.toString();
        container.innerHTML = '';
        
        for (let digit of numberStr) {
            const img = document.createElement('img');
            img.src = `number-${digit}.png`;
            img.className = 'number-img';
            img.alt = digit;
            img.onerror = () => {
                // 如果圖片載入失敗，顯示文字
                const span = document.createElement('span');
                span.textContent = digit;
                span.className = 'number-fallback';
                container.replaceChild(span, img);
            };
            container.appendChild(img);
        }
    }
    
    displayTimeAsImages(timeStr, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = '';
        
        for (let char of timeStr) {
            if (char >= '0' && char <= '9') {
                const img = document.createElement('img');
                img.src = `number-${char}.png`;
                img.className = 'number-img';
                img.alt = char;
                img.onerror = () => {
                    const span = document.createElement('span');
                    span.textContent = char;
                    span.className = 'number-fallback';
                    container.replaceChild(span, img);
                };
                container.appendChild(img);
            } else {
                const span = document.createElement('span');
                span.textContent = char;
                span.className = 'number-symbol';
                container.appendChild(span);
            }
        }
    }
    
    setupEventListeners() {
        document.getElementById('startGameBtn').addEventListener('click', () => {
            this.hideModal('instructionModal');
            this.startGame();
        });
        
        document.getElementById('nextStageBtn').addEventListener('click', () => {
            this.hideModal('stageCompleteModal');
            this.nextStage();
        });
        
        document.getElementById('nextStageFailBtn').addEventListener('click', () => {
            this.hideModal('stageFailModal');
            this.nextStage();
        });
        
        document.getElementById('restartGameBtn').addEventListener('click', () => {
            this.hideModal('gameOverModal');
            this.restartGame();
        });
    }
    
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.style.display = 'block';
        modal.classList.add('show');
    }
    
    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.style.display = 'none';
        modal.classList.remove('show');
    }
    
    showInstructionModal() {
        this.showModal('instructionModal');
    }
    
    startGame() {
        console.log('開始遊戲！');
        this.currentStage = 1;
        this.gameScore = 0;
        this.currentWeight = 0;
        this.isGameRunning = true;
        this.startStage();
    }
    
    startStage() {
        this.stageStartTime = Date.now();
        this.currentWeight = 0;
        this.isGameRunning = true; // 確保遊戲狀態為運行中

        // 重置所有水滴的秤上標記
        if (typeof window.waterDroplets !== 'undefined' && Array.isArray(window.waterDroplets)) {
            window.waterDroplets.forEach(droplet => {
                if (droplet) {
                    droplet.onScale = false;
                    droplet.countedOnScale = false;
                }
            });
        }

        console.log(`開始第 ${this.currentStage} 關，遊戲狀態: ${this.isGameRunning}`);

        // 設定當前關卡配置
        const config = this.stageConfigs[this.currentStage - 1];
        console.log(`關卡配置:`, config);
        
        // 更新全域變數來配置script.js
        try {
            console.log(`設定迷宮大小為: ${config.mazeSize}x${config.mazeSize}`);
            console.log(`設定水滴數量為: ${config.startDroplets}`);

            // 直接設定全域變數
            window.mazeWidth = config.mazeSize;
            window.mazeHeight = config.mazeSize;
            window.waterAmount = config.startDroplets;

            // 也設定script.js的內部變數
            if (typeof mazeWidth !== 'undefined') {
                mazeWidth = config.mazeSize;
                mazeHeight = config.mazeSize;
                waterAmount = config.startDroplets;
            }
        } catch (error) {
            console.error('設定迷宮參數失敗:', error);
        }
        
        // 清理現有的水滴
        try {
            console.log('清理現有水滴...');

            // 使用script.js的清理函數
            if (typeof window.clearAllWater === 'function') {
                window.clearAllWater();
            } else {
                // 手動清理
                if (typeof window.waterDroplets !== 'undefined' && Array.isArray(window.waterDroplets)) {
                    console.log(`清理 ${window.waterDroplets.length} 個水滴`);
                    window.waterDroplets.forEach(droplet => {
                        if (typeof window.world !== 'undefined' && window.world.bodies.includes(droplet)) {
                            Matter.Composite.remove(window.world, droplet);
                        }
                    });
                    window.waterDroplets.length = 0; // 清空陣列
                }
            }

            console.log('水滴清理完成');
        } catch (error) {
            console.error('清理水滴失敗:', error);
        }
        
        // 等待一下再生成迷宮，確保參數已設定
        setTimeout(() => {
            // 生成新迷宮
            try {
                console.log('生成新迷宮...');
                if (typeof window.generateMaze === 'function') {
                    window.generateMaze();

                    // 等待迷宮生成完成後再創建開口和添加水滴
                    setTimeout(() => {
                        if (typeof window.maze !== 'undefined' && Array.isArray(window.maze)) {
                            const middleX = Math.floor(window.mazeWidth / 2);

                            // 根據迷宮大小決定開口寬度
                            let openingWidth = 1; // 預設寬度
                            if (window.mazeWidth >= 25) {
                                openingWidth = 5; // 大迷宮使用5格寬的開口
                            } else if (window.mazeWidth >= 17) {
                                openingWidth = 3; // 中迷宮使用3格寬的開口
                            }

                            // 創建開口（確保是奇數寬度，居中對稱）
                            const halfWidth = Math.floor(openingWidth / 2);
                            for (let i = -halfWidth; i <= halfWidth; i++) {
                                const openX = middleX + i;
                                if (openX >= 0 && openX < window.mazeWidth && window.maze[0]) {
                                    window.maze[0][openX] = 0; // 創建開口
                                }
                            }

                            console.log(`在位置 (0, ${middleX-halfWidth} 到 ${middleX+halfWidth}) 創建寬度 ${openingWidth} 的開口`);

                                // 重新繪製迷宮以反映開口
                                if (typeof window.drawMaze === 'function') {
                                    window.drawMaze();
                                }

                                // 現在添加水滴
                                setTimeout(() => {
                                    if (typeof window.startWaterFlow === 'function') {
                                        console.log('開始添加水滴...');
                                        window.startWaterFlow();
                                    }
                                }, 200);
                            }
                        }, 200);
                }
            } catch (error) {
                console.error('生成迷宮失敗:', error);
            }
        }, 200);
        
        // 水滴將在迷宮生成完成後添加
        
        // 創建秤盤
        this.createScale(config);
        
        // 更新UI
        this.updateUI();

        // 初始化重量顯示
        this.updateWeightDisplay();
        
        // 開始計時
        this.startTimer();
        
        // 延遲開始監控水滴，確保迷宮和水滴都已正確生成
        setTimeout(() => {
            console.log('開始監控水滴...');
            this.startDropletMonitoring();
        }, 1000);
    }
    
    createScale(config) {
        // 清理舊的秤盤物理物件
        if (this.scaleBodies && typeof window.world !== 'undefined') {
            this.scaleBodies.forEach(body => {
                Matter.Composite.remove(window.world, body);
            });
            this.scaleBodies = [];
        }

        // 創建秤盤物理物件（凹槽形狀）
        try {
            if (typeof window.world !== 'undefined' && typeof window.render !== 'undefined') {
                // 計算秤盤位置和大小
                const cellSize = 25; // 迷宮格子大小
                const scaleWidth = config.scalePanWidth * cellSize * 0.8; // 秤盤寬度
                const scaleHeight = cellSize * 0.5; // 秤盤高度為0.5格
                const scaleX = window.render.options.width / 2; // 水平居中
                const scaleY = window.render.options.height - 80; // 距離底部80px
                const wallThickness = 5; // 凹槽壁厚度
                const bottomThickness = wallThickness * 3; // 底座厚度為壁厚的三倍

                console.log(`創建凹槽秤盤: 位置(${scaleX}, ${scaleY}), 大小(${scaleWidth}x${scaleHeight})`);
                console.log(`關卡 ${this.currentStage}: 秤盤寬度配置 = ${config.scalePanWidth}`);

                this.scaleBodies = [];

                // 創建凹槽底部（加厚三倍）
                const bottom = Matter.Bodies.rectangle(scaleX, scaleY + scaleHeight/2, scaleWidth, bottomThickness, {
                    isStatic: true,
                    label: 'ScaleBottom',
                    render: { fillStyle: '#666' }
                });
                this.scaleBodies.push(bottom);

                // 創建凹槽左壁
                const leftWall = Matter.Bodies.rectangle(
                    scaleX - scaleWidth/2 + wallThickness/2,
                    scaleY,
                    wallThickness,
                    scaleHeight,
                    {
                        isStatic: true,
                        label: 'ScaleLeftWall',
                        render: { fillStyle: '#666' }
                    }
                );
                this.scaleBodies.push(leftWall);

                // 創建凹槽右壁
                const rightWall = Matter.Bodies.rectangle(
                    scaleX + scaleWidth/2 - wallThickness/2,
                    scaleY,
                    wallThickness,
                    scaleHeight,
                    {
                        isStatic: true,
                        label: 'ScaleRightWall',
                        render: { fillStyle: '#666' }
                    }
                );
                this.scaleBodies.push(rightWall);

                // 添加所有秤盤部件到物理世界
                Matter.Composite.add(window.world, this.scaleBodies);

                // 儲存秤盤參數供水滴監控使用（擴大檢測範圍以減少漏接）
                const detectionMargin = 10; // 增加檢測邊距
                this.scaleParams = {
                    left: scaleX - scaleWidth/2 - detectionMargin,
                    right: scaleX + scaleWidth/2 + detectionMargin,
                    top: scaleY - scaleHeight/2 - detectionMargin,
                    bottom: scaleY + scaleHeight/2 + detectionMargin
                };

                // 儲存秤盤位置用於顯示重量文字
                this.scaleDisplayParams = {
                    x: scaleX,
                    y: scaleY + scaleHeight/2 + bottomThickness/2 + 20 // 在秤盤底部下方20px
                };

                console.log(`關卡 ${this.currentStage} 凹槽秤盤參數:`, this.scaleParams);
                console.log(`重量顯示位置:`, this.scaleDisplayParams);
            }
        } catch (error) {
            console.error('創建秤盤失敗:', error);
        }
    }
    
    updateUI() {
        this.displayNumberAsImages(this.currentStage, 'currentStage');
        this.displayNumberAsImages(this.gameScore, 'gameScore');
        
        const config = this.stageConfigs[this.currentStage - 1];
        this.displayNumberAsImages(config.targetWeight, 'targetWeight');
        this.displayNumberAsImages(this.currentWeight, 'currentWeight');
    }
    
    startTimer() {
        if (this.gameTimer) {
            clearInterval(this.gameTimer);
        }
        
        this.gameTimer = setInterval(() => {
            const elapsed = (Date.now() - this.stageStartTime) / 1000;
            this.displayTimeAsImages(elapsed.toFixed(1), 'gameTime');
            
            // 檢查是否超時
            if (elapsed >= this.stageTimeLimit) {
                this.stageTimeout();
            }
        }, 100);
    }

    startDropletMonitoring() {
        // 監控水滴掉落
        if (typeof window.engine !== 'undefined') {
            const checkDroplets = () => {
                if (!this.isGameRunning) {
                    console.log('遊戲未運行，停止監控水滴');
                    return;
                }

                try {
                    if (typeof window.waterDroplets !== 'undefined' &&
                        Array.isArray(window.waterDroplets) &&
                        typeof window.render !== 'undefined') {

                        // 移除未使用的變數，現在使用 this.scaleParams

                        // 檢查水滴是否落在秤盤區域並且停留（包括疊高的水滴）
                        for (let i = window.waterDroplets.length - 1; i >= 0; i--) {
                            const droplet = window.waterDroplets[i];
                            if (droplet && droplet.position && !droplet.onScale) {
                                // 檢查是否在秤盤範圍內
                                if (this.scaleParams) {
                                    // 擴大Y軸檢測範圍以包含疊高的水滴
                                    const extendedTop = this.scaleParams.top - 100; // 向上擴展100px檢測疊高水滴

                                    if (droplet.position.x >= this.scaleParams.left &&
                                        droplet.position.x <= this.scaleParams.right &&
                                        droplet.position.y >= extendedTop &&
                                        droplet.position.y <= this.scaleParams.bottom) {

                                        // 檢查水滴是否相對靜止（速度很小）
                                        const velocity = Math.sqrt(droplet.velocity.x * droplet.velocity.x + droplet.velocity.y * droplet.velocity.y);
                                        if (velocity < 1.0) { // 放寬速度閾值，因為疊高的水滴可能有輕微晃動
                                            console.log('水滴停留在秤盤區域！位置:', droplet.position, '速度:', velocity);
                                            this.moveDropletToScale(droplet);
                                        }
                                    }
                                } else {
                                    // 如果沒有秤盤參數，記錄錯誤
                                    console.warn('秤盤參數未設定，無法檢查水滴');
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error('監控水滴失敗:', error);
                }

                requestAnimationFrame(checkDroplets);
            };

            checkDroplets();
        }
    }

    moveDropletToScale(droplet) {
        // 標記水滴已在秤上，不再跟隨迷宮旋轉
        droplet.onScale = true;

        // 確保水滴在秤上保持靜態
        if (typeof Matter !== 'undefined') {
            
            Matter.Body.setVelocity(droplet, { x: 0, y: 0 });
            Matter.Body.setAngularVelocity(droplet, 0);
        }

        // 移除迷宮鎖定標記
        droplet.isLockedToMaze = false;

        // 增加重量計數
        this.currentWeight++;
        console.log(`重量增加到: ${this.currentWeight}`);
        this.updateWeightDisplay();

        // 計算分數
        const elapsedTime = (Date.now() - this.stageStartTime) / 1000;
        let points = 1;
        if (elapsedTime <= 10) points = 4;
        else if (elapsedTime <= 30) points = 3;
        else if (elapsedTime <= 60) points = 2;

        this.gameScore += points;
        this.updateUI();

        // 檢查是否過關
        const targetWeight = this.stageConfigs[this.currentStage - 1].targetWeight;
        console.log(`當前重量: ${this.currentWeight}, 目標重量: ${targetWeight}`);
        if (this.currentWeight >= targetWeight) {
            console.log('達到目標重量，過關！');
            this.stageComplete();
        }
    }

    addDropletToScale(droplet) {
        // 檢查是否已經計算過這個水滴
        if (droplet.countedOnScale) {
            console.log('水滴已經計算過，跳過');
            return;
        }

        console.log('水滴落在秤盤上！');
        droplet.countedOnScale = true;
        this.currentWeight++;
        console.log(`重量增加到: ${this.currentWeight}`);
        this.updateWeightDisplay();

        // 計算分數
        const elapsedTime = (Date.now() - this.stageStartTime) / 1000;
        let points = 1;
        if (elapsedTime <= 10) points = 4;
        else if (elapsedTime <= 30) points = 3;
        else if (elapsedTime <= 60) points = 2;

        this.gameScore += points;
        this.updateUI();

        // 檢查是否過關
        const targetWeight = this.stageConfigs[this.currentStage - 1].targetWeight;
        console.log(`當前重量: ${this.currentWeight}, 目標重量: ${targetWeight}`);
        if (this.currentWeight >= targetWeight) {
            console.log('達到目標重量，過關！');
            this.stageComplete();
        }
    }

    updateWeightDisplay() {
        // 更新HTML中的數字顯示
        this.displayNumberAsImages(this.currentWeight, 'currentWeight');

        // 在canvas上繪製重量文字
        this.drawWeightOnCanvas();
    }

    drawWeightOnCanvas() {
        // 直接使用HTML覆蓋層顯示重量
        this.createHTMLWeightDisplay();
    }

    createHTMLWeightDisplay() {
        // 創建或更新HTML重量顯示覆蓋層
        let weightOverlay = document.getElementById('weightOverlay');
        if (!weightOverlay) {
            weightOverlay = document.createElement('div');
            weightOverlay.id = 'weightOverlay';
            weightOverlay.style.position = 'absolute';
            weightOverlay.style.pointerEvents = 'none';
            weightOverlay.style.color = '#FFC107';
            weightOverlay.style.fontSize = '16px';
            weightOverlay.style.fontFamily = 'Arial';
            weightOverlay.style.fontWeight = 'bold';
            weightOverlay.style.textShadow = '1px 1px 2px black';
            weightOverlay.style.zIndex = '1000';

            // 添加到迷宮區域
            const mazeArea = document.getElementById('mazeArea');
            if (mazeArea) {
                mazeArea.style.position = 'relative';
                mazeArea.appendChild(weightOverlay);
            }
        }

        if (this.scaleDisplayParams) {
            const config = this.stageConfigs[this.currentStage - 1];
            const weightText = `${this.currentWeight}/${config.targetWeight} g`;

            // 計算相對於canvas的位置
            const canvas = window.render.canvas;
            const canvasRect = canvas.getBoundingClientRect();
            const mazeArea = document.getElementById('mazeArea');
            const mazeAreaRect = mazeArea.getBoundingClientRect();

            // 計算canvas在mazeArea中的相對位置
            const canvasOffsetX = canvasRect.left - mazeAreaRect.left;
            const canvasOffsetY = canvasRect.top - mazeAreaRect.top;

            // 將物理座標轉換為canvas像素座標
            const pixelX = this.scaleDisplayParams.x;
            const pixelY = this.scaleDisplayParams.y;

            weightOverlay.textContent = weightText;
            weightOverlay.style.left = (canvasOffsetX + pixelX - 50) + 'px'; // 居中，減去文字寬度的一半
            weightOverlay.style.top = (canvasOffsetY + pixelY) + 'px';
            weightOverlay.style.display = 'block';

            console.log(`重量顯示位置: canvas(${pixelX}, ${pixelY}) -> HTML(${canvasOffsetX + pixelX - 50}, ${canvasOffsetY + pixelY})`);
        }
    }

    stageComplete() {
        console.log('stageComplete被調用！');
        console.log(`當前重量: ${this.currentWeight}, 關卡: ${this.currentStage}`);

        clearInterval(this.gameTimer);
        this.isGameRunning = false;

        // 強制解除拖拽事件，避免下一關開始時迷宮亂轉
        this.forceEndDrag();

        const elapsedTime = (Date.now() - this.stageStartTime) / 1000;
        const stageScore = this.currentWeight * 2; // 簡化計算

        document.getElementById('stageTime').textContent = elapsedTime.toFixed(1);
        document.getElementById('stageScore').textContent = stageScore;
        document.getElementById('totalScore').textContent = this.gameScore;

        this.showModal('stageCompleteModal');
    }

    forceEndDrag() {
        // 強制結束拖拽狀態
        try {
            if (typeof window.isRotating !== 'undefined') {
                window.isRotating = false;
            }

            // 觸發script.js中的拖拽結束邏輯
            if (typeof window.unlockMazeDroplets === 'function') {
                window.unlockMazeDroplets();
            }

            // 模擬mouseup事件來確保拖拽狀態被清除
            const mouseUpEvent = new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            document.dispatchEvent(mouseUpEvent);

            console.log('強制解除拖拽狀態');
        } catch (error) {
            console.error('解除拖拽狀態失敗:', error);
        }
    }

    stageTimeout() {
        clearInterval(this.gameTimer);
        this.isGameRunning = false;

        const stageScore = this.currentWeight * 1; // 超時懲罰
        this.gameScore += stageScore;

        document.getElementById('failScore').textContent = stageScore;

        this.showModal('stageFailModal');
    }

    nextStage() {
        this.currentStage++;

        if (this.currentStage > this.totalStages) {
            this.gameComplete();
        } else {
            this.startStage();
        }
    }

    gameComplete() {
        clearInterval(this.gameTimer);
        this.isGameRunning = false;

        // 添加到排行榜
        this.addToRanking(this.gameScore);

        document.getElementById('finalScore').textContent = this.gameScore;
        this.updateRankingDisplay();

        this.showModal('gameOverModal');
    }

    addToRanking(score) {
        this.rankings.push(score);
        this.rankings.sort((a, b) => b - a);
        this.rankings = this.rankings.slice(0, 5); // 只保留前5名
    }

    updateRankingDisplay() {
        const rankingList = document.getElementById('rankingList');
        rankingList.innerHTML = '';

        this.rankings.forEach((score, index) => {
            const li = document.createElement('li');
            li.textContent = `${index + 1}. ${score} 分`;
            rankingList.appendChild(li);
        });
    }

    restartGame() {
        this.currentStage = 1;
        this.gameScore = 0;
        this.startGame();
    }
}

// 初始化遊戲
document.addEventListener('DOMContentLoaded', () => {
    // 等待一小段時間確保script.js完全載入
    setTimeout(() => {
        new WaterMazeGame();
    }, 500);
});
