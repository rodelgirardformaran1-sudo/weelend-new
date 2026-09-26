// src/utils/receiptPdf.ts
//
// Renders a single ReceiptRecord (see receiptService.ts) as a simple,
// printable PDF — same plain formal tone as the loan contract / agreement
// text elsewhere in the app, not a fancy branded template.

import { jsPDF } from "jspdf";
import type { ReceiptRecord } from "../services/receiptService";

function peso(n: number | undefined): string {
  return `₱${Number(n || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortReceiptNo(id: string): string {
  return `WL-${id.slice(0, 8).toUpperCase()}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function buildReceiptPdf(receipt: ReceiptRecord, memberName: string): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 16;
  let y = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("WEE LENDING COOPERATIVE", pageWidth / 2, y, { align: "center" });

  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Official Payment Receipt", pageWidth / 2, y, { align: "center" });

  y += 8;
  doc.setDrawColor(75, 0, 130); // matches the app's --primary-dark-purple
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageWidth - marginX, y);

  y += 9;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, marginX + 42, y);
    y += 7;
  };

  row("Receipt No.:", shortReceiptNo(receipt.id));
  row("Date:", receipt.createdAt.toLocaleString("en-PH"));
  row("Member/Borrower:", memberName);
  row("For:", receipt.productLabel);

  if (receipt.forMonth && receipt.forYear) {
    row("Period:", `${MONTH_NAMES[receipt.forMonth - 1] ?? receipt.forMonth} ${receipt.forYear}`);
  }
  if (receipt.monthsPaid) {
    row("Months Paid:", String(receipt.monthsPaid));
  }

  y += 3;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.2);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 8;

  if (receipt.principalPaid !== undefined) {
    row("Principal Paid:", peso(receipt.principalPaid));
  }
  if (receipt.interestPaid !== undefined) {
    row("Interest Paid:", peso(receipt.interestPaid));
  }
  if (receipt.lateFeePaid) {
    row("Late Fee Paid:", peso(receipt.lateFeePaid));
  }

  y += 3;
  doc.setDrawColor(75, 0, 130);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Amount Paid:", marginX, y);
  doc.text(peso(receipt.amount), pageWidth - marginX, y, { align: "right" });

  y += 16;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text("Thank you for your payment!", pageWidth / 2, y, { align: "center" });

  y += 5;
  doc.text(
    "This is a system-generated receipt from the WeeLend app.",
    pageWidth / 2,
    y,
    { align: "center" }
  );

  return doc;
}

export function downloadReceiptPdf(receipt: ReceiptRecord, memberName: string) {
  const doc = buildReceiptPdf(receipt, memberName);
  const dateStr = receipt.createdAt.toISOString().slice(0, 10);
  doc.save(`WeeLend-Receipt-${shortReceiptNo(receipt.id)}-${dateStr}.pdf`);
}
