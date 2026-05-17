/**
 * Shared types for the messaging providers. The pure shapes live here so test
 * fixtures and the outbox loop can reference them without dragging the
 * provider SDKs into the import graph.
 */

export type SendSuccess = {
  accepted: true;
  providerMessageId: string;
};

export type SendFailure = {
  accepted: false;
  errorCode: string;
  errorMessage: string;
};

export type SendResult = SendSuccess | SendFailure;
