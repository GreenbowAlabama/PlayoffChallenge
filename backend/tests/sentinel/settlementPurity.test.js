/**
 * Settlement Purity Sentinel Tests
 *
 * Verifies that settlement service code does NOT import payment/webhook/Stripe code.
 *
 * Purpose: Enforce isolation - payment processing must never affect contest settlement.
 */

const fs = require('fs');
const path = require('path');

describe('Settlement Purity Sentinel', () => {
  let settlementContent;
  let scoringContent;

  beforeAll(() => {
    // Read settlement service files
    const settlementPath = path.join(__dirname, '../../services/settlementStrategy.js');
    settlementContent = fs.readFileSync(settlementPath, 'utf8');

    const scoringPath = path.join(__dirname, '../../services/scoringService.js');
    scoringContent = fs.readFileSync(scoringPath, 'utf8');
  });

  describe('settlementStrategy.js', () => {
    it('should NOT import Stripe SDK', () => {
      expect(settlementContent).not.toMatch(/require\(['"]stripe['"]\)/);
      expect(settlementContent).not.toMatch(/import.*stripe/i);
    });

    it('should NOT import StripeWebhookService', () => {
      expect(settlementContent).not.toMatch(/require\(['"].*StripeWebhook.*['"]\)/);
      expect(settlementContent).not.toMatch(/import.*StripeWebhook/i);
    });

    it('should NOT import PaymentIntentService', () => {
      expect(settlementContent).not.toMatch(/require\(['"].*PaymentIntent.*['"]\)/);
      expect(settlementContent).not.toMatch(/import.*PaymentIntent/i);
    });

    it('should NOT import payment error codes', () => {
      expect(settlementContent).not.toMatch(/require\(['"].*paymentErrorCodes.*['"]\)/);
      expect(settlementContent).not.toMatch(/import.*paymentErrorCodes/i);
    });

    it('should NOT import ledger repository', () => {
      expect(settlementContent).not.toMatch(/require\(['"].*LedgerRepository.*['"]\)/);
      expect(settlementContent).not.toMatch(/import.*LedgerRepository/i);
    });

    it('should NOT import payment intents repository', () => {
      expect(settlementContent).not.toMatch(/require\(['"].*PaymentIntentsRepository.*['"]\)/);
      expect(settlementContent).not.toMatch(/import.*PaymentIntentsRepository/i);
    });
  });

  describe('scoringService.js', () => {
    it('should NOT import Stripe SDK', () => {
      expect(scoringContent).not.toMatch(/require\(['"]stripe['"]\)/);
      expect(scoringContent).not.toMatch(/import.*stripe/i);
    });

    it('should NOT import StripeWebhookService', () => {
      expect(scoringContent).not.toMatch(/require\(['"].*StripeWebhook.*['"]\)/);
      expect(scoringContent).not.toMatch(/import.*StripeWebhook/i);
    });

    it('should NOT import PaymentIntentService', () => {
      expect(scoringContent).not.toMatch(/require\(['"].*PaymentIntent.*['"]\)/);
      expect(scoringContent).not.toMatch(/import.*PaymentIntent/i);
    });
  });
});
