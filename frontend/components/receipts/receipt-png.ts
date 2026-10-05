import QRCode from "qrcode";

export type ReceiptPngData = {
  code: string;
  student: string;
  studentNumber: string;
  date: string;
  time: string;
  status: string;
  paymentMethod: string;
  collectionChannel: string | null;
  officialReceiptNumber: string | null;
  pickupSchedule: string | null;
  reservationReference: string | null;
  transactionReference: string;
  verificationUrl: string | null;
  verifiedBy: string;
  items: Array<{ name: string; detail: string; quantity: number; unitPrice: number }>;
  total: number;
};

const WIDTH = 640;
const SCALE = 2; // Export at 2x so the image stays sharp on phones and when printed.
const PAPER_X = 36;
const PAPER_TOP = 32;
const PAPER_WIDTH = WIDTH - PAPER_X * 2;
const CONTENT_X = PAPER_X + 40;
const CONTENT_RIGHT = PAPER_X + PAPER_WIDTH - 40;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_X;
const CENTER = WIDTH / 2;
const FONT_STACK = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const COLORS = {
  page: "#eef3ef",
  paper: "#ffffff",
  brand: "#006633",
  brandSoft: "#eaf5ec",
  text: "#17211b",
  body: "#2b3830",
  muted: "#66736b",
  rule: "#c9d3cb"
};

const STATUS_STYLES: Record<string, { label: string; color: string; tint: string; mark: "check" | "clock" | "cross" }> = {
  Verified: { label: "Verified digital receipt", color: "#006633", tint: "#e6f4ea", mark: "check" },
  Voided: { label: "Voided receipt", color: "#b3261e", tint: "#fdecea", mark: "cross" },
  Pending: { label: "Pending verification", color: "#8a5a00", tint: "#fff4d6", mark: "clock" }
};

const font = (weight: number, size: number) => `${weight} ${size}px ${FONT_STACK}`;

function peso(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function ellipsize(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && context.measureText(`${trimmed}…`).width > maxWidth) trimmed = trimmed.slice(0, -1);
  return `${trimmed.trimEnd()}…`;
}

function dashedRule(context: CanvasRenderingContext2D, y: number) {
  context.save();
  context.strokeStyle = COLORS.rule;
  context.lineWidth = 1.25;
  context.setLineDash([6, 6]);
  context.beginPath();
  context.moveTo(CONTENT_X, y);
  context.lineTo(CONTENT_RIGHT, y);
  context.stroke();
  context.restore();
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(x, y, width, height, radius);
  else context.rect(x, y, width, height);
}

function drawStatusMark(context: CanvasRenderingContext2D, mark: "check" | "clock" | "cross", x: number, y: number, color: string) {
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, 10, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2.2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  if (mark === "check") {
    context.moveTo(x - 4.5, y + 0.5);
    context.lineTo(x - 1.2, y + 3.8);
    context.lineTo(x + 4.8, y - 3.2);
  } else if (mark === "cross") {
    context.moveTo(x - 3.8, y - 3.8);
    context.lineTo(x + 3.8, y + 3.8);
    context.moveTo(x + 3.8, y - 3.8);
    context.lineTo(x - 3.8, y + 3.8);
  } else {
    context.moveTo(x, y - 5);
    context.lineTo(x, y);
    context.lineTo(x + 3.5, y + 2.5);
  }
  context.stroke();
  context.restore();
}

/** Renders the receipt as a print-quality PNG and starts the download. */
export async function downloadReceiptPng(receipt: ReceiptPngData) {
  // Draw the content on a tall transparent layer first, then place it on a paper card
  // sized to the content so the card always has an even margin.
  const layer = document.createElement("canvas");
  layer.width = WIDTH * SCALE;
  layer.height = 3200 * SCALE;
  const context = layer.getContext("2d");
  if (!context) return;
  context.scale(SCALE, SCALE);
  context.textBaseline = "alphabetic";

  let y = PAPER_TOP + 40;

  try {
    const logo = await loadImage("/assets/wescomm-logo.webp");
    const logoWidth = 168;
    const logoHeight = logoWidth * (logo.naturalHeight / logo.naturalWidth || 0.62);
    context.drawImage(logo, CENTER - logoWidth / 2, y - 12, logoWidth, logoHeight);
    y += logoHeight - 4;
  } catch {
    context.fillStyle = COLORS.brand;
    context.font = font(800, 30);
    context.textAlign = "center";
    context.fillText("WESCOMM", CENTER, y + 24);
    y += 48;
  }

  context.textAlign = "center";
  context.fillStyle = COLORS.text;
  context.font = font(700, 17);
  context.fillText("Wesleyan University-Philippines", CENTER, y);
  y += 22;
  context.fillStyle = COLORS.muted;
  context.font = font(400, 13);
  context.fillText("Integrated Commissary Management System", CENTER, y);
  y += 26;
  dashedRule(context, y);
  y += 32;

  context.fillStyle = COLORS.muted;
  context.font = font(700, 12);
  context.fillText("DIGITAL RECEIPT", CENTER, y);
  y += 30;
  context.fillStyle = COLORS.brand;
  context.font = font(800, 26);
  context.fillText(ellipsize(context, receipt.code, CONTENT_WIDTH), CENTER, y);
  y += 34;

  const details: Array<[string, string]> = [
    ["Date", receipt.date],
    ["Time", receipt.time],
    ["Student", receipt.student],
    ...(receipt.studentNumber ? [["Student No.", receipt.studentNumber] as [string, string]] : []),
    ...(receipt.reservationReference ? [["Reservation", receipt.reservationReference] as [string, string]] : []),
    ["Payment method", receipt.paymentMethod],
    ...(receipt.collectionChannel ? [["Collected by", receipt.collectionChannel] as [string, string]] : []),
    ...(receipt.officialReceiptNumber ? [["Treasury OR No.", receipt.officialReceiptNumber] as [string, string]] : []),
    ...(receipt.pickupSchedule ? [["Pickup", receipt.pickupSchedule] as [string, string]] : [])
  ];
  const labelColumn = 132;
  for (const [label, value] of details) {
    context.textAlign = "left";
    context.fillStyle = COLORS.muted;
    context.font = font(400, 15);
    context.fillText(label, CONTENT_X, y);
    context.textAlign = "right";
    context.fillStyle = COLORS.body;
    context.font = font(700, 15);
    // Long values (pickup windows, names) wrap under themselves instead of running into the label.
    const lines = wrapLines(context, value, CONTENT_WIDTH - labelColumn);
    lines.forEach((line, index) => context.fillText(line, CONTENT_RIGHT, y + index * 20));
    y += 28 + (lines.length - 1) * 20;
  }

  y += 4;
  dashedRule(context, y);
  y += 30;

  for (const item of receipt.items) {
    context.textAlign = "left";
    context.fillStyle = COLORS.text;
    context.font = font(700, 15);
    const nameLines = wrapLines(context, `${item.quantity} × ${item.name}`, CONTENT_WIDTH - 130);
    nameLines.forEach((line, index) => context.fillText(line, CONTENT_X, y + index * 20));
    context.textAlign = "right";
    context.fillText(peso(item.unitPrice * item.quantity), CONTENT_RIGHT, y);
    y += (nameLines.length - 1) * 20 + 20;

    const detailParts = [item.detail, item.quantity > 1 ? `${peso(item.unitPrice)} each` : ""].filter(Boolean);
    if (detailParts.length) {
      context.textAlign = "left";
      context.fillStyle = COLORS.muted;
      context.font = font(400, 13);
      context.fillText(ellipsize(context, detailParts.join(" · "), CONTENT_WIDTH), CONTENT_X, y);
      y += 6;
    }
    y += 24;
  }

  dashedRule(context, y - 6);
  y += 30;
  context.textAlign = "left";
  context.fillStyle = COLORS.text;
  context.font = font(800, 17);
  context.fillText("TOTAL", CONTENT_X, y);
  context.textAlign = "right";
  const voided = receipt.status === "Voided";
  context.fillStyle = voided ? COLORS.muted : COLORS.brand;
  context.font = font(800, 28);
  const totalText = peso(receipt.total);
  context.fillText(totalText, CONTENT_RIGHT, y + 2);
  if (voided) {
    // A voided total must not read as money owed or paid.
    const totalWidth = context.measureText(totalText).width;
    context.fillRect(CONTENT_RIGHT - totalWidth, y - 7, totalWidth, 2.5);
  }
  y += 28;

  const status = STATUS_STYLES[receipt.status] ?? STATUS_STYLES.Pending;
  context.fillStyle = status.tint;
  roundedRect(context, CONTENT_X, y, CONTENT_WIDTH, 50, 12);
  context.fill();
  context.font = font(800, 15);
  const statusText = status.label.toUpperCase();
  const statusWidth = context.measureText(statusText).width + 30;
  const statusStart = CENTER - statusWidth / 2;
  drawStatusMark(context, status.mark, statusStart + 10, y + 25, status.color);
  context.textAlign = "left";
  context.fillStyle = status.color;
  context.fillText(statusText, statusStart + 30, y + 30);
  y += 80;

  dashedRule(context, y - 6);
  y += 26;
  context.textAlign = "center";
  context.fillStyle = COLORS.muted;
  context.font = font(700, 12);
  context.fillText("VERIFICATION REFERENCE", CENTER, y);
  y += 22;
  context.fillStyle = COLORS.brand;
  context.font = font(700, 15);
  context.fillText(receipt.transactionReference, CENTER, y);
  y += 20;
  if (receipt.verifiedBy) {
    context.fillStyle = COLORS.muted;
    context.font = font(400, 13);
    context.fillText(`Verified by ${receipt.verifiedBy}`, CENTER, y);
    y += 18;
  }

  if (receipt.verificationUrl) {
    const qrSize = 156;
    const qrImage = await loadImage(await QRCode.toDataURL(receipt.verificationUrl, {
      width: qrSize * SCALE,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: COLORS.text, light: "#ffffff" }
    }));
    y += 12;
    context.strokeStyle = COLORS.rule;
    context.lineWidth = 1;
    roundedRect(context, CENTER - qrSize / 2 - 8, y - 8, qrSize + 16, qrSize + 16, 10);
    context.stroke();
    context.drawImage(qrImage, CENTER - qrSize / 2, y, qrSize, qrSize);
    y += qrSize + 30;
    context.fillStyle = COLORS.body;
    context.font = font(700, 13);
    context.fillText("Scan to verify this receipt", CENTER, y);
    y += 26;
  } else {
    context.fillStyle = COLORS.muted;
    context.font = font(400, 13);
    context.fillText("Secure QR verification is being prepared.", CENTER, y + 22);
    y += 50;
  }

  context.fillStyle = COLORS.muted;
  context.font = font(400, 12);
  context.fillText("Keep this digital receipt for verification and record purposes.", CENTER, y);
  y += 22;
  context.fillStyle = COLORS.text;
  context.font = font(700, 14);
  context.fillText("Thank you for using WESCOMM.", CENTER, y);
  y += 20;
  context.fillStyle = COLORS.muted;
  context.font = font(400, 11);
  const downloadedAt = new Date().toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
  context.fillText(`Downloaded ${downloadedAt} (Asia/Manila)`, CENTER, y);

  const paperBottom = y + 34;
  const height = paperBottom + 32;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const page = canvas.getContext("2d");
  if (!page) return;
  page.scale(SCALE, SCALE);

  page.fillStyle = COLORS.page;
  page.fillRect(0, 0, WIDTH, height);
  page.save();
  page.shadowColor = "rgba(16, 40, 24, 0.12)";
  page.shadowBlur = 24;
  page.shadowOffsetY = 6;
  page.fillStyle = COLORS.paper;
  roundedRect(page, PAPER_X, PAPER_TOP, PAPER_WIDTH, paperBottom - PAPER_TOP, 16);
  page.fill();
  page.restore();

  // Brand band across the top of the paper.
  page.save();
  roundedRect(page, PAPER_X, PAPER_TOP, PAPER_WIDTH, paperBottom - PAPER_TOP, 16);
  page.clip();
  page.fillStyle = COLORS.brand;
  page.fillRect(PAPER_X, PAPER_TOP, PAPER_WIDTH, 6);
  page.restore();

  page.drawImage(layer, 0, 0, WIDTH * SCALE, height * SCALE, 0, 0, WIDTH, height);

  if (receipt.status === "Voided") {
    page.save();
    page.translate(CENTER, (PAPER_TOP + paperBottom) / 2);
    page.rotate(-Math.PI / 7);
    page.fillStyle = "rgba(179, 38, 30, 0.10)";
    page.font = font(900, 132);
    page.textAlign = "center";
    page.fillText("VOID", 0, 40);
    page.restore();
  }

  await new Promise<void>((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `WESCOMM-${receipt.code}.png`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      resolve();
    }, "image/png");
  });
}
