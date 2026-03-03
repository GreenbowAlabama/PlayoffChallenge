/**
 * Financial Alert Service
 *
 * Sends reconciliation alerts via multiple channels:
 * 1. Slack webhook (preferred)
 * 2. Email (fallback)
 * 3. Console log (final fallback)
 */

const axios = require('axios');

/**
 * Format cents as USD currency string
 */
function formatCurrency(cents) {
  const dollars = (cents / 100).toFixed(2);
  return `$${dollars}`;
}

/**
 * Send alert via Slack webhook
 */
async function sendSlackAlert(payload) {
  const webhookUrl = process.env.FINANCE_ALERT_SLACK_WEBHOOK;
  if (!webhookUrl) {
    console.log('[Alert] FINANCE_ALERT_SLACK_WEBHOOK not configured');
    return false;
  }

  try {
    const emoji = payload.status === 'CRITICAL' ? '🚨' : '⚠️';
    const color = payload.status === 'CRITICAL' ? 'danger' : 'warning';

    const message = {
      attachments: [
        {
          color,
          title: `${emoji} Financial Reconciliation ${payload.status}`,
          title_link: process.env.ADMIN_DASHBOARD_URL || 'https://admin.playoffchallenge.com',
          text: payload.reason,
          fields: [
            {
              title: 'Stripe Available',
              value: formatCurrency(payload.stripeBalance),
              short: true,
            },
            {
              title: 'Wallet Balances',
              value: formatCurrency(payload.walletBalance),
              short: true,
            },
            {
              title: 'Contest Pools',
              value: formatCurrency(payload.contestPoolBalance),
              short: true,
            },
            {
              title: 'Pending Withdrawals',
              value: formatCurrency(payload.pendingWithdrawals),
              short: true,
            },
            {
              title: 'Platform Float',
              value: formatCurrency(payload.platformFloat),
              short: true,
            },
            {
              title: 'Discrepancy',
              value: formatCurrency(payload.difference),
              short: true,
            },
          ],
          footer: 'Financial Reconciliation System',
          ts: Math.floor(new Date(payload.timestamp).getTime() / 1000),
        },
      ],
    };

    await axios.post(webhookUrl, message, {
      timeout: 5000,
    });

    console.log('[Alert] Slack notification sent');
    return true;
  } catch (err) {
    console.error('[Alert] Slack error:', err.message);
    return false;
  }
}

/**
 * Send alert via email (placeholder for email service integration)
 */
async function sendEmailAlert(payload) {
  const toEmail = process.env.FINANCE_ALERT_EMAIL;
  if (!toEmail) {
    console.log('[Alert] FINANCE_ALERT_EMAIL not configured');
    return false;
  }

  try {
    // Placeholder: integrate with your email service (SendGrid, AWS SES, etc.)
    console.log('[Alert] Email notification placeholder', {
      to: toEmail,
      subject: `Financial Reconciliation ${payload.status}`,
      body: JSON.stringify(payload, null, 2),
    });

    // TODO: Implement actual email sending
    // await emailService.send({
    //   to: toEmail,
    //   subject: `⚠️ Financial Reconciliation ${payload.status}`,
    //   html: renderEmailTemplate(payload),
    // });

    return false; // Not yet implemented
  } catch (err) {
    console.error('[Alert] Email error:', err.message);
    return false;
  }
}

/**
 * Send alert via console log (final fallback)
 */
function sendConsoleAlert(payload) {
  const emoji = payload.status === 'CRITICAL' ? '🚨' : '⚠️';
  console.warn(`
╔═══════════════════════════════════════════════════════╗
║ ${emoji} FINANCIAL RECONCILIATION ALERT (${payload.status})    ║
╠═══════════════════════════════════════════════════════╣
║ Stripe Balance:        ${formatCurrency(payload.stripeBalance).padEnd(30)}║
║ Wallet Balances:       ${formatCurrency(payload.walletBalance).padEnd(30)}║
║ Contest Pools:         ${formatCurrency(payload.contestPoolBalance).padEnd(30)}║
║ Pending Withdrawals:   ${formatCurrency(payload.pendingWithdrawals).padEnd(30)}║
║ Platform Float:        ${formatCurrency(payload.platformFloat).padEnd(30)}║
║ Discrepancy:           ${formatCurrency(payload.difference).padEnd(30)}║
║ Reason:                ${payload.reason.substring(0, 30).padEnd(30)}║
║ Timestamp:             ${new Date(payload.timestamp).toISOString().padEnd(30)}║
╚═══════════════════════════════════════════════════════╝
  `);
  return true;
}

/**
 * Send financial alert via multiple channels
 *
 * Tries in order:
 * 1. Slack (if webhook configured)
 * 2. Email (if email configured)
 * 3. Console (always)
 *
 * Returns: { sent: boolean, channel: string | null }
 */
async function sendFinancialAlert(payload) {
  try {
    // Try Slack first (preferred)
    const slackSent = await sendSlackAlert(payload);
    if (slackSent) {
      return { sent: true, channel: 'SLACK' };
    }

    // Fall back to email
    const emailSent = await sendEmailAlert(payload);
    if (emailSent) {
      return { sent: true, channel: 'EMAIL' };
    }

    // Final fallback to console
    sendConsoleAlert(payload);
    return { sent: true, channel: 'CONSOLE' };
  } catch (err) {
    console.error('[Alert] Unexpected error:', err.message);
    sendConsoleAlert(payload);
    return { sent: true, channel: 'CONSOLE' };
  }
}

module.exports = {
  sendFinancialAlert,
  sendSlackAlert,
  sendEmailAlert,
  sendConsoleAlert,
};
