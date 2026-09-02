const puppeteer = require('puppeteer');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
const qs = require('qs');
const { format, parse, parseISO } = require('date-fns');
const axios = require('axios');

const { query } = require("../../config/db");
const broilerDataEntry = require("./sap/broilerDataEntry.json");
const { ToWords } = require("to-words");
const { asset, runtime } = require("../../utils/paths");
const { getChromiumPath, getKrishiLogoDataUri } = require("../../services/helper");
// const { sendSMS } = require("../../services/smsService");
const { sendBosSmS, sendBosCustomerSMS } = require("../../services/smsService");

const toWords = new ToWords({
    localeCode: 'en-IN', // Indian format
    converterOptions: {
        currency: true,
        ignoreDecimal: false
    }
});

// Extracts just the SAP code from "Code - Name" format strings.
// e.g. "FSZ00042 - KRISHNAMURTHI" → "FSZ00042"
// Used when sending codes to SAP API fields (lifnr, kunnr, werks, etc.)
const extractCodeOnly = (val) => {
    if (!val) return '';
    const str = String(val).trim();
    return str.includes(' - ') ? str.split(' - ')[0].trim() : str;
};

// Extracts just the Name from "Code - Name" format strings.
// e.g. "00011248 - TAMILVANAN.R" → "TAMILVANAN.R"
const extractNameOnly = (val) => {
    if (!val) return '';
    const str = String(val).trim();
    return str.includes(' - ') ? str.split(' - ').slice(1).join(' - ').trim() : '';
};

/**
 * Fetch employee info from SAP /emp_master endpoint.
 * Returns map of { [emp_id]: emp_name }
 */
const fetchSapEmployeeInfo = async () => {
    const empMap = {};
    try {
        const empUrl = `${process.env.BROILER_SAP_BASE_URL}/emp_master?sap-client=500`;
        const empRes = await axios.get(empUrl, {
            auth: { username: process.env.BROILER_SAP_USERNAME, password: process.env.BROILER_SAP_PASSWORD },
            timeout: 8000
        });
        if (empRes.status === 200 && Array.isArray(empRes.data)) {
            empRes.data.forEach(item => {
                const id = String(item.pernr || item.Pernr || item.emp_id || '').trim();
                const name = String(item.sname || item.Sname || item.emp_name || '').trim();
                if (id && name) {
                    empMap[id] = name;
                    empMap[id.replace(/^0+/, '')] = name;
                    empMap[id.padStart(8, '0')] = name;
                }
            });
            console.log(`fetchSapEmployeeInfo: Loaded ${Object.keys(empMap).length} employee entries from SAP.`);
        }
    } catch (e) {
        console.warn('fetchSapEmployeeInfo SAP lookup failed:', e.message);
    }
    return empMap;
};

/**
 * Fetch farmer + customer contact info from SAP /customer & /daily_mor endpoints.
 * Returns { farmerPhone, farmerName, farmerPlace, customerPhone, customerName }
 */
const fetchSapContactInfo = async (farmerCode, customerCode) => {
    let farmerPhone = null, farmerName = null, farmerAddress = null;
    let customerPhone = null, customerName = null;

    console.log(`fetchSapContactInfo: Lookup initiated for farmerCode: "${farmerCode}", customerCode: "${customerCode}"`);

    try {
        // Farmer info from /daily_mor (FSZ codes)
        const morUrl = `${process.env.BROILER_SAP_BASE_URL}/zdaily_mor?sap-client=500`;
        const morRes = await axios.get(
            morUrl,
            { auth: { username: process.env.BROILER_SAP_USERNAME, password: process.env.BROILER_SAP_PASSWORD }, timeout: 8000 }
        );
        if (morRes.status === 200 && Array.isArray(morRes.data)) {
            const farmer = morRes.data.find(f => String(f.lifnr).trim() === String(farmerCode).trim());
            if (farmer) {
                farmerPhone = farmer.telephone || null;
                farmerName  = farmer.name1 || farmerCode;
                const streetParts = [farmer.street, farmer.street2, farmer.street3].filter(Boolean).map(s => s.replace(/,\s*$/, '').trim()).filter(Boolean).join(', ');
                const districtPin = [farmer.zzlineN, farmer.postlcode].filter(Boolean).join(' - ');
                farmerAddress = [streetParts, districtPin].filter(Boolean).join(', ') || '';
                console.log(`fetchSapContactInfo: Farmer found in SAP API. Phone: "${farmerPhone}", Name: "${farmerName}", Address: "${farmerAddress}"`);
            } else {
                console.warn(`fetchSapContactInfo: Farmer "${farmerCode}" not found in SAP API list of ${morRes.data.length} records.`);
            }
        } else {
            console.warn(`fetchSapContactInfo: SAP daily_mor API returned status ${morRes.status} or invalid data:`, morRes.data);
        }
    } catch (e) { console.warn('SAP daily_mor lookup failed:', e.message); }

    try {
        // Customer info from /customer (D codes)
        const custUrl = `${process.env.BROILER_SAP_BASE_URL}/customer?sap-client=500`;
        const custRes = await axios.get(
            custUrl,
            { auth: { username: process.env.BROILER_SAP_USERNAME, password: process.env.BROILER_SAP_PASSWORD }, timeout: 8000 }
        );
        if (custRes.status === 200 && Array.isArray(custRes.data)) {
            const cust = custRes.data.find(c => String(c.kunnr).trim() === String(customerCode).trim());
            if (cust) {
                customerPhone = cust.telf1 || null;
                customerName  = cust.name1 || customerCode;
                console.log(`fetchSapContactInfo: Customer found in SAP API. Phone: "${customerPhone}", Name: "${customerName}"`);
            } else {
                console.warn(`fetchSapContactInfo: Customer "${customerCode}" not found in SAP API list of ${custRes.data.length} records.`);
            }
        } else {
            console.warn(`fetchSapContactInfo: SAP customer API returned status ${custRes.status} or invalid data:`, custRes.data);
        }
    } catch (e) { console.warn('SAP customer lookup failed:', e.message); }

    console.log(`fetchSapContactInfo: Lookup completed. Resolved Phone numbers: Farmer: "${farmerPhone}", Customer: "${customerPhone}"`);
    return { farmerPhone, farmerName, farmerAddress, customerPhone, customerName };
};

/**
 * Fetch customer phone + balance from SAP /customer endpoint.
 * Returns { customerPhone, customerBalance }
 */
const fetchCustomerInfo = async (customerCode) => {
    let customerPhone = null, customerBalance = 0, customerName = null;
    try {
        const custUrl = `${process.env.BROILER_SAP_BASE_URL}/customer?sap-client=500`;
        const custRes = await axios.get(custUrl, {
            auth: { username: process.env.BROILER_SAP_USERNAME, password: process.env.BROILER_SAP_PASSWORD },
            timeout: 8000
        });
        if (custRes.status === 200 && Array.isArray(custRes.data)) {
            const cust = custRes.data.find(c => String(c.kunnr).trim() === String(customerCode).trim());
            if (cust) {
                // SAP telf1 may contain multiple numbers separated by dash/comma
                // e.g. "8667529455-8612345678" or "8667529455,8612345678"
                // Extract the first valid 10-digit Indian mobile number
                const rawPhone = cust.telf1 || '';
                const phoneParts = rawPhone.split(/[-,\/;|]+/).map(p => p.replace(/\D/g, '').trim()).filter(Boolean);
                for (const part of phoneParts) {
                    // Accept 10-digit numbers starting with 6-9 (Indian mobile)
                    // or 12-digit with 91 prefix
                    let digits = part;
                    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
                    if (digits.length === 10 && /^[6-9]/.test(digits)) {
                        customerPhone = digits;
                        break;
                    }
                }
                if (!customerPhone && rawPhone.replace(/\D/g, '').length >= 10) {
                    // Fallback: take first 10 digits from the raw string
                    const allDigits = rawPhone.replace(/\D/g, '');
                    if (allDigits.length >= 12 && allDigits.startsWith('91')) {
                        customerPhone = allDigits.slice(2, 12);
                    } else {
                        customerPhone = allDigits.slice(0, 10);
                    }
                }
                customerBalance = cust.balance != null ? cust.balance : 0;
                customerName = cust.name1 || null;
                console.log(`fetchCustomerInfo: Customer "${customerCode}" found. Raw telf1: "${rawPhone}", Extracted phone: "${customerPhone}", Balance: ${customerBalance}, Name: "${customerName}"`);
            } else {
                console.warn(`fetchCustomerInfo: Customer "${customerCode}" not found in SAP response.`);
            }
        }
    } catch (e) { console.warn('fetchCustomerInfo SAP lookup failed:', e.message); }
    return { customerPhone, customerBalance, customerName };
};

const TABLE_NAME = "bill_of_supply";

const formatBillOfSupplyDataToSap = (data) => {
    const { load_details = [] } = data;

    const config = broilerDataEntry.bill_of_supply;

    // Aggregate all cage rows into a single totals object.
    const totalBirdQty     = load_details.reduce((sum, item) => sum + (Number(item.birdQty || item.birds || item.bird_qty) || 0), 0);
    const totalWeight      = load_details.reduce((sum, item) => sum + (Number(item.weight || item.netWeight || item.net_weight) || 0), 0);

    const effectiveRate    = Number(data.rate) || 0;
    const computedGross    = +(totalWeight * effectiveRate).toFixed(2);

    const totalGrossValue  = computedGross > 0 
        ? computedGross 
        : load_details.reduce((sum, item) => sum + (Number(item.gross_value || item.grossValue) || 0), 0);
    const totalBillValue   = computedGross > 0 
        ? computedGross 
        : load_details.reduce((sum, item) => sum + (Number(item.bill_value || item.billValue) || 0), 0);

    const totalEmptyWeight = load_details.reduce((sum, item) => sum + (Number(item.emptyWeight || item.empty_weight || item.emptyWt || item.empty) || 0), 0) || Number(data.emptyWeight || data.empty_weight || 0);
    const totalLoadWeight  = load_details.reduce((sum, item) => sum + (Number(item.loadWeight || item.load_weight || item.loadWt || item.load) || 0), 0) || Number(data.loadWeight || data.load_weight || 0);
    const totalCages       = load_details.reduce((sum, item) => sum + (Number(item.cage || item.cages || item.no_cages) || 0), 0);
    const avgWeight        = totalBirdQty > 0 ? +(totalWeight / totalBirdQty).toFixed(2) : 0;

    // Build one combined row: header-level data overridden by aggregated totals
    // SAP code fields must be plain codes (strip "Code - Name" format before sending to SAP)
    const aggregated = {
        ...data,
        // Strip "Code - Name" → just code for SAP API fields
        farmer:         extractCodeOnly(data.farmer),
        customer:       extractCodeOnly(data.customer),
        plant:          extractCodeOnly(data.plant),
        order_by:       extractCodeOnly(data.order_by),
        dispatch_by:    extractCodeOnly(data.dispatch_by),
        line_no:        extractCodeOnly(data.line_no),
        rate:           effectiveRate,
        birdQty:        totalBirdQty,
        weight:         +totalWeight.toFixed(3),
        gross_value:    +totalGrossValue.toFixed(2),
        bill_value:     +totalBillValue.toFixed(2),
        average_weight: avgWeight,
        emptyWeight:    +totalEmptyWeight.toFixed(3),
        loadWeight:     +totalLoadWeight.toFixed(3),
        cage:           totalCages,
        // bird_stock comes from data top-level (set by mobile or admin) — support all key variants
        bird_stock:     Number(data.bird_stock ?? data.birdStock ?? data.stock ?? 0),
        // Employee names for order_by / dispatch_by & Farmer Name (looked up before calling this function)
        order_by_name:    data.order_by_name    || extractNameOnly(data.order_by)    || '',
        dispatch_by_name: data.dispatch_by_name || extractNameOnly(data.dispatch_by) || '',
        farmer_name:      data.farmer_name      || extractNameOnly(data.farmer)      || '',
        customer_name:    data.customer_name    || extractNameOnly(data.customer)    || '',
        line_no_name:     data.line_no_name     || extractNameOnly(data.line_no)     || '',
    };

    const mappedRow = {};
    config.fields.forEach(({ sap, body_key }) => {
        if (aggregated[body_key] !== undefined) {
            mappedRow[sap] = aggregated[body_key];
        } else {
            console.warn(`Missing field: ${body_key}`);
        }
    });

    // Return a single-element array — one SAP POST for the whole BOS document
    return [mappedRow];
};


const computeTotals = (load_details = []) => {
    const totals = load_details.reduce(
        (acc, item) => {
            acc.totalWeight += Number(item.weight) || 0;
            acc.totalBirds += Number(item.birdQty) || 0;
            acc.totalAmount += Number(item.bill_value) || 0;
            return acc;
        },
        { totalWeight: 0, totalBirds: 0, totalAmount: 0 }
    );

    const average_weight = totals.totalBirds
        ? +(totals.totalWeight / totals.totalBirds).toFixed(2)
        : 0;

    return {
        net_weight: totals.totalWeight,
        gross_value: totals.totalAmount,
        bill_value: totals.totalAmount,
        average_weight,
        totalBirds: totals.totalBirds
    };
};

const saveBillOfSupplyToDB = async (data) => {
    const {
        date, customer_type, dc_no, customer, sales_type, transport_by,
        vehicle_no, order_by, dispatch_by, plant, farmer, line_no,
        farm_shed_no, batch, age, bird_stock, excess, shortage,
        load_details, rate
    } = data;

    const birds_details = [];
    const user_id = "test";

   const seqRes = await query(
    `SELECT nextval('broiler.bill_of_supply_doc_seq') AS seq`
);

if (!seqRes || seqRes.length === 0) {
    throw new Error('Failed to generate document number: sequence query returned no result');
}

const doc_no = `BOS/DC/${seqRes[0].seq}`;

    const parsedDate = new Date(date);
    const formattedDate = format(parsedDate, 'yyyy-MM-dd');

    const { gross_value, bill_value, average_weight } = computeTotals(load_details);
    // return;

    const insertQuery = `
        INSERT INTO broiler.${broilerDataEntry[TABLE_NAME].pgTable}
        (
            doc_no, date, customer_type, dc_no, customer, sales_type, transport_by,
            vehicle_no, order_by, dispatch_by, plant, farmer, line_no,
            farm_shed_no, batch, age, bird_stock, excess, shortage,
            load_details, birds_details, rate, average_weight, gross_value,
            bill_value, user_id, raw_data, tentative_rate,status,completed_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, $23,
            $24, $25, $26, $27, $28, $29,
 $30
        )
        RETURNING *
    `;

    const values = [
        doc_no, formattedDate, customer_type, dc_no, customer, sales_type, transport_by,
        vehicle_no, order_by, dispatch_by, plant, farmer, line_no,
        farm_shed_no, batch, age, bird_stock, Number(excess) || 0, Number(shortage) || 0,
        JSON.stringify(load_details), JSON.stringify(birds_details), rate, average_weight, gross_value,
        bill_value, user_id, JSON.stringify({ ...data, tentative_rate: String(rate) }), rate,'COMPLETED',
new Date()
    ];

    const dbResult = await query(insertQuery, values);

    return { doc_no, record: dbResult?.[0] };
};

const PLANT_FALLBACK_MAP = {
    '1501': {
        company: 'KRISHI NUTRITION COMPANY PRIVATE LIMITED',
        street: 'KK8&KK9,',
        str1: 'SIPCOT INDUSTRIAL GROWTH CENTER',
        str2: 'PERUNDURAI,',
        city: 'ERODE DIST.,',
        pincode: '638052',
        gst: '33AAFCK3415K1ZO',
        plant_name: 'PERUNDURAI'
    },
    '1502': {
        company: 'KRISHI NUTRITION COMPANY PRIVATE LIMITED',
        street: 'PLAT NO. : 1, RENUGAMBAL KOIL BACK SIDE,',
        str1: 'GANAPATHY NAGAR,',
        str2: 'TAJPURA,RANIPET,',
        city: 'VELLORE,',
        pincode: '632521',
        gst: '33AAFCK3415K1ZO',
        plant_name: 'ARCOT'
    },
    '1503': {
        company: 'Krishi Nutrition Company Private Limited',
        street: 'Sf No.347 / D.No.12/689, Four Road,',
        str1: ' Sungu Pettai,  Near Mg Hospital,',
        str2: 'Elambalur,',
        city: 'Perambalur',
        pincode: '621212',
        gst: '33AAFCK3415K1ZO',
        plant_name: 'TRICHY'
    },
    '1504': {
        company: 'KRISHI NUTRITION COMPANY PRIVATE LIMITED',
        street: 'NO. : D.NO.4/119A, MUTHU ACHARI STREET',
        str1: 'NEAR GEETHANJALI PRIMARY SCHOOL,',
        str2: 'KAVERIPATTINAM,',
        city: 'KRISHNAGIRI,',
        pincode: '635112',
        gst: '33AAFCK3415K1ZO',
        plant_name: 'KRISHNAGIRI'
    },
    '1507': {
        company: 'KRISHI NUTRITION COMPANY PRIVATE LIMITED',
        street: '8/14, DEVARAM NAGAR, PARIS NAGAR,',
        str1: 'THIRUKANURPATTI, VALLAM POST,',
        str2: '',
        city: ' THANJAVUR',
        pincode: '613403',
        gst: '33AAFCK3415K1ZO',
        plant_name: 'THANJAVUR'
    },
    '1508': {
        company: 'KRISHI NUTRITION COMPANY PRIVATE LIMITED',
        street: 'SITE NO.10353/347/1,',
        str1: 'SRI VISHNU APARTMENTS GROUND FLOOR,',
        str2: 'SHREERAMPURA LAYOUT,',
        city: 'RAMANAGARA - DISTRICT',
        pincode: '562117',
        gst: '29AAFCK3415K1ZD',
        plant_name: 'KANAKAPURA'
    }
};

const getMergedPlantDetails = (plantId, apiDetails) => {
    const fallback = PLANT_FALLBACK_MAP[String(plantId).trim()] || PLANT_FALLBACK_MAP['1504'];
    return {
        company: apiDetails?.company || apiDetails?.Name_co || fallback.company,
        street: apiDetails?.street || apiDetails?.Street || fallback.street,
        str1: apiDetails?.str1 || apiDetails?.Str_suppl1 || fallback.str1,
        str2: apiDetails?.str2 || apiDetails?.Str_suppl2 || fallback.str2,
        city: apiDetails?.city || apiDetails?.City1 || fallback.city,
        pincode: apiDetails?.pincode || apiDetails?.Post_code1 || fallback.pincode,
        gst: apiDetails?.gst || apiDetails?.Gstin || fallback.gst,
        plant_name: apiDetails?.plant_name || apiDetails?.Text || fallback.plant_name,
        plant_id: plantId
    };
};


// Non-blocking asynchronous SMS dispatcher for Bill of Supply
const dispatchBosSmsAsync = (data, contextName = 'create') => {
    setImmediate(async () => {
        try {
            const { totalBirds, totalWeight } = (() => {
                const t = computeTotals(data.load_details || []);
                return { totalBirds: t.totalBirds || 0, totalWeight: +(t.net_weight || 0).toFixed(2) };
            })();
            
            let farmerPhone = data.farmer_details?.telephone || null;
            let farmerName = data.farmer_details?.farmer_name || null;
            const streetParts = [data.farmer_details?.street, data.farmer_details?.street2, data.farmer_details?.street3].filter(Boolean).map(s => s.replace(/,\s*$/, '').trim()).filter(Boolean).join(', ');
            const districtPin = [data.farmer_details?.district, data.farmer_details?.pincode].filter(Boolean).join(' - ');
            let farmerAddress = [streetParts, districtPin].filter(Boolean).join(', ') || null;
            const farmerCode = data.farmer || '-';

            // Fallback to SAP API lookup if farmer phone is missing
            if (!farmerPhone) {
                try {
                    const sapInfo = await fetchSapContactInfo(data.farmer, data.customer);
                    if (sapInfo) {
                        farmerPhone = sapInfo.farmerPhone;
                        farmerName = farmerName || sapInfo.farmerName;
                        farmerAddress = farmerAddress || sapInfo.farmerAddress;
                    }
                } catch (e) {
                    console.warn(`BOS SMS (${contextName}) - SAP lookup failed:`, e.message);
                }
            }

            const mobiles = [];
            if (farmerPhone && String(farmerPhone).trim()) mobiles.push(String(farmerPhone).trim());

            if (mobiles.length > 0) {
                sendBosSmS({
                    mobiles,
                    birds: totalBirds,
                    weight: totalWeight,
                    vehicle_no: data.vehicle_no || '-',
                    farmer_code: farmerCode,
                    farmer_name: farmerName || '-',
                    farmer_address: farmerAddress || '-',
                    date: data.date
                }).then(smsRes => {
                    console.log(`BOS SMS (${contextName}) - Dispatch response:`, smsRes);
                }).catch(e => console.warn(`BOS SMS (${contextName}) send error:`, e.message));
            }

            // Customer SMS
            try {
                const { customerPhone, customerBalance, customerName } = await fetchCustomerInfo(data.customer).catch(() => ({}));
                const customerMobiles = [];
                if (customerPhone && String(customerPhone).trim()) customerMobiles.push(String(customerPhone).trim());

                if (!customerMobiles.length && data.customer_details?.telephone) {
                    customerMobiles.push(String(data.customer_details.telephone).trim());
                }

                if (customerMobiles.length > 0) {
                    const netKg = +(totalWeight).toFixed(2);
                    const custName = customerName || data.customer_details?.customer_name || '';
                    const customerLabel = `${data.customer || '-'} - ${custName}`;
                    const cleanCustomerLabel = customerLabel.trim().replace(/ - $/, '');
                    sendBosCustomerSMS({
                        mobiles: customerMobiles,
                        net_weight: netKg,
                        farmer_label: cleanCustomerLabel,
                        vehicle_no: data.vehicle_no || '-',
                        rate: data.rate || '0',
                        balance: customerBalance || 0
                    }).then(smsRes => {
                        console.log(`BOS SMS (${contextName}) - Customer dispatch response:`, smsRes);
                    }).catch(e => console.warn(`BOS SMS (${contextName}) customer send error:`, e.message));
                }
            } catch (custSmsErr) {
                console.warn(`BOS SMS (${contextName}) customer block error:`, custSmsErr.message);
            }
        } catch (smsErr) {
            console.warn(`BOS SMS (${contextName}) block error:`, smsErr.message);
        }
    });
};

const generateBillOfSupplyPDF = async (data, doc_no) => {
    const { load_details = [], rate, driver_name, driver_mobile } = data;

    const plant_details = getMergedPlantDetails(data.plant, data.plant_details);

    // Resolve sap_post_date
    let sap_post_date = data.sap_post_date || null;
    if (!sap_post_date) {
        try {
            const dbResult = await query(
                `SELECT sap_post_date FROM broiler.bill_of_supply WHERE doc_no = $1 LIMIT 1`,
                [doc_no]
            );
            if (dbResult.length > 0) {
                sap_post_date = dbResult[0].sap_post_date;
            }
        } catch (e) {
            console.warn('Could not query sap_post_date for PDF:', e.message);
        }
    }

    // Format sap_post_date to DD.MM.YYYY format if present
    let formattedSapPostDate = "-";
    if (sap_post_date) {
        try {
            const parsedSapPostDate = new Date(sap_post_date);
            if (!isNaN(parsedSapPostDate.getTime())) {
                formattedSapPostDate = format(parsedSapPostDate, 'dd-MM-yyyy');
            }
        } catch (e) {
            console.warn("Error formatting SAP Post Date for PDF:", e.message);
        }
    }

    const { net_weight, gross_value, bill_value, average_weight } = computeTotals(load_details);

    const formattedDate = format(new Date(data.date), 'dd-MM-yyyy');

    const templateData = {
        ...data,
        plant_details,
        date: formattedDate,
        sap_post_date: formattedSapPostDate,
        rate: Number(rate) || 0,
        net_weight,
        average_weight,
        gross_value,
        bill_value,
        gross_value_in_words: toWords.convert(bill_value),
        user_id: data.user_id || "test",
        doc_no,
        driver_name: driver_name || "-",
        supervisor_name: data.order_by_name || data.order_by || "-",
        weight_scale_no: '-',
        driver_mobile: driver_mobile || "-",
        start_time: "-",
        end_time: "-"
    };

    console.log("template data : ", templateData)

    const templatePath = asset('templates', 'broiler', 'bos_dc.ejs');
    const htmlContent = await ejs.renderFile(templatePath, templateData);

    const reportsDir = runtime('uploads', 'broiler', 'bill_of_supply');
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    const fileName = `DC_${doc_no.replace(/\//g, '-')}_${Date.now()}.pdf`;
    const filePath = path.join(reportsDir, fileName);
    const publicUrl = `${process.env.SERVER_URL}/uploads/broiler/bill_of_supply/${fileName}`;

    const logo_data_uri = getKrishiLogoDataUri();
    templateData.logo_data_uri = logo_data_uri;

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
        executablePath: getChromiumPath(),
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 15000 });

    await page.pdf({
        path: filePath,
        format: 'A4',
        printBackground: true,
        margin: { top: '30px', bottom: '30px', left: '30px', right: '30px' },
    });
    await browser.close();

    return publicUrl;
};


exports.create = async (req, res) => {
    try {
        const data = req.body;

        // Multiple bills per DC are allowed (e.g. 5 loads from the same DC).
        // Only block TRUE network-lag retries: same dc_no + plant + farmer + date created within 30 seconds.
        if (data.dc_no && data.plant) {
            const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
            const recentDuplicate = await query(
                `SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable}
                 WHERE dc_no = $1 AND plant = $2 AND farmer = $3
                   AND (status IS NULL OR status = 'COMPLETED')
                   AND created_at >= $4
                 ORDER BY created_at DESC LIMIT 1`,
                [data.dc_no, data.plant, data.farmer || null, thirtySecondsAgo]
            );

            if (recentDuplicate.length > 0) {
                console.log(`BOS create: Network-lag duplicate detected for dc_no: "${data.dc_no}", plant: "${data.plant}", farmer: "${data.farmer}". Returning existing record.`);
                const existingRec = recentDuplicate[0];
                const pdfLink = existingRec.mobile_pdf_link || existingRec.pdf_link;
                return res.status(200).json({
                    status: true,
                    message: "Bill of supply record created successfully",
                    data: {
                        doc_no: existingRec.doc_no,
                        record: existingRec,
                        pdfLink: pdfLink
                    }
                });
            }

            // Complete any open DRAFT for exact same dc_no + plant + farmer combination
            const existingDraft = await query(
                `SELECT id FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable}
                 WHERE dc_no = $1 AND plant = $2 AND farmer = $3 AND status = 'DRAFT'
                 ORDER BY created_at DESC LIMIT 1`,
                [data.dc_no, data.plant, data.farmer || null]
            );

            if (existingDraft.length > 0) {
                console.log(`BOS create: Draft record found (ID: ${existingDraft[0].id}) for dc_no: "${data.dc_no}". Completing existing draft.`);
                req.params = { ...req.params, id: existingDraft[0].id };
                return exports.completeDraft(req, res);
            }
        }

        const { doc_no, record } = await saveBillOfSupplyToDB(data);

        // Generate PDF immediately
        const publicUrl = await generateBillOfSupplyPDF(data, doc_no);

        // --- Send SMS asynchronously (non-blocking) ---
        dispatchBosSmsAsync(data, 'create');

        // Save PDF link in DB
        await query(
            `UPDATE broiler.${broilerDataEntry[TABLE_NAME].pgTable}
     SET mobile_pdf_link = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE doc_no = $2`,
            [publicUrl, doc_no]
        );

        return res.status(201).json({
            status: true,
            message: "Bill of supply record created successfully",
            data: {
                doc_no,
                record,
                pdfLink: publicUrl
            }
        });

    } catch (error) {
        console.error("Error creating Broiler supply bill record:", error);
        res.status(500).json({
            status: false,
            message: "Error creating Broiler supply bill record",
            error: error.message
        });
    }
};

exports.submit = async (req, res) => {
    try {
        const doc_no = req.body?.doc_no || req.params?.doc_no;
        const sap_post_date = req.body?.sap_post_date || null; // Admin-selected SAP post date (YYYY-MM-DD)

        if (!doc_no) {
            return res.status(400).json({
                status: false,
                message: "doc_no is required"
            });
        }

        const result = await query(
            `SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE doc_no = $1 ORDER BY created_at DESC LIMIT 1`,
            [doc_no]
        );

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: `Bill of Supply record not found for doc_no: ${doc_no}`
            });
        }

        const dbRow = result[0];

        const parsedRawData = typeof dbRow.raw_data === 'string'
            ? JSON.parse(dbRow.raw_data)
            : dbRow.raw_data;

        if (!parsedRawData) {
            return res.status(500).json({
                status: false,
                message: `raw_data is missing for doc_no: ${doc_no}`
            });
        }

        // Always use the latest DB column values (updated by admin) to override stale raw_data values.
        // This ensures rate, customer, customer_type, customer_details, and load_details are always current.
        const dbRate = dbRow.rate;
        const dbCustomer = dbRow.customer || parsedRawData.customer || '';
        const dbCustomerType = dbRow.customer_type || parsedRawData.customer_type || '';

        let dbLoadDetails = dbRow.load_details;
        if (typeof dbLoadDetails === 'string') {
            try { dbLoadDetails = JSON.parse(dbLoadDetails); } catch { dbLoadDetails = null; }
        }

        // Parse customer_details — prefer DB row raw_data (updated by admin), fall back to original
        let dbCustomerDetails = parsedRawData.customer_details || null;
        if (typeof dbCustomerDetails === 'string') {
            try { dbCustomerDetails = JSON.parse(dbCustomerDetails); } catch { dbCustomerDetails = null; }
        }

        const rawData = {
            ...parsedRawData,
            rate: dbRate !== undefined && dbRate !== null ? String(dbRate) : parsedRawData.rate,
            customer: dbCustomer,
            customer_type: dbCustomerType,
            customer_details: dbCustomerDetails,
            load_details: dbLoadDetails || parsedRawData.load_details || []
        };

        // Validate customer is set before submitting to SAP
        if (!dbCustomer) {
            return res.status(400).json({
                status: false,
                message: 'Customer is not set for this record. Please use the Edit button to select a customer before submitting to SAP.'
            });
        }

        const { date, ...rest } = rawData;

        // Retrieve SAP post date config
        const configResult = await query(
            `SELECT allowed_days FROM broiler.sap_post_date_config ORDER BY id LIMIT 1`
        );
        const allowedDays = configResult.length > 0 ? configResult[0].allowed_days : 3;

        // FIX: Use parseISO() instead of new Date() to treat date strings as local-time midnight.
        // new Date("YYYY-MM-DD") parses as UTC midnight, which causes a +1 day shift when
        // date-fns format() converts it to local time on servers behind UTC.
        const safeParseDate = (dateStr) => {
            if (!dateStr) return new Date();
            // If already a full ISO datetime string, use parseISO directly
            if (typeof dateStr === 'string' && dateStr.length > 10) {
                return parseISO(dateStr.slice(0, 10));
            }
            return parseISO(String(dateStr).slice(0, 10));
        };

        // Default SAP post date = today (so old records can be submitted without SAP back-date rejection)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const postDateSource = sap_post_date ? safeParseDate(sap_post_date) : today;

        // Validate DC date exists
        const dcDate = safeParseDate(date);
        if (isNaN(dcDate.getTime())) {
            return res.status(400).json({
                status: false,
                message: "Invalid DC Date."
            });
        }
        dcDate.setHours(0, 0, 0, 0);

        // Min allowed = DC date - allowedDays (master config)
        const minAllowedDate = new Date(dcDate);
        minAllowedDate.setDate(dcDate.getDate() - allowedDays);

        // Max allowed = today (admin can always post up to today, even for old DC records)
        const maxAllowedDate = today;

        const targetDate = new Date(postDateSource);
        if (isNaN(targetDate.getTime())) {
            return res.status(400).json({
                status: false,
                message: "Invalid SAP Post Date provided."
            });
        }
        targetDate.setHours(0, 0, 0, 0);

        if (targetDate < minAllowedDate || targetDate > maxAllowedDate) {
            return res.status(400).json({
                status: false,
                message: `SAP Post Date must be between ${format(minAllowedDate, 'yyyy-MM-dd')} and today (${format(maxAllowedDate, 'yyyy-MM-dd')}).`
            });
        }

        const sap_format_date = format(postDateSource, 'dd-MM-yyyy');
        console.log(`[BOS Submit] doc_no=${doc_no} | sap_post_date input=${sap_post_date} | formatted=${sap_format_date} | rate from DB=${dbRate}`);

/**
 * Resolves full names for a list of employee / user identifiers (username, emp_id, or id)
 * by querying public.driver and broiler.employee.
 */
const resolveEmployeeFullNames = async (codes = []) => {
    const rawCodes = codes.map(c => extractCodeOnly(c)).filter(Boolean);
    if (rawCodes.length === 0) return {};

    const allCodes = [
        ...rawCodes,
        ...rawCodes.map(c => c.replace(/^0+/, '')),
        ...rawCodes.map(c => c.padStart(8, '0'))
    ];
    const uniqueCodes = [...new Set(allCodes.filter(Boolean))];
    const nameMap = {};

    try {
        // 1. Query public.driver (username -> fullname, id -> fullname, emp_id -> fullname)
        const driverRows = await query(
            `SELECT id, username, fullname, emp_id FROM public.driver
             WHERE lower(username) = ANY($1::text[])
                OR lower(fullname) = ANY($1::text[])
                OR id::text = ANY($2::text[])
                OR emp_id = ANY($2::text[])`,
            [uniqueCodes.map(c => c.toLowerCase()), uniqueCodes]
        );
        driverRows.forEach(d => {
            const fn = String(d.fullname || '').trim();
            if (!fn) return;
            if (d.username) {
                const u = String(d.username).trim().toLowerCase();
                nameMap[u] = fn;
            }
            if (d.id) {
                const id = String(d.id).trim().toLowerCase();
                nameMap[id] = fn;
            }
            if (d.emp_id) {
                const eid = String(d.emp_id).trim().toLowerCase();
                nameMap[eid] = fn;
                nameMap[eid.replace(/^0+/, '')] = fn;
                nameMap[eid.padStart(8, '0')] = fn;
            }
        });
    } catch (dErr) {
        console.warn('Driver table lookup warning:', dErr.message);
    }

    try {
        // 2. Query broiler.employee (emp_id -> emp_name)
        const empRows = await query(
            `SELECT emp_id, emp_name FROM broiler.employee
             WHERE emp_id = ANY($1::text[]) OR lower(emp_name) = ANY($2::text[])`,
            [uniqueCodes, uniqueCodes.map(c => c.toLowerCase())]
        );
        empRows.forEach(e => {
            const id = String(e.emp_id || '').trim();
            const name = String(e.emp_name || '').trim();
            if (id && name) {
                const idLower = id.toLowerCase();
                if (!nameMap[idLower]) nameMap[idLower] = name;
                if (!nameMap[idLower.replace(/^0+/, '')]) nameMap[idLower.replace(/^0+/, '')] = name;
                if (!nameMap[idLower.padStart(8, '0')]) nameMap[idLower.padStart(8, '0')] = name;
            }
            if (name && !nameMap[name.toLowerCase()]) {
                nameMap[name.toLowerCase()] = name;
            }
        });
    } catch (eErr) {
        console.warn('Employee table lookup warning:', eErr.message);
    }

    return nameMap;
};

        // --- Lookup employee names for order_by / dispatch_by ---
        const orderByCleanCode    = extractCodeOnly(rest.order_by);
        const dispatchByCleanCode = extractCodeOnly(rest.dispatch_by);

        // 1. Direct extraction from "Code - Name" string if present
        let order_by_name    = extractNameOnly(rest.order_by);
        let dispatch_by_name = extractNameOnly(rest.dispatch_by);

        // If rest already has a custom name that is NOT just the code/username
        if (!order_by_name && rest.order_by_name && rest.order_by_name.trim().toLowerCase() !== orderByCleanCode.trim().toLowerCase()) {
            order_by_name = rest.order_by_name.trim();
        }
        if (!dispatch_by_name && rest.dispatch_by_name && rest.dispatch_by_name.trim().toLowerCase() !== dispatchByCleanCode.trim().toLowerCase()) {
            dispatch_by_name = rest.dispatch_by_name.trim();
        }

        // 2. Lookup full names from public.driver and broiler.employee
        if (!order_by_name || !dispatch_by_name) {
            try {
                const resolvedNames = await resolveEmployeeFullNames([orderByCleanCode, dispatchByCleanCode]);
                const getName = (code) => {
                    if (!code) return '';
                    const c = String(code).trim().toLowerCase();
                    return resolvedNames[c]
                        || resolvedNames[c.replace(/^0+/, '')]
                        || resolvedNames[c.padStart(8, '0')]
                        || '';
                };

                if (!order_by_name && orderByCleanCode)       order_by_name    = getName(orderByCleanCode);
                if (!dispatch_by_name && dispatchByCleanCode) dispatch_by_name = getName(dispatchByCleanCode);

                // 3. Fallback: plant default employee codes from sales_emp_default
                if ((!order_by_name || !dispatch_by_name) && rest.plant) {
                    try {
                        const empDefRows = await query(
                            `SELECT ordered_by, dispatched_by FROM broiler.sales_emp_default WHERE plant = $1 LIMIT 1`,
                            [String(rest.plant)]
                        );
                        if (empDefRows.length > 0) {
                            const defOrderCode    = extractCodeOnly(empDefRows[0].ordered_by);
                            const defDispatchCode = extractCodeOnly(empDefRows[0].dispatched_by);
                            const defNames = await resolveEmployeeFullNames([defOrderCode, defDispatchCode]);
                            if (!order_by_name && defOrderCode) {
                                order_by_name = defNames[defOrderCode.toLowerCase()]
                                    || defNames[defOrderCode.replace(/^0+/, '').toLowerCase()]
                                    || extractNameOnly(empDefRows[0].ordered_by)
                                    || '';
                            }
                            if (!dispatch_by_name && defDispatchCode) {
                                dispatch_by_name = defNames[defDispatchCode.toLowerCase()]
                                    || defNames[defDispatchCode.replace(/^0+/, '').toLowerCase()]
                                    || extractNameOnly(empDefRows[0].dispatched_by)
                                    || '';
                            }
                        }
                    } catch (defErr) {
                        console.warn('sales_emp_default fallback lookup failed:', defErr.message);
                    }
                }

                // 4. Fallback: Lookup directly from SAP /emp_master endpoint
                if (!order_by_name || !dispatch_by_name) {
                    try {
                        const sapEmpMap = await fetchSapEmployeeInfo();
                        if (!order_by_name && orderByCleanCode) {
                            order_by_name = sapEmpMap[orderByCleanCode] || sapEmpMap[orderByCleanCode.replace(/^0+/, '')] || '';
                        }
                        if (!dispatch_by_name && dispatchByCleanCode) {
                            dispatch_by_name = sapEmpMap[dispatchByCleanCode] || sapEmpMap[dispatchByCleanCode.replace(/^0+/, '')] || '';
                        }
                    } catch (sapEmpErr) {
                        console.warn('SAP emp_master lookup failed:', sapEmpErr.message);
                    }
                }
            } catch (empErr) {
                console.warn('Employee name lookup failed (order_by/dispatch_by):', empErr.message);
            }
        }

        // --- Lookup line name from broiler.line_master ---
        let line_no_name = rest.line_no_name || '';
        try {
            const lineCode = rest.line_no || '';
            if (lineCode) {
                const lineRows = await query(
                    `SELECT line_name FROM broiler.line_master WHERE line_no = $1 LIMIT 1`,
                    [lineCode]
                );
                if (lineRows.length > 0 && lineRows[0].line_name) {
                    line_no_name = lineRows[0].line_name;
                }
            }
        } catch (lineErr) {
            console.warn('Line name lookup failed:', lineErr.message);
        }

        // --- Lookup farmer_name if missing --- Always do SAP lookup to get the real name.
        // The farmer code stored in DB is a plain code (e.g. "FSZ00042"), not "Code - Name".
        let farmer_name = rest.farmer_name
            || rest.farmer_details?.farmer_name
            || rest.farmer_details?.name1
            || '';

        // --- Resolve customer_name from raw_data or SAP lookup ---
        let customer_name = rest.customer_name
            || rest.customer_details?.customer_name
            || rest.customer_details?.name1
            || '';

        // Always do SAP lookup for names — even if we have a value, the stored value
        // might just be the code or a stale value. SAP is the source of truth.
        if (rest.farmer || rest.customer) {
            try {
                const farmerCodeForLookup = extractCodeOnly(rest.farmer);
                const customerCodeForLookup = extractCodeOnly(rest.customer);
                const contactInfo = await fetchSapContactInfo(farmerCodeForLookup, customerCodeForLookup);
                if (contactInfo?.farmerName)   farmer_name   = contactInfo.farmerName;
                if (contactInfo?.customerName) customer_name = contactInfo.customerName;
                console.log(`[BOS Submit] SAP lookup resolved: farmer_name="${farmer_name}", customer_name="${customer_name}"`);
            } catch (fErr) {
                console.warn('Name lookup from SAP failed:', fErr.message);
            }
        }

        // Secondary DB fallback for farmer name if SAP did not resolve it
        if ((!farmer_name || farmer_name === extractCodeOnly(rest.farmer)) && rest.farmer) {
            try {
                const farmDbRows = await query(
                    `SELECT farmer_name FROM broiler.farmer WHERE farmer_supplier = $1 LIMIT 1`,
                    [extractCodeOnly(rest.farmer)]
                );
                if (farmDbRows.length > 0 && farmDbRows[0].farmer_name) {
                    farmer_name = farmDbRows[0].farmer_name;
                }
            } catch (fDbErr) {
                console.warn('Farmer name local DB lookup failed:', fDbErr.message);
            }
        }

        // Secondary DB fallback for customer name if SAP did not resolve it
        if ((!customer_name || customer_name === extractCodeOnly(rest.customer)) && rest.customer) {
            try {
                const custDbRows = await query(
                    `SELECT customer_name FROM broiler.customer WHERE customer_no = $1 LIMIT 1`,
                    [extractCodeOnly(rest.customer)]
                );
                if (custDbRows.length > 0 && custDbRows[0].customer_name) {
                    customer_name = custDbRows[0].customer_name;
                }
            } catch (cDbErr) {
                console.warn('Customer name local DB lookup failed:', cDbErr.message);
            }
        }

        // Final fallbacks — use name from "Code - Name" or code only if name could not be resolved
        if (!farmer_name)   farmer_name   = extractNameOnly(rest.farmer)   || extractCodeOnly(rest.farmer)   || '';
        if (!customer_name) customer_name = extractNameOnly(rest.customer) || extractCodeOnly(rest.customer) || '';
        if (!order_by_name && rest.order_by)       order_by_name    = extractNameOnly(rest.order_by)    || extractCodeOnly(rest.order_by);
        if (!dispatch_by_name && rest.dispatch_by) dispatch_by_name = extractNameOnly(rest.dispatch_by) || extractCodeOnly(rest.dispatch_by);

        // Strip leading zeros from dc_no before sending to SAP
        const cleanDcNo = rest.dc_no
            ? (String(rest.dc_no).replace(/^0+/, '') || String(rest.dc_no))
            : '';

        const sapPayloadData = {
            ...rest,
            date: sap_format_date,   // MUST be after ...rest — otherwise rest.date (original DC date) overwrites it
            dc_no: cleanDcNo,
            order_by_name,
            dispatch_by_name,
            farmer_name,
            customer_name,
            line_no_name
        };

        const sapDataRows = formatBillOfSupplyDataToSap(sapPayloadData);
        console.log("BOS SAP payload Data : ", sapDataRows);

        let uploadCount = 0;
        if (sapDataRows?.length > 0) {
            const requests = sapDataRows.map((row) => {
                const qsString = qs.stringify(
                    { "sap-client": "500", ...row },
                    { encode: true }
                );

                const finalUrl = `${process.env.BROILER_SAP_BASE_URL}${broilerDataEntry[TABLE_NAME].sapEndpoint}?${qsString}`;

                console.log("final url : ", finalUrl);

                const config = {
                    method: 'post',
                    maxBodyLength: Infinity,
                    url: finalUrl,
                    timeout: 30000, // 30 second timeout
                    auth: {
                        username: process.env.BROILER_SAP_USERNAME,
                        password: process.env.BROILER_SAP_PASSWORD
                    }
                };

                return axios.request(config);
            });

            const responses = await Promise.allSettled(requests);

            const failed = responses.find(r => r.status === 'rejected');

            if (failed) {
                const err = failed.reason;
                const isNetworkError = !err?.response; // No HTTP response = network/connection issue

                if (isNetworkError) {
                    // Network-level error: timeout, socket hang up, connection refused, etc.
                    const code = err?.code || '';
                    let netMsg = 'Could not connect to SAP server.';
                    if (code === 'ECONNABORTED' || err?.message?.includes('timeout')) {
                        netMsg = 'SAP server did not respond in time (timeout). Please try again.';
                    } else if (code === 'ECONNREFUSED') {
                        netMsg = 'SAP server refused the connection. Please check network/SAP status.';
                    } else if (err?.message?.includes('socket hang up') || code === 'ECONNRESET') {
                        netMsg = 'Connection to SAP was lost. Please try again in a moment.';
                    }
                    console.error("SAP NETWORK ERROR:", code, err?.message);
                    return res.status(500).json({
                        status: false,
                        message: netMsg,
                        error: err?.message
                    });
                }

                // SAP returned an HTTP error response
                const rawErrData = err?.response?.data;
                // Extract readable message from SAP HTML error pages
                let sapErrMsg = typeof rawErrData === 'string' && rawErrData.includes('msgText')
                    ? (rawErrData.match(/id=\"msgText\"[^>]*>([^<]+)</) || [])[1]?.trim() || 'SAP server error'
                    : (typeof rawErrData === 'object' ? JSON.stringify(rawErrData) : String(rawErrData || 'SAP error'));
                console.error("SAP HTTP ERROR:", sapErrMsg);

                return res.status(500).json({
                    status: false,
                    message: `SAP rejected submission: ${sapErrMsg}`,
                    error: sapErrMsg
                });
            }

            // Check SAP response body for explicit SAP application errors
            for (const r of responses) {
                const resData = r.value?.data;
                console.log("Background SAP Response Data:", JSON.stringify(resData));

                let hasError = false;
                let sapErrorMsg = "";

                if (resData) {
                    if (Array.isArray(resData)) {
                        // SAP BAPI-style: array of messages, each with a TYPE field
                        // Only treat as error if EVERY item is an error (TYPE 'E') and NONE are success (TYPE 'S')
                        const hasSuccess = resData.some(item =>
                            item.TYPE === 'S' || item.type === 'S' || item.STATUS === 'S'
                        );
                        if (!hasSuccess) {
                            const errItem = resData.find(item =>
                                item.TYPE === 'E' || item.type === 'E' || item.STATUS === 'E' || item.MSG_TYPE === 'E'
                            );
                            if (errItem) {
                                hasError = true;
                                sapErrorMsg = errItem.MESSAGE || errItem.message || errItem.MSGTX || JSON.stringify(errItem);
                            }
                        }
                    } else if (typeof resData === 'object' && !Array.isArray(resData)) {
                        // Plain object: only fail if explicitly status: false (boolean) or TYPE strictly 'E'
                        if (resData.status === false || resData.TYPE === 'E' || resData.type === 'E' || resData.STATUS === 'E') {
                            hasError = true;
                            sapErrorMsg = resData.message || resData.MESSAGE || resData.error || JSON.stringify(resData);
                        }
                    }
                    // Note: string responses are NOT treated as errors — SAP may return plain text
                    // success messages that contain words like "error" (e.g., "posted without error")
                }

                if (hasError) {
                    console.error("SAP Application Error detected:", sapErrorMsg);
                    return res.status(400).json({
                        status: false,
                        message: `SAP submission rejected: ${sapErrorMsg}`,
                        error: resData
                    });
                }

                uploadCount++;
            }

            console.log("SAP uploads successful count:", uploadCount);
        }

        const publicUrl = await generateBillOfSupplyPDF({
            ...rawData,
            order_by_name,
            dispatch_by_name,
            farmer_name,
            customer_name,
            line_no_name,
            sap_post_date
        }, doc_no);

        await query(
            `UPDATE broiler.${broilerDataEntry[TABLE_NAME].pgTable}
             SET pdf_link = $1, sap_post_date = $2, is_send_sap = true, updated_at = CURRENT_TIMESTAMP
             WHERE doc_no = $3`,
            [publicUrl, sap_post_date || null, doc_no]
        );

        return res.status(200).json({
            status: true,
            message: "Bill of supply submitted to SAP and PDF generated successfully",
            data: {
                doc_no,
                pdfLink: publicUrl,
                uploadCount
            }
        });

    } catch (error) {
        console.error("Error submitting Broiler supply bill to SAP:", error);
        res.status(500).json({
            status: false,
            message: "Error submitting Broiler supply bill to SAP",
            error: error.message
        });
    }
};

exports.getAll = async (req, res) => {
    try {
        const result = await query(`SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE status IS NULL OR status != 'DRAFT' ORDER BY created_at DESC`);

        if (result.length === 0) {
            return res.status(200).json({ status: true, message: "The Broiler supply list is empty", data: [] });
        }

        // Deduplicate only by doc_no — each bill has a unique doc_no (BOS/DC/seq).
        // Multiple bills per DC (dc_no) are valid and must all appear in the grid.
        // Network-lag true duplicates are now blocked at create time (same dc+plant+farmer within 30s).
        const uniqueRecordsMap = new Map();
        result.forEach(row => {
            const key = row.doc_no ? String(row.doc_no).trim() : `id_${row.id}`;
            if (!uniqueRecordsMap.has(key)) {
                uniqueRecordsMap.set(key, row);
            } else {
                const existing = uniqueRecordsMap.get(key);
                // Prefer SAP-submitted row over unsubmitted one with same doc_no
                if ((!existing.sap_post_date && row.sap_post_date) || (!existing.pdf_link && row.pdf_link)) {
                    uniqueRecordsMap.set(key, row);
                }
            }
        });
        const deduplicatedResult = Array.from(uniqueRecordsMap.values());

        // ------------------------------------------------------------------
        // Build lookup maps so we can resolve codes → names for ALL records.
        // ------------------------------------------------------------------

        // 1. Fetch ALL customer/farmer names from SAP /customer endpoint
        //    This returns both D* (customers) and FSZ* (farmers) with their names.
        let customerSapMap = {}; // { "D002506": "KHAN CHICKENS", "FSZ00091": "VIJAYA S" }
        try {
            const sapUrl = `${process.env.BROILER_SAP_BASE_URL}/customer?sap-client=500`;
            const sapRes = await axios.get(sapUrl, {
                auth: {
                    username: process.env.BROILER_SAP_USERNAME,
                    password: process.env.BROILER_SAP_PASSWORD
                },
                timeout: 10000 // 10s timeout so getAll doesn't hang
            });
            if (sapRes.status === 200 && Array.isArray(sapRes.data)) {
                sapRes.data.forEach(row => {
                    if (row.kunnr) {
                        customerSapMap[row.kunnr] = row.name1 || row.kunnr;
                    }
                });
            }
        } catch (e) {
            console.warn('SAP customer lookup failed, will fall back to raw_data:', e.message);
        }

        // 2. Fetch farmer names from local DB as a secondary fallback
        // 2. Fetch customer and farmer names from local DB as a secondary fallback
        const allCodes = [...new Set([...deduplicatedResult.map(r => r.farmer), ...deduplicatedResult.map(r => r.customer)].filter(Boolean))];
        let dbNameMap = {};
        if (allCodes.length > 0) {
            try {
                const dbRecords = await query(
                    `SELECT farmer_supplier, farmer_name FROM broiler.farmer WHERE farmer_supplier = ANY($1)`,
                    [allCodes]
                );
                dbRecords.forEach(f => {
                    if (f.farmer_supplier) dbNameMap[f.farmer_supplier] = f.farmer_name || f.farmer_supplier;
                });
            } catch (e) {
                console.warn('Could not fetch customer/farmer names from DB:', e.message);
            }
        }

        // 3. Fetch plant names from local DB
        let plantMap = {};
        try {
            const plants = await query(`SELECT plant_id, plant_name FROM broiler.plant`);
            plants.forEach(p => {
                if (p.plant_id) plantMap[String(p.plant_id)] = p.plant_name || String(p.plant_id);
            });
        } catch (e) {
            console.warn('Could not fetch plant names from DB:', e.message);
        }

        // 4. Fetch user/driver/employee full names from DB
        let userFullnameMap = {};
        try {
            const driverUsers = await query(`SELECT username, fullname, emp_id, id FROM public.driver`);
            driverUsers.forEach(d => {
                const fn = String(d.fullname || '').trim();
                if (!fn) return;
                if (d.username) userFullnameMap[String(d.username).trim().toLowerCase()] = fn;
                if (d.id) userFullnameMap[String(d.id).trim().toLowerCase()] = fn;
                if (d.emp_id) userFullnameMap[String(d.emp_id).trim().toLowerCase()] = fn;
            });
            const empList = await query(`SELECT emp_id, emp_name FROM broiler.employee`);
            empList.forEach(e => {
                const en = String(e.emp_name || '').trim();
                if (!en) return;
                if (e.emp_id) userFullnameMap[String(e.emp_id).trim().toLowerCase()] = en;
            });
        } catch (e) {
            console.warn('Could not fetch driver/employee names from DB:', e.message);
        }

        // ------------------------------------------------------------------
        // Enrich each record
        // ------------------------------------------------------------------
        const enriched = deduplicatedResult.map((row) => {
            let raw = row.raw_data || {};
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch { raw = {}; }
            }

            // Parse customer_details (stored by mobile in raw_data)
            let customerDetails = raw.customer_details || {};
            if (typeof customerDetails === 'string') {
                try { customerDetails = JSON.parse(customerDetails); } catch { customerDetails = {}; }
            }

            // Parse farmer_details (stored by mobile in raw_data)
            let farmerDetails = raw.farmer_details || {};
            if (typeof farmerDetails === 'string') {
                try { farmerDetails = JSON.parse(farmerDetails); } catch { farmerDetails = {}; }
            }

            const effectiveCustomer = row.customer || raw.customer || customerDetails.customer_no || null;
            const effectiveFarmer = row.farmer || raw.farmer || farmerDetails.farmer_supplier || null;

            // Resolve customer name — SAP map first, DB map, raw_data.customer_details, raw_data direct, then code
            const customer_name =
                (effectiveCustomer ? customerSapMap[effectiveCustomer] : null) ||
                (effectiveCustomer ? dbNameMap[effectiveCustomer] : null) ||
                customerDetails.customer_name ||
                customerDetails.name1 ||
                raw.customer_name ||
                effectiveCustomer ||
                null;

            // Resolve farmer name — SAP map first, DB map, raw_data.farmer_details, raw_data direct, then code
            const farmer_name =
                (effectiveFarmer ? customerSapMap[effectiveFarmer] : null) ||
                (effectiveFarmer ? dbNameMap[effectiveFarmer] : null) ||
                farmerDetails.farmer_name ||
                farmerDetails.name1 ||
                raw.farmer_name ||
                effectiveFarmer ||
                null;

            // Resolve plant name
            const plant_name =
                plantMap[String(row.plant || '')] ||
                raw.plant_name ||
                row.plant ||
                null;

            console.log(`[getAll] doc_no=${row.doc_no} | customer=${row.customer} | customer_name resolved="${customer_name}" | farmer=${row.farmer} | farmer_name resolved="${farmer_name}"`);

            // Resolve order_by and dispatch_by names
            const cleanOrderBy = extractCodeOnly(row.order_by || raw.order_by);
            const cleanDispBy = extractCodeOnly(row.dispatch_by || raw.dispatch_by);

            const order_by_name =
                extractNameOnly(row.order_by || raw.order_by) ||
                (raw.order_by_name && raw.order_by_name.trim().toLowerCase() !== cleanOrderBy.toLowerCase() ? raw.order_by_name : null) ||
                (cleanOrderBy ? userFullnameMap[cleanOrderBy.toLowerCase()] : null) ||
                cleanOrderBy ||
                null;

            const dispatch_by_name =
                extractNameOnly(row.dispatch_by || raw.dispatch_by) ||
                (raw.dispatch_by_name && raw.dispatch_by_name.trim().toLowerCase() !== cleanDispBy.toLowerCase() ? raw.dispatch_by_name : null) ||
                (cleanDispBy ? userFullnameMap[cleanDispBy.toLowerCase()] : null) ||
                cleanDispBy ||
                null;

            return {
                ...row,
                customer_name,
                farmer_name,
                plant_name,
                order_by_name,
                dispatch_by_name,
                // Expose parsed details so frontend can also read them directly
                customer_details: customerDetails,
                farmer_details: farmerDetails,
            };
        });

        res.status(200).json({ status: true, data: enriched });
    } catch (error) {
        console.error("Error fetching Broiler supply records:", error);
        res.status(500).json({ status: false, message: "Error fetching Broiler supply records", error: error.message });
    }
};


exports.getOne = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(`SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE id = $1`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Broiler supply record with ID ${id} not found` });
        }

        res.status(200).json({ status: true, data: result[0] });

    } catch (error) {
        console.error("Error fetching single Broiler supply record:", error);
        res.status(500).json({ status: false, message: "Error fetching Broiler supply record", error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const doc_no = req.query?.doc_no;
        const { rate, customer, customer_details, customer_type } = req.body;

        if (!doc_no) {
            return res.status(400).json({ status: false, message: "doc_no is required" });
        }

        const result = await query(
            `SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE doc_no = $1 LIMIT 1`,
            [doc_no]
        );

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: `Bill of Supply record not found for doc_no: ${doc_no}`
            });
        }

        const record = result[0];

        if (record.pdf_link) {
            return res.status(400).json({
                status: false,
                message: "This record has already been submitted to SAP. Editing is not allowed."
            });
        }

        const rawData = typeof record.raw_data === 'string'
            ? JSON.parse(record.raw_data)
            : (record.raw_data || {});

        const existingLoadDetails = typeof record.load_details === 'string'
            ? JSON.parse(record.load_details)
            : (record.load_details || []);

        const newRate = rate !== undefined && rate !== null && rate !== ''
            ? Number(rate)
            : Number(record.rate);

        const updatedLoadDetails = existingLoadDetails.map((item) => {
            const weight = Number(item.weight) || 0;
            const newGross = +(weight * newRate).toFixed(2);
            return {
                ...item,
                rate: String(newRate),
                gross_value: newGross,
                bill_value: newGross
            };
        });

        const { gross_value, bill_value, average_weight } = computeTotals(updatedLoadDetails);

        const tentativeRate = rawData.tentative_rate || rawData.rate || record.rate;

        const updatedRawData = {
            ...rawData,
            tentative_rate: String(tentativeRate),
            rate: String(newRate),
            load_details: updatedLoadDetails
        };

        if (customer !== undefined) updatedRawData.customer = customer;
        if (customer_details !== undefined) {
            updatedRawData.customer_details = customer_details || rawData.customer_details || null;
        }
        if (customer_type !== undefined) updatedRawData.customer_type = customer_type;

        const newCustomer = customer !== undefined ? customer : record.customer;
        const newCustomerType = customer_type !== undefined ? customer_type : record.customer_type;

        const updateResult = await query(
            `UPDATE broiler.${broilerDataEntry[TABLE_NAME].pgTable}
             SET rate = $1,
                 customer = $2,
                 customer_type = $3,
                 load_details = $4,
                 gross_value = $5,
                 bill_value = $6,
                 average_weight = $7,
                 raw_data = $8,
                 tentative_rate = $9,
                 updated_at = CURRENT_TIMESTAMP
             WHERE doc_no = $10
             RETURNING *`,
            [
                newRate,
                newCustomer,
                newCustomerType,
                JSON.stringify(updatedLoadDetails),
                gross_value,
                bill_value,
                average_weight,
                JSON.stringify(updatedRawData),
                tentativeRate,
                doc_no
            ]
        );

        return res.status(200).json({
            status: true,
            message: "Bill of supply record updated successfully",
            data: updateResult[0]
        });

    } catch (error) {
        console.error("Error updating Broiler supply record:", error);
        res.status(500).json({
            status: false,
            message: "Error updating Broiler supply record",
            error: error.message
        });
    }
};

exports.remove = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(`DELETE FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE id = $1 RETURNING id`, [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: `Broiler supply record with ID ${id} not found for deletion` });
        }

        res.status(200).json({ status: true, message: `Broiler supply record with ID ${id} deleted successfully` });

    } catch (error) {
        console.error("Error deleting Broiler supply record:", error);
        res.status(500).json({ status: false, message: "Error deleting Broiler supply record", error: error.message });
    }
};

exports.deleteDraft = exports.remove;


exports.saveDraft = async (req, res) => {

    try {

        const data = req.body;

        // ── 1. If a draft_id was supplied, update that record directly ──
        if (data.draft_id) {
            const byId = await query(
                `SELECT id FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE id = $1 AND status = 'DRAFT' LIMIT 1`,
                [data.draft_id]
            );

            if (byId.length > 0) {
                const result = await query(
                    `UPDATE broiler.${broilerDataEntry[TABLE_NAME].pgTable}
                     SET
                         dc_no = $1,
                         vehicle_no = $2,
                         driver_name = $3,
                         driver_mobile = $4,
                         load_details = $5,
                         raw_data = $6,
                         plant = $7,
                         farmer = $8,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $9
                     RETURNING *`,
                    [
                        data.dc_no,
                        data.vehicle_no,
                        data.driver_name,
                        data.driver_mobile,
                        JSON.stringify(data.load_details),
                        JSON.stringify(data),
                        data.plant,
                        data.farmer,
                        byId[0].id
                    ]
                );
                return res.status(200).json({ status: true, data: result[0] });
            }
        }

        // ── 2. No draft_id supplied — INSERT a brand new draft record ──
        const insertQuery = `
            INSERT INTO broiler.${broilerDataEntry[TABLE_NAME].pgTable}
            (
                date,
                dc_no,
                vehicle_no,
                driver_name,
                driver_mobile,
                plant,
                farmer,
                load_details,
                raw_data,
                status,
                draft_saved_at
            )
            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,
                'DRAFT',
                NOW()
            )
            RETURNING *
        `;

        const values = [
            data.date,
            data.dc_no,
            data.vehicle_no,
            data.driver_name,
            data.driver_mobile,
            data.plant,
            data.farmer,
            JSON.stringify(data.load_details),
            JSON.stringify(data)
        ];

        const result = await query(insertQuery, values);

        return res.status(200).json({
            status: true,
            data: result[0]
        });

    } catch (err) {

        return res.status(500).json({
            status: false,
            error: err.message
        });
    }
};

exports.getDrafts = async (req, res) => {
    try {
        const result = await query(`
            SELECT *
            FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable}
            WHERE status='DRAFT'
            ORDER BY draft_saved_at DESC
        `);

        return res.json({
            status: true,
            data: result
        });

    } catch (err) {
        return res.status(500).json({
            status: false,
            error: err.message
        });
    }
};

exports.getDraftById = async (req, res) => {

    try {

        const { id } = req.params;

        const result = await query(
            `
            SELECT *
            FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable}
            WHERE id = $1
            LIMIT 1
            `,
            [id]
        );

        return res.json({
            status: true,
            data: result[0]
        });

    } catch (err) {

        return res.status(500).json({
            status: false,
            error: err.message
        });
    }
};

exports.completeDraft = async (req, res) => {
try {

    const { id } = req.params;
    const data = req.body;

    const checkDraft = await query(
        `SELECT * FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable} WHERE id = $1 LIMIT 1`,
        [id]
    );

    if (!checkDraft || checkDraft.length === 0) {
        return res.status(404).json({
            status: false,
            message: "Draft not found"
        });
    }

    if (checkDraft[0].status === 'COMPLETED') {
        console.log(`BOS completeDraft: Draft ID "${id}" is already completed. Returning existing completed record.`);
        const existingRec = checkDraft[0];
        const pdfLink = existingRec.mobile_pdf_link || existingRec.pdf_link;
        return res.status(200).json({
            status: true,
            doc_no: existingRec.doc_no,
            pdfLink: pdfLink,
            data: existingRec
        });
    }

    if (!data.rate || Number(data.rate) <= 0) {
    return res.status(400).json({
        status: false,
        message: "Rate is required"
    });
}

const invalidLoad = (data.load_details || []).some(
    item =>
        item.birdQty !== undefined && item.birdQty !== null && item.birdQty !== '' && Number(item.birdQty) < 0
);

if (invalidLoad) {
    return res.status(400).json({
        status: false,
        message: "Bird count cannot be negative"
    });
}
    const seqRes = await query(
    `SELECT nextval('broiler.bill_of_supply_doc_seq') AS seq`
);

const doc_no = `BOS/DC/${seqRes[0].seq}`;
     

    const { gross_value, bill_value, average_weight } =
        computeTotals(data.load_details);

    const result = await query(
        `
        UPDATE broiler.${broilerDataEntry[TABLE_NAME].pgTable}
       SET
    load_details = $1,
    rate = $2,
    average_weight = $3,
    gross_value = $4,
    bill_value = $5,
    raw_data = $6,
    doc_no = $7,
    status = 'COMPLETED',
    completed_at = NOW(),
    updated_at = CURRENT_TIMESTAMP
        WHERE id = $8
        RETURNING *
        `,
       [
    JSON.stringify(data.load_details),
    data.rate,
    average_weight,
    gross_value,
    bill_value,
    JSON.stringify(data),
    doc_no,
    id
]
    );

    if (!result.length) {
        return res.status(404).json({
            status: false,
            message: "Draft not found"
        });
    }

   

    let updatedRecord = result[0];

   const publicUrl = await generateBillOfSupplyPDF(
    data,
    doc_no
);

await query(
`
UPDATE broiler.${broilerDataEntry[TABLE_NAME].pgTable}
SET
    mobile_pdf_link = $1,
    raw_data = $2
WHERE id = $3
`,
[
    publicUrl,
    JSON.stringify({
        ...data,
        doc_no,
        pdfLink: publicUrl,
        status: 'COMPLETED'
    }),
    id
]
);

// --- Send SMS asynchronously after draft completion (non-blocking) ---
        dispatchBosSmsAsync(data, 'completeDraft');

const latestRecord = await query(
`
SELECT *
FROM broiler.${broilerDataEntry[TABLE_NAME].pgTable}
WHERE id = $1
LIMIT 1
`,
[id]
);

updatedRecord = latestRecord[0];

  return res.status(200).json({
    status: true,
    doc_no,
    pdfLink: publicUrl,
    data: updatedRecord
});

} catch (err) {

    return res.status(500).json({
        status: false,
        error: err.message
    });
}

};
