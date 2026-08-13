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

/**
 * COMMON AUTH HANDLER
 */
async function getSaralTokens() {
  try {
    // 1. Authenticate
    const authRes = await axios.get(
      `${SARAL_BASE}/authentication/Authenticate`,
      {
        headers: {
          ClientId: CLIENT_ID,
          ClientSecret: CLIENT_SECRET,
        },
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
      }
    );

    const { authToken, sek } = invoiceAuthRes.data.data;

    return {
      authenticationToken,
      subscriptionId,
      authToken,
      sek,
    };
  } catch (error) {
    console.error("🚨 Saral Authentication Failed");

    if (error.response?.data) {
      console.error(error.response.data);
    } else {
      console.error(error.message);
    }

    throw new Error("Saral authentication failed");
  }
}

/**
 * GENERATE E-WAY BILL
 */
async function fetchEWayBillNumber(invoicePayload) {
  try {
    const { authenticationToken, subscriptionId, authToken, sek } =
      await getSaralTokens();

    const ewayRes = await axios.post(
      `${SARAL_BASE}/v1.03/ewayapi`,
      invoicePayload,
      {
        headers: {
          authenticationToken,
          subscriptionId,
          username: USERNAME,
          Gstin: GSTIN,
          AuthToken: authToken,
          sek,
          action: "GENEWAYBILL",
          Server: 1,
        },
      }
    );

    const data = ewayRes.data;

    // Saral error codes
    if (data.errorCodes) {
      return { error: `E-Way Error Codes: ${data.errorCodes}` };
    }

    // Missing e-way bill number
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
    
      {/* 
        // 3. Generate IRN
        const irnRes = await axios.post(`${SARAL_BASE}/eicore/v1.03/Invoice`, invoicePayload, {
          headers: {
            authenticationToken,
            subscriptionId,
            username,
            Gstin: gstin,
            AuthToken: authToken,
            sek,
            Server: 1
          }
        });

        console.log("Irn res data : ", irnRes.data);
      
        // if (irnRes.data.status !== 1 || !irnRes.data.irn) {
        //   const errorDetails = irnRes.data.errorDetails || [];
        //   const errorMessage = errorDetails.map(e => e.errorMessage).join(', ') || 'Unknown error';
        //   console.error("🚨 Error generating IRN:", errorMessage);
        //   return { error: errorMessage };
        // }

        const { irn, ewbNo } = irnRes.data;
      
        // If E-waybill already generated with IRN
        if (ewbNo) return { ewbNo: ewbNo, irn: irn };
      
        // 4. Generate E-way bill
        ewayPayload.Irn = irn;
        const ewayRes = await axios.post(`${SARAL_BASE}/eiewb/v1.03/ewaybill`, ewayPayload, {
          headers: {
            authenticationToken,
            subscriptionId,
            username,
            Gstin: gstin,
            AuthToken: authToken,
            sek,
            action: 'GENEWAYBILL',
            Server: 1
          }
        });

        console.log("E way bill data : ", ewayRes.data);

        // Check for errors in E-waybill response
        if (!ewayRes.data.ewbNo) {
          const errorDetails = ewayRes.data.errorDetails || [];
          const errorMessage = errorDetails.map(e => e.errorMessage).join(', ') || 'Unknown error';
          console.error("🚨 Error generating E-way bill:", errorMessage);
          return { error: errorMessage }; // Return error and stop further execution
        }

        return {
          ewbNo: ewayRes.data.ewbNo,
          ewbDate: ewayRes.data.ewbDt,
          ewbValidTill: ewayRes.data.ewbValidTill,
          distance: parseInt(ewayRes.data.remarks.match(/\d+/)?.[0] || 0, 10),
          irn: irn
        };

    */}

  } catch (error) {
    console.error("🚨 E-Way Bill Generation Failed");

    if (error.response?.data) {
      console.error(error.response.data);
    } else {
      console.error(error.message);
    }

    return { error: error.message };
  }
}

/**
 * CANCEL E-WAY BILL
 */
async function cancelEway(cancelPayload) {
  // const cancelPayload = {
  //   ewbNo: 131318499920,
  //   cancelRsnCode: 2,
  //   cancelRank: "Cancelled the order"
  // }
  try {
    const { authenticationToken, subscriptionId, authToken, sek } =
      await getSaralTokens();

    const cancelRes = await axios.post(
      `${SARAL_BASE}/v1.03/ewayapi`,
      cancelPayload,
      {
        headers: {
          authenticationToken,
          subscriptionId,
          username: USERNAME,
          Gstin: GSTIN,
          AuthToken: authToken,
          sek,
          action: "CANEWB",
        },
      }
    );

    return cancelRes.data;
  } catch (error) {
    console.error("🚨 E-Way Bill Cancellation Failed");

    if (error.response?.data) {
      console.error(error.response.data);
    } else {
      console.error(error.message);
    }

    return { error: error.message };
  }
}

module.exports = {
  fetchEWayBillNumber,
  cancelEway,
};
