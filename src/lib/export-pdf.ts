import { jsPDF } from "jspdf";
import type { NormalisedData } from "@/lib/normalize";
import { fmtINR } from "@/lib/normalize";
import type { Filters } from "@/lib/analytics";
import { computeHeadline, computePriority, computeBreakdown } from "@/lib/analytics";

export function exportExecutivePDF(data: NormalisedData, filters: Filters) {
  const headline = computeHeadline(data, filters);
  const priority = computePriority(data, filters).slice(0, 5);
  const deptBreakdown = computeBreakdown(data, filters, "department").slice(0, 6);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = M;

  // Header
  doc.setFillColor(23, 26, 34);
  doc.rect(0, 0, W, 90, "F");
  doc.setTextColor(240, 210, 130);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Workforce Pulse — Executive Summary", M, 45);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(190, 195, 210);
  const filterParts = [
    filters.department ? `Department: ${filters.department}` : null,
    filters.taskCategory ? `Task: ${filters.taskCategory}` : null,
    filters.employeeId ? `Employee: ${filters.employeeId}` : null,
  ].filter(Boolean);
  const filterLine = filterParts.length
    ? filterParts.join("  ·  ")
    : "Filter: All employees, all departments";
  doc.text(
    `${data.quality.weekRange.start} → ${data.quality.weekRange.end}   ·   ${filterLine}`,
    M,
    68,
  );
  y = 120;

  // Headline cards
  doc.setTextColor(30, 30, 40);
  const cardW = (W - M * 2 - 20) / 2;
  const drawCard = (x: number, title: string, big: string, sub: string) => {
    doc.setDrawColor(220, 220, 225);
    doc.setFillColor(250, 248, 240);
    doc.roundedRect(x, y, cardW, 90, 6, 6, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 110, 90);
    doc.text(title, x + 14, y + 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(30, 30, 40);
    doc.text(big, x + 14, y + 52);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 100);
    doc.text(sub, x + 14, y + 76);
  };
  drawCard(
    M,
    "Hours recoverable / month",
    `${(headline.recoverableMinutesPerMonth / 60).toFixed(0)} h`,
    `${(headline.repetitiveMinutes / 60).toFixed(0)} h of repetitive time observed`,
  );
  drawCard(
    M + cardW + 20,
    "INR recoverable / month",
    fmtINR(headline.recoverableINRPerMonth),
    `Priced at joined HRMS hourly rate (${Math.round((headline.perEmployee.filter((e) => e.hourlyINR).length / Math.max(1, headline.perEmployee.length)) * 100)}% of employees priced)`,
  );
  y += 110;

  // Top-5 automation
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30, 30, 40);
  doc.text("Top 5 automation opportunities", M, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setDrawColor(230, 230, 235);
  doc.line(M, y, W - M, y);
  y += 4;
  priority.forEach((p, i) => {
    y += 16;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 40);
    doc.text(`${i + 1}. ${p.taskCategory}`, M, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 95);
    const meta = `${p.concentration} people  ·  ${Math.round(p.repetitiveShare * 100)}% repetitive  ·  ${fmtINR(p.recoverableINRPerMonth)}/mo recoverable`;
    doc.text(meta, M + 200, y);
    // score bar
    const barX = W - M - 120;
    doc.setFillColor(235, 232, 220);
    doc.rect(barX, y - 8, 120, 10, "F");
    doc.setFillColor(230, 175, 60);
    doc.rect(barX, y - 8, 120 * p.score, 10, "F");
  });
  y += 18;

  // Department strip
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30, 30, 40);
  doc.text("Where the time sits (by department)", M, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const maxMin = Math.max(...deptBreakdown.map((d) => d.totalMinutes), 1);
  deptBreakdown.forEach((d) => {
    y += 16;
    doc.setTextColor(30, 30, 40);
    doc.text(d.key, M, y);
    doc.setTextColor(90, 90, 105);
    doc.text(
      `${(d.totalMinutes / 60).toFixed(0)} h  ·  ${fmtINR(d.recoverableINR)}/mo recoverable`,
      M + 180,
      y,
    );
    const barX = W - M - 200;
    doc.setFillColor(235, 232, 220);
    doc.rect(barX, y - 8, 200, 10, "F");
    doc.setFillColor(80, 160, 170);
    doc.rect(barX, y - 8, 200 * (d.totalMinutes / maxMin), 10, "F");
  });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 155);
  doc.text(
    `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}  ·  Workforce Pulse  ·  ${headline.weeksCovered} weeks observed  ·  Methodology in repo README`,
    M,
    doc.internal.pageSize.getHeight() - 24,
  );

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`workforce-pulse-${stamp}.pdf`);
}
