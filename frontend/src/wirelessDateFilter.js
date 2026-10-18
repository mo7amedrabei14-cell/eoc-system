// Date-aware visibility for the wireless handover register.
// received_date is the delivery-to-recipient date; returned_at is when EOC received it back.
export function wirelessDeliveryDateMatchesFilter(delivery, filterDate) {
  if (!filterDate) return true;

  const deliveryDate = String(delivery?.received_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || deliveryDate > filterDate) {
    return false;
  }

  // A delivered item stays visible from its delivery date until it is returned.
  if (delivery?.status !== "مُرجَع") return true;

  const returnDate = String(delivery?.returned_at ?? "").slice(0, 10);
  // Legacy returned records without a return timestamp cannot reliably be
  // assigned to a later closure day, so keep them on their delivery date only.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
    return deliveryDate === filterDate;
  }

  // Include the item through its return date; hide it on subsequent dates.
  return returnDate >= filterDate;
}

export function wirelessDeliveryStatusAtFilterDate(delivery, filterDate) {
  const currentStatus = String(delivery?.status || "مسلَّم");
  if (!filterDate || currentStatus !== "مُرجَع") return currentStatus;

  const returnDate = String(delivery?.returned_at ?? "").slice(0, 10);
  // Before the recorded return date, the item was still checked out.
  if (/^\d{4}-\d{2}-\d{2}$/.test(returnDate) && filterDate < returnDate) {
    return "مسلَّم";
  }
  return currentStatus;
}

export function wirelessDeliveryReturnDate(delivery) {
  const value = String(delivery?.returned_at ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}
