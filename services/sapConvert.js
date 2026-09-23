function convertToSAP(item) {
    const quantity = Number(item.quantity) || 0;
    const price = Number(item.base_price) || 0;
    const cgst = Number(item.cgst_rate) || 0;
    const sgst = Number(item.sgst_rate) || 0;

    const taxable = price * quantity;
    const cgstAmt = taxable * cgst / 100;
    const sgstAmt = taxable * sgst / 100;
    const gross = taxable + cgstAmt + sgstAmt;

    // Safely parse doc_date (created_at) whether it is a Date object or a string
    const docDate = item.doc_date instanceof Date ? item.doc_date : new Date(item.doc_date);

    // BLDAT is a custom CHAR field in ZWAGON_MOB_DATA -> YYYY-MM-DD is accepted
    const docDateStr = docDate.toISOString().split("T")[0];

    /**
     * SAP standard DATE fields (AEDAT, FKDAT, ZRR_DATE, etc.) are ABAP type DATS (8 chars).
     * They must be sent as YYYYMMDD (no separators).
     * Sending YYYY-MM-DD (10 chars) causes SAP to truncate to "YYYY-MM-" which is
     * an invalid date and displays as "MM--.YYYY" in the table.
     */
    const toSAPDate = (val) => {
        if (!val) return "";
        const d = val instanceof Date ? val : new Date(val);
        if (isNaN(d.getTime())) return "";
        // Use local time (TZ = Asia/Kolkata set in db.js) for correct IST date
        const yyyy = d.getFullYear();
        const mm   = String(d.getMonth() + 1).padStart(2, "0");
        const dd   = String(d.getDate()).padStart(2, "0");
        return `${yyyy}${mm}${dd}`;
    };

    /**
     * LFUHR is a SAP TIME field (ABAP type TIMS, 6 chars = HHMMSS).
     * Previously it received docDateStr ("2026-09-22") which made SAP read
     * "20", "26", "09" as HH:MM:SS -> displayed as "20:26:0" (wrong).
     * Fix: send the actual time of the DC creation in HHMMSS format.
     */
    const toSAPTime = (val) => {
        if (!val) return "000000";
        const d = val instanceof Date ? val : new Date(val);
        if (isNaN(d.getTime())) return "000000";
        const hh = String(d.getHours()).padStart(2, "0");
        const mi = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        return `${hh}${mi}${ss}`;
    };

    return {
        id: item.s_no,
        BLDAT: docDateStr,                                         // CHAR field -> YYYY-MM-DD OK
        XBLNR: item.doc_no,
        ZTO: item.to,
        ZADDRESS: item.address,
        ZTRUCK_NO: item.truck_no,
        MAKTX: item.materials,
        MATNR: item.material_code,
        ZHSN_CODE: item.hsn_code,
        MENGED: quantity.toFixed(3),
        ZRATE: (price + price * (cgst + sgst) / 100).toFixed(2),
        ZCGST_PER: cgst.toFixed(2),
        ZSGST_PER: sgst.toFixed(2),
        ZTAXABLE_VAL: taxable.toFixed(2),
        ZCGST_AMT: cgstAmt.toFixed(2),
        ZSGST_AMT: sgstAmt.toFixed(2),
        ZGROSS_AMT: gross.toFixed(2),
        ZEWAY: item.e_way_bill_no || "",
        ZSD_DISTANCE: item.distance || 0,
        ZSTATUS: item.status == 1 ? "Active" : "Cancelled",
        ZREASON: item.reason || "-",
        ZPO_NO: item.po_number,
        ZNO_OF_BAGS: item.no_of_bags,
        ZRR_NO: item.rr_no,
        ZTOKEN: item.token_no,
        ZVBELN: item.bill_number,
        ZSUPPLR: item.supplier_id,
        AEDAT: toSAPDate(item.doc_date),                          // DATS field -> YYYYMMDD
        ZRR_DATE: item?.rr_date ? toSAPDate(item.rr_date) : "",  // DATS field -> YYYYMMDD
        ZSUPP_NAME: item.supplier_name,
        ZSUP_INV_DATE: item?.supplier_invoice_date                // DATS field -> YYYYMMDD
            ? toSAPDate(item.supplier_invoice_date) : "",
        LFUHR: toSAPTime(item.doc_date),                          // TIMS field -> HHMMSS (actual time)
        MEINS: item.unit_name,
        FKART: item.doc_no?.includes("T") ? "Taxable" : "Exempted",
        FKDAT: toSAPDate(item.doc_date),                          // DATS field -> YYYYMMDD
        ZEWAY_STATUS: !item.e_way_bill_no
            ? "-"
            : item.status == 1
                ? "Active"
                : "Cancelled",
        ZCANC_REASON: item.reason || "-",
        ZBRANCH: item?.branch_name || "-",
        PO_DATE: item?.po_date ? toSAPDate(item.po_date) : ""    // DATS field -> YYYYMMDD
    };
}

module.exports = { convertToSAP };
