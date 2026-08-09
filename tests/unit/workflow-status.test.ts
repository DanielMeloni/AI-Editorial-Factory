import { describe, expect, it } from 'vitest';
import {
  RUN_STATUSES,
  RUN_STATUS_LABELS,
  RUN_STATUS_TONES,
  isTerminalStatus,
} from '@/lib/workflow/status';

describe('vocabolario degli stati', () => {
  it('copre i sette stati previsti dalle specifiche', () => {
    expect(RUN_STATUSES).toHaveLength(7);
  });

  it('associa a ogni stato un’etichetta italiana e un tono cromatico', () => {
    for (const status of RUN_STATUSES) {
      expect(RUN_STATUS_LABELS[status]).toBeTruthy();
      expect(RUN_STATUS_TONES[status]).toBeTruthy();
    }
  });

  it('distingue gli stati terminali da quelli in corso', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('completed_with_warnings')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('awaiting_approval')).toBe(false);
  });
});
