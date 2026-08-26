const axios = require("axios");

/**
 * ENV CONFIG
 */
const SARAL_BASE = process.env.SARAL_BASE_URL;
const CLIENT_ID = process.env.SARAL_CLIENT_ID;
const CLIENT_SECRET = process.env.SARAL_CLIENT_SECRET;
const USERNAME = process.env.SARAL_USERNAME;
const PASSWORD = process.env.SARAL_PASSWORD;
const GSTIN = process.env.SARAL_GSTIN;

const API_TIMEOUT = 12000; // 12s timeout to prevent hanging

let cachedTokens = null;
let tokenExpiry = 0;

/**
 * COMMON AUTH HANDLER WITH 4-HOUR TOKEN CACHING
 */
async function getSaralTokens(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedTokens && now < tokenExpiry) {
    return cachedTokens;
  }

  try {
    // 1. Authenticate
    const authRes = await axios.get(
      `${SARAL_BASE}/authentication/Authenticate`,
      {
        headers: {
          ClientId: CLIENT_ID,
          ClientSecret: CLIENT_SECRET,
        },
        timeout: API_TIMEOUT,
      }
    );

    const { authenticationToken, subscriptionId } = authRes.data;

    // 2. E-Invoice Auth
    const invoiceAuthRes = await axios.post(
      `${SARAL_BASE}/eivital/v1.04/auth`,
      {},
      {
        headers: {
          authenticationToken,
          subscriptionId,
          username: USERNAME,
          password: PASSWORD,
          Gstin: GSTIN,
          Server: 1,
        },
        timeout: API_TIMEOUT,
      }
    );

    const { authToken, sek } = invoiceAuthRes.data.data;

    cachedTokens = {
      authenticationToken,
      subscriptionId,
      authToken,
      sek,
    };
    // Cache for 4 hours
    tokenExpiry = now + (4 * 60 * 60 * 1000);

    return cachedTokens;
  } catch (error) {
    cachedTokens = null;
    tokenExpiry = 0;
    console.error("Saral Authentication Failed:", error.response?.data || error.message);
    throw new Error("Saral authentication failed: " + (error.response?.data?.message || error.message));
  }
}

/**
 * GENERATE E-WAY BILL
 */
async function fetchEWayBillNumber(invoicePayload) {
  try {
    let tokens = await getSaralTokens();

    let ewayRes;
    try {
      ewayRes = await axios.post(
        `${SARAL_BASE}/v1.03/ewayapi`,
        invoicePayload,
        {
          headers: {
            authenticationToken: tokens.authenticationToken,
            subscriptionId: tokens.subscriptionId,
            username: USERNAME,
            Gstin: GSTIN,
            AuthToken: tokens.authToken,
            sek: tokens.sek,
            action: "GENEWAYBILL",
            Server: 1,
          },
          timeout: API_TIMEOUT,
        }
      );
    } catch (apiErr) {
      // If 401 Unauthorized, token may have expired early — retry once with fresh tokens
      if (apiErr.response?.status === 401) {
        console.log("Saral token expired, refreshing and retrying...");
        tokens = await getSaralTokens(true);
        ewayRes = await axios.post(
          `${SARAL_BASE}/v1.03/ewayapi`,
          invoicePayload,
          {
            headers: {
              authenticationToken: tokens.authenticationToken,
              subscriptionId: tokens.subscriptionId,
              username: USERNAME,
              Gstin: GSTIN,
              AuthToken: tokens.authToken,
              sek: tokens.sek,
              action: "GENEWAYBILL",
              Server: 1,
            },
            timeout: API_TIMEOUT,
          }
        );
      } else {
        throw apiErr;
      }
    }

    const data = ewayRes.data;

    if (data.errorCodes) {
      return { error: `E-Way Error Codes: ${data.errorCodes}` };
    }

    if (!data.ewayBillNo) {
      const errorMessage =
        data.errorDetails?.map((e) => e.errorMessage).join(", ") ||
        "Unknown E-Way Bill error";
      return { error: errorMessage };
    }

    const distance = parseInt(
      data.alert?.match(/\d+/)?.[0] || 0,
      10
    );

    return {
      ewbNo: data.ewayBillNo,
      ewbDate: data.ewayBillDate,
      ewbValidTill: data.validUpto,
      distance,
    };
  } catch (error) {
    console.error("E-Way Bill Generation Failed:", error.response?.data || error.message);
    return { error: error.response?.data?.message || error.message };
  }
}

/**
 * CANCEL E-WAY BILL
 */
async function cancelEway(cancelPayload) {
  try {
    const tokens = await getSaralTokens();

    const cancelRes = await axios.post(
      `${SARAL_BASE}/v1.03/ewayapi`,
      cancelPayload,
      {
        headers: {
          authenticationToken: tokens.authenticationToken,
          subscriptionId: tokens.subscriptionId,
          username: USERNAME,
          Gstin: GSTIN,
          AuthToken: tokens.authToken,
          sek: tokens.sek,
          action: "CANEWB",
        },
        timeout: API_TIMEOUT,
      }
    );

    return cancelRes.data;
  } catch (error) {
    console.error("E-Way Bill Cancellation Failed:", error.response?.data || error.message);
    return { error: error.message };
  }
}

module.exports = {
  fetchEWayBillNumber,
  cancelEway,
};
