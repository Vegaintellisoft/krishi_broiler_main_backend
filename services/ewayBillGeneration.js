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
 * COMMON AUTH HANDLER WITH TOKEN CACHING
 */
async function getSaralTokens(forceRefresh = false) {
  const now = Date.now();
  if (forceRefresh) {
    cachedTokens = null;
    tokenExpiry = 0;
  }
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
    // Cache for 2 hours
    tokenExpiry = now + (2 * 60 * 60 * 1000);

    return cachedTokens;
  } catch (error) {
    cachedTokens = null;
    tokenExpiry = 0;
    console.error("Saral Authentication Failed:", error.response?.data || error.message);
    throw new Error("Saral authentication failed: " + (error.response?.data?.message || error.message));
  }
}

/**
 * Check if the Saral / NIC response indicates an expired or invalid auth token (Error 238, etc.)
 */
function isTokenExpiredError(data) {
  if (!data) return false;

  const tokenErrorCodes = ["238", "215", "218", "228"];
  const errorCodesStr = String(data.errorCodes || "");
  const hasCode = errorCodesStr.split(",").some((code) => tokenErrorCodes.includes(code.trim()));
  if (hasCode) return true;

  if (Array.isArray(data.errorDetails)) {
    return data.errorDetails.some((err) => {
      const code = String(err.errorCode || "").trim();
      const msg = String(err.errorMessage || "").toLowerCase();
      return (
        tokenErrorCodes.includes(code) ||
        msg.includes("invalid auth token") ||
        msg.includes("token expired") ||
        msg.includes("auth token")
      );
    });
  }

  return false;
}

/**
 * Centralized API caller that handles authentication and automatically retries
 * once if the server returns 401 or if the response body contains Error 238.
 */
async function callEwayApi(payload, action) {
  let tokens = await getSaralTokens();

  const makeRequest = (currentTokens) => {
    return axios.post(
      `${SARAL_BASE}/v1.03/ewayapi`,
      payload,
      {
        headers: {
          authenticationToken: currentTokens.authenticationToken,
          subscriptionId: currentTokens.subscriptionId,
          username: USERNAME,
          Gstin: GSTIN,
          AuthToken: currentTokens.authToken,
          sek: currentTokens.sek,
          action: action,
          Server: 1,
        },
        timeout: API_TIMEOUT,
      }
    );
  };

  let ewayRes;
  try {
    ewayRes = await makeRequest(tokens);
  } catch (apiErr) {
    // If HTTP 401 Unauthorized, refresh and retry once
    if (apiErr.response?.status === 401) {
      console.log("Saral returned HTTP 401. Refreshing token and retrying...");
      tokens = await getSaralTokens(true);
      ewayRes = await makeRequest(tokens);
    } else {
      throw apiErr;
    }
  }

  // If HTTP is 200 OK but response contains Error 238 (Invalid Auth Token), auto-refresh and retry once
  if (isTokenExpiredError(ewayRes.data)) {
    console.warn("E-Way Bill API returned Error 238 / Invalid Auth Token. Refreshing token and retrying...");
    tokens = await getSaralTokens(true);
    ewayRes = await makeRequest(tokens);
  }

  return ewayRes.data;
}

/**
 * GENERATE E-WAY BILL
 */
async function fetchEWayBillNumber(invoicePayload) {
  try {
    const data = await callEwayApi(invoicePayload, "GENEWAYBILL");

    if (data.errorCodes) {
      const detailMsg = data.errorDetails?.map((e) => e.errorMessage).filter(Boolean).join(", ");
      const errorMsg = detailMsg ? `E-Way Error (${data.errorCodes}): ${detailMsg}` : `E-Way Error Codes: ${data.errorCodes}`;
      return { error: errorMsg };
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
    const data = await callEwayApi(cancelPayload, "CANEWB");
    return data;
  } catch (error) {
    console.error("E-Way Bill Cancellation Failed:", error.response?.data || error.message);
    return { error: error.message };
  }
}

module.exports = {
  fetchEWayBillNumber,
  cancelEway,
};
