// Build a readable default document title for the browser's Print / Save as PDF dialog.
// This affects only the print document title; it does not change delivery data or print contents.
export function buildWirelessPrintTitle(deliveries, date) {
  const list = Array.isArray(deliveries) ? deliveries : [];
  const today = String(date || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const recipients = [...new Set(
    list.map((delivery) => String(delivery?.full_name || "").trim()).filter(Boolean),
  )];
  const recipient = recipients.length === 1
    ? recipients[0]
    : recipients.length > 1
      ? `${recipients[0]} وآخرون`
      : "غير محدد";
  const deviceCount = list.reduce((total, delivery) => {
    const actualDevices = Array.isArray(delivery?.devices)
      ? delivery.devices.length
      : Number(delivery?.device_count) || 0;
    return total + Math.max(0, actualDevices);
  }, 0);
  const deviceLabel = deviceCount === 1 ? "جهاز" : deviceCount === 2 ? "جهازان" : deviceCount >= 3 && deviceCount <= 10 ? "أجهزة" : "جهاز";

  // Avoid characters rejected by common file-name dialogs and keep the title manageable.
  return `تسليم لاسلكي إلى ${recipient} - ${today} - ${deviceCount} ${deviceLabel}`
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
}
