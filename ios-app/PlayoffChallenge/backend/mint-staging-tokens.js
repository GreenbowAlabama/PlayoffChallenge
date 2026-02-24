#!/usr/bin/env node

const jwt = require('jsonwebtoken');

const secret = process.env.ADMIN_JWT_SECRET;
const adminUserId = process.env.ADMIN_USER_ID;
const nonAdminUserId = process.env.NON_ADMIN_USER_ID;

if (!secret) {
  console.error('ERROR: ADMIN_JWT_SECRET required');
  process.exit(1);
}

if (!adminUserId || !nonAdminUserId) {
  console.error('ERROR: Both ADMIN_USER_ID and NON_ADMIN_USER_ID required');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const exp = now + 3600;

const adminPayload = {
  sub: adminUserId,
  is_admin: true,
  role: 'admin',
  exp
};

const nonAdminPayload = {
  sub: nonAdminUserId,
  is_admin: false,
  role: 'user',
  exp
};

const adminToken = jwt.sign(adminPayload, secret, { algorithm: 'HS256' });
const nonAdminToken = jwt.sign(nonAdminPayload, secret, { algorithm: 'HS256' });

console.log('ADMIN_TOKEN=' + adminToken);
console.log('NON_ADMIN_TOKEN=' + nonAdminToken);
