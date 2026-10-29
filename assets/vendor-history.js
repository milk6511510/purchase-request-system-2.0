(function attachVendorHistory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AiwaVendorHistory = api;
})(typeof window === "undefined" ? globalThis : window, function createVendorHistory() {
  const detailFields = ["vendorTaxId", "contactPerson", "vendorAddress", "phone", "mobile", "fax"];

  function normalizeName(value) {
    return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-TW");
  }

  function timestamp(record) {
    const value = Date.parse(record.updatedAt || record.createdAt || "");
    return Number.isNaN(value) ? 0 : value;
  }

  function getPersonalVendors(records, employeeId) {
    const owner = String(employeeId || "").trim().toUpperCase();
    if (!owner || !Array.isArray(records)) return [];

    const ownRecords = records
      .filter((record) => String(record.employeeId || "").trim().toUpperCase() === owner && normalizeName(record.vendorName))
      .slice()
      .sort((left, right) => timestamp(right) - timestamp(left));
    const vendorsByName = new Map();

    for (const record of ownRecords) {
      const vendorName = String(record.vendorName).trim();
      const key = normalizeName(vendorName);
      let vendor = vendorsByName.get(key);
      if (!vendor) {
        vendor = { vendorName, lastUsedAt: record.updatedAt || record.createdAt || "", requestCount: 0 };
        for (const field of detailFields) vendor[field] = "";
        vendorsByName.set(key, vendor);
      }

      vendor.requestCount += 1;
      for (const field of detailFields) {
        if (!vendor[field] && String(record[field] || "").trim()) vendor[field] = String(record[field]).trim();
      }
    }

    return [...vendorsByName.values()];
  }

  function findPersonalVendor(vendors, name) {
    const key = normalizeName(name);
    return key && Array.isArray(vendors)
      ? vendors.find((vendor) => normalizeName(vendor.vendorName) === key) || null
      : null;
  }

  return { getPersonalVendors, findPersonalVendor };
});
