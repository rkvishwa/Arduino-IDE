const { randomUUID } = require("node:crypto");

class SecurityManager {
  constructor() {
    this.pendingApprovals = new Map();
  }

  createApproval(request) {
    const requestId = randomUUID();
    const approval = {
      requestId,
      createdAt: new Date().toISOString(),
      ...request,
    };

    this.pendingApprovals.set(requestId, approval);
    return approval;
  }

  hasPendingApproval(requestId) {
    return this.pendingApprovals.has(requestId);
  }

  async resolveApproval(requestId, approved) {
    const approval = this.pendingApprovals.get(requestId);
    if (!approval) {
      throw new Error("This approval request no longer exists.");
    }

    this.pendingApprovals.delete(requestId);

    if (!approved) {
      return {
        approved: false,
        toolName: approval.toolName,
        output: "The requested action was denied by the user.",
      };
    }

    return approval.execute();
  }
}

module.exports = {
  SecurityManager,
};
