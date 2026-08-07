import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";


function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`未知参数：${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`参数缺少值：${key}`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}


function requireValue(value, label) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`缺少必填字段：${label}`);
  }
  return value;
}


function formatTime(seconds) {
  const centiseconds = Math.max(0, Math.round(Number(seconds) * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const xx = String(cs).padStart(2, "0");
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${mm}:${ss}.${xx}`;
  return `${mm}:${ss}.${xx}`;
}


function mimeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}


async function imageDataUrl(filePath) {
  const bytes = await fs.readFile(filePath);
  return `data:${mimeFor(filePath)};base64,${bytes.toString("base64")}`;
}


function resolveFile(baseDir, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}


function mergeAndWrite(sheet, address, value) {
  const range = sheet.getRange(address);
  range.merge();
  range.values = [[value]];
  return range;
}


const args = parseArgs(process.argv);
const inputPath = path.resolve(requireValue(args.input, "--input"));
const outputPath = path.resolve(requireValue(args.output, "--output"));
const inputDir = path.dirname(inputPath);
const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
const project = payload.project || {};
const shots = payload.shots;

if (!Array.isArray(shots) || shots.length === 0) {
  throw new Error("breakdown.json 的 shots 必须是非空数组。")
}

let previousEnd = -1;
for (let index = 0; index < shots.length; index += 1) {
  const shot = shots[index];
  const expectedId = `S${String(index + 1).padStart(2, "0")}`;
  if (shot.shot_id !== expectedId) {
    throw new Error(`镜号不连续：第 ${index + 1} 行应为 ${expectedId}，实际为 ${shot.shot_id}`);
  }
  const start = Number(shot.start_seconds);
  const end = Number(shot.end_seconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error(`${shot.shot_id} 的起止时间无效。`);
  }
  if (start < previousEnd - 0.001) {
    throw new Error(`${shot.shot_id} 与上一镜时间重叠。`);
  }
  previousEnd = end;
  requireValue(shot.chapter, `${shot.shot_id}.chapter`);
  requireValue(shot.shot_size, `${shot.shot_id}.shot_size`);
  requireValue(shot.composition, `${shot.shot_id}.composition`);
  requireValue(shot.movement, `${shot.shot_id}.movement`);
  requireValue(shot.content, `${shot.shot_id}.content`);
  requireValue(shot.editing, `${shot.shot_id}.editing`);
  requireValue(shot.art, `${shot.shot_id}.art`);
  const keyframe = resolveFile(inputDir, requireValue(shot.keyframe_path, `${shot.shot_id}.keyframe_path`));
  await fs.access(keyframe);
  shot._resolvedKeyframe = keyframe;
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const workbook = Workbook.create();
const main = workbook.worksheets.add("分镜拆解");
const structure = workbook.worksheets.add("结构与语言");
const overview = workbook.worksheets.add("关键帧总览");

const colors = {
  title: "#9E5D52",
  header: "#774A42",
  headerBorder: "#B78F84",
  accent: "#F1D2C6",
  meta: "#F6EEE9",
  bodyA: "#FFFCFA",
  bodyB: "#FAF6F3",
  text: "#3F3734",
  muted: "#715D56",
  border: "#D8C8C0",
};
const groupPalette = ["#F4DDD5", "#F7E8C8", "#DDEBED", "#E8E0F0", "#F5E8B8", "#E1E8D5", "#F4D9E4"];
const font = "微软雅黑";

function styleTitle(range) {
  range.format = {
    fill: colors.title,
    font: { name: font, fontSize: 20, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
}

function styleHeader(range) {
  range.format = {
    fill: colors.header,
    font: { name: font, fontSize: 10, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: colors.headerBorder },
  };
}

function styleBody(range) {
  range.format = {
    font: { name: font, fontSize: 9.5, color: colors.text },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: colors.border },
  };
}

const title = project.title || path.basename(project.source_path || inputPath, path.extname(project.source_path || inputPath));
const duration = Number(project.duration_seconds ?? shots[shots.length - 1].end_seconds);
const resolution = project.resolution || "未提供";
const fps = project.fps ?? "未提供";
const analysisNote = project.analysis_note || "按可见剪辑点逐镜拆分；关键帧为本镜代表帧。";
const coreObservation = project.core_observation || "待补充整体视觉观察。";

main.showGridLines = false;
main.freezePanes.freezeRows(5);
styleTitle(mergeAndWrite(main, "A1:K1", `《${title}》样片分镜拆解`));
main.getRange("A1:K1").format.rowHeightPx = 46;

const metadata = mergeAndWrite(
  main,
  "A2:K2",
  `源片：${project.source_path || "未提供"}｜成片时长 ${duration.toFixed(2)} 秒｜${resolution}｜${fps}fps｜共 ${shots.length} 镜`,
);
metadata.format = {
  fill: colors.meta,
  font: { name: font, fontSize: 10.5, color: "#5B433E" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
metadata.format.rowHeightPx = 32;

const note = mergeAndWrite(main, "A3:K3", `判读口径：${analysisNote}`);
note.format = {
  font: { name: font, fontSize: 10, italic: true, color: colors.muted },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
note.format.rowHeightPx = 42;

const observation = mergeAndWrite(main, "A4:K4", `核心观察：${coreObservation}`);
observation.format = {
  fill: colors.accent,
  font: { name: font, fontSize: 11, bold: true, color: "#7D433B" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
observation.format.rowHeightPx = 38;

main.getRange("A5:K5").values = [[
  "镜号", "时间码", "时长", "章节／功能", "关键帧", "画面景别",
  "机位／构图", "运镜／主体运动", "画面内容", "剪辑／叙事作用", "色彩／美术",
]];
styleHeader(main.getRange("A5:K5"));
main.getRange("A5:K5").format.rowHeightPx = 44;

const mainRows = shots.map((shot) => [
  shot.shot_id,
  `${formatTime(shot.start_seconds)}–${formatTime(shot.end_seconds)}`,
  `${(Number(shot.end_seconds) - Number(shot.start_seconds)).toFixed(2)}s`,
  shot.chapter,
  "",
  shot.shot_size,
  shot.composition,
  shot.movement,
  shot.content,
  shot.editing,
  shot.art,
]);
const mainEndRow = 5 + shots.length;
main.getRange(`A6:K${mainEndRow}`).values = mainRows;
styleBody(main.getRange(`A6:K${mainEndRow}`));
main.getRange(`A6:F${mainEndRow}`).format.horizontalAlignment = "center";
main.getRange(`G6:K${mainEndRow}`).format.horizontalAlignment = "left";

const chapterColors = new Map();
let colorIndex = 0;
for (let index = 0; index < shots.length; index += 1) {
  const row = 6 + index;
  const shot = shots[index];
  const rowFill = index % 2 === 0 ? colors.bodyA : colors.bodyB;
  main.getRange(`A${row}:K${row}`).format.fill = rowFill;
  main.getRange(`A${row}:K${row}`).format.rowHeightPx = 150;
  if (!chapterColors.has(shot.chapter)) {
    chapterColors.set(shot.chapter, groupPalette[colorIndex % groupPalette.length]);
    colorIndex += 1;
  }
  for (const column of ["A", "D"]) {
    main.getRange(`${column}${row}`).format = {
      fill: chapterColors.get(shot.chapter),
      font: { name: font, fontSize: column === "A" ? 11 : 9.5, bold: true, color: "#5C4A44" },
      horizontalAlignment: "center",
      verticalAlignment: "center",
      wrapText: true,
      borders: { preset: "all", style: "thin", color: colors.border },
    };
  }
  const dataUrl = await imageDataUrl(shot._resolvedKeyframe);
  main.images.add({
    dataUrl,
    anchor: {
      from: { row: row - 1, col: 4 },
      extent: { widthPx: 250, heightPx: 141 },
    },
  });
}

const mainWidths = {
  A: 62, B: 150, C: 76, D: 150, E: 285, F: 118,
  G: 250, H: 240, I: 330, J: 285, K: 245,
};
for (const [column, width] of Object.entries(mainWidths)) {
  main.getRange(`${column}1:${column}${mainEndRow}`).format.columnWidthPx = width;
}

function deriveSections() {
  const result = [];
  let startIndex = 0;
  for (let index = 1; index <= shots.length; index += 1) {
    const boundary = index === shots.length || shots[index].chapter !== shots[startIndex].chapter;
    if (!boundary) continue;
    const first = shots[startIndex];
    const last = shots[index - 1];
    result.push({
      name: first.chapter,
      start_seconds: first.start_seconds,
      end_seconds: last.end_seconds,
      shot_range: `${first.shot_id}–${last.shot_id}`,
      core_content: "待补充本段核心内容。",
      rhythm: "待补充本段节奏方式。",
      narrative_role: "待补充本段叙事作用。",
    });
    startIndex = index;
  }
  return result;
}

const sections = Array.isArray(payload.sections) && payload.sections.length > 0 ? payload.sections : deriveSections();
const language = payload.visual_language || {};

structure.showGridLines = false;
structure.freezePanes.freezeRows(5);
styleTitle(mergeAndWrite(structure, "A1:F1", "样片结构与视觉语言"));
structure.getRange("A1:F1").format.rowHeightPx = 46;

const structureMeta = mergeAndWrite(
  structure,
  "A2:F2",
  `${duration.toFixed(2)} 秒｜${shots.length} 镜｜平均镜长 ${(duration / shots.length).toFixed(2)} 秒`,
);
structureMeta.format = {
  fill: colors.meta,
  font: { name: font, fontSize: 10.5, bold: true, color: "#684A43" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
structureMeta.format.rowHeightPx = 32;

const summary = mergeAndWrite(structure, "A3:F3", `一句话概括：${language.summary || coreObservation}`);
summary.format = {
  font: { name: font, fontSize: 11, italic: true, color: "#5B514D" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
summary.format.rowHeightPx = 42;

structure.getRange("A5:F5").values = [["段落", "时间", "镜头", "核心内容", "节奏方式", "叙事作用"]];
styleHeader(structure.getRange("A5:F5"));
structure.getRange("A5:F5").format.rowHeightPx = 42;

const sectionRows = sections.map((section, index) => [
  `${index + 1}. ${section.name || "未命名段落"}`,
  `${formatTime(section.start_seconds)}–${formatTime(section.end_seconds)}`,
  section.shot_range || "",
  section.core_content || "",
  section.rhythm || "",
  section.narrative_role || "",
]);
const sectionEndRow = 5 + sectionRows.length;
structure.getRange(`A6:F${sectionEndRow}`).values = sectionRows;
styleBody(structure.getRange(`A6:F${sectionEndRow}`));
structure.getRange(`A6:C${sectionEndRow}`).format.horizontalAlignment = "center";
for (let row = 6; row <= sectionEndRow; row += 1) {
  structure.getRange(`A${row}:F${row}`).format.fill = row % 2 === 0 ? colors.bodyA : "#F6EFEB";
  structure.getRange(`A${row}:F${row}`).format.rowHeightPx = 72;
}

const visualTitleRow = sectionEndRow + 3;
const visualTitle = mergeAndWrite(structure, `A${visualTitleRow}:F${visualTitleRow}`, "整体视觉语法");
visualTitle.format = {
  fill: colors.title,
  font: { name: font, fontSize: 14, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
visualTitle.format.rowHeightPx = 36;

const languageRows = [
  ["01｜构图", language.composition || "待补充。"],
  ["02｜运镜", language.camera || "待补充。"],
  ["03｜主体运动", language.subject_motion || "待补充。"],
  ["04｜色彩／美术", language.color_art || "待补充。"],
  ["05｜剪辑／转场", language.editing || "待补充。"],
  ["06｜声音／字幕", language.sound_subtitles || "未分析或未提供。"],
];
for (let offset = 0; offset < languageRows.length; offset += 1) {
  const row = visualTitleRow + 1 + offset;
  structure.getRange(`B${row}:F${row}`).merge();
  structure.getRange(`A${row}:F${row}`).values = [[languageRows[offset][0], languageRows[offset][1], null, null, null, null]];
  const fill = offset % 2 === 0 ? "#F8F1ED" : "#F1E5DF";
  structure.getRange(`A${row}`).format = {
    fill,
    font: { name: font, fontSize: 10.5, bold: true, color: "#5A4741" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "all", style: "thin", color: colors.border },
  };
  structure.getRange(`B${row}:F${row}`).format = {
    fill,
    font: { name: font, fontSize: 10.5, color: "#5A4741" },
    horizontalAlignment: "left",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: colors.border },
  };
  structure.getRange(`A${row}:F${row}`).format.rowHeightPx = 48;
}
const structureEndRow = visualTitleRow + languageRows.length;

const structureWidths = { A: 185, B: 175, C: 130, D: 385, E: 330, F: 385 };
for (const [column, width] of Object.entries(structureWidths)) {
  structure.getRange(`${column}1:${column}${structureEndRow}`).format.columnWidthPx = width;
}

overview.showGridLines = false;
overview.freezePanes.freezeRows(2);
styleTitle(mergeAndWrite(overview, "A1:D1", "关键帧总览"));
overview.getRange("A1:D1").format.rowHeightPx = 46;
const overviewMeta = mergeAndWrite(overview, "A2:D2", `《${title}》｜${shots.length} 镜｜${duration.toFixed(2)} 秒`);
overviewMeta.format = {
  fill: colors.meta,
  font: { name: font, fontSize: 10.5, color: "#5B433E" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
overviewMeta.format.rowHeightPx = 32;

const overviewColumns = ["A", "B", "C", "D"];
for (const column of overviewColumns) overview.getRange(`${column}1:${column}${Math.ceil(shots.length / 4) * 2 + 3}`).format.columnWidthPx = 285;

for (let index = 0; index < shots.length; index += 1) {
  const columnIndex = index % 4;
  const labelRow = 4 + Math.floor(index / 4) * 2;
  const imageRow = labelRow + 1;
  const column = overviewColumns[columnIndex];
  const shot = shots[index];
  overview.getRange(`${column}${labelRow}`).values = [[`${shot.shot_id}｜${formatTime(shot.start_seconds)}–${formatTime(shot.end_seconds)}｜${shot.shot_size}`]];
  overview.getRange(`${column}${labelRow}`).format = {
    fill: colors.header,
    font: { name: font, fontSize: 9.5, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: colors.headerBorder },
  };
  overview.getRange(`${column}${labelRow}`).format.rowHeightPx = 30;
  overview.getRange(`${column}${imageRow}`).format = {
    fill: "#F4EFEC",
    borders: { preset: "all", style: "thin", color: colors.border },
  };
  overview.getRange(`${column}${imageRow}`).format.rowHeightPx = 150;
  overview.images.add({
    dataUrl: await imageDataUrl(shot._resolvedKeyframe),
    anchor: {
      from: { row: imageRow - 1, col: columnIndex },
      extent: { widthPx: 250, heightPx: 141 },
    },
  });
}
const overviewEndRow = 5 + (Math.ceil(shots.length / 4) - 1) * 2;

const tableCheck = await workbook.inspect({
  kind: "table",
  sheetId: "分镜拆解",
  range: `A1:K${mainEndRow}`,
  include: "values,formulas",
  tableMaxRows: Math.min(mainEndRow, 20),
  tableMaxCols: 11,
  maxChars: 6000,
});
console.log(tableCheck.ndjson);

const errorCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errorCheck.ndjson);

const previewDir = path.join(
  path.dirname(outputPath),
  `${path.basename(outputPath, path.extname(outputPath))}_预览`,
);
await fs.mkdir(previewDir, { recursive: true });

const previewTargets = [
  ["分镜拆解", `A1:K${mainEndRow}`, "分镜拆解.png"],
  ["结构与语言", `A1:F${structureEndRow}`, "结构与语言.png"],
  ["关键帧总览", `A1:D${overviewEndRow}`, "关键帧总览.png"],
];
const previewPaths = [];
for (const [sheetName, range, fileName] of previewTargets) {
  const rendered = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  const previewPath = path.join(previewDir, fileName);
  await fs.writeFile(previewPath, new Uint8Array(await rendered.arrayBuffer()));
  previewPaths.push(previewPath);
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(JSON.stringify({ output: outputPath, shot_count: shots.length, previews: previewPaths }));
