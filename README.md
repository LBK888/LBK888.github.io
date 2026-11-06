# BK Lab 網站 · lbk888.github.io

國立臺灣海洋大學水產養殖學系 BK Lab 的實驗室首頁，以及實驗室的網頁工具、遊戲與教材。

## 資料夾結構

```
index.html            首頁
404.html              找不到頁面時顯示；也負責把舊網址轉到新位置
tools/                Web Tools  網頁工具
games/                Web Games  網頁遊戲
teaching/             Teaching   教學
research/             Research   研究工具
data/
  catalog.config.json 四個分類的名稱與說明（要新增分類就改這裡）
  catalog.json        工具清單，由程式自動產生，不要手動改
  publications.json   論文清單（新論文加在最上面）
assets/               首頁用的 CSS、JS、圖片
scripts/
  build-catalog.mjs   掃描四個分類資料夾，產生 data/catalog.json
  serve.mjs           本機預覽用的小型伺服器
.github/workflows/catalog.yml   每次上傳後自動執行 build-catalog
```

## 新增一個工具 / 遊戲

1. 在對應的分類資料夾裡建立一個子資料夾，例如 `games/xyz/`，放入 `index.html`。
2. 上傳到 GitHub。完成。

首頁會自動列出它：

- GitHub Action 會在上傳後重新產生 `data/catalog.json`（約 30 秒）。
- 就算 Action 還沒跑完，首頁也會直接向 GitHub 查詢資料夾清單，先把新資料夾列出來，標上「新」。

標題取自 `index.html` 的 `<title>`，說明取自 `<meta name="description">`。也可以直接放一個 `.html` 檔在分類資料夾裡（例如 `games/abc.html`），同樣會被列出。

### 選用：meta.json

想要中英雙語的標題、說明，或指定順序，在資料夾裡放一個 `meta.json`：

```json
{
  "title": "Water Maze",
  "title_zh": "水滴迷宮",
  "description": "Rotate the maze to steer water drops onto the scale.",
  "description_zh": "旋轉迷宮讓水滴落到秤盤上。",
  "needs": "Best on a phone",
  "needs_zh": "建議用手機",
  "lang": "zh,en",
  "order": 4,
  "entry": "index.html",
  "pages": [{ "title": "How it works", "title_zh": "原理說明", "href": "about.html" }],
  "hidden": false
}
```

全部欄位都可省略。`lang` 是頁面語言（`zh`、`en` 或 `zh,en`），`order` 越小越前面，`entry` 是入口頁（預設 `index.html`），`pages` 是同資料夾裡的其他頁面，`hidden: true` 會把它從首頁隱藏（網址仍可開啟）。

### 選用：封面圖

在資料夾裡放 `thumb.webp`（正方形，約 240×240）或 `cover.webp`（約 960×600），首頁會用它當作清單旁的小圖。沒有圖時會顯示一個細胞形狀的色塊。`.jpg`、`.png` 也可以。

## 新增分類

在 `data/catalog.config.json` 的 `categories` 加一筆（`id`、`folder`、中英文名稱與說明），建立同名資料夾即可。同時把新資料夾加進 `.github/workflows/catalog.yml` 的 `paths` 清單。

## 新增論文

在 `data/publications.json` 的 `papers` 最上面加一筆。`featured: true` 會讓該期刊出現在首頁的大方塊上（每個期刊只顯示最新一篇）。

## 本機預覽

```bash
node scripts/build-catalog.mjs
node scripts/serve.mjs
```

然後打開 http://localhost:8080 。直接雙擊 `index.html` 也能看到首頁，但瀏覽器會擋住讀取工具清單，所以要用伺服器開。網址加上 `?lang=en` 或 `?lang=zh` 可指定語言。

## 舊網址

工具在 2026 年 11 月從網站根目錄搬進分類資料夾。舊網址（例如 `/knight/`、`/c/list.html`、`/cellgame.html`）與印出來的 QR Code 仍然可用：`404.html` 會自動轉到新位置，並保留網址後面的參數。對照表在 `404.html` 裡。

## 首頁背景

首頁背景是可互動的 Voronoi 細胞組織（`assets/js/field.js`），以明視野下全胚胎原位雜交的顏色繪製：白色底、NBT/BCIP 藍紫色條帶（像體節時鐘的波一樣移動）、少數 Fast Red 紅色細胞（以側向抑制挑選，彼此不相鄰）、DAB 棕色細胞核。細胞以帶慣性的布朗運動漂移，滑鼠停住時會吸引附近細胞，點一下新增細胞，連點兩下重新產生。首頁上的「聚集／打散／均勻排列」按鈕會改變組織，並即時以 Clark–Evans 比值與六邊形比例量測它的空間分布。

## 圖片來源

首頁使用的公開授權圖片列在 `assets/img/credits.json`，頁尾有完整標示。
