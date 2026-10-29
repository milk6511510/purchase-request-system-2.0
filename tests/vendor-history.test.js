const test = require("node:test");
const assert = require("node:assert/strict");
const { getPersonalVendors, findPersonalVendor } = require("../assets/vendor-history");

test("personal vendor suggestions only include the signed-in employee's requests", () => {
  const vendors = getPersonalVendors([
    { employeeId: "E001", vendorName: "甲公司", vendorTaxId: "11111111", createdAt: "2026-01-01" },
    { employeeId: "E002", vendorName: "乙公司", vendorTaxId: "22222222", createdAt: "2026-02-01" }
  ], "e001");

  assert.deepEqual(vendors.map((vendor) => vendor.vendorName), ["甲公司"]);
});

test("vendor lookup combines the latest saved details and falls back to older non-empty fields", () => {
  const vendors = getPersonalVendors([
    { employeeId: "E001", vendorName: "  ACME　科技  ", vendorTaxId: "12345678", contactPerson: "林小姐", phone: "02-1111", createdAt: "2026-01-01" },
    { employeeId: "E001", vendorName: "ACME 科技", vendorTaxId: "87654321", contactPerson: "", phone: "", fax: "02-9999", createdAt: "2026-02-01" }
  ], "E001");
  const vendor = findPersonalVendor(vendors, " acme 科技 ");

  assert.equal(vendors.length, 1);
  assert.equal(vendor.vendorTaxId, "87654321");
  assert.equal(vendor.contactPerson, "林小姐");
  assert.equal(vendor.phone, "02-1111");
  assert.equal(vendor.fax, "02-9999");
  assert.equal(vendor.requestCount, 2);
});
