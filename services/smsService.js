const axios = require("axios");
const { format } = require("date-fns");

/**
 * Send a raw SMS to one or more mobile numbers.
 * @param {string|string[]} mobiles         - single number or array of numbers
 * @param {string}          message         - SMS body (must match DLT template variables)
 * @param {string}          [templateId]    - optional DLT template ID override (default: DCJ_SMS_TEMPLATE_ID)
 * @param {string}          [senderOverride] - optional sender ID override (e.g. KNCPLE)
 */
const sendSMS = async (mobiles, message, templateId, senderOverride) => {
  try {
    // Accept array or single number; join with comma for bulk send
    const numberStr = Array.isArray(mobiles) ? mobiles.join(",") : String(mobiles);
    const tplId = templateId || process.env.DCJ_SMS_TEMPLATE_ID;
    const sender = senderOverride || process.env.DCJ_SMS_SENDER;

    console.log("SMS Params:", {
      key: process.env.DCJ_SMS_API_KEY,
      route: process.env.DCJ_SMS_ROUTE,
      sender: sender,
      number: numberStr,
      sms: message,
      templateid: tplId
    });

    const response = await axios.get(
      "https://account.dcjsms.in/api/smsapi",
      {
        params: {
          key: process.env.DCJ_SMS_API_KEY,
          route: process.env.DCJ_SMS_ROUTE,
          sender: sender,
          number: numberStr,
          sms: message,
          templateid: tplId
        }
      }
    );

    console.log("SMS Response:", response.data);
    return response.data;

  } catch (err) {
    console.log("SMS Error:", err.response?.data || err.message);
    return null;
  }
};


/**
 * Build the DLT-approved BOS DC SMS message and send it.
 *
 * Template (ID 170717807229566303):
 *   "Lifted {#var#} birds weighing {#var#} kg via vehicle No. {#var#}
 *    from {#var#} - {#var#}, {#var#} on {#var#}.
 *    KRISHI NUTRITION COMPANY PRIVATE LIMITED"
 *
 * Variable mapping:
 *   1. {#var#} = birds (number of birds)
 *   2. {#var#} = weight (kg)
 *   3. {#var#} = vehicle_no
 *   4. {#var#} = farmer_code (farmer supplier code)
 *   5. {#var#} = farmer_name
 *   6. {#var#} = farmer_address (street, street2, street3 from SAP)
 *   7. {#var#} = date
 *
 * @param {Object} params
 * @param {string|string[]} params.mobiles         - recipient number(s) (farmer only)
 * @param {number}          params.birds           - total bird count
 * @param {number}          params.weight          - total load weight (kg)
 * @param {string}          params.vehicle_no      - vehicle number
 * @param {string}          params.farmer_code     - farmer supplier code
 * @param {string}          params.farmer_name     - farmer name
 * @param {string}          params.farmer_address  - farmer address (street, street2, street3)
 * @param {Date|string}     params.date            - DC date
 */
const sendBosSmS = async ({
  mobiles,
  birds,
  weight,
  vehicle_no,
  farmer_code,
  farmer_name,
  farmer_address,
  date
}) => {
  try {
    const dateStr = date ? format(new Date(date), "dd/MM/yyyy") : "-";

    const message = `Lifted ${birds} birds weighing ${weight} kg via vehicle No. ${vehicle_no} from ${farmer_code} - ${farmer_name} on ${dateStr}. KRISHI NUTRITION COMPANY PRIVATE LIMITED`;

    return await sendSMS(mobiles, message);
  } catch (err) {
    console.log("sendBosSmS error:", err.message);
    return null;
  }
};

module.exports = { sendSMS, sendBosSmS };

/**
 * Build the DLT-approved BOS DC SMS message for the CUSTOMER and send it.
 *
 * Template (KNCPLE sender, ID 170717819340657414 — see DLT portal):
 *   "{#var#} Kg sold to {#var#} Vehicle {#var#}. Tentative Rate Rs.{#var#}/Kg.
 *    Existing Balance Rs.{#var#} KRISHI NUTRITION COMPANY PRIVATE LIMITED."
 *
 * Variable mapping:
 *   1. {#var#} = net_weight  – net kg sold (totalLoad - totalEmpty)
 *   2. {#var#} = farmer_label – farmer code + name (who supplied the birds)
 *   3. {#var#} = vehicle_no
 *   4. {#var#} = rate         – tentative rate per kg
 *   5. {#var#} = balance      – customer's existing outstanding balance (from SAP)
 *
 * @param {Object} params
 * @param {string|string[]} params.mobiles      - customer mobile number(s)
 * @param {number}          params.net_weight   - net kg sold
 * @param {string}          params.farmer_label - farmer code + name
 * @param {string}          params.vehicle_no   - vehicle number
 * @param {number|string}   params.rate         - tentative rate per kg
 * @param {number|string}   params.balance      - existing outstanding balance (Rs)
 */
const sendBosCustomerSMS = async ({
  mobiles,
  net_weight,
  farmer_label,
  vehicle_no,
  rate,
  balance
}) => {
  try {
    const message = `${net_weight} Kg sold to ${farmer_label} Vehicle ${vehicle_no}. Tentative Rate Rs.${rate}/Kg. Existing Balance Rs.${balance} KRISHI NUTRITION COMPANY PRIVATE LIMITED.`;
    // Use the customer-specific DLT template ID and force sender ID to 'KNCPLE'
    return await sendSMS(mobiles, message, process.env.DCJ_CUSTOMER_SMS_TEMPLATE_ID || process.env.DCJ_SMS_TEMPLATE_ID, 'KNCPLE');
  } catch (err) {
    console.log("sendBosCustomerSMS error:", err.message);
    return null;
  }
};

module.exports = { sendSMS, sendBosSmS, sendBosCustomerSMS };