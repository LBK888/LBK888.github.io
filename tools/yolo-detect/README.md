# YOLO · DETECT

> **即時物體偵測網頁應用 — 手機瀏覽器直接推理**
> Real-time Object Detection Web App — Inference directly in the mobile browser

---

<p align="center">
  <img src="https://img.shields.io/badge/YOLOv8-支援-00D4B4?style=flat-square" />
  <img src="https://img.shields.io/badge/YOLOv5-支援-00D4B4?style=flat-square" />
  <img src="https://img.shields.io/badge/ONNX_Runtime_Web-1.20.1-FFB300?style=flat-square" />
  <img src="https://img.shields.io/badge/後端-不需要-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/授權-MIT-blue?style=flat-square" />
</p>

---

## 目錄 / Table of Contents

1. [專案簡介 / Introduction](#1-專案簡介--introduction)
2. [功能特色 / Features](#2-功能特色--features)
3. [檔案結構 / File Structure](#3-檔案結構--file-structure)
4. [系統需求 / Requirements](#4-系統需求--requirements)
5. [快速開始 / Quick Start](#5-快速開始--quick-start)
6. [訓練自訂模型 / Training a Custom Model](#6-訓練自訂模型--training-a-custom-model)
7. [資料集準備 / Dataset Preparation](#7-資料集準備--dataset-preparation)
8. [模型匯出 / Model Export](#8-模型匯出--model-export)
9. [部署網頁 / Web Deployment](#9-部署網頁--web-deployment)
10. [進階設定 / Advanced Configuration](#10-進階設定--advanced-configuration)
11. [效能調校 / Performance Tuning](#11-效能調校--performance-tuning)
12. [常見問題 / Troubleshooting](#12-常見問題--troubleshooting)
13. [技術架構 / Technical Architecture](#13-技術架構--technical-architecture)

---

## 1. 專案簡介 / Introduction

### 繁體中文

本專案提供一套完整的**端到端解決方案**，讓你能在手機瀏覽器上即時執行 YOLO 物體偵測，無需任何後端伺服器。使用者只需開啟一個 HTML 網頁，即可：

- 自動開啟手機相機並進行即時推理
- 在畫面上疊加偵測框與類別標籤
- 即時顯示偵測到的物體名稱與數量

本專案包含兩個核心檔案：

| 檔案 | 用途 |
|---|---|
| `yolo_detector.html` | 手機前端偵測網頁（開箱即用） |
| `train_yolo.py` | YOLOv8 訓練腳本（含 ONNX 匯出） |

### English

This project provides a complete **end-to-end solution** for running YOLO object detection in real time directly in a mobile browser — no backend server required. Users simply open an HTML page to:

- Automatically activate the camera and start live inference
- Overlay detection boxes and class labels on the video stream
- Display detected object names and counts in real time

The project consists of two core files:

| File | Purpose |
|---|---|
| `yolo_detector.html` | Mobile detection frontend (ready to use) |
| `train_yolo.py` | YOLOv8 training script (with ONNX export) |

---

## 2. 功能特色 / Features

### 繁體中文

**前端網頁 (`yolo_detector.html`)**

- 🎯 **即時偵測**：以 `requestAnimationFrame` 驅動推理迴圈，畫面渲染與推理非同步執行，不互相阻塞
- 📦 **靈活載入模型**：支援本地 `.onnx` 檔案拖曳上傳，或直接輸入遠端 URL 載入
- 🏷️ **自動讀取類別名稱**：從 ONNX 模型 metadata 中解析 `names` 欄位，無需手動指定；若模型不含 metadata 則自動 fallback 到 COCO 80 類
- 📱 **手機優化**：禁止頁面縮放、觸控友善、支援前後鏡頭切換
- ⚙️ **即時調整參數**：Confidence 閾值與 IoU 閾值可在推理過程中動態調整
- 🔢 **FPS 指示器**：即時顯示每秒幀數與每幀推理時間（毫秒），顏色隨速度變化（綠→黃→紅）
- 🧮 **純 JavaScript NMS**：非最大值抑制（Non-Maximum Suppression）完全在前端執行
- 🌐 **WebGL 加速**：優先使用 WebGL 後端，不支援時自動降級至 WASM

**訓練腳本 (`train_yolo.py`)**

- 🏋️ **一鍵訓練**：整合 Ultralytics YOLOv8，設定好 `data.yaml` 即可開始
- 🔄 **格式轉換**：內建 Pascal VOC XML → YOLO、COCO JSON → YOLO 轉換工具
- 📤 **自動匯出**：訓練結束後自動匯出瀏覽器相容的 ONNX 模型
- 🗜️ **INT8 量化**：可選的動態量化，模型體積縮小約 4 倍
- ✅ **匯出驗證**：自動執行 ONNX 格式驗證，確保推理正確性

### English

**Frontend (`yolo_detector.html`)**

- 🎯 **Real-time detection**: Inference loop driven by `requestAnimationFrame`; rendering and inference run asynchronously and never block each other
- 📦 **Flexible model loading**: Drag-and-drop a local `.onnx` file or paste a remote URL
- 🏷️ **Automatic class name extraction**: Parses the `names` field from ONNX model metadata; falls back to COCO 80 classes if metadata is absent
- 📱 **Mobile-optimized**: Pinch-zoom disabled, touch-friendly UI, front/rear camera switching
- ⚙️ **Live parameter tuning**: Confidence threshold and IoU threshold adjustable during inference
- 🔢 **FPS indicator**: Shows frames per second and per-frame inference time (ms) with color coding (green → yellow → red)
- 🧮 **Pure JavaScript NMS**: Non-Maximum Suppression runs entirely in the browser
- 🌐 **WebGL acceleration**: Prefers WebGL backend; automatically falls back to WASM

**Training script (`train_yolo.py`)**

- 🏋️ **One-command training**: Built on Ultralytics YOLOv8; start training with a single command
- 🔄 **Format conversion**: Built-in Pascal VOC XML → YOLO and COCO JSON → YOLO converters
- 📤 **Auto export**: Exports a browser-compatible ONNX model automatically after training
- 🗜️ **INT8 quantization**: Optional dynamic quantization reduces model size by ~4×
- ✅ **Export validation**: Automatically verifies the ONNX model's correctness after export

---

## 3. 檔案結構 / File Structure

```
yolo-detect/
├── yolo_detector.html      # 手機前端偵測網頁 / Mobile detection web page
├── train_yolo.py           # 訓練 + ONNX 匯出腳本 / Training + ONNX export script
├── README.md               # 本文件 / This document
│
├── dataset/                # 訓練資料集 (自行建立) / Training dataset (create manually)
│   ├── data.yaml           # 資料集設定檔 / Dataset config
│   ├── train/
│   │   ├── images/         # 訓練圖片 / Training images (.jpg / .png)
│   │   └── labels/         # YOLO 格式標籤 / YOLO format labels (.txt)
│   └── val/
│       ├── images/         # 驗證圖片 / Validation images
│       └── labels/         # 驗證標籤 / Validation labels
│
└── runs/
    └── train/
        └── yolo_browser/
            └── weights/
                ├── best.pt         # 最佳模型權重 / Best weights
                ├── last.pt         # 最後一個 epoch / Last epoch weights
                └── best.onnx       # 匯出給瀏覽器用的模型 / Browser-ready ONNX model
```

---

## 4. 系統需求 / Requirements

### 前端 / Frontend

| 項目 / Item | 需求 / Requirement |
|---|---|
| 瀏覽器 / Browser | Chrome 90+、Safari 15+、Firefox 90+（支援 WebAssembly） |
| 網路協定 / Protocol | **必須 HTTPS**（相機 API 安全性限制）|
| 相機權限 / Camera | 需允許瀏覽器存取相機 |
| 推薦記憶體 / RAM | 至少 2 GB（用於模型載入與推理） |

> ⚠️ **重要**：瀏覽器的 `getUserMedia()` 相機 API 在 HTTP 下無法使用，本地測試時請使用 `localhost` 或 HTTPS。

### 訓練環境 / Training Environment

| 套件 / Package | 版本 / Version | 用途 / Purpose |
|---|---|---|
| Python | 3.9+ | 執行環境 / Runtime |
| ultralytics | 最新版 / latest | YOLOv8 訓練框架 |
| onnx | 1.14+ | ONNX 模型驗證 |
| onnxruntime | 1.16+ | 推理測試與量化 |
| onnxsim | 最新版 / latest | 計算圖簡化 |
| PyYAML | 6.0+ | 設定檔解析 |

安裝指令 / Installation:

```bash
pip install ultralytics onnx onnxruntime onnxsim pyyaml
```

GPU 加速（可選）/ GPU acceleration (optional):

```bash
# NVIDIA CUDA (需先安裝 CUDA 11.8+)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

---

## 5. 快速開始 / Quick Start

### 方法一：使用預訓練 COCO 模型（最快）/ Method 1: Pre-trained COCO model (fastest)

如果你只想立即測試網頁功能，可以直接下載官方預訓練模型：

If you just want to test the web app right away, download an official pre-trained model:

```bash
# 下載 YOLOv8n ONNX 模型 (COCO 80 類, 約 6 MB)
# Download YOLOv8n ONNX model (COCO 80 classes, ~6 MB)

pip install ultralytics
python -c "
from ultralytics import YOLO
model = YOLO('yolov8n.pt')
model.export(format='onnx', opset=12, simplify=True, dynamic=False)
print('匯出完成 / Export done: yolov8n.onnx')
"
```

然後：
1. 用瀏覽器開啟 `yolo_detector.html`
2. 將 `yolov8n.onnx` 拖曳到頁面
3. 點擊「Load Model & Start Camera」

Then:
1. Open `yolo_detector.html` in a browser
2. Drag `yolov8n.onnx` onto the page
3. Click "Load Model & Start Camera"

---

### 方法二：訓練自訂模型 / Method 2: Train a custom model

```bash
# 1. 準備資料集並建立 data.yaml
#    Prepare dataset and create data.yaml
python train_yolo.py --create-yaml ./dataset cat dog person

# 2. 訓練模型 (100 epochs, batch 16, GPU 0)
#    Train the model
python train_yolo.py \
  --data   dataset/data.yaml \
  --model  yolov8n.pt \
  --epochs 100 \
  --batch  16

# 3. 模型自動匯出至 / Model auto-exported to:
#    runs/train/yolo_browser/weights/best.onnx
```

---

## 6. 訓練自訂模型 / Training a Custom Model

### 訓練指令完整參數 / Full training arguments

```bash
python train_yolo.py \
  --data    dataset/data.yaml \   # 資料集設定檔路徑 / Dataset config path
  --model   yolov8n.pt \          # 基礎模型 / Base model
  --epochs  100 \                 # 訓練回合數 / Training epochs
  --batch   16 \                  # 批次大小 / Batch size
  --imgsz   640 \                 # 輸入圖片大小 / Input image size
  --device  0                     # GPU 編號 / GPU index (or 'cpu')
```

### 模型選擇建議 / Model selection guide

針對手機部署，選擇模型時需在**速度**與**準確度**之間取得平衡：

For mobile deployment, choose a model that balances **speed** and **accuracy**:

| 模型 / Model | ONNX 大小 / Size | mAP50 | 推薦手機 / Recommended for | 推理速度* / Inference speed* |
|---|---|---|---|---|
| **yolov8n** ⭐ | ~6 MB | 37.3% | 所有手機 / All phones | 5–20 FPS |
| yolov8s | ~22 MB | 44.9% | 中高階手機 / Mid-high end | 3–10 FPS |
| yolov8m | ~52 MB | 50.2% | 高階手機 / High-end phones | 1–5 FPS |
| yolov8l | ~83 MB | 52.9% | 平板 / 桌機 / Tablet/Desktop | 0.5–2 FPS |

> ⭐ **推薦**：`yolov8n` 是手機上速度與準確度最均衡的選擇。
> ⭐ **Recommended**: `yolov8n` offers the best speed/accuracy tradeoff on mobile.
>
> *FPS 依裝置的 GPU 與 WebGL 支援程度而定 / FPS depends on device GPU and WebGL support.

---

### 訓練核心超參數說明 / Key hyperparameter reference

以下是 `train_yolo.py` 內的 `CFG` 字典中重要參數的說明：

These are the important parameters in the `CFG` dictionary in `train_yolo.py`:

| 參數 / Parameter | 預設值 / Default | 說明 / Description |
|---|---|---|
| `epochs` | 100 | 訓練總回合數。資料集小時可設 50，大型資料集建議 150–300。 / Total training epochs. Use 50 for small datasets; 150–300 for large ones. |
| `batch` | 16 | 批次大小。GPU VRAM 不足時降低至 8 或 4。 / Batch size. Reduce to 8 or 4 if GPU VRAM is insufficient. |
| `imgsz` | 640 | 訓練輸入解析度。必須與 ONNX 匯出一致。 / Training resolution. Must match ONNX export size. |
| `lr0` | 0.001 | 初始學習率。使用 AdamW 時通常不需調整。 / Initial learning rate. Usually no need to adjust with AdamW. |
| `patience` | 30 | Early stopping 耐心值（幾個 epoch 沒進步就停止）。 / Early stop patience (epochs without improvement before stopping). |
| `mosaic` | 1.0 | Mosaic 增強強度（0~1）。有效提升小物體偵測率。 / Mosaic augmentation strength (0–1). Improves small object detection. |
| `mixup` | 0.1 | MixUp 增強強度。設 0 可關閉。 / MixUp augmentation strength. Set to 0 to disable. |
| `degrees` | 10.0 | 隨機旋轉最大角度（度）。 / Maximum random rotation angle (degrees). |
| `optimizer` | AdamW | 優化器。AdamW 對大多數場景表現穩定。 / Optimizer. AdamW performs well in most scenarios. |

---

## 7. 資料集準備 / Dataset Preparation

### YOLO 標籤格式 / YOLO label format

每張訓練圖片對應一個同名的 `.txt` 標籤檔案，每行代表一個物體：

Each training image has a corresponding `.txt` label file with the same name. Each line represents one object:

```
<class_id> <cx> <cy> <width> <height>
```

所有數值皆為相對於圖片寬高的歸一化值（0~1）：

All values are normalized relative to the image dimensions (0–1):

```
# 範例 / Example: 圖片中一隻貓 (class_id=0)
0 0.512 0.433 0.380 0.521

# 一張圖片有多個物體 / Multiple objects in one image:
0 0.512 0.433 0.380 0.521   ← 貓 / cat
1 0.210 0.680 0.120 0.310   ← 狗 / dog
```

### 建立 data.yaml / Creating data.yaml

**方法一：使用腳本自動建立 / Method 1: Auto-generate with script**

```bash
# 指定資料集路徑與類別名稱
# Specify dataset path and class names
python train_yolo.py --create-yaml ./dataset cat dog person bird
```

**方法二：手動建立 / Method 2: Create manually**

```yaml
# dataset/data.yaml
path:  /absolute/path/to/dataset   # 資料集絕對路徑 / Absolute path to dataset
train: train/images                 # 訓練圖片子路徑 / Relative path to train images
val:   val/images                   # 驗證圖片子路徑 / Relative path to val images

nc: 3                               # 類別數量 / Number of classes
names:
  - cat
  - dog
  - person
```

### 從其他格式轉換 / Convert from other formats

**Pascal VOC XML → YOLO:**

```python
from train_yolo import convert_voc_to_yolo

convert_voc_to_yolo(
    voc_annotation_dir = "annotations/",     # 含 .xml 的資料夾
    output_label_dir   = "dataset/train/labels/",
    class_names        = ["cat", "dog", "person"],
)
```

**COCO JSON → YOLO:**

```python
from train_yolo import convert_coco_to_yolo

class_names = convert_coco_to_yolo(
    coco_json   = "annotations/instances_train2017.json",
    output_dir  = "dataset/train/labels/",
)
# class_names 會自動從 JSON 中提取
# class_names is automatically extracted from the JSON
```

### 標注工具推薦 / Recommended annotation tools

| 工具 / Tool | 支援格式 / Formats | 特色 / Notes |
|---|---|---|
| [Roboflow](https://roboflow.com) | YOLO, COCO, VOC | 線上平台，支援協作 / Online, collaborative |
| [labelImg](https://github.com/HumanSignal/labelImg) | YOLO, VOC | 本地執行，輕量 / Lightweight, local |
| [CVAT](https://cvat.ai) | 多種格式 / Multiple | 功能豐富，支援影片 / Feature-rich, video support |
| [Label Studio](https://labelstud.io) | 多種格式 / Multiple | 開源，可自架 / Open-source, self-hostable |

### 資料集最佳實踐 / Dataset best practices

- **數量**：每個類別至少 **200–500** 張訓練圖片（更多更好）。
  Every class should have at least **200–500** training images (more is better).

- **比例**：訓練集：驗證集 = **8:2**，不要讓驗證集圖片出現在訓練集中。
  Use an **8:2** train/val split; never let validation images appear in training.

- **多樣性**：包含不同光線、角度、背景、遮擋情況的圖片。
  Include images with varied lighting, angles, backgrounds, and occlusions.

- **平衡性**：各類別數量盡量均衡，避免嚴重不平衡。
  Balance class counts as much as possible to avoid severe imbalance.

---

## 8. 模型匯出 / Model Export

### 自動匯出（訓練完成後）/ Auto export (after training)

訓練腳本會在訓練完成後自動執行匯出，無需額外操作。

The training script automatically exports the model after training — no extra steps needed.

### 手動匯出現有模型 / Manually export an existing model

```bash
# 只匯出，不重新訓練
# Export only, skip training
python train_yolo.py --export-only runs/train/yolo_browser/weights/best.pt
```

### 匯出關鍵參數說明 / Export parameter explanation

| 參數 / Parameter | 值 / Value | 說明 / Reason |
|---|---|---|
| `format` | `onnx` | 瀏覽器唯一支援格式 / Only format supported in browsers |
| `opset` | `12` | onnxruntime-web 完整支援 opset 12 / Fully supported by onnxruntime-web |
| `dynamic` | `False` | 固定輸入 shape，避免 shape inference 問題 / Fixed input shape to avoid inference errors |
| `half` | `False` | FP32，onnxruntime-web 對 FP16 支援有限 / FP32; FP16 has limited ort-web support |
| `simplify` | `True` | 合併不必要算子，減少推理延遲 / Merge redundant ops to reduce latency |
| `nms` | `False` | NMS 由前端 JS 執行，效率更佳 / NMS handled by frontend JS for better performance |

### INT8 量化（可選）/ INT8 quantization (optional)

量化可將模型體積縮小約 4 倍，代價是輕微的準確度損失：

Quantization reduces model size ~4× at the cost of slight accuracy loss:

```bash
# 訓練 + 量化 / Train + quantize
python train_yolo.py --data dataset/data.yaml --quantize

# 只對現有 ONNX 模型量化 / Quantize an existing ONNX model only
python -c "
from train_yolo import quantize_int8
quantize_int8('runs/train/yolo_browser/weights/best.onnx')
"
```

量化結果示例 / Example output:

```
原始 / Original : 6.24 MB
量化後 / Quantized: 1.73 MB  (72.3% 縮減 / reduction)
```

> 💡 **建議**：先用 FP32 模型測試偵測效果，滿意後再嘗試量化版本。
> **Tip**: Test with the FP32 model first; switch to the quantized version only if FP32 performance is acceptable.

---

## 9. 部署網頁 / Web Deployment

### 本地測試（電腦）/ Local testing (desktop)

```bash
# Python 內建 HTTP 伺服器 (localhost 視為安全來源，相機 API 可用)
# Python built-in server (localhost is treated as a secure origin)
python -m http.server 8000

# 開啟瀏覽器 / Open browser:
# http://localhost:8000/yolo_detector.html
```

### 手機測試（需 HTTPS）/ Mobile testing (requires HTTPS)

手機瀏覽器的相機 API 只在 HTTPS 下可用。以下是幾種快速部署方式：

The camera API in mobile browsers only works over HTTPS. Here are several quick deployment options:

**方法一：ngrok（最快，適合測試）/ Method 1: ngrok (fastest, for testing)**

```bash
# 安裝 ngrok 後執行 / After installing ngrok:
python -m http.server 8000
ngrok http 8000
# ngrok 提供的 HTTPS URL 直接在手機開啟
# Open the ngrok HTTPS URL on your phone
```

**方法二：GitHub Pages（免費靜態託管）/ Method 2: GitHub Pages (free static hosting)**

```bash
# 建立 GitHub repository 並上傳檔案
# Create a GitHub repository and upload files
# 於 Settings → Pages 啟用 GitHub Pages
# Enable GitHub Pages in Settings → Pages

# 存取網址格式 / Access URL:
# https://<username>.github.io/<repo>/yolo_detector.html
```

**方法三：Cloudflare Tunnel / Method 3: Cloudflare Tunnel**

```bash
# 安裝 cloudflared 後執行
# After installing cloudflared:
python -m http.server 8000
cloudflared tunnel --url http://localhost:8000
```

**方法四：Vercel / Netlify（正式部署）/ Method 4: Vercel / Netlify (production)**

只需將 `yolo_detector.html` 和 `.onnx` 模型上傳至專案根目錄即可一鍵部署。

Simply upload `yolo_detector.html` and the `.onnx` model to the project root and deploy with one click.

---

## 10. 進階設定 / Advanced Configuration

### 在網頁中調整偵測參數 / Adjusting detection parameters in the web app

點擊右上角的 **⚙** 按鈕開啟設定面板：

Tap the **⚙** button in the top-right corner to open the settings panel:

| 設定 / Setting | 預設值 / Default | 說明 / Description |
|---|---|---|
| Confidence Threshold | 0.30 | 低於此分數的偵測結果會被過濾。調高可減少誤判，調低可偵測到更多物體。/ Detections below this score are filtered out. Raise to reduce false positives; lower to detect more objects. |
| IoU Threshold (NMS) | 0.45 | 非最大值抑制的重疊閾值。調低可減少重複框，調高可保留更多重疊框。/ Overlap threshold for NMS. Lower to reduce duplicate boxes; raise to keep more overlapping boxes. |
| Mirror Front Camera | 開 / On | 前鏡頭畫面水平翻轉，使其像鏡子一樣自然。/ Flip front camera horizontally for a natural mirror view. |

### 在訓練腳本中自訂超參數 / Customizing hyperparameters in the training script

直接修改 `train_yolo.py` 頂部的 `CFG` 字典：

Edit the `CFG` dictionary at the top of `train_yolo.py`:

```python
CFG = {
    "model":   "yolov8n.pt",   # 改為 yolov8s.pt 提升準確度
    "data":    "dataset/data.yaml",
    "epochs":  150,             # 增加 epoch 提升收斂
    "batch":   8,               # 降低 batch 以適應低 VRAM GPU
    "imgsz":   640,
    "device":  0,

    # 資料增強 / Augmentation
    "mosaic":  1.0,
    "mixup":   0.2,             # 增加 MixUp 強度
    "degrees": 15.0,            # 允許更大角度旋轉

    # 學習率 / Learning rate
    "lr0":     0.001,
    "lrf":     0.01,

    # 量化設定 / Export
    "export_opset":    12,
    "export_simplify": True,
}
```

---

## 11. 效能調校 / Performance Tuning

### 提升推理速度 / Improving inference speed

| 方法 / Method | 效果 / Effect | 代價 / Trade-off |
|---|---|---|
| 使用 yolov8n / Use yolov8n | +++ 速度 / Speed | − 準確度 / Accuracy |
| INT8 量化 / INT8 quantization | ++ 速度 / Speed | − 準確度 / Accuracy |
| 提高 Confidence 閾值 / Raise confidence threshold | + 速度（減少 NMS 計算）/ Speed | − 偵測數 / Detections |
| 降低輸入解析度 (imgsz=416) / Reduce input resolution | ++ 速度 / Speed | − 準確度（尤其小物體）/ Accuracy (esp. small objects) |

> ⚠️ 注意：網頁前端固定使用 640×640 輸入，若要改變解析度須同時調整訓練的 `imgsz` 與前端 `MODEL_SIZE` 常數。
>
> Note: The web frontend uses a fixed 640×640 input. To change resolution, update both the training `imgsz` and the `MODEL_SIZE` constant in the HTML.

### 影響手機推理速度的因素 / Factors affecting mobile inference speed

- **WebGL 支援**：若瀏覽器開啟 WebGL 加速，速度可提升 3–8 倍。
  **WebGL support**: WebGL acceleration improves speed 3–8× if available in the browser.

- **記憶體限制**：手機記憶體不足時，瀏覽器可能終止分頁。建議使用 yolov8n（6 MB）。
  **Memory limit**: Insufficient phone RAM may cause the browser tab to crash. Stick to yolov8n (6 MB) on constrained devices.

- **散熱節流**：長時間推理可能觸發手機散熱限制，FPS 會逐漸下降。
  **Thermal throttling**: Prolonged inference can trigger thermal throttling, causing FPS to gradually drop.

- **後台分頁**：確保網頁在前景執行，後台分頁會被瀏覽器暫停。
  **Background tab**: Keep the page in the foreground; browsers suspend background tabs.

---

## 12. 常見問題 / Troubleshooting

### Q1: 網頁無法存取相機 / Camera access denied

**原因 / Cause**：瀏覽器安全政策要求相機 API 必須在 HTTPS 或 localhost 下才能使用。

**解決方法 / Solution**：
```
✓ 使用 localhost (http://localhost:8000) 本地測試
✓ 部署至 HTTPS 伺服器 (GitHub Pages / Vercel / ngrok)
✗ 直接開啟 file:// 路徑的 HTML 檔案（相機不可用）
```

The camera API requires HTTPS or `localhost`. Use a local server or deploy to HTTPS.

---

### Q2: 模型載入失敗 / Model fails to load

**可能原因 / Possible causes**：
- ONNX opset 版本過高（需 ≤ 12）/ ONNX opset too high (must be ≤ 12)
- 模型使用了 onnxruntime-web 不支援的算子 / Model uses unsupported operators
- 跨域（CORS）問題導致 URL 載入失敗 / CORS issue when loading from URL

**解決方法 / Solution**：
```bash
# 重新匯出，確保 opset=12
# Re-export with opset=12
python train_yolo.py --export-only best.pt

# 如果是 CORS 問題，改用本地檔案拖曳
# If CORS issue, use local file drag-and-drop instead
```

---

### Q3: 偵測結果全是亂框 / Detection boxes are all wrong

**可能原因 / Possible causes**：
- 訓練資料不足（每類別 < 100 張）/ Too few training images (< 100 per class)
- 標籤格式錯誤（座標未歸一化）/ Wrong label format (coordinates not normalized)
- Confidence 閾值設太低 / Confidence threshold set too low

**解決方法 / Solution**：
```
1. 提高 Confidence 閾值至 0.5 以上進行測試
   Raise confidence threshold to 0.5+ for testing
2. 驗證標籤：cx, cy, w, h 應在 0~1 之間
   Verify labels: cx, cy, w, h should be between 0 and 1
3. 增加訓練資料量並重新訓練
   Add more training data and retrain
```

---

### Q4: FPS 很低（< 3）/ Very low FPS (< 3)

**解決方法 / Solution**：
```
1. 改用 yolov8n 模型 / Switch to yolov8n model
2. 開啟瀏覽器 WebGL 支援 / Enable WebGL in browser settings
3. 嘗試 INT8 量化版本 / Try the INT8 quantized version
4. 關閉其他耗電 App / Close other battery-intensive apps
5. 確認手機未過熱觸發節流 / Ensure phone is not thermally throttling
```

---

### Q5: 類別名稱顯示為 cls_0, cls_1... / Class names show as cls_0, cls_1...

**原因 / Cause**：ONNX 模型 metadata 中找不到類別名稱（通常發生在非 Ultralytics 匯出的模型）。

**解決方法 / Solution**：
```bash
# 使用本腳本重新匯出，Ultralytics 會自動寫入 metadata
# Re-export using this script; Ultralytics writes metadata automatically
python train_yolo.py --export-only your_model.pt
```

If the model was not exported with Ultralytics, class names fall back to COCO 80 labels or show as `cls_N`.

---

## 13. 技術架構 / Technical Architecture

### 前端推理流程 / Frontend inference pipeline

```
手機相機 / Camera
    │
    ▼ 每幀 / Each frame
┌─────────────────────────────────────┐
│  1. Letterbox Resize (640×640)      │
│     保持長寬比，黑邊填充              │
│     Maintain aspect ratio, pad black │
├─────────────────────────────────────┤
│  2. RGB 正規化 / RGB normalization  │
│     Pixel [0,255] → Float32 [0,1]   │
│     NHWC → NCHW tensor              │
├─────────────────────────────────────┤
│  3. ONNX Runtime Web 推理           │
│     WebGL EP → WASM EP (fallback)   │
├─────────────────────────────────────┤
│  4. 輸出解碼 / Output decoding      │
│     YOLOv8: [1, 4+nc, 8400]         │
│     YOLOv5: [1, 25200, 5+nc]        │
├─────────────────────────────────────┤
│  5. Non-Maximum Suppression (JS)    │
│     Confidence filter → IoU filter  │
├─────────────────────────────────────┤
│  6. Canvas 座標反投影 / Unproject   │
│     Model coords → Canvas coords    │
└─────────────────────────────────────┘
    │
    ▼
Canvas 渲染：框線 + 標籤 + HUD
Canvas render: boxes + labels + HUD
```

### 核心技術 / Core technologies

| 技術 / Technology | 版本 / Version | 用途 / Purpose |
|---|---|---|
| ONNX Runtime Web | 1.20.1 | 瀏覽器端神經網路推理 / In-browser neural network inference |
| WebGL | — | GPU 加速計算 / GPU-accelerated compute |
| WebAssembly | — | WebGL 不可用時的 fallback / Fallback when WebGL unavailable |
| MediaDevices API | — | 相機存取 / Camera access |
| Canvas 2D API | — | 畫面渲染 / Frame rendering |
| Ultralytics YOLOv8 | latest | 模型訓練框架 / Model training framework |
| ONNX | 1.14+ | 模型格式與驗證 / Model format and validation |

---

## 授權 / License

MIT License — 可自由使用於商業與非商業用途。
MIT License — Free for commercial and non-commercial use.

---

## 貢獻 / Contributing

歡迎提交 Issue 或 Pull Request！
Issues and Pull Requests are welcome!

---

<p align="center">Made with ❤️ — YOLO · DETECT</p>
