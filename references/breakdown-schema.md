# `breakdown.json` 规范

使用 UTF-8 JSON。所有文件路径优先写绝对路径；相对路径按 `breakdown.json` 所在目录解析。

## 顶层结构

```json
{
  "project": {
    "title": "影片标题",
    "source_path": "/absolute/path/video.mp4",
    "duration_seconds": 51.7,
    "resolution": "1282×720",
    "fps": 30,
    "analysis_note": "按可见剪辑点逐镜拆分；关键帧为代表帧。",
    "core_observation": "一句话概括影片最重要的视觉规律。"
  },
  "shots": [],
  "sections": [],
  "visual_language": {}
}
```

## `shots`

每个镜头使用以下字段：

```json
{
  "shot_id": "S01",
  "start_seconds": 0.0,
  "end_seconds": 3.37,
  "chapter": "序章｜城市登场",
  "keyframe_path": "/absolute/path/keyframes/S01_key.jpg",
  "shot_size": "大全景",
  "composition": "平视；建筑正立面居中，人物位于严格中轴。",
  "movement": "定机；人物由静止到举起双臂。",
  "content": "红裙女子站在建筑中央阳台并举起双臂。",
  "editing": "以小幅人物动作激活静态建筑，建立主角与城市舞台感。",
  "art": "砖红建筑与红裙同色呼应；低饱和暖调。"
}
```

规则：

- `shot_id` 从 `S01` 连续编号。
- `start_seconds` 和 `end_seconds` 使用数字，不使用带单位字符串。
- `keyframe_path` 必须存在。
- `shot_size` 可以写变化，如 `中景→大全景`。
- `movement` 必须先写摄影机运动，再写主体运动。
- `content` 写可见事实；`editing` 写本镜的剪辑或叙事作用。

## `sections`

把镜头归为 4–8 个叙事段落：

```json
{
  "name": "城市登场",
  "start_seconds": 0.0,
  "end_seconds": 9.47,
  "shot_range": "S01–S04",
  "core_content": "阳台主角、片名与旧相册开启旅程。",
  "rhythm": "长镜建立后连续切入物件特写。",
  "narrative_role": "建立人物、年代与翻书寻城的故事装置。"
}
```

## `visual_language`

```json
{
  "summary": "把城市当作一组正面舞台，人物动作推动漫游。",
  "composition": "正面、居中、对称构图反复出现。",
  "camera": "多数镜头采用定机，少量拉远与跟随承担空间揭示。",
  "subject_motion": "人物横穿、转身、骑行和门扇遮挡制造节奏。",
  "color_art": "服装、门窗、道具与侧幅形成章节色。",
  "editing": "硬切、动作匹配、图形匹配与实景遮挡为主。",
  "sound_subtitles": "说明音乐节拍、旁白、环境音和字幕规律；无法确认时留空。"
}
```

## 最小完整示例

```json
{
  "project": {
    "title": "样片",
    "source_path": "/path/sample.mp4",
    "duration_seconds": 6.2,
    "resolution": "1920×1080",
    "fps": 25,
    "analysis_note": "按可见剪辑点拆分。",
    "core_observation": "两个正面定机镜头以人物动作衔接。"
  },
  "shots": [
    {
      "shot_id": "S01",
      "start_seconds": 0.0,
      "end_seconds": 3.1,
      "chapter": "序章｜建立",
      "keyframe_path": "/path/keyframes/S01_key.jpg",
      "shot_size": "全景",
      "composition": "平视居中，门洞形成框中框。",
      "movement": "定机；人物从左侧进入并停在中央。",
      "content": "人物走进门洞中央并看向镜头。",
      "editing": "建立人物和地点。",
      "art": "暖色墙面与蓝色服装形成互补。"
    },
    {
      "shot_id": "S02",
      "start_seconds": 3.1,
      "end_seconds": 6.2,
      "chapter": "结尾｜揭示",
      "keyframe_path": "/path/keyframes/S02_key.jpg",
      "shot_size": "特写",
      "composition": "俯拍居中，道具填满画面。",
      "movement": "定机；双手打开地图。",
      "content": "双手在桌面展开一张城市地图。",
      "editing": "由人物全景切至线索物特写，开启路线。",
      "art": "米白纸张、木桌和红色标记形成暖调。"
    }
  ],
  "sections": [
    {
      "name": "建立与揭示",
      "start_seconds": 0.0,
      "end_seconds": 6.2,
      "shot_range": "S01–S02",
      "core_content": "人物进入地点并打开地图。",
      "rhythm": "全景建立后切入特写。",
      "narrative_role": "建立主角并给出旅行线索。"
    }
  ],
  "visual_language": {
    "summary": "用正面定机和物件特写开启旅行。",
    "composition": "居中和框中框。",
    "camera": "全部定机。",
    "subject_motion": "人物入画与手部动作提供节奏。",
    "color_art": "暖色场景配蓝色服装。",
    "editing": "景别反差硬切。",
    "sound_subtitles": ""
  }
}
```
