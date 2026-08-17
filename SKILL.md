---
name: video-storyboard-breakdown
description: Analyze local reference or sample videos shot by shot, detect visible edits, extract representative keyframes, distinguish camera movement from subject movement, and generate a professional storyboard breakdown Excel. Use when the user provides an MP4, MOV, MKV, M4V, AVI, or WebM and asks for 拉片、拆片、样片拆解、逐镜分析、分镜表、镜头表、关键帧、景别、机位、构图、运镜、剪辑节奏或视觉语言总结。
---

# 视频分镜拉片拆解

把样片拆成可复查、可复用的导演级分镜表。最终交付一个带关键帧的 `.xlsx`，并保留逐镜截图与分析数据供复核。

## 核心原则

- 按可见剪辑点拆镜，不按旁白句子或动作段落臆断切点。
- 把“摄影机运动”和“主体运动”分开记录。人物向右走不等于镜头右移。
- 把自动场景检测只当作候选切点；必须查看每镜 start / mid / end 三帧后修正。
- 关键帧选择最能代表本镜构图、主体和色彩的帧，避开转场、眨眼和严重运动模糊。
- 关键帧必须保持原片的画幅比例，不裁切、不拉伸；原片为 16:9、9:16 或其他比例时，Excel 中的关键帧列和关键帧总览都使用相同比例。
- 画面内容先客观描述，再解释剪辑或叙事作用。
- 不覆盖源视频。把所有中间产物写入独立输出目录。

## 标准交付

生成一个工作簿，至少包含：

1. `分镜拆解`：镜号、时间码、时长、章节／功能、关键帧、画面景别、机位／构图、运镜／主体运动、画面内容、剪辑／叙事作用、色彩／美术。
2. `结构与语言`：段落结构、节奏方式、叙事作用，以及构图、运镜、主体运动、色彩、美术、转场、声音与字幕规律。
3. `关键帧总览`：全部镜头的代表帧索引。

默认把独立截图目录和 `breakdown.json` 一并保留，但只把 Excel 作为主要交付物。

## 工作流

### 1. 检查输入

- 确认视频路径存在并可读取。
- 使用 `ffprobe` 读取时长、原始宽高、帧率、编码与音轨信息；把原始宽高作为关键帧显示比例的唯一依据。
- 一分钟左右的短片直接完整处理。超过 15 分钟时按 5–10 分钟章节分段检测，再合并为全局时间码。
- 用户未指定检测灵敏度时使用默认阈值；不要因可自动推断的参数停下来提问。

### 2. 提取候选镜头与关键帧

运行：

```bash
python "$SKILL_DIR/scripts/extract_shots.py" "/absolute/path/video.mp4" \
  --output-dir "/absolute/path/output"
```

脚本输出：

- `analysis.json`
- `keyframes/S01_key.jpg` 等代表帧
- `analysis_frames/S01_start.jpg` 与 `S01_end.jpg`
- `contact_sheets/关键帧总览.jpg`
- `contact_sheets/三帧对照_*.jpg`

默认阈值为 `0.18`。若明显漏切，按 `0.15 → 0.12 → 0.10` 逐步降低；若把闪光、快速运动或镜头抖动误判为切点，按 `0.22 → 0.26 → 0.30` 提高。不要一次大幅改变阈值。

需要人工校正时，把确认后的切点秒数写入 JSON 数组或逐行文本，并重新运行：

```bash
python "$SKILL_DIR/scripts/extract_shots.py" "/absolute/path/video.mp4" \
  --output-dir "/absolute/path/output-corrected" \
  --cuts-file "/absolute/path/cuts.json"
```

### 3. 逐镜判读

先完整阅读 [analysis-rubric.md](references/analysis-rubric.md)，再查看所有三帧对照图。

对每镜依次判断：

1. 镜头边界是否正确。
2. 中段帧是否适合作为关键帧；不合适时从 start / end 或动作峰值附近重截。
3. 景别、机位和构图。
4. 摄影机是否移动；随后单独写主体动作、方向和速度。
5. 客观画面内容。
6. 与前后镜的剪辑关系及本镜叙事功能。
7. 主色、光线、服装、道具、场景材质与图形系统。

对无法从三帧确认的细微运动使用审慎措辞，如“定机或近似定机”“疑似轻微数码推近”。不要伪造精确轨迹。

### 4. 写入结构化分析

完整阅读 [breakdown-schema.md](references/breakdown-schema.md)，把结果保存为 UTF-8 `breakdown.json`。

必须满足：

- `shots` 数量与镜头边界数量一致。
- 每镜 `start_seconds < end_seconds`，且时间顺序不重叠。
- 每镜关键帧路径真实存在。
- `movement` 同时交代摄影机运动与主体运动；无运动时明确写“定机”。
- `content` 不重复 `editing`；前者描述发生什么，后者解释为何这样剪。

### 5. 生成 Excel

使用工作区依赖加载器取得 Node.js 与 `node_modules` 路径。创建隔离构建目录，把本技能的 `build_storyboard_workbook.mjs` 复制到该目录，并在该目录建立指向加载器 `node_modules` 的符号链接；不要修改依赖目录。

然后运行：

```bash
"$NODE_BIN" "/build/dir/build_storyboard_workbook.mjs" \
  --input "/absolute/path/breakdown.json" \
  --output "/absolute/path/影片名_分镜拆解.xlsx"
```

脚本会嵌入逐镜关键帧、按照原片宽高比例自动计算关键帧列和总览列的图片尺寸、生成三张工作表，并在输出文件旁生成三个版式验证预览 PNG。部分系统预览器不会显示 Excel 浮动图片；此时用提取阶段的联系表检查图像内容，并核对工作簿内嵌图片数量，不要把预览空白误判为图片缺失。

如脚本必须调整，先读取 `spreadsheets:Spreadsheets` 技能并遵循其 `@oai/artifact-tool` 约束；不要改用不一致的临时版式。

### 6. 验证

- 查看三张版式预览，确认标题、表头与文字无裁切、错位或遮挡。
- 用 `contact_sheets` 检查关键帧内容和裁切；若系统预览器不显示 Excel 浮动图片，核对工作簿 `xl/media`、drawing 锚点或工作表内嵌图片数量。
- 检查工作簿中的镜头行数与 `breakdown.json` 一致。
- 检查每镜均嵌入一张关键帧。
- 检查关键帧图片的显示宽高比与原片宽高比一致；禁止使用固定的 16:9 或 9:16 尺寸替代原片比例。
- 扫描 `#REF!`、`#DIV/0!`、`#VALUE!`、`#NAME?`、`#N/A`。
- 对至少三镜回看源视频时间码，确认切点和关键帧准确。
- 若检测结果与肉眼不符，先修正切点再重建；不要只改表格时间码而保留错误截图。

## 特殊情况

- **叠化或淡变**：把转场中点作为剪辑边界，并在剪辑栏标注“叠化／淡变”。
- **闪白、闪黑、灯光突变**：先判断是否属于转场，避免误拆成独立镜头。
- **一镜到底**：不要为了表格丰富度强行拆镜；可在内容栏分动作阶段描述。
- **屏幕录制或动态图形**：按版式／场景状态发生实质变化的节点拆镜，不按每次按钮点击机械拆分。
- **音频很重要**：另行转写或听取声音，并把旁白、环境音、音乐节拍写入结构总结；不要从画面猜台词。
- **检测失败或视频损坏**：报告具体错误并停止，不生成虚假的分镜表。

## 输出回复

先说明已拆出多少镜，再提供 Excel 文件。简要指出最重要的视觉规律，并说明关键帧与分析数据所在目录。不要把技术日志当作交付内容。

## 资源

- `scripts/extract_shots.py`：候选切点检测、三帧与代表帧抽取、联系表生成。
- `scripts/build_storyboard_workbook.mjs`：根据 `breakdown.json` 生成统一格式 Excel。
- `references/analysis-rubric.md`：逐镜判读标准。
- `references/breakdown-schema.md`：结构化分析数据规范。
- `assets/reference.xlsx`：空白版分镜拆解格式参考。
