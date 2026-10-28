// Pure helpers for the wireless handover national-ID lookup.
export function normalizeWirelessNationalId(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
}

export function findWirelessRecipient(recipients, nationalId) {
  const wanted = normalizeWirelessNationalId(nationalId);
  if (!/^[0-9]{14}$/.test(wanted) || !Array.isArray(recipients)) return null;
  return recipients.find(recipient => normalizeWirelessNationalId(recipient?.national_id) === wanted) || null;
}
