/**
 * Schedule of Finishes Excel export, driven by the practice's own template
 * (src/assets/templates/sof-corp-int.xlsx = "FORMAT OF SOF FOR CORP. INT").
 *
 * Instead of re-creating the format, the real template is loaded and filled,
 * so column widths, hidden columns, colours, fonts, borders, merged headers,
 * the frozen header, the tab colour, the material lookup lists and the
 * dropdown validations are exactly the template's own.
 *
 * Template layout ("SOF-CORP  INT" sheet):
 *   rows 1-4   title, "SCHEDULE OF FINISHES", grouped column headers (kept)
 *   row 5      floor banner  (A = section letter, B = floor name)   -> style prototype
 *   row 6      room row                                             -> style prototype
 *   row 19     blank bordered row between floors                    -> style prototype
 *   GB:GJ      lookup lists that feed the dropdowns (kept untouched)
 * The template's sample rows are cleared and replaced by the project's rooms.
 */
import type ExcelJS from "exceljs";

export const SOF_SHEET_NAME = "SOF-CORP  INT";

/** First row below the headers. */
const BODY_START_ROW = 5;
/** Template rows whose formatting is reused for each kind of output row. */
const PROTOTYPE_ROWS = { banner: 5, room: 6, gap: 19 } as const;
/** Columns A..BL carry the schedule; GB:GJ (lookup lists) are left alone. */
const LAST_SCHEDULE_COL = 64;

/** Template column numbers, with the header text each sits under. */
export const SOF_COLUMNS = {
  srNo: 1, //          A  Sr.No
  floor: 2, //         B  FLOOR
  name: 3, //          C  SPACE DESCRIPTION
  spaceTag: 4, //      D  SPACE/ROOM TAG
  floorMaterial: 5, // E  FLOORING · Material
  floorSize: 6, //     F  FLOORING · Size
  floorFinish: 7, //   G  FLOORING · Finish
  floorCode: 8, //     H  FLOORING · Code No   (I = Image)
  floorMake: 10, //    J  FLOORING · Make
  floorRate: 11, //    K  FLOORING · Basic Rate
  skirting: 13, //     M  SKIRTING · Material
  skirtingCode: 14, // N  SKIRTING · Code No   (O = Image)
  skirtingMake: 16, // P  SKIRTING · Make
  skirtingRate: 17, // Q  SKIRTING · Basic Rate
  ceiling1: 19, //     S  CEILING · Material 1
  ceiling2: 20, //     T  CEILING · Material 2
  ceilingSize: 21, //  U  CEILING · Size
  ceilingCode: 22, //  V  CEILING · Code No    (W = Image)
  ceilingMake: 24, //  X  CEILING · Make
  remark: 25, //       Y  REMARK
  ceilingRate: 26, //  Z  CEILING · Basic Rate
  wall1: 28, //        AB WALL 1 · Material 1  (wall columns are hidden in the template)
  wall2: 29, //        AC WALL 1 · Material 2
  wall3: 30, //        AD WALL 1 · Material 3
} as const;

export interface SofRoom {
  name: string;
  space_tag: string | null;
  floor_finish: string | null;
  flooring_size: string | null;
  flooring_finish: string | null;
  flooring_code: string | null;
  flooring_make: string | null;
  flooring_rate: string | null;
  skirting: string | null;
  skirting_code: string | null;
  skirting_make: string | null;
  skirting_rate: string | null;
  ceiling_finish: string | null;
  ceiling_material_2: string | null;
  ceiling_size: string | null;
  ceiling_code: string | null;
  ceiling_make: string | null;
  ceiling_rate: string | null;
  remark: string | null;
  wall_finish: string | null;
  paint_color: string | null;
  dado: string | null;
}

export interface SofSection {
  floorName: string;
  rooms: SofRoom[];
}

type CellValues = Partial<Record<number, string | number>>;
type RowKind = keyof typeof PROTOTYPE_ROWS;
interface Prototype {
  height: number | undefined;
  styles: Partial<ExcelJS.Style>[];
}

/** 0 -> A, 25 -> Z, 26 -> AA: floor sections are lettered like the template. */
export function sectionLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const text = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t.length ? t : undefined;
};

function roomValues(room: SofRoom, index: number): CellValues {
  const C = SOF_COLUMNS;
  return {
    [C.srNo]: index + 1,
    [C.name]: text(room.name),
    [C.spaceTag]: text(room.space_tag),
    [C.floorMaterial]: text(room.floor_finish),
    [C.floorSize]: text(room.flooring_size),
    [C.floorFinish]: text(room.flooring_finish),
    [C.floorCode]: text(room.flooring_code),
    [C.floorMake]: text(room.flooring_make),
    [C.floorRate]: text(room.flooring_rate),
    [C.skirting]: text(room.skirting),
    [C.skirtingCode]: text(room.skirting_code),
    [C.skirtingMake]: text(room.skirting_make),
    [C.skirtingRate]: text(room.skirting_rate),
    [C.ceiling1]: text(room.ceiling_finish),
    [C.ceiling2]: text(room.ceiling_material_2),
    [C.ceilingSize]: text(room.ceiling_size),
    [C.ceilingCode]: text(room.ceiling_code),
    [C.ceilingMake]: text(room.ceiling_make),
    [C.remark]: text(room.remark),
    [C.ceilingRate]: text(room.ceiling_rate),
    [C.wall1]: text(room.wall_finish),
    [C.wall2]: text(room.paint_color),
    [C.wall3]: text(room.dado),
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? {}));

/** Grow a room row when wrapped text needs more lines than the template height allows. */
function fitHeight(ws: ExcelJS.Worksheet, values: CellValues, base: number | undefined): number | undefined {
  const LINE_PT = 14.25; // Arial 11
  let lines = 1;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const col = ws.getColumn(Number(key));
    if (col.hidden) continue;
    const perLine = Math.max(1, Math.floor((col.width ?? 10) * 1.05));
    const needed = String(value)
      .split("\n")
      .reduce((n, part) => n + Math.max(1, Math.ceil(part.length / perLine)), 0);
    lines = Math.max(lines, needed);
  }
  const wanted = lines * LINE_PT + 5;
  return base === undefined ? (lines > 1 ? wanted : undefined) : Math.max(base, wanted);
}

/**
 * Fills the template with the given floor sections and returns the .xlsx bytes.
 * Pure (no DOM), so it runs in tests as well as the browser.
 */
export async function buildSofWorkbook(
  Excel: typeof ExcelJS,
  template: ArrayBuffer,
  opts: { projectName: string; sections: SofSection[] }
): Promise<ArrayBuffer> {
  const wb = new Excel.Workbook();
  await wb.xlsx.load(template);

  const ws = wb.getWorksheet(SOF_SHEET_NAME);
  if (!ws) throw new Error(`SOF template is missing the "${SOF_SHEET_NAME}" sheet.`);

  // Only the corporate-interiors schedule is exported; the template's other
  // formats (hospitality, developer, ...) and their sample data are dropped.
  wb.worksheets.filter((s) => s.id !== ws.id).forEach((s) => wb.removeWorksheet(s.id));
  wb.views = [{ x: 0, y: 0, width: 28800, height: 15000, firstSheet: 0, activeTab: 0, visibility: "visible" }];

  // --- capture prototypes before clearing the sample rows
  const proto = {} as Record<RowKind, Prototype>;
  (Object.keys(PROTOTYPE_ROWS) as RowKind[]).forEach((kind) => {
    const row = ws.getRow(PROTOTYPE_ROWS[kind]);
    const styles: Partial<ExcelJS.Style>[] = [];
    for (let c = 1; c <= LAST_SCHEDULE_COL; c++) styles[c] = clone(row.getCell(c).style);
    proto[kind] = { height: row.height, styles };
  });

  // --- dropdowns: one list per schedule column, taken from the template
  const dropdowns = new Map<number, ExcelJS.DataValidation>();
  // Present at runtime (keyed per cell address) but missing from ExcelJS's typings.
  const dvModel = (
    ws as unknown as { dataValidations: { model: Record<string, ExcelJS.DataValidation | undefined> } }
  ).dataValidations.model;
  for (const address of Object.keys(dvModel)) {
    const cell = ws.getCell(address);
    if (Number(cell.row) < BODY_START_ROW || Number(cell.col) > LAST_SCHEDULE_COL) continue;
    const rule = dvModel[address];
    if (rule && !dropdowns.has(Number(cell.col))) dropdowns.set(Number(cell.col), clone(rule));
    delete dvModel[address];
  }

  // --- clear the template's sample schedule (columns A..BL only)
  const lastTemplateRow = ws.rowCount;
  for (let r = BODY_START_ROW; r <= lastTemplateRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= LAST_SCHEDULE_COL; c++) {
      const cell = row.getCell(c);
      cell.value = null;
      cell.style = {};
    }
  }

  // --- title
  ws.getCell("A1").value = opts.projectName.trim().toUpperCase() || "PROJECT CODE";

  // --- body
  let r = BODY_START_ROW;
  const writeRow = (kind: RowKind, values: CellValues) => {
    const row = ws.getRow(r++);
    const p = proto[kind];
    row.height = kind === "room" ? fitHeight(ws, values, p.height) : p.height;
    for (let c = 1; c <= LAST_SCHEDULE_COL; c++) {
      const cell = row.getCell(c);
      cell.style = clone(p.styles[c]);
      const v = values[c];
      if (v !== undefined) cell.value = v;
      if (kind === "room") {
        const rule = dropdowns.get(c);
        if (rule) cell.dataValidation = clone(rule);
      }
    }
  };

  opts.sections.forEach((section, i) => {
    if (i > 0) writeRow("gap", {});
    writeRow("banner", {
      [SOF_COLUMNS.srNo]: sectionLetter(i),
      [SOF_COLUMNS.floor]: text(section.floorName) ?? `Floor ${i + 1}`,
    });
    section.rooms.forEach((room, j) => writeRow("room", roomValues(room, j)));
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Browser: load the bundled template, fill it, and download the result. */
export async function downloadSofExcel(
  sections: SofSection[],
  projectName: string,
  fileName: string
): Promise<void> {
  const [{ default: Excel }, { default: templateUrl }] = await Promise.all([
    import("exceljs"),
    import("@/assets/templates/sof-corp-int.xlsx?url"),
  ]);
  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error(`Could not load the SOF template (${res.status}).`);
  const bytes = await buildSofWorkbook(Excel, await res.arrayBuffer(), { projectName, sections });

  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
