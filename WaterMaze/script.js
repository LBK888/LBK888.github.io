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

document.getElementById('generateButton').addEventListener('click', generateMaze);
document.getElementById('startWaterButton').addEventListener('click', startWaterFlow);

// 由於本迷宮演算法要求寬高為奇數（偶數會導致外牆異常），
// 因此將 mazeWidth 與 mazeHeight 改為 let，並在 generateMaze() 前自動修正
let mazeWidth = 25;    // 迷宮矩陣的欄數（包含牆與通道格）
let mazeHeight = 25;   // 迷宮矩陣的列數
const cellSize = 25;   // 通道寬度（單位 px）
const wallThickness = 7; // 牆壁厚度固定 5px
const waterRratio = 5; // 水滴大小的半徑設定，與走道的比例，不要小於2否則過大
const waterAmount = 300; //每一批水滴的數量

const corridorWidth = cellSize;  // 通道寬度與 cellSize 相同
let maze = [];
let sets = [];
let walls = [];

// 全域陣列，用來追蹤所有「水顆粒」
let waterDroplets = [];

// 建立物理引擎與渲染器
var engine = Engine.create(),
    world = engine.world;

// 在建立引擎後加入設定 (例如在初始化部分)
engine.positionIterations = 15;
engine.velocityIterations = 15;

var render = Render.create({
    element: document.body,
    canvas: document.getElementById('mazeCanvas'),
    engine: engine,
    options: {
        width: 600,
        height: 800,
        showVelocity: false,
        showAngleIndicator: false,
        wireframes: false
    }
});
Render.run(render);
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

// 計算畫布中心（迷宮將放置在此位置）
const canvasCenter = { 
    x: render.options.width / 2, 
    y: render.options.height / 2 
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
         // 同步水滴：記錄每個水滴相對於畫布中心的初始位移
         waterDroplets.forEach(function(droplet) {
             droplet.startRelativePos = Matter.Vector.sub(droplet.position, canvasCenter);
         });
         // 取消預設拖曳，避免物件被直接移動
         mouseConstraint.constraint.bodyB = null;
    }
    
});

Matter.Events.on(mouseConstraint, 'mousemove', function(event) {
    if (!isRotating) return;
    let mousePos = event.mouse.position;
    let currentMouseAngle = Math.atan2(mousePos.y - canvasCenter.y, mousePos.x - canvasCenter.x);
    let angleDiff = currentMouseAngle - rotationStartMouseAngle;
    let newAngle = rotationStartAngle + angleDiff;
    // 設定 mazeCompound 的新角度
    Body.setAngle(mazeCompound, newAngle);
    // 同步所有水滴跟著旋轉
    let angleOffset = newAngle - mazeRotationStartAngle;
    //console.log("aoff="+angleOffset);
    waterDroplets.forEach(function(droplet) {
        if (droplet.startRelativePos) {
            let newRel = Matter.Vector.rotate(droplet.startRelativePos, angleOffset);
            let newPos = Matter.Vector.add(canvasCenter, newRel);
            Body.setPosition(droplet, newPos);
            // 為避免慣性影響，將該水滴速度歸零
            Body.setVelocity(droplet, { x: 0, y: 0 });
        
        }
    });
});

Matter.Events.on(mouseConstraint, 'enddrag', function(event) {
    if (event.body && event.body.label === 'MazeCompound') {
         isRotating = false;
         // 清除所有水滴記錄的相對位移（旋轉結束後恢復水滴動態）
         waterDroplets.forEach(function(droplet) {
             delete droplet.startRelativePos;
         });
    }
});

// 為避免拖曳未正確結束，補充 mouseup 事件
document.addEventListener('mouseup', function() {
    isRotating = false;
    waterDroplets.forEach(function(droplet) {
         delete droplet.startRelativePos;
    });
});

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
    // 若設定為偶數，則自動修正為最近的奇數
    if (mazeWidth % 2 === 0) { mazeWidth--; }
    if (mazeHeight % 2 === 0) { mazeHeight--; }

    initialize();
    kruskal();
    // 強制外圍邊界補牆，確保上下左右邊界皆為牆
    for (let x = 0; x < mazeWidth; x++) {
        maze[0][x] = 1;
        maze[mazeHeight - 1][x] = 1;
    }
    for (let y = 0; y < mazeHeight; y++) {
        maze[y][0] = 1;
        maze[y][mazeWidth - 1] = 1;
    }
    drawMaze();
}

/* 初始化迷宮：所有位置預設為 1（牆），只將奇數行與奇數列設為通道（0）並加入候選牆 */
function initialize() {
    maze = Array.from({ length: mazeHeight }, () => Array(mazeWidth).fill(1));
    sets = [];
    walls = [];
    for (let y = 0; y < mazeHeight; y++) {
        for (let x = 0; x < mazeWidth; x++) {
            if (x % 2 === 1 && y % 2 === 1) {
                maze[y][x] = 0;
                sets.push([{ x, y }]);
                // 若橫向相鄰則記錄中間牆（x+1, y）
                if (x + 2 < mazeWidth) {
                    walls.push({ x1: x, y1: y, x2: x + 2, y2: y, wallX: x + 1, wallY: y });
                }
                // 若縱向相鄰則記錄牆位置（x, y+1）
                if (y + 2 < mazeHeight) {
                    walls.push({ x1: x, y1: y, x2: x, y2: y + 2, wallX: x, wallY: y + 1 });
                }
            }
        }
    }
    // 隨機排列牆候選順序
    walls.sort(() => Math.random() - 0.5);
}

/* 輔助函數：在集合中尋找 cell 所屬的集合 */
function findSet(cell) {
    return sets.find(set => set.some(c => c.x === cell.x && c.y === cell.y));
}

/* 合併兩個集合 */
function union(set1, set2) {
    set1.push(...set2);
    sets = sets.filter(s => s !== set2);
}

/* Kruskal 演算法：檢查候選牆，若相鄰通道屬於不同集合則移除牆壁，使空間連通 */
function kruskal() {
    while (walls.length > 0) {
        const wall = walls.pop();
        const cell1 = { x: wall.x1, y: wall.y1 };
        const cell2 = { x: wall.x2, y: wall.y2 };
        const set1 = findSet(cell1);
        const set2 = findSet(cell2);
        if (set1 && set2 && set1 !== set2) {
            // 移除兩通道之間的牆
            maze[wall.wallY][wall.wallX] = 0;
            union(set1, set2);
        }
    }
}

/* 畫出迷宮並整合成一個可旋轉的複合物件 */
function drawMaze() {
    // 若之前已建立 mazeCompound，先移除再重建
    if (mazeCompound) {
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
}

// 每次引擎更新時，若不在使用者操作拖曳中，則固定 mazeCompound 的位置，並清除角速度
Matter.Events.on(engine, "afterUpdate", function() {
    if (mazeCompound && !isRotating) {
         Body.setPosition(mazeCompound, canvasCenter);
         Body.setAngularVelocity(mazeCompound, 0);
    }
});

/* 開始水流：調整重力並在迷宮內生成水滴 */
function startWaterFlow() {
    //engine.gravity.y -= 0.1;
    //if (engine.gravity.y < -1) engine.gravity.y = 1;
    for (let i = 0; i < waterAmount; i++) {
        addWater();
    }
}

/* 在迷宮中生成一個水滴（水顆粒產生在隨機通道內） */
function addWater() {
    // 只從奇數索引的通道中選取
    let corridorIndicesX = [];
    for (let x = 1; x < mazeWidth; x += 2) corridorIndicesX.push(x);
    let corridorIndicesY = [];
    for (let y = 1; y < mazeHeight; y += 2) corridorIndicesY.push(y);
    
    let randX = corridorIndicesX[Math.floor(Math.random() * corridorIndicesX.length)];
    let randY = corridorIndicesY[Math.floor(Math.random() * corridorIndicesY.length)];
    
    // 計算通道格的中心（相對於迷宮網格）
    let w = corridorWidth;
    let h = corridorWidth;
    let cx = mazeColPositions[randX] + w / 2;
    let cy = mazeRowPositions[randY] + h / 2;
    // 轉換成局部座標（以迷宮內部中心 localMazeCenter 為原點）
    let localPos = { x: cx - localMazeCenter.x, y: cy - localMazeCenter.y };
    // 根據 mazeCompound 當前旋轉角度轉換到世界座標
    let rotated = Matter.Vector.rotate(localPos, mazeCompound.angle);
    let waterPos = {
        x: mazeCompound.position.x + rotated.x,
        y: mazeCompound.position.y + rotated.y
    };
    
    let water = Bodies.circle(waterPos.x, waterPos.y, corridorWidth / waterRratio, {
        density: 0.05,          // 提高密度，讓水滴較重
        friction: 0.1,
        frictionAir: 0.01,      // 降低空氣阻力，使流動感更明顯
        restitution: 0.2,
        label: "WaterDroplet",
        render: { fillStyle: 'blue' }
    });
    Composite.add(world, water);

    // 在創建水滴時記錄相對位置
    waterDroplets.push(water);
}



// 初始化
generateMaze() 
startWaterFlow()