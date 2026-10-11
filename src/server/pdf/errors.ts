import 'server-only';
export class ReportError extends Error {
  constructor(
    public readonly code:
      'INVALID' | 'NO_DATA' | 'RUNTIME' | 'BUSY' | 'OVERSIZED',
    public readonly status: number,
  ) {
    super(code);
  }
}
