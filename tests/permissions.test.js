const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUserRoles,
  canReadRequest,
  canEditRequest,
  canApprove
} = require("../api/_lib/domain-postgres");

const request = {
  employeeId: "B002",
  departmentCode: "ADM01",
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  approvalStatus: { currentStep: "unitManager" }
};

test("legacy workflow roles migrate into separate system and approval roles", () => {
  assert.deepEqual(normalizeUserRoles({ role: "unitManager" }), {
    role: "user",
    approvalRole: "unitManager"
  });
  assert.deepEqual(normalizeUserRoles({ role: "generalManager" }), {
    role: "manager",
    approvalRole: "generalManager"
  });
  assert.deepEqual(normalizeUserRoles({ role: "最高權限" }), {
    role: "superAdmin",
    approvalRole: ""
  });
});

test("general employees are limited to their own requests", () => {
  const employee = { employeeId: "B002", role: "user" };
  assert.equal(canReadRequest(employee, request), true);
  assert.equal(canEditRequest(employee, request), true);
  assert.equal(canReadRequest({ ...employee, employeeId: "B003" }, request), false);
});

test("managers can view all requests but cannot edit or approve them by system role alone", () => {
  const manager = { employeeId: "M001", role: "manager", departmentCode: "OTHER" };
  assert.equal(canReadRequest(manager, request), true);
  assert.equal(canEditRequest(manager, request), false);
  assert.equal(canApprove(manager, request), false);
});

test("approval roles remain department-scoped and distinct from system access", () => {
  const unitManager = {
    employeeId: "M002",
    role: "manager",
    approvalRole: "unitManager",
    departmentCode: "ADM01"
  };
  assert.equal(canReadRequest(unitManager, request), true);
  assert.equal(canApprove(unitManager, request), true);
  assert.equal(canApprove({ ...unitManager, departmentCode: "OTHER" }, request), false);
});

test("only a super administrator receives the system override", () => {
  const superAdmin = { employeeId: "A001", role: "superAdmin" };
  assert.equal(canReadRequest(superAdmin, request), true);
  assert.equal(canEditRequest(superAdmin, request), true);
  assert.equal(canApprove(superAdmin, request), true);
});
