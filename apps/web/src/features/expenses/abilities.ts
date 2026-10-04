/** Mirror of the server-side ability object returned with every expense. */
export interface ExpenseAbilities {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canPay: boolean;
  canRecall: boolean;
  canRevise: boolean;
  canDuplicate: boolean;
  canPostAccounting: boolean;
}
