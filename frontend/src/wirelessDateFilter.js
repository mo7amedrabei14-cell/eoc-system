// Daily activity visibility for the wireless handover register.
// Deliveries appear on their issue date; returned deliveries also appear on their return date.
// Older, still-open handovers are available through the explicit carryover toggle.
const isIsoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);

export function wirelessDeliveryDateMatchesFilter(delivery, filterDate, includeCarryover = false) {
  if (!filterDate) return true;
  const deliveryDate = String(delivery?.received_date ?? "").slice(0, 10);
  if (!isIsoDate(deliveryDate)) return false;
  if (deliveryDate === filterDate) return true;

  const returnDate = String(delivery?.returned_at ?? "").slice(0, 10);
  if (delivery?.status === "مُرجَع" && isIsoDate(returnDate) && returnDate === filterDate) return true;

  return Boolean(includeCarryover && delivery?.status !== "مُرجَع" && deliveryDate < filterDate);
}

export function wirelessDeliveryStatusAtFilterDate(delivery, filterDate) {
  const currentStatus = String(delivery?.status || "مسلَّم");
  if (!filterDate || currentStatus !== "مُرجَع") return currentStatus;
  const returnDate = String(delivery?.returned_at ?? "").slice(0, 10);
  if (isIsoDate(returnDate) && filterDate < returnDate) return "مسلَّم";
  return currentStatus;
}

export function wirelessDeliveryReturnDate(delivery) {
  const value = String(delivery?.returned_at ?? "").slice(0, 10);
  return isIsoDate(value) ? value : "";
}

export function wirelessDeliveryDailyActivity(deliveries, activityDate, deviceType) {
  if (!isIsoDate(String(activityDate || ""))) return { issued: 0, returned: 0 };
  const storedType = deviceType === "TETRA" ? "MOTOROLA" : deviceType;
  let issued = 0;
  let returned = 0;
  for (const delivery of Array.isArray(deliveries) ? deliveries : []) {
    const devices = Array.isArray(delivery?.devices) ? delivery.devices : [];
    const matchingDeviceCount = devices.reduce(
      (count, device) => count + (device?.device_type === storedType ? 1 : 0),
      0
    );
    if (!matchingDeviceCount) continue;
    if (String(delivery?.received_date ?? "").slice(0, 10) === activityDate) issued += matchingDeviceCount;
    const returnDate = String(delivery?.returned_at ?? "").slice(0, 10);
    if (delivery?.status === "مُرجَع" && isIsoDate(returnDate) && returnDate === activityDate) returned += matchingDeviceCount;
  }
  return { issued, returned };
}
