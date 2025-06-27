// Matter 模組引入
var Engine = Matter.Engine,
    Render = Matter.Render,
    Runner = Matter.Runner,
    Composites = Matter.Composites,
    Common = Matter.Common,
    MouseConstraint = Matter.MouseConstraint,
    Mouse = Matter.Mouse,
    Composite = Matter.Composite,
    Bodies = Matter.Bodies,
    Body = Matter.Body,
    Constraint = Matter.Constraint;

// 錯誤訊息顯示函數
function showErrorMessage(message) {
    // 移除現有的錯誤訊息
    const existingError = document.getElementById('error-message');
    if (existingError) {
        existingError.remove();
    }

    // 創建新的錯誤訊息元素
    const errorDiv = document.createElement('div');
    errorDiv.id = 'error-message';
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #ff4444;
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        z-index: 1000;
        max-width: 300px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    errorDiv.textContent = message;

    // 添加關閉按鈕
    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = ' ×';
    closeBtn.style.cssText = 'cursor: pointer; margin-left: 10px; font-weight: bold;';
    closeBtn.onclick = function() { errorDiv.remove(); };
    errorDiv.appendChild(closeBtn);

    document.body.appendChild(errorDiv);

    // 5秒後自動移除
    setTimeout(function() {
        if (errorDiv.parentNode) {
            errorDiv.remove();
        }
    }, 5000);
}

// 全域錯誤處理
window.addEventListener('error', function(event) {
    console.error('應用程式錯誤:', event.error);
    if (typeof showErrorMessage === 'function') {
        showErrorMessage('發生未預期的錯誤，請重新整理頁面');
    }
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('未處理的Promise拒絕:', event.reason);
    if (typeof showErrorMessage === 'function') {
        showErrorMessage('操作失敗，請稍後再試');
    }
});

// 安全的事件監聽器包裝函數
function safeEventListener(element, event, handler) {
    if (!element) {
        console.warn('元素不存在，跳過事件監聽器設定');
        return;
    }

    element.addEventListener(event, function(e) {
        try {
            handler(e);
        } catch (error) {
            console.error(`事件處理錯誤 (${event}):`, error);
            if (typeof showErrorMessage === 'function') {
                showErrorMessage('操作失敗，請重試');
            }
        }
    });
}

// 效能監控類
class PerformanceMonitor {
    constructor() {
        this.frameCount = 0;
        this.lastTime = performance.now();
        this.fps = 0;
        this.frameTimeHistory = [];
        this.maxHistoryLength = 60;
        this.createUI();
    }

    createUI() {
        const perfDiv = document.createElement('div');
        perfDiv.id = 'performance-monitor';
        perfDiv.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background-color: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-family: monospace;
            font-size: 12px;
            z-index: 1000;
            min-width: 200px;
        `;

        perfDiv.innerHTML = `
            <div>FPS: <span id="fps-display">0</span></div>
            <div>水滴數量: <span id="droplet-count">0</span></div>
            <div>平均幀時間: <span id="avg-frame-time">0</span>ms</div>
            <div>記憶體使用: <span id="memory-usage">N/A</span></div>
        `;

        document.body.appendChild(perfDiv);
    }

    update() {
        this.frameCount++;
        const currentTime = performance.now();
        const frameTime = currentTime - this.lastTime;

        this.frameTimeHistory.push(frameTime);
        if (this.frameTimeHistory.length > this.maxHistoryLength) {
            this.frameTimeHistory.shift();
        }

        // 每秒更新一次顯示
        if (currentTime - this.lastTime >= 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastTime = currentTime;
            this.updateDisplay();
        }
    }

    updateDisplay() {
        const avgFrameTime = this.frameTimeHistory.reduce((a, b) => a + b, 0) / this.frameTimeHistory.length;
        const dropletCount = waterSimulation ? waterSimulation.getDropletCount() : waterDroplets.length;

        document.getElementById('fps-display').textContent = this.fps;
        document.getElementById('droplet-count').textContent = dropletCount;
        document.getElementById('avg-frame-time').textContent = avgFrameTime.toFixed(2);

        // 記憶體使用情況（如果支援）
        if (performance.memory) {
            const memoryMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
            document.getElementById('memory-usage').textContent = memoryMB + ' MB';
        }

        // 效能警告
        if (this.fps < 30) {
            console.warn('效能警告: FPS低於30');
        }
        if (dropletCount > MAX_WATER_DROPLETS * 0.9) {
            console.warn('效能警告: 水滴數量接近上限');
        }
    }

    getAverageFrameTime() {
        return this.frameTimeHistory.reduce((a, b) => a + b, 0) / this.frameTimeHistory.length;
    }
}

// 迷宮生成器類
class MazeGenerator {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.maze = [];
        this.sets = [];
        this.walls = [];
    }

    generate() {
        try {
            // 確保尺寸為奇數
            if (this.width % 2 === 0) this.width--;
            if (this.height % 2 === 0) this.height--;

            // 驗證尺寸
            if (this.width < 3 || this.height < 3) {
                throw new Error('迷宮尺寸太小，最小為3x3');
            }
            if (this.width > 101 || this.height > 101) {
                throw new Error('迷宮尺寸太大，最大為101x101');
            }

            this.initialize();
            this.kruskal();
            this.addBoundaryWalls();

            return this.maze;
        } catch (error) {
            console.error('迷宮生成失敗:', error);
            throw error;
        }
    }

    initialize() {
        this.maze = Array.from({ length: this.height }, () => Array(this.width).fill(1));
        this.sets = [];
        this.walls = [];

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (x % 2 === 1 && y % 2 === 1) {
                    this.maze[y][x] = 0;
                    this.sets.push([{ x, y }]);

                    if (x + 2 < this.width) {
                        this.walls.push({ x1: x, y1: y, x2: x + 2, y2: y, wallX: x + 1, wallY: y });
                    }
                    if (y + 2 < this.height) {
                        this.walls.push({ x1: x, y1: y, x2: x, y2: y + 2, wallX: x, wallY: y + 1 });
                    }
                }
            }
        }

        this.walls.sort(() => Math.random() - 0.5);
    }

    findSet(cell) {
        return this.sets.find(set => set.some(c => c.x === cell.x && c.y === cell.y));
    }

    union(set1, set2) {
        set1.push(...set2);
        this.sets = this.sets.filter(s => s !== set2);
    }

    kruskal() {
        while (this.walls.length > 0) {
            const wall = this.walls.pop();
            const cell1 = { x: wall.x1, y: wall.y1 };
            const cell2 = { x: wall.x2, y: wall.y2 };
            const set1 = this.findSet(cell1);
            const set2 = this.findSet(cell2);

            if (set1 && set2 && set1 !== set2) {
                this.maze[wall.wallY][wall.wallX] = 0;
                this.union(set1, set2);
            }
        }
    }

    addBoundaryWalls() {
        for (let x = 0; x < this.width; x++) {
            this.maze[0][x] = 1;
            this.maze[this.height - 1][x] = 1;
        }
        for (let y = 0; y < this.height; y++) {
            this.maze[y][0] = 1;
            this.maze[y][this.width - 1] = 1;
        }
    }
}

// 水滴模擬器類
class WaterSimulation {
    constructor(engine, world, render) {
        this.engine = engine;
        this.world = world;
        this.render = render;
        this.droplets = [];
        this.maxDroplets = MAX_WATER_DROPLETS;
    }

    addDroplet(position, radius, properties = {}) {
        try {
            if (this.droplets.length >= this.maxDroplets) {
                console.warn('已達到最大水滴數量限制');
                return null;
            }

            if (!isValidNumber(position.x) || !isValidNumber(position.y)) {
                console.warn('水滴位置無效');
                return null;
            }

            const defaultProperties = {
                density: 0.05,
                friction: 0.1,
                frictionAir: 0.01,
                restitution: 0.2,
                label: "WaterDroplet",
                render: { fillStyle: 'blue' }
            };

            const water = Bodies.circle(
                position.x,
                position.y,
                radius,
                { ...defaultProperties, ...properties }
            );

            Composite.add(this.world, water);
            this.droplets.push(water);

            return water;
        } catch (error) {
            console.error('添加水滴失敗:', error);
            return null;
        }
    }

    cleanup() {
        const canvasHeight = this.render.options.height;
        const canvasWidth = this.render.options.width;
        const safetyMargin = 300; // 使用更大的安全邊界

        let removedCount = 0;

        this.droplets = this.droplets.filter(droplet => {
            // 跳過被鎖定的水滴（旋轉中）
            if (droplet.isLockedToMaze) {
                return true;
            }

            if (!this.world.bodies.includes(droplet)) {
                return false;
            }

            if (!droplet.position || !isValidNumber(droplet.position.x) || !isValidNumber(droplet.position.y)) {
                Composite.remove(this.world, droplet);
                removedCount++;
                return false;
            }

            // 只移除明顯超出安全邊界的水滴
            if (droplet.position.y > canvasHeight + safetyMargin ||
                droplet.position.y < -safetyMargin ||
                droplet.position.x > canvasWidth + safetyMargin ||
                droplet.position.x < -safetyMargin) {
                Composite.remove(this.world, droplet);
                removedCount++;
                return false;
            }

            return true;
        });

        if (removedCount > 0) {
            console.log(`WaterSimulation清理了 ${removedCount} 個水滴`);
        }
    }

    getDropletCount() {
        return this.droplets.length;
    }

    clearAll() {
        this.droplets.forEach(droplet => {
            Composite.remove(this.world, droplet);
        });
        this.droplets = [];
    }
}

// 創建效能監控實例（在遊戲模式下禁用）
let performanceMonitor = null;
if (document.getElementById('mazeCanvas')) {
    // 只在原始頁面顯示效能監控
    performanceMonitor = new PerformanceMonitor();
}

// 創建水滴模擬器實例
let waterSimulation;

// 清除所有水滴
function clearAllWater() {
    try {
        if (waterSimulation) {
            waterSimulation.clearAll();
        }
        waterDroplets = [];
        console.log('所有水滴已清除');
    } catch (error) {
        console.error('清除水滴失敗:', error);
        showErrorMessage('清除水滴失敗');
    }
}

// 重置所有
function resetAll() {
    try {
        clearAllWater();
        generateMaze();
        console.log('應用程式已重置');
    } catch (error) {
        console.error('重置失敗:', error);
        showErrorMessage('重置失敗');
    }
}

// 更新水滴數量
function updateWaterAmount() {
    const slider = document.getElementById('waterAmountSlider');
    const display = document.getElementById('waterAmountValue');

    if (slider && display) {
        waterAmount = parseInt(slider.value);
        display.textContent = waterAmount;
    }
}

// 更新重力
function updateGravity() {
    const slider = document.getElementById('gravitySlider');
    const display = document.getElementById('gravityValue');

    if (slider && display && typeof engine !== 'undefined') {
        const gravityValue = parseFloat(slider.value);
        engine.gravity.y = gravityValue;
        display.textContent = gravityValue.toFixed(1);
    }
}

// 使用安全的事件監聽器（只在元素存在時）
const generateBtn = document.getElementById('generateButton');
const startWaterBtn = document.getElementById('startWaterButton');
const clearWaterBtn = document.getElementById('clearWaterButton');
const resetBtn = document.getElementById('resetButton');
const waterAmountSlider = document.getElementById('waterAmountSlider');
const gravitySlider = document.getElementById('gravitySlider');

if (generateBtn) safeEventListener(generateBtn, 'click', generateMaze);
if (startWaterBtn) safeEventListener(startWaterBtn, 'click', startWaterFlow);
if (clearWaterBtn) safeEventListener(clearWaterBtn, 'click', clearAllWater);
if (resetBtn) safeEventListener(resetBtn, 'click', resetAll);
if (waterAmountSlider) safeEventListener(waterAmountSlider, 'input', updateWaterAmount);
if (gravitySlider) safeEventListener(gravitySlider, 'input', updateGravity);

// 初始化滑桿顯示值（只在元素存在時）
document.addEventListener('DOMContentLoaded', function() {
    if (waterAmountSlider && gravitySlider) {
        updateWaterAmount();
        updateGravity();
    }
});

// 由於本迷宮演算法要求寬高為奇數（偶數會導致外牆異常），
// 因此將 mazeWidth 與 mazeHeight 改為 let，並在 generateMaze() 前自動修正
let mazeWidth = 25;    // 迷宮矩陣的欄數（包含牆與通道格）
let mazeHeight = 25;   // 迷宮矩陣的列數
const cellSize = 25;   // 通道寬度（單位 px）
const wallThickness = 7; // 牆壁厚度固定 7px
const waterRratio = 5; // 水滴大小的半徑設定，與走道的比例，不要小於2否則過大
let waterAmount = 300; //每一批水滴的數量

const corridorWidth = cellSize;  // 通道寬度與 cellSize 相同
let maze = [];
let sets = [];
let walls = [];

// 全域陣列，用來追蹤所有「水顆粒」
let waterDroplets = [];
const MAX_WATER_DROPLETS = 1000; // 最大水滴數量限制

// 將重要變數暴露到window對象，供game.js使用
window.mazeWidth = mazeWidth;
window.mazeHeight = mazeHeight;
window.waterAmount = waterAmount;
window.waterDroplets = waterDroplets;
window.maze = maze;

// 建立物理引擎與渲染器
var engine = Engine.create(),
    world = engine.world;

// 在建立引擎後加入設定 (例如在初始化部分)
// 增加迭代次數以提高碰撞檢測精度
engine.positionIterations = 20;
engine.velocityIterations = 20;

// 設定更嚴格的碰撞檢測
engine.constraintIterations = 3;
engine.enableSleeping = false;  // 禁用睡眠模式，確保所有物體都參與碰撞檢測

// 找到正確的容器和canvas
const gameCanvas = document.getElementById('gameCanvas') || document.getElementById('mazeCanvas');
const mazeArea = document.getElementById('mazeArea');

// 確保canvas有正確的大小
if (gameCanvas) {
    gameCanvas.width = 600;
    gameCanvas.height = 800;
    gameCanvas.style.width = '600px';
    gameCanvas.style.height = '800px';
    console.log('Canvas設定完成:', gameCanvas.width, 'x', gameCanvas.height);
}

var render = Render.create({
    element: mazeArea || document.body,
    canvas: gameCanvas,
    engine: engine,
    options: {
        width: 600,
        height: 800,  // 垂直長方形，適合手機
        showVelocity: false,
        showAngleIndicator: false,
        wireframes: false,
        background: '#000000'  // 黑色背景
    }
});

console.log('啟動渲染器...');
console.log('渲染器設定:', render.options);
Render.run(render);

console.log('啟動物理引擎...');
var runner = Runner.create();
Runner.run(runner, engine);


// 原先加入的其它物體（例如藍色小球群）可按需求保留
/*
var stack = Composites.stack(25, 25, 50, 50, 3, 3, function(x, y) {
    return Bodies.circle(x, y, cellSize / 10, {
        isStatic: false, 
        render: { fillStyle: 'blue', strokeStyle: 'blue', lineWidth: 1 }
    });
});
Composite.add(world, stack);
*/

// 計算迷宮位置（水平居中，垂直在畫面上方2/5處）
const canvasCenter = {
    x: render.options.width / 2,  // 水平居中 (400)
    y: render.options.height * 2 / 5  // 垂直在2/5位置 (480)
};

// 加入滑鼠控制（後續自訂 mazeCompound 旋轉處理）
var mouse = Mouse.create(render.canvas),
    mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: {
            stiffness: 0.2,
            render: { visible: false }
        }
    });
Composite.add(world, mouse);
render.mouse = mouse;

// 過濾水滴拖曳：若點選到 label 為 "WaterDroplet" 的物件，則取消拖曳
Matter.Events.on(mouseConstraint, 'startdrag', function(event) {
    if (event.body && event.body.label === 'WaterDroplet') {
         mouseConstraint.constraint.bodyB = null;
    }
});

// 以下為自訂滑鼠拖曳旋轉 mazeCompound 的變數與事件
let isRotating = false;
let rotationStartAngle = 0;
let rotationStartMouseAngle = 0;
// 新增全域變數，用來記錄拖曳起始時 mazeCompound 的角度（用於水滴同步旋轉）
let mazeRotationStartAngle = 0;

Matter.Events.on(mouseConstraint, 'startdrag', function(event) {
    if (event.body && event.body.label === 'MazeCompound') {
         // 啟動旋轉模式：
         isRotating = true;
         rotationStartAngle = mazeCompound.angle;
         mazeRotationStartAngle = mazeCompound.angle;  // 記錄開始時的 mazeCompound 角度
         let mousePos = event.mouse.position;
         rotationStartMouseAngle = Math.atan2(mousePos.y - canvasCenter.y, mousePos.x - canvasCenter.x);

         // 鎖定水滴移動：只鎖定迷宮範圍內的水滴（排除秤上的水滴）
         waterDroplets.forEach(function(droplet) {
             if (world.bodies.includes(droplet) && !droplet.onScale) {
                 // 檢查水滴是否在迷宮範圍內
                 const mazeSize = mazeWidth * cellSize;
                 const mazeLeft = canvasCenter.x - mazeSize/2;
                 const mazeRight = canvasCenter.x + mazeSize/2;
                 const mazeTop = canvasCenter.y - mazeSize/2;
                 const mazeBottom = canvasCenter.y + mazeSize/2;

                 const isInMaze = droplet.position.x >= mazeLeft &&
                                 droplet.position.x <= mazeRight &&
                                 droplet.position.y >= mazeTop &&
                                 droplet.position.y <= mazeBottom;

                 if (isInMaze) {
                     // 記錄相對於迷宮中心的位置（未旋轉的局部座標）
                     let relativeToMaze = Matter.Vector.sub(droplet.position, mazeCompound.position);
                     droplet.startRelativePos = Matter.Vector.rotate(relativeToMaze, -mazeCompound.angle);

                     // 記錄原始物理屬性
                     droplet.originalVelocity = { x: droplet.velocity.x, y: droplet.velocity.y };
                     droplet.originalAngularVelocity = droplet.angularVelocity;
                     droplet.originalIsStatic = droplet.isStatic;

                     // 設為靜態物體，鎖定移動但保持在物理世界中
                     Body.setVelocity(droplet, { x: 0, y: 0 });
                     Body.setAngularVelocity(droplet, 0);
                     droplet.isLockedToMaze = true;
                 }
             }
         });
         // 取消預設拖曳，避免物件被直接移動
         mouseConstraint.constraint.bodyB = null;
    }

});

Matter.Events.on(mouseConstraint, 'mousemove', function(event) {
    if (!isRotating || !mazeCompound) return;

    try {
        let mousePos = event.mouse.position;
        if (!mousePos || !isValidNumber(mousePos.x) || !isValidNumber(mousePos.y)) return;

        let currentMouseAngle = Math.atan2(mousePos.y - canvasCenter.y, mousePos.x - canvasCenter.x);
        let angleDiff = normalizeAngle(currentMouseAngle - rotationStartMouseAngle);
        let newAngle = normalizeAngle(rotationStartAngle + angleDiff);

        // 設定 mazeCompound 的新角度
        Body.setAngle(mazeCompound, newAngle);

        // 同步所有迷宮內的水滴跟著旋轉（排除秤上的水滴）
        waterDroplets.forEach(function(droplet) {
            if (droplet.isLockedToMaze && droplet.startRelativePos && !droplet.onScale) {
                // 計算新的相對位置（旋轉後的局部座標）
                let rotatedRelativePos = safeVectorOperation(droplet.startRelativePos, function(pos) {
                    return Matter.Vector.rotate(pos, newAngle);
                });

                // 計算新的世界位置
                let newPos = safeVectorOperation(rotatedRelativePos, function(rel) {
                    return Matter.Vector.add(mazeCompound.position, rel);
                });

                if (isValidNumber(newPos.x) && isValidNumber(newPos.y)) {
                    // 使用Body.setPosition來更新靜態物體位置
                    Body.setPosition(droplet, newPos);

                    // 確保速度保持為零
                    Body.setVelocity(droplet, { x: 0, y: 0 });
                    Body.setAngularVelocity(droplet, 0);
                }
            }
        });
    } catch (error) {
        console.warn('旋轉處理錯誤:', error);
        isRotating = false;
    }
});

Matter.Events.on(mouseConstraint, 'enddrag', function(event) {
    if (event.body && event.body.label === 'MazeCompound') {
         isRotating = false;

         // 旋轉結束後恢復水滴的動態屬性（排除秤上的水滴）
         waterDroplets.forEach(function(droplet) {
             if (droplet.isLockedToMaze && !droplet.onScale) {
                 // 恢復為動態物體（但不包括秤上的水滴）

                 // 恢復速度，讓水滴能夠重新受重力影響
                 if (droplet.originalVelocity) {
                     // 可以選擇恢復原始速度或設為零
                     Body.setVelocity(droplet, { x: 0, y: 0 });
                     delete droplet.originalVelocity;
                 } else {
                     Body.setVelocity(droplet, { x: 0, y: 0 });
                 }

                 if (droplet.originalAngularVelocity !== undefined) {
                     Body.setAngularVelocity(droplet, 0);
                     delete droplet.originalAngularVelocity;
                 }

                 // 確保水滴能夠重新受到物理力影響
                 // 給一個微小的擾動，幫助物理引擎重新計算
                 setTimeout(function() {
                     if (!droplet.isStatic && world.bodies.includes(droplet)) {
                         Body.applyForce(droplet, droplet.position, { x: 0, y: 0.001 });
                     }
                 }, 10);

                 // 清除記錄的屬性
                 delete droplet.originalIsStatic;
                 droplet.isLockedToMaze = false;
             }
             delete droplet.startRelativePos;
         });
    }
});

// 為避免拖曳未正確結束，補充 mouseup 事件
document.addEventListener('mouseup', function() {
    if (isRotating) {
        isRotating = false;
        // 恢復所有被鎖定的水滴（排除秤上的水滴）
        waterDroplets.forEach(function(droplet) {
            if (droplet.isLockedToMaze && !droplet.onScale) {
                // 恢復為動態物體（但不包括秤上的水滴）

                // 恢復速度
                if (droplet.originalVelocity) {
                    Body.setVelocity(droplet, { x: 0, y: 0 });
                    delete droplet.originalVelocity;
                } else {
                    Body.setVelocity(droplet, { x: 0, y: 0 });
                }

                if (droplet.originalAngularVelocity !== undefined) {
                    Body.setAngularVelocity(droplet, 0);
                    delete droplet.originalAngularVelocity;
                }

                // 確保水滴能夠重新受到物理力影響
                setTimeout(function() {
                    if (!droplet.isStatic && world.bodies.includes(droplet)) {
                        Body.applyForce(droplet, droplet.position, { x: 0, y: 0.001 });
                    }
                }, 10);

                delete droplet.originalIsStatic;
                droplet.isLockedToMaze = false;
            }
            delete droplet.startRelativePos;
        });
    }
});

// 數值工具函數
function normalizeAngle(angle) {
    // 將角度正規化到 [-π, π] 範圍
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
}

function isValidNumber(value) {
    return typeof value === 'number' && isFinite(value) && !isNaN(value);
}

function safeVectorOperation(vector, operation) {
    try {
        if (!vector || !isValidNumber(vector.x) || !isValidNumber(vector.y)) {
            return { x: 0, y: 0 };
        }
        return operation(vector);
    } catch (error) {
        console.warn('向量運算錯誤:', error);
        return { x: 0, y: 0 };
    }
}



// 調整引擎重力（初始值）
engine.gravity.x = 0;
engine.gravity.y = 1;

// 全域變數，用於迷宮複合身體與網格計算
let mazeCompound = null;
let mazeColPositions = [];  // 各欄位累積 x 位置
let mazeRowPositions = [];  // 各列累積 y 位置
let mazeTotalWidth = 0;
let mazeTotalHeight = 0;
let localMazeCenter = { x: 0, y: 0 }; // 迷宮內部區域中心

/* 迷宮生成函數 */
function generateMaze() {
    try {
        const mazeGenerator = new MazeGenerator(mazeWidth, mazeHeight);
        maze = mazeGenerator.generate();

        // 更新全域變數
        mazeWidth = mazeGenerator.width;
        mazeHeight = mazeGenerator.height;

        // 同步更新window對象
        window.mazeWidth = mazeWidth;
        window.mazeHeight = mazeHeight;
        window.maze = maze;

        drawMaze();
        console.log(`迷宮生成成功: ${mazeWidth}x${mazeHeight}`);

    } catch (error) {
        console.error('迷宮生成失敗:', error);
        showErrorMessage('迷宮生成失敗: ' + error.message);
    }
}

// 舊的迷宮生成函數已移至 MazeGenerator 類別中

/* 畫出迷宮並整合成一個可旋轉的複合物件 */
function drawMaze() {
    console.log('開始繪製迷宮...');
    console.log('迷宮大小:', mazeWidth, 'x', mazeHeight);
    console.log('迷宮陣列:', maze);

    // 若之前已建立 mazeCompound，先移除再重建
    if (mazeCompound) {
        console.log('移除舊的迷宮複合體');
        Composite.remove(world, mazeCompound);
        mazeCompound = null;
    }
    
    // 計算各欄位與列的累積位置：
    // 偶數格：牆，尺寸為 wallThickness；奇數格：通道，尺寸為 corridorWidth
    mazeColPositions = [0];
    for (let x = 0; x < mazeWidth; x++) {
        let dim = (x % 2 === 0) ? wallThickness : corridorWidth;
        mazeColPositions.push(mazeColPositions[x] + dim);
    }
    mazeRowPositions = [0];
    for (let y = 0; y < mazeHeight; y++) {
        let dim = (y % 2 === 0) ? wallThickness : corridorWidth;
        mazeRowPositions.push(mazeRowPositions[y] + dim);
    }
    mazeTotalWidth = mazeColPositions[mazeWidth];
    mazeTotalHeight = mazeRowPositions[mazeHeight];
    // 計算迷宮內部（局部）的中心
    localMazeCenter = { x: mazeTotalWidth / 2, y: mazeTotalHeight / 2 };
    
    // 根據 maze 陣列，建立所有牆壁部件（只有 maze 中值為 1 的格子產生牆）
    let parts = [];
    for (let y = 0; y < mazeHeight; y++) {
        for (let x = 0; x < mazeWidth; x++) {
            if (maze[y][x] === 1) {
                let w = (x % 2 === 0) ? wallThickness : corridorWidth;
                let h = (y % 2 === 0) ? wallThickness : corridorWidth;
                let cx = mazeColPositions[x] + w / 2;
                let cy = mazeRowPositions[y] + h / 2;
                // 轉換成局部座標：以迷宮內部中心為原點
                let localX = cx - localMazeCenter.x;
                let localY = cy - localMazeCenter.y;
                let wallPart = Bodies.rectangle(localX, localY, w, h, {
                    isStatic: true,   // 設定為靜態，避免因碰撞導致牆體位移
                    render: { fillStyle: 'white' }
                });
                parts.push(wallPart);
            }
        }
    }
    
    // 組合所有牆壁成一個複合身體
    mazeCompound = Body.create({
        parts: parts,
        friction: 0.8,
        frictionAir: 0.02,
        restitution: 0.0
    });
    mazeCompound.label = "MazeCompound";
    // 將 mazeCompound 質量設大，以降低外力碰撞影響（但仍能透過自訂旋轉控制修改角度）
    Body.setMass(mazeCompound, 1e8);
    
    // 將 mazeCompound 移至畫布中心（使用 canvasCenter 作為世界位置）
    Body.setPosition(mazeCompound, canvasCenter);
    
    // 加入固定中心的約束，讓迷宮只允許旋轉（中心位置固定）
    let mazePin = Constraint.create({
        pointA: canvasCenter,
        bodyB: mazeCompound,
        pointB: { x: 0, y: 0 },
        stiffness: 1
    });
    Composite.add(world, [mazeCompound, mazePin]);

    console.log('迷宮繪製完成！');
    console.log('迷宮複合體包含', parts.length, '個牆壁部件');
    console.log('迷宮位置:', mazeCompound.position);
    console.log('Canvas中心:', canvasCenter);
}

// 移除自定義渲染函數，因為水滴現在保持在物理引擎中

// 每次引擎更新時，若不在使用者操作拖曳中，則固定 mazeCompound 的位置，並清除角速度
Matter.Events.on(engine, "afterUpdate", function() {
    // 更新效能監控（如果存在）
    if (performanceMonitor) {
        performanceMonitor.update();
    }

    if (mazeCompound && !isRotating) {
         Body.setPosition(mazeCompound, canvasCenter);
         Body.setAngularVelocity(mazeCompound, 0);
    }

    // 定期清理水滴（每60幀檢查一次）
    if (engine.timing.timestamp % (1000/60 * 60) < 16) {
        if (waterSimulation && waterSimulation.getDropletCount() > MAX_WATER_DROPLETS * 0.8) {
            waterSimulation.cleanup();
            // 同步更新全域陣列以保持向後兼容性
            waterDroplets = waterSimulation.droplets;
        }

        // 邊界檢查已合併到waterSimulation.cleanup()中
    }
});

// 移除自定義渲染事件，因為水滴現在保持在物理引擎中

/* 開始水流：調整重力並在迷宮內生成水滴 */
function startWaterFlow() {
    try {
        // 初始化水滴模擬器（如果尚未初始化）
        if (!waterSimulation) {
            waterSimulation = new WaterSimulation(engine, world, render);
        }

        // 檢查是否超過最大水滴數量限制
        if (waterSimulation.getDropletCount() >= MAX_WATER_DROPLETS) {
            console.warn('已達到最大水滴數量限制，請先清理現有水滴');
            showErrorMessage('水滴數量已達上限，請等待自動清理');
            return;
        }

        const actualWaterAmount = Math.min(waterAmount, MAX_WATER_DROPLETS - waterSimulation.getDropletCount());
        for (let i = 0; i < actualWaterAmount; i++) {
            addWater();
        }

        console.log(`添加了 ${actualWaterAmount} 個水滴`);

        // 同步更新window對象
        window.waterDroplets = waterDroplets;

    } catch (error) {
        console.error('開始水流失敗:', error);
        if (typeof showErrorMessage === 'function') {
            showErrorMessage('無法開始水流: ' + error.message);
        }
    }
}

/* 在迷宮中生成一個水滴（水顆粒產生在隨機通道內） */
function addWater() {
    try {
        if (!mazeCompound || !mazeColPositions || !mazeRowPositions ||
            mazeColPositions.length === 0 || mazeRowPositions.length === 0) {
            console.warn('迷宮尚未初始化，無法添加水滴');
            console.log('迷宮狀態:', {
                mazeCompound: !!mazeCompound,
                mazeColPositions: mazeColPositions?.length,
                mazeRowPositions: mazeRowPositions?.length,
                mazeWidth: mazeWidth,
                mazeHeight: mazeHeight
            });
            return;
        }

        if (!waterSimulation) {
            waterSimulation = new WaterSimulation(engine, world, render);
        }

        // 水滴隨機散佈在迷宮的通道中
        let corridorIndicesX = [];
        for (let x = 1; x < mazeWidth; x += 2) corridorIndicesX.push(x);
        let corridorIndicesY = [];
        for (let y = 1; y < mazeHeight; y += 2) corridorIndicesY.push(y);

        if (corridorIndicesX.length === 0 || corridorIndicesY.length === 0) {
            console.warn('沒有可用的通道位置');
            return;
        }

        // 隨機選擇通道位置
        let randX = corridorIndicesX[Math.floor(Math.random() * corridorIndicesX.length)];
        let randY = corridorIndicesY[Math.floor(Math.random() * corridorIndicesY.length)];

        // 確保選擇的位置是通道（值為0）
        let attempts = 0;
        while (maze[randY] && maze[randY][randX] !== 0 && attempts < 10) {
            randX = corridorIndicesX[Math.floor(Math.random() * corridorIndicesX.length)];
            randY = corridorIndicesY[Math.floor(Math.random() * corridorIndicesY.length)];
            attempts++;
        }

        if (attempts >= 10) {
            console.warn('無法找到有效的通道位置');
            return;
        }

        // 計算通道格的中心（相對於迷宮網格）
        let w = corridorWidth;
        let h = corridorWidth;
        let cx = mazeColPositions[randX] + w / 2;
        let cy = mazeRowPositions[randY] + h / 2;

        // 轉換成局部座標（以迷宮內部中心 localMazeCenter 為原點）
        let localPos = { x: cx - localMazeCenter.x, y: cy - localMazeCenter.y };

        // 檢查數值有效性
        if (!isValidNumber(localPos.x) || !isValidNumber(localPos.y)) {
            console.warn('計算出的局部位置無效');
            return;
        }

        // 根據 mazeCompound 當前旋轉角度轉換到世界座標
        let rotated = safeVectorOperation(localPos, function(pos) {
            return Matter.Vector.rotate(pos, mazeCompound.angle);
        });

        let waterPos = {
            x: mazeCompound.position.x + rotated.x,
            y: mazeCompound.position.y + rotated.y
        };

        // 檢查最終位置有效性
        if (!isValidNumber(waterPos.x) || !isValidNumber(waterPos.y)) {
            console.warn('計算出的水滴位置無效');
            return;
        }

        // 使用水滴模擬器添加水滴，設定穩定的物理屬性
        const water = waterSimulation.addDroplet(
            waterPos,
            corridorWidth / waterRratio,
            {
                density: 0.08,          // 稍微增加密度，讓水滴更穩定
                friction: 0.2,          // 適中的摩擦力
                frictionAir: 0.01,
                restitution: 0.3,       // 適中的彈性
                frictionStatic: 0.3,    // 適中的靜摩擦力
                sleepThreshold: 60,     // 設定睡眠閾值
                render: {
                    fillStyle: 'aqua',
                    strokeStyle: 'teal',
                    lineWidth: 2
                }
            }
        );

        if (water) {
            // 保持向後兼容性，同時更新全域陣列
            waterDroplets.push(water);
            // 同步更新window對象
            window.waterDroplets = waterDroplets;
        }

    } catch (error) {
        console.error('添加水滴時發生錯誤:', error);
    }
}



// 暴露函數到window對象供game.js使用
window.generateMaze = generateMaze;
window.startWaterFlow = startWaterFlow;
window.drawMaze = drawMaze;
window.addWater = addWater;
window.clearAllWater = clearAllWater;

// 只在非遊戲模式下自動初始化
if (document.getElementById('mazeCanvas')) {
    // 原始頁面的初始化
    generateMaze()
    startWaterFlow()
}

// 確保所有變數都暴露到window
window.world = world;
window.render = render;
window.engine = engine;