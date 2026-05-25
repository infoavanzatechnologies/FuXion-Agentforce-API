require('dotenv').config();
const axios = require('axios');
const qs    = require('qs');

// ─── OAuth ────────────────────────────────────────────────────────────────────

async function getSFToken() {
  const response = await axios.post(process.env.SF_TOKEN_URL, null, {
    params: {
      grant_type:    'client_credentials',
      client_id:     process.env.SF_CLIENT_ID,
      client_secret: process.env.SF_CLIENT_SECRET
    }
  });
  return response.data.access_token;
}

// ─── Card API helpers ─────────────────────────────────────────────────────────

const apexBase = () => process.env.SF_APEX_BASE_URL; // e.g. https://org.my.salesforce.com/services/apexrest

/**
 * Fetch the blocked card for a customer identified by their phone number.
 *
 * Expected Apex endpoint:
 *   GET /FuXionCardService/blocked?phone={e164_phone}
 *
 * Success response shape:
 *   { found: true, cardId, maskedNumber, rejectionReason }
 *
 * No-card response shape:
 *   { found: false }
 */
async function getBlockedCard(token, phone) {
  const url = `${apexBase()}/FuXionCardService/blocked`;
  console.log(`[SF] GET ${url}?phone=${phone}`);
  const res = await axios.get(url, {
    params:  { phone },
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data; // { found, cardId, maskedNumber, rejectionReason }
}

/**
 * Verify the card number + PIN entered by the customer.
 * Salesforce handles PIN comparison and unblocks the card on success.
 *
 * Expected Apex endpoint:
 *   POST /FuXionCardService/verify
 *   Body: { phone, cardNumber, pin }
 *
 * Success response shape:
 *   { verified: true, cardId, last4, message }
 *
 * Failure response shape:
 *   { verified: false, message }
 */
async function verifyCard(token, phone, cardNumber, pin) {
  const url = `${apexBase()}/FuXionCardService/verify`;
  const res = await axios.post(
    url,
    { phone, cardNumber, pin },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return res.data; // { verified, cardId, last4, message }
}

/**
 * Fetch all ACTIVE cards for a customer identified by their phone number.
 *
 * Expected Apex endpoint:
 *   GET /FuXionActiveCardsService?phone={e164_phone}
 *
 * Success response shape (array):
 *   [{ cardId, cardName, maskedNumber }, ...]
 *
 * Empty response shape:
 *   []
 */
async function getActiveCards(token, phone) {
  const url = `${apexBase()}/FuXionActiveCardsService`;
  console.log(`[SF] GET ${url}?phone=${phone}`);
  const res = await axios.get(url, {
    params:  { phone },
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data; // array of { cardId, cardName, maskedNumber }
}

/**
 * Block a card after verifying phone, card number, and PIN.
 * Salesforce handles PIN comparison and sets FinServ__Active__c = false on success.
 *
 * Expected Apex endpoint:
 *   POST /FuXionBlockCardService
 *   Body: { phone, cardNumber, pin }
 *
 * Success response shape:
 *   { blocked: true, cardId, last4, message }
 *
 * Failure response shape:
 *   { blocked: false, message }
 */
async function blockCard(token, phone, cardNumber, pin) {
  const url = `${apexBase()}/FuXionBlockCardService`;
  const res = await axios.post(
    url,
    { phone, cardNumber, pin },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return res.data; // { blocked, cardId, last4, message }
}

module.exports = { getSFToken, getBlockedCard, verifyCard, getActiveCards, blockCard };
