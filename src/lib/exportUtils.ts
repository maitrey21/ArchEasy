import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { downloadSofExcel } from "@/lib/sofExcel";

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

// Column layout used by the PDF exports.
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

export interface FloorSection {
  floorName: string;
  rooms: Room[];
}

// ---------------------------------------------------------------------------
// Excel exports
//
// All three fill the practice's "FORMAT OF SOF FOR CORP. INT" template (see
// sofExcel.ts), so every export has the template's exact columns, widths,
// colours and dropdowns. Floors appear as lettered banner sections (A, B, ...)
// in one sheet, the same way the template lays a project out.
// ---------------------------------------------------------------------------

/** Keeps file names valid on Windows/macOS. */
function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim().replace(/\s+/g, "_") || "Project";
}

/** Rooms without a known floor -> one workbook (single section). */
export function exportToExcel(rooms: Room[], projectName: string): Promise<void> {
  const floorName = rooms.find((r) => r.floor_level?.trim())?.floor_level ?? "All Spaces";
  return downloadSofExcel(
    [{ floorName, rooms }],
    projectName,
    `${fileSafe(projectName)}_Schedule_of_Finishes.xlsx`
  );
}

/** Single floor -> one workbook with that floor's section. */
export function exportFloorToExcel(
  rooms: Room[],
  projectName: string,
  floorName: string
): Promise<void> {
  return downloadSofExcel(
    [{ floorName, rooms }],
    projectName,
    `${fileSafe(projectName)}_${fileSafe(floorName)}_Schedule_of_Finishes.xlsx`
  );
}

/** Whole project -> one workbook, one lettered section per floor. */
export function exportProjectToExcel(sections: FloorSection[], projectName: string): Promise<void> {
  return downloadSofExcel(
    sections,
    projectName,
    `${fileSafe(projectName)}_Project_Schedule_of_Finishes.xlsx`
  );
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
