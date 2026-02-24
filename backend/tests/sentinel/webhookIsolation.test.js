/**
 * Webhook Isolation Sentinel Tests
 *
 * Verifies that webhook service code does NOT import contest lifecycle code.
 *
 * Purpose: Enforce isolation - payment processing must never transition contest state.
 */

const fs = require('fs');
const path = require('path');

describe('Webhook Isolation Sentinel', () => {
  let webhookServiceContent;
  let paymentIntentServiceContent;

  beforeAll(() => {
    // Read payment service files
    const webhookServicePath = path.join(__dirname, '../../services/StripeWebhookService.js');
    webhookServiceContent = fs.readFileSync(webhookServicePath, 'utf8');

    const paymentIntentPath = path.join(__dirname, '../../services/PaymentIntentService.js');
    paymentIntentServiceContent = fs.readFileSync(paymentIntentPath, 'utf8');
  });

  describe('StripeWebhookService.js', () => {
    it('should NOT import contestLifecycleAdvancer', () => {
      expect(webhookServiceContent).not.toMatch(/require\(['"].*contestLifecycleAdvancer.*['"]\)/);
      expect(webhookServiceContent).not.toMatch(/import.*contestLifecycleAdvancer/i);
    });

    it('should NOT import contestStateService', () => {
      expect(webhookServiceContent).not.toMatch(/require\(['"].*contestStateService.*['"]\)/);
      expect(webhookServiceContent).not.toMatch(/import.*contestStateService/i);
    });

    it('should NOT import customContestService', () => {
      expect(webhookServiceContent).not.toMatch(/require\(['"].*customContestService.*['"]\)/);
      expect(webhookServiceContent).not.toMatch(/import.*customContestService/i);
    });

    it('should NOT import any contest lifecycle related modules', () => {
      expect(webhookServiceContent).not.toMatch(/require\(['"].*[Cc]ontest[Ll]ifecycle.*['"]\)/);
      expect(webhookServiceContent).not.toMatch(/require\(['"].*[Cc]ontest[Aa]dvancer.*['"]\)/);
    });

    it('should NOT call any methods that mutate contest state', () => {
      expect(webhookServiceContent).not.toMatch(/lockContest/);
      expect(webhookServiceContent).not.toMatch(/advanceContest/);
      expect(webhookServiceContent).not.toMatch(/publishContest/);
      expect(webhookServiceContent).not.toMatch(/settleContest/);
      expect(webhookServiceContent).not.toMatch(/UPDATE contest_instances/);
      expect(webhookServiceContent).not.toMatch(/UPDATE contest_participants/);
    });

    it('should only interact with payment-related tables', () => {
      // Count references to payment/ledger tables
      const paymentTableRefs = (webhookServiceContent.match(/stripe_events|payment_intents|ledger/g) || []).length;
      // Should reference these tables
      expect(paymentTableRefs).toBeGreaterThan(0);

      // Should NOT reference contest or participant tables (outside of passed data)
      const forbiddenTableRefs = (webhookServiceContent.match(/\bupdate\s+contest_instances|update\s+contest_participants|delete\s+from\s+contest/i) || []).length;
      expect(forbiddenTableRefs).toBe(0);
    });
  });

  describe('PaymentIntentService.js', () => {
    it('should NOT import contestLifecycleAdvancer', () => {
      expect(paymentIntentServiceContent).not.toMatch(/require\(['"].*contestLifecycleAdvancer.*['"]\)/);
      expect(paymentIntentServiceContent).not.toMatch(/import.*contestLifecycleAdvancer/i);
    });

    it('should NOT import contestStateService', () => {
      expect(paymentIntentServiceContent).not.toMatch(/require\(['"].*contestStateService.*['"]\)/);
      expect(paymentIntentServiceContent).not.toMatch(/import.*contestStateService/i);
    });

    it('should NOT import customContestService', () => {
      expect(paymentIntentServiceContent).not.toMatch(/require\(['"].*customContestService.*['"]\)/);
      expect(paymentIntentServiceContent).not.toMatch(/import.*customContestService/i);
    });

    it('should NOT call any methods that mutate contest state', () => {
      expect(paymentIntentServiceContent).not.toMatch(/lockContest/);
      expect(paymentIntentServiceContent).not.toMatch(/advanceContest/);
      expect(paymentIntentServiceContent).not.toMatch(/publishContest/);
      expect(paymentIntentServiceContent).not.toMatch(/settleContest/);
      expect(paymentIntentServiceContent).not.toMatch(/UPDATE contest_instances/);
      expect(paymentIntentServiceContent).not.toMatch(/UPDATE contest_participants/);
    });
  });

  describe('Ledger Table Isolation', () => {
    it('should NOT write to contest_instances from payment code', () => {
      expect(webhookServiceContent + paymentIntentServiceContent)
        .not.toMatch(/UPDATE.*contest_instances|INSERT.*contest_instances/);
    });

    it('should NOT write to contest_participants from payment code', () => {
      expect(webhookServiceContent + paymentIntentServiceContent)
        .not.toMatch(/UPDATE.*contest_participants|INSERT.*contest_participants/);
    });

    it('should NOT read contest state in transaction with payment state', () => {
      // Webhook transactions should be isolated to payment tables
      expect(webhookServiceContent).not.toMatch(/SELECT.*contest_instances.*status|SELECT.*status.*FROM.*contest_instances/i);
    });
  });
});
