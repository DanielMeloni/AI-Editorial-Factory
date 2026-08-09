import { defineHook } from 'workflow';

/**
 * Gate di approvazione umana.
 *
 * Il workflow si sospende qui e non consuma risorse finché non arriva una
 * decisione. La chiusura del browser è irrilevante: lo stato vive nel motore
 * dei workflow, non nella sessione.
 *
 * Nessun agente può oltrepassare questo punto da solo.
 */
export const approvalHook = defineHook<{
  decision: 'approved' | 'rejected' | 'changes_requested';
  note?: string;
  decidedBy?: string;
}>();
