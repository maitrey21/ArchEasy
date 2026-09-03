import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface Room {
  name: string;
  floor_level: string | null;
  space_tag: string | null;
  room_type: string | null;
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
  area: number | null;
  area_unit: string | null;
  wall_finish: string | null;
  ceiling_height: number | null;
  paint_color: string | null;
  dado: string | null;
  notes: string | null;
}

const groupHeaders = [
  "", "", "", "",
  "FLOORING", "", "", "", "", "",
  "SKIRTING", "", "", "",
  "CEILING", "", "", "", "", "",
  "",
];

const subHeaders = [
  "Sr.No", "Floor", "Space Description", "Space/Room Tag",
  "Material", "Size", "Finish", "Code No", "Make", "Basic Rate",
  "Material", "Code No", "Make", "Basic Rate",
  "Material 1", "Material 2", "Size", "Code No", "Make", "Basic Rate",
  "Remark",
];

function roomToRow(room: Room, idx: number) {
  return [
    idx + 1,
    room.floor_level ?? "",
    room.name,
    room.space_tag ?? "",
    room.floor_finish ?? "",
    room.flooring_size ?? "",
    room.flooring_finish ?? "",
    room.flooring_code ?? "",
    room.flooring_make ?? "",
    room.flooring_rate ?? "",
    room.skirting ?? "",
    room.skirting_code ?? "",
    room.skirting_make ?? "",
    room.skirting_rate ?? "",
    room.ceiling_finish ?? "",
    room.ceiling_material_2 ?? "",
    room.ceiling_size ?? "",
    room.ceiling_code ?? "",
    room.ceiling_make ?? "",
    room.ceiling_rate ?? "",
    room.remark ?? "",
  ];
}

export function exportToExcel(rooms: Room[], projectName: string) {
  const data = [
    [projectName],
    ["SCHEDULE OF FINISHES"],
    groupHeaders,
    subHeaders,
    ...rooms.map((r, i) => roomToRow(r, i)),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Merge group header cells
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 20 } }, // Project name
    { s: { r: 1, c: 0 }, e: { r: 1, c: 20 } }, // Schedule title
    { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },  // Empty group
    { s: { r: 2, c: 4 }, e: { r: 2, c: 9 } },  // FLOORING
    { s: { r: 2, c: 10 }, e: { r: 2, c: 13 } }, // SKIRTING
    { s: { r: 2, c: 14 }, e: { r: 2, c: 19 } }, // CEILING
  ];

  ws["!cols"] = COLUMN_WIDTHS;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Schedule of Finishes");
  XLSX.writeFile(wb, `${projectName}_Schedule_of_Finishes.xlsx`);
}

// ---------------------------------------------------------------------------
// Multi-floor exports
//
// These reuse roomToRow / groupHeaders / subHeaders above verbatim, so the
// column mapping of the schedule is identical to the single-floor export.
// ---------------------------------------------------------------------------

const LAST_COL = subHeaders.length - 1;

const COLUMN_WIDTHS = subHeaders.map((h) => ({
  wch: h === "Sr.No" ? 6 : h === "Space Description" ? 22 : 14,
}));

export interface FloorSection {
  floorName: string;
  rooms: Room[];
}

/** Excel sheet names cannot exceed 31 chars or contain : \ / ? * [ ] */
function safeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, "-").trim();
  return (cleaned || fallback).slice(0, 31);
}

/** Single floor -> one workbook. */
export function exportFloorToExcel(rooms: Room[], projectName: string, floorName: string) {
  const data = [
    [projectName],
    [`SCHEDULE OF FINISHES - ${floorName.toUpperCase()}`],
    groupHeaders,
    subHeaders,
    ...rooms.map((r, i) => roomToRow(r, i)),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: LAST_COL } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: LAST_COL } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
    { s: { r: 2, c: 4 }, e: { r: 2, c: 9 } },
    { s: { r: 2, c: 10 }, e: { r: 2, c: 13 } },
    { s: { r: 2, c: 14 }, e: { r: 2, c: 19 } },
  ];
  ws["!cols"] = COLUMN_WIDTHS;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName(floorName, "Floor"));
  XLSX.writeFile(wb, `${projectName}_${floorName}_Schedule_of_Finishes.xlsx`.replace(/\s+/g, "_"));
}

/**
 * Whole project -> one workbook with a combined floor-wise sheet plus one
 * sheet per floor.
 */
export function exportProjectToExcel(sections: FloorSection[], projectName: string) {
  const wb = XLSX.utils.book_new();

  // --- Combined sheet: floor-wise sections stacked with banner rows ---
  const combined: (string | number)[][] = [
    [projectName],
    ["SCHEDULE OF FINISHES - COMPLETE PROJECT"],
    [],
  ];
  const merges: XLSX.Range[] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: LAST_COL } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: LAST_COL } },
  ];

  sections.forEach((section) => {
    // Floor banner
    merges.push({ s: { r: combined.length, c: 0 }, e: { r: combined.length, c: LAST_COL } });
    combined.push([`${section.floorName.toUpperCase()} — ${section.rooms.length} room(s)`]);

    // Group header row
    merges.push(
      { s: { r: combined.length, c: 0 }, e: { r: combined.length, c: 3 } },
      { s: { r: combined.length, c: 4 }, e: { r: combined.length, c: 9 } },
      { s: { r: combined.length, c: 10 }, e: { r: combined.length, c: 13 } },
      { s: { r: combined.length, c: 14 }, e: { r: combined.length, c: 19 } }
    );
    combined.push([...groupHeaders]);
    combined.push([...subHeaders]);

    if (section.rooms.length === 0) {
      combined.push(["", "", "No rooms detected on this floor"]);
    } else {
      // Numbering restarts per floor, matching the per-floor schedule.
      section.rooms.forEach((room, i) => combined.push(roomToRow(room, i)));
    }

    combined.push([]);
  });

  const totalRooms = sections.reduce((sum, s) => sum + s.rooms.length, 0);
  merges.push({ s: { r: combined.length, c: 0 }, e: { r: combined.length, c: LAST_COL } });
  combined.push([`TOTAL: ${totalRooms} room(s) across ${sections.length} floor(s)`]);

  const combinedWs = XLSX.utils.aoa_to_sheet(combined);
  combinedWs["!merges"] = merges;
  combinedWs["!cols"] = COLUMN_WIDTHS;
  XLSX.utils.book_append_sheet(wb, combinedWs, "Complete Project");

  // --- One sheet per floor ---
  const usedNames = new Set<string>(["Complete Project"]);
  sections.forEach((section, idx) => {
    const data = [
      [projectName],
      [`SCHEDULE OF FINISHES - ${section.floorName.toUpperCase()}`],
      groupHeaders,
      subHeaders,
      ...section.rooms.map((r, i) => roomToRow(r, i)),
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: LAST_COL } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: LAST_COL } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
      { s: { r: 2, c: 4 }, e: { r: 2, c: 9 } },
      { s: { r: 2, c: 10 }, e: { r: 2, c: 13 } },
      { s: { r: 2, c: 14 }, e: { r: 2, c: 19 } },
    ];
    ws["!cols"] = COLUMN_WIDTHS;

    // Guarantee a unique, Excel-legal sheet name.
    let name = safeSheetName(section.floorName, `Floor ${idx + 1}`);
    let suffix = 2;
    while (usedNames.has(name)) {
      name = safeSheetName(`${section.floorName} ${suffix++}`, `Floor ${idx + 1}`);
    }
    usedNames.add(name);

    XLSX.utils.book_append_sheet(wb, ws, name);
  });

  XLSX.writeFile(wb, `${projectName}_Project_Schedule_of_Finishes.xlsx`.replace(/\s+/g, "_"));
}

export function exportToPDF(rooms: Room[], projectName: string) {
  const doc = new jsPDF({ orientation: "landscape", format: "a3" });

  doc.setFontSize(16);
  doc.text(projectName, 14, 15);
  doc.setFontSize(12);
  doc.setTextColor(100);
  doc.text("SCHEDULE OF FINISHES", 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [groupHeaders, subHeaders],
    body: rooms.map((r, i) => roomToRow(r, i)),
    styles: { fontSize: 6, cellPadding: 2 },
    headStyles: {
      fillColor: [37, 99, 175],
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 10 },
      2: { cellWidth: 30 },
    },
  });

  doc.save(`${projectName}_Schedule_of_Finishes.pdf`);
}

/** Shared autoTable styling so every PDF variant looks identical. */
const PDF_TABLE_STYLES = {
  styles: { fontSize: 6, cellPadding: 2 },
  headStyles: {
    fillColor: [37, 99, 175] as [number, number, number],
    textColor: 255,
    fontStyle: "bold" as const,
    halign: "center" as const,
    fontSize: 7,
  },
  alternateRowStyles: { fillColor: [245, 247, 250] as [number, number, number] },
  columnStyles: {
    0: { cellWidth: 10 },
    2: { cellWidth: 30 },
  },
};

/** Single floor -> one PDF. */
export function exportFloorToPDF(rooms: Room[], projectName: string, floorName: string) {
  const doc = new jsPDF({ orientation: "landscape", format: "a3" });

  doc.setFontSize(16);
  doc.text(projectName, 14, 15);
  doc.setFontSize(12);
  doc.setTextColor(100);
  doc.text(`SCHEDULE OF FINISHES - ${floorName.toUpperCase()}`, 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [groupHeaders, subHeaders],
    body: rooms.map((r, i) => roomToRow(r, i)),
    ...PDF_TABLE_STYLES,
  });

  doc.save(`${projectName}_${floorName}_Schedule_of_Finishes.pdf`.replace(/\s+/g, "_"));
}

/**
 * Whole project -> one PDF with a floor-wise section per floor, each starting
 * on its own page.
 */
export function exportProjectToPDF(sections: FloorSection[], projectName: string) {
  const doc = new jsPDF({ orientation: "landscape", format: "a3" });
  const totalRooms = sections.reduce((sum, s) => sum + s.rooms.length, 0);

  sections.forEach((section, idx) => {
    if (idx > 0) doc.addPage();

    doc.setFontSize(16);
    doc.setTextColor(20);
    doc.text(projectName, 14, 15);

    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(
      `SCHEDULE OF FINISHES - ${section.floorName.toUpperCase()}  (${section.rooms.length} room(s))`,
      14,
      22
    );

    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`Floor ${idx + 1} of ${sections.length}`, 14, 27);

    if (section.rooms.length === 0) {
      doc.setFontSize(10);
      doc.setTextColor(120);
      doc.text("No rooms detected on this floor.", 14, 38);
      return;
    }

    autoTable(doc, {
      startY: 32,
      head: [groupHeaders, subHeaders],
      body: section.rooms.map((r, i) => roomToRow(r, i)),
      ...PDF_TABLE_STYLES,
    });
  });

  // Summary page
  doc.addPage();
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(`${projectName} - Summary`, 14, 15);

  autoTable(doc, {
    startY: 24,
    head: [["Floor", "Rooms"]],
    body: [
      ...sections.map((s) => [s.floorName, String(s.rooms.length)]),
      ["TOTAL", String(totalRooms)],
    ],
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: {
      fillColor: [37, 99, 175],
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 30, halign: "right" } },
  });

  doc.save(`${projectName}_Project_Schedule_of_Finishes.pdf`.replace(/\s+/g, "_"));
}
