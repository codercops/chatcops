/** The model declined to answer. */
export class RefusalError extends Error {
  constructor() {
    super('The model declined to answer this request (refusal).');
    this.name = 'RefusalError';
  }
}

/** The provider's safety filter stopped the reply. */
export class ContentFilterError extends Error {
  constructor() {
    super("The provider's content filter stopped the reply.");
    this.name = 'ContentFilterError';
  }
}

/** The model kept asking for tools after the last allowed round. */
export class MaxStepsError extends Error {
  constructor(readonly toolRounds: number) {
    super(`Exceeded maximum tool rounds (${toolRounds}).`);
    this.name = 'MaxStepsError';
  }
}
