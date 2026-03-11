/**
 * Tests for reset-db.sql script
 *
 * Verifies:
 * 1. Staging confirmation guard (confirm_staging=YES required)
 * 2. Verification block executes BEFORE final COMMIT
 * 3. Contest pool invariant includes all entry types:
 *    - ENTRY_FEE (DEBIT)
 *    - ENTRY_FEE_REFUND (CREDIT)
 *    - PRIZE_PAYOUT (CREDIT)
 *    - PRIZE_PAYOUT_REVERSAL (DEBIT)
 */

const fs = require('fs');
const path = require('path');

describe('reset-db.sql script', () => {
  let scriptContent;

  beforeAll(() => {
    const scriptPath = path.join(
      __dirname,
      '../../scripts/reset-environment/reset-db.sql'
    );
    scriptContent = fs.readFileSync(scriptPath, 'utf8');
  });

  describe('Staging confirmation guard', () => {
    it('should require confirm_staging=YES to prevent accidental execution', () => {
      expect(scriptContent).toContain("confirm_staging', true)");
      expect(scriptContent).toContain('confirm_staging=YES');
      expect(scriptContent).toContain(
        'Execution aborted. You must run this script with -v confirm_staging=YES'
      );
    });

    it('should check confirm_staging BEFORE any destructive operations', () => {
      const guardMatch = scriptContent.match(
        /DO \$\$[\s\S]*?confirm_staging[\s\S]*?END \$\$/
      );
      const beginMatch = scriptContent.match(/^BEGIN;/m);

      expect(guardMatch).toBeTruthy();
      expect(guardMatch[0].indexOf('confirm_staging') > -1).toBe(true);
      // Guard should appear before BEGIN
      expect(scriptContent.indexOf(guardMatch[0]) < scriptContent.indexOf('BEGIN;')).toBe(true);
    });
  });

  describe('Transaction structure (verification before COMMIT)', () => {
    it('should have verification block BEFORE the final COMMIT', () => {
      // Find the main transaction BEGIN
      const mainBeginIdx = scriptContent.indexOf('\nBEGIN;');
      const mainCommitIdx = scriptContent.indexOf('\nCOMMIT;');
      const verificationBlockIdx = scriptContent.indexOf(
        'POST-PURGE VERIFICATION'
      );

      expect(mainBeginIdx).toBeGreaterThan(-1);
      expect(mainCommitIdx).toBeGreaterThan(-1);
      expect(verificationBlockIdx).toBeGreaterThan(-1);

      // Verification block should come AFTER BEGIN and BEFORE COMMIT
      expect(verificationBlockIdx).toBeGreaterThan(mainBeginIdx);
      expect(verificationBlockIdx).toBeLessThan(mainCommitIdx);
    });

    it('should have verification DO block inside the transaction', () => {
      const verificationDoBlock = scriptContent.match(
        /BEGIN;[\s\S]*?DO \$\$[\s\S]*?END \$\$;[\s\S]*?COMMIT;/m
      );
      expect(verificationDoBlock).toBeTruthy();
    });

    it('should COMMIT only after verification completes', () => {
      // Extract the structure after BEGIN
      const afterBegin = scriptContent.substring(
        scriptContent.indexOf('\nBEGIN;')
      );

      // Should have: destructive ops → verification DO block → COMMIT
      const verificationIdx = afterBegin.indexOf('POST-PURGE VERIFICATION');
      const commitIdx = afterBegin.indexOf('\nCOMMIT;');

      expect(verificationIdx).toBeGreaterThan(-1);
      expect(commitIdx).toBeGreaterThan(verificationIdx);
    });
  });

  describe('Contest pool invariant calculation', () => {
    it('should include ENTRY_FEE (DEBIT) in contest pool calculation', () => {
      expect(scriptContent).toContain(
        "entry_type = 'ENTRY_FEE' AND direction = 'DEBIT'"
      );
    });

    it('should include ENTRY_FEE_REFUND (CREDIT) in contest pool calculation', () => {
      expect(scriptContent).toContain(
        "entry_type = 'ENTRY_FEE_REFUND' AND direction = 'CREDIT'"
      );
    });

    it('should include PRIZE_PAYOUT (CREDIT) in contest pool calculation', () => {
      expect(scriptContent).toContain(
        "entry_type = 'PRIZE_PAYOUT' AND direction = 'CREDIT'"
      );
    });

    it('should include PRIZE_PAYOUT_REVERSAL (DEBIT) in contest pool calculation', () => {
      expect(scriptContent).toContain(
        "entry_type = 'PRIZE_PAYOUT_REVERSAL' AND direction = 'DEBIT'"
      );
    });

    it('should calculate contest_pools as: ENTRY_FEE - ENTRY_FEE_REFUND - PRIZE_PAYOUT + PRIZE_PAYOUT_REVERSAL', () => {
      // Extract the contest_pools CASE statement
      const contestPoolsMatch = scriptContent.match(
        /-- contest_pools[\s\S]*?INTO v_contest_pools FROM ledger;/
      );
      expect(contestPoolsMatch).toBeTruthy();

      const contestPoolsBlock = contestPoolsMatch[0];

      // Check all entry types are present
      expect(contestPoolsBlock).toContain('ENTRY_FEE');
      expect(contestPoolsBlock).toContain('ENTRY_FEE_REFUND');
      expect(contestPoolsBlock).toContain('PRIZE_PAYOUT');
      expect(contestPoolsBlock).toContain('PRIZE_PAYOUT_REVERSAL');

      // Verify the CASE logic for direction handling
      // ENTRY_FEE DEBIT should ADD (THEN amount_cents)
      // ENTRY_FEE_REFUND CREDIT should SUBTRACT (THEN -amount_cents)
      // PRIZE_PAYOUT CREDIT should SUBTRACT (THEN -amount_cents)
      // PRIZE_PAYOUT_REVERSAL DEBIT should ADD (THEN amount_cents)

      // Use regex to handle whitespace variations
      expect(contestPoolsBlock).toMatch(
        /WHEN entry_type = 'ENTRY_FEE' AND direction = 'DEBIT'\s+THEN amount_cents/
      );
      expect(contestPoolsBlock).toMatch(
        /WHEN entry_type = 'ENTRY_FEE_REFUND' AND direction = 'CREDIT'\s+THEN -amount_cents/
      );
      expect(contestPoolsBlock).toMatch(
        /WHEN entry_type = 'PRIZE_PAYOUT' AND direction = 'CREDIT'\s+THEN -amount_cents/
      );
      expect(contestPoolsBlock).toMatch(
        /WHEN entry_type = 'PRIZE_PAYOUT_REVERSAL' AND direction = 'DEBIT'\s+THEN amount_cents/
      );
    });

    it('should verify contest_pools is 0 after reset', () => {
      expect(scriptContent).toContain(
        'IF v_contest_pools != 0 THEN RAISE EXCEPTION'
      );
    });
  });

  describe('System user enforcement', () => {
    it('should preserve only the canonical system user (00000000-0000-0000-0000-000000000000)', () => {
      expect(scriptContent).toContain(
        "id != '00000000-0000-0000-0000-000000000000'"
      );
    });

    it('should insert/upsert the canonical system user', () => {
      expect(scriptContent).toContain(
        "'00000000-0000-0000-0000-000000000000'"
      );
      expect(scriptContent).toContain('INSERT INTO users');
      expect(scriptContent).toContain('ON CONFLICT (id) DO UPDATE');
    });
  });
});
